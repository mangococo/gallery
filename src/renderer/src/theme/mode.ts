import type { ThemeMode } from '@shared/types'

export type { ThemeMode } from '@shared/types'

/** mode=system 时按 OS 明暗解析；light/dark 原样返回。纯函数，node --test 直接可测。 */
export function resolveMode(mode: ThemeMode, systemDark: boolean): 'light' | 'dark' {
  if (mode === 'system') return systemDark ? 'dark' : 'light'
  return mode
}
