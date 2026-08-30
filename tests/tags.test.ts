import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeTagNames } from '../src/shared/tags.ts'

test('trim 且去空', () => {
  assert.deepEqual(normalizeTagNames(['  海边 ', '日落', '', '   ']), ['海边', '日落'])
})

test('去重保留首次出现顺序', () => {
  assert.deepEqual(normalizeTagNames(['b', 'a', 'b', 'a', 'c']), ['b', 'a', 'c'])
})

test('trim 后再去重（空白差异不产生重复）', () => {
  assert.deepEqual(normalizeTagNames([' 海边 ', '海边']), ['海边'])
})

test('空数组与全无效输入', () => {
  assert.deepEqual(normalizeTagNames([]), [])
  assert.deepEqual(normalizeTagNames(['', '  ']), [])
})

test('大小写不同视为不同标签（与既有旅行标签行为一致）', () => {
  assert.deepEqual(normalizeTagNames(['Tokyo', 'tokyo']), ['Tokyo', 'tokyo'])
})
