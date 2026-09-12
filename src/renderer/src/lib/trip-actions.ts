import { api } from './api'
import { confirmDialog, toast } from '../components/feedback'
import { confirmDeleteTripDialog } from '../components/DeleteTripDialog'
import { eligibleMigrationTargets } from './trip-migrate'
import type { Trip } from '../types'

/**
 * 删除旅行共用流程（时间线入口与旅行页顶栏入口共用，保证文案一致）：
 * 应用内危险确认 → IPC 删除 → 成功/失败 toast。返回是否已删除。
 *
 * - status === 'missing'（旅行文件夹已被移出相册目录）：切换为「只删记录」文案，
 *   主进程会按磁盘实况二次校对；文件已无从迁移，不提供迁移选项。
 * - 文件夹正常且带照片：弹删除专用弹窗，可选「照片迁移到其他旅行，再删除」——
 *   迁移走既有 photos:move 管道（搬文件、重名避让、封面交接、失败回滚）；
 *   迁移失败即中止删除，旅行保持原状。
 */
export async function confirmAndDeleteTrip(
  trip: {
    id: string
    title: string
    photoCount: number
    status?: 'ok' | 'missing'
    /** 照片 id 清单（迁移用）；缺省时带照片旅行也不出迁移选项 */
    photoIds?: string[]
  },
  /** 候选目标旅行（调用方从 store 传入，通常为当前相册的旅行清单） */
  options?: { candidateTrips?: Trip[] },
): Promise<boolean> {
  const missing = trip.status === 'missing'

  let migrateToTripId: string | null = null
  let migrateTargetTitle = ''

  if (missing) {
    const ok = await confirmDialog({
      title: '旅行文件夹已不存在',
      body: `「${trip.title}」的文件夹已不在相册目录中（可能被移出或删除）。要删除画廊中的这条旅行记录吗？\n只清理记录，不会动磁盘上的任何文件。`,
      confirmText: '删除记录',
      danger: true,
    })
    if (!ok) return false
  } else if (trip.photoCount > 0 && (trip.photoIds?.length ?? 0) > 0) {
    const candidates = eligibleMigrationTargets(options?.candidateTrips, trip.id)
    const choice = await confirmDeleteTripDialog(
      { id: trip.id, title: trip.title, photoCount: trip.photoCount },
      candidates,
    )
    // 取消（Esc/遮罩）
    if (!choice) return false
    migrateToTripId = choice.migrateToTripId
    if (migrateToTripId) {
      migrateTargetTitle =
        candidates.find((t) => t.id === migrateToTripId)?.title ?? '目标旅行'
    }
  } else {
    const ok = await confirmDialog({
      title: '删除这次旅行？',
      body: `「${trip.title}」的整个旅行文件夹${
        trip.photoCount > 0 ? `（含 ${trip.photoCount} 张照片）` : ''
      }将移入回收站，可随时恢复。`,
      confirmText: '移入回收站',
      danger: true,
    })
    if (!ok) return false
  }

  // 先迁移照片：失败即中止删除（旅行与照片保持原状）
  if (migrateToTripId) {
    const ids = trip.photoIds ?? []
    try {
      const result = await api.movePhotos(ids, { tripId: migrateToTripId })
      const missingFiles = result.fileMissingCount > 0 ? `（${result.fileMissingCount} 项文件已缺失，仅迁移记录）` : ''
      toast(`已把 ${result.movedIds.length} 张照片迁移到「${result.targetTrip.title}」${missingFiles}`, 'success')
    } catch (error: any) {
      toast('照片迁移失败，已取消删除：' + error.message, 'error')
      return false
    }
  }

  try {
    await api.deleteTrip(trip.id)
  } catch (error: any) {
    toast('删除失败: ' + error.message, 'error')
    return false
  }
  toast(
    migrateToTripId
      ? `已删除「${trip.title}」，照片已迁往「${migrateTargetTitle}」`
      : missing
        ? `已删除记录「${trip.title}」`
        : `已删除「${trip.title}」`,
    'success',
  )
  return true
}
