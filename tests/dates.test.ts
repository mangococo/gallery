import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  dateToLocalStr,
  formatDotDate,
  formatDotFromMs,
  msToLocalDate,
  parseLocalDate,
} from '../src/shared/dates.ts'

test('msToLocalDate 取本地日历日期（本地 00:30 不被 UTC 甩到前一天）', () => {
  // 本地 2025-11-03 00:30：东八区下 toISOString 会得到 11-02，这里必须仍是 11-03
  assert.equal(msToLocalDate(new Date(2025, 10, 3, 0, 30).getTime()), '2025-11-03')
  assert.equal(msToLocalDate(new Date(2025, 10, 3, 23, 59).getTime()), '2025-11-03')
})

test('dateToLocalStr ⇄ parseLocalDate 本地往返不丢日', () => {
  const d = new Date(2026, 0, 5, 23, 59) // 本地深夜
  const s = dateToLocalStr(d)
  assert.equal(s, '2026-01-05')
  const back = parseLocalDate(s)
  assert.equal(back.getTime(), new Date(2026, 0, 5).getTime()) // 本地午夜
})

test('parseLocalDate 非法输入返回 NaN 日期', () => {
  assert.ok(isNaN(parseLocalDate('').getTime()))
  assert.ok(isNaN(parseLocalDate('2025/11/03').getTime()))
  assert.ok(isNaN(parseLocalDate('abc').getTime()))
})

test('formatDotDate 正常/空/非法输入', () => {
  assert.equal(formatDotDate('2025-11-02'), '2025.11.02')
  assert.equal(formatDotDate(''), '——')
  assert.equal(formatDotDate('raw'), 'raw')
})

test('formatDotFromMs 用本地日期展示拍摄时间', () => {
  assert.equal(formatDotFromMs(new Date(2025, 4, 1, 3, 0).getTime()), '2025.05.01')
})
