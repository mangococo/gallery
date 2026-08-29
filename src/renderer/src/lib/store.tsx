import React from 'react'
import { api } from './api'
import { applyTheme } from './theme'
import type { Album, ScanProgress, Stats, ThemeMode, TripDTO } from '@shared/types'

export interface TripFilters {
  favoritesOnly: boolean
  tags: string[]
  year: string | null
}

interface AppState {
  ready: boolean
  albums: Album[]
  activeAlbumId: string | null
  trips: TripDTO[]
  stats: Stats | null
  progress: ScanProgress | null
  filters: TripFilters
  setFilters: (patch: Partial<TripFilters>) => void
  theme: ThemeMode
  setTheme: (mode: ThemeMode) => Promise<void>
  reloadAlbums: () => Promise<void>
  reloadTrips: () => Promise<void>
  reloadStats: () => Promise<void>
  setActiveAlbum: (id: string) => Promise<void>
  refreshAll: () => Promise<void>
}

const Ctx = React.createContext<AppState | null>(null)

export function useApp(): AppState {
  const v = React.useContext(Ctx)
  if (!v) throw new Error('useApp 必须在 AppProvider 内使用')
  return v
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = React.useState(false)
  const [albums, setAlbums] = React.useState<Album[]>([])
  const [activeAlbumId, setActiveAlbumId] = React.useState<string | null>(null)
  const [trips, setTrips] = React.useState<TripDTO[]>([])
  const [stats, setStats] = React.useState<Stats | null>(null)
  const [progress, setProgress] = React.useState<ScanProgress | null>(null)
  const [filters, setFiltersState] = React.useState<TripFilters>({
    favoritesOnly: false,
    tags: [],
    year: null,
  })
  const [theme, setThemeState] = React.useState<ThemeMode>('system')
  const [systemDark, setSystemDark] = React.useState(false)

  const setFilters = React.useCallback((patch: Partial<TripFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }))
  }, [])

  const reloadAlbums = React.useCallback(async () => {
    setAlbums(await api.listAlbums())
  }, [])

  const reloadTrips = React.useCallback(async () => {
    const id = await api.getActiveAlbumId()
    setActiveAlbumId(id)
    setTrips(id ? await api.listTrips(id) : [])
  }, [])

  const reloadStats = React.useCallback(async () => {
    setStats(await api.getStats())
  }, [])

  const refreshAll = React.useCallback(async () => {
    await Promise.all([reloadAlbums(), reloadTrips(), reloadStats()])
  }, [reloadAlbums, reloadTrips, reloadStats])

  React.useEffect(() => {
    void (async () => {
      const boot = await api.bootstrap()
      setThemeState(boot.theme)
      setSystemDark(boot.systemDark)
      applyTheme(boot.theme, boot.systemDark)
      await refreshAll()
      setReady(true)
    })()
  }, [refreshAll])

  // 主进程推送：扫描进度 / 文件系统变化 / 系统主题
  React.useEffect(() => {
    const offProgress = api.onScanProgress((p) => {
      setProgress(p.done >= p.total && p.phase === 'thumb' ? null : p)
    })
    const offFs = api.onFsChanged(() => {
      void refreshAll()
    })
    const offTheme = api.onThemeSystemChanged(({ systemDark: dark }) => {
      setSystemDark(dark)
    })
    return () => {
      offProgress()
      offFs()
      offTheme()
    }
  }, [refreshAll])

  // 主题模式或系统明暗变化 → 重新落地 data-theme
  React.useEffect(() => {
    applyTheme(theme, systemDark)
  }, [theme, systemDark])

  const setTheme = React.useCallback(async (mode: ThemeMode) => {
    setThemeState(mode)
    await api.setTheme(mode)
  }, [])

  const setActiveAlbum = React.useCallback(
    async (id: string) => {
      await api.setActiveAlbum(id)
      setActiveAlbumId(id)
      setTrips(await api.listTrips(id))
      // 切换相册后旧筛选（标签/年份）不再适用
      setFiltersState({ favoritesOnly: false, tags: [], year: null })
    },
    [],
  )

  return (
    <Ctx.Provider
      value={{
        ready,
        albums,
        activeAlbumId,
        trips,
        stats,
        progress,
        filters,
        setFilters,
        theme,
        setTheme,
        reloadAlbums,
        reloadTrips,
        reloadStats,
        setActiveAlbum,
        refreshAll,
      }}
    >
      {children}
    </Ctx.Provider>
  )
}
