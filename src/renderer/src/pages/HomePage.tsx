import React from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useApp } from '../lib/store'
import { api } from '../lib/api'
import { Trip, Photo } from '../types'
import TimelineItem from '../components/TimelineItem'
import TimelineAddButton from '../components/TimelineAddButton'
import AddTripModal from '../components/AddTripModal'
import PhotoWall from '../components/PhotoWall'
import Lightbox from '../components/Lightbox'
import CaptionEditor from '../components/CaptionEditor'
import PhotoTagEditor from '../components/PhotoTagEditor'
import MoveToTripDialog from '../components/MoveToTripDialog'
import { confirmAndDeleteTrip } from '../lib/trip-actions'
import { useEscClaim, isEscTop } from '../lib/esc'
import { indexAfterRemoval } from '../lib/viewer'
import { showContextMenuAt } from '../components/ContextMenu'
import {
  buildEmptyAreaMenu,
  buildPhotoBatchMenu,
  buildPhotoMenu,
  buildTripMenu,
  type PhotoMenuHandlers,
  type PhotoMenuIcons,
  type TripMenuHandlers,
} from '../lib/context-menus'
import { toast, confirmDialog } from '../components/feedback'
import { hasMediaExt } from '../lib/media'
import {
  ArrowLeftIcon,
  CopyIcon,
  GridIcon,
  HeartIcon,
  MoveToFolderIcon,
  PenIcon,
  PlusIcon,
  RefreshIcon,
  RevealIcon,
  SelectIcon,
  TagIcon,
  TimelineIcon,
  TrashIcon,
  XIcon,
  CameraIcon,
} from '../components/icons'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** 右键菜单图标集（模块级常量，避免每次渲染重建） */
const photoMenuIcons: PhotoMenuIcons = {
  open: <CameraIcon size={14} />,
  caption: <PenIcon size={14} />,
  tag: <TagIcon size={14} />,
  favorite: <HeartIcon size={14} />,
  move: <MoveToFolderIcon size={14} />,
  reveal: <RevealIcon size={14} />,
  copy: <CopyIcon size={14} />,
  select: <SelectIcon size={14} />,
  trash: <TrashIcon size={14} />,
}

/** 首页视图偏好：会话级 localStorage（与筛选一样属于轻量 UI 偏好，默认时间线） */
const HOME_VIEW_KEY = 'gallery.home_view'
function loadHomeView(): 'timeline' | 'wall' {
  try {
    return localStorage.getItem(HOME_VIEW_KEY) === 'wall' ? 'wall' : 'timeline'
  } catch {
    return 'timeline'
  }
}

/** 照片墙首屏渲染条数，滚动到底部按此步长增量追加（内容走 content-visibility 惰性渲染） */
const WALL_CHUNK = 500

const HomePage: React.FC = () => {
  const navigate = useNavigate()
  const { albums, activeAlbumId, trips, filters, setFilters, refreshAll } = useApp()
  const [showAddModal, setShowAddModal] = React.useState(false)
  /** 首页视图：时间线（默认） / 照片墙；偏好记入 localStorage，跨启动保留 */
  const [viewMode, setViewMode] = React.useState<'timeline' | 'wall'>(loadHomeView)
  const switchView = (mode: 'timeline' | 'wall') => {
    setViewMode(mode)
    try {
      localStorage.setItem(HOME_VIEW_KEY, mode)
    } catch {
      // 隐私模式等存不进就算了
    }
  }
  /** 照片墙：灯箱 / 编辑弹层 / 多选 */
  const [wallLightboxIndex, setWallLightboxIndex] = React.useState<number | null>(null)
  const [captionTarget, setCaptionTarget] = React.useState<Photo | null>(null)
  const [tagTarget, setTagTarget] = React.useState<Photo | null>(null)
  const [moveTarget, setMoveTarget] = React.useState<Photo[] | null>(null)
  const [wallSelectionMode, setWallSelectionMode] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  /** 照片墙增量渲染：先渲染 WALL_CHUNK 张，哨兵进入视口再追加 */
  const [wallLimit, setWallLimit] = React.useState(WALL_CHUNK)
  const wallSentinelRef = React.useRef<HTMLDivElement | null>(null)
  /** 删除确认弹窗打开期间锁住，防重复点击 */
  const [deletingTripId, setDeletingTripId] = React.useState<string | null>(null)
  /** 「导入照片到这次旅行」的隐藏文件选择器 */
  const importTripRef = React.useRef<Trip | null>(null)
  const importInputRef = React.useRef<HTMLInputElement>(null)

  const activeAlbum = albums.find((a) => a.id === activeAlbumId) ?? null

  // 应用筛选和排序（开始日期倒序 + 标签/收藏/年份叠加）
  const filteredTrips = React.useMemo(() => {
    let filtered = [...trips]
    filtered.sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))

    if (filters.favoritesOnly) {
      filtered = filtered.filter((t) => t.isFavorite)
    }
    if (filters.tags.length > 0) {
      filtered = filtered.filter((t) => t.tags.some((tag) => filters.tags.includes(tag)))
    }
    if (filters.year) {
      filtered = filtered.filter((t) => (t.startDate || '').slice(0, 4) === filters.year)
    }
    return filtered
  }, [trips, filters])

  const photoTotal = React.useMemo(
    () => filteredTrips.reduce((acc, t) => acc + (t.photos?.length || 0), 0),
    [filteredTrips],
  )

  /**
   * 照片墙数据源：全部（筛选后）旅行中的照片与视频拍平。
   * 排序沿用画廊一贯约定——最新在前（时间线按 start_date 倒序的同类逻辑），
   * 拍摄时间缺失的排在末尾、按库内顺序。tripTitle 供灯箱与右键菜单展示上下文。
   */
  const wallPhotos = React.useMemo(() => {
    const all: (Photo & { tripTitle?: string })[] = []
    for (const t of filteredTrips) {
      for (const p of t.photos ?? []) {
        all.push({ ...p, tripTitle: t.title })
      }
    }
    return all.sort((a, b) => (b.takenAt ?? 0) - (a.takenAt ?? 0))
  }, [filteredTrips])

  const visibleWallPhotos = React.useMemo(() => wallPhotos.slice(0, wallLimit), [wallPhotos, wallLimit])

  // 哨兵进入视口 → 追加下一批（数据多于当前渲染量时才观察）
  React.useEffect(() => {
    const el = wallSentinelRef.current
    if (!el || viewMode !== 'wall' || wallPhotos.length <= wallLimit) return
    const ob = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setWallLimit((n) => Math.min(n + WALL_CHUNK, wallPhotos.length))
        }
      },
      { rootMargin: '1200px' },
    )
    ob.observe(el)
    return () => ob.disconnect()
  }, [viewMode, wallPhotos.length, wallLimit])

  // 数据变化后渲染窗口收敛（删除/切换相册后不留多余窗口），多选勾选只保留仍可见的照片
  React.useEffect(() => {
    setWallLimit((n) => (n <= WALL_CHUNK ? n : Math.max(WALL_CHUNK, Math.min(n, wallPhotos.length + WALL_CHUNK))))
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(wallPhotos.map((p: Photo) => p.id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [wallPhotos])

  // ESC 退出照片墙多选（灯箱/弹窗打开时不抢——它们已认领更高的 Esc 处理权）
  const selectionEscRef = useEscClaim(wallSelectionMode)
  React.useEffect(() => {
    if (!wallSelectionMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!isEscTop(selectionEscRef.current)) return
      setWallSelectionMode(false)
      setSelectedIds(new Set())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallSelectionMode, selectionEscRef])

  const activeFilterChips: { label: string; icon?: 'heart'; clear: () => void }[] = [
    ...(filters.favoritesOnly
      ? [{ label: '收藏', icon: 'heart' as const, clear: () => setFilters({ favoritesOnly: false }) }]
      : []),
    ...filters.tags.map((tag) => ({
      label: `#${tag}`,
      clear: () => setFilters({ tags: filters.tags.filter((t) => t !== tag) }),
    })),
    ...(filters.year
      ? [{ label: filters.year + ' 年', clear: () => setFilters({ year: null }) }]
      : []),
  ]

  const handleTripAdded = async () => {
    await refreshAll()
  }

  const handleToggleFavorite = async (tripId: string) => {
    const trip = trips.find((t) => t.id === tripId)
    if (!trip) return
    await window.api.updateTrip(tripId, { isFavorite: !trip.isFavorite })
    await refreshAll()
  }

  /** 首次点击缺失旅行的确认弹窗期间锁住，防重复触发 */
  const [openingTripId, setOpeningTripId] = React.useState<string | null>(null)

  /**
   * 点击旅行 = 打开旅行页；但文件夹已被移出相册目录的旅行（status === 'missing'）
   * 打开只会看到一堆失效图片——首次点击即提示是否删除该旅行记录，取消则留在首页。
   */
  const handleOpenTrip = async (tripId: string) => {
    const trip = trips.find((t) => t.id === tripId)
    if (!trip) return
    if (trip.status === 'missing') {
      if (openingTripId) return
      setOpeningTripId(tripId)
      const deleted = await confirmAndDeleteTrip({
        id: trip.id,
        title: trip.title,
        photoCount: trip.photos?.length || 0,
        status: trip.status,
      })
      if (deleted) await refreshAll()
      setOpeningTripId(null)
      return
    }
    navigate(`/trip/${tripId}`)
  }

  const handleDeleteTrip = async (tripId: string) => {
    if (deletingTripId) return
    const trip = trips.find((t) => t.id === tripId)
    if (!trip) return
    setDeletingTripId(tripId)
    const deleted = await confirmAndDeleteTrip({
      id: trip.id,
      title: trip.title,
      photoCount: trip.photos?.length || 0,
      status: trip.status,
    })
    if (deleted) await refreshAll()
    setDeletingTripId(null)
  }

  const rescanActiveAlbum = async () => {
    if (!activeAlbumId) return
    await api.rescanAlbum(activeAlbumId)
    await refreshAll()
  }

  /** 时间线旅行卡片右键 */
  const tripMenuHandlers: TripMenuHandlers = {
    onOpen: (trip) => void handleOpenTrip(trip.id),
    onEdit: (trip) => navigate(`/trip/${trip.id}`, { state: { edit: true } }),
    onImport: (trip) => {
      importTripRef.current = trip
      importInputRef.current?.click()
    },
    onToggleFavorite: (trip) => void handleToggleFavorite(trip.id),
    onRescan: () => void rescanActiveAlbum(),
    onDelete: (trip) => void handleDeleteTrip(trip.id),
  }

  const handleTripContextMenu = (e: React.MouseEvent, trip: Trip) => {
    showContextMenuAt(
      e,
      buildTripMenu(trip, tripMenuHandlers, {
        open: <ArrowLeftIcon size={14} />,
        edit: <PenIcon size={14} />,
        import: <CameraIcon size={14} />,
        favorite: <HeartIcon size={14} />,
        rescan: <RefreshIcon size={14} />,
        trash: <TrashIcon size={14} />,
      }),
    )
  }

  /** 时间线空白区右键 */
  const handleTimelineContextMenu = (e: React.MouseEvent) => {
    // 目标是容器本身才触发（点在卡片上由卡片自己的菜单接管）
    if (e.target !== e.currentTarget) return
    showContextMenuAt(
      e,
      buildEmptyAreaMenu(
        'home',
        {
          onNewTrip: () => setShowAddModal(true),
          onRescan: activeAlbumId ? () => void rescanActiveAlbum() : undefined,
          onRefresh: () => void refreshAll(),
        },
        { newTrip: <PlusIcon size={14} />, rescan: <RefreshIcon size={14} />, refresh: <RefreshIcon size={14} /> },
      ),
    )
  }

  /** 右键「导入照片到这次旅行」的文件选择回调 */
  const handleImportToTrip = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const target = importTripRef.current
    const files = event.target.files
    event.target.value = ''
    if (!target || !files || files.length === 0) return
    const paths = Array.from(files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
      .map((f) => api.getPathForFile(f))
      .filter((p) => !!p)
    if (paths.length === 0) return
    try {
      const { photos: imported, failed } = await api.importPhotos(target.id, paths)
      if (failed.length > 0) {
        const etc = failed.length > 1 ? ` 等 ${failed.length} 个` : ''
        toast(`已导入 ${imported.length} 张到「${target.title}」；${failed[0].name}${etc}导入失败（${failed[0].reason}）`, 'info')
      } else {
        toast(`已导入 ${imported.length} 张到「${target.title}」`, 'success')
      }
      await refreshAll()
    } catch (error: any) {
      toast('导入照片失败: ' + error.message, 'error')
    }
  }

  // —— 照片墙（首页）动作集 ——
  // 数据全部来自 store（trips），改动后统一 refreshAll 重拉，不维护第二份本地状态

  const handleWallPhotoClick = (photo: Photo) => {
    setWallLightboxIndex(wallPhotos.findIndex((p: Photo) => p.id === photo.id))
  }

  const handleWallToggleSelect = (photo: Photo) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(photo.id)) next.delete(photo.id)
      else next.add(photo.id)
      return next
    })
    setWallSelectionMode(true)
  }

  const handleWallToggleFavorite = async (photoId: string, favorite: boolean) => {
    try {
      await api.setPhotoFavorite(photoId, favorite)
    } catch (error: any) {
      toast('操作失败: ' + error.message, 'error')
      return
    }
    await refreshAll()
  }

  const handleWallDeletePhotos = async (photos: Photo[]) => {
    if (photos.length === 0) return
    const ok = await confirmDialog({
      title: photos.length === 1 ? '把这张照片移入回收站？' : `把 ${photos.length} 项移入回收站？`,
      body: photos.length === 1 ? photos[0].fileName : '所选照片与视频将移入回收站，可随时恢复。',
      confirmText: '移入回收站',
      danger: true,
    })
    if (!ok) return
    const ids = new Set(photos.map((p) => p.id))
    try {
      await Promise.all([...ids].map((photoId) => api.deletePhoto(photoId)))
    } catch (error: any) {
      toast('删除失败: ' + error.message, 'error')
      return
    }
    // 灯箱开着时跟随收缩（当前张还在则跟随，被删则原地接管）；删空则关闭
    setWallLightboxIndex((cur) =>
      cur === null
        ? null
        : indexAfterRemoval(wallPhotos.map((p: Photo) => p.id), ids, cur),
    )
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((x) => !ids.has(x)))
      if (next.size === 0) setWallSelectionMode(false)
      return next
    })
    toast(`已移入回收站（${ids.size} 项）`, 'success')
    await refreshAll()
  }

  const handleWallMoved = async () => {
    setSelectedIds(new Set())
    setWallSelectionMode(false)
    setWallLightboxIndex(null)
    toast('已移动', 'success')
    await refreshAll()
  }

  const handleWallReveal = async (photo: Photo) => {
    try {
      await api.revealPhotoInFolder(photo.id)
    } catch (error: any) {
      toast('定位文件失败: ' + error.message, 'error')
    }
  }

  const handleWallCopyPath = async (photo: Photo) => {
    try {
      const path = await api.copyPhotoPath(photo.id)
      toast(`已复制路径：${path.split('/').pop() ?? path}`, 'success')
    } catch (error: any) {
      toast('复制路径失败: ' + error.message, 'error')
    }
  }

  /** 首页照片墙右键菜单动作集（与旅行页同一套构建器） */
  const wallPhotoMenuHandlers: PhotoMenuHandlers = {
    onOpen: (photo) => handleWallPhotoClick(photo),
    onEditCaption: (photo) => setCaptionTarget(photo),
    onEditTags: (photo) => setTagTarget(photo),
    onToggleFavorite: (p, favorite) => void handleWallToggleFavorite(p.id, favorite),
    onBatchFavorite: (photos, favorite) => {
      void (async () => {
        try {
          await Promise.all(photos.map((p) => api.setPhotoFavorite(p.id, favorite)))
        } catch (error: any) {
          toast('操作失败: ' + error.message, 'error')
          return
        }
        await refreshAll()
      })()
    },
    onMove: (photos) => {
      if (photos.length > 0) setMoveTarget(photos)
    },
    onReveal: (photo) => void handleWallReveal(photo),
    onCopyPath: (photo) => void handleWallCopyPath(photo),
    onDelete: (photos) => void handleWallDeletePhotos(photos),
    onEnterSelect: (photo) => {
      setSelectedIds(new Set([photo.id]))
      setWallSelectionMode(true)
    },
  }

  /** 照片卡片右键：选择态下命中集合 → 批量菜单；否则单张菜单（⌘点与多选语义由 PhotoWall 处理） */
  const handleWallPhotoContextMenu = (e: React.MouseEvent, photo: Photo) => {
    if (wallSelectionMode) {
      if (selectedIds.has(photo.id) && selectedIds.size > 1) {
        const sel = wallPhotos.filter((p: Photo) => selectedIds.has(p.id))
        showContextMenuAt(e, buildPhotoBatchMenu(sel, wallPhotoMenuHandlers, photoMenuIcons))
        return
      }
      setSelectedIds(new Set([photo.id]))
    }
    showContextMenuAt(
      e,
      buildPhotoMenu(photo, wallPhotoMenuHandlers, photoMenuIcons, { canSelect: true, isMac }),
    )
  }

  /** 首页空白区右键：视图语境下的操作 */
  const handleHomeContextMenu = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    showContextMenuAt(
      e,
      buildEmptyAreaMenu(
        viewMode === 'wall' ? 'trip-page' : 'home',
        viewMode === 'wall'
          ? { onRescan: activeAlbumId ? () => void rescanActiveAlbum() : undefined, onRefresh: () => void refreshAll() }
          : {
              onNewTrip: () => setShowAddModal(true),
              onRescan: activeAlbumId ? () => void rescanActiveAlbum() : undefined,
              onRefresh: () => void refreshAll(),
            },
        { newTrip: <PlusIcon size={14} />, rescan: <RefreshIcon size={14} />, refresh: <RefreshIcon size={14} /> },
      ),
    )
  }

  return (
    <div className="min-h-screen">
      {/* 内容区顶栏（可拖拽） */}
      <header className="drag-region sticky top-0 z-10 h-12 bg-background/85 backdrop-blur-sm border-b border-line flex items-center justify-between pl-8 pr-5">
        <div className="flex items-baseline gap-3 min-w-0">
          <h1 className="font-display font-bold text-xl text-ink truncate">
            {activeAlbum ? activeAlbum.name : '画廊'}
          </h1>
          <span className="text-xs text-ink-3 whitespace-nowrap">
            {filteredTrips.length} 次旅行 · {photoTotal} 张照片
          </span>
          {activeFilterChips.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2 no-drag">
              {activeFilterChips.map((chip) => (
                <button
                  key={chip.label}
                  onClick={chip.clear}
                  className="px-2 py-0.5 bg-primary-soft text-primary-soft-ink text-xs rounded-full hover:opacity-80 transition-opacity flex items-center gap-1"
                >
                  {chip.icon === 'heart' && <HeartIcon size={11} filled />}
                  <span>{chip.label}</span>
                  <XIcon size={10} />
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 no-drag">
          {/* 视图切换：时间线 / 照片墙（与旅行页「照片/地图」切换同款视觉） */}
          <div className="flex items-center bg-surface-2 rounded-full p-0.5" role="tablist" aria-label="首页视图">
            {(['timeline', 'wall'] as const).map((mode) => (
              <button
                key={mode}
                role="tab"
                aria-selected={viewMode === mode}
                data-testid={`home-view-${mode}`}
                onClick={() => switchView(mode)}
                className={`px-3 py-1 rounded-full text-xs transition-colors flex items-center gap-1.5 ${
                  viewMode === mode ? 'bg-surface text-primary shadow-sm' : 'text-ink-3 hover:text-ink-2'
                }`}
              >
                {mode === 'timeline' ? <TimelineIcon size={12} /> : <GridIcon size={12} />}
                <span>{mode === 'timeline' ? '时间线' : '照片墙'}</span>
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-1.5 bg-primary text-primary-ink rounded-lg text-sm hover:opacity-90 transition-opacity shrink-0 flex items-center gap-1"
          >
            <PlusIcon size={13} />
            <span>新旅行</span>
          </button>
        </div>
      </header>

      {/* 时间线（默认视图） */}
      <div
        className="max-w-[880px] mx-auto px-10 py-12"
        onContextMenu={handleTimelineContextMenu}
        hidden={viewMode !== 'timeline'}
      >
        <div className="relative">
          {filteredTrips.length > 0 && (
            <div className="stitch-line absolute left-[70px] top-3 bottom-0 w-[2px]" />
          )}

          <div className="relative">
            {filteredTrips.map((trip: Trip, index) => (
              <React.Fragment key={trip.id}>
                {index > 0 && <TimelineAddButton onAdd={() => setShowAddModal(true)} />}
                <TimelineItem
                  trip={trip}
                  onEdit={handleOpenTrip}
                  onToggleFavorite={handleToggleFavorite}
                  onDelete={handleDeleteTrip}
                  onContextMenu={handleTripContextMenu}
                />
              </React.Fragment>
            ))}
            {filteredTrips.length > 0 && (
              <TimelineAddButton onAdd={() => setShowAddModal(true)} />
            )}
          </div>

          {/* 空状态 */}
          {filteredTrips.length === 0 && trips.length > 0 && (
            <div className="text-center py-24">
              <p className="text-ink-3 mb-4 font-display text-lg">这一页还没有符合条件的旅行</p>
              <button
                onClick={() => setFilters({ favoritesOnly: false, tags: [], year: null })}
                className="px-6 py-2.5 bg-primary text-primary-ink rounded-xl hover:opacity-90 transition-opacity text-sm"
              >
                清除筛选
              </button>
            </div>
          )}

          {trips.length === 0 && (
            <div className="text-center py-24">
              {activeAlbum?.status === 'missing' ? (
                <>
                  <p className="text-ink-3 mb-2 font-display text-2xl">相册目录暂不可访问</p>
                  <p className="text-ink-3 text-sm mb-8">
                    外置磁盘未连接，或目录被移走了。连上后在左侧点击该相册即可重新定位。
                  </p>
                </>
              ) : (
                <>
                  <p className="text-ink-3 mb-2 font-display text-2xl">翻开第一页旅行手账</p>
                  <p className="text-ink-3 text-sm mb-8">
                    {activeAlbum
                      ? '点右上角「新旅行」，或把照片拖进窗口'
                      : '先在左侧「相册」点击加号注册照片目录'}
                  </p>
                  {activeAlbum && (
                    <button
                      onClick={() => setShowAddModal(true)}
                      className="px-6 py-2.5 bg-primary text-primary-ink rounded-xl hover:opacity-90 transition-opacity text-sm"
                    >
                      创建第一次旅行
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 照片墙视图：全部旅行的媒体按拍摄时间排布 */}
      {viewMode === 'wall' && (
        <div className="max-w-[1200px] mx-auto px-10 py-10" onContextMenu={handleHomeContextMenu}>
          {wallPhotos.length > 0 ? (
            <>
              <div className="flex items-center justify-between mb-5">
                <p className="text-sm text-ink-3">
                  {photoTotal} 张照片与视频 · 按拍摄时间从新到旧
                </p>
                {selectedIds.size > 0 && (
                  <span className="text-sm text-ink-2 font-display">已选 {selectedIds.size} 项</span>
                )}
              </div>
              <PhotoWall
                photos={visibleWallPhotos}
                onPhotoClick={handleWallPhotoClick}
                onDeletePhoto={(photoId) => {
                  const p = wallPhotos.find((x: Photo) => x.id === photoId)
                  if (p) void handleWallDeletePhotos([p])
                }}
                onEditCaption={setCaptionTarget}
                onToggleFavorite={(photoId, favorite) => void handleWallToggleFavorite(photoId, favorite)}
                selectionMode={wallSelectionMode}
                selectedIds={selectedIds}
                onToggleSelect={handleWallToggleSelect}
                onPhotoContextMenu={handleWallPhotoContextMenu}
              />
              {wallPhotos.length > wallLimit && (
                <div ref={wallSentinelRef} className="py-10 text-center">
                  <button
                    onClick={() => setWallLimit((n) => Math.min(n + WALL_CHUNK, wallPhotos.length))}
                    className="px-6 py-2.5 bg-surface-2 text-ink-2 rounded-xl hover:text-ink transition-colors text-sm"
                  >
                    继续浏览（还有 {wallPhotos.length - wallLimit} 张）
                  </button>
                </div>
              )}
            </>
          ) : trips.length > 0 ? (
            <div className="text-center py-24">
              <p className="text-ink-3 mb-2 font-display text-2xl">还没有照片</p>
              <p className="text-ink-3 text-sm mb-8">进入一次旅行添加照片，或把照片拖进窗口导入。</p>
              <button
                onClick={() => switchView('timeline')}
                className="px-6 py-2.5 bg-primary text-primary-ink rounded-xl hover:opacity-90 transition-opacity text-sm"
              >
                回到时间线
              </button>
            </div>
          ) : (
            <div className="text-center py-24">
              <p className="text-ink-3 mb-2 font-display text-2xl">还没有照片</p>
              <p className="text-ink-3 text-sm mb-8">
                {activeAlbum
                  ? '点右上角「新旅行」，或把照片拖进窗口'
                  : '先在左侧「相册」点击加号注册照片目录'}
              </p>
            </div>
          )}
        </div>
      )}

      {showAddModal && (
        <AddTripModal onClose={() => setShowAddModal(false)} onSuccess={handleTripAdded} />
      )}

      {/* 照片墙多选工具条 */}
      {wallSelectionMode && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-surface border border-line shadow-xl rounded-full pl-5 pr-2 py-1.5 no-drag"
          data-testid="selection-bar"
        >
          <span className="text-sm text-ink font-display whitespace-nowrap">
            已选 {selectedIds.size} 张
          </span>
          <span className="w-px h-5 bg-line mx-1.5" />
          <button
            onClick={() => {
              const sel = wallPhotos.filter((p: Photo) => selectedIds.has(p.id))
              if (sel.length > 0) setMoveTarget(sel)
            }}
            className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors flex items-center gap-1.5"
          >
            <MoveToFolderIcon size={14} />
            <span>移动</span>
          </button>
          <button
            onClick={() => {
              const sel = wallPhotos.filter((p: Photo) => selectedIds.has(p.id))
              void (async () => {
                try {
                  await Promise.all(sel.map((p) => api.setPhotoFavorite(p.id, !sel.every((x) => x.favorite))))
                } catch (error: any) {
                  toast('操作失败: ' + error.message, 'error')
                  return
                }
                await refreshAll()
              })()
            }}
            className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors flex items-center gap-1.5"
          >
            <HeartIcon size={14} />
            <span>收藏</span>
          </button>
          <button
            onClick={() => {
              const sel = wallPhotos.filter((p: Photo) => selectedIds.has(p.id))
              void handleWallDeletePhotos(sel)
            }}
            className="px-3 py-1.5 rounded-full text-sm text-danger hover:bg-danger/10 transition-colors flex items-center gap-1.5"
          >
            <TrashIcon size={14} />
            <span>删除</span>
          </button>
          <span className="w-px h-5 bg-line mx-1.5" />
          <button
            onClick={() => {
              if (selectedIds.size < wallPhotos.length) setSelectedIds(new Set(wallPhotos.map((p: Photo) => p.id)))
              else setSelectedIds(new Set())
            }}
            className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors"
          >
            {selectedIds.size < wallPhotos.length ? '全选' : '全不选'}
          </button>
          <button
            onClick={() => {
              setWallSelectionMode(false)
              setSelectedIds(new Set())
            }}
            title="退出多选（Esc）"
            className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
          >
            <XIcon size={15} />
          </button>
        </motion.div>
      )}

      {/* 移动到旅行对话框（照片墙入口） */}
      {moveTarget && moveTarget.length > 0 && (
        <MoveToTripDialog
          key="home-move-dialog"
          photos={moveTarget}
          sourceTripId={moveTarget[0].tripId}
          sourceTripIds={[...new Set(moveTarget.map((p: Photo) => p.tripId))]}
          trips={trips}
          onClose={() => setMoveTarget(null)}
          onMoved={() => void handleWallMoved()}
        />
      )}

      {/* 首页灯箱（跨旅行浏览，tripTitle 按照片所属旅行展示） */}
      {wallLightboxIndex !== null && wallPhotos[wallLightboxIndex] && (
        <Lightbox
          key="home-lightbox"
          photos={wallPhotos}
          index={wallLightboxIndex}
          onNavigate={setWallLightboxIndex}
          onClose={() => setWallLightboxIndex(null)}
          onDeletePhoto={(photoId) => {
            const p = wallPhotos[wallLightboxIndex]
            if (p) void handleWallDeletePhotos([wallPhotos.find((x: Photo) => x.id === photoId) ?? p])
          }}
          onEditCaption={setCaptionTarget}
          onToggleFavorite={(photoId, favorite) => void handleWallToggleFavorite(photoId, favorite)}
          onEditTags={setTagTarget}
          onMove={(photos) => {
            if (photos.length > 0) setMoveTarget(photos)
          }}
          onReveal={(photo) => void handleWallReveal(photo)}
          onCopyPath={(photo) => void handleWallCopyPath(photo)}
          tripTitleOf={(p) => (p as Photo & { tripTitle?: string }).tripTitle}
        />
      )}

      {/* 图注编辑 */}
      {captionTarget && (
        <CaptionEditor
          key={captionTarget.id}
          photo={captionTarget}
          onClose={() => setCaptionTarget(null)}
          onSaved={() => void refreshAll()}
        />
      )}

      {/* 照片标签编辑 */}
      {tagTarget && (
        <PhotoTagEditor
          key={tagTarget.id}
          photo={tagTarget}
          onClose={() => setTagTarget(null)}
          onSaved={() => void refreshAll()}
        />
      )}

      {/* 右键「导入照片到这次旅行」用的隐藏文件选择器 */}
      <input
        ref={importInputRef}
        type="file"
        multiple
        accept="image/*,video/*"
        className="hidden"
        onChange={handleImportToTrip}
      />
    </div>
  )
}

export default HomePage
