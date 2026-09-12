import { test } from 'node:test'
import assert from 'node:assert/strict'
import { eligibleMigrationTargets } from '../src/renderer/src/lib/trip-migrate.ts'

const trips = [
  { id: 'a', title: '京都', status: 'ok' as const, photos: [{ id: 'p1' }, { id: 'p2' }] },
  { id: 'b', title: '冰岛', status: 'ok' as const, photos: [{ id: 'p3' }] },
  { id: 'c', title: '缺失旅行', status: 'missing' as const, photos: [{ id: 'p4' }] },
  { id: 'd', title: '无状态旅行', photos: [] },
]

test('eligibleMigrationTargets：排除被删除旅行本身', () => {
  const out = eligibleMigrationTargets(trips, 'a')
  assert.equal(out.some((t) => t.id === 'a'), false)
  // 排除自身 a 与缺失 c 后剩 b、d
  assert.equal(out.length, 2)
})

test('eligibleMigrationTargets：排除文件夹缺失的旅行（文件无从迁移）', () => {
  const out = eligibleMigrationTargets(trips, 'a')
  assert.equal(out.some((t) => t.id === 'c'), false)
})

test('eligibleMigrationTargets：status 缺省按正常处理（兼容旧调用方）', () => {
  const out = eligibleMigrationTargets(trips, 'a')
  assert.equal(out.some((t) => t.id === 'd'), true)
})

test('eligibleMigrationTargets：空/缺失入参返回空数组', () => {
  assert.deepEqual(eligibleMigrationTargets([], 'a'), [])
  assert.deepEqual(eligibleMigrationTargets(undefined, 'a'), [])
  assert.deepEqual(eligibleMigrationTargets(null, 'a'), [])
})

test('eligibleMigrationTargets：唯一旅行被删除自身时无候选', () => {
  const only = [{ id: 'x', title: '唯一', status: 'ok' as const, photos: [{ id: 'p' }] }]
  assert.deepEqual(eligibleMigrationTargets(only, 'x'), [])
})
