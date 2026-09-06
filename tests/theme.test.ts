import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  getToken,
  BODY_PAIRS,
  COOL_PALETTES,
  LARGE_PAIRS,
  MIN_BODY_RATIO,
  MIN_LARGE_RATIO,
  MODES,
  PALETTES,
  REQUIRED_RUNTIME_INPUTS,
  REQUIRED_TOKENS,
  WARM_PALETTES,
  contrast,
  parseTokenRules,
  resolveCombo,
  resolvedTokens,
  evaluateVar,
} from './theme-token-engine.ts'
import { resolveMode } from '../src/renderer/src/theme/mode.ts'
import { DEFAULT_THEME, THEMES, isThemeId } from '../src/renderer/src/theme/registry.ts'
import { readThemeCache, writeThemeCache } from '../src/renderer/src/theme/runtime.ts'

/**
 * Theme System 契约测试（docs/theme.md §契约）
 *
 * - Contract：每个 (palette × mode) 组合都必须定义完整语义 token、
 *   Runtime 输入有 fallback、foreground 成对。
 * - Contrast：正文小字 ≥ 4.5:1，展示大字 ≥ 3:1（WCAG 2.x，按组合逐一计算）。
 * - Runtime：resolveMode 三态解析矩阵、registry 一致性、首帧缓存回退。
 * - Persistence：localStorage 镜像的容错（真重启持久化由 E2E 链路 17 覆盖）。
 */

function combo(palette: (typeof PALETTES)[number], mode: (typeof MODES)[number]) {
  return resolvedTokens(palette, mode)
}

test('Contract：四个组合的语义 token 全量存在', () => {
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      const vars = combo(palette, mode)
      for (const name of REQUIRED_TOKENS) {
        assert.ok(getToken(vars, name), `${palette}/${mode} 缺少 token: ${name}`)
      }
      assert.equal(
        vars['--gt-accent'] !== undefined,
        true,
        `${palette}/${mode} 缺少 runtime 输入 --gt-accent`,
      )
      for (const input of REQUIRED_RUNTIME_INPUTS) {
        assert.ok(vars[input], `${palette}/${mode} 缺少 runtime 输入 ${input}`)
      }
    }
  }
})

test('Contract：runtime 输入有合法 fallback（:root 层定义）', () => {
  const rootVars = resolveCombo(parseTokenRules(), 'default', 'light')
  for (const input of REQUIRED_RUNTIME_INPUTS) {
    assert.ok(rootVars[input], `:root 缺少 ${input} 的 fallback`)
  }
})

test('Contract：foreground 成对（每个 surface 都有配对墨色）', () => {
  const pairs: [surface: string, fg: string][] = [
    ['background', 'ink'],
    ['surface', 'ink'],
    ['surface-2', 'ink'],
    ['polaroid', 'ink'],
    ['primary', 'primary-ink'],
    ['primary-soft', 'primary-soft-ink'],
    ['danger', 'danger-ink'],
    ['viewer', 'viewer-ink'],
    ['tape', 'tape-ink'],
    ['scrim', 'scrim-ink'],
  ]
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      const vars = combo(palette, mode)
      for (const [surface, fg] of pairs) {
        assert.ok(getToken(vars, fg), `${palette}/${mode}: ${surface} 缺少配对前景 ${fg}`)
      }
    }
  }
})

test('Contract：变量引用图无未定义引用（求值全图）', () => {
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      // resolvedTokens 内部会 evaluateVar 全部变量，任何悬空 var() 都会抛错
      const vars = resolvedTokens(palette, mode)
      assert.ok(Object.keys(vars).length >= REQUIRED_TOKENS.length)
    }
  }
})

test('Contrast：正文小字 ≥ 4.5:1（全部组合 × 全部配对）', () => {
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      const vars = combo(palette, mode)
      for (const [fg, bg] of BODY_PAIRS) {
        const ratio = contrast(evaluateVar(vars, fg), evaluateVar(vars, bg))
        assert.ok(
          ratio >= MIN_BODY_RATIO,
          `${palette}/${mode} ${fg} on ${bg} = ${ratio.toFixed(2)}:1（要求 ≥ ${MIN_BODY_RATIO}）`,
        )
      }
    }
  }
})

test('Contrast：展示大字/标题 ≥ 3:1（全部组合）', () => {
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      const vars = combo(palette, mode)
      for (const [fg, bg] of LARGE_PAIRS) {
        const ratio = contrast(evaluateVar(vars, fg), evaluateVar(vars, bg))
        assert.ok(
          ratio >= MIN_LARGE_RATIO,
          `${palette}/${mode} ${fg} on ${bg} = ${ratio.toFixed(2)}:1（要求 ≥ ${MIN_LARGE_RATIO}）`,
        )
      }
    }
  }
})

test('Contract：照片遮罩不随主题翻转（scrim 恒黑、scrim-ink 恒白）', () => {
  for (const palette of PALETTES) {
    for (const mode of MODES) {
      const vars = combo(palette, mode)
      assert.equal(getToken(vars, "scrim"), '#000000')
      assert.equal(getToken(vars, "scrim-ink"), '#ffffff')
    }
  }
})

test('Contract：暗色身份——暖系保持暖褐烛光，冷系保持色相不漂成中性黑', () => {
  for (const palette of WARM_PALETTES) {
    const vars = combo(palette, 'dark')
    // 暗色背景必须带暖色偏移：蓝通道不得高于红通道太多（b - r ≤ 6）
    const bg = getToken(vars, 'background')
    assert.ok(bg, `${palette} 暗色缺少 background`)
    const r = parseInt(bg.slice(1, 3), 16)
    const b = parseInt(bg.slice(5, 7), 16)
    assert.ok(
      b - r <= 6 && r >= 16,
      `${palette} 暗色背景 ${bg} 偏冷，背离暖褐烛光品牌`,
    )
  }
  for (const palette of COOL_PALETTES) {
    const vars = combo(palette, 'dark')
    const bg = getToken(vars, 'background')
    assert.ok(bg, `${palette} 暗色缺少 background`)
    const r = parseInt(bg.slice(1, 3), 16)
    const g = parseInt(bg.slice(3, 5), 16)
    const b = parseInt(bg.slice(5, 7), 16)
    assert.ok(
      b >= r && Math.max(r, g, b) - Math.min(r, g, b) >= 3 && r + g + b >= 30,
      `${palette} 暗色背景 ${bg} 失去冷色相（漂成中性黑）`,
    )
  }
})

test('Registry：注册表与 CSS data-palette 块一致', () => {
  // default palette 由 :root 兜底表达；其余 palette 必须有显式 [data-palette] 块
  const explicitPalettes = new Set(
    parseTokenRules()
      .flatMap((r) => r.selectors)
      .map((s) => /\[data-palette='([^']+)'\]/.exec(s)?.[1])
      .filter((v): v is string => Boolean(v)),
  )
  assert.ok(explicitPalettes.has('candle'), 'candle 缺少显式 [data-palette] 块')
  for (const id of explicitPalettes) {
    assert.ok(THEMES.some((t) => t.id === id), `CSS 里的 palette ${id} 未在 registry 注册`)
  }
  // registry 与引擎的解析矩阵一致（组合测试靠 PALETTES 驱动）
  assert.deepEqual(
    [...THEMES.map((t) => t.id)].sort(),
    [...PALETTES].sort(),
  )
  assert.ok(THEMES.some((t) => t.id === DEFAULT_THEME))
})

test('Registry：isThemeId 判定', () => {
  assert.equal(isThemeId('default'), true)
  assert.equal(isThemeId('candle'), true)
  assert.equal(isThemeId('midnight'), false)
  assert.equal(isThemeId(null), false)
})

test('Runtime：resolveMode 三态解析矩阵', () => {
  assert.equal(resolveMode('light', false), 'light')
  assert.equal(resolveMode('light', true), 'light')
  assert.equal(resolveMode('dark', false), 'dark')
  assert.equal(resolveMode('dark', true), 'dark')
  assert.equal(resolveMode('system', false), 'light')
  assert.equal(resolveMode('system', true), 'dark')
})

test('Persistence：首帧缓存容错（node 环境 / 脏值回退默认）', () => {
  // node 进程无 window/localStorage：readThemeCache 必须安全回退而不是抛错
  const cache = readThemeCache()
  assert.deepEqual(cache, { mode: 'system', palette: 'default', systemDark: false })
  // writeThemeCache 在无 localStorage 环境必须静默不抛
  assert.doesNotThrow(() => writeThemeCache('dark', 'candle'))
})
