/**
 * 灯箱视图的纯计算层：缩放/平移钳制、指针锚点缩放、时间格式化。
 * 不依赖 React/DOM，node --test 直接可测。
 */

export interface ViewBox {
  zoom: number
  x: number
  y: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 8

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 平移钳制：内容（拍立得卡）以舞台中心为基准缩放，可拖拽范围为溢出部分的一半。
 * zoom <= 1 时强制归位（0,0）；舞台/内容尺寸未知（Infinity，如尚未布局）时不钳制。
 */
export function clampView(
  v: ViewBox,
  stageW: number,
  stageH: number,
  boxW: number,
  boxH: number,
): ViewBox {
  if (v.zoom <= MIN_ZOOM) return { zoom: MIN_ZOOM, x: 0, y: 0 }
  const span = (content: number, stage: number): number => {
    if (!Number.isFinite(content) || !Number.isFinite(stage) || content <= 0 || stage <= 0) {
      return Infinity
    }
    return Math.max(0, (content * v.zoom - stage) / 2)
  }
  return {
    zoom: v.zoom,
    x: clamp(v.x, -span(boxW, stageW), span(boxW, stageW)),
    y: clamp(v.y, -span(boxH, stageH), span(boxH, stageH)),
  }
}

/**
 * 指针锚点缩放：px/py 为指针相对「当前内容中心」的屏幕偏移。
 * 推导：内容点 p 的屏幕位置 s = p·z + t；保持指针下的内容点不动 →
 * t2 = t1·k − px·(k−1)，k = z2/z1（px 以舞台中心为原点、含当前平移）。
 */
export function zoomAtPoint(
  v: ViewBox,
  px: number,
  py: number,
  factor: number,
  stageW = Infinity,
  stageH = Infinity,
  boxW = Infinity,
  boxH = Infinity,
): ViewBox {
  const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
  if (zoom <= MIN_ZOOM) return { zoom: MIN_ZOOM, x: 0, y: 0 }
  if (zoom === v.zoom) return v
  const k = zoom / v.zoom
  const next: ViewBox = {
    zoom,
    x: v.x * k - px * (k - 1),
    y: v.y * k - py * (k - 1),
  }
  return clampView(next, stageW, stageH, boxW, boxH)
}

/** 单击图片的缩放切换倍率（fit → zoom 一步到位） */
export const TOGGLE_ZOOM_FACTOR = 2.5

/**
 * 单击图片的缩放切换：fit → 以指针为锚点放大；非 fit → 复位 fit。
 * 双击的防抖（click/dblclick 合并）在组件层处理，这里只管一次切换的纯计算。
 */
export function toggleZoomAtPoint(
  v: ViewBox,
  px: number,
  py: number,
  stageW = Infinity,
  stageH = Infinity,
  boxW = Infinity,
  boxH = Infinity,
  factor = TOGGLE_ZOOM_FACTOR,
): ViewBox {
  if (v.zoom > MIN_ZOOM) return { zoom: MIN_ZOOM, x: 0, y: 0 }
  return zoomAtPoint(v, px, py, factor, stageW, stageH, boxW, boxH)
}

/** 图片区光标：fit=zoom-in（点击放大）、非 fit=zoom-out（点击还原）、平移中=grabbing */
export type ViewerCursor = 'zoom-in' | 'zoom-out' | 'grabbing'
export function cursorForView(zoom: number, dragging: boolean): ViewerCursor {
  if (dragging) return 'grabbing'
  return zoom > MIN_ZOOM ? 'zoom-out' : 'zoom-in'
}

/** 视频时钟：87 → 1:27；3675 → 1:01:15 */
export function formatVideoClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const s = Math.floor(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  const ss = String(sec).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** 拍摄时间戳 → 「2026.05.12 · 14:32」（无效值返回空串） */
export function formatTakenStamp(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  if (isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())} · ${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * 批量删除/移动后灯箱应停留的位置：
 * 当前照片还在 → 跟随它落到新列表里的下标（前面被删 N 张时要左移 N，单纯 min 会跳错）；
 * 当前照片被删/被移走 → 按旧顺序翻到其后第一张还在的（无可再翻则退回最后一张还能看的），
 * 与主流相册「删除当前张后前进到下一张」的行为一致；
 * 列表删空 / 越界 → null（调用方关灯箱）。
 */
export function indexAfterRemoval(
  ids: string[],
  removedIds: Set<string>,
  current: number,
): number | null {
  if (current < 0 || current >= ids.length) return null
  const remaining = ids.filter((id) => !removedIds.has(id))
  if (remaining.length === 0) return null

  const currentId = ids[current]
  if (!removedIds.has(currentId)) {
    const next = remaining.indexOf(currentId)
    return next >= 0 ? next : null
  }
  for (let i = current + 1; i < ids.length; i++) {
    if (!removedIds.has(ids[i])) return remaining.indexOf(ids[i])
  }
  for (let i = current - 1; i >= 0; i--) {
    if (!removedIds.has(ids[i])) return remaining.indexOf(ids[i])
  }
  return remaining.length - 1
}
