import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectMatches, rankOf, compareHits } from '../src/shared/search.ts'
import type { SearchMatchIn } from '../src/shared/types'

test('collectMatches：各字段命中', () => {
  const m = collectMatches(
    '京都 · 岚山秋色',
    '三天两夜的独旅',
    ['日本', '红叶'],
    '红叶',
    true,
    false,
  )
  assert.deepEqual(m, ['tags', 'caption'])
})

test('collectMatches：大小写不敏感（Unicode 友好的 JS 侧匹配）', () => {
  const m = collectMatches('Tokyo Trip', 'Description', [], 'tokyo', false, false)
  assert.deepEqual(m, ['title'])
})

test('collectMatches：全不命中为空数组（调用方据此跳过）', () => {
  const m = collectMatches('a', 'b', ['c'], 'zzz', false, false)
  assert.deepEqual(m, [])
})

test('collectMatches：照片标签命中独立于旅行标签', () => {
  const m = collectMatches('大理', '', ['云南'], '雪山', false, true)
  assert.deepEqual(m, ['photoTag'])
})

test('rankOf：标题 < 标签 < 描述 < 图注 < 照片标签', () => {
  const rank = (ms: SearchMatchIn[]) => rankOf(ms)
  assert.ok(rank(['title']) < rank(['tags']))
  assert.ok(rank(['tags']) < rank(['description']))
  assert.ok(rank(['description']) < rank(['caption']))
  assert.ok(rank(['caption']) < rank(['photoTag']))
  assert.equal(rank(['title', 'photoTag']), 0) // 取最优字段
})

test('compareHits：同名次开始日期倒序，名次优先于日期', () => {
  assert.ok(
    compareHits({ rank: 0, startDate: '2025-01-01' }, { rank: 1, startDate: '2099-01-01' }) < 0,
  )
  assert.ok(
    compareHits({ rank: 2, startDate: '2025-01-01' }, { rank: 2, startDate: '2024-01-01' }) < 0,
  )
  assert.equal(
    compareHits({ rank: 1, startDate: '2025-01-01' }, { rank: 1, startDate: '2025-01-01' }),
    0,
  )
})
