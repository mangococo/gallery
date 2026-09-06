/**
 * 回收站的纯逻辑层：不依赖 db / electron / fs，可单元测试。
 * trash.ts 负责 IO 与入库，这里只做路径与命名决策。
 *
 * 物理布局约定（目录都在相册根目录内，随相册数据一起存在）：
 *   .gallery-trash/trips/<tripId>/…            整个旅行文件夹改名挪入的位置
 *   .gallery-trash/photos/<photoId>/<fileName> 单独删除的媒体挪入的位置
 * 槽位只用 id 不用业务名：同名旅行/文件互不冲突，恢复时按记录重算目标名。
 * `.` 前缀目录天然被扫描与 watcher 忽略（scanner 跳过隐藏目录、watcher 过滤隐藏路径），
 * 回收站中的文件不会被重新入库，也照不到增量校对。
 */

export const TRASH_ROOT = '.gallery-trash'
export const TRIPS_DIR = `${TRASH_ROOT}/trips`
export const PHOTOS_DIR = `${TRASH_ROOT}/photos`

/** 回收站中旅行文件夹的相册内相对路径（整个文件夹挪到这里，槽位目录即文件夹本体） */
export function trashedTripDirRelPath(tripId: string): string {
  return `${TRIPS_DIR}/${tripId}`
}

/** 回收站中旅行文件夹里的成员文件 */
export function trashedTripFileRelPath(tripId: string, fileName: string): string {
  return `${trashedTripDirRelPath(tripId)}/${fileName}`
}

/** 回收站中单独删除媒体的相册内相对路径（所属旅行不在回收站时的存放位） */
export function trashedPhotoFileRelPath(photoId: string, fileName: string): string {
  return `${PHOTOS_DIR}/${photoId}/${fileName}`
}

/**
 * 删除态照片的实际位置需要双探测（purge/恢复时）：
 * - 单独删除（含所属旅行后来也进回收站的）→ 照片独立槽位 trashedPhotoFileRelPath
 * - 随旅行文件夹整体删除 → 文件随目录在 trashedTripFileRelPath(tripId)/ 下
 * 两处都试而不是按状态推断，因为「单独删除后旅行又被删」的照片容易推断错位。
 */

/**
 * 恢复目标名去重：base、base (2)、base (3)…（与 createTrip 的 dedupeFolderName 同一约定）。
 * occupied 由调用方注入：磁盘路径已存在或记录已被占用（含回收站中的行）都算占用。
 */
export function dedupeRestoreName(base: string, occupied: (name: string) => boolean): string {
  if (!occupied(base)) return base
  let i = 2
  while (occupied(`${base} (${i})`)) i++
  return `${base} (${i})`
}
