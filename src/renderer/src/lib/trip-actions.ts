import { api } from './api'
import { confirmDialog, toast } from '../components/feedback'

/**
 * 删除旅行共用流程（时间线入口与旅行页顶栏入口共用，保证文案一致）：
 * 应用内危险确认 → IPC 移入废纸篓 → 成功/失败 toast。返回是否已删除。
 */
export async function confirmAndDeleteTrip(trip: {
  id: string
  title: string
  photoCount: number
}): Promise<boolean> {
  const photoNote = trip.photoCount > 0 ? `（含 ${trip.photoCount} 张照片）` : ''
  const ok = await confirmDialog({
    title: '删除这次旅行？',
    body: `「${trip.title}」的整个旅行文件夹${photoNote}将移入废纸篓，不会直接删除。`,
    confirmText: '移入废纸篓',
    danger: true,
  })
  if (!ok) return false
  try {
    await api.deleteTrip(trip.id)
  } catch (error: any) {
    toast('删除失败: ' + error.message, 'error')
    return false
  }
  toast(`已删除「${trip.title}」`, 'success')
  return true
}
