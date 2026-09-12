import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTripDateRecalc, type TakenAtRange } from '../src/main/services/trip-dates.ts'

/** 便捷构造：'2026-05-01 08:00' 本地时间 → ms（时区无关的确定性输入） */
const ms = (s: string): number => new Date(s.replace(' ', 'T')).getTime()

const R = (min?: string | null, max?: string | null): TakenAtRange => ({
  min: min ? ms(`${min} 08:00`) : null,
  max: max ? ms(`${max} 22:00`) : null,
})

test('空日期 + 迁入照片 → 自动填 min/max', () => {
  const patch = planTripDateRecalc(
    { startDate: '', endDate: '' },
    R(null, null),
    R('2026-05-01', '2026-05-03'),
  )
  assert.deepEqual(patch, { startDate: '2026-05-01', endDate: '2026-05-03' })
})

test('自动值随迁出顺延：startDate 等于旧推导 min → 跟随新 min', () => {
  const patch = planTripDateRecalc(
    { startDate: '2026-05-01', endDate: '2026-05-03' },
    R('2026-05-01', '2026-05-03'),
    R('2026-05-02', '2026-05-03'),
  )
  assert.deepEqual(patch, { startDate: '2026-05-02' })
})

test('自动值随迁入扩展：endDate 等于旧推导 max → 跟随新 max', () => {
  const patch = planTripDateRecalc(
    { startDate: '2025-11-02', endDate: '2025-11-05' },
    R('2025-11-02', '2025-11-05'),
    R('2025-11-02', '2026-05-01'),
  )
  assert.deepEqual(patch, { endDate: '2026-05-01' })
})

test('手动值不动：startDate 与旧推导不一致 → 不产出该字段', () => {
  const patch = planTripDateRecalc(
    { startDate: '2024-01-01', endDate: '2025-11-05' },
    R('2025-11-02', '2025-11-05'),
    R('2025-10-01', '2026-05-01'),
  )
  assert.deepEqual(patch, { endDate: '2026-05-01' })
})

test('start/end 两字段独立判定：一自动一手动', () => {
  const patch = planTripDateRecalc(
    { startDate: '2024-01-01', endDate: '' },
    R('2025-11-02', '2025-11-05'),
    R('2025-10-01', '2026-05-01'),
  )
  assert.deepEqual(patch, { endDate: '2026-05-01' })
})

test('照片集合没变（before == after）：已填的自动/手动字段不动；空字段被补齐（扫描器补齐等价行为）', () => {
  const before = R('2026-05-01', '2026-05-03')
  // 已等于推导值的自动字段 + 手动字段：无 patch
  assert.equal(
    planTripDateRecalc({ startDate: '2026-05-01', endDate: '2024-01-01' }, before, { ...before }),
    null,
  )
  // 空字段即使集合没变也补齐；再次调用（已填值=推导值）即幂等无 patch
  assert.deepEqual(
    planTripDateRecalc({ startDate: '', endDate: '' }, before, { ...before }),
    { startDate: '2026-05-01', endDate: '2026-05-03' },
  )
})

test('移空旅行：自动值清空为 ""，手动值保留', () => {
  const patch = planTripDateRecalc(
    { startDate: '2026-05-01', endDate: '2024-01-01' },
    R('2026-05-01', '2026-05-03'),
    R(null, null),
  )
  assert.deepEqual(patch, { startDate: '' })
})

test('移入单张照片 → start == end 同日', () => {
  const patch = planTripDateRecalc(
    { startDate: '', endDate: '' },
    R(null, null),
    R('2026-05-01', '2026-05-01'),
  )
  assert.deepEqual(patch, { startDate: '2026-05-01', endDate: '2026-05-01' })
})

test('当前值与旧推导同日即可视为自动（时间戳取整到本地日期比较，不受时刻影响）', () => {
  // 推导 min 的日期 = 2026-05-01（哪怕存储值是当天深夜 23:59 转出的字符串）
  const patch = planTripDateRecalc(
    { startDate: '2026-05-01', endDate: '' },
    { min: ms('2026-05-01 23:59'), max: ms('2026-05-02 00:01') },
    R('2026-05-01', '2026-05-02'),
  )
  assert.deepEqual(patch, { endDate: '2026-05-02' })
})

test('NULL/undefined 当前值按空串处理（DB 行的 NULL 语义）', () => {
  const patch = planTripDateRecalc(
    { startDate: null as unknown as string, endDate: undefined as unknown as string },
    R(null, null),
    R('2026-05-01', '2026-05-02'),
  )
  assert.deepEqual(patch, { startDate: '2026-05-01', endDate: '2026-05-02' })
})

test('before 有值 after 为 null 且当前为空 → 不产出（幂等：二次重算无变化）', () => {
  // 场景：移空后 startDate 已清成 ''，再次对同一状态重算（before 快照取自更早）不复活旧值
  const patch = planTripDateRecalc(
    { startDate: '', endDate: '' },
    R('2026-05-01', '2026-05-03'),
    R(null, null),
  )
  assert.equal(patch, null)
})
