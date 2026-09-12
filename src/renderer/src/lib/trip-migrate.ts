/**
 * 删除旅行时「照片迁移到已有旅行」的纯决策层：
 * 候选目标过滤不依赖 db / electron / React，可单元测试。
 */

export interface MigrationCandidateTrip {
  id: string
  title: string
  /** 'missing' = 文件夹已不在相册目录中（文件无从迁移，不能作为目标） */
  status?: 'ok' | 'missing'
  photos?: { id: string }[]
}

/**
 * 可作为迁移目标的旅行：排除被删除的旅行本身与文件夹缺失的旅行。
 * listTrips 天然按相册返回且不含回收站项，这里只做结构化过滤。
 */
export function eligibleMigrationTargets<T extends MigrationCandidateTrip>(
  trips: T[] | undefined | null,
  excludeTripId: string,
): T[] {
  if (!trips) return []
  return trips.filter((t) => t.id !== excludeTripId && (t.status ?? 'ok') === 'ok')
}
