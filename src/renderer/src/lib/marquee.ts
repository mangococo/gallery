/**
 * 照片墙框选（marquee selection）的纯几何层：矩形归一化、相交判定、命中集合、
 * 起拖阈值与起始目标过滤。不依赖 React 与 DOM 事件——事件管线在 PhotoWall 的
 * 控制器 hook 里，选择状态归页面所有，这里只放可单测的坐标数学。
 */

export interface Point {
  x: number
  y: number
}

/** 归一化后的框选矩形（左上角 + 宽高，视口 CSS 像素） */
export interface MarqueeRect {
  x: number
  y: number
  width: number
  height: number
}

/** 卡片命中盒（getBoundingClientRect 口径） */
export interface CardBox {
  id: string
  left: number
  top: number
  right: number
  bottom: number
}

/** 判定为「拖拽」的最小位移（CSS 像素，任一轴超过即成框）；之下的释放按普通点击放行 */
export const MARQUEE_THRESHOLD_PX = 4

/** 拖拽起点/当前点归一化为左上角 + 宽高（任意方向拖动都成立） */
export function marqueeRectFromPoints(a: Point, b: Point): MarqueeRect {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) }
}

/** 是否超过起拖阈值（任一轴超过即算拖拽） */
export function movedBeyondThreshold(a: Point, b: Point): boolean {
  return Math.abs(a.x - b.x) > MARQUEE_THRESHOLD_PX || Math.abs(a.y - b.y) > MARQUEE_THRESHOLD_PX
}

/**
 * 卡片矩形与框选矩形是否相交。边缘贴合不算命中（严格大于），
 * 与 Finder / 资源管理器的框选口径一致：扫过即选中，无需完全覆盖。
 */
export function rectsIntersect(
  rect: MarqueeRect,
  card: { left: number; top: number; right: number; bottom: number },
): boolean {
  return (
    rect.x < card.right &&
    rect.x + rect.width > card.left &&
    rect.y < card.bottom &&
    rect.y + rect.height > card.top
  )
}

/** 框选矩形命中的照片 id 集合 */
export function collectMarqueeHits(cards: CardBox[], rect: MarqueeRect): Set<string> {
  const hits = new Set<string>()
  for (const c of cards) {
    if (rectsIntersect(rect, c)) hits.add(c.id)
  }
  return hits
}

/** 两个 id 集合成员是否相同（空集与 null 不等价；预览去重用） */
export function sameIdSet(a: Set<string>, b: Set<string> | null): boolean {
  if (a === b) return true
  if (!b || a.size !== b.size) return false
  for (const id of a) {
    if (!b.has(id)) return false
  }
  return true
}

/**
 * 框选不应从交互控件上开始：卡片悬停操作按钮、图注编辑触发器（role=button）、
 * 输入类控件保持原生点击语义，不参与框选起拖。
 */
const MARQUEE_SKIP_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [contenteditable], [contenteditable] *'

export function shouldStartMarqueeFrom(target: EventTarget | null): boolean {
  if (!target) return true
  const el = target as Element
  if (typeof el.closest !== 'function') return true
  return !el.closest(MARQUEE_SKIP_SELECTOR)
}
