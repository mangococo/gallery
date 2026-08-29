import { watch, type FSWatcher } from 'chokidar'
import { getAlbumRow } from '../db'
import { scanAlbum } from './scanner'
import { generateThumbsForAlbum } from './thumbnails'
import type { ScanProgress } from '../../shared/types'

let watcher: FSWatcher | null = null
let watchedAlbumId: string | null = null
let debounceTimer: NodeJS.Timeout | null = null
let scanning = false
let rescanQueued = false

export interface WatchHooks {
  progress(p: ScanProgress): void
  changed(albumId: string): void
}

/**
 * 监听激活相册目录：外部新增/删除/修改文件后防抖触发增量校对，
 * 完成后向渲染层推送 changed（渲染层重拉数据）。
 */
export async function watchAlbum(albumId: string, hooks: WatchHooks): Promise<void> {
  if (watchedAlbumId === albumId && watcher) return
  await closeWatcher()
  const album = getAlbumRow(albumId)
  if (!album) return

  watchedAlbumId = albumId
  watcher = watch(album.path, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 150 },
  })

  watcher.on('all', (_event, path) => {
    // 忽略隐藏文件（.DS_Store 等）
    const base = path.split('/').pop() ?? ''
    if (base.startsWith('.')) return
    scheduleRescan(albumId, hooks)
  })
}

function scheduleRescan(albumId: string, hooks: WatchHooks): void {
  if (debounceTimer) clearTimeout(debounceTimer)
  debounceTimer = setTimeout(() => {
    void rescanNow(albumId, hooks)
  }, 1500)
}

async function rescanNow(albumId: string, hooks: WatchHooks): Promise<void> {
  if (scanning) {
    rescanQueued = true
    return
  }
  scanning = true
  try {
    do {
      rescanQueued = false
      const counters = await scanAlbum(albumId, {
        progress: hooks.progress,
        finished: () => {},
      })
      if (counters) {
        await generateThumbsForAlbum(albumId, getAlbumRow(albumId)?.name ?? '', {
          progress: hooks.progress,
        })
        hooks.changed(albumId)
      }
    } while (rescanQueued)
  } finally {
    scanning = false
  }
}

export async function closeWatcher(): Promise<void> {
  if (debounceTimer) {
    clearTimeout(debounceTimer)
    debounceTimer = null
  }
  if (watcher) {
    const w = watcher
    watcher = null
    watchedAlbumId = null
    try {
      await w.close()
    } catch {
      // 关闭失败忽略
    }
  }
}

export function getWatchedAlbumId(): string | null {
  return watchedAlbumId
}
