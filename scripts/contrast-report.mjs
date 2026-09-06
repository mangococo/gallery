#!/usr/bin/env node
/**
 * Theme 对比度报告（WCAG 2.x）
 *
 * 用法：node scripts/contrast-report.mjs
 * 解析 src/renderer/src/theme/tokens/*.css 的四个 (palette × mode) 组合，
 * 打印 tests/theme.test.ts 契约中全部前景/背景对的对比度。
 * 数值不达标时退出码非 0（与 tests/theme.test.ts 同一套阈值）。
 */
import {
  BODY_PAIRS,
  LARGE_PAIRS,
  MIN_BODY_RATIO,
  MIN_LARGE_RATIO,
  MODES,
  PALETTES,
  contrast,
  evaluateVar,
  getToken,
  resolvedTokens,
} from '../tests/theme-token-engine.ts'

let failed = false

for (const palette of PALETTES) {
  for (const mode of MODES) {
    const vars = resolvedTokens(palette, mode)
    console.log(`\n== ${palette} / ${mode} ==`)
    const rows = [
      ...BODY_PAIRS.map(([fg, bg]) => [fg, bg, MIN_BODY_RATIO]),
      ...LARGE_PAIRS.map(([fg, bg]) => [fg, bg, MIN_LARGE_RATIO]),
    ]
    for (const [fg, bg, min] of rows) {
      const fgColor = evaluateVar(vars, fg)
      const bgColor = evaluateVar(vars, bg)
      const ratio = contrast(fgColor, bgColor)
      const ok = ratio >= min
      if (!ok) failed = true
      console.log(
        `  ${ok ? ' ✓' : '✗'} ${fg.padEnd(16)} on ${bg.padEnd(12)} ${ratio.toFixed(2).padStart(5)}:1` +
          `  (≥${min})  ${fgColor} / ${bgColor}${getToken(vars, fg) === undefined ? '  [缺失]' : ''}`,
      )
    }
  }
}

console.log(failed ? '\n存在不达标配对' : '\n全部达标')
process.exit(failed ? 1 : 0)
