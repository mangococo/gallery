import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import sharp from 'sharp'
import type { ScanProgress } from '../../shared/types'
import {
  getAlbumPath,
  getPhotoRow,
  listPendingThumbPhotos,
  setPhotoDimensions,
  setPhotoThumbStatus,
} from '../db'

/** 缩略图规格：约 400px webp */
const THUMB_SIZE = 400
const CONCURRENCY = 3

const thumbDir = (): string => join(app.getPath('userData'), 'thumbnails')

function thumbPath(photoId: string): string {
  return join(thumbDir(), `${photoId}.webp`)
}

// —— 队列状态 ——
interface QueueJob {
  photoId: string
  albumId: string
}
const queues = new Map<string, { jobs: QueueJob[]; running: number; cancelled: boolean }>()
let progressWindow: BrowserWindow | null = null

export interface ThumbHooks {
  progress(p: ScanProgress): void
}

/**
 * 为相册中所有 pending 照片生成缩略图（并发队列，向渲染层推送进度）。
 * 幂等：重复调用会跳过已就绪的。
 */
export async function generateThumbsForAlbum(
  albumId: string,
  albumName: string,
  hooks: ThumbHooks,
): Promise<void> {
  await fs.mkdir(thumbDir(), { recursive: true })

  // 已有同相册队列在跑则不重复
  let q = queues.get(albumId)
  if (q && q.running > 0) return
  q = { jobs: [], running: 0, cancelled: false }
  queues.set(albumId, q)

  const pending = listPendingThumbPhotos(albumId)
  const total = pending.length
  if (total === 0) return

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

  await fs.mkdir(thumbDir(), { recursive: true })
  q.jobs = pending.map((p) => ({ photoId: p.id, albumId }))

  const worker = async (): Promise<void> => {
    while (q!.jobs.length > 0 && !q!.cancelled) {
      const job = q!.jobs.shift()!
      try {
        await generateOne(job.photoId)
      } catch {
        // 单张失败不影响整体
      }
      done++
      pushProgress()
    }
  }

  q.running = CONCURRENCY
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  q.running = 0
  hooks.progress({ albumId, albumName, phase: 'thumb', done, total })
}

export function cancelThumbsForAlbum(albumId: string): void {
  const q = queues.get(albumId)
  if (q) q.cancelled = true
}

/** 单张缩略图：图片走 sharp；视频走隐藏渲染页截帧，失败落占位图 */
async function generateOne(photoId: string): Promise<void> {
  const photo = getPhotoRow(photoId)
  if (!photo) return
  const root = getAlbumPath(photo.albumId)
  if (!root) return
  const abs = join(root, photo.relPath)

  try {
    await fs.access(abs)
  } catch {
    // 文件已不在：标记失败，等待增量校对清理
    setPhotoThumbStatus(photoId, 'failed')
    return
  }

  try {
    if (photo.type === 'image') {
      const out = await sharp(abs)
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 82 })
        .toFile(thumbPath(photoId))
      setPhotoDimensions(photoId, out.width, out.height)
      setPhotoThumbStatus(photoId, 'ready')
    } else {
      // 视频：隐藏窗口截帧（不引入 ffmpeg）
      const frame = await captureVideoFrame(`gallery-media://m/${photo.albumId}/${encodeURIComponent(photo.relPath)}`)
      let buffer: Buffer
      let width = 400
      let height = 300
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
        // 兜底占位图（暖棕底 + ▶）
        buffer = await placeholderThumb()
      }
      await fs.writeFile(thumbPath(photoId), buffer)
      setPhotoDimensions(photoId, width, height)
      setPhotoThumbStatus(photoId, 'ready')
    }
  } catch {
    setPhotoThumbStatus(photoId, 'failed')
  }
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

    console.log(`[thumb] 视频截帧 ${mediaUrl.slice(-40)} →`, result?.logs?.join(',') ?? 'executeJavaScript 返回空')
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
