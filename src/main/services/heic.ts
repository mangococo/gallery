import { createHash } from 'crypto'
import { app } from 'electron'
import { join } from 'path'
import { promises as fs } from 'fs'
import sharp from 'sharp'
import { HEIF_SNIFF_BYTES, isHeifBuffer } from './heif-sniff'

/**
 * HEIC/HEIF 兼容层。
 * 实测结论（v0.11，macOS / sharp 0.35 预编译）：sharp 的 libheif 能读元数据，
 * 但像素解码失败（无 HEVC 解码插件：Decoder plugin generated an error 7.0）。
 * 修复：heic-decode（libheif-js WASM，含 libde265，纯 JS 安装）解码为 RGBA
 * 后交给 sharp 走正常管线；缩略图与大图展示共用。
 */

const HEIC_EXTS = new Set(['.heic', '.heif', '.hif'])

export function isHeicFamily(fileName: string): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return false
  return HEIC_EXTS.has(fileName.slice(dot).toLowerCase())
}

/**
 * 按内容判定是否 HEIF 家族（读文件头 ftyp brand 嗅探）。
 * 微信等 IM 转存的图片常见「HEIC 内容 + .jpg 扩展名」，扩展名判断会漏网；
 * 与 isHeicFamily 任一命中即应走 WASM 解码回退。
 */
export async function isHeifFile(absPath: string): Promise<boolean> {
  try {
    const fh = await fs.open(absPath, 'r')
    try {
      const head = Buffer.alloc(HEIF_SNIFF_BYTES)
      const { bytesRead } = await fh.read(head, 0, HEIF_SNIFF_BYTES, 0)
      return isHeifBuffer(head.subarray(0, bytesRead))
    } finally {
      await fh.close()
    }
  } catch {
    return false
  }
}

interface HeicRaw {
  data: Buffer
  width: number
  height: number
}

async function lazyDecoder(): Promise<(opts: { buffer: Buffer }) => Promise<HeicRaw>> {
  // 依赖 externalize：运行时从 node_modules 加载（打包时随 asarUnpack 落盘）
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('heic-decode') as (opts: { buffer: Buffer }) => Promise<HeicRaw>
  return mod
}

/** 解码 HEIC 为 RGBA 原始像素；失败返回 null（交给上层降级） */
export async function decodeHeicRaw(absPath: string): Promise<HeicRaw | null> {
  try {
    const decode = await lazyDecoder()
    const buffer = await fs.readFile(absPath)
    const decoded = await decode({ buffer })
    if (!decoded?.width || !decoded?.height) return null
    return decoded
  } catch {
    return null
  }
}

/** HEIC 大图展示缓存目录（userData/media-cache） */
function cacheDir(): string {
  return join(app.getPath('userData'), 'media-cache')
}

/**
 * HEIC → JPEG 展示缓存（渲染进程 Chromium 无法解码 HEIC，协议层换成兼容格式）。
 * 缓存键 = relPath + mtime + size，文件被替换后自动失效重转。失败返回 null。
 */
export async function convertHeicForDisplay(
  absPath: string,
  relPath: string,
  mtimeMs: number,
  size: number,
): Promise<string | null> {
  const key = createHash('md5').update(`${relPath}:${Math.round(mtimeMs)}:${size}`).digest('hex')
  const outPath = join(cacheDir(), `${key}.jpg`)
  try {
    await fs.access(outPath)
    return outPath
  } catch {
    // 未命中，继续转换
  }
  const raw = await decodeHeicRaw(absPath)
  if (!raw) return null
  try {
    await fs.mkdir(cacheDir(), { recursive: true })
    await sharp(raw.data, { raw: { width: raw.width, height: raw.height, channels: 4 } })
      .jpeg({ quality: 88 })
      .toFile(outPath)
    return outPath
  } catch {
    return null
  }
}
