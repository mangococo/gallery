import { app, protocol } from 'electron'
import { join, normalize, sep } from 'path'
import { createReadStream, promises as fs } from 'fs'
import { Readable } from 'stream'
import { convertHeicForDisplay, isHeicFamily } from './services/heic'

export const MEDIA_SCHEME = 'gallery-media'

// 图片/视频的 MIME 映射（扩展名大小写不敏感）
const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  heic: 'image/heic',
  tiff: 'image/tiff',
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska',
}

function mimeOf(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** 在 app.ready 之前调用：注册特权 scheme（stream 支持视频拖进度条） */
export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
          standard: true,
          stream: true,
          supportFetchAPI: true,
          corsEnabled: true,
          bypassCSP: true,
        },
    },
  ])
}

export interface MediaProtocolOptions {
  /** 由数据层注入：返回相册根目录绝对路径；相册不存在时返回 null */
  resolveAlbumRoot(albumId: string): Promise<string | null>
  /** 缩略图缓存目录（userData/thumbnails） */
  thumbsDir(): string
}

/**
 * 挂载 gallery-media:// 处理器。URL 形态：
 *   gallery-media://m/{albumId}/{encodeURIComponent(相对路径)}   相册内媒体文件
 *   gallery-media://t/{photoId}.webp                            缩略图缓存
 * 渲染层拿不到真实磁盘路径；此处做路径越界校验并支持 Range 请求。
 */
export function attachMediaProtocol(opts: MediaProtocolOptions): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    try {
      const url = new URL(request.url)
      if (url.host === 't') return await serveThumb(url, opts.thumbsDir())
      if (url.host === 'm') return await serveMedia(request, url, opts)
      return json(404, { error: 'unknown host' })
    } catch (err: any) {
      if (err?.code === 'ENOENT') return json(404, { error: 'not found' })
      console.error('[gallery-media] 处理失败:', request.url, err)
      return json(500, { error: String(err?.message ?? err) })
    }
  })
}

const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': '*',
  'access-control-expose-headers': 'content-length, content-range, content-type, accept-ranges',
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...CORS_HEADERS },
  })
}

async function serveThumb(url: URL, thumbsDir: string): Promise<Response> {
  const name = decodeURIComponent(url.pathname.replace(/^\//, ''))
  // 只允许纯文件名，杜绝目录穿越
  if (!/^[\w.-]+$/.test(name)) return json(400, { error: 'bad thumb name' })
  const abs = join(thumbsDir, name)
  const stat = await fs.stat(abs)
  const stream = createReadStream(abs)
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'content-type': mimeOf(name),
      'content-length': String(stat.size),
      'cache-control': 'max-age=3600',
      ...CORS_HEADERS,
    },
  })
}

async function serveMedia(
  request: Request,
  url: URL,
  opts: MediaProtocolOptions,
): Promise<Response> {
  const albumId = decodeURIComponent(url.pathname.split('/').filter(Boolean)[0] ?? '')
  const relPath = decodeURIComponent(url.pathname.split('/').slice(2).join('/'))
  if (!albumId || !relPath) return json(400, { error: 'bad media url' })

  const root = await opts.resolveAlbumRoot(albumId)
  if (!root) return json(404, { error: 'album not found' })

  const abs = normalize(join(root, relPath))
  const rootWithSep = normalize(root).endsWith(sep) ? normalize(root) : normalize(root) + sep
  if (!abs.startsWith(rootWithSep)) return json(403, { error: 'path escapes album' })

  const stat = await fs.stat(abs)
  if (!stat.isFile()) return json(404, { error: 'not a file' })

  // HEIC：Chromium 无法解码，协议层换成 JPEG 展示缓存（带 Range 的视频路径不走这里）
  if (isHeicFamily(abs)) {
    const converted = await convertHeicForDisplay(abs, relPath, stat.mtimeMs, stat.size)
    if (converted) {
      const cstat = await fs.stat(converted)
      const stream = createReadStream(converted)
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 200,
        headers: {
          'content-type': 'image/jpeg',
          'content-length': String(cstat.size),
          'cache-control': 'max-age=3600',
          ...CORS_HEADERS,
        },
      })
    }
    // 转换失败：继续按原文件回退（浏览器显示失败即降级占位，不 500）
  }

  const contentType = mimeOf(abs)
  const range = request.headers.get('range')

  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      const start = m[1] ? parseInt(m[1], 10) : 0
      const end = m[2] ? Math.min(parseInt(m[2], 10), stat.size - 1) : stat.size - 1
      if (start > end || start >= stat.size) {
        return new Response(null, {
          status: 416,
          headers: { 'content-range': `bytes */${stat.size}` },
        })
      }
      const stream = createReadStream(abs, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'content-type': contentType,
          'content-length': String(end - start + 1),
          'content-range': `bytes ${start}-${end}/${stat.size}`,
          'accept-ranges': 'bytes',
          ...CORS_HEADERS,
        },
      })
    }
  }

  const stream = createReadStream(abs)
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    status: 200,
    headers: {
      'content-type': contentType,
      'content-length': String(stat.size),
      'accept-ranges': 'bytes',
      'cache-control': 'no-cache',
      ...CORS_HEADERS,
    },
  })
}

/** 缩略图缓存目录（惰性创建） */
export function thumbsDirPath(): string {
  return join(app.getPath('userData'), 'thumbnails')
}

export async function ensureThumbsDir(): Promise<string> {
  const dir = thumbsDirPath()
  await fs.mkdir(dir, { recursive: true })
  return dir
}
