import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverFirstOrder } from '../src/renderer/src/lib/media.ts'

test('coverFirstOrder：封面排到首位，其余保持原相对顺序', () => {
  const photos = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
  assert.deepEqual(
    coverFirstOrder(photos, 'b').map((p) => p.id),
    ['b', 'a', 'c'],
  )
})

test('coverFirstOrder：无封面 / 封面已是第一张 / 封面不在列表 → 原样返回', () => {
  const photos = [{ id: 'a' }, { id: 'b' }]
  assert.equal(coverFirstOrder(photos, null), photos)
  assert.equal(coverFirstOrder(photos, undefined), photos)
  assert.deepEqual(
    coverFirstOrder(photos, 'a').map((p) => p.id),
    ['a', 'b'],
  )
  // 封面已删/跨旅行引用：不打乱展示顺序
  assert.equal(coverFirstOrder(photos, 'ghost'), photos)
})

test('coverFirstOrder：空列表安全', () => {
  assert.deepEqual(coverFirstOrder([], 'x'), [])
})
