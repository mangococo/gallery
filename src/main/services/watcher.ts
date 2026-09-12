import { watch, type FSWatcher } from 'chokidar'
import { getAlbumRow } from '../db'
import { scanAlbum } from './scanner'
import { generateThumbsForAlbum, type ThumbReadyItem } from './thumbnails'
import type { ScanProgress } from '../../shared/types'

let watcher: FSWatcher | null = null
let watchedAlbumId: string | null = null
let debounceTimer: NodeJS.Timeout | null = null
let scanning = false
let rescanQueued = false
/** watchAlbum 并发守卫：快速连续切换相册时，过期的附加请求直接放弃 */
let watchSeq = 0

export interface WatchHooks {
  progress(p: ScanProgress): void
  changed(albumId: string): void
  /** 缩略图批量就绪（透传给渲染层增量点亮，见 ipc.ts pushThumbsReady） */
  thumbsReady?(items: ThumbReadyItem[]): void
}

/** 事件路径是否落在相册内的隐藏文件/隐藏目录里（.DS_Store、编辑器临时目录等，扫描本来就会跳过）。
 * 只检查相册内的相对部分——相册根自身允许位于点开头的目录（如 ~/.gallery-demo）。 */
function isHiddenPath(albumPath: string, path: string): boolean {
  const rel = path.startsWith(albumPath) ? path.slice(albumPath.length) : path
  return rel.split(/[\\/]/).some((seg) => seg.startsWith('.'))
}

/**
 * 监听激活相册目录：外部新增/删除/修改文件后防抖触发增量校对，
 * 完成后向渲染层推送 changed（渲染层重拉数据）。
 */
export async function watchAlbum(albumId: string, hooks: WatchHooks): Promise<void> {
  if (watchedAlbumId === albumId && watcher) return
  const seq = ++watchSeq
  await closeWatcher()
  if (seq !== watchSeq) return // 已有更新的切换请求，本请求过期
  const album = getAlbumRow(albumId)
  if (!album) return

  watchedAlbumId = albumId
  watcher = watch(album.path, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: { stabilityThreshold: 700, pollInterval: 150 },
  })

  watcher.on('all', (event, path) => {
    if (isHiddenPath(album.path, path)) return
    scheduleRescan(albumId, hooks)
  })
  // 外置卷拔出等场景 chokidar 会 emit error；不监听会以未捕获异常打断主进程
  watcher.on('error', (err: unknown) => {
    console.error('[watcher] 监听异常:', (err as Error)?.message ?? err)
  })
  console.log('[watcher] 已附加监听:', album.path)
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
          ready: hooks.thumbsReady,
        })
        hooks.changed(albumId)
      }
    } while (rescanQueued)
  } catch (err) {
    // 增量校对失败不能打断主进程（setTimeout 里的 rejection 会以未捕获异常升级成崩溃），
    // 记录后等下一次文件事件再试
    console.error('[watcher] 增量校对失败:', (err as Error)?.message ?? err)
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
