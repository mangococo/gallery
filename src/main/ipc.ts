import { ipcMain, dialog, shell, nativeTheme, BrowserWindow } from 'electron'
import { promises as fs, mkdirSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { nanoid } from 'nanoid'
import { IPC } from '../shared/types'
import type {
  Album,
  CreateTripInput,
  LegacyImportResult,
  ScanProgress,
  ThemeMode,
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
  getPhotoRow,
  insertPhotoRow,
  deletePhotoRow,
  setPhotoCaption,
  listPhotosOfTrip,
  getStats,
} from './db'
import { scanAlbum } from './services/scanner'
import { generateThumbsForAlbum, cancelThumbsForAlbum } from './services/thumbnails'
import { watchAlbum, closeWatcher } from './services/watcher'
import { mediaTypeOf } from './services/scanner'

function senderWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function pushProgress(p: ScanProgress): void {
  senderWindow()?.webContents.send(IPC.pushScanProgress, p)
}

function pushChanged(albumId: string): void {
  senderWindow()?.webContents.send(IPC.pushFsChanged, { albumId })
}

/** 对相册执行完整扫描 + 缩略图生成 + watcher 更新，并通知渲染层 */
async function fullRescan(albumId: string, pushEvents = true): Promise<ScanProgress | null> {
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

export function registerIpcHandlers(): void {
  initDb()

  // —— 应用 ——
  ipcMain.handle(IPC.bootstrap, () => {
    const albums = listAlbumRows()
    return {
      theme: (getSetting('theme_mode') as ThemeMode) ?? 'system',
      systemDark: nativeTheme.shouldUseDarkColors,
      albums,
      activeAlbumId: getSetting('active_album_id'),
    }
  })
  ipcMain.handle(IPC.stats, () => getStats())

  // —— 相册 ——
  ipcMain.handle(IPC.albumsList, () => listAlbumRows())

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
      .then((ok) => {
        if (!ok) {
          setAlbumStatus(albumId, 'missing')
          return []
        }
        if (album.status !== 'ok') setAlbumStatus(albumId, 'ok')
        return listTripRows(albumId).map((t) => ({
          ...t,
          tags: getTagsOfTrip(t.id),
          photos: [],
        }))
      })
  })

  ipcMain.handle(IPC.tripsGet, (_e, id: string) => {
    const t = getTripRow(id)
    if (!t) return null
    return { ...t, tags: getTagsOfTrip(id), photos: photosOfTrip(t) }
  })

  ipcMain.handle(IPC.tripsCreate, (_e, input: CreateTripInput) => {
    const albumId = getSetting('active_album_id')
    const album = albumId ? getAlbumRow(albumId) : null
    if (!album) throw new Error('请先注册并激活一个相册目录')

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
    const row = getTripRow(t.id)!
    return { ...row, tags: getTagsOfTrip(t.id), photos: [] }
  })

  ipcMain.handle(IPC.tripsUpdate, (_e, id: string, patch: TripPatch) => {
    const tags = patch.tags
    updateTripRow(id, patch)
    if (tags !== undefined) setTagsOfTrip(id, tags)
    const t = getTripRow(id)
    if (!t) throw new Error('旅行不存在')
    return { ...t, tags: getTagsOfTrip(id), photos: photosOfTrip(t) }
  })

  ipcMain.handle(IPC.tripsDelete, async (_e, id: string) => {
    const t = getTripRow(id)
    if (!t) return
    const album = getAlbumRow(t.albumId)
    if (album) {
      const dir = join(album.path, t.folderName)
      // 一律进废纸篓，不直接删除
      await shell.trashItem(dir).catch((err) => {
        throw new Error('移入废纸篓失败: ' + err.message)
      })
    }
    deleteTripRow(id)
    pushChanged(t.albumId)
  })

  // —— 照片 ——
  ipcMain.handle(IPC.photosImport, async (_e, tripId: string, paths: string[]) => {
    const t = getTripRow(tripId)
    if (!t) throw new Error('旅行不存在')
    const album = getAlbumRow(t.albumId)
    if (!album) throw new Error('相册不存在')
    const destDir = join(album.path, t.folderName)

    const imported = []
    for (const src of paths) {
      const type = mediaTypeOf(basename(src))
      if (!type) continue
      let name = basename(src)
      // 重名文件加时间戳前缀
      try {
        await fs.access(join(destDir, name))
        name = `${Date.now()}_${name}`
      } catch {
        // 不重名，直接用
      }
      await fs.copyFile(src, join(destDir, name))
      const st = await fs.stat(join(destDir, name))
      insertPhotoRow({
        id: nanoid(12),
        tripId,
        fileName: name,
        relPath: `${t.folderName}/${name}`,
        type,
        caption: '',
        takenAt: Math.round(st.mtimeMs),
      })
      imported.push(name)
    }

    // 后台补缩略图并通知
    void (async () => {
      await generateThumbsForAlbum(album.id, album.name, { progress: pushProgress })
      pushChanged(album.id)
    })()

    const row = getTripRow(tripId)!
    return photosOfTrip(row)
  })

  ipcMain.handle(IPC.photosDelete, async (_e, photoId: string) => {
    const photo = getPhotoRow(photoId)
    if (!photo) return
    const root = getAlbumRow(photo.albumId)
    if (root) {
      await shell.trashItem(join(root.path, photo.relPath)).catch((err) => {
        throw new Error('移入废纸篓失败: ' + err.message)
      })
    }
    deletePhotoRow(photoId)
    pushChanged(photo.albumId)
  })

  ipcMain.handle(IPC.photosSetCaption, (_e, photoId: string, caption: string) => {
    setPhotoCaption(photoId, caption)
  })

  ipcMain.handle(IPC.photosSetCover, (_e, tripId: string, photoId: string) => {
    updateTripRow(tripId, { coverPhotoId: photoId })
  })

  // —— 主题 ——
  ipcMain.handle(IPC.themeGet, () => (getSetting('theme_mode') as ThemeMode) ?? 'system')
  ipcMain.handle(IPC.themeSet, (_e, mode: ThemeMode) => {
    setSetting('theme_mode', mode)
    nativeTheme.themeSource = mode
    notifyThemeState()
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
