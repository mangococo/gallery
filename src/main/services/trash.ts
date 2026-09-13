import { shell, app } from 'electron'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import { join } from 'path'
import type { TrashItem, TrashOpResult, TrashSelection } from '../../shared/types'
import {
  getAlbumRow,
  getAnyTripIdByFolder,
  getPhotoRow,
  getPhotoRowIncludingTrashed,
  getTripRow,
  getTripRowIncludingTrashed,
  hardDeletePhotoRows,
  deleteTripRow,
  listPhotoRowsOfTripIncludingTrashed,
  listPhotosOfTrip,
  listTrashedPhotoRows,
  listTrashedTripRows,
  markPhotoTrashed,
  markTripTrashed,
  restorePhotoRow,
  snapTakenAtRanges,
  applyTripDateRecalc,
  restoreTripRows,
  updatePhotoFileName,
  updateTripRow,
} from '../db'
import { collisionSafeDestName } from './move-plan'
import {
  PHOTOS_DIR,
  TRIPS_DIR,
  dedupeRestoreName,
  restoreNameOccupied,
  trashedPhotoFileRelPath,
  trashedTripDirRelPath,
} from './trash-plan'

/**
 * 回收站服务：删除 = 软删除（deleted_at）+ 文件挪入相册内隐藏目录（见 trash-plan.ts）。
 * 恢复 = 文件挪回原位（必要时重名避让）+ 清 deleted_at；「彻底删除」才把文件交给系统废纸篓
 * 并硬删记录（系统废纸篓是误操作的最后一道保险，画廊内不可再恢复）。
 *
 * 与扫描的兼容性由布局保证：.gallery-trash 是 `.` 前缀隐藏目录，
 * scanner 不收录、watcher 过滤其事件，回收站中的文件永远不会被重新入库。
 */

/** 路径可访问（存在且可 stat） */
async function pathAccessible(p: string): Promise<boolean> {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

function thumbsDir(): string {
  return join(app.getPath('userData'), 'thumbnails')
}

/** 把文件送进系统废纸篓（尽力而为：文件已不在则跳过，失败不抛——硬删记录本身不受阻） */
async function toSystemTrash(abs: string): Promise<void> {
  if (!(await pathAccessible(abs))) return
  await shell.trashItem(abs).catch(() => {})
}

async function deleteThumbFile(photoId: string): Promise<void> {
  await fs.rm(join(thumbsDir(), `${photoId}.webp`), { force: true }).catch(() => {})
}

/**
 * 删除旅行 → 回收站：文件夹整体挪入相册内回收站目录，旅行与其下照片标记 deleted_at。
 * 相册根不可达时拒绝（无法区分「真没了」和「暂时看不到」，此时入库删除不可逆）。
 */
export async function trashTrip(id: string): Promise<void> {
  const trip = getTripRow(id)
  if (!trip) return
  const album = getAlbumRow(trip.albumId)
  if (!album) throw new Error('相册不存在')
  const rootOk = await pathAccessible(album.path)
  if (!rootOk) {
    throw new Error('相册目录当前不可访问，无法确认旅行文件夹状态，已取消删除')
  }
  const folderAbs = join(album.path, trip.folderName)
  if (await pathAccessible(folderAbs)) {
    const slotDir = join(album.path, trashedTripDirRelPath(id))
    await fs.mkdir(join(album.path, TRIPS_DIR), { recursive: true })
    // 槽位以 tripId 为键，正常情况下必然空闲；被外部动过则明确报错而不是覆盖
    if (existsSync(slotDir)) {
      throw new Error('回收站槽位被占用，已取消删除（请检查相册内 .gallery-trash 目录）')
    }
    await fs.rename(folderAbs, slotDir)
  }
  // 文件夹已被移出/外部删除 → 只入记录（record-only），恢复时按缺文件处理
  markTripTrashed(id, Date.now())
}

/**
 * 删除照片/视频 → 回收站：文件挪入独立槽位（所属旅行在回收站时本就不在业务视图，无此路径），
 * 记录标记 deleted_at；被删的是旅行封面时让位给剩余第一张。
 */
export async function trashPhoto(id: string): Promise<void> {
  const photo = getPhotoRow(id)
  if (!photo) return
  const album = getAlbumRow(photo.albumId)
  if (!album) throw new Error('相册不存在')
  const rootOk = await pathAccessible(album.path)
  if (!rootOk) {
    throw new Error('相册目录当前不可访问，无法确认照片文件状态，已取消删除')
  }
  const abs = join(album.path, photo.relPath)
  if (await pathAccessible(abs)) {
    const slotDir = join(album.path, PHOTOS_DIR, id)
    await fs.mkdir(slotDir, { recursive: true })
    const dest = join(slotDir, photo.fileName)
    if (existsSync(dest)) {
      throw new Error('回收站槽位被占用，已取消删除（请检查相册内 .gallery-trash 目录）')
    }
    await fs.rename(abs, dest)
  }
  markPhotoTrashed(id, Date.now())

  // 封面让位：与批量移动的封面交接约定一致（剩第一张，移空置空）
  const trip = getTripRow(photo.tripId)
  if (trip?.coverPhotoId === id) {
    const remaining = listPhotosOfTrip(photo.tripId, album.id, null).filter((p) => p.id !== id)
    updateTripRow(photo.tripId, { coverPhotoId: remaining[0]?.id ?? null })
  }
}

/** 回收站列表：旅行 + 媒体合并，按删除时间倒序；缩略图与缺文件状态在此装饰 */
export async function listTrash(): Promise<TrashItem[]> {
  const items: TrashItem[] = []

  for (const r of listTrashedTripRows()) {
    const album = getAlbumRow(r.album_id)
    const slotAbs = album ? join(album.path, trashedTripDirRelPath(r.id)) : ''
    const fileMissing = !album || !(await pathAccessible(slotAbs))
    items.push({
      kind: 'trip',
      id: r.id,
      name: r.title,
      albumId: r.album_id,
      albumName: r.album_name,
      tripId: r.id,
      tripTitle: r.title,
      deletedAt: r.deleted_at,
      thumbUrl: tripThumbUrl(r.id, r.cover_photo_id),
      fileMissing,
      photoCount: r.photo_count,
    })
  }

  for (const r of listTrashedPhotoRows()) {
    const album = getAlbumRow(r.album_id)
    const tripTrashed = r.trip_deleted_at != null
    // 列出的照片行必然是「单独删除」的（随旅行删除的已并入旅行条目）：
    // 即便所属旅行也在回收站，其文件也在照片独立槽位，而非旅行槽位
    const physRel = trashedPhotoFileRelPath(r.id, r.file_name)
    const fileMissing = !album || !(await pathAccessible(join(album.path, physRel)))
    items.push({
      kind: 'photo',
      id: r.id,
      name: r.file_name,
      type: r.type === 'video' ? 'video' : 'image',
      albumId: r.album_id,
      albumName: r.album_name,
      tripId: r.trip_id,
      tripTitle: r.trip_title,
      deletedAt: r.deleted_at,
      // 缩略图缓存按 id 存放，软删除期间仍在；未就绪时按回收站内的实际位置回退原图
      thumbUrl:
        r.thumb_status === 'ready'
          ? `gallery-media://t/${r.id}.webp`
          : r.type === 'image' && album
            ? `gallery-media://m/${r.album_id}/${encodeURIComponent(physRel)}`
            : '',
      fileMissing,
      tripTrashed,
    })
  }

  return items.sort((a, b) => b.deletedAt - a.deletedAt)
}

/** 旅行缩略图：封面优先（含回收站中的照片），退而取第一张 */
function tripThumbUrl(tripId: string, coverPhotoId: string | null): string {
  const candidates = coverPhotoId ? [coverPhotoId] : []
  if (candidates.length === 0) {
    const first = listPhotoRowsOfTripIncludingTrashed(tripId)[0]
    if (first) candidates.push(first.id)
  }
  for (const id of candidates) {
    const p = getPhotoRowIncludingTrashed(id)
    if (!p) continue
    if (p.thumb_status === 'ready') return `gallery-media://t/${p.id}.webp`
    if (p.type === 'image') {
      return `gallery-media://m/${p.albumId}/${encodeURIComponent(p.rel_path)}`
    }
  }
  return ''
}

/**
 * 恢复一个旅行：文件夹挪回相册（目标重名时按「name (2)」避让，与建旅行的约定一致），
 * 记录清除 deleted_at（含随旅行一起删除的照片）。返回随旅行复活的照片数。
 */
async function restoreTrip(tripId: string): Promise<number> {
  const trip = getTripRowIncludingTrashed(tripId)
  if (!trip) throw new Error('旅行不存在（可能已被恢复或彻底删除）')
  if (trip.deletedAt == null) return 0
  const album = getAlbumRow(trip.albumId)
  if (!album) throw new Error('相册不存在或已被移除，无法恢复')
  if (!(await pathAccessible(album.path))) {
    throw new Error('相册目录当前不可访问，无法恢复')
  }
  // 目标名避让：磁盘已存在同名文件夹，或同名记录属于其他旅行（含回收站中的行；
  // 自身记录豁免，否则每次恢复都会被误判重名）
  const folderName = dedupeRestoreName(trip.folderName, (n) =>
    restoreNameOccupied(
      tripId,
      existsSync(join(album.path, n)),
      getAnyTripIdByFolder(album.id, n),
    ),
  )
  const slotAbs = join(album.path, trashedTripDirRelPath(tripId))
  if (await pathAccessible(slotAbs)) {
    await fs.rename(slotAbs, join(album.path, folderName))
  }
  return restoreTripRows(tripId, trip.deletedAt, folderName)
}

/**
 * 批量恢复。旅行整体恢复；照片恢复时所属旅行也在回收站 → 先随层级把旅行恢复，
 * 再把照片文件从独立槽位挪回旅行文件夹（旅行文件夹整体恢复时同批照片已随目录就位）。
 */
export async function restoreItems(
  sel: TrashSelection,
  notify?: (albumId: string) => void,
): Promise<TrashOpResult> {
  const result: TrashOpResult = { tripsCount: 0, photosCount: 0, failed: [] }

  for (const tripId of sel.tripIds) {
    const name = getTripRowIncludingTrashed(tripId)?.title ?? tripId
    try {
      const revived = await restoreTrip(tripId)
      result.tripsCount++
      result.photosCount += revived
      const albumId = getTripRowIncludingTrashed(tripId)?.albumId
      if (albumId) notify?.(albumId)
    } catch (err) {
      result.failed.push({ name, reason: String((err as Error)?.message ?? err) })
    }
  }

  for (const photoId of sel.photoIds) {
    let name = photoId
    try {
      const photo = getPhotoRowIncludingTrashed(photoId)
      if (!photo) throw new Error('记录不存在（可能已被彻底删除）')
      name = photo.file_name
      if (photo.deleted_at == null) continue // 已在业务视图（幂等）
      const album = getAlbumRow(photo.albumId)
      if (!album) throw new Error('相册不存在或已被移除，无法恢复')
      if (!(await pathAccessible(album.path))) {
        throw new Error('相册目录当前不可访问，无法恢复')
      }
      const trip = getTripRowIncludingTrashed(photo.trip_id)
      if (!trip) throw new Error('所属旅行记录不存在，无法恢复')

      // 所属旅行也在回收站：按删除层级先恢复旅行（同批文件随目录回到相册）
      if (trip.deletedAt != null) {
        await restoreTrip(trip.id)
        result.tripsCount++
        notify?.(album.id)
      }
      if (getPhotoRowIncludingTrashed(photoId)?.deleted_at == null) {
        result.photosCount++ // 已随旅行一起复活
        continue
      }

      // 目标位置按旅行当前文件夹名重算（旅行恢复时可能已改名）
      const tripNow = getTripRowIncludingTrashed(photo.trip_id)!
      const targetDir = join(album.path, tripNow.folderName)
      await fs.mkdir(targetDir, { recursive: true })
      let fileName = photo.file_name
      if (existsSync(join(targetDir, fileName))) {
        fileName = collisionSafeDestName(fileName, (n) => existsSync(join(targetDir, n)))
      }
      const slotAbs = join(album.path, trashedPhotoFileRelPath(photoId, photo.file_name))
      if (await pathAccessible(slotAbs)) {
        await fs.rename(slotAbs, join(targetDir, fileName))
      }
      // 变更前快照：恢复会扩大所属旅行的照片集合，收尾据此重算日期
      // （taken_at 为软删前的原值，恢复前后推导范围可直接对比）
      const dateSnap = snapTakenAtRanges([photo.trip_id])
      // 槽位无文件（记录型删除）也恢复记录，缺文件状态交给增量校对
      restorePhotoRow(photoId)
      updatePhotoFileName(photoId, fileName, `${tripNow.folderName}/${fileName}`)
      applyTripDateRecalc(dateSnap)
      result.photosCount++
      notify?.(album.id)
    } catch (err) {
      result.failed.push({ name, reason: String((err as Error)?.message ?? err) })
    }
  }

  return result
}

/**
 * 批量彻底删除：文件送入系统废纸篓（画廊内不可恢复的最后一道保险），
 * 缩略图缓存删除，记录硬删（FK 级联清标签关系）。二次确认由调用方（UI）负责。
 */
export async function purgeItems(
  sel: TrashSelection,
  notify?: (albumId: string) => void,
): Promise<TrashOpResult> {
  const result: TrashOpResult = { tripsCount: 0, photosCount: 0, failed: [] }

  for (const photoId of sel.photoIds) {
    let name = photoId
    try {
      const photo = getPhotoRowIncludingTrashed(photoId)
      if (!photo) continue
      name = photo.file_name
      if (photo.deleted_at == null) throw new Error('该照片不在回收站中')
      const album = getAlbumRow(photo.albumId)
      if (!album) throw new Error('相册不存在')
      const trip = getTripRowIncludingTrashed(photo.trip_id)
      // 物理位置双探测：随旅行删除的文件在旅行槽位，单独删除的在独立槽位
      const candidates = trip
        ? [
            join(album.path, trashedTripDirRelPath(trip.id), photo.file_name),
            join(album.path, trashedPhotoFileRelPath(photoId, photo.file_name)),
          ]
        : [join(album.path, trashedPhotoFileRelPath(photoId, photo.file_name))]
      for (const abs of candidates) await toSystemTrash(abs)
      await deleteThumbFile(photoId)
      hardDeletePhotoRows([photoId])
      result.photosCount++
      notify?.(photo.albumId)
    } catch (err) {
      result.failed.push({ name, reason: String((err as Error)?.message ?? err) })
    }
  }

  for (const tripId of sel.tripIds) {
    let name = tripId
    try {
      const trip = getTripRowIncludingTrashed(tripId)
      if (!trip) continue
      name = trip.title
      if (trip.deletedAt == null) throw new Error('该旅行不在回收站中')
      const album = getAlbumRow(trip.albumId)
      if (!album) throw new Error('相册不存在')
      // 先枚举照片（行删除后级联不可查）：缩略图清理 + 不在旅行槽位内的文件单独入系统废纸篓
      for (const p of listPhotoRowsOfTripIncludingTrashed(tripId)) {
        await deleteThumbFile(p.id)
        if (p.deleted_at == null) continue
        const inSlot = join(album.path, trashedPhotoFileRelPath(p.id, p.file_name))
        if (existsSync(inSlot)) await toSystemTrash(inSlot)
      }
      await toSystemTrash(join(album.path, trashedTripDirRelPath(tripId)))
      hardDeletePhotoRows(listPhotoRowsOfTripIncludingTrashed(tripId).map((p) => p.id))
      // 旅行行硬删（photos/trip_tags 级联）；标签本体保留（无引用时自然从联想中隐去）
      deleteTripRow(tripId)
      result.tripsCount++
      notify?.(trip.albumId)
    } catch (err) {
      result.failed.push({ name, reason: String((err as Error)?.message ?? err) })
    }
  }

  return result
}
