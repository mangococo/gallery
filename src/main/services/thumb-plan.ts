/**
 * 缩略图队列的纯决策层：不依赖 db / electron / sharp，可单元测试。
 * thumbnails.ts 只做 IO 与队列调度，这里回答「任务怎么分池 / 并行度多少」。
 */

import { cpus } from 'os'

/** 缩略图就绪描述符（DB 批写与渲染层推送共用） */
export interface ThumbReadyItem {
  id: string
  thumbUrl: string
  width: number | null
  height: number | null
}

/**
 * 图片并发：sharp/libvips 自带线程池，worker 只做调度与 IO；
 * 按核数自适应（留 1 核给系统），默认夹在 [3, 8] 防内存/IO 峰值失控。
 * GALLERY_THUMB_IMAGE_CONCURRENCY 显式覆盖（夹在 [1, 16]）。
 */
export function resolveImageConcurrency(
  env: NodeJS.ProcessEnv = process.env,
  cpuCount = cpus().length,
): number {
  const raw = Number.parseInt(env.GALLERY_THUMB_IMAGE_CONCURRENCY ?? '', 10)
  if (Number.isFinite(raw) && raw >= 1) return Math.min(16, Math.floor(raw))
  return Math.max(3, Math.min(8, cpuCount - 1))
}

/** 视频并发：截帧共用一个隐藏渲染页，2 路并行解码足够且内存有界 */
export const VIDEO_CONCURRENCY = 2

/**
 * 按媒体类型分池（纯决策）：视频截帧慢（单帧秒级、超时 15s）且资源模型
 * 与 sharp 完全不同——分离后慢视频不再占住图片 worker，大批量混排时图片
 * 缩略图持续推进（#4 验收：视频与图片互不阻塞）。
 */
export function splitThumbJobs<T extends { type: string }>(jobs: T[]): { images: T[]; videos: T[] } {
  const images: T[] = []
  const videos: T[] = []
  for (const j of jobs) (j.type === 'video' ? videos : images).push(j)
  return { images, videos }
}
