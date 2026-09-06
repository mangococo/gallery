import type { ThemeMode, ThemePaletteId } from '@shared/types'
import { isThemeId } from './registry.ts'

export type { ResolvedMode } from './types.ts'
export { resolveMode } from './mode.ts'
import type { ResolvedMode } from './types.ts'

/** 把 palette + 解析后的 mode 落到 <html data-palette data-mode>，驱动 CSS 变量矩阵切换 */
export function applyTheme(palette: ThemePaletteId, resolved: ResolvedMode): void {
  const el = document.documentElement
  el.dataset.palette = palette
  el.dataset.mode = resolved
}

// —— 首帧防闪烁缓存 ——
// 主进程 settings 表是持久化的唯一真相；这里是渲染层的同步镜像，
// 让 JS 生效前的首帧就带上上次退出时的主题（IPC 返回后再校准）。
const MODE_KEY = 'gallery:theme-mode'
const PALETTE_KEY = 'gallery:theme-palette'

export interface ThemeCache {
  mode: ThemeMode
  palette: ThemePaletteId
  systemDark: boolean
}

/** 同步读取本地镜像 + OS 明暗；非浏览器环境或值损坏时回退默认（system/default） */
export function readThemeCache(): ThemeCache {
  const fallback: ThemeCache = { mode: 'system', palette: 'default', systemDark: false }
  if (typeof window === 'undefined') return fallback
  let mode: string | null = null
  let palette: string | null = null
  try {
    mode = localStorage.getItem(MODE_KEY)
    palette = localStorage.getItem(PALETTE_KEY)
  } catch {
    return fallback
  }
  return {
    mode: mode === 'light' || mode === 'dark' || mode === 'system' ? mode : 'system',
    palette: isThemeId(palette) ? palette : 'default',
    systemDark: window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false,
  }
}

export function writeThemeCache(mode: ThemeMode, palette: ThemePaletteId): void {
  try {
    localStorage.setItem(MODE_KEY, mode)
    localStorage.setItem(PALETTE_KEY, palette)
  } catch {
    // 隐私模式等场景下缓存不可写，不影响功能（主进程 settings 仍是真相）
  }
}
