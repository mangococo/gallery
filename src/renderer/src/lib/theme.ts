import type { ThemeMode } from '@shared/types'

/** 把主题模式落到 <html data-theme>，供 CSS 变量切换 */
export function applyTheme(mode: ThemeMode, systemDark: boolean): void {
  const resolved = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  document.documentElement.dataset.theme = resolved
}
