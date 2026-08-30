import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCaptionMap,
  compareFileNames,
  msToLocalDate,
  planReconciliation,
  type DiskFile,
} from '../src/main/services/reconcile.ts'

function disk(entries: [string, number][]): Map<string, DiskFile> {
  return new Map(entries.map(([name, mtimeMs]) => [name.toLowerCase(), { name, mtimeMs }]))
}

test('compareFileNames 数字感知排序', () => {
  const names = ['DSC10.jpg', 'DSC2.jpg', 'DSC1.jpg', 'IMG_9.png', 'IMG_10.png']
  const sorted = [...names].sort(compareFileNames)
  assert.deepEqual(sorted, ['DSC1.jpg', 'DSC2.jpg', 'DSC10.jpg', 'IMG_9.png', 'IMG_10.png'])
})

test('planReconciliation 新文件入库、消失文件删除', () => {
  const d = disk([
    ['a.jpg', 1000],
    ['b.jpg', 2000],
  ])
  const plan = planReconciliation(d, [
    { id: 'p1', fileName: 'a.jpg', fileMtime: 1000 },
    { id: 'p2', fileName: 'c.jpg', fileMtime: 3000 },
  ])
  assert.deepEqual(plan.inserts, [{ name: 'b.jpg', mtimeMs: 2000 }])
  assert.deepEqual(plan.removed, [{ id: 'p2' }])
  assert.deepEqual(plan.replaced, [])
})

test('planReconciliation mtime 变化（>500ms）识别为文件被替换', () => {
  const d = disk([['a.jpg', 1000 + 501]])
  const plan = planReconciliation(d, [{ id: 'p1', fileName: 'a.jpg', fileMtime: 1000 }])
  assert.deepEqual(plan.replaced, [{ id: 'p1', file: { name: 'a.jpg', mtimeMs: 1501 } }])
  assert.deepEqual(plan.inserts, [])
})

test('planReconciliation mtime 微小抖动（≤500ms）不触发替换', () => {
  const d = disk([['a.jpg', 1000 + 500]])
  const plan = planReconciliation(d, [{ id: 'p1', fileName: 'a.jpg', fileMtime: 1000 }])
  assert.deepEqual(plan.replaced, [])
})

test('planReconciliation fileMtime 为 null 的存量记录按被替换处理（重读 EXIF 幂等）', () => {
  const d = disk([['a.jpg', 1000]])
  const plan = planReconciliation(d, [{ id: 'p1', fileName: 'a.jpg', fileMtime: null }])
  assert.deepEqual(plan.replaced.map((r) => r.id), ['p1'])
})

test('planReconciliation 文件名大小写不敏感匹配', () => {
  const d = disk([['IMG_0001.JPG', 1000]])
  const plan = planReconciliation(d, [{ id: 'p1', fileName: 'img_0001.jpg', fileMtime: 1000 }])
  assert.deepEqual(plan.inserts, [])
  assert.deepEqual(plan.replaced, [])
  assert.deepEqual(plan.removed, [])
})

test('buildCaptionMap 大小写不敏感匹配，残留键计数跳过', () => {
  const { map, skipped } = buildCaptionMap(
    { 'DSC01.JPG': '山门', 'dsc02.jpg': '鸟居', gone: '已删除文件' },
    new Set(['dsc01.jpg', 'dsc02.jpg']),
  )
  assert.equal(map.get('dsc01.jpg'), '山门')
  assert.equal(map.get('dsc02.jpg'), '鸟居')
  assert.equal(map.size, 2)
  assert.equal(skipped, 1)
})

test('buildCaptionMap 非字符串值转空串、空输入安全', () => {
  const r1 = buildCaptionMap({ a: 123 } as Record<string, unknown>, new Set(['a']))
  assert.deepEqual([...r1.map.entries()], [['a', '']])
  const r2 = buildCaptionMap(undefined, new Set(['a']))
  assert.equal(r2.map.size, 0)
  assert.equal(r2.skipped, 0)
})

test('msToLocalDate 输出本地时区 YYYY-MM-DD', () => {
  const ms = new Date(2025, 10, 3, 8, 30).getTime() // 本地 2025-11-03 08:30
  assert.equal(msToLocalDate(ms), '2025-11-03')
})
