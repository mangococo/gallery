import { ipcMain, dialog, shell, nativeTheme, BrowserWindow, clipboard, app } from 'electron'
import { promises as fs, mkdirSync, existsSync, watch as fsWatch } from 'fs'
import { join, basename } from 'path'
import { nanoid } from 'nanoid'
import { IPC } from '../shared/types'
import type {
  Album,
  CreateTripInput,
  FlatMediaProbe,
  LegacyImportResult,
  MovePhotosResult,
  MoveTarget,
  RegisterAlbumResult,
  ScanProgress,
  ThemeMode,
  ThemePaletteId,
  TrashSelection,
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
  getTripRowIncludingTrashed,
  getPhotoRowIncludingTrashed,
  getAnyTripIdByFolder,
  listTripRows,
  insertTripRow,
  updateTripRow,
  deleteTripsOfAlbum,
  getTagsOfTrip,
  setTagsOfTrip,
  allTags,
  getPhotoRow,
  insertPhotoRow,
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
import { splitFlatMediaFiles } from './services/flat-media'
import { collisionSafeDestName, planCoverReassignment, validateMovePhotos } from './services/move-plan'
import { listTrash, purgeItems, restoreItems, trashPhoto, trashTrip } from './services/trash'
import { resolvePhotoTakenAt, readExifGps } from './services/exif'
import { generateThumbsForAlbum, cancelThumbsForAlbum } from './services/thumbnails'
import type { ThumbReadyItem } from './services/thumbnails'
import { watchAlbum, closeWatcher } from './services/watcher'
import { exportJournal } from './services/journal'
import { getMainWindow } from './windows'

/** 主动推送的目标窗口（见 windows.ts 的说明——不能再用 getAllWindows()[0]） */
function senderWindow(): BrowserWindow | null {
  return getMainWindow()
}

function pushProgress(p: ScanProgress): void {
  senderWindow()?.webContents.send(IPC.pushScanProgress, p)
}

function pushChanged(albumId: string): void {
  senderWindow()?.webContents.send(IPC.pushFsChanged, { albumId })
}

/** 缩略图批量就绪推送：渲染层增量点亮，首扫期间照片墙不再回退原图（#3） */
function pushThumbsReady(albumId: string, items: ThumbReadyItem[]): void {
  if (items.length === 0) return
  senderWindow()?.webContents.send(IPC.pushThumbsReady, { albumId, photos: items })
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
    ready: pushEvents ? (items) => pushThumbsReady(albumId, items) : () => {},
  })
  if (pushEvents) pushChanged(albumId)
  // 激活相册时同步 watcher
  const activeId = getSetting('active_album_id')
  if (activeId === albumId) {
    void watchAlbum(albumId, {
      progress: pushProgress,
      changed: pushChanged,
      thumbsReady: (items) => pushThumbsReady(albumId, items),
    })
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
      albums,
      activeAlbumId: getSetting('active_album_id'),
    }
  })
  ipcMain.handle(IPC.stats, () => getStats())

  // —— 相册 ——
  ipcMain.handle(IPC.albumsList, () => listAlbumsWithStatusCheck())

  ipcMain.handle(
    IPC.albumsRegister,
    async (e): Promise<RegisterAlbumResult> => {
      const win = BrowserWindow.fromWebContents(e.sender)
      const res = await dialog.showOpenDialog(win!, {
        title: '选择相册目录',
        properties: ['openDirectory'],
      })
      if (res.canceled || res.filePaths.length === 0) return { status: 'canceled' }
      const rootPath = res.filePaths[0]

      const existing = getAlbumRowByPath(rootPath)
      if (existing) {
        fullRescanInBackground(existing.id)
        return { status: 'ok', album: existing }
      }

      // 平铺媒体预检（#2）：根目录直接放照片时不能静默丢弃，交给用户确认归档
      const probe = await probeFlatMediaAt(rootPath)
      if (probe.fileCount > 0) {
        return { status: 'flat-media', ...probe, suggestedName: '未整理的照片' }
      }

      const album = await registerAlbumAt(rootPath)
      return album ? { status: 'ok', album } : { status: 'canceled' }
    },
  )

  ipcMain.handle(IPC.albumsProbeFlat, (_e, path: string): Promise<FlatMediaProbe> => probeFlatMediaAt(path))

  ipcMain.handle(IPC.albumsAdoptFlat, (_e, path: string, tripName: string): Promise<Album> =>
    adoptFlatMediaAt(path, tripName),
  )

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
    fullRescanInBackground(id)
    return getAlbumRow(id)
  })

  ipcMain.handle(IPC.albumsRescan, async (_e, id: string) => {
    return fullRescan(id)
  })

  ipcMain.handle(IPC.albumsSetActive, async (_e, id: string | null) => {
    setSetting('active_album_id', id ?? '')
    if (id) {
      await watchAlbum(id, {
        progress: pushProgress,
        changed: pushChanged,
        thumbsReady: (items) => pushThumbsReady(id, items),
      })
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
    await trashTrip(id)
    const t = getTripRowIncludingTrashed(id)
    if (t) pushChanged(t.albumId)
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

    // 后台补缩略图并通知（导入链路的收尾任务，失败只记日志）
    void (async () => {
      await generateThumbsForAlbum(album.id, album.name, {
        progress: pushProgress,
        ready: (items) => pushThumbsReady(album.id, items),
      })
      pushChanged(album.id)
    })().catch((err) => {
      console.error('[thumb] 导入后补缩略图失败:', (err as Error)?.message ?? err)
    })

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
    await trashPhoto(photoId)
    const p = getPhotoRowIncludingTrashed(photoId)
    if (p) pushChanged(p.albumId)
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
  ipcMain.handle(IPC.themePaletteGet, () => (getSetting('theme_palette') as ThemePaletteId) ?? 'default')
  ipcMain.handle(IPC.themePaletteSet, (_e, id: ThemePaletteId) => {
    setSetting('theme_palette', id)
  })

  // —— 自定义样式（userData/theme.css，保存即热更新） ——
  ipcMain.handle(IPC.themeCustomCssGet, async () => {
    try {
      return await fs.readFile(customCssPath(), 'utf8')
    } catch {
      return null
    }
  })
  ipcMain.handle(IPC.themeCustomCssEnsure, async () => {
    const p = customCssPath()
    try {
      await fs.access(p)
    } catch {
      await fs.writeFile(p, CUSTOM_CSS_TEMPLATE, 'utf8')
    }
    return p
  })
  ipcMain.handle(IPC.themeCustomCssOpen, async () => {
    const p = customCssPath()
    try {
      await fs.access(p)
    } catch {
      await fs.writeFile(p, CUSTOM_CSS_TEMPLATE, 'utf8')
    }
    return shell.openPath(p)
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

  // —— 回收站 ——
  ipcMain.handle(IPC.trashList, () => listTrash())

  ipcMain.handle(IPC.trashRestore, async (_e, sel: TrashSelection) =>
    restoreItems(sel, (albumId) => pushChanged(albumId)),
  )

  ipcMain.handle(IPC.trashPurge, async (_e, sel: TrashSelection) =>
    purgeItems(sel, (albumId) => pushChanged(albumId)),
  )

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
    await generateThumbsForAlbum(album.id, album.name, {
        progress: pushProgress,
        ready: (items) => pushThumbsReady(album.id, items),
      })
    pushChanged(album.id)
    return { album: getAlbumRow(album.id)!, ...counters }
  })

  // 系统主题变化 → 推送渲染层
  nativeTheme.on('updated', () => notifyThemeState())

  // 自定义样式文件变化 → 推送渲染层热更新
  watchCustomCss()
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
  const folderName = dedupeFolderName(album.path, safeName, (n) => !!getAnyTripIdByFolder(album.id, n))
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

/** 后台扫描的 fire-and-forget 调用统一走这里：失败记日志，不升级成未捕获拒绝（Node ≥15 默认会崩进程） */
export function fullRescanInBackground(albumId: string): void {
  void fullRescan(albumId).catch((err) => {
    console.error('[scan] 后台扫描失败:', (err as Error)?.message ?? err)
  })
}

/** 注册目录为相册并启动后台扫描（E2E 钩子复用） */
export async function registerAlbumAt(rootPath: string, quiet = false): Promise<Album | null> {
  const existing = getAlbumRowByPath(rootPath)
  if (existing) {
    if (!quiet) fullRescanInBackground(existing.id)
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
  fullRescanInBackground(album.id)
  return album
}

/** 相册根目录的平铺媒体文件全量清单（stat 逐个校验，竞态消失的静默跳过） */
async function listFlatMediaFiles(rootPath: string): Promise<string[]> {
  let entries: string[]
  try {
    entries = await fs.readdir(rootPath)
  } catch {
    return []
  }
  const facts: { name: string; isDirectory: boolean }[] = []
  for (const name of entries) {
    try {
      const st = await fs.stat(join(rootPath, name))
      facts.push({ name, isDirectory: st.isDirectory() })
    } catch {
      // 竞态：条目刚好消失
    }
  }
  return splitFlatMediaFiles(facts, (n) => mediaTypeOf(n) !== null)
}

/** 只读预检：根目录平铺媒体数量与样例（注册前确认弹窗 / E2E 断言用） */
export async function probeFlatMediaAt(rootPath: string): Promise<FlatMediaProbe> {
  const files = await listFlatMediaFiles(rootPath)
  return { path: rootPath, fileCount: files.length, sample: files.slice(0, 5) }
}

/** 默认旅行名（确认弹窗的初始值，用户可改） */
const DEFAULT_FLAT_TRIP_NAME = '未整理的照片'

/**
 * 确认后的平铺归档（#2）：建默认旅行目录 → 把根目录平铺媒体 rename 进去 → 注册相册并扫描。
 * 磁盘先行、落库在后：任何一步失败都把已移动文件搬回根部并清掉空目录，不留半成品；
 * 用户拒绝则本函数根本不会被调用（相册零落库）。
 */
export async function adoptFlatMediaAt(rootPath: string, rawName: string): Promise<Album> {
  if (getAlbumRowByPath(rootPath)) throw new Error('该目录已注册为相册')
  const files = await listFlatMediaFiles(rootPath)
  if (files.length === 0) throw new Error('没有检测到相册根目录下的平铺照片')

  const title = rawName.trim() || DEFAULT_FLAT_TRIP_NAME
  // 目录名避让只看磁盘：此刻相册尚未注册，库内无该相册旅行
  const folderName = dedupeFolderName(rootPath, sanitizeFileName(title), () => false)
  const destDir = join(rootPath, folderName)
  await fs.mkdir(destDir, { recursive: true })

  // 同目录内 rename（原子）；逐个落地，失败即整体回滚
  const moved: { from: string; to: string }[] = []
  try {
    for (const name of files) {
      const destName = collisionSafeDestName(name, (n) => existsSync(join(destDir, n)))
      const from = join(rootPath, name)
      const to = join(destDir, destName)
      await fs.rename(from, to)
      moved.push({ from: to, to: from })
    }
  } catch (err) {
    const stuck = await rollbackMoves(moved, destDir)
    if (stuck.length > 0) {
      throw new Error(
        `归档失败（${(err as Error).message}），${stuck.length} 个文件未能搬回，仍留在「${folderName}」文件夹中，请手动处理`,
      )
    }
    throw new Error(`归档失败，已恢复原状：${(err as Error).message}`)
  }

  const album: Album = {
    id: nanoid(12),
    name: basename(rootPath),
    path: rootPath,
    status: 'ok',
    createdAt: Date.now(),
  }
  try {
    insertAlbumRow(album)
    insertTripRow({
      id: nanoid(12),
      albumId: album.id,
      folderName,
      title,
      description: '由相册根目录的平铺照片自动归档创建。',
      startDate: '',
      endDate: '',
      isFavorite: false,
    })
  } catch (err) {
    // 库失败同样回滚磁盘，保持「要么全成、要么全无」
    const stuck = await rollbackMoves(moved, destDir)
    removeAlbumRow(album.id)
    if (stuck.length > 0) {
      throw new Error(
        `归档后入库失败（${(err as Error).message}），${stuck.length} 个文件未能搬回，仍留在「${folderName}」文件夹中`,
      )
    }
    throw new Error(`归档后入库失败，已恢复原状：${(err as Error).message}`)
  }

  fullRescanInBackground(album.id)
  return album
}

/** 把已移动文件搬回原位，尽量清掉空的目的目录；返回没能搬回的文件名 */
async function rollbackMoves(moved: { from: string; to: string }[], destDir: string): Promise<string[]> {
  const stuck: string[] = []
  for (const m of moved.reverse()) {
    try {
      await fs.rename(m.from, m.to)
    } catch {
      stuck.push(basename(m.from))
    }
  }
  try {
    await fs.rmdir(destDir)
  } catch {
    // 目录非空（回滚残留）或已消失，交由上层文案说明
  }
  return stuck
}

function sanitizeFileName(name: string): string {
  const cleaned = (name || 'untitled').replace(/[/\\:*?"<>|]/g, '_').trim()
  return cleaned || 'untitled'
}

function dedupeFolderName(root: string, base: string, takenInDb: (name: string) => boolean): string {
  let name = base
  let i = 2
  // 磁盘与记录两个维度都要避让：缺失旅行的 folder_name 仍在库里（partial unique 只豁免回收站行）
  while (existsSync(join(root, name)) || takenInDb(name)) {
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

// —— 自定义样式（userData/theme.css） ——

function customCssPath(): string {
  return join(app.getPath('userData'), 'theme.css')
}

const CUSTOM_CSS_TEMPLATE = `/* 画廊自定义样式 —— 保存后立即热更新，无需重启。
 *
 * 用语义 token 覆盖任意颜色；可用选择器：
 *   :root                                       所有主题
 *   [data-palette='default' | 'candle' | 'yuebai' | 'dailan' | 'qingci']   指定主题
 *   [data-mode='light' | 'dark']                指定明暗
 *   [data-palette='candle'][data-mode='dark']   主题 × 明暗 组合
 *
 * 全部语义 token 见 docs/theme.md §4。示例（去掉注释即生效）：
 *
 * :root {
 *   --primary: #5a7d9a;
 *   --primary-soft: #e3ecf4;
 *   --primary-ink: #ffffff;
 * }
 *
 * [data-mode='dark'] {
 *   --background: #14181c;
 *   --viewer: #101418;
 * }
 */
`

/** 监听 userData 目录，theme.css 变化（创建/修改/删除）即推送全文（300ms 防抖） */
function watchCustomCss(): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  try {
    fsWatch(app.getPath('userData'), (_event, filename) => {
      if (filename && filename !== 'theme.css') return
      if (timer) clearTimeout(timer)
      timer = setTimeout(async () => {
        let css: string | null = null
        try {
          css = await fs.readFile(customCssPath(), 'utf8')
        } catch {
          css = null
        }
        senderWindow()?.webContents.send(IPC.pushThemeCustomCssChanged, css)
      }, 300)
    })
  } catch {
    // userData 不可监听时静默降级：自定义样式在下次启动生效
  }
}
