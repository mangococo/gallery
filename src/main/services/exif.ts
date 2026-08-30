import exifr from 'exifr'
import type { PhotoType } from '../../shared/types'

/**
 * 读取照片的 EXIF 拍摄时间（优先 DateTimeOriginal，其次 CreateDate），毫秒时间戳。
 * 无 EXIF / 格式不支持 / 解析失败一律返回 null。
 * EXIF 时间无时区信息，exifr 按本机时区解读，与拍摄时的墙钟一致。
 */
export async function readExifTakenAt(absPath: string): Promise<number | null> {
  try {
    const parsed = await exifr.parse(absPath, { pick: ['DateTimeOriginal', 'CreateDate'] })
    const date = parsed?.DateTimeOriginal ?? parsed?.CreateDate
    return date instanceof Date && !isNaN(date.getTime()) ? date.getTime() : null
  } catch {
    return null
  }
}

/**
 * 入库时间决策：图片优先 EXIF 拍摄时间，取不到回退文件 mtime；
 * 视频通常无 EXIF，直接用 mtime（ Finder/AirDrop 拷贝会保留录制时间）。
 */
export async function resolvePhotoTakenAt(
  absPath: string,
  type: PhotoType,
  mtimeMs: number,
): Promise<number> {
  if (type !== 'image') return Math.round(mtimeMs)
  const exif = await readExifTakenAt(absPath)
  return exif ?? Math.round(mtimeMs)
}
