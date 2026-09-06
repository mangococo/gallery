import React from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { displaySrc } from '../lib/api'
import { Photo } from '../types'
import { confirmDialog } from './feedback'
import { showContextMenuAt } from './ContextMenu'
import { buildPhotoMenu, revealInLabel, type PhotoMenuHandlers } from '../lib/context-menus'
import {
  clampView,
  formatTakenStamp,
  formatVideoClock,
  MIN_ZOOM,
  MAX_ZOOM,
  zoomAtPoint,
  type ViewBox,
} from '../lib/viewer'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  EllipsisIcon,
  FilmIcon,
  HeartIcon,
  ImageIcon,
  InfoIcon,
  MapPinIcon,
  MaximizeIcon,
  MoveToFolderIcon,
  PauseIcon,
  PenIcon,
  PlayIcon,
  RevealIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
  VolumeIcon,
  VolumeMuteIcon,
  XIcon,
} from './icons'

interface LightboxProps {
  photos: Photo[]
  index: number
  onNavigate: (index: number) => void
  onClose: () => void
  onDeletePhoto?: (photoId: string) => void
  onEditCaption?: (photo: Photo) => void
  coverPhotoId?: string | null
  onSetCover?: (photoId: string) => void
  /** 照片级收藏开关 */
  onToggleFavorite?: (photoId: string, favorite: boolean) => void
  /** 照片级标签编辑弹层入口 */
  onEditTags?: (photo: Photo) => void
  /** 移动到旅行 */
  onMove?: (photos: Photo[]) => void
  onReveal?: (photo: Photo) => void
  onCopyPath?: (photo: Photo) => void
  /** 所属旅行标题（信息卡与顶栏展示） */
  tripTitle?: string
}

const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)

const menuIcons = {
  caption: <PenIcon size={14} />,
  tag: <TagIcon size={14} />,
  favorite: <HeartIcon size={14} />,
  cover: <StarIcon size={14} />,
  move: <MoveToFolderIcon size={14} />,
  reveal: <RevealIcon size={14} />,
  copy: <CopyIcon size={14} />,
  trash: <TrashIcon size={14} />,
}

/**
 * 灯箱 · 翻阅室：暖褐深色房间 + 拍立得主舞台 + 楷体手写图注 + 底部小拍立得胶片条。
 * 设计语言与主界面同源（surface/primary/楷体/胶带），不再是通用黑色查看器。
 * 缩放/平移作用在整张拍立得上——放大时卡片随照片一起呼吸，保持「实物」感。
 */
const Lightbox: React.FC<LightboxProps> = ({
  photos,
  index,
  onNavigate,
  onClose,
  onDeletePhoto,
  onEditCaption,
  coverPhotoId,
  onSetCover,
  onToggleFavorite,
  onEditTags,
  onMove,
  onReveal,
  onCopyPath,
  tripTitle,
}) => {
  const photo = photos[index]
  const [view, setView] = React.useState<ViewBox>({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const [failed, setFailed] = React.useState(false)
  const [infoOpen, setInfoOpen] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const polaroidRef = React.useRef<HTMLDivElement>(null)
  const dragRef = React.useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const activeThumbRef = React.useRef<HTMLButtonElement>(null)
  const rootRef = React.useRef<HTMLDivElement>(null)
  const videoRef = React.useRef<HTMLVideoElement | null>(null)

  const isVideo = photo.type === 'video'

  // 切换照片：复位缩放/平移/加载态
  React.useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 })
    setLoaded(false)
    setFailed(false)
  }, [photo.id])

  // 预加载相邻原图，切换更跟手（视频不预载，省内存）
  React.useEffect(() => {
    for (const p of [photos[index - 1], photos[index + 1]]) {
      if (p && p.type === 'image') {
        const img = new Image()
        img.src = p.mediaUrl
      }
    }
  }, [index, photos])

  // 胶片条自动滚动到当前张
  React.useEffect(() => {
    activeThumbRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [index])

  /** 舞台与拍立得的布局尺寸（offset* 不受 transform 影响） */
  const boxSize = () => ({
    stageW: stageRef.current?.clientWidth ?? 0,
    stageH: stageRef.current?.clientHeight ?? 0,
    boxW: polaroidRef.current?.offsetWidth ?? 0,
    boxH: polaroidRef.current?.offsetHeight ?? 0,
  })

  const applyView = (v: ViewBox) => {
    const { stageW, stageH, boxW, boxH } = boxSize()
    setView(clampView(v, stageW, stageH, boxW, boxH))
  }

  /** 以屏幕点为锚点缩放（相对拍立得中心） */
  const zoomAt = React.useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const stage = stageRef.current
      const box = polaroidRef.current
      if (!stage || !box) return
      const rect = stage.getBoundingClientRect()
      const cx = rect.left + rect.width / 2 + view.x
      const cy = rect.top + rect.height / 2 + view.y
      const { stageW, stageH, boxW, boxH } = boxSize()
      setView((v) => zoomAtPoint(v, clientX - cx, clientY - cy, factor, stageW, stageH, boxW, boxH))
    },
    // view.x/y 进闭包：锚点随当前平移走
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view.x, view.y],
  )

  const zoomAtCenter = (factor: number) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  const toggleFullscreen = () => {
    const el = rootRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }

  // 滚轮缩放（passive 监听器里必须原生绑定才能 preventDefault）
  React.useEffect(() => {
    const el = stageRef.current
    if (!el || isVideo) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.18 : 1 / 1.18)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [isVideo, zoomAt, photo.id])

  const handleDelete = async () => {
    if (!onDeletePhoto) return
    const ok = await confirmDialog({
      title: '把这张照片移入废纸篓？',
      body: photo.fileName,
      confirmText: '移入废纸篓',
      danger: true,
    })
    if (ok) onDeletePhoto(photo.id)
  }

  const openMenu = (e: React.MouseEvent) => {
    const handlers: PhotoMenuHandlers = {
      onEditCaption: onEditCaption ? (p) => onEditCaption(p) : undefined,
      onEditTags: onEditTags ? (p) => onEditTags(p) : undefined,
      onToggleFavorite: onToggleFavorite
        ? (p, favorite) => onToggleFavorite(p.id, favorite)
        : undefined,
      onSetCover: onSetCover ? (p) => onSetCover(p.id) : undefined,
      onMove: onMove ? (ps) => onMove(ps) : undefined,
      onReveal: onReveal ? (p) => onReveal(p) : undefined,
      onCopyPath: onCopyPath ? (p) => onCopyPath(p) : undefined,
      onDelete: onDeletePhoto ? () => void handleDelete() : undefined,
    }
    showContextMenuAt(
      e,
      buildPhotoMenu(photo, handlers, menuIcons, {
        isCover: coverPhotoId === photo.id,
        canSelect: false,
        isMac,
      }),
    )
  }

  // 键盘：←→ 切换 / Esc 关闭 / Space 播放暂停 / +-0 缩放 / F 全屏 / I 信息 / ⌫ 删除
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowLeft') {
        onNavigate((index - 1 + photos.length) % photos.length)
      } else if (e.key === 'ArrowRight') {
        onNavigate((index + 1) % photos.length)
      } else if (e.key === ' ' || e.code === 'Space') {
        // Space 在按钮上时交给按钮默认行为，避免双触发
        if (isVideo && !(t && (t.tagName === 'BUTTON' || t.closest?.('button')))) {
          e.preventDefault()
          videoRef.current?.paused ? videoRef.current?.play() : videoRef.current?.pause()
        }
      } else if (e.key === '+' || e.key === '=') {
        zoomAtCenter(1.3)
      } else if (e.key === '-') {
        zoomAtCenter(1 / 1.3)
      } else if (e.key === '0') {
        applyView({ zoom: MIN_ZOOM, x: 0, y: 0 })
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen()
      } else if (e.key === 'i' || e.key === 'I') {
        setInfoOpen((v) => !v)
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (onDeletePhoto) void handleDelete()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos.length, isVideo, onClose, onNavigate, photo.id])

  // —— 平移拖拽（zoom > 1 时） ——
  const handlePointerDown = (e: React.PointerEvent) => {
    if (isVideo || view.zoom <= MIN_ZOOM) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y }
    setDragging(true)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    applyView({ ...view, x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) })
  }
  const handlePointerUp = () => {
    dragRef.current = null
    setDragging(false)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isVideo) return
    if (view.zoom > MIN_ZOOM) applyView({ zoom: MIN_ZOOM, x: 0, y: 0 })
    else zoomAt(e.clientX, e.clientY, 2.5)
  }

  /** 背景点击：放大态先复位，复位后再点才关闭 */
  const handleBackdropClick = () => {
    if (!isVideo && view.zoom > MIN_ZOOM) {
      applyView({ zoom: MIN_ZOOM, x: 0, y: 0 })
      return
    }
    onClose()
  }

  const cursor = isVideo
    ? undefined
    : view.zoom > MIN_ZOOM
      ? dragging
        ? 'grabbing'
        : 'grab'
      : 'zoom-in'

  const takenStamp = formatTakenStamp(photo.takenAt)

  return (
    <motion.div
      ref={rootRef}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      className="fixed inset-0 z-50 bg-viewer flex flex-col select-none"
      onContextMenu={(e) => {
        // 灯箱内右键 = 当前媒体操作菜单（覆盖浏览器默认）
        e.preventDefault()
        openMenu(e)
      }}
    >
      {/* —— 顶栏：返回 / 旅行上下文 / 位置 / 操作 —— */}
      <div className="absolute top-0 inset-x-0 z-20 viewer-fade-top pointer-events-none">
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 pt-3 md:pt-4 pb-8 pointer-events-auto">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={onClose}
              title="关闭（Esc）"
              className="w-9 h-9 rounded-full flex items-center justify-center text-viewer-ink-2 hover:text-viewer-ink hover:bg-viewer-2 transition-colors"
            >
              <XIcon size={18} />
            </button>
            <div className="min-w-0 hidden sm:block">
              <div className="font-display text-viewer-ink text-base leading-tight truncate">
                {tripTitle ?? photo.fileName}
              </div>
              {takenStamp && (
                <div className="text-[11px] text-viewer-ink-2 tabular-nums truncate">
                  {takenStamp.split(' · ')[0]}
                </div>
              )}
            </div>
          </div>

          {/* 位置指示：和纸胶带贴纸 */}
          <div className="washi-label !transform-none px-3 py-1 text-xs font-display shrink-0 hidden xs:block sm:block">
            {index + 1} / {photos.length}
          </div>

          <div className="flex items-center gap-0.5 no-drag">
            {onToggleFavorite && (
              <button
                className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors ${
                  photo.favorite
                    ? 'text-danger hover:bg-viewer-2'
                    : 'text-viewer-ink-2 hover:text-viewer-ink hover:bg-viewer-2'
                }`}
                title={photo.favorite ? '取消收藏' : '收藏'}
                onClick={() => onToggleFavorite(photo.id, !photo.favorite)}
              >
                <HeartIcon size={17} filled={photo.favorite} />
              </button>
            )}
            <button
              className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors hover:bg-viewer-2 ${
                infoOpen ? 'text-primary' : 'text-viewer-ink-2 hover:text-viewer-ink'
              }`}
              title="照片信息（I）"
              onClick={() => setInfoOpen((v) => !v)}
            >
              <InfoIcon size={17} />
            </button>
            <button
              className="w-9 h-9 rounded-full flex items-center justify-center text-viewer-ink-2 hover:text-viewer-ink hover:bg-viewer-2 transition-colors"
              title="更多操作"
              onClick={(e) => {
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                showContextMenuAt(
                  { clientX: r.left, clientY: r.bottom + 4, preventDefault: () => {} },
                  buildPhotoMenu(
                    photo,
                    {
                      onEditCaption: onEditCaption,
                      onEditTags: onEditTags,
                      onToggleFavorite: onToggleFavorite
                        ? (p, favorite) => onToggleFavorite(p.id, favorite)
                        : undefined,
                      onSetCover: onSetCover ? (p) => onSetCover(p.id) : undefined,
                      onMove: onMove,
                      onReveal: onReveal,
                      onCopyPath: onCopyPath,
                      onDelete: onDeletePhoto ? () => void handleDelete() : undefined,
                    },
                    menuIcons,
                    { isCover: coverPhotoId === photo.id, canSelect: false, isMac },
                  ),
                )
              }}
            >
              <EllipsisIcon size={17} />
            </button>
          </div>
        </div>
      </div>

      {/* —— 主舞台 —— */}
      <div
        ref={stageRef}
        className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden px-4 md:px-10 pb-24 pt-16"
        style={{ cursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={handleDoubleClick}
        onClick={handleBackdropClick}
      >
        {/* 左右切换 */}
        {photos.length > 1 && (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigate((index - 1 + photos.length) % photos.length)
              }}
              className="absolute left-3 md:left-6 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full flex items-center justify-center text-viewer-ink-2 hover:text-viewer-ink bg-viewer-2/60 hover:bg-viewer-2 transition-colors"
              title="上一张（←）"
            >
              <ChevronLeftIcon size={22} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onNavigate((index + 1) % photos.length)
              }}
              className="absolute right-3 md:right-6 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-full flex items-center justify-center text-viewer-ink-2 hover:text-viewer-ink bg-viewer-2/60 hover:bg-viewer-2 transition-colors"
              title="下一张（→）"
            >
              <ChevronRightIcon size={22} />
            </button>
          </>
        )}

        {/* 缩放/平移容器（拍立得整体变换） */}
        <div
          ref={polaroidRef}
          data-testid="lightbox-stage-box"
          className="relative flex items-center justify-center max-w-full max-h-full"
          style={{
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
            transition: dragging ? 'none' : 'transform 0.18s ease-out',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={photo.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="viewer-polaroid flex flex-col max-w-full"
            >
              <div className="relative flex items-center justify-center min-h-0">
                {isVideo ? (
                  <VideoStage photo={photo} videoRef={videoRef} />
                ) : (
                  <>
                    <img
                      src={photo.mediaUrl}
                      alt={photo.caption || photo.fileName}
                      draggable={false}
                      onLoad={() => setLoaded(true)}
                      onError={() => {
                        setLoaded(true)
                        setFailed(true)
                      }}
                      className="max-h-[min(68vh,900px)] max-w-[min(86vw,1200px)] w-auto h-auto object-contain rounded-[2px]"
                    />
                    {!loaded && (
                      <div className="absolute inset-0 w-64 h-44 flex items-center justify-center">
                        <div className="w-9 h-9 rounded-full border-2 border-viewer-ink-2/25 border-t-viewer-ink-2/85 animate-spin" />
                      </div>
                    )}
                    {failed && (
                      <div className="absolute inset-0 flex items-center justify-center bg-surface">
                        <p className="text-xs text-ink-3 px-6 text-center leading-relaxed">
                          这张照片加载失败
                          <br />
                          文件可能已被移动或删除
                        </p>
                      </div>
                    )}
                  </>
                )}
                {/* 视频角标 */}
                {isVideo && (
                  <span className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/45 text-white/90 text-[10px] flex items-center gap-1">
                    <FilmIcon size={10} />
                    视频
                  </span>
                )}
              </div>

              {/* 拍立得下边缘：楷体图注 / 视频控制条 */}
              {isVideo ? (
                <VideoControls videoRef={videoRef} />
              ) : (
                <button
                  onClick={() => onEditCaption?.(photo)}
                  disabled={!onEditCaption}
                  title={onEditCaption ? '点击编辑图注' : undefined}
                  className={`w-full px-4 pt-2.5 pb-3 text-center font-display text-sm leading-snug truncate ${
                    photo.caption ? 'text-ink-2' : 'text-ink-3'
                  } ${onEditCaption ? 'hover:text-primary transition-colors' : 'cursor-default'}`}
                >
                  {photo.caption || formatTakenStamp(photo.takenAt).split(' · ')[0] || photo.fileName}
                </button>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* —— 信息卡（I 展开的手账便签） —— */}
      <AnimatePresence>
        {infoOpen && (
          <motion.aside
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="absolute right-4 md:right-6 top-20 z-20 w-72 max-h-[60vh] overflow-y-auto scroll-slim bg-surface/95 backdrop-blur-sm border border-line rounded-2xl shadow-2xl p-4 space-y-3 no-drag"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h4 className="font-display text-base text-ink">照片信息</h4>
              <button
                onClick={() => setInfoOpen(false)}
                className="w-6 h-6 rounded-full flex items-center justify-center text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors"
              >
                <XIcon size={13} />
              </button>
            </div>
            {takenStamp && <InfoRow label="拍摄时间" value={takenStamp} />}
            <InfoRow label="文件" value={photo.fileName} mono />
            {photo.width != null && photo.height != null && (
              <InfoRow label="尺寸" value={`${photo.width} × ${photo.height}`} />
            )}
            <InfoRow
              label="类型"
              value={isVideo ? '视频' : '照片'}
              icon={isVideo ? <FilmIcon size={12} /> : <ImageIcon size={12} />}
            />
            {tripTitle && <InfoRow label="所属旅行" value={tripTitle} />}
            {photo.gpsLat != null && photo.gpsLon != null && (
              <div className="flex items-center gap-2 text-xs">
                <span className="text-ink-3 flex items-center gap-1 shrink-0">
                  <MapPinIcon size={12} />
                  坐标
                </span>
                <span className="text-ink-2 tabular-nums truncate">
                  {photo.gpsLat.toFixed(4)}, {photo.gpsLon.toFixed(4)}
                </span>
              </div>
            )}
            {photo.tags.length > 0 && (
              <div>
                <div className="text-xs text-ink-3 mb-1.5 flex items-center gap-1">
                  <TagIcon size={12} />
                  标签
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {photo.tags.map((tag) => (
                    <span key={tag} className="px-2 py-0.5 bg-primary-soft text-primary text-xs rounded-full">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-0.5">
              {onEditCaption && (
                <button
                  onClick={() => onEditCaption(photo)}
                  className="flex-1 px-3 py-2 rounded-xl text-xs text-primary bg-primary-soft hover:opacity-85 transition-opacity flex items-center justify-center gap-1.5"
                >
                  <PenIcon size={12} />
                  <span>编辑图注</span>
                </button>
              )}
              {onEditTags && (
                <button
                  title="编辑标签"
                  onClick={() => onEditTags(photo)}
                  className="flex-1 px-3 py-2 rounded-xl text-xs text-primary bg-primary-soft hover:opacity-85 transition-opacity flex items-center justify-center gap-1.5"
                >
                  <TagIcon size={12} />
                  <span>编辑标签</span>
                </button>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* —— 底部胶片条：一排小拍立得 —— */}
      {photos.length > 1 && (
        <div className="absolute bottom-0 inset-x-0 z-20 viewer-fade-bottom pointer-events-none">
          <div className="flex justify-center pb-3 pt-10 pointer-events-auto">
            <div data-testid="lightbox-filmstrip" className="flex items-center gap-1.5 max-w-[82vw] overflow-x-auto scroll-slim px-2 py-1.5">
              {photos.map((p, i) => {
                const src = displaySrc(p)
                return (
                  <button
                    key={p.id}
                    ref={i === index ? activeThumbRef : undefined}
                    onClick={(e) => {
                      e.stopPropagation()
                      onNavigate(i)
                    }}
                    title={p.caption || p.fileName}
                    className={`relative shrink-0 h-12 md:h-14 rounded-[3px] bg-surface p-[3px] transition-all duration-150 ${
                      i === index
                        ? 'ring-2 ring-primary -translate-y-1 shadow-lg'
                        : 'opacity-60 hover:opacity-95'
                    }`}
                  >
                    {src ? (
                      <img src={src} alt="" className="h-full w-auto rounded-[1px]" draggable={false} />
                    ) : (
                      <span className="flex h-full w-16 items-center justify-center text-[10px] text-ink-3">
                        <FilmIcon size={12} />
                      </span>
                    )}
                    {p.type === 'video' && (
                      <span className="absolute bottom-1 right-1 w-4 h-4 rounded-full bg-black/55 text-white flex items-center justify-center">
                        <PlayIcon size={7} />
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  )
}

function InfoRow({
  label,
  value,
  mono,
  icon,
}: {
  label: string
  value: string
  mono?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-ink-3 shrink-0 flex items-center gap-1">
        {icon}
        {label}
      </span>
      <span className={`text-ink-2 text-right flex-1 break-all ${mono ? 'text-[11px]' : ''}`}>{value}</span>
    </div>
  )
}

/** 视频舞台：海报帧 + 点击播放，与照片共享拍立得外框 */
const VideoStage: React.FC<{
  photo: Photo
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
}> = ({ photo, videoRef }) => {
  const [started, setStarted] = React.useState(false)
  const poster = photo.thumbUrl || undefined

  return (
    <div className="relative">
      <video
        ref={videoRef}
        src={photo.mediaUrl}
        poster={poster}
        preload="metadata"
        playsInline
        onPlay={() => setStarted(true)}
        className="max-h-[min(62vh,820px)] max-w-[min(84vw,1100px)] w-auto h-auto rounded-[2px] bg-black"
        onClick={(e) => {
          e.stopPropagation()
          const v = videoRef.current
          if (!v) return
          v.paused ? void v.play() : v.pause()
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          const v = videoRef.current
          if (!v) return
          if (document.fullscreenElement) void document.exitFullscreen()
          else void v.requestFullscreen?.()
        }}
      />
      {!started && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            void videoRef.current?.play()
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/20"
          title="播放（Space）"
        >
          <span className="w-16 h-16 rounded-full bg-surface/95 shadow-xl flex items-center justify-center text-primary">
            <PlayIcon size={24} />
          </span>
        </button>
      )}
    </div>
  )
}

/** 视频控制条：占住拍立得下边缘，与图注同一位置（播放/进度/音量/全屏） */
const VideoControls: React.FC<{
  videoRef: React.MutableRefObject<HTMLVideoElement | null>
}> = ({ videoRef }) => {
  const [playing, setPlaying] = React.useState(false)
  const [time, setTime] = React.useState(0)
  const [duration, setDuration] = React.useState(0)
  const [muted, setMuted] = React.useState(false)
  const [volume, setVolume] = React.useState(1)

  // 视频元素随灯箱切换重建，事件每次重绑
  const attach = () => {
    const v = videoRef.current
    if (!v) return () => {}
    const onTime = () => setTime(v.currentTime)
    const onDur = () => setDuration(v.duration || 0)
    const onPlay = () => setPlaying(true)
    const onPause = () => setPlaying(false)
    const onVol = () => {
      setMuted(v.muted)
      setVolume(v.volume)
    }
    v.addEventListener('timeupdate', onTime)
    v.addEventListener('durationchange', onDur)
    v.addEventListener('loadedmetadata', onDur)
    v.addEventListener('play', onPlay)
    v.addEventListener('pause', onPause)
    v.addEventListener('volumechange', onVol)
    onDur()
    onVol()
    return () => {
      v.removeEventListener('timeupdate', onTime)
      v.removeEventListener('durationchange', onDur)
      v.removeEventListener('loadedmetadata', onDur)
      v.removeEventListener('play', onPlay)
      v.removeEventListener('pause', onPause)
      v.removeEventListener('volumechange', onVol)
    }
  }
  React.useEffect(attach, [videoRef])

  const seek = (val: number) => {
    const v = videoRef.current
    if (!v || !Number.isFinite(val)) return
    v.currentTime = val
    setTime(val)
  }

  const btn =
    'w-8 h-8 rounded-full flex items-center justify-center text-ink-2 hover:text-primary hover:bg-surface-2 transition-colors shrink-0'

  const pct = duration > 0 ? (time / duration) * 100 : 0

  return (
    <div className="w-full px-3 pb-2 pt-2.5 flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <button
        className={btn}
        title={playing ? '暂停（Space）' : '播放（Space）'}
        onClick={() => {
          const v = videoRef.current
          if (!v) return
          v.paused ? void v.play() : v.pause()
        }}
      >
        {playing ? <PauseIcon size={14} /> : <PlayIcon size={14} />}
      </button>
      <span className="text-[11px] text-ink-3 tabular-nums shrink-0 w-10 text-center">
        {formatVideoClock(time)}
      </span>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={time}
        onChange={(e) => seek(Number(e.target.value))}
        className="viewer-range flex-1 min-w-[80px]"
        style={{ ['--fill' as string]: `${pct}%` }}
        aria-label="播放进度"
      />
      <span className="text-[11px] text-ink-3 tabular-nums shrink-0 w-10 text-center">
        {formatVideoClock(duration)}
      </span>
      <button
        className={`${btn} ${muted ? '' : 'text-primary'}`}
        title={muted ? '取消静音' : '静音'}
        onClick={() => {
          const v = videoRef.current
          if (!v) return
          v.muted = !v.muted
        }}
      >
        {muted || volume === 0 ? <VolumeMuteIcon size={14} /> : <VolumeIcon size={14} />}
      </button>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        onChange={(e) => {
          const v = videoRef.current
          if (!v) return
          v.volume = Number(e.target.value)
          v.muted = Number(e.target.value) === 0
        }}
        className="viewer-range w-14 hidden sm:block shrink-0"
        style={{ ['--fill' as string]: `${(muted ? 0 : volume) * 100}%` }}
        aria-label="音量"
      />
      <button className={btn} title="全屏（F）" onClick={() => {
        const v = videoRef.current
        if (document.fullscreenElement) void document.exitFullscreen()
        else void (v?.requestFullscreen?.() ?? v?.parentElement?.requestFullscreen?.())
      }}>
        <MaximizeIcon size={14} />
      </button>
    </div>
  )
}

export default Lightbox
