import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import sharp from 'sharp'
import type { PhotoDTO, ScanProgress } from '../../shared/types'
import { getAlbumPath, listPendingThumbPhotos, markThumbResults } from '../db'
import { decodeHeicRaw, isHeicFamily, isHeifFile } from './heic'
import {
  splitThumbJobs,
  resolveImageConcurrency,
  VIDEO_CONCURRENCY,
  type ThumbReadyItem,
} from './thumb-plan'

export { splitThumbJobs, resolveImageConcurrency } from './thumb-plan'
export type { ThumbReadyItem } from './thumb-plan'

/** 缩略图规格：约 400px webp */
const THUMB_SIZE = 400

const thumbDir = (): string => join(app.getPath('userData'), 'thumbnails')

function thumbPath(photoId: string): string {
  return join(thumbDir(), `${photoId}.webp`)
}

// —— 队列状态 ——
interface QueueState {
  cancelled: boolean
}
const queues = new Map<string, QueueState>()
/** 同相册进行中的生成任务（并发调用合并为一次，防止两个队列对同一批照片重复生成） */
const inflight = new Map<string, Promise<void>>()
let progressWindow: BrowserWindow | null = null

export interface ThumbHooks {
  progress(p: ScanProgress): void
  /** 批量就绪推送：渲染层按 id 增量点亮卡片（照片墙不整页刷新、不回退原图） */
  ready?(items: ThumbReadyItem[]): void
}

const thumbUrlOf = (photoId: string): string => `gallery-media://t/${photoId}.webp`

/**
 * 为相册中所有 pending 照片生成缩略图（图片/视频双池并行，向渲染层推送进度）。
 * 幂等：重复调用会跳过已就绪的；同相册并发调用合并，并在结束后补扫本轮新增的 pending
 * （此前队列运行期间的导入要等下一次全量触发才出缩略图）。
 * 应用中途退出只留下 pending 行，下次启动 bootstrap → fullRescan 会重新入队续跑。
 */
export function generateThumbsForAlbum(
  albumId: string,
  albumName: string,
  hooks: ThumbHooks,
): Promise<void> {
  const running = inflight.get(albumId)
  if (running) return running
  const p = runThumbQueue(albumId, albumName, hooks).finally(() => inflight.delete(albumId))
  inflight.set(albumId, p)
  return p
}

/** 双池中的一种生成器：成功返回就绪描述符，文件缺失/失败返回 null（由批缓冲落 failed） */
type ItemGenerator = (photo: PhotoDTO & { albumId: string }, albumRoot: string) => Promise<ThumbReadyItem | null>

async function runThumbQueue(albumId: string, albumName: string, hooks: ThumbHooks): Promise<void> {
  await fs.mkdir(thumbDir(), { recursive: true })

  const q: QueueState = { cancelled: false }
  queues.set(albumId, q)

  const imageConcurrency = resolveImageConcurrency()

  // 扫描/导入可能在本轮生成期间又标记了新的 pending：收敛循环补扫（上限防意外死循环）
  for (let round = 0; round < 5 && !q.cancelled; round++) {
    const pending = listPendingThumbPhotos(albumId)
    const total = pending.length
    if (total === 0) return
    const albumRoot = getAlbumPath(albumId)
    if (!albumRoot) return // 相册行已不存在，等下一次触发

    let done = 0
    let lastPush = 0
    const pushProgress = (): void => {
      const now = Date.now()
      if (now - lastPush > 150 || done >= total) {
        lastPush = now
        hooks.progress({ albumId, albumName, phase: 'thumb', done, total })
      }
    }
    pushProgress()

    // 就绪/失败批量缓冲：DB 事务批写与 IPC 推送同节奏（300ms 或 40 张），
    // 替代此前每张两条同步 UPDATE——大批量时减少 sqlite 写放大
    let readyBuf: ThumbReadyItem[] = []
    let failedBuf: string[] = []
    let lastFlush = 0
    const flush = (force = false): void => {
      if (readyBuf.length === 0 && failedBuf.length === 0) return
      const now = Date.now()
      if (!force && now - lastFlush < 300 && readyBuf.length < 40) return
      markThumbResults(
        readyBuf.map((r) => ({ id: r.id, width: r.width ?? 0, height: r.height ?? 0 })),
        failedBuf,
      )
      if (hooks.ready && readyBuf.length > 0) hooks.ready(readyBuf)
      readyBuf = []
      failedBuf = []
      lastFlush = now
    }

    const { images, videos } = splitThumbJobs(pending)

    const runPool = async (items: (PhotoDTO & { albumId: string })[], concurrency: number, gen: ItemGenerator): Promise<void> => {
      let i = 0
      const worker = async (): Promise<void> => {
        while (i < items.length && !q.cancelled) {
          const item = items[i++]
          try {
            const r = await gen(item, albumRoot)
            if (r) readyBuf.push(r)
            else failedBuf.push(item.id)
          } catch {
            failedBuf.push(item.id)
          }
          flush()
          done++
          pushProgress()
        }
      }
      await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker))
    }

    // 图片池（sharp，按核数）与视频池（隐藏页截帧，低并发）同时推进，互不占用
    await Promise.all([
      runPool(images, imageConcurrency, generateImageThumb),
      runPool(videos, VIDEO_CONCURRENCY, generateVideoThumb),
    ])
    flush(true)
    hooks.progress({ albumId, albumName, phase: 'thumb', done, total })
  }
}

export function cancelThumbsForAlbum(albumId: string): void {
  const q = queues.get(albumId)
  if (q) q.cancelled = true
}

/** 图片缩略图：sharp resize → webp；HEIC 走 WASM 解码回退管线。文件缺失返回 null（批落 failed） */
const generateImageThumb: ItemGenerator = async (photo, albumRoot) => {
  const abs = join(albumRoot, photo.relPath)
  try {
    await fs.access(abs)
  } catch {
    return null
  }

  let out: { width: number; height: number }
  try {
    try {
      out = await sharp(abs)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(thumbPath(photo.id))
    } catch (err) {
      // sharp 的 libheif 无 HEVC 解码插件（实测）：HEIC 回退 WASM 解码后重走管线。
      // 判定以内容嗅探为准、扩展名为辅——微信转存常见「HEIC 内容 + .jpg 扩展名」
      const heif = isHeicFamily(photo.fileName) || (await isHeifFile(abs))
      if (!heif) throw err
      const raw = await decodeHeicRaw(abs)
      if (!raw) throw err
      out = await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(thumbPath(photo.id))
    }
  } catch (err) {
    console.warn(`[thumb] 图片缩略图失败 ${photo.fileName}:`, err instanceof Error ? err.message : err)
    return null
  }
  return { id: photo.id, thumbUrl: thumbUrlOf(photo.id), width: out.width, height: out.height }
}

/** 视频缩略图：隐藏渲染页截帧；失败落暖棕占位图（同样是「就绪」，避免永久 pending） */
const generateVideoThumb: ItemGenerator = async (photo, albumRoot) => {
  const abs = join(albumRoot, photo.relPath)
  try {
    await fs.access(abs)
  } catch {
    return null
  }

  let buffer: Buffer
  let width = 400
  let height = 300
  const frame = await captureVideoFrame(`gallery-media://m/${photo.albumId}/${encodeURIComponent(photo.relPath)}`)
  try {
    if (frame) {
      const pipeline = sharp(frame).resize(THUMB_SIZE, THUMB_SIZE, {
        fit: 'inside',
        withoutEnlargement: true,
      })
      const meta = await pipeline.metadata()
      width = meta.width ?? width
      height = meta.height ?? height
      buffer = await pipeline.webp({ quality: 82 }).toBuffer()
    } else {
      buffer = await placeholderThumb()
    }
    await fs.writeFile(thumbPath(photo.id), buffer)
  } catch {
    return null
  }
  return { id: photo.id, thumbUrl: thumbUrlOf(photo.id), width, height }
}

/** 占位缩略图：暖棕渐变底 + 播放三角 */
async function placeholderThumb(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3A2F24"/><stop offset="1" stop-color="#26211D"/>
    </linearGradient></defs>
    <rect width="400" height="300" fill="url(#g)"/>
    <circle cx="200" cy="150" r="42" fill="rgba(212,165,116,0.25)"/>
    <path d="M 188 128 L 188 172 L 226 150 Z" fill="#D4A574"/>
  </svg>`
  return sharp(Buffer.from(svg)).webp({ quality: 82 }).toBuffer()
}

/**
 * 用隐藏渲染页给视频截一帧（JPEG dataURL）。
 * gallery-media:// 已注册为特权 stream 协议，任意页面可加载。
 */
async function captureVideoFrame(mediaUrl: string): Promise<Buffer | null> {
  const win = await ensureProgressWindow()
  if (!win) return null
  try {
    const result = (await win.webContents.executeJavaScript(
      `
      new Promise((resolve) => {
        const v = document.createElement('video')
        v.muted = true
        v.preload = 'auto'
        v.crossOrigin = 'anonymous'
        let settled = false
        const logs = []
        const done = (val) => { if (!settled) { settled = true; resolve({ val, logs }) } }
        v.onloadstart = () => logs.push('loadstart')
        v.onloadedmetadata = () => { logs.push('loadedmetadata:' + v.duration); try { v.currentTime = Math.min(1, (v.duration || 2) / 3) } catch (e) { logs.push('seekthrow:' + e.message) } }
        v.onloadeddata = () => logs.push('loadeddata')
        v.onseeked = () => {
          logs.push('seeked')
          try {
            const c = document.createElement('canvas')
            c.width = v.videoWidth
            c.height = v.videoHeight
            c.getContext('2d').drawImage(v, 0, 0)
            done(c.toDataURL('image/jpeg', 0.85))
          } catch (e) { logs.push('draw:' + e.message); done(null) }
        }
        v.onerror = () => { logs.push('error:' + (v.error ? v.error.code + '/' + v.error.message : 'unknown')); done(null) }
        setTimeout(() => { logs.push('timeout'); done(null) }, 15000)
        v.src = ${JSON.stringify(mediaUrl)}
      })
      `,
      true,
    )) as { val: string | null; logs: string[] } | null

    // 成功路径不刷日志；失败（含超时）保留诊断信息，视频海报问题只能靠它排查
    if (!result?.val) {
      console.warn(`[thumb] 视频截帧失败 ${mediaUrl.slice(-40)}:`, result?.logs?.join(',') ?? 'executeJavaScript 返回空')
    }
    const dataUrl = result?.val
    if (!dataUrl || !dataUrl.startsWith('data:image/jpeg;base64,')) return null
    return Buffer.from(dataUrl.slice('data:image/jpeg;base64,'.length), 'base64')
  } catch (err) {
    console.error('[thumb] 视频截帧异常:', err)
    return null
  }
}

async function ensureProgressWindow(): Promise<BrowserWindow | null> {
  if (progressWindow && !progressWindow.isDestroyed()) return progressWindow
  try {
    progressWindow = new BrowserWindow({
      show: false,
      width: 640,
      height: 360,
      webPreferences: {
        // 只跑系统注入的最小页面，不加载任何应用代码
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    })
    await progressWindow.loadURL('about:blank')
    return progressWindow
  } catch {
    return null
  }
}

export function disposeThumbResources(): void {
  for (const q of queues.values()) q.cancelled = true
  queues.clear()
  if (progressWindow && !progressWindow.isDestroyed()) progressWindow.destroy()
  progressWindow = null
}
