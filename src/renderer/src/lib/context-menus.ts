import type React from 'react'
import type { MenuEntry } from '../components/ContextMenu'
import type { Photo, Trip, TrashItem } from '../types'

/**
 * 上下文菜单的纯组装层：按「上下文 + 选择状态 + 媒体类型」产出菜单项。
 * 不 import 任何 .tsx（node --test 直接可测）；图标由调用方以 ReactNode 注入。
 * 页面只负责提供动作回调，这里保证各场景菜单结构一致。
 */

/** 平台相关的「在文件管理器中显示」文案 */
export function revealInLabel(isMac: boolean): string {
  return isMac ? '在 Finder 中显示' : '在资源管理器中显示'
}

export interface PhotoMenuIcons {
  open?: React.ReactNode
  caption?: React.ReactNode
  tag?: React.ReactNode
  favorite?: React.ReactNode
  cover?: React.ReactNode
  move?: React.ReactNode
  reveal?: React.ReactNode
  copy?: React.ReactNode
  select?: React.ReactNode
  trash?: React.ReactNode
}

export interface PhotoMenuHandlers {
  onOpen?: (photo: Photo) => void
  onEditCaption?: (photo: Photo) => void
  onEditTags?: (photo: Photo) => void
  onToggleFavorite?: (photo: Photo, favorite: boolean) => void
  /** 批量收藏（多选菜单/选择工具条用） */
  onBatchFavorite?: (photos: Photo[], favorite: boolean) => void
  onSetCover?: (photo: Photo) => void
  onMove?: (photos: Photo[]) => void
  onReveal?: (photo: Photo) => void
  onCopyPath?: (photo: Photo) => void
  onDelete?: (photos: Photo[]) => void
  onEnterSelect?: (photo: Photo) => void
}

export interface BuildPhotoMenuOptions {
  /** 当前是否为旅行封面（决定「设为封面」态） */
  isCover?: boolean
  /** 是否展示「选择多张」入口（照片墙场景 true；灯箱 false） */
  canSelect?: boolean
  isMac?: boolean
}

/** 单张照片/视频右键：类型与能力决定菜单项集合 */
export function buildPhotoMenu(
  photo: Photo,
  handlers: PhotoMenuHandlers,
  icons: PhotoMenuIcons = {},
  opts: BuildPhotoMenuOptions = {},
): MenuEntry[] {
  const entries: MenuEntry[] = []
  if (handlers.onOpen) {
    entries.push({
      label: photo.type === 'video' ? '播放视频' : '打开查看',
      icon: icons.open,
      onSelect: () => handlers.onOpen?.(photo),
    })
  }
  if (handlers.onEditCaption) {
    entries.push({
      label: '编辑图注',
      icon: icons.caption,
      onSelect: () => handlers.onEditCaption?.(photo),
    })
  }
  if (handlers.onEditTags) {
    entries.push({
      label: photo.tags.length > 0 ? `编辑标签（${photo.tags.length}）` : '添加标签',
      icon: icons.tag,
      onSelect: () => handlers.onEditTags?.(photo),
    })
  }
  if (handlers.onToggleFavorite) {
    entries.push({
      label: photo.favorite ? '取消收藏' : '加入收藏',
      icon: icons.favorite,
      onSelect: () => handlers.onToggleFavorite?.(photo, !photo.favorite),
    })
  }
  if (handlers.onSetCover) {
    entries.push(
      opts.isCover
        ? { label: '已设为封面', icon: icons.cover, disabled: true }
        : { label: '设为旅行封面', icon: icons.cover, onSelect: () => handlers.onSetCover?.(photo) },
    )
  }
  entries.push({ kind: 'separator' })
  if (handlers.onMove) {
    entries.push({
      label: '移动到旅行…',
      icon: icons.move,
      onSelect: () => handlers.onMove?.([photo]),
    })
  }
  if (handlers.onReveal) {
    entries.push({
      label: revealInLabel(opts.isMac ?? true),
      icon: icons.reveal,
      onSelect: () => handlers.onReveal?.(photo),
    })
  }
  if (handlers.onCopyPath) {
    entries.push({
      label: '复制文件路径',
      icon: icons.copy,
      onSelect: () => handlers.onCopyPath?.(photo),
    })
  }
  if (opts.canSelect && handlers.onEnterSelect) {
    entries.push({
      label: '选择多张…',
      icon: icons.select,
      onSelect: () => handlers.onEnterSelect?.(photo),
    })
  }
  if (handlers.onDelete) {
    entries.push({ kind: 'separator' })
    entries.push({
      label: photo.type === 'video' ? '删除视频（移入回收站）' : '删除照片（移入回收站）',
      icon: icons.trash,
      danger: true,
      onSelect: () => handlers.onDelete?.([photo]),
    })
  }
  return entries
}

/** 多选右键：菜单随数量与状态变化，不复用单张菜单 */
export function buildPhotoBatchMenu(
  photos: Photo[],
  handlers: PhotoMenuHandlers,
  icons: PhotoMenuIcons = {},
): MenuEntry[] {
  const entries: MenuEntry[] = [
    { kind: 'header', label: `已选择 ${photos.length} 项（含 ${photos.filter((p) => p.type === 'video').length} 个视频）` },
  ]
  if (handlers.onBatchFavorite && photos.length > 0) {
    const allFav = photos.every((p) => p.favorite)
    entries.push({
      label: allFav ? '取消全部收藏' : '收藏全部',
      icon: icons.favorite,
      onSelect: () => handlers.onBatchFavorite?.(photos, !allFav),
    })
  }
  if (handlers.onMove) {
    entries.push({
      label: '移动到旅行…',
      icon: icons.move,
      onSelect: () => handlers.onMove?.(photos),
    })
  }
  if (handlers.onDelete) {
    entries.push({ kind: 'separator' })
    entries.push({
      label: `删除 ${photos.length} 项（移入回收站）`,
      icon: icons.trash,
      danger: true,
      onSelect: () => handlers.onDelete?.(photos),
    })
  }
  return entries
}

export interface TripMenuIcons {
  open?: React.ReactNode
  edit?: React.ReactNode
  import?: React.ReactNode
  favorite?: React.ReactNode
  rescan?: React.ReactNode
  trash?: React.ReactNode
}

export interface TripMenuHandlers {
  onOpen: (trip: Trip) => void
  onEdit: (trip: Trip) => void
  onImport?: (trip: Trip) => void
  onToggleFavorite?: (trip: Trip) => void
  onRescan?: (trip: Trip) => void
  onDelete: (trip: Trip) => void
}

/** 时间线旅行卡片右键；文件夹缺失（missing）时收窄为「只清记录」安全集 */
export function buildTripMenu(
  trip: Trip,
  handlers: TripMenuHandlers,
  icons: TripMenuIcons = {},
): MenuEntry[] {
  const missing = trip.status === 'missing'
  const entries: MenuEntry[] = [
    { label: '打开旅行', icon: icons.open, disabled: missing, onSelect: () => handlers.onOpen(trip) },
    { label: '编辑旅行信息', icon: icons.edit, disabled: missing, onSelect: () => handlers.onEdit(trip) },
  ]
  if (handlers.onImport) {
    entries.push({
      label: '导入照片到这次旅行…',
      icon: icons.import,
      disabled: missing,
      onSelect: () => handlers.onImport?.(trip),
    })
  }
  if (handlers.onToggleFavorite) {
    entries.push({ kind: 'separator' })
    entries.push({
      label: trip.isFavorite ? '取消收藏' : '收藏旅行',
      icon: icons.favorite,
      onSelect: () => handlers.onToggleFavorite?.(trip),
    })
  }
  if (handlers.onRescan) {
    entries.push({
      label: '重新扫描相册',
      icon: icons.rescan,
      onSelect: () => handlers.onRescan?.(trip),
    })
  }
  entries.push({ kind: 'separator' })
  entries.push({
    label: missing ? '删除记录（文件夹已缺失）' : '删除旅行…',
    icon: icons.trash,
    danger: true,
    onSelect: () => handlers.onDelete(trip),
  })
  return entries
}

export interface EmptyAreaMenuHandlers {
  onAddPhotos?: () => void
  onNewTrip?: () => void
  onRescan?: () => void
  onRefresh?: () => void
}

export interface EmptyAreaMenuIcons {
  add?: React.ReactNode
  newTrip?: React.ReactNode
  rescan?: React.ReactNode
  refresh?: React.ReactNode
}

/**
 * 页面空白区右键：只放当前页面语境下有意义的操作。
 * kind='trip-page' → 添加照片；kind='home' → 新旅行。
 */
export function buildEmptyAreaMenu(
  kind: 'trip-page' | 'home',
  handlers: EmptyAreaMenuHandlers,
  icons: EmptyAreaMenuIcons = {},
): MenuEntry[] {
  const entries: MenuEntry[] = []
  if (kind === 'trip-page' && handlers.onAddPhotos) {
    entries.push({ label: '添加照片…', icon: icons.add, onSelect: handlers.onAddPhotos })
  }
  if (kind === 'home' && handlers.onNewTrip) {
    entries.push({ label: '新建旅行…', icon: icons.newTrip, onSelect: handlers.onNewTrip })
  }
  if (handlers.onRescan) {
    entries.push({ label: '重新扫描相册', icon: icons.rescan, onSelect: handlers.onRescan })
  }
  if (handlers.onRefresh) {
    entries.push({ label: '刷新', icon: icons.refresh, onSelect: handlers.onRefresh })
  }
  return entries
}

// —— 回收站 ——

export interface TrashMenuIcons {
  restore?: React.ReactNode
  purge?: React.ReactNode
  select?: React.ReactNode
  trip?: React.ReactNode
}

export interface TrashMenuHandlers {
  onRestore: (items: TrashItem[]) => void
  onPurge: (items: TrashItem[]) => void
  /** 照片专属：跳到所属旅行（仅旅行还在业务视图时可用） */
  onViewTrip?: (item: TrashItem) => void
  onEnterSelect?: (item: TrashItem) => void
}

/** 回收站单个条目右键：恢复 / 彻底删除 / 查看原旅行 / 选择多张 */
export function buildTrashItemMenu(
  item: TrashItem,
  handlers: TrashMenuHandlers,
  icons: TrashMenuIcons = {},
): MenuEntry[] {
  const entries: MenuEntry[] = [
    {
      label: '恢复',
      icon: icons.restore,
      onSelect: () => handlers.onRestore([item]),
    },
  ]
  if (item.kind === 'photo' && handlers.onViewTrip && !item.tripTrashed && item.tripId) {
    entries.push({
      label: `查看原旅行「${item.tripTitle ?? ''}」`,
      icon: icons.trip,
      onSelect: () => handlers.onViewTrip?.(item),
    })
  }
  if (handlers.onEnterSelect) {
    entries.push({
      label: '选择多张…',
      icon: icons.select,
      onSelect: () => handlers.onEnterSelect?.(item),
    })
  }
  entries.push({ kind: 'separator' })
  entries.push({
    label: '彻底删除…',
    icon: icons.purge,
    danger: true,
    onSelect: () => handlers.onPurge([item]),
  })
  return entries
}

/** 回收站多选右键：批量恢复 / 批量彻底删除 */
export function buildTrashBatchMenu(
  items: TrashItem[],
  handlers: TrashMenuHandlers,
  icons: TrashMenuIcons = {},
): MenuEntry[] {
  const trips = items.filter((i) => i.kind === 'trip').length
  const videos = items.filter((i) => i.kind === 'photo' && i.type === 'video').length
  const parts = [`已选择 ${items.length} 项`]
  if (trips > 0) parts.push(`${trips} 个旅行`)
  if (videos > 0) parts.push(`${videos} 个视频`)
  return [
    { kind: 'header', label: parts.join('（') + (parts.length > 1 ? '）' : '') },
    {
      label: '恢复全部',
      icon: icons.restore,
      onSelect: () => handlers.onRestore(items),
    },
    { kind: 'separator' },
    {
      label: `彻底删除 ${items.length} 项…`,
      icon: icons.purge,
      danger: true,
      onSelect: () => handlers.onPurge(items),
    },
  ]
}
