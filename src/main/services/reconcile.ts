/**
 * 旅行目录对账的纯逻辑层：不依赖 db / electron，可单元测试。
 * scanner.ts 负责IO 与入库，这里只做决策。
 */

/** 文件名排序：数字感知，保证时间线内照片顺序稳定 */
export function compareFileNames(a: string, b: string): number {
  return a.localeCompare(b, 'zh-Hans-CN', { numeric: true, sensitivity: 'base' })
}

export interface DiskFile {
  name: string
  mtimeMs: number
}

export interface DbPhotoFile {
  id: string
  fileName: string
  /** 文件 mtime（对账职责）；null 视为未知，按被替换处理 */
  fileMtime: number | null
}

export interface ReconcilePlan {
  /** 磁盘有、库里没有 → 入库 */
  inserts: DiskFile[]
  /** 同名但文件被替换（mtime 变化）→ 重读元数据并重新生成缩略图 */
  replaced: { id: string; file: DiskFile }[]
  /** 库里有、磁盘没有 → 删除记录 */
  removed: { id: string }[]
}

/**
 * 文件级增量校对：以「小写文件名 + file_mtime」对比磁盘与库。
 * taken_at 承担展示（EXIF 时间），不参与对账——文件替换检测必须走 file_mtime。
 */
export function planReconciliation(
  diskFiles: Map<string, DiskFile>,
  dbFiles: DbPhotoFile[],
  mtimeToleranceMs = 500,
): ReconcilePlan {
  const plan: ReconcilePlan = { inserts: [], replaced: [], removed: [] }
  const dbByKey = new Map(dbFiles.map((f) => [f.fileName.toLowerCase(), f]))

  for (const [key, disk] of diskFiles) {
    const existing = dbByKey.get(key)
    if (!existing) {
      plan.inserts.push(disk)
    } else if (
      existing.fileMtime === null ||
      Math.abs(existing.fileMtime - disk.mtimeMs) > mtimeToleranceMs
    ) {
      plan.replaced.push({ id: existing.id, file: disk })
    }
  }

  for (const f of dbFiles) {
    if (!diskFiles.has(f.fileName.toLowerCase())) plan.removed.push({ id: f.id })
  }
  return plan
}

export interface CaptionMapResult {
  /** 小写文件名 → caption */
  map: Map<string, string>
  /** 指向已改名/已删除文件的残留键数量 */
  skipped: number
}

/**
 * 旧 .settings.json 的 photoCaptions → 与磁盘文件大小写不敏感匹配的 caption 映射；
 * 指向磁盘上已不存在的文件的残留键静默跳过并计数。
 */
export function buildCaptionMap(
  photoCaptions: Record<string, unknown> | undefined,
  diskKeys: Set<string>,
): CaptionMapResult {
  const map = new Map<string, string>()
  let skipped = 0
  for (const [k, v] of Object.entries(photoCaptions ?? {})) {
    const key = k.toLowerCase()
    if (!diskKeys.has(key)) {
      skipped++
      continue
    }
    map.set(key, typeof v === 'string' ? v : '')
  }
  return { map, skipped }
}

/** 毫秒时间戳 → 本地时区 YYYY-MM-DD（旅行日期推断用） */
export function msToLocalDate(ms: number): string {
  const d = new Date(ms)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

export type TripRemovalPlan =
  | { action: 'trash-folder' }
  | { action: 'record-only' }
  | { action: 'root-missing' }

/**
 * 删除旅行前的分流决策：
 * - 相册根可达且旅行目录还在 → 目录移入废纸篓后删记录
 * - 相册根可达但旅行目录已不在（被移出相册目录/外部删除）→ 只删记录，磁盘无东西可删
 * - 相册根本身不可达（外置卷未挂载等）→ 拒绝删除：无法区分「文件夹真没了」和「暂时看不到」，
 *   此时删元数据不可逆，必须等根目录恢复
 */
export function planTripRemoval(albumRootAccessible: boolean, tripFolderExists: boolean): TripRemovalPlan {
  if (!albumRootAccessible) return { action: 'root-missing' }
  return tripFolderExists ? { action: 'trash-folder' } : { action: 'record-only' }
}
