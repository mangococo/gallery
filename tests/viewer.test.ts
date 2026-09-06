import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  clampView,
  cursorForView,
  formatTakenStamp,
  formatVideoClock,
  MIN_ZOOM,
  TOGGLE_ZOOM_FACTOR,
  toggleZoomAtPoint,
  zoomAtPoint,
} from '../src/renderer/src/lib/viewer.ts'

test('clampView：zoom<=1 强制归位', () => {
  assert.deepEqual(clampView({ zoom: 1, x: 40, y: -20 }, 800, 600, 400, 300), {
    zoom: MIN_ZOOM,
    x: 0,
    y: 0,
  })
})

test('clampView：平移范围按溢出的一半钳制', () => {
  // 拍立得 800×600，缩放 2 倍 = 1600×1200，舞台 1000×800 → maxX=300, maxY=200
  const v = clampView({ zoom: 2, x: 500, y: -300 }, 1000, 800, 800, 600)
  assert.equal(v.x, 300)
  assert.equal(v.y, -200)
})

test('clampView：图片小于舞台时不可平移', () => {
  const v = clampView({ zoom: 2, x: 100, y: 100 }, 2000, 2000, 500, 400)
  assert.equal(v.x, 0)
  assert.equal(v.y, 0)
})

test('zoomAtPoint：指针锚点缩放保持指针下内容不动', () => {
  // 从 zoom1 → 2，指针在内容中心右侧 100px：锚点内容应保持在指针下
  const next = zoomAtPoint({ zoom: 1, x: 0, y: 0 }, 100, 0, 2, Infinity, Infinity, Infinity, Infinity)
  assert.equal(next.zoom, 2)
  assert.equal(next.x, -100)
  assert.equal(next.y, 0)
})

test('zoomAtPoint：到达上下限后不再变化', () => {
  const atMax = zoomAtPoint({ zoom: 8, x: 0, y: 0 }, 0, 0, 1.5, 1000, 1000, 800, 600)
  assert.equal(atMax.zoom, 8)
  assert.deepEqual(atMax, { zoom: 8, x: 0, y: 0 })
  const atMin = zoomAtPoint({ zoom: 1, x: 30, y: 30 }, 0, 0, 1 / 1.5, 1000, 1000, 800, 600)
  assert.deepEqual(atMin, { zoom: 1, x: 0, y: 0 })
})

test('formatVideoClock：分秒与小时格式', () => {
  assert.equal(formatVideoClock(0), '0:00')
  assert.equal(formatVideoClock(87), '1:27')
  assert.equal(formatVideoClock(600), '10:00')
  assert.equal(formatVideoClock(3675), '1:01:15')
  assert.equal(formatVideoClock(NaN), '0:00')
})

test('formatTakenStamp：时间戳 → 手账日期', () => {
  // 固定时区无关断言：用本地时间构造
  const d = new Date(2026, 4, 12, 14, 32)
  assert.equal(formatTakenStamp(d.getTime()), '2026.05.12 · 14:32')
  assert.equal(formatTakenStamp(null), '')
  assert.equal(formatTakenStamp(NaN), '')
})

// —— 单击缩放切换（灯箱重设计） ——

test('toggleZoomAtPoint：fit 单击 → 以指针为锚点放大', () => {
  const v = toggleZoomAtPoint({ zoom: MIN_ZOOM, x: 0, y: 0 }, 100, -50)
  assert.equal(v.zoom, TOGGLE_ZOOM_FACTOR)
  // 锚点保持在指针位置：x = -px·(k-1)
  assert.equal(v.x, -100 * (TOGGLE_ZOOM_FACTOR - 1))
  assert.equal(v.y, 50 * (TOGGLE_ZOOM_FACTOR - 1))
})

test('toggleZoomAtPoint：非 fit 单击 → 复位 fit（平移一并归零）', () => {
  const v = toggleZoomAtPoint({ zoom: 2.5, x: 120, y: -80 }, 100, -50)
  assert.deepEqual(v, { zoom: MIN_ZOOM, x: 0, y: 0 })
})

test('toggleZoomAtPoint：连续两次切换回到原状态', () => {
  const fit = { zoom: MIN_ZOOM, x: 0, y: 0 }
  const zoomed = toggleZoomAtPoint(fit, 0, 0)
  const back = toggleZoomAtPoint(zoomed, 0, 0)
  assert.deepEqual(back, fit)
})

test('toggleZoomAtPoint：放大受 MAX_ZOOM 钳制', () => {
  // 自定义超大 factor → zoom 不超过 MAX_ZOOM
  const v = toggleZoomAtPoint({ zoom: MIN_ZOOM, x: 0, y: 0 }, 0, 0, Infinity, Infinity, Infinity, Infinity, 100)
  assert.equal(v.zoom, 8)
})

test('cursorForView：fit→zoom-in，zoom→zoom-out，拖拽中→grabbing', () => {
  assert.equal(cursorForView(MIN_ZOOM, false), 'zoom-in')
  assert.equal(cursorForView(2.5, false), 'zoom-out')
  assert.equal(cursorForView(2.5, true), 'grabbing')
  assert.equal(cursorForView(MIN_ZOOM, true), 'grabbing')
})

test('cursorForView：滚轮缩回 fit 后恢复 zoom-in（与点击行为一致）', () => {
  // 滚轮放大（zoomAtPoint）到非 fit → zoom-out；滚轮缩回 → zoom-in
  const zoomed = zoomAtPoint({ zoom: MIN_ZOOM, x: 0, y: 0 }, 0, 0, 1.18)
  assert.equal(cursorForView(zoomed.zoom, false), 'zoom-out')
  const back = zoomAtPoint(zoomed, 0, 0, 1 / 1.18)
  assert.equal(back.zoom, MIN_ZOOM)
  assert.equal(cursorForView(back.zoom, false), 'zoom-in')
})
