import { join } from 'path'
import {
  getEarliestTakenAtOfTrip,
  getSetting,
  listPhotosForExifBackfill,
  listPhotosForGpsBackfill,
  listTripsWithEmptyStartDate,
  setSetting,
  updatePhotoGps,
  updatePhotoTakenAtOnly,
  updateTripRow,
} from '../db'
import { readExifGps, readExifTakenAt } from './exif'
import { msToLocalDate } from './reconcile'

const BACKFILL_KEY = 'exif_backfill_v1'
const GPS_BACKFILL_KEY = 'gps_backfill_v1'

/**
 * 一次性回填：v0.9 存量照片的 taken_at 是文件 mtime，启动后逐张补读
 * EXIF 拍摄时间（只改 taken_at，不动缩略图与对账职责的 file_mtime）。
 * 完成后顺手为没填开始日期的旅行按最早拍摄日期推断补齐。
 * 以 settings 标记保证只跑一次；之后的新增/替换都由扫描实时读 EXIF。
 */
export async function backfillExifTakenAt(): Promise<void> {
  if (getSetting(BACKFILL_KEY) === 'done') return
  const photos = listPhotosForExifBackfill()
  const started = Date.now()
  let updated = 0
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < photos.length) {
      const p = photos[cursor++]
      const takenAt = await readExifTakenAt(join(p.albumPath, p.relPath))
      if (takenAt !== null) {
        updatePhotoTakenAtOnly(p.id, takenAt)
        updated++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker))

  inferMissingTripStartDates()
  setSetting(BACKFILL_KEY, 'done')
  console.log(
    `[backfill] EXIF 拍摄时间回填完成：${updated}/${photos.length} 张，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
}

/** 为开始日期为空的旅行按照片最早拍摄日期推断（绝不覆盖用户已填的值） */
export function inferMissingTripStartDates(): void {
  for (const t of listTripsWithEmptyStartDate()) {
    const earliest = getEarliestTakenAtOfTrip(t.id)
    if (earliest !== null) updateTripRow(t.id, { startDate: msToLocalDate(earliest) })
  }
}

/**
 * 一次性回填：v0.11 之前入库的照片没读过 GPS EXIF，启动后逐张补读
 * （只处理 gps_lat 仍为空的图片；无 GPS 的照片读不到就保持 NULL）。
 * 之后的新增/替换都由扫描实时读 GPS。
 */
export async function backfillPhotoGps(): Promise<void> {
  if (getSetting(GPS_BACKFILL_KEY) === 'done') return
  const photos = listPhotosForGpsBackfill()
  const started = Date.now()
  let updated = 0
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < photos.length) {
      const p = photos[cursor++]
      const gps = await readExifGps(join(p.albumPath, p.relPath))
      if (gps !== null) {
        updatePhotoGps(p.id, gps.lat, gps.lon)
        updated++
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, photos.length) }, worker))

  setSetting(GPS_BACKFILL_KEY, 'done')
  console.log(
    `[backfill] GPS 回填完成：${updated}/${photos.length} 张有坐标，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
}
