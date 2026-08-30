import React from 'react'
import { motion } from 'framer-motion'
import { displaySrc } from '../lib/api'
import { Photo } from '../types'
import { confirmDialog } from './feedback'
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartIcon,
  PenIcon,
  StarIcon,
  TagIcon,
  TrashIcon,
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
  /** 照片级收藏开关（信息栏心形按钮） */
  onToggleFavorite?: (photoId: string, favorite: boolean) => void
  /** 照片级标签编辑弹层入口 */
  onEditTags?: (photo: Photo) => void
}

interface ViewState {
  zoom: number
  x: number
  y: number
}

const MIN_ZOOM = 1
const MAX_ZOOM = 8

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/**
 * 灯箱：左右切换 + 滚轮/双击缩放 + 拖拽平移 + 底部胶片条 + 信息栏 + 图注/删除。
 * 缩放以指针/画布中心为锚点，平移范围按图片实际显示尺寸钳制。
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
}) => {
  const photo = photos[index]
  const [view, setView] = React.useState<ViewState>({ zoom: 1, x: 0, y: 0 })
  const [dragging, setDragging] = React.useState(false)
  const [loaded, setLoaded] = React.useState(false)
  const stageRef = React.useRef<HTMLDivElement>(null)
  const imgRef = React.useRef<HTMLImageElement>(null)
  const dragRef = React.useRef<{ px: number; py: number; ox: number; oy: number } | null>(null)
  const activeThumbRef = React.useRef<HTMLButtonElement>(null)

  const isVideo = photo.type === 'video'

  // 切换照片：复位缩放/平移/加载态
  React.useEffect(() => {
    setView({ zoom: 1, x: 0, y: 0 })
    setLoaded(false)
  }, [photo.id])

  // 预加载相邻原图，切换更跟手
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

  /** 以视图状态钳制平移范围（图片显示尺寸依据容器与缩放计算） */
  const clamped = React.useCallback((v: ViewState): ViewState => {
    const stage = stageRef.current
    const img = imgRef.current
    if (!stage || !img || !img.naturalWidth || v.zoom <= MIN_ZOOM) {
      return v.zoom <= MIN_ZOOM ? { ...v, x: 0, y: 0 } : v
    }
    const base = Math.min(
      stage.clientWidth / img.naturalWidth,
      stage.clientHeight / img.naturalHeight,
    )
    const maxX = Math.max(0, (img.naturalWidth * base * v.zoom - stage.clientWidth) / 2)
    const maxY = Math.max(0, (img.naturalHeight * base * v.zoom - stage.clientHeight) / 2)
    return { ...v, x: clamp(v.x, -maxX, maxX), y: clamp(v.y, -maxY, maxY) }
  }, [])

  /** 以屏幕点 (clientX, clientY) 为锚点缩放 factor 倍 */
  const zoomAt = React.useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const stage = stageRef.current
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      const px = clientX - rect.left - rect.width / 2
      const py = clientY - rect.top - rect.height / 2
      setView((v) => {
        const zoom = clamp(v.zoom * factor, MIN_ZOOM, MAX_ZOOM)
        if (zoom === v.zoom) return v
        if (zoom <= MIN_ZOOM) return { zoom: MIN_ZOOM, x: 0, y: 0 }
        const k = zoom / v.zoom
        return clamped({ zoom, x: (v.x + px) * k - px, y: (v.y + py) * k - py })
      })
    },
    [clamped],
  )

  // 滚轮缩放（React 的 onWheel 是 passive 的，必须原生监听才能 preventDefault）
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

  // 键盘：Esc 关闭、左右切换、+/-/0 缩放（输入框聚焦时让位）
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
      } else if (e.key === '+' || e.key === '=') {
        zoomAtCenter(1.3)
      } else if (e.key === '-') {
        zoomAtCenter(1 / 1.3)
      } else if (e.key === '0') {
        setView({ zoom: 1, x: 0, y: 0 })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, photos.length, onClose, onNavigate, zoomAt])

  const zoomAtCenter = (factor: number) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor)
  }

  const handlePointerDown = (e: React.PointerEvent) => {
    if (isVideo || view.zoom <= MIN_ZOOM) return
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    dragRef.current = { px: e.clientX, py: e.clientY, ox: view.x, oy: view.y }
    setDragging(true)
  }
  const handlePointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    setView((v) => clamped({ ...v, x: d.ox + (e.clientX - d.px), y: d.oy + (e.clientY - d.py) }))
  }
  const handlePointerUp = () => {
    dragRef.current = null
    setDragging(false)
  }

  const handleDoubleClick = (e: React.MouseEvent) => {
    if (isVideo) return
    if (view.zoom > MIN_ZOOM) {
      setView({ zoom: 1, x: 0, y: 0 })
    } else {
      zoomAt(e.clientX, e.clientY, 2.5)
    }
  }

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

  const formatTakenAt = (ms: number): string => {
    const d = new Date(ms)
    if (isNaN(d.getTime())) return ''
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  const cursor = isVideo
    ? undefined
    : view.zoom > MIN_ZOOM
      ? dragging
        ? 'grabbing'
        : 'grab'
      : 'zoom-in'

  const actionBtn =
    'text-white/80 hover:text-white transition-colors flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/10'

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
      onClick={onClose}
    >
        {/* 信息栏（左上） */}
        <div
          className="absolute top-5 left-6 z-10 flex flex-wrap items-center gap-2 max-w-[70vw] no-drag"
          onClick={(e) => e.stopPropagation()}
        >
          <span className="font-display text-sm text-white/90 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-sm">
            {index + 1} / {photos.length}
          </span>
          <span className="text-xs text-white/85 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-sm truncate max-w-[280px]">
            {photo.fileName}
          </span>
          {photo.takenAt != null && (
            <span className="text-xs text-white/85 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-sm font-display">
              摄于 {formatTakenAt(photo.takenAt)}
            </span>
          )}
          {photo.width != null && photo.height != null && (
            <span className="text-xs text-white/70 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-sm">
              {photo.width} × {photo.height}
            </span>
          )}
          {photo.tags.map((tag) => (
            <span
              key={tag}
              className="text-xs text-white/85 px-2.5 py-1 rounded-full bg-black/45 backdrop-blur-sm"
            >
              #{tag}
            </span>
          ))}
        </div>

        {/* 操作（右上）：收藏 / 图注 / 标签 / 封面 / 删除 / 关闭。stopPropagation 防止误触遮罩关闭 */}
        <div
          className="absolute top-5 right-6 z-10 flex items-center gap-1 no-drag"
          onClick={(e) => e.stopPropagation()}
        >
          {onToggleFavorite && (
            <button
              className={`transition-colors flex items-center justify-center w-9 h-9 rounded-full hover:bg-white/10 ${
                photo.favorite ? 'text-danger hover:text-danger' : 'text-white/80 hover:text-white'
              }`}
              title={photo.favorite ? '取消收藏' : '收藏'}
              onClick={() => onToggleFavorite(photo.id, !photo.favorite)}
            >
              <HeartIcon size={17} filled={photo.favorite} />
            </button>
          )}
          {onEditCaption && (
            <button className={actionBtn} title="编辑图注" onClick={() => onEditCaption(photo)}>
              <PenIcon size={17} />
            </button>
          )}
          {onEditTags && (
            <button className={actionBtn} title="编辑标签" onClick={() => onEditTags(photo)}>
              <TagIcon size={16} />
            </button>
          )}
          {onSetCover && coverPhotoId !== photo.id && (
            <button
              className={actionBtn}
              title="设为封面"
              onClick={() => onSetCover(photo.id)}
            >
              <StarIcon size={17} />
            </button>
          )}
          {onSetCover && coverPhotoId === photo.id && (
            <span className={`${actionBtn} text-primary`} title="当前封面">
              <StarIcon size={17} filled />
            </span>
          )}
          {onDeletePhoto && (
            <button className={actionBtn} title="删除（移入废纸篓）" onClick={() => void handleDelete()}>
              <TrashIcon size={17} />
            </button>
          )}
          <button className={actionBtn} title="关闭" onClick={onClose}>
            <XIcon size={20} />
          </button>
        </div>

        {/* 左右切换 */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNavigate((index - 1 + photos.length) % photos.length)
          }}
          className="absolute left-8 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10 transition-colors"
          title="上一张"
        >
          <ChevronLeftIcon size={36} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNavigate((index + 1) % photos.length)
          }}
          className="absolute right-8 top-1/2 -translate-y-1/2 text-white/80 hover:text-white z-10 transition-colors"
          title="下一张"
        >
          <ChevronRightIcon size={36} />
        </button>

        {/* 主图舞台（底部留出胶片条空间） */}
        <motion.div
          key={photo.id}
          initial={{ scale: 0.97 }}
          animate={{ scale: 1 }}
          className="h-full w-full min-w-0 pb-20 flex flex-col items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <div
            ref={stageRef}
            className="relative flex-1 min-h-0 w-full flex items-center justify-center overflow-hidden"
            style={{ cursor }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onDoubleClick={handleDoubleClick}
          >
            {isVideo ? (
              <video src={photo.mediaUrl} controls autoPlay className="max-h-full max-w-full" />
            ) : (
              <>
                <img
                  ref={imgRef}
                  src={photo.mediaUrl}
                  alt={photo.caption || ''}
                  draggable={false}
                  onLoad={() => setLoaded(true)}
                  className="max-h-full max-w-full object-contain select-none"
                  style={{
                    transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                    transition: dragging ? 'none' : 'transform 0.18s ease-out',
                  }}
                />
                {!loaded && (
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <div className="w-9 h-9 rounded-full border-2 border-white/25 border-t-white/85 animate-spin" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* 图注（可点击编辑） */}
          {photo.caption && onEditCaption && (
            <button
              onClick={() => onEditCaption(photo)}
              className="max-w-[70vw] mt-3 text-white/75 hover:text-white text-sm transition-colors truncate"
              title={photo.caption}
            >
              {photo.caption}
            </button>
          )}
          {photo.caption && !onEditCaption && (
            <p className="max-w-[70vw] mt-3 text-white/75 text-sm truncate">{photo.caption}</p>
          )}
        </motion.div>

        {/* 底部胶片条 */}
        <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-10 max-w-[86vw] overflow-x-auto scroll-slim bg-black/45 backdrop-blur-sm rounded-xl px-2 py-1.5">
          <div className="flex items-center gap-1.5">
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
                  className={`h-14 shrink-0 rounded-md overflow-hidden border-2 transition-all ${
                    i === index
                      ? 'border-primary opacity-100'
                      : 'border-transparent opacity-55 hover:opacity-90'
                  }`}
                >
                  {src ? (
                    <img src={src} alt="" className="h-full w-auto" draggable={false} />
                  ) : (
                    <span className="flex h-full w-20 items-center justify-center bg-white/10 text-[10px] text-white/60">
                      视频
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>
      </motion.div>
  )
}

export default Lightbox
