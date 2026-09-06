import React from 'react'
import { api } from './api'
import type { Album, ScanProgress, Stats, TripDTO } from '@shared/types'

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
  /** ⌘K 搜索面板开关 */
  searchOpen: boolean
  setSearchOpen: (v: boolean) => void
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
  const [searchOpen, setSearchOpen] = React.useState(false)
  /** 旅行数据请求序号：切相册/文件变化并发时，旧响应不再覆盖新相册的数据 */
  const tripsSeq = React.useRef(0)

  const setFilters = React.useCallback((patch: Partial<TripFilters>) => {
    setFiltersState((prev) => ({ ...prev, ...patch }))
  }, [])

  const reloadAlbums = React.useCallback(async () => {
    setAlbums(await api.listAlbums())
  }, [])

  const reloadTrips = React.useCallback(async () => {
    const seq = ++tripsSeq.current
    const id = await api.getActiveAlbumId()
    const list = id ? await api.listTrips(id) : []
    if (tripsSeq.current !== seq) return
    setActiveAlbumId(id)
    setTrips(list)
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
      await refreshAll()
      setReady(true)
    })()
  }, [refreshAll])

  // 主进程推送：扫描进度 / 文件系统变化
  React.useEffect(() => {
    const offProgress = api.onScanProgress((p) => {
      setProgress(p.done >= p.total && p.phase === 'thumb' ? null : p)
    })
    const offFs = api.onFsChanged(() => {
      void refreshAll()
    })
    return () => {
      offProgress()
      offFs()
    }
  }, [refreshAll])

  const setActiveAlbum = React.useCallback(
    async (id: string) => {
      const seq = ++tripsSeq.current
      await api.setActiveAlbum(id)
      const list = await api.listTrips(id)
      if (tripsSeq.current !== seq) return // 已有更新的切换，丢弃本次结果
      setActiveAlbumId(id)
      setTrips(list)
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
        searchOpen,
        setSearchOpen,
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
