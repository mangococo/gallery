import { ipcMain, dialog, shell, nativeTheme, BrowserWindow, clipboard } from 'electron'
import { promises as fs, mkdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { nanoid } from 'nanoid'
import { IPC } from '../shared/types'
import type {
  Album,
  CreateTripInput,
  LegacyImportResult,
  MovePhotosResult,
  MoveTarget,
  ScanProgress,
  ThemeMode,
  TripDTO,
  TripPatch,
} from '../shared/types'
import {
  getSetting,
  setSetting,
  initDb,
  listAlbumRows,
  getAlbumRow,
  getAlbumRowByPath,
  insertAlbumRow,
  updateAlbumPath,
  renameAlbumRow,
  setAlbumStatus,
  removeAlbumRow,
  getTripRow,
  listTripRows,
  insertTripRow,
  updateTripRow,
  deleteTripRow,
  deleteTripsOfAlbum,
  getTagsOfTrip,
  setTagsOfTrip,
  allTags,
  getPhotoRow,
  insertPhotoRow,
  deletePhotoRow,
  updatePhotoLocations,
  setPhotoCaption,
  setPhotoFavorite,
  setTagsOfPhoto,
  listPhotosOfTrip,
  searchTripHits,
  getStats,
} from './db'
import { scanAlbum } from './services/scanner'
import { mediaTypeOf } from './services/scanner'
import { planTripRemoval } from './services/reconcile'
import { collisionSafeDestName, planCoverReassignment, validateMovePhotos } from './services/move-plan'
import { resolvePhotoTakenAt, readExifGps } from './services/exif'
import { generateThumbsForAlbum, cancelThumbsForAlbum } from './services/thumbnails'
import { watchAlbum, closeWatcher } from './services/watcher'
import { exportJournal } from './services/journal'

function senderWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function pushProgress(p: ScanProgress): void {
  senderWindow()?.webContents.send(IPC.pushScanProgress, p)
}

function pushChanged(albumId: string): void {
  senderWindow()?.webContents.send(IPC.pushFsChanged, { albumId })
}

/** 路径可访问（存在且可 stat） */
async function pathAccessible(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

/** 旅行文件夹是否还在相册目录中（磁盘实时校对，不落库） */
async function tripFolderExists(albumPath: string, folderName: string): Promise<boolean> {
  return pathAccessible(join(albumPath, folderName))
}

/** 单个旅行附带走位状态（tripsGet/tripsCreate/tripsUpdate 出口统一） */
async function withTripStatus<T extends { status: 'ok' | 'missing'; folderName: string }>(
  album: Album | null,
  trip: T,
): Promise<T> {
  const exists = album ? await tripFolderExists(album.path, trip.folderName) : false
  return { ...trip, status: exists ? 'ok' : 'missing' }
}

/** 对相册执行完整扫描 + 缩略图生成 + watcher 更新，并通知渲染层 */
export async function fullRescan(albumId: string, pushEvents = true): Promise<ScanProgress | null> {
  const album = getAlbumRow(albumId)
  if (!album) return null
  const counters = await scanAlbum(albumId, {
    progress: pushEvents ? pushProgress : () => {},
    finished: () => {},
  })
  if (!counters) return null
  await generateThumbsForAlbum(albumId, album.name, {
    progress: pushEvents ? pushProgress : () => {},
  })
  if (pushEvents) pushChanged(albumId)
  // 激活相册时同步 watcher
  const activeId = getSetting('active_album_id')
  if (activeId === albumId) {
    void watchAlbum(albumId, { progress: pushProgress, changed: pushChanged })
  }
  return { albumId, albumName: album.name, phase: 'thumb', done: 1, total: 1 }
}

/** 相册列表 + 实时可访问性校对（外置卷拔出 → missing） */
async function listAlbumsWithStatusCheck(): Promise<Album[]> {
  const albums = listAlbumRows()
  await Promise.all(
    albums.map(async (album) => {
      const accessible = await fs
        .access(album.path)
        .then(() => true)
        .catch(() => false)
      const stored = getAlbumRow(album.id)?.status
      if (accessible && stored !== 'ok') setAlbumStatus(album.id, 'ok')
      if (!accessible && stored !== 'missing') setAlbumStatus(album.id, 'missing')
    }),
  )
  return listAlbumRows()
}

export function registerIpcHandlers(): void {
  initDb()

  // —— 应用 ——
  ipcMain.handle(IPC.bootstrap, async () => {
    const albums = await listAlbumsWithStatusCheck()
    return {
      theme: (getSetting('theme_mode') as ThemeMode) ?? 'system',
      systemDark: nativeTheme.shouldUseDarkColors,
      albums,
      activeAlbumId: getSetting('active_album_id'),
    }
  })
  ipcMain.handle(IPC.stats, () => getStats())

  // —— 相册 ——
  ipcMain.handle(IPC.albumsList, () => listAlbumsWithStatusCheck())

  ipcMain.handle(IPC.albumsRegister, async (e): Promise<Album | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      title: '选择相册目录',
      properties: ['openDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    return registerAlbumAt(res.filePaths[0])
  })

  ipcMain.handle(IPC.albumsRemove, async (_e, id: string) => {
    cancelThumbsForAlbum(id)
    // 队列被取消后不会再有收尾进度，补一个 done>=total 让渲染层进度条收起
    pushProgress({ albumId: id, albumName: '', phase: 'thumb', done: 1, total: 1 })
    if (getSetting('active_album_id') === id) setSetting('active_album_id', '')
    removeAlbumRow(id) // 仅解除注册，不删除任何文件
    await closeWatcherIfInactive(id)
  })

  ipcMain.handle(IPC.albumsRename, (_e, id: string, name: string) => {
    renameAlbumRow(id, name.trim())
    return getAlbumRow(id)
  })

  ipcMain.handle(IPC.albumsRelocate, async (e, id: string): Promise<Album | null> => {
    const album = getAlbumRow(id)
    if (!album) return null
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      title: `重新定位「${album.name}」的目录`,
      properties: ['openDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const newPath = res.filePaths[0]
    // 新路径已被其他相册占用则拒绝
    const occupied = getAlbumRowByPath(newPath)
    if (occupied && occupied.id !== id) throw new Error('该目录已被其他相册注册')
    updateAlbumPath(id, newPath)
    void fullRescan(id)
    return getAlbumRow(id)
  })

  ipcMain.handle(IPC.albumsRescan, async (_e, id: string) => {
    return fullRescan(id)
  })

  ipcMain.handle(IPC.albumsSetActive, async (_e, id: string | null) => {
    setSetting('active_album_id', id ?? '')
    if (id) {
      await watchAlbum(id, { progress: pushProgress, changed: pushChanged })
    } else {
      await closeWatcher()
    }
  })

  ipcMain.handle(IPC.albumsGetActive, () => getSetting('active_album_id') || null)

  // —— 旅行 ——
  ipcMain.handle(IPC.tripsList, (_e, albumId: string) => {
    const album = getAlbumRow(albumId)
    if (!album) return []
    // 实时可访问性校对
    return fs
      .access(album.path)
      .then(() => album)
      .catch(() => null)
      .then(async (ok) => {
        if (!ok) {
          setAlbumStatus(albumId, 'missing')
          return []
        }
        if (album.status !== 'ok') setAlbumStatus(albumId, 'ok')
        // 附带走位状态（启动即扫描：文件夹被外部移除的旅行当场标记 missing）
        // + 完整照片列表（时间线堆叠与计数需要）
        const trips = await Promise.all(
          listTripRows(albumId).map(async (t) => {
            const withStatus = await withTripStatus(album, t)
            return { ...withStatus, tags: getTagsOfTrip(t.id), photos: photosOfTrip(t) }
          }),
        )
        return trips
      })
  })

  ipcMain.handle(IPC.tripsGet, async (_e, id: string) => {
    const t = getTripRow(id)
    if (!t) return null
    const withStatus = await withTripStatus(getAlbumRow(t.albumId), t)
    return { ...withStatus, tags: getTagsOfTrip(id), photos: photosOfTrip(t) }
  })

  ipcMain.handle(IPC.tripsCreate, (_e, input: CreateTripInput) => {
    const albumId = getSetting('active_album_id')
    const album = albumId ? getAlbumRow(albumId) : null
    if (!album) throw new Error('请先注册并激活一个相册目录')
    const t = createTripInAlbum(album, input)
    const row = getTripRow(t.id)!
    return { ...row, tags: getTagsOfTrip(t.id), photos: [] }
  })

  ipcMain.handle(IPC.tripsUpdate, async (_e, id: string, patch: TripPatch) => {
    const tags = patch.tags
    updateTripRow(id, patch)
    if (tags !== undefined) setTagsOfTrip(id, tags)
    const t = getTripRow(id)
    if (!t) throw new Error('旅行不存在')
    const withStatus = await withTripStatus(getAlbumRow(t.albumId), t)
    return { ...withStatus, tags: getTagsOfTrip(id), photos: photosOfTrip(t) }
  })

  ipcMain.handle(IPC.tripsDelete, async (_e, id: string) => {
    const t = getTripRow(id)
    if (!t) return
    const album = getAlbumRow(t.albumId)
    if (album) {
      const rootOk = await fs
        .access(album.path)
        .then(() => true)
        .catch(() => false)
      const plan = planTripRemoval(rootOk, await tripFolderExists(album.path, t.folderName))
      if (plan.action === 'root-missing') {
        // 外置卷未挂载等场景：无法区分「真没了」和「暂时看不到」，删元数据不可逆，拒绝
        throw new Error('相册目录当前不可访问，无法确认旅行文件夹状态，已取消删除')
      }
      if (plan.action === 'trash-folder') {
        // 一律进废纸篓，不直接删除
        await shell.trashItem(join(album.path, t.folderName)).catch((err) => {
          throw new Error('移入废纸篓失败: ' + err.message)
        })
      }
      // record-only：文件夹已被移出相册目录/外部删除，只清理库内元数据
    }
    deleteTripRow(id)
    pushChanged(t.albumId)
  })

  ipcMain.handle(IPC.tagsList, () => allTags())

  // —— 照片 ——
  ipcMain.handle(IPC.photosImport, async (_e, tripId: string, paths: string[]) => {
    const t = getTripRow(tripId)
    if (!t) throw new Error('旅行不存在')
    const album = getAlbumRow(t.albumId)
    if (!album) throw new Error('相册不存在')
    const destDir = join(album.path, t.folderName)
    // 旅行文件夹可能被外部移出/删除过，导入前确保存在
    await fs.mkdir(destDir, { recursive: true })

    /** 目标不重名：重名加时间戳前缀，仍冲突则加序号（同批同名文件在同一毫秒内也不会互相覆盖） */
    const dedupeName = async (name: string): Promise<string> => {
      if (!(await pathAccessible(join(destDir, name)))) return name
      const stamp = Date.now()
      let candidate = `${stamp}_${name}`
      let i = 1
      while (await pathAccessible(join(destDir, candidate))) {
        candidate = `${stamp}_${i++}_${name}`
      }
      return candidate
    }

    const importedIds: string[] = []
    const failed: { name: string; reason: string }[] = []
    for (const src of paths) {
      const base = basename(src)
      const type = mediaTypeOf(base)
      if (!type) continue
      try {
        const name = await dedupeName(base)
        const dest = join(destDir, name)
        await fs.copyFile(src, dest)
        const st = await fs.stat(dest)
        const photoId = nanoid(12)
        const gps = type === 'image' ? await readExifGps(dest) : null
        insertPhotoRow({
          id: photoId,
          tripId,
          fileName: name,
          relPath: `${t.folderName}/${name}`,
          type,
          caption: '',
          takenAt: await resolvePhotoTakenAt(dest, type, st.mtimeMs),
          fileMtime: Math.round(st.mtimeMs),
          gpsLat: gps?.lat ?? null,
          gpsLon: gps?.lon ?? null,
        })
        importedIds.push(photoId)
      } catch (err: any) {
        // 单个文件失败（源被移走/无权限/磁盘满）不中断整批，结尾统一回报
        failed.push({ name: base, reason: String(err?.message ?? err) })
      }
    }

    // 后台补缩略图并通知
    void (async () => {
      await generateThumbsForAlbum(album.id, album.name, { progress: pushProgress })
      pushChanged(album.id)
    })()

    if (importedIds.length === 0 && failed.length > 0) {
      throw new Error(`全部 ${failed.length} 个文件导入失败：${failed[0].name}（${failed[0].reason}）`)
    }
    // 只返回本次新增的照片与失败清单
    const photos = importedIds
      .map((id) => getPhotoRow(id))
      .filter((p): p is NonNullable<typeof p> => p !== null)
    return { photos, failed }
  })

  ipcMain.handle(IPC.photosDelete, async (_e, photoId: string) => {
    const photo = getPhotoRow(photoId)
    if (!photo) return
    const album = getAlbumRow(photo.albumId)
    if (album) {
      const abs = join(album.path, photo.relPath)
      // 与删除旅行同规则：相册根不可达时拒绝删记录（外置卷可能只是暂时看不到）；
      // 根可达但文件已被外部移走/删除时只清记录，磁盘无东西可删
      const plan = planTripRemoval(await pathAccessible(album.path), await pathAccessible(abs))
      if (plan.action === 'root-missing') {
        throw new Error('相册目录当前不可访问，无法确认照片文件状态，已取消删除')
      }
      if (plan.action === 'trash-folder') {
        await shell.trashItem(abs).catch((err) => {
          throw new Error('移入废纸篓失败: ' + err.message)
        })
      }
    }
    deletePhotoRow(photoId)
    pushChanged(photo.albumId)
  })

  ipcMain.handle(IPC.photosSetCaption, (_e, photoId: string, caption: string) => {
    setPhotoCaption(photoId, caption)
  })

  ipcMain.handle(IPC.photosSetFavorite, (_e, photoId: string, favorite: boolean) => {
    setPhotoFavorite(photoId, favorite)
  })

  ipcMain.handle(IPC.photosSetTags, (_e, photoId: string, tags: string[]) => {
    setTagsOfPhoto(photoId, tags)
  })

  ipcMain.handle(IPC.photosSetCover, (_e, tripId: string, photoId: string) => {
    updateTripRow(tripId, { coverPhotoId: photoId })
  })

  // —— 移动照片到其他旅行（目标可为已有旅行或流程内新建） ——
  ipcMain.handle(
    IPC.photosMove,
    async (_e, photoIds: string[], target: MoveTarget): Promise<MovePhotosResult> => {
      const facts = photoIds
        .map((id) => getPhotoRow(id))
        .filter((p): p is NonNullable<typeof p> => p !== null)
      if (facts.length === 0) throw new Error('没有可移动的照片')

      const albumIds = new Set(facts.map((p) => p.albumId))
      if (albumIds.size > 1) throw new Error('所选照片分属不同相册，无法一起移动')
      const album = getAlbumRow([...albumIds][0])
      if (!album) throw new Error('相册不存在')

      // 目标旅行：已有 or 新建（新建与搬文件一气呵成，避免「空旅行残留」的中间态）
      let targetTrip
      if (target.tripId) {
        targetTrip = getTripRow(target.tripId)
        if (!targetTrip) throw new Error('目标旅行不存在')
        if (targetTrip.albumId !== album.id) throw new Error('不能把照片移动到其他相册的旅行')
      } else if (target.createTrip) {
        targetTrip = getTripRow(createTripInAlbum(album, target.createTrip).id)
      } else {
        throw new Error('未指定目标旅行')
      }
      if (!targetTrip) throw new Error('目标旅行创建失败')

      const validated = validateMovePhotos(
        facts.map((p) => ({
          id: p.id,
          albumId: p.albumId,
          tripId: p.tripId,
          fileName: p.fileName,
          relPath: p.relPath,
        })),
        album.id,
        targetTrip.id,
      )
      if (validated.photos.length === 0) {
        return {
          movedIds: [],
          fileMissingCount: 0,
          targetTrip: tripToDto(targetTrip),
        }
      }

      // 目标目录就绪（记录在、文件夹被外部移走的旅行借此自愈）
      const destDir = join(album.path, targetTrip.folderName)
      await fs.mkdir(destDir, { recursive: true })

      // 先搬文件、后写库；中途失败回滚已搬文件，库不留中间态
      const renames: { from: string; to: string }[] = []
      const updates: { id: string; tripId: string; fileName: string; relPath: string }[] = []
      let fileMissingCount = 0
      try {
        for (const p of validated.photos) {
          const srcAbs = join(album.path, p.relPath)
          const srcExists = await fs
            .access(srcAbs)
            .then(() => true)
            .catch(() => false)
          if (!srcExists) fileMissingCount++
          // 重名加时间戳前缀（与导入同一约定）；大小写不敏感探测
          const destName = collisionSafeDestName(p.fileName, (n) => existsSync(join(destDir, n)))
          if (srcExists) {
            await fs.rename(srcAbs, join(destDir, destName))
            renames.push({ from: srcAbs, to: join(destDir, destName) })
          }
          updates.push({
            id: p.id,
            tripId: targetTrip.id,
            fileName: destName,
            relPath: `${targetTrip.folderName}/${destName}`,
          })
        }
        updatePhotoLocations(updates)
      } catch (err) {
        for (const r of renames.reverse()) {
          await fs.rename(r.to, r.from).catch(() => {})
        }
        throw new Error('移动照片失败：' + ((err as Error)?.message ?? err) + '，已还原未完成的部分')
      }

      // 封面随照片移走的源旅行补封面（剩下第一张，移空则清空）
      const movedSet = new Set(updates.map((u) => u.id))
      for (const plan of planCoverReassignment(
        [...validated.sourceTripIds].map((tripId) => {
          const t = getTripRow(tripId)!
          return {
            tripId,
            coverPhotoId: t.coverPhotoId,
            remainingPhotoIds: listPhotosOfTrip(tripId, album.id, t.coverPhotoId)
              .map((p) => p.id)
              .filter((id) => !movedSet.has(id)),
          }
        }),
        movedSet,
      )) {
        updateTripRow(plan.tripId, { coverPhotoId: plan.coverPhotoId })
      }

      pushChanged(album.id)
      const fresh = getTripRow(targetTrip.id)!
      return {
        movedIds: updates.map((u) => u.id),
        fileMissingCount,
        targetTrip: tripToDto(fresh),
      }
    },
  )

  ipcMain.handle(IPC.photosReveal, async (_e, photoId: string) => {
    const photo = getPhotoRow(photoId)
    if (!photo) throw new Error('照片不存在')
    const root = getAlbumRow(photo.albumId)
    if (!root) throw new Error('相册不存在')
    shell.showItemInFolder(join(root.path, photo.relPath))
  })

  ipcMain.handle(IPC.photosCopyPath, async (_e, photoId: string): Promise<string> => {
    const photo = getPhotoRow(photoId)
    if (!photo) throw new Error('照片不存在')
    const root = getAlbumRow(photo.albumId)
    if (!root) throw new Error('相册不存在')
    const abs = join(root.path, photo.relPath)
    clipboard.writeText(abs)
    return abs
  })

  // —— 主题 ——
  ipcMain.handle(IPC.themeGet, () => (getSetting('theme_mode') as ThemeMode) ?? 'system')
  ipcMain.handle(IPC.themeSet, (_e, mode: ThemeMode) => {
    setSetting('theme_mode', mode)
    nativeTheme.themeSource = mode
    notifyThemeState()
  })

  // —— ⌘K 搜索 ——
  ipcMain.handle(IPC.searchTrips, (_e, albumId: string, q: string) => searchTripHits(albumId, q))

  // —— 手账导出 ——
  ipcMain.handle(IPC.journalsExport, async (e, tripId: string, format: 'pdf' | 'png') => {
    const win = BrowserWindow.fromWebContents(e.sender)
    if (!win) throw new Error('窗口不存在')
    const res = await exportJournal(win, tripId, format, null)
    return res.canceled ? null : res.path ?? null
  })

  // —— 旧数据导入 ——
  ipcMain.handle(IPC.importLegacy, async (e): Promise<LegacyImportResult | null> => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const res = await dialog.showOpenDialog(win!, {
      title: '选择旧版数据的根目录（包含各旅行子文件夹）',
      properties: ['openDirectory'],
    })
    if (res.canceled || res.filePaths.length === 0) return null
    const rootPath = res.filePaths[0]
    const existing = getAlbumRowByPath(rootPath)
    const album = existing ?? (await registerAlbumAt(rootPath, true))
    if (!album) return null

    const counters = (await scanAlbum(album.id, { progress: pushProgress, finished: () => {} })) ?? {
      trips: 0,
      photos: 0,
      skippedCaptions: 0,
    }
    await generateThumbsForAlbum(album.id, album.name, { progress: pushProgress })
    pushChanged(album.id)
    return { album: getAlbumRow(album.id)!, ...counters }
  })

  // 系统主题变化 → 推送渲染层
  nativeTheme.on('updated', () => notifyThemeState())
}

// ---------- 内部工具 ----------

function photosOfTrip(t: { id: string; albumId: string; coverPhotoId: string | null }) {
  return listPhotosOfTrip(t.id, t.albumId, t.coverPhotoId)
}

/** TripRow → TripDTO（补标签与照片列表；走位状态由调用方按需附加） */
function tripToDto(t: Omit<TripDTO, 'tags' | 'photos'>) {
  return { ...t, tags: getTagsOfTrip(t.id), photos: photosOfTrip(t) }
}

/** 在指定相册内创建旅行（目录+记录+标签）；tripsCreate 与「移动到新建旅行」共用 */
function createTripInAlbum(album: Album, input: CreateTripInput) {
  const safeName = sanitizeFileName(input.title)
  const folderName = dedupeFolderName(album.path, safeName)
  const t = {
    id: nanoid(12),
    albumId: album.id,
    folderName,
    title: input.title.trim() || folderName,
    description: input.description ?? '',
    startDate: input.startDate ?? '',
    endDate: input.endDate ?? '',
    isFavorite: false,
  }
  // 建目录（同步，量小）
  mkdirSync(join(album.path, folderName), { recursive: true })
  insertTripRow(t)
  if (input.tags?.length) setTagsOfTrip(t.id, input.tags)
  return t
}

async function closeWatcherIfInactive(id: string): Promise<void> {
  if (getSetting('active_album_id') !== id) return
  await closeWatcher()
}

/** 注册目录为相册并启动后台扫描（E2E 钩子复用） */
export async function registerAlbumAt(rootPath: string, quiet = false): Promise<Album | null> {
  const existing = getAlbumRowByPath(rootPath)
  if (existing) {
    if (!quiet) void fullRescan(existing.id)
    return existing
  }
  const album: Album = {
    id: nanoid(12),
    name: basename(rootPath),
    path: rootPath,
    status: 'ok',
    createdAt: Date.now(),
  }
  insertAlbumRow(album)
  // 后台扫描：进度经 pushProgress 推送
  void fullRescan(album.id)
  return album
}

function sanitizeFileName(name: string): string {
  const cleaned = (name || 'untitled').replace(/[/\\:*?"<>|]/g, '_').trim()
  return cleaned || 'untitled'
}

function dedupeFolderName(root: string, base: string): string {
  let name = base
  let i = 2
  while (existsSync(join(root, name))) {
    name = `${base} (${i})`
    i++
  }
  return name
}

function notifyThemeState(): void {
  senderWindow()?.webContents.send(IPC.pushThemeSystemChanged, {
    systemDark: nativeTheme.shouldUseDarkColors,
  })
}
