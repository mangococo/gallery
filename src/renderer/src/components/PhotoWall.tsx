import React from 'react'
import { motion } from 'framer-motion'
import { Photo, PhotoDTO } from '../types'
import { displaySrc } from '../lib/api'
import { confirmDialog } from './feedback'
import { CheckCircleIcon, HeartIcon, PenIcon, StarIcon, TrashIcon } from './icons'

interface PhotoWallProps {
  photos: Photo[]
  onPhotoClick?: (photo: Photo) => void
  onDeletePhoto?: (photoId: string) => void
  onEditCaption?: (photo: Photo) => void
  showDeleteButton?: boolean
  coverPhotoId?: string | null
  onSetCover?: (photoId: string) => void
  /** 照片级收藏开关（悬停心形按钮） */
  onToggleFavorite?: (photoId: string, favorite: boolean) => void
  /** 多选：激活后点击卡片改为勾选/取消，不再打开灯箱 */
  selectionMode?: boolean
  selectedIds?: Set<string>
  /** 勾选/取消一张（additive 由事件修饰键决定，页面侧统一处理） */
  onToggleSelect?: (photo: Photo) => void
  /** 卡片右键（含选择态下的批量语义由页面组装） */
  onPhotoContextMenu?: (e: React.MouseEvent, photo: Photo) => void
  /** 空白区域右键（目标非卡片时才触发） */
  onWallContextMenu?: (e: React.MouseEvent) => void
  /** 空态文案：无照片时的标题/提示（默认「还没有照片」） */
  emptyTitle?: string
  emptyHint?: string
}

/** 超过该张数走大相册模式：逐项 framer-motion 入场动画关闭（CSS 悬停替代），保滚动流畅 */
const LARGE_ALBUM_THRESHOLD = 120

/** 照片墙单元：图片用缩略图；视频用海报帧 + 播放角标 */
function WallMedia({ photo }: { photo: PhotoDTO }) {
  const src = displaySrc(photo)
  if (photo.type === 'video') {
    return (
      <div className="relative aspect-[4/3]">
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <PlaceholderBackdrop text={photo.thumbStatus === 'failed' ? '视频海报生成失败' : '视频海报生成中…'} />
        )}
        <PlayBadge />
      </div>
    )
  }
  // 图片缩略图未就绪：占位（不回退原图，#3）；就绪后经 push:thumbs-ready 增量点亮。
  // 宽高来自缩略图生成时回写（无则 4:3 兜底）——容器先占住最终高度，
  // 图片加载完成不再改变卡片高度，多列瀑布流不重平衡（#7 滚动回弹根因）
  const aspect = photo.width && photo.height ? `${photo.width} / ${photo.height}` : '4 / 3'
  if (!src) {
    return (
      <div className="relative w-full" style={{ aspectRatio: aspect }}>
        <PlaceholderBackdrop text={photo.thumbStatus === 'failed' ? '缩略图生成失败' : '缩略图生成中…'} />
      </div>
    )
  }
  return (
    <div className="relative w-full" style={{ aspectRatio: aspect }}>
      <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
    </div>
  )
}

function PlaceholderBackdrop({ text }: { text: string }) {
  return (
    <div className="absolute inset-0 bg-surface-2 flex items-center justify-center">
      <span className="font-display text-ink-3 text-xs">{text}</span>
    </div>
  )
}

function PlayBadge() {
  return (
    <div className="absolute inset-0 bg-scrim/20 flex items-center justify-center">
      <div className="w-14 h-14 bg-scrim-ink/90 rounded-full flex items-center justify-center shadow-lg">
        <div className="w-0 h-0 border-l-[11px] border-l-primary border-y-[7px] border-y-transparent ml-1"></div>
      </div>
    </div>
  )
}

/**
 * 稳定回调（ref 转发）：卡片级回调身份恒定，CardInner 的 memo 浅比较才不会
 * 因页面重渲染（如每次勾选生成新 Set / 新闭包）而失效——单次勾选只重渲染
 * 受影响的卡片，整墙其余卡片全部跳过（#7）。
 */
function useStableCallback<T extends (...args: never[]) => unknown>(fn: T | undefined): T {
  const ref = React.useRef(fn)
  ref.current = fn
  return React.useCallback(((...args: never[]) => ref.current?.(...args)) as T, [])
}

const PhotoWall: React.FC<PhotoWallProps> = ({
  photos,
  onPhotoClick,
  onDeletePhoto,
  onEditCaption,
  showDeleteButton = false,
  coverPhotoId = null,
  onSetCover,
  onToggleFavorite,
  selectionMode = false,
  selectedIds,
  onToggleSelect,
  onPhotoContextMenu,
  onWallContextMenu,
  emptyTitle,
  emptyHint,
}) => {
  const handleDelete = useStableCallback(async (photo: Photo) => {
    const ok = await confirmDialog({
      title: '把这张照片移入回收站？',
      body: photo.fileName,
      confirmText: '移入回收站',
      danger: true,
    })
    if (ok) onDeletePhoto?.(photo.id)
  })

  // 透过 ref 转发拿到稳定身份的卡片级回调（页面传入的闭包每次渲染都是新的）
  const stableEditCaption = useStableCallback(onEditCaption)
  const stableSetCover = useStableCallback(onSetCover)
  const stableDeletePhoto = useStableCallback(onDeletePhoto)
  const stableToggleFavorite = useStableCallback(onToggleFavorite)

  const largeMode = photos.length > LARGE_ALBUM_THRESHOLD

  /** 激活卡片：多选态勾选；⌘/Ctrl 点按 anywhere 勾选；否则打开灯箱 */
  const activate = (photo: Photo, e: React.MouseEvent) => {
    if (selectionMode || e.metaKey || e.ctrlKey) {
      e.preventDefault()
      onToggleSelect?.(photo)
      return
    }
    onPhotoClick?.(photo)
  }

  return (
    <div
      data-testid="photo-wall"
      className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4"
      onContextMenu={(e) => {
        // 只有真正点在留白处（容器自身）才算空白区右键
        if (e.target === e.currentTarget) onWallContextMenu?.(e)
      }}
    >
      {/* 空态：拍立得空白相框占位（空旅行 / 筛选无结果），右键同样可呼出墙菜单 */}
      {photos.length === 0 && (
        <div
          data-testid="photo-wall-empty"
          className="py-14 flex flex-col items-center gap-4 text-center"
          onContextMenu={(e) => onWallContextMenu?.(e)}
        >
          <div className="w-44 h-32 polaroid-frame -rotate-2 flex items-center justify-center">
            <span className="font-display text-xs text-ink-3">{emptyTitle ?? '还没有照片'}</span>
          </div>
          {emptyHint && <p className="text-sm text-ink-3 max-w-md leading-relaxed">{emptyHint}</p>}
        </div>
      )}
      {photos.map((photo, index) => {
        const selected = selectedIds?.has(photo.id) ?? false
        const inner = (
          <CardInner
            photo={photo}
            coverPhotoId={coverPhotoId}
            onEditCaption={stableEditCaption}
            onSetCover={stableSetCover}
            showDeleteButton={showDeleteButton}
            onDeletePhoto={stableDeletePhoto}
            onToggleFavorite={stableToggleFavorite}
            onDelete={handleDelete}
            selected={selected}
            selectionMode={selectionMode}
          />
        )
        const ctxMenu = onPhotoContextMenu ? { onContextMenu: (e: React.MouseEvent) => onPhotoContextMenu(e, photo) } : {}
        if (largeMode) {
          return (
            <div
              key={photo.id}
              className="wall-item wall-item-large break-inside-avoid cursor-pointer relative group"
              onClick={(e) => activate(photo, e)}
              {...ctxMenu}
            >
              {inner}
            </div>
          )
        }
        return (
          <motion.div
            key={photo.id}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.8) }}
            whileHover={{ scale: 1.03, zIndex: 10 }}
            className="wall-item break-inside-avoid cursor-pointer relative group"
            onClick={(e) => activate(photo, e)}
            {...ctxMenu}
          >
            {inner}
          </motion.div>
        )
      })}
    </div>
  )
}

/** 卡片本体（普通/大相册两种包装共用）。memo：勾选只改 selected 布尔，
 * 其余 prop 经 useStableCallback/数据稳定引用保持恒定 → 只重渲染受影响卡片 */
const CardInner: React.FC<{
  photo: Photo
  coverPhotoId: string | null
  onEditCaption?: (photo: Photo) => void
  onSetCover?: (photoId: string) => void
  showDeleteButton: boolean
  onDeletePhoto?: (photoId: string) => void
  onToggleFavorite?: (photoId: string, favorite: boolean) => void
  onDelete: (photo: Photo) => Promise<void>
  selected: boolean
  selectionMode: boolean
}> = React.memo(({
  photo,
  coverPhotoId,
  onEditCaption,
  onSetCover,
  showDeleteButton,
  onDeletePhoto,
  onToggleFavorite,
  onDelete,
  selected,
  selectionMode,
}) => {
  // E2E 渲染计量（#7）：生产零开销分支预测，链路断言单次勾选的重渲染范围
  if (typeof window !== 'undefined' && (window as unknown as { __galleryE2e?: boolean }).__galleryE2e) {
    const w = window as unknown as { __cardRenders?: number }
    w.__cardRenders = (w.__cardRenders ?? 0) + 1
  }
  return (
    <div
      className={`relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transition-shadow border ${
        selected ? 'border-primary ring-2 ring-primary' : 'border-line'
      }`}
    >
      <WallMedia photo={photo} />

      {/* 多选勾选徽标 */}
      {(selectionMode || selected) && (
        <div
          className={`absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md transition-colors ${
            selected ? 'bg-primary text-primary-ink' : 'bg-scrim/40 text-scrim-ink/70'
          }`}
        >
          <CheckCircleIcon size={16} />
        </div>
      )}

      {/* 封面/收藏徽标（多选时给勾选徽标让位） */}
      {coverPhotoId === photo.id && !selectionMode && (
        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-primary text-primary-ink text-xs shadow-sm flex items-center gap-1">
          <StarIcon size={10} filled />
          <span>封面</span>
        </div>
      )}
      {photo.favorite && !selectionMode && (
        <div
          className={`absolute top-2 ${coverPhotoId === photo.id ? 'left-[64px]' : 'left-2'} px-1.5 py-0.5 rounded-full bg-danger text-danger-ink shadow-sm flex items-center`}
          title="已收藏"
        >
          <HeartIcon size={10} filled />
        </div>
      )}

      {/* 悬停操作（多选时隐藏，避免与勾选手势冲突） */}
      {!selectionMode && (
        <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          {onToggleFavorite && (
            <button
              title={photo.favorite ? '取消收藏' : '收藏'}
              onClick={(e) => {
                e.stopPropagation()
                onToggleFavorite(photo.id, !photo.favorite)
              }}
              className={`w-7 h-7 rounded-full hover:bg-danger transition-colors flex items-center justify-center ${
                photo.favorite ? 'bg-danger/80 text-scrim-ink' : 'bg-scrim/45 text-scrim-ink'
              }`}
            >
              <HeartIcon size={13} filled={photo.favorite} />
            </button>
          )}
          {onEditCaption && (
            <button
              title="编辑图注"
              onClick={(e) => {
                e.stopPropagation()
                onEditCaption(photo)
              }}
              className="w-7 h-7 bg-scrim/45 text-scrim-ink rounded-full hover:bg-primary transition-colors flex items-center justify-center"
            >
              <PenIcon size={13} />
            </button>
          )}
          {onSetCover && coverPhotoId !== photo.id && (
            <button
              title="设为封面"
              onClick={(e) => {
                e.stopPropagation()
                onSetCover(photo.id)
              }}
              className="w-7 h-7 bg-scrim/45 text-scrim-ink rounded-full hover:bg-primary transition-colors flex items-center justify-center"
            >
              <StarIcon size={13} filled />
            </button>
          )}
          {showDeleteButton && onDeletePhoto && (
            <button
              title="删除（移入回收站）"
              onClick={(e) => {
                e.stopPropagation()
                void onDelete(photo)
              }}
              className="w-7 h-7 bg-scrim/45 text-scrim-ink rounded-full hover:bg-danger transition-colors flex items-center justify-center"
            >
              <TrashIcon size={13} />
            </button>
          )}
        </div>
      )}

      {/* 图注：点击直接编辑 */}
      {photo.caption && (
        <div
          role="button"
          title={onEditCaption ? '点击编辑图注' : undefined}
          onClick={(e) => {
            if (!onEditCaption) return
            e.stopPropagation()
            onEditCaption(photo)
          }}
          className={`px-3 py-2 bg-surface text-xs text-ink-2 ${
            onEditCaption ? 'cursor-text hover:text-ink' : ''
          }`}
        >
          {photo.caption}
        </div>
      )}
    </div>
  )
})

export default PhotoWall
