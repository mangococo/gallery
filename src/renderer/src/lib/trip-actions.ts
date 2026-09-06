import { api } from './api'
import { confirmDialog, toast } from '../components/feedback'

/**
 * 删除旅行共用流程（时间线入口与旅行页顶栏入口共用，保证文案一致）：
 * 应用内危险确认 → IPC 删除 → 成功/失败 toast。返回是否已删除。
 * status === 'missing'（旅行文件夹已被移出相册目录）时切换为「只删记录」文案，
 * 主进程会按磁盘实况二次校对，这里文案只负责不误导。
 */
export async function confirmAndDeleteTrip(trip: {
  id: string
  title: string
  photoCount: number
  status?: 'ok' | 'missing'
}): Promise<boolean> {
  const missing = trip.status === 'missing'
  const ok = missing
    ? await confirmDialog({
        title: '旅行文件夹已不存在',
        body: `「${trip.title}」的文件夹已不在相册目录中（可能被移出或删除）。要删除画廊中的这条旅行记录吗？\n只清理记录，不会动磁盘上的任何文件。`,
        confirmText: '删除记录',
        danger: true,
      })
    : await confirmDialog({
        title: '删除这次旅行？',
        body: `「${trip.title}」的整个旅行文件夹${
          trip.photoCount > 0 ? `（含 ${trip.photoCount} 张照片）` : ''
        }将移入回收站，可随时恢复。`,
        confirmText: '移入回收站',
        danger: true,
      })
  if (!ok) return false
  try {
    await api.deleteTrip(trip.id)
  } catch (error: any) {
    toast('删除失败: ' + error.message, 'error')
    return false
  }
  toast(missing ? `已删除记录「${trip.title}」` : `已删除「${trip.title}」`, 'success')
  return true
}
