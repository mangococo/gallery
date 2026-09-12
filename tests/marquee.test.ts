import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  collectMarqueeHits,
  MARQUEE_THRESHOLD_PX,
  marqueeRectFromPoints,
  movedBeyondThreshold,
  rectsIntersect,
  sameIdSet,
  shouldStartMarqueeFrom,
  type CardBox,
} from '../src/renderer/src/lib/marquee.ts'

// —— marqueeRectFromPoints：四个拖拽方向都归一化成左上角 + 宽高 ——

test('marqueeRectFromPoints：左上→右下', () => {
  assert.deepEqual(marqueeRectFromPoints({ x: 10, y: 20 }, { x: 60, y: 90 }), {
    x: 10,
    y: 20,
    width: 50,
    height: 70,
  })
})

test('marqueeRectFromPoints：右下→左上（反方向拖）', () => {
  assert.deepEqual(marqueeRectFromPoints({ x: 60, y: 90 }, { x: 10, y: 20 }), {
    x: 10,
    y: 20,
    width: 50,
    height: 70,
  })
})

test('marqueeRectFromPoints：右上→左下 / 左下→右上', () => {
  assert.deepEqual(marqueeRectFromPoints({ x: 100, y: 0 }, { x: 40, y: 50 }), {
    x: 40,
    y: 0,
    width: 60,
    height: 50,
  })
  assert.deepEqual(marqueeRectFromPoints({ x: 0, y: 50 }, { x: 70, y: 10 }), {
    x: 0,
    y: 10,
    width: 70,
    height: 40,
  })
})

// —— rectsIntersect：相交判定，边缘贴合不算 ——

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, width: w, height: h })
const card = (l: number, t: number, r: number, b: number) => ({ left: l, top: t, right: r, bottom: b })

test('rectsIntersect：正交重叠命中', () => {
  assert.equal(rectsIntersect(rect(0, 0, 100, 100), card(50, 50, 150, 150)), true)
})

test('rectsIntersect：完全包含命中', () => {
  assert.equal(rectsIntersect(rect(0, 0, 300, 300), card(10, 10, 20, 20)), true)
})

test('rectsIntersect：边缘贴合不算命中（严格大于）', () => {
  assert.equal(rectsIntersect(rect(0, 0, 100, 100), card(100, 0, 200, 100)), false)
  assert.equal(rectsIntersect(rect(0, 0, 100, 100), card(0, 100, 100, 200)), false)
})

test('rectsIntersect：相离不命中', () => {
  assert.equal(rectsIntersect(rect(0, 0, 10, 10), card(20, 20, 30, 30)), false)
})

test('rectsIntersect：退化点在卡片内部按数学相交（真实管线由阈值保证不会以此命中）', () => {
  assert.equal(rectsIntersect(rect(50, 50, 0, 0), card(0, 0, 100, 100)), true)
  assert.equal(rectsIntersect(rect(150, 150, 0, 0), card(0, 0, 100, 100)), false)
})

// —— movedBeyondThreshold：阈值区分点击与拖拽 ——

test('movedBeyondThreshold：阈值内按点击放行', () => {
  assert.equal(movedBeyondThreshold({ x: 0, y: 0 }, { x: MARQUEE_THRESHOLD_PX, y: 0 }), false)
  assert.equal(movedBeyondThreshold({ x: 0, y: 0 }, { x: 2, y: -3 }), false)
  assert.equal(movedBeyondThreshold({ x: 0, y: 0 }, { x: 0, y: 0 }), false)
})

test('movedBeyondThreshold：任一轴超过阈值即算拖拽', () => {
  assert.equal(movedBeyondThreshold({ x: 0, y: 0 }, { x: MARQUEE_THRESHOLD_PX + 1, y: 0 }), true)
  assert.equal(movedBeyondThreshold({ x: 0, y: 0 }, { x: -1, y: -(MARQUEE_THRESHOLD_PX + 1) }), true)
})

// —— collectMarqueeHits：命中集合 ——

const cards: CardBox[] = [
  { id: 'a', left: 0, top: 0, right: 100, bottom: 80 },
  { id: 'b', left: 110, top: 0, right: 210, bottom: 80 },
  { id: 'c', left: 0, top: 90, right: 100, bottom: 170 },
  { id: 'd', left: 110, top: 90, right: 210, bottom: 170 },
]

test('collectMarqueeHits：覆盖部分卡片只命中相交者', () => {
  // 细横带扫过第一行：a、b 相交，第二行不相交
  const hits = collectMarqueeHits(cards, rect(50, 40, 120, 30))
  assert.deepEqual([...hits].sort(), ['a', 'b'])
  // 下探越过行间隙（第二行 top=90）后 d 也进入命中
  const more = collectMarqueeHits(cards, rect(50, 40, 120, 60))
  assert.deepEqual([...more].sort(), ['a', 'b', 'c', 'd'])
})

test('collectMarqueeHits：空白区域小框不命中', () => {
  assert.equal(collectMarqueeHits(cards, rect(101, 81, 8, 8)).size, 0)
})

test('collectMarqueeHits：全选拖拽命中全部', () => {
  assert.equal(collectMarqueeHits(cards, rect(0, 0, 210, 170)).size, 4)
})

// —— sameIdSet：预览去重 ——

test('sameIdSet：成员相同为真（忽略顺序），与 null 不等价', () => {
  assert.equal(sameIdSet(new Set(['a', 'b']), new Set(['b', 'a'])), true)
  assert.equal(sameIdSet(new Set(), new Set()), true)
  assert.equal(sameIdSet(new Set(['a']), null), false)
  assert.equal(sameIdSet(new Set(['a']), new Set(['a', 'b'])), false)
})

// —— shouldStartMarqueeFrom：交互控件上不起拖 ——

test('shouldStartMarqueeFrom：按钮/输入/role=button 不起拖', () => {
  const on = (sel: string) => ({ closest: (_: string) => sel }) as unknown as EventTarget
  assert.equal(shouldStartMarqueeFrom(on('button')), false)
  assert.equal(shouldStartMarqueeFrom(on('[role="button"]')), false)
  assert.equal(shouldStartMarqueeFrom(on('input')), false)
})

test('shouldStartMarqueeFrom：普通容器/卡片可起拖', () => {
  assert.equal(shouldStartMarqueeFrom({ closest: () => null } as unknown as EventTarget), true)
  assert.equal(shouldStartMarqueeFrom(null), true)
  assert.equal(shouldStartMarqueeFrom({} as unknown as EventTarget), true)
})
