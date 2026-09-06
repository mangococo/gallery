import type { ThemeMode, ThemePaletteId } from '@shared/types'

export type { ThemeMode, ThemePaletteId }

/** mode=system 经 OS 明暗解析后的实际模式 */
export type ResolvedMode = 'light' | 'dark'

/** 主题注册表条目（变量本体在 CSS token 层，见 docs/theme.md） */
export interface ThemeDefinition {
  id: ThemePaletteId
  name: string
  description: string
}
