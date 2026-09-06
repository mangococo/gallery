import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { showContextMenuAt } from '../components/ContextMenu'
import {
  buildTrashBatchMenu,
  buildTrashItemMenu,
  type TrashMenuIcons,
} from '../lib/context-menus'
import { confirmDialog, toast } from '../components/feedback'
import { useEscClaim, isEscTop } from '../lib/esc'
import {
  ArrowLeftIcon,
  CheckCircleIcon,
  FilmIcon,
  ImageIcon,
  MoveToFolderIcon,
  PlayIcon,
  RestoreIcon,
  RefreshIcon,
  TrashIcon,
  WarningIcon,
  XIcon,
} from '../components/icons'
import type { TrashItem } from '../types'

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

const trashMenuIcons: TrashMenuIcons = {
  restore: <RestoreIcon size={14} />,
  purge: <TrashIcon size={14} />,
  select: <CheckCircleIcon size={14} />,
  trip: <MoveToFolderIcon size={14} />,
}

/** 删除时间 → 「刚刚 / x 分钟前 / x 小时前 / x 天前 / YYYY.MM.DD」 */
function formatDeletedAt(ms: number): string {
  const diff = Date.now() - ms
  if (!Number.isFinite(diff) || diff < 0) return '刚刚'
  const min = 60_000
  const hour = 60 * min
  const day = 24 * hour
  if (diff < min) return '刚刚'
  if (diff < hour) return `${Math.floor(diff / min)} 分钟前`
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`
  if (diff < 30 * day) return `${Math.floor(diff / day)} 天前`
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`
}

const TrashPage: React.FC = () => {
  const navigate = useNavigate()
  // 进入回收站前的路由（侧栏/返回/ESC 的退出目标），由 navigate('/trash', { state }) 传入
  const location = useLocation()
  const { refreshAll } = useApp()
  const [items, setItems] = React.useState<TrashItem[] | null>(null)
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(new Set())
  /** 彻底删除确认弹窗期间锁住入口 */
  const [purging, setPurging] = React.useState(false)
  const [restoring, setRestoring] = React.useState(false)

  const reload = React.useCallback(async () => {
    setItems(await api.listTrash())
  }, [])

  React.useEffect(() => {
    void reload()
  }, [reload])

  const selected = React.useMemo(
    () => (items ?? []).filter((i) => selectedIds.has(itemKey(i))),
    [items, selectedIds],
  )

  const toggleSelect = (item: TrashItem) => {
    const key = itemKey(item)
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const exitSelection = () => setSelectedIds(new Set())

  // ESC 分层退出：有多选先退多选；否则退出回收站、回到进入前的路由。
  // 右键菜单/确认弹窗打开时已认领更高的 Esc 处理权，此处不抢
  const escRef = useEscClaim()
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (!isEscTop(escRef.current)) return
      if (selectedIds.size > 0) {
        setSelectedIds(new Set())
        return
      }
      navigate((location.state as { from?: string } | null)?.from ?? '/')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.size, location.state, location.key, escRef])

  /** 恢复（单选/批量共用）：成功后重拉列表 + 全局刷新（侧栏角标/时间线） */
  const handleRestore = async (targets: TrashItem[]) => {
    if (targets.length === 0 || restoring) return
    setRestoring(true)
    try {
      const sel = toSelection(targets)
      const result = await api.trashRestore(sel)
      const restored = result.tripsCount + result.photosCount
      if (restored > 0) toast(`已恢复 ${restored} 项`, 'success')
      for (const f of result.failed) toast(`恢复「${f.name}」失败：${f.reason}`, 'error')
      setSelectedIds((prev) => new Set([...prev].filter((k) => !targets.some((i) => itemKey(i) === k))))
      await Promise.all([reload(), refreshAll()])
    } catch (error: any) {
      toast('恢复失败: ' + (error?.message ?? error), 'error')
    }
    setRestoring(false)
  }

  /** 彻底删除（单选/批量共用）：二次确认「无法恢复」后执行 */
  const handlePurge = async (targets: TrashItem[]) => {
    if (targets.length === 0 || purging) return
    const trips = targets.filter((i) => i.kind === 'trip')
    const photos = targets.filter((i) => i.kind === 'photo')
    const ok = await confirmDialog({
      title: `彻底删除 ${targets.length === 1 ? `「${targets[0].name}」` : `${targets.length} 项`}？`,
      body:
        '此操作无法恢复。\n' +
        (trips.length > 0
          ? `将删除 ${trips.length} 个旅行${photos.length > 0 ? `和 ${photos.length} 项媒体` : ''}。`
          : '') +
        '文件会移入系统废纸篓作为误操作的最后一道保险，但画廊中无法再找回。',
      confirmText: '彻底删除',
      danger: true,
    })
    if (!ok) return
    setPurging(true)
    try {
      const result = await api.trashPurge(toSelection(targets))
      const purged = result.tripsCount + result.photosCount
      if (purged > 0) toast(`已彻底删除 ${purged} 项`, 'success')
      for (const f of result.failed) toast(`删除「${f.name}」失败：${f.reason}`, 'error')
      setSelectedIds((prev) => new Set([...prev].filter((k) => !targets.some((i) => itemKey(i) === k))))
      await Promise.all([reload(), refreshAll()])
    } catch (error: any) {
      toast('删除失败: ' + (error?.message ?? error), 'error')
    }
    setPurging(false)
  }

  /** 照片专属：原旅行还在业务视图时可直接跳转 */
  const handleViewTrip = (item: TrashItem) => {
    if (item.tripTrashed) {
      toast(`原旅行「${item.tripTitle}」也在回收站中，恢复后会一起回来`, 'info')
      return
    }
    if (item.tripId) navigate(`/trip/${item.tripId}`)
  }

  const trashMenuHandlers = {
    onRestore: (items: TrashItem[]) => void handleRestore(items),
    onPurge: (items: TrashItem[]) => void handlePurge(items),
    onViewTrip: handleViewTrip,
    onEnterSelect: (item: TrashItem) => {
      if (!selectedIds.has(itemKey(item))) toggleSelect(item)
    },
  }

  /** 条目右键：命中选择集且多于一项 → 批量菜单；否则单条菜单 */
  const handleItemContextMenu = (e: React.MouseEvent, item: TrashItem) => {
    if (selectedIds.size > 1 && selectedIds.has(itemKey(item))) {
      showContextMenuAt(e, buildTrashBatchMenu(selected, trashMenuHandlers, trashMenuIcons))
      return
    }
    if (!selectedIds.has(itemKey(item))) toggleSelect(item)
    showContextMenuAt(e, buildTrashItemMenu(item, trashMenuHandlers, trashMenuIcons))
  }

  /** 空白区右键：刷新 */
  const handleWallContextMenu = (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return
    showContextMenuAt(e, [
      { label: '刷新', icon: <RefreshIcon size={14} />, onSelect: () => void Promise.all([reload(), refreshAll()]) },
    ])
  }

  return (
    <div className="min-h-screen" onContextMenu={handleWallContextMenu}>
      {/* 顶栏（可拖拽） */}
      <header className="drag-region sticky top-0 z-10 h-12 bg-background/85 backdrop-blur-sm border-b border-line flex items-center justify-between pl-5 pr-5">
        <div className="flex items-center gap-3 min-w-0">
          <button
            onClick={() => navigate((location.state as { from?: string } | null)?.from ?? '/')}
            title="返回上一个页面（Esc）"
            className="no-drag flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary transition-colors"
          >
            <ArrowLeftIcon size={16} />
            <span>返回</span>
          </button>
          <h1 className="font-display font-bold text-xl text-ink">回收站</h1>
          <span className="text-xs text-ink-3 whitespace-nowrap">
            {items === null ? '读取中…' : items.length > 0 ? `${items.length} 项已删除` : ''}
          </span>
        </div>
        <button
          onClick={() => void Promise.all([reload(), refreshAll()])}
          className="no-drag p-2 text-ink-3 hover:text-primary rounded-lg transition-colors"
          title="刷新"
        >
          <RefreshIcon size={15} />
        </button>
      </header>

      <main className="max-w-[1100px] mx-auto px-10 py-10">
        {items === null ? (
          <div className="py-24 text-center text-ink-3 text-sm">读取中…</div>
        ) : items.length === 0 ? (
          <div className="text-center py-24">
            <p className="text-ink-3 mb-2 font-display text-2xl">回收站是空的</p>
            <p className="text-ink-3 text-sm mb-8">删除的照片、视频和旅行会先放在这里，随时可以恢复。</p>
          </div>
        ) : (
          <div data-testid="trash-grid" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {items.map((item) => (
              <TrashCard
                key={itemKey(item)}
                item={item}
                selected={selectedIds.has(itemKey(item))}
                selectionMode={selectedIds.size > 0}
                onToggleSelect={toggleSelect}
                onContextMenu={handleItemContextMenu}
                onRestore={() => void handleRestore([item])}
                onPurge={() => void handlePurge([item])}
              />
            ))}
          </div>
        )}
      </main>

      {/* 多选工具条 */}
      <AnimatePresence>
        {selectedIds.size > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 bg-surface border border-line shadow-xl rounded-full pl-5 pr-2 py-1.5 no-drag"
            data-testid="trash-selection-bar"
          >
            <span className="text-sm text-ink font-display whitespace-nowrap">
              已选 {selectedIds.size} 项
            </span>
            <span className="w-px h-5 bg-line mx-1.5" />
            <button
              onClick={() => void handleRestore(selected)}
              disabled={restoring}
              className="px-3 py-1.5 rounded-full text-sm text-ink-2 hover:text-primary hover:bg-primary-soft transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <RestoreIcon size={14} />
              <span>恢复</span>
            </button>
            <button
              onClick={() => void handlePurge(selected)}
              disabled={purging}
              className="px-3 py-1.5 rounded-full text-sm text-danger hover:bg-danger/10 transition-colors flex items-center gap-1.5 disabled:opacity-50"
            >
              <TrashIcon size={14} />
              <span>彻底删除</span>
            </button>
            <span className="w-px h-5 bg-line mx-1.5" />
            {selectedIds.size < (items?.length ?? 0) ? (
              <button
                onClick={() => setSelectedIds(new Set((items ?? []).map(itemKey)))}
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
    </div>
  )
}

/** 选择集键：travel/photo id 可能同值，加 kind 前缀区分 */
function itemKey(item: TrashItem): string {
  return `${item.kind}:${item.id}`
}

function toSelection(items: TrashItem[]): { photoIds: string[]; tripIds: string[] } {
  return {
    photoIds: items.filter((i) => i.kind === 'photo').map((i) => i.id),
    tripIds: items.filter((i) => i.kind === 'trip').map((i) => i.id),
  }
}

/** 回收站卡片：拍立得缩略图 + 元信息；点击勾选，悬停出恢复/彻底删除 */
const TrashCard: React.FC<{
  item: TrashItem
  selected: boolean
  selectionMode: boolean
  onToggleSelect: (item: TrashItem) => void
  onContextMenu: (e: React.MouseEvent, item: TrashItem) => void
  onRestore: () => void
  onPurge: () => void
}> = ({ item, selected, selectionMode, onToggleSelect, onContextMenu, onRestore, onPurge }) => {
  const isTrip = item.kind === 'trip'
  const isVideo = item.type === 'video'
  return (
    <div
      className="wall-item break-inside-avoid cursor-pointer relative group"
      data-testid={isTrip ? 'trash-card-trip' : 'trash-card-photo'}
      onClick={() => onToggleSelect(item)}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu(e, item)
      }}
    >
      <div
        className={`relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transition-shadow border bg-surface ${
          selected ? 'border-primary ring-2 ring-primary' : 'border-line'
        }`}
      >
        {/* 缩略图区：旅行封面 / 照片；无图或缺文件给占位 */}
        <div className="relative aspect-[4/3] bg-surface-2 flex items-center justify-center overflow-hidden">
          {item.thumbUrl && !item.fileMissing ? (
            <img src={item.thumbUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <span className="font-display text-ink-3 text-xs text-center px-4 leading-relaxed">
              {item.fileMissing
                ? '文件已不在磁盘\n仅可恢复记录'
                : isVideo
                  ? '暂无视频预览'
                  : '暂无缩略图'}
            </span>
          )}
          {/* 媒体类型角标 */}
          {isTrip ? (
            <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-primary text-primary-ink text-[10px] font-display shadow-sm flex items-center gap-1">
              <MoveToFolderIcon size={10} />
              旅行{item.photoCount ? ` · ${item.photoCount} 张` : ''}
            </span>
          ) : isVideo ? (
            <span className="absolute bottom-2 right-2 w-6 h-6 rounded-full bg-scrim/55 text-scrim-ink flex items-center justify-center">
              <PlayIcon size={10} />
            </span>
          ) : null}
          {selectionMode && (
            <div
              className={`absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-colors ${
                selected ? 'bg-primary text-primary-ink' : 'bg-scrim/40 text-scrim-ink/70'
              }`}
            >
              <CheckCircleIcon size={16} />
            </div>
          )}
          {/* 悬停操作：恢复 / 彻底删除 */}
          {!selectionMode && (
            <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                title="恢复"
                onClick={(e) => {
                  e.stopPropagation()
                  onRestore()
                }}
                className="w-7 h-7 rounded-full bg-scrim/45 text-scrim-ink hover:bg-primary transition-colors flex items-center justify-center"
              >
                <RestoreIcon size={13} />
              </button>
              <button
                title="彻底删除（无法恢复）"
                onClick={(e) => {
                  e.stopPropagation()
                  onPurge()
                }}
                className="w-7 h-7 rounded-full bg-scrim/45 text-scrim-ink hover:bg-danger transition-colors flex items-center justify-center"
              >
                <TrashIcon size={13} />
              </button>
            </div>
          )}
        </div>

        {/* 元信息 */}
        <div className="px-3 py-2.5 space-y-0.5">
          <div className="text-sm text-ink truncate flex items-center gap-1.5" title={item.name}>
            {!isTrip &&
              (isVideo ? <FilmIcon size={12} className="text-ink-3 shrink-0" /> : <ImageIcon size={12} className="text-ink-3 shrink-0" />)}
            <span className="truncate">{item.name}</span>
          </div>
          <div className="text-xs text-ink-3 truncate">
            {isTrip ? item.albumName : `来自「${item.tripTitle ?? ''}」`}
            <span className="mx-1">·</span>
            删除于 {formatDeletedAt(item.deletedAt)}
          </div>
          {item.fileMissing && (
            <div className="text-[11px] text-danger/90 flex items-center gap-1 pt-0.5">
              <WarningIcon size={11} />
              <span>文件已丢失，仅能恢复记录</span>
            </div>
          )}
          {!isTrip && item.tripTrashed && (
            <div className="text-[11px] text-ink-3 flex items-center gap-1 pt-0.5">
              <MoveToFolderIcon size={11} />
              <span>原旅行也在回收站，恢复时一并恢复</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TrashPage
