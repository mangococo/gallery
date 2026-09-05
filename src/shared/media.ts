/** 媒体类型判定（纯逻辑，主进程扫描与测试共用；大小写不敏感） */

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.heic', '.tiff'])
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v', '.avi', '.mkv', '.webm'])

export function mediaTypeOf(fileName: string): 'image' | 'video' | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  const ext = fileName.slice(dot).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  return null
}
