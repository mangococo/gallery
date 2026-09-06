import type { ThemeDefinition, ThemePaletteId } from './types.ts'

/**
 * Theme Registry —— 主题注册表
 *
 * 新增一个主题的完整步骤（详见 docs/theme.md「如何新增主题」）：
 *   1. tokens CSS 里新增 [data-palette='<id>'] 及其 dark 块（完整映射所有语义 token）；
 *   2. 在这里注册元数据；
 *   3. 补 tests/theme.test.ts 的 CONTRACT 期望（required 列表自动覆盖新 palette）。
 * 组件与页面不需要任何改动。
 */
export const THEMES: readonly ThemeDefinition[] = [
  { id: 'default', name: '暖纸', description: '米白暖棕 · 明亮手账' },
  { id: 'candle', name: '烛光', description: '蜜色琥珀 · 烛光暗房' },
  { id: 'yuebai', name: '月白', description: '素白青灰 · 月下素笺' },
  { id: 'dailan', name: '黛蓝', description: '黛蓝靛青 · 深海信笺' },
  { id: 'qingci', name: '青瓷', description: '青瓷釉色 · 梅雨影格' },
]

export const DEFAULT_THEME: ThemePaletteId = 'default'

export function isThemeId(v: unknown): v is ThemePaletteId {
  return typeof v === 'string' && THEMES.some((t) => t.id === v)
}
