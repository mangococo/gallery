/**
 * 旅行日期自动重算的决策逻辑（纯函数，无 electron/db 依赖，node --test 直接测）。
 *
 * 产品语义：「对齐即自动」。trips 表不记日期来源，手动值（.settings.json 导入的、
 * 用户在旅行页改过的）与机器推断值在库里不可区分——显式来源列无法对存量数据回填
 * 正确语义。改为隐式判定：
 *   - 字段为空，或等于「变更前照片集合推导值」→ 视为自动管理，跟随新推导值
 *   - 与变更前推导值不一致 → 视为用户手动设置，永不覆盖
 *   - 清空字段 = 把它交回自动管理（用户后悔手动值时的退出通道）
 *
 * 照片的 takenAt 缺失（NULL）不参与推导（SQL MIN/MAX 天然忽略）；
 * 旅行照片全空/全 NULL 时自动字段清空为 ''，手动字段保留。
 */

import { msToLocalDate } from '../../shared/dates.ts'

/** 旅行照片集合的 takenAt 范围（毫秒；无有效照片时两端为 null） */
export interface TakenAtRange {
  min: number | null
  max: number | null
}

export interface TripDateFields {
  startDate: string | null
  endDate: string | null
}

/**
 * 决策旅行日期 patch：current 为旅行当前存储值，before/after 为照片集合
 * 变更前后的 takenAt 推导范围。无需变更时返回 null。
 */
export function planTripDateRecalc(
  current: TripDateFields,
  before: TakenAtRange,
  after: TakenAtRange,
): { startDate?: string; endDate?: string } | null {
  const start = planField(current.startDate, before.min, after.min)
  const end = planField(current.endDate, before.max, after.max)
  if (start === undefined && end === undefined) return null
  const patch: { startDate?: string; endDate?: string } = {}
  if (start !== undefined) patch.startDate = start
  if (end !== undefined) patch.endDate = end
  return patch
}

/**
 * 单字段决策：返回 undefined 表示不动；'' 表示清空；否则为新日期。
 * 比较一律取本地日期字符串（推导值是时间戳，取整到日再比，不受时刻影响）。
 */
function planField(cur: string | null | undefined, before: number | null, after: number | null): string | undefined {
  const curVal = cur ?? ''
  const afterDate = after !== null ? msToLocalDate(after) : ''
  // 空字段即自动：无论推导值是否变化都跟随填充（半填状态不留）
  if (curVal === '') return afterDate === '' ? undefined : afterDate
  const beforeDate = before !== null ? msToLocalDate(before) : ''
  if (beforeDate === afterDate) return undefined // 推导值没变，非空自动字段无需跟随
  if (beforeDate !== '' && curVal === beforeDate) return afterDate // 自动字段跟随推导值（可能清空）
  return undefined // 与旧推导值不一致 → 手动值，不动
}
