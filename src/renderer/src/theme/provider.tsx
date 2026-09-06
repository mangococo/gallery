import React from 'react'
import { api } from '../lib/api'
import { DEFAULT_THEME, THEMES, isThemeId } from './registry'
import { applyTheme, readThemeCache, resolveMode, writeThemeCache } from './runtime'
import type { ResolvedMode, ThemeDefinition, ThemeMode, ThemePaletteId } from './types'

export interface ThemeContextValue {
  /** 用户选择的模式（'system' = 跟随 OS） */
  mode: ThemeMode
  /** 当前主题 id（registry 里的 palette） */
  theme: ThemePaletteId
  /** 解析后的实际明暗（mode=system 时随 OS 变化） */
  resolvedMode: ResolvedMode
  systemDark: boolean
  /** 注册表元数据（设置页选择器消费） */
  themes: readonly ThemeDefinition[]
  setMode: (mode: ThemeMode) => Promise<void>
  setTheme: (id: ThemePaletteId) => Promise<void>
}

const Ctx = React.createContext<ThemeContextValue | null>(null)

export function useTheme(): ThemeContextValue {
  const v = React.useContext(Ctx)
  if (!v) throw new Error('useTheme 必须在 ThemeProvider 内使用')
  return v
}

/**
 * Theme Runtime —— 主题运行时
 *
 * 职责：持有 mode/palette/systemDark 状态，解析 resolvedMode 并落到
 * <html data-palette data-mode>；持久化走主进程 settings（复用 theme_mode 键 +
 * 新增 theme_palette 键），localStorage 只作首帧防闪烁镜像。
 * 不引入任何状态管理框架：Context + CSS 变量 + Tailwind 适配器即全部。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 同步初始化：首帧（React 渲染完成、IPC 未返回）就带上缓存的主题
  const [boot] = React.useState(readThemeCache)
  const [mode, setModeState] = React.useState<ThemeMode>(boot.mode)
  const [theme, setThemeState] = React.useState<ThemePaletteId>(boot.palette)
  const [systemDark, setSystemDark] = React.useState(boot.systemDark)

  const resolvedMode = resolveMode(mode, systemDark)

  // 状态 → DOM 属性（useLayoutEffect：绘制前落地，避免语义层闪到错误矩阵）
  React.useLayoutEffect(() => {
    applyTheme(theme, resolvedMode)
  }, [theme, resolvedMode])

  // 状态 → 首帧缓存镜像（主进程 settings 才是持久化真相）
  React.useEffect(() => {
    writeThemeCache(mode, theme)
  }, [mode, theme])

  // 启动校准：以主进程 settings 为准覆盖缓存
  React.useEffect(() => {
    void (async () => {
      const [savedMode, savedPalette] = await Promise.all([api.getTheme(), api.getThemePalette()])
      setModeState(savedMode)
      if (isThemeId(savedPalette)) setThemeState(savedPalette)
    })()
  }, [])

  // 主进程推送：OS 明暗变化（nativeTheme updated），mode=system 时实时跟随
  React.useEffect(() => {
    const off = api.onThemeSystemChanged(({ systemDark: dark }) => {
      setSystemDark(dark)
    })
    return () => {
      off()
    }
  }, [])

  // 自定义样式（userData/theme.css）：注入到所有 token 样式之后（同特异性下后者胜出），
  // 文件保存即热更新。用户可用语义 token 覆盖任意颜色（docs/theme.md §6）。
  React.useEffect(() => {
    let el = document.getElementById('gallery-custom-css') as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = 'gallery-custom-css'
      document.head.appendChild(el)
    }
    const apply = (css: string | null) => {
      el!.textContent = css ?? ''
    }
    void api.getThemeCustomCss().then(apply)
    return api.onThemeCustomCssChanged(apply)
  }, [])

  const setMode = React.useCallback(async (m: ThemeMode) => {
    setModeState(m)
    await api.setTheme(m)
  }, [])

  const setTheme = React.useCallback(async (id: ThemePaletteId) => {
    setThemeState(id)
    await api.setThemePalette(id)
  }, [])

  const value = React.useMemo<ThemeContextValue>(
    () => ({
      mode,
      theme,
      resolvedMode,
      systemDark,
      themes: THEMES,
      setMode,
      setTheme,
    }),
    [mode, theme, resolvedMode, systemDark, setMode, setTheme],
  )

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export { DEFAULT_THEME, THEMES, isThemeId } from './registry'
export { applyTheme, resolveMode } from './runtime'
export type { ResolvedMode, ThemeDefinition, ThemeMode, ThemePaletteId } from './types'
