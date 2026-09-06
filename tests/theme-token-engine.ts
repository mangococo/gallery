/**
 * Theme token 契约引擎（测试与 scripts/contrast-report.mjs 共用）
 *
 * 按级联顺序解析 src/renderer/src/theme/tokens/*.css，把每个
 * (palette × mode) 组合解析成具体颜色，供契约断言与 WCAG 对比度计算。
 * 纯 node 实现：支持 var() 递归、color-mix(in srgb, …)、rgb(… / a)。
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const TOKENS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../src/renderer/src/theme/tokens')

/** 层序即级联顺序（与 index.css @import 顺序一致） */
const LAYER_FILES = ['primitive.css', 'runtime-inputs.css', 'semantic.css', 'gallery.css']

export const PALETTES = ['default', 'candle', 'yuebai', 'dailan', 'qingci'] as const
/** 暖褐烛光家族（暗色必须保持暖褐身份，见 tests/theme.test.ts） */
export const WARM_PALETTES = ['default', 'candle'] as const
/** 冷调家族（月白/黛蓝/青瓷）：暗色必须保留冷色相，不允许漂成中性黑 */
export const COOL_PALETTES = ['yuebai', 'dailan', 'qingci'] as const
export const MODES = ['light', 'dark'] as const
export type Palette = (typeof PALETTES)[number]
export type Mode = (typeof MODES)[number]

export interface CssRule {
  selectors: string[]
  decls: Record<string, string>
}

function parseCss(text: string): CssRule[] {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, '')
  const rules: CssRule[] = []
  const block = /([^{}]+)\{([^{}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = block.exec(stripped))) {
    const selectors = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    const decls: Record<string, string> = {}
    for (const decl of m[2].split(';')) {
      const i = decl.indexOf(':')
      if (i > 0) decls[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
    }
    rules.push({ selectors, decls })
  }
  return rules
}

export function parseTokenRules(): CssRule[] {
  return LAYER_FILES.flatMap((f) => parseCss(readFileSync(join(TOKENS_DIR, f), 'utf8')))
}

function selectorMatches(selector: string, palette: Palette, mode: Mode): boolean {
  if (selector === ':root') return true
  // 复合选择器如 [data-palette='candle'][data-mode='dark'] 无空格分隔，需逐个提取属性选择器
  const attrs = selector.match(/\[[^\]=]+(?:='[^']*')?\]/g)
  if (!attrs || attrs.join('') !== selector.replace(/\s+/g, '')) return false
  return attrs.every((p) => {
    const attr = /^\[([^\]=]+)(?:='([^']+)')?\]$/.exec(p)
    if (!attr) return false
    const [, name, value] = attr
    if (name === 'data-palette') return value === palette
    if (name === 'data-mode') return value === mode
    return false
  })
}

/** 组合覆盖层：按文件层序 + 文件内声明顺序叠加（模拟 CSS 级联） */
export function resolveCombo(rules: CssRule[], palette: Palette, mode: Mode): Record<string, string> {
  const vars: Record<string, string> = {}
  for (const rule of rules) {
    if (rule.selectors.some((s) => selectorMatches(s, palette, mode))) {
      for (const [k, v] of Object.entries(rule.decls)) {
        if (k.startsWith('--')) vars[k] = v
      }
    }
  }
  return vars
}

function toRgb(color: string): [number, number, number, number] {
  const c = color.trim()
  if (c.startsWith('#')) {
    const hex = c.slice(1)
    const full = hex.length === 3 ? hex.split('').map((x) => x + x).join('') : hex
    return [
      parseInt(full.slice(0, 2), 16),
      parseInt(full.slice(2, 4), 16),
      parseInt(full.slice(4, 6), 16),
      full.length >= 8 ? parseInt(full.slice(6, 8), 16) / 255 : 1,
    ]
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(c)
  if (fn) {
    const parts = fn[1].split(/[\s,/]+/).filter(Boolean)
    const alpha = parts.length >= 4 ? parseFloat(parts[3]) : 1
    return [parseFloat(parts[0]), parseFloat(parts[1]), parseFloat(parts[2]), alpha]
  }
  throw new Error(`无法解析颜色: ${color}`)
}

function toHex([r, g, b]: [number, number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/** 语义 token 用裸名（background），CSS 变量带前缀（--background）——这里统一 */
function key(name: string): string {
  return name.startsWith('--') ? name : `--${name}`
}

/** 取语义 token 的原始值（未求值） */
export function getToken(vars: Record<string, string>, name: string): string | undefined {
  return vars[key(name)]
}

/** 递归展开 var() 与 color-mix(in srgb, …)，得到具体颜色 */
function expand(value: string, vars: Record<string, string>): string {
  let v = value
  for (let i = 0; i < 12; i++) {
    const next = v.replace(/var\((--[a-z0-9-]+)\)/g, (_all, ref: string) => {
      const resolved = vars[ref]
      if (resolved === undefined) throw new Error(`引用了未定义的 ${ref}`)
      return resolved
    })
    if (next === v) break
    v = next
  }
  if (v.includes('var(')) throw new Error(`存在未解析的 var() 引用: ${v}`)
  const mix = /color-mix\(in srgb,\s*([^,]+?)\s+([0-9.]+)%,\s*(.+)\)/.exec(v)
  if (mix) {
    const [, c1Raw, pctRaw, c2Raw] = mix
    const pct = parseFloat(pctRaw) / 100
    const [r1, g1, b1] = toRgb(expand(c1Raw, vars))
    const [r2, g2, b2] = toRgb(expand(c2Raw, vars))
    return toHex([r1 * pct + r2 * (1 - pct), g1 * pct + g2 * (1 - pct), b1 * pct + b2 * (1 - pct), 1])
  }
  return v.trim()
}

/** 求值单个变量名，返回具体颜色字符串 */
export function evaluateVar(vars: Record<string, string>, name: string): string {
  const raw = getToken(vars, name)
  if (raw === undefined) throw new Error(`token 缺失: ${name}`)
  return expand(raw, vars)
}

/** 相对亮度（WCAG 2.x） */
export function luminance(color: string): number {
  const [r, g, b] = toRgb(color)
  const lin = [r, g, b].map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
}

export function contrast(fg: string, bg: string): number {
  const [l1, l2] = [luminance(fg), luminance(bg)].sort((a, b) => b - a)
  return (l1 + 0.05) / (l2 + 0.05)
}

/** 解析一个组合下所有语义 token 的具体颜色 */
export function resolvedTokens(palette: Palette, mode: Mode): Record<string, string> {
  const rules = parseTokenRules()
  const vars = resolveCombo(rules, palette, mode)
  const out: Record<string, string> = {}
  for (const name of Object.keys(vars)) out[name] = evaluateVar(vars, name)
  return out
}

/** 必须在每个 (palette × mode) 组合中存在的语义 token（公开 API） */
export const REQUIRED_TOKENS = [
  // 基础层
  'background', 'surface', 'surface-2', 'line',
  'primary', 'primary-soft', 'primary-ink', 'primary-soft-ink',
  'ink', 'ink-2', 'ink-3',
  'danger', 'danger-ink', 'success', 'warning',
  'overlay',
  // 产品语义层
  'viewer', 'viewer-2', 'viewer-ink', 'viewer-ink-2',
  'scrim', 'scrim-ink', 'tape', 'tape-ink', 'polaroid',
] as const

/** 必须存在的 Runtime 输入 */
export const REQUIRED_RUNTIME_INPUTS = ['--gt-accent', '--gt-accent-ink', '--gt-accent-soft'] as const

/** 正文小字对比度 ≥ 4.5:1 的前景/背景对 */
export const BODY_PAIRS: [fg: string, bg: string][] = [
  ['ink', 'background'], ['ink-2', 'background'], ['ink-3', 'background'],
  ['ink', 'surface'], ['ink-2', 'surface'], ['ink-3', 'surface'],
  ['ink', 'surface-2'], ['ink-2', 'surface-2'], ['ink-3', 'surface-2'],
  ['ink', 'polaroid'], ['ink-2', 'polaroid'],
  ['primary-ink', 'primary'],
  ['primary-soft-ink', 'primary-soft'],
  ['danger-ink', 'danger'],
  ['success', 'background'], ['warning', 'background'],
  ['viewer-ink', 'viewer'], ['viewer-ink-2', 'viewer'],
  ['tape-ink', 'tape'],
  ['scrim-ink', 'scrim'],
]

/** 展示大字/加粗标题对比度 ≥ 3:1 的对（text-primary 标题等） */
export const LARGE_PAIRS: [fg: string, bg: string][] = [
  ['primary', 'background'],
  ['primary', 'surface'],
]

export const MIN_BODY_RATIO = 4.5
export const MIN_LARGE_RATIO = 3
