/**
 * Theme System 公共出口。
 * 组件统一 `import { useTheme } from '../theme'`；
 * CSS 变量层见 src/renderer/src/theme/tokens/（架构文档 docs/theme.md）。
 */
export { ThemeProvider, useTheme, DEFAULT_THEME, THEMES, isThemeId } from './provider'
export type { ThemeContextValue } from './provider'
export { applyTheme, resolveMode, readThemeCache, writeThemeCache } from './runtime'
export type {
  ResolvedMode,
  ThemeDefinition,
  ThemeMode,
  ThemePaletteId,
} from './types'
