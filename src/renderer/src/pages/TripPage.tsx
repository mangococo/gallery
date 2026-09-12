import React from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { hasMediaExt } from '../lib/media'
import PhotoWall, { loadWallDensity, saveWallDensity, type WallDensity } from '../components/PhotoWall'
import TagInput from '../components/TagInput'
import Lightbox from '../components/Lightbox'
import CaptionEditor from '../components/CaptionEditor'
import PhotoTagEditor from '../components/PhotoTagEditor'
import MapView from '../components/MapView'
import MoveToTripDialog from '../components/MoveToTripDialog'
import { toast, confirmDialog } from '../components/feedback'
import { showContextMenuAt } from '../components/ContextMenu'
import {
  buildEmptyAreaMenu,
  buildPhotoBatchMenu,
  buildPhotoMenu,
  revealInLabel,
  type PhotoMenuHandlers,
  type PhotoMenuIcons,
} from '../lib/context-menus'
import { confirmAndDeleteTrip } from '../lib/trip-actions'
import { useEscClaim, isEscTop } from '../lib/esc'
import { indexAfterRemoval } from '../lib/viewer'
import { dateToLocalStr, formatDotDate, parseLocalDate } from '@shared/dates'
import {
  ArrowLeftIcon,
  HeartIcon,
  MoveToFolderIcon,
  PenIcon,
  PlusIcon,
  RevealIcon,
  SelectIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
  XIcon,
  BookIcon,
  WarningIcon,
  CameraIcon,
  RefreshIcon,
  CopyIcon,
} from '../components/icons'
import type { JournalFormat, MovePhotosResult } from '../types'
import { Photo, Trip } from '../types'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

/** 右键菜单图标集（模块级常量，避免每次渲染重建） */
const photoMenuIcons: PhotoMenuIcons = {
  open: <CameraIcon size={14} />,
  caption: <PenIcon size={14} />,
  tag: <TagIcon size={14} />,
  favorite: <HeartIcon size={14} />,
  cover: <StarIcon size={14} />,
  move: <MoveToFolderIcon size={14} />,
  reveal: <RevealIcon size={14} />,
  copy: <CopyIcon size={14} />,
  select: <SelectIcon size={14} />,
  trash: <TrashIcon size={14} />,
}

/** 旅行页照片墙首屏渲染条数，触底按此步长追加（对齐首页照片墙策略） */
const WALL_CHUNK = 500

const TripPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const { refreshAll, trips: albumTrips, activeAlbumId } = useApp()
  const [trip, setTrip] = React.useState<Trip | null>(null)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editedTrip, setEditedTrip] = React.useState<Trip | null>(null)
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null)
  const [captionTarget, setCaptionTarget] = React.useState<Photo | null>(null)
  const [tagTarget, setTagTarget] = React.useState<Photo | null>(null)
  /** 照片墙过滤：只看收藏 / 按标签筛选（旅行页内） */
  const [favOnly, setFavOnly] = React.useState(false)
  const [tagFilter, setTagFilter] = React.useState<string | null>(null)
  /** 旅行页内容视图：照片墙 / 地图 */
  const [viewMode, setViewMode] = React.useState<'photos' | 'map'>('photos')
  const [exportOpen, setExportOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState<JournalFormat | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)
  const [isDeletingTrip, setIsDeletingTrip] = React.useState(false)
  /** 多选体系：模式开关 + 勾选集合 */
  const [selectionMode, setSelectionMode] = React.useState(false)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  /** 照片墙增量渲染（#7）：千张级旅行全量挂载会拖垮滚动，先渲染首批、触底追加 */
  const [wallLimit, setWallLimit] = React.useState(WALL_CHUNK)
  /** 照片墙密度（#9）：三档，全局偏好持久化（与首页照片墙共享） */
  const [wallDensity, setWallDensity] = React.useState<WallDensity>(loadWallDensity)
  const changeWallDensity = (d: WallDensity) => {
    setWallDensity(d)
    saveWallDensity(d)
  }
  /** 移动到旅行对话框的待移动清单（null 关闭） */
  const [moveTarget, setMoveTarget] = React.useState<Photo[] | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  /** 拖拽深度计数：dragenter/dragleave 在子元素边界会成对冒泡，凭单次 leave 判断会闪烁 */
  const dragDepthRef = React.useRef(0)
  /** getTrip 是否已返回：区分「加载中」与「旅行不存在」 */
  const [tripLoaded, setTripLoaded] = React.useState(false)

  React.useEffect(() => {
    // ⌘K 可在旅行页之间直接跳转（同一路由组件复用）：慢的旧请求回来会覆盖新旅行，
    // 用取消标记丢弃过期响应
    let cancelled = false
    const loadTrip = async () => {
      try {
        const tripData = await api.getTrip(id!)
        if (cancelled) return
        setTrip(tripData)
        setEditedTrip(tripData ? { ...tripData, tags: tripData.tags || [] } : null)
      } catch {
        if (!cancelled) setTrip(null)
      }
      if (!cancelled) setTripLoaded(true)
    }
    void loadTrip()
    // 时间线右键「编辑旅行信息」直达编辑态
    if ((location.state as { edit?: boolean } | null)?.edit) setIsEditing(true)
    return () => {
      cancelled = true
    }
  }, [id])

  const applyUpdate = async (updated: Trip) => {
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  // 换旅行 / 换筛选时照片墙渲染窗口回到首批（与数据收敛配合，不留超大窗口）
  React.useEffect(() => {
    setWallLimit(WALL_CHUNK)
  }, [id, favOnly, tagFilter])

  // 缩略图批量就绪（store 广播）：旅行页持有本地照片副本，按 id 原位合并，
  // 首扫期间照片墙逐步点亮、不整页刷新、不回退原图（#3）
  React.useEffect(() => {
    const onThumbsReady = (ev: Event) => {
      const patch = new Map(
        (ev as CustomEvent<{ photos: { id: string; thumbUrl: string; width: number | null; height: number | null }[] }>).detail.photos.map(
          (u) => [u.id, u],
        ),
      )
      const merge = (t: Trip | null): Trip | null => {
        if (!t || !t.photos.some((p) => patch.has(p.id))) return t
        return {
          ...t,
          photos: t.photos.map((p) => {
            const u = patch.get(p.id)
            return u
              ? { ...p, thumbStatus: 'ready' as const, thumbUrl: u.thumbUrl, width: u.width ?? p.width, height: u.height ?? p.height }
              : p
          }),
        }
      }
      setTrip((t) => merge(t))
      setEditedTrip((t) => merge(t))
    }
    window.addEventListener('gallery:thumbs-ready', onThumbsReady)
    return () => window.removeEventListener('gallery:thumbs-ready', onThumbsReady)
  }, [])

  const importPathsToTrip = async (paths: string[]) => {
    if (!trip || paths.length === 0) return
    setIsUploading(true)
    try {
      const { photos: newPhotos, failed } = await api.importPhotos(trip.id, paths)
      if (editedTrip && newPhotos.length > 0) {
        await applyUpdate({ ...editedTrip, photos: [...editedTrip.photos, ...newPhotos] })
      }
      if (failed.length > 0) {
        const etc = failed.length > 1 ? ` 等 ${failed.length} 个` : ''
        toast(`已导入 ${newPhotos.length} 张；${failed[0].name}${etc}导入失败（${failed[0].reason}）`, 'info')
      } else {
        toast(`已导入 ${newPhotos.length} 张照片`, 'success')
      }
      await refreshAll()
    } catch (error: any) {
      toast('导入照片失败: ' + error.message, 'error')
    }
    setIsUploading(false)
  }

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    const paths = Array.from(files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
      .map((f) => api.getPathForFile(f))
    await importPathsToTrip(paths)
    event.target.value = ''
  }

  /** 拖拽照片进窗口即导入该旅行（方案决策17）；stopPropagation 避免触发首页级拖拽弹层 */
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    dragDepthRef.current = 0
    setDragOver(false)
    const paths = Array.from(event.dataTransfer.files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
      .map((f) => api.getPathForFile(f))
      .filter((p) => !!p)
    await importPathsToTrip(paths)
  }

  const handleDeletePhoto = async (photoId: string) => {
    if (!editedTrip) return
    try {
      await api.deletePhoto(photoId)
    } catch (error: any) {
      toast('删除失败: ' + error.message, 'error')
      return
    }
    const remaining = editedTrip.photos.filter((p: Photo) => p.id !== photoId)
    await applyUpdate({ ...editedTrip, photos: remaining })
    // 灯箱开着时跟随收缩；删空则关闭
    setLightboxIndex((cur) =>
      cur === null
        ? null
        : indexAfterRemoval(editedTrip.photos.map((p: Photo) => p.id), new Set([photoId]), cur),
    )
    toast('已移入回收站', 'success')
    await refreshAll()
  }

  const handleSetCover = async (photoId: string) => {
    if (!editedTrip) return
    try {
      await api.setCover(editedTrip.id, photoId)
    } catch (error: any) {
      toast('设置封面失败: ' + (error?.message ?? error), 'error')
      return
    }
    await applyUpdate({ ...editedTrip, coverPhotoId: photoId })
    await refreshAll()
  }

  /** 删除当前打开的旅行：确认弹窗期间锁住入口防重复点击，成功后回首页 */
  const handleDeleteTrip = async () => {
    if (!trip || isDeletingTrip) return
    setIsDeletingTrip(true)
    const deleted = await confirmAndDeleteTrip({
      id: trip.id,
      title: trip.title,
      photoCount: photos.length,
      status: trip.status,
    })
    if (deleted) {
      await refreshAll()
      navigate('/')
    }
    setIsDeletingTrip(false)
  }

  /** 导出手账：PDF 或长图 PNG（保存对话框由主进程弹出） */
  const handleExport = async (format: JournalFormat) => {
    if (!trip || exporting) return
    setExportOpen(false)
    setExporting(format)
    try {
      const path = await api.exportJournal(trip.id, format)
      if (path) toast(`手账已导出：${path.split(/[\\/]/).pop()}`, 'success')
    } catch (error: any) {
      toast('导出失败: ' + (error?.message ?? error), 'error')
    }
    setExporting(null)
  }

  const handleCaptionSaved = (photoId: string, caption: string) => {
    if (!editedTrip) return
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (p.id === photoId ? { ...p, caption } : p)),
    }
    setEditedTrip(updated)
    // 照片数组与编辑草稿无关：两份状态同步更新，取消编辑时墙面上已改的图注不回退
    setTrip((t) => (t ? { ...t, photos: updated.photos } : t))
  }

  /** 照片级收藏：本地即时更新（不动统计与时间线，无需 refreshAll） */
  const handleTogglePhotoFavorite = async (photoId: string, favorite: boolean) => {
    if (!editedTrip) return
    try {
      await api.setPhotoFavorite(photoId, favorite)
    } catch (error: any) {
      toast('操作失败: ' + error.message, 'error')
      return
    }
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (p.id === photoId ? { ...p, favorite } : p)),
    }
    setEditedTrip(updated)
    setTrip((t) => (t ? { ...t, photos: updated.photos } : t))
  }

  /** 照片级标签保存（覆盖式） */
  const handlePhotoTagsSaved = (photoId: string, tags: string[]) => {
    if (!editedTrip) return
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (p.id === photoId ? { ...p, tags } : p)),
    }
    setEditedTrip(updated)
    setTrip((t) => (t ? { ...t, photos: updated.photos } : t))
  }

  // —— 多选体系 ——

  const exitSelection = () => {
    setSelectionMode(false)
    setSelectedIds(new Set())
  }

  const handleToggleSelect = (photo: Photo) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(photo.id)) next.delete(photo.id)
      else next.add(photo.id)
      return next
    })
    setSelectionMode(true)
  }

  /** 右键菜单「选择多张…」：以当前照片为首张进入多选 */
  const handleEnterSelect = (photo: Photo) => {
    setSelectedIds(new Set([photo.id]))
    setSelectionMode(true)
  }

  // ESC 退出多选（灯箱/弹窗打开时不抢——它们已认领更高的 Esc 处理权）
  const selectionEscRef = useEscClaim(selectionMode)
  React.useEffect(() => {
    if (!selectionMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!isEscTop(selectionEscRef.current)) return
      exitSelection()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectionMode, selectionEscRef])

  // 过滤条件变化后勾选集合只保留仍可见的照片（必须挂在早退之前，保证 hook 顺序稳定）
  const photoCount = (editedTrip?.photos || trip?.photos || []).length
  React.useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev
      const visible = new Set(
        (editedTrip?.photos || trip?.photos || []).map((p: Photo) => p.id),
      )
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [favOnly, tagFilter, photoCount])

  /** 批量删除：确认后移入回收站，本地同步收缩（含灯箱与多选状态） */
  const handleDeletePhotos = async (photos: Photo[]) => {
    if (!editedTrip || photos.length === 0) return
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
    }
    const remaining = editedTrip.photos.filter((p: Photo) => !ids.has(p.id))
    // 封面被删时与主进程 FK SET NULL 行为对齐：本地切到剩余第一张
    const nextCover = ids.has(editedTrip.coverPhotoId ?? '')
      ? remaining[0]?.id ?? null
      : editedTrip.coverPhotoId
    await applyUpdate({ ...editedTrip, photos: remaining, coverPhotoId: nextCover })
    setLightboxIndex((cur) =>
      cur === null ? null : indexAfterRemoval(editedTrip.photos.map((p: Photo) => p.id), ids, cur),
    )
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((x) => !ids.has(x)))
      if (next.size === 0) setSelectionMode(false)
      return next
    })
    toast(`已移入回收站（${ids.size} 项）`, 'success')
    await refreshAll()
  }

  /** 批量收藏/取消收藏 */
  const handleBatchFavorite = async (photos: Photo[], favorite: boolean) => {
    if (!editedTrip || photos.length === 0) return
    try {
      await Promise.all(photos.map((p) => api.setPhotoFavorite(p.id, favorite)))
    } catch (error: any) {
      toast('操作失败: ' + error.message, 'error')
      return
    }
    const ids = new Set(photos.map((p) => p.id))
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (ids.has(p.id) ? { ...p, favorite } : p)),
    }
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  // —— 移动到旅行 ——

  const handleMovePhotos = (photos: Photo[]) => {
    if (photos.length === 0) return
    setMoveTarget(photos)
  }

  const handleMoved = async (result: MovePhotosResult) => {
    if (!editedTrip) return
    const movedSet = new Set(result.movedIds)
    const remaining = editedTrip.photos.filter((p: Photo) => !movedSet.has(p.id))
    // 封面随照片移走时，主进程已把封面交给剩余第一张；本地状态同步跟随
    const nextCover = movedSet.has(editedTrip.coverPhotoId ?? '')
      ? remaining[0]?.id ?? null
      : editedTrip.coverPhotoId
    await applyUpdate({ ...editedTrip, photos: remaining, coverPhotoId: nextCover })
    setLightboxIndex((cur) =>
      cur === null
        ? null
        : indexAfterRemoval(editedTrip.photos.map((p: Photo) => p.id), movedSet, cur),
    )
    setSelectedIds((prev) => {
      const next = new Set([...prev].filter((x) => !movedSet.has(x)))
      if (next.size === 0) setSelectionMode(false)
      return next
    })
    toast(
      `已移动 ${result.movedIds.length} 项到「${result.targetTrip.title}」${
        result.fileMissingCount > 0 ? `（${result.fileMissingCount} 项源文件已丢失，仅移动记录）` : ''
      }`,
      'success',
    )
    await refreshAll()
  }

  // —— Finder / 复制路径 ——

  const handleReveal = async (photo: Photo) => {
    try {
      await api.revealPhotoInFolder(photo.id)
    } catch (error: any) {
      toast('定位文件失败: ' + error.message, 'error')
    }
  }

  const handleCopyPath = async (photo: Photo) => {
    try {
      const p = await api.copyPhotoPath(photo.id)
      toast(`已复制路径：${p.split('/').pop() ?? p}`, 'success')
    } catch (error: any) {
      toast('复制路径失败: ' + error.message, 'error')
    }
  }

  /** 右键菜单动作集（照片墙与灯箱共用） */
  const photoMenuHandlers: PhotoMenuHandlers = {
    onOpen: (photo) => handlePhotoClick(photo),
    onEditCaption: (photo) => setCaptionTarget(photo),
    onEditTags: (photo) => setTagTarget(photo),
    onToggleFavorite: (p, favorite) => handleTogglePhotoFavorite(p.id, favorite),
    onBatchFavorite: (photos, favorite) => void handleBatchFavorite(photos, favorite),
    onSetCover: (photo) => void handleSetCover(photo.id),
    onMove: (photos) => handleMovePhotos(photos),
    onReveal: (photo) => void handleReveal(photo),
    onCopyPath: (photo) => void handleCopyPath(photo),
    onDelete: (photos) => void handleDeletePhotos(photos),
    onEnterSelect: (photo) => handleEnterSelect(photo),
  }

  /** 照片卡片右键：选择态下命中集合 → 批量菜单；否则单张菜单并把选择切到该项 */
  const handlePhotoContextMenu = (e: React.MouseEvent, photo: Photo) => {
    if (selectionMode) {
      if (selectedIds.has(photo.id) && selectedIds.size > 1) {
        const selected = (editedTrip?.photos || []).filter((p) => selectedIds.has(p.id))
        showContextMenuAt(e, buildPhotoBatchMenu(selected, photoMenuHandlers, photoMenuIcons))
        return
      }
      setSelectedIds(new Set([photo.id]))
    }
    showContextMenuAt(
      e,
      buildPhotoMenu(photo, photoMenuHandlers, photoMenuIcons, {
        isCover: editedTrip?.coverPhotoId === photo.id,
        canSelect: true,
        isMac,
      }),
    )
  }

  /** 照片墙空白区右键 */
  const handleWallContextMenu = (e: React.MouseEvent) => {
    showContextMenuAt(
      e,
      buildEmptyAreaMenu(
        'trip-page',
        {
          onAddPhotos: () => fileInputRef.current?.click(),
          onRescan: () => void rescanActiveAlbum(),
          onRefresh: () => void refreshAll(),
        },
        { add: <PlusIcon size={14} />, rescan: <RefreshIcon size={14} />, refresh: <RefreshIcon size={14} /> },
      ),
    )
  }

  const rescanActiveAlbum = async () => {
    if (!activeAlbumId) return
    await api.rescanAlbum(activeAlbumId)
    await refreshAll()
  }

  const handleSave = async () => {
    if (!editedTrip) return
    if (
      editedTrip.startDate &&
      editedTrip.endDate &&
      editedTrip.endDate < editedTrip.startDate
    ) {
      toast('结束日期不能早于开始日期', 'error')
      return
    }
    try {
      const saved = await api.updateTrip(editedTrip.id, {
        title: editedTrip.title,
        description: editedTrip.description,
        startDate: editedTrip.startDate,
        endDate: editedTrip.endDate,
        tags: editedTrip.tags,
      })
      if (saved) setTrip(saved)
      setIsEditing(false)
      await refreshAll()
    } catch (error: any) {
      toast('保存失败: ' + (error?.message ?? error), 'error')
    }
  }

  const handlePhotoClick = (photo: Photo) => {
    const list = editedTrip?.photos || trip?.photos || []
    setLightboxIndex(list.findIndex((p: Photo) => p.id === photo.id))
  }

  /** DatePicker 展示值：date-only 字符串按本地时区解析（UTC 解析会在西半球偏一天） */
  const asDate = (s: string): Date | null => {
    const d = parseLocalDate(s)
    return isNaN(d.getTime()) ? null : d
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4">
        {tripLoaded ? (
          <>
            <p className="text-ink-3 font-display text-lg">旅行不存在或已被删除</p>
            <button
              onClick={() => navigate('/')}
              className="px-5 py-2 bg-primary text-primary-ink rounded-lg text-sm hover:opacity-90 transition-opacity"
            >
              回到首页
            </button>
          </>
        ) : (
          <p className="text-ink-3">加载中…</p>
        )}
      </div>
    )
  }

  const photos = editedTrip?.photos || trip.photos
  /** 照片墙过滤（旅行页内）：只看收藏 / 按照片标签筛选；灯箱始终浏览全量列表 */
  const photoTagList = [...new Set(photos.flatMap((p: Photo) => p.tags || []))].sort((a, b) =>
    a.localeCompare(b, 'zh'),
  )
  const visiblePhotos = photos.filter(
    (p: Photo) => (!favOnly || p.favorite) && (!tagFilter || (p.tags || []).includes(tagFilter)),
  )
  const visibleWallPhotos = visiblePhotos.slice(0, wallLimit)

  return (    <div
      className="min-h-screen bg-background"
      onDragEnter={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragDepthRef.current++
        setDragOver(true)
      }}
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        if (dragDepthRef.current === 0) dragDepthRef.current = 1
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
        if (dragDepthRef.current === 0) setDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {/* 顶栏（可拖拽） */}
      <header className="drag-region sticky top-0 z-20 h-12 bg-background/85 backdrop-blur-sm border-b border-line flex items-center justify-between pl-5 pr-5">
        <button
          onClick={() => navigate('/')}
          className="no-drag flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary transition-colors"
        >
          <span className="flex items-center">
            <ArrowLeftIcon size={16} />
          </span>
          <span>返回</span>
        </button>
        <div className="flex items-center gap-3 no-drag">
          {isEditing ? (
            <>
              <button
                onClick={() => {
                  setEditedTrip(trip)
                  setIsEditing(false)
                }}
                className="px-4 py-1.5 text-sm text-ink-2 hover:text-ink transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-1.5 bg-primary text-primary-ink rounded-lg text-sm hover:opacity-90 transition-opacity"
              >
                保存
              </button>
            </>
          ) : (
            <>
              <div className="relative">
                <button
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={!!exporting}
                  className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  title="导出手账"
                >
                  <BookIcon size={15} />
                  <span>{exporting === 'pdf' ? '生成 PDF…' : exporting === 'png' ? '生成长图…' : '导出手账'}</span>
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-52 bg-surface border border-line rounded-xl shadow-xl p-1.5 no-drag">
                      <button
                        onClick={() => void handleExport('pdf')}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-soft transition-colors"
                      >
                        <span className="block text-sm text-ink">PDF · 可打印</span>
                        <span className="block text-xs text-ink-3 mt-0.5">矢量文字，适合送印</span>
                      </button>
                      <button
                        onClick={() => void handleExport('png')}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-soft transition-colors"
                      >
                        <span className="block text-sm text-ink">长图 PNG</span>
                        <span className="block text-xs text-ink-3 mt-0.5">整卷一张，适合分享</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleDeleteTrip}
                disabled={isDeletingTrip}
                title="删除这次旅行"
                className="p-2 text-ink-3 hover:text-danger rounded-lg transition-colors disabled:opacity-50"
              >
                <TrashIcon size={16} />
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="px-5 py-1.5 bg-primary text-primary-ink rounded-lg text-sm hover:opacity-90 transition-opacity"
              >
                编辑
              </button>
            </>
          )}
        </div>
      </header>

      {/* 拖拽导入提示层 */}
      {dragOver && (
        <div className="fixed inset-0 z-40 bg-primary/10 backdrop-blur-[1px] pointer-events-none flex items-center justify-center">
          <div className="px-8 py-5 bg-surface rounded-2xl shadow-xl border-2 border-dashed border-primary">
            <p className="font-display text-lg text-primary">松手即导入这次旅行</p>
          </div>
        </div>
      )}

      <main className="max-w-[1100px] mx-auto px-10 py-10">
        {/* 文件夹缺失横幅（⌘K 等入口仍可能进到缺失旅行页） */}
        {trip.status === 'missing' && (
          <div className="mb-6 px-4 py-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-2 text-sm text-danger">
            <WarningIcon size={14} className="shrink-0" />
            <span>
              旅行文件夹已不在相册目录中（可能被移出或删除），照片无法读取；顶栏删除将只清理这条旅行记录。
            </span>
          </div>
        )}
        {/* 信息卡 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface rounded-2xl border border-line shadow-sm p-8 mb-10"
        >
          {isEditing ? (
            <div className="space-y-7">
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">标题</label>
                <input
                  type="text"
                  value={editedTrip?.title || ''}
                  onChange={(e) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, title: e.target.value })
                    }
                  }}
                  className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all text-lg"
                  placeholder="输入旅行标题"
                />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">开始日期</label>
                  <DatePicker
                    selected={editedTrip?.startDate ? asDate(editedTrip.startDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({
                          ...editedTrip,
                          startDate: dateToLocalStr(date),
                        })
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="选择开始日期"
                    className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">结束日期</label>
                  <DatePicker
                    selected={editedTrip?.endDate ? asDate(editedTrip.endDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({
                          ...editedTrip,
                          endDate: dateToLocalStr(date),
                        })
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="选择结束日期"
                    className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">描述</label>
                <textarea
                  value={editedTrip?.description}
                  onChange={(e) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, description: e.target.value })
                    }
                  }}
                  rows={5}
                  className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all resize-none leading-relaxed"
                  placeholder="记录这次旅行的美好回忆…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">标签</label>
                <TagInput
                  value={editedTrip?.tags ?? []}
                  onChange={(tags) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, tags })
                    }
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <h1 className="font-display text-3xl font-bold text-ink mb-3">{trip.title}</h1>
                {trip.isFavorite && (
                  <HeartIcon size={20} filled className="text-primary shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-ink-3 mb-4">
                <span className="font-display">
                  {formatDotDate(trip.startDate)} — {formatDotDate(trip.endDate)}
                </span>
                <span>·</span>
                <span>{trip.photos.length} 张照片</span>
              </div>
              {trip.description && (
                <p className="text-ink-2 leading-relaxed mb-4 whitespace-pre-wrap">
                  {trip.description}
                </p>
              )}
              {trip.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {trip.tags.map((tag: string, index: number) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-primary-soft text-primary-soft-ink text-sm rounded-full"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* 照片墙 / 地图 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-ink">照片</h2>
            <div className="flex items-center bg-surface-2 rounded-full p-0.5">
              {(['photos', 'map'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    viewMode === mode ? 'bg-surface text-primary shadow-sm' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {mode === 'photos' ? '照片' : '地图'}
                </button>
              ))}
            </div>
            {viewMode === 'photos' && (
              <div
                data-testid="wall-density-switch"
                className="flex items-center bg-surface-2 rounded-full p-0.5"
                title="照片排列密度"
              >
                {(['large', 'medium', 'small'] as const).map((d) => (
                  <button
                    key={d}
                    data-testid={`wall-density-${d}`}
                    onClick={() => changeWallDensity(d)}
                    className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                      wallDensity === d ? 'bg-surface text-primary shadow-sm' : 'text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    {d === 'large' ? '大' : d === 'medium' ? '中' : '小'}
                  </button>
                ))}
              </div>
            )}
          </div>
          {viewMode === 'photos' && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-ink-3">
                {visiblePhotos.length === photos.length
                  ? `${photos.length} 张`
                  : `${visiblePhotos.length} / ${photos.length} 张`}
              </span>
              <label className="px-4 py-2 bg-primary text-primary-ink rounded-lg hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 text-sm">
                <PlusIcon size={13} />
                <span>{isUploading ? '导入中…' : '添加照片'}</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  disabled={isUploading}
                />
              </label>
            </div>
          )}
        </div>

        {viewMode === 'photos' ? (
          <>
            {/* 过滤 chips：只看收藏 / 按标签筛选 */}
            {(photoTagList.length > 0 || favOnly) && (
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <button
                  onClick={() => setFavOnly((v) => !v)}
                  className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 transition-colors ${
                    favOnly ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  <HeartIcon size={11} filled={favOnly} />
                  <span>只看收藏</span>
                </button>
                {photoTagList.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
                    className={`px-3 py-1 rounded-full text-xs transition-colors ${
                      tagFilter === tag ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-ink-2 hover:text-ink'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
                {(favOnly || tagFilter) && (
                  <button
                    onClick={() => {
                      setFavOnly(false)
                      setTagFilter(null)
                    }}
                    className="px-2.5 py-1 rounded-full text-xs text-ink-3 hover:text-ink flex items-center gap-1"
                  >
                    <XIcon size={10} />
                    <span>清除</span>
                  </button>
                )}
              </div>
            )}
            <PhotoWall
              photos={visibleWallPhotos}
              emptyTitle={photos.length === 0 ? '这次旅行还没有照片' : '没有符合筛选的照片'}
              emptyHint={
                photos.length === 0
                  ? `把照片放进相册里的「${trip.folderName}」文件夹，或点右上角「添加照片」`
                  : '试试清除上方的收藏或标签筛选'
              }
              onPhotoClick={handlePhotoClick}
              onDeletePhoto={handleDeletePhoto}
              onEditCaption={setCaptionTarget}
              showDeleteButton
              coverPhotoId={editedTrip?.coverPhotoId ?? null}
              onSetCover={handleSetCover}
              onToggleFavorite={handleTogglePhotoFavorite}
              selectionMode={selectionMode}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onPhotoContextMenu={handlePhotoContextMenu}
              onWallContextMenu={handleWallContextMenu}
              density={wallDensity}
            />
            {visiblePhotos.length > wallLimit && (
              <div className="py-10 text-center">
                <button
                  onClick={() => setWallLimit((n) => Math.min(n + WALL_CHUNK, visiblePhotos.length))}
                  className="px-6 py-2.5 bg-surface-2 text-ink-2 rounded-xl hover:text-ink transition-colors text-sm"
                >
                  继续浏览（还有 {visiblePhotos.length - wallLimit} 张）
                </button>
              </div>
            )}
          </>
        ) : (
          <MapView photos={photos} onOpenPhoto={handlePhotoClick} />
        )}
      </main>

      {/* 多选工具条 */}
      <AnimatePresence>
        {selectionMode && (
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
                const selected = photos.filter((p: Photo) => selectedIds.has(p.id))
                handleMovePhotos(selected)
              }}
              className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors flex items-center gap-1.5"
            >
              <MoveToFolderIcon size={14} />
              <span>移动</span>
            </button>
            <button
              onClick={() => {
                const selected = photos.filter((p: Photo) => selectedIds.has(p.id))
                void handleBatchFavorite(selected, !selected.every((p) => p.favorite))
              }}
              className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors flex items-center gap-1.5"
            >
              <HeartIcon size={14} />
              <span>收藏</span>
            </button>
            <button
              onClick={() => {
                const selected = photos.filter((p: Photo) => selectedIds.has(p.id))
                void handleDeletePhotos(selected)
              }}
              className="px-3 py-1.5 rounded-full text-sm text-danger hover:bg-danger/10 transition-colors flex items-center gap-1.5"
            >
              <TrashIcon size={14} />
              <span>删除</span>
            </button>
            <span className="w-px h-5 bg-line mx-1.5" />
            {selectedIds.size < visiblePhotos.length ? (
              <button
                onClick={() => setSelectedIds(new Set(visiblePhotos.map((p: Photo) => p.id)))}
                className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors"
              >
                全选
              </button>
            ) : (
              <button
                onClick={() => setSelectedIds(new Set())}
                className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors"
              >
                全不选
              </button>
            )}
            <button
              onClick={exitSelection}
              title="退出多选（Esc）"
              className="w-8 h-8 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
            >
              <XIcon size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 移动到旅行对话框 */}
      <AnimatePresence>
        {moveTarget && trip && (
          <MoveToTripDialog
            key="move-dialog"
            photos={moveTarget}
            sourceTripId={trip.id}
            trips={albumTrips}
            onClose={() => setMoveTarget(null)}
            onMoved={(r) => void handleMoved(r)}
          />
        )}
      </AnimatePresence>

      {/* 灯箱 */}
      <AnimatePresence>
        {lightboxIndex !== null && photos[lightboxIndex] && (
          <Lightbox
            key="lightbox"
            photos={photos}
            index={lightboxIndex}
            onNavigate={setLightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onDeletePhoto={handleDeletePhoto}
            onEditCaption={setCaptionTarget}
            coverPhotoId={editedTrip?.coverPhotoId ?? null}
            onSetCover={handleSetCover}
            onToggleFavorite={handleTogglePhotoFavorite}
            onEditTags={setTagTarget}
            onMove={handleMovePhotos}
            onReveal={handleReveal}
            onCopyPath={handleCopyPath}
            tripTitle={trip.title}
          />
        )}
      </AnimatePresence>

      {/* 图注编辑 */}
      {captionTarget && (
        <CaptionEditor
          key={captionTarget.id}
          photo={captionTarget}
          onClose={() => setCaptionTarget(null)}
          onSaved={handleCaptionSaved}
        />
      )}

      {/* 照片标签编辑 */}
      {tagTarget && (
        <PhotoTagEditor
          key={tagTarget.id}
          photo={tagTarget}
          onClose={() => setTagTarget(null)}
          onSaved={handlePhotoTagsSaved}
        />
      )}
    </div>
  )
}

export default TripPage
