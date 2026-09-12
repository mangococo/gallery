import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { Photo, PhotoDTO } from '../types'
import { displaySrc } from '../lib/api'
import {
  collectMarqueeHits,
  marqueeRectFromPoints,
  movedBeyondThreshold,
  sameIdSet,
  shouldStartMarqueeFrom,
  type CardBox,
  type MarqueeRect,
  type Point,
} from '../lib/marquee'
import { confirmDialog } from './feedback'
import { CheckCircleIcon, HeartIcon, PenIcon, StarIcon, TrashIcon } from './icons'
import { claimEsc, releaseEsc } from '../lib/esc'

/** 多选选中态的实心勾（#8）：16px 下描边勾辨识度低，粗实心勾一眼可辨 */
function CheckFilledIcon({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5 10 17.5 19 7" stroke="currentColor" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

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
  /**
   * 框选（marquee）提交：拖拽矩形命中的照片集合。预览与收笔共用；
   * additive=⌘/Ctrl 起拖时并入现有选择，否则替换。缺省则整墙不启用框选。
   */
  onMarqueeSelect?: (ids: Set<string>, additive: boolean) => void
  /** 卡片右键（含选择态下的批量语义由页面组装） */
  onPhotoContextMenu?: (e: React.MouseEvent, photo: Photo) => void
  /** 空白区域右键（目标非卡片时才触发） */
  onWallContextMenu?: (e: React.MouseEvent) => void
  /** 空态文案：无照片时的标题/提示（默认「还没有照片」） */
  emptyTitle?: string
  emptyHint?: string
  /** 密度档位（#9）：默认 large（响应式 1/2/3 列，与旧行为一致） */
  density?: WallDensity
  /** 排列方式（#10）：fill=瀑布流填充（默认）；timeline=时间序行优先网格（数据序即视觉阅读序） */
  layout?: WallLayout
}

/** 超过该张数走大相册模式：逐项 framer-motion 入场动画关闭（CSS 悬停替代），保滚动流畅 */
const LARGE_ALBUM_THRESHOLD = 120

/** 密度档位（#9）：large=响应式 1/2/3（现状）；medium=4 列；small=6 列（1080p 一屏 ~42 张） */
export type WallDensity = 'large' | 'medium' | 'small'

const DENSITY_COLUMN_COUNT: Record<Exclude<WallDensity, 'large'>, number> = {
  medium: 4,
  small: 6,
}

/** 密度偏好持久化（会话级 localStorage，与首页视图偏好同一模式），首页/旅行页全局共享 */
export const WALL_DENSITY_KEY = 'gallery.wall_density'
export function loadWallDensity(): WallDensity {
  try {
    const v = localStorage.getItem(WALL_DENSITY_KEY)
    if (v === 'medium' || v === 'small' || v === 'large') return v
  } catch {
    // 隐私模式读不到就算了
  }
  return 'large'
}
export function saveWallDensity(d: WallDensity): void {
  try {
    localStorage.setItem(WALL_DENSITY_KEY, d)
  } catch {
    // 存不进就算了
  }
}

/** 排列方式（#10）：fill=瀑布流紧凑填充（CSS columns，列优先视觉）；timeline=按时间序行优先网格 */
export type WallLayout = 'fill' | 'timeline'

export const WALL_LAYOUT_KEY = 'gallery.wall_layout'
/** 偏好持久化。无偏好时返回 null，由调用方决定各自默认（首页 fill、旅行页 timeline） */
export function loadWallLayout(): WallLayout | null {
  try {
    const v = localStorage.getItem(WALL_LAYOUT_KEY)
    if (v === 'fill' || v === 'timeline') return v
  } catch {
    // 隐私模式读不到就算了
  }
  return null
}
export function saveWallLayout(l: WallLayout): void {
  try {
    localStorage.setItem(WALL_LAYOUT_KEY, l)
  } catch {
    // 存不进就算了
  }
}

/** timeline 行优先网格的列宽下限：随密度档收窄（与 #9 档位联动） */
const TIMELINE_MIN_COL: Record<WallDensity, string> = {
  large: '260px',
  medium: '200px',
  small: '150px',
}


/** 照片墙单元：图片用缩略图；视频用海报帧 + 播放角标 */
function WallMedia({ photo }: { photo: PhotoDTO }) {
  const src = displaySrc(photo)
  if (photo.type === 'video') {
    return (
      <div className="relative aspect-[4/3]">
        {src ? (
          <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" draggable={false} />
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
      <img src={src} alt="" className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" draggable={false} />
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

/** 一次框选会话的可变状态（ref 持有，不进 React 状态；overlay 显隐才走 state） */
interface MarqueeSession {
  start: Point
  last: Point
  /** 已按下但位移未过阈值：此时释放放行普通点击 */
  armed: boolean
  /** 已成框：overlay 可见、预览提交中 */
  active: boolean
  /** Esc/失焦取消：回滚到起拖前选择并吞掉随后的 click */
  cancelled: boolean
  /** ⌘/Ctrl 起拖 = 增量并入，否则替换 */
  additive: boolean
  /** 起拖时测量的卡片命中盒缓存（视口坐标）；滚动/改窗后置脏重测 */
  cards: CardBox[] | null
  cardsDirty: boolean
  /** 最近一次预览提交的集合（去重，空转帧不触发页面重渲染） */
  committed: Set<string> | null
  /** 起拖时的选择快照（取消回滚用） */
  base: Set<string>
  /** 成框后认领的 ESC 处理权（拖拽中 Esc 只取消框选，不穿透到页面级退出多选） */
  escToken: symbol | null
}

/**
 * 框选控制器：几何与事件管线都在 ref 里跑（rAF 批处理，每帧至多一次命中计算
 * 与一次页面提交），React 状态只有 overlay 显隐。矩形拖拽期间不触发
 * PhotoWall 自身重渲染——选中预览经 onSelect 走页面既有的 selectedIds 管道，
 * 未变化的卡片被 CardInner 的 memo 拦住。
 */
function useMarqueeSelection(opts: {
  wallRef: React.RefObject<HTMLElement | null>
  selectedIds?: Set<string>
  onSelect?: (ids: Set<string>, additive: boolean) => void
}) {
  const overlayRef = React.useRef<HTMLDivElement | null>(null)
  const [active, setActive] = React.useState(false)
  const sessionRef = React.useRef<MarqueeSession | null>(null)
  const rafRef = React.useRef(0)
  const pendingRef = React.useRef<Point | null>(null)
  const suppressClickRef = React.useRef(false)
  /** 最新 opts 经 ref 透传：控制器只创建一次，页面回调/选择集永远读到最新 */
  const optsRef = React.useRef(opts)
  optsRef.current = opts

  // 全部命令闭包一次性创建：内部只触碰 ref 与稳定的 setActive。
  // 预览提交会触发重渲染，若监听器随渲染重建，卸载时将因引用不同而漏拆。
  const ctrl = React.useMemo(() => {
    const measureCards = (): CardBox[] => {
      const out: CardBox[] = []
      optsRef.current.wallRef.current?.querySelectorAll<HTMLElement>('[data-photo-id]').forEach((el) => {
        const id = el.dataset.photoId
        if (!id) return
        const r = el.getBoundingClientRect()
        out.push({ id, left: r.left, top: r.top, right: r.right, bottom: r.bottom })
      })
      return out
    }

    const paint = (rect: MarqueeRect): void => {
      const overlay = overlayRef.current
      if (!overlay) return
      overlay.style.transform = `translate3d(${rect.x}px, ${rect.y}px, 0)`
      overlay.style.width = `${rect.width}px`
      overlay.style.height = `${rect.height}px`
    }

    /** 用最新位置同步算一遍命中并提交；返回是否产生了新提交 */
    const commitLatest = (): boolean => {
      const s = sessionRef.current
      const pt = pendingRef.current
      if (!s || !pt || !s.active) return false
      s.last = pt
      if (!s.cards || s.cardsDirty) {
        s.cards = measureCards()
        s.cardsDirty = false
      }
      const rect = marqueeRectFromPoints(s.start, s.last)
      const hits = collectMarqueeHits(s.cards, rect)
      if (sameIdSet(hits, s.committed)) return false
      s.committed = hits
      optsRef.current.onSelect?.(hits, s.additive)
      return true
    }

    const stopRaf = (): void => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
    }

    const swallowNextClick = (): void => {
      suppressClickRef.current = true
      // click 在 mouseup 后同步派发；宏任务兜底复位，防止标志位残留吞掉下一次正常点击
      window.setTimeout(() => {
        suppressClickRef.current = false
      }, 0)
    }

    const detach = (): void => {
      window.removeEventListener('mousemove', h.move)
      window.removeEventListener('mouseup', h.up)
      window.removeEventListener('keydown', h.key)
      window.removeEventListener('scroll', h.scroll, true)
      window.removeEventListener('resize', h.resize)
      window.removeEventListener('blur', h.blur)
    }

    const teardown = (): void => {
      const s = sessionRef.current
      if (s?.escToken) releaseEsc(s.escToken)
      sessionRef.current = null
      pendingRef.current = null
      detach()
      setActive(false)
    }

    const finish = (): void => {
      const s = sessionRef.current
      if (!s) return
      stopRaf()
      if (s.active && !s.cancelled) {
        commitLatest()
        swallowNextClick()
      }
      teardown()
    }

    const cancel = (): void => {
      const s = sessionRef.current
      if (!s || s.cancelled) return
      s.cancelled = true
      if (s.active) {
        // 已成框：预览改过选择，回滚到起拖前快照并吞掉随后的 click
        swallowNextClick()
        if (s.committed && s.committed.size > 0) optsRef.current.onSelect?.(s.base, false)
        stopRaf()
        teardown()
      } else {
        // 未成框：就是一次普通点击，不吞、不回滚
        teardown()
      }
    }

    const h = {
      move: (e: MouseEvent): void => {
        const s = sessionRef.current
        if (!s || s.cancelled) return
        const pt = { x: e.clientX, y: e.clientY }
        pendingRef.current = pt
        if (s.armed) {
          if (!movedBeyondThreshold(s.start, pt)) return
          s.armed = false
          s.active = true
          s.escToken = claimEsc()
          setActive(true)
        }
        if (!rafRef.current) rafRef.current = requestAnimationFrame(() => {
          rafRef.current = 0
          const cur = sessionRef.current
          if (!cur || !cur.active || cur.cancelled) return
          commitLatest()
          paint(marqueeRectFromPoints(cur.start, cur.last))
        })
      },
      up: (): void => {
        if (sessionRef.current) finish()
      },
      key: (e: KeyboardEvent): void => {
        if (e.key === 'Escape') cancel()
      },
      scroll: (): void => {
        const s = sessionRef.current
        if (s) s.cardsDirty = true
      },
      resize: (): void => {
        const s = sessionRef.current
        if (s) s.cardsDirty = true
      },
      blur: (): void => cancel(),
    }

    /** 起拖（墙容器 mousedown）：左键 + 非控件目标才接管 */
    const onMouseDown = (e: React.MouseEvent): void => {
      if (!optsRef.current.onSelect || e.button !== 0) return
      if (!shouldStartMarqueeFrom(e.target)) return
      if (sessionRef.current) return
      const start = { x: e.clientX, y: e.clientY }
      pendingRef.current = start
      sessionRef.current = {
        start,
        last: start,
        armed: true,
        active: false,
        cancelled: false,
        additive: e.metaKey || e.ctrlKey,
        cards: null,
        cardsDirty: false,
      committed: null,
      base: new Set(optsRef.current.selectedIds ?? []),
      escToken: null,
    }
      // 按下即阻止文本选择/原生图片拖拽起手（click 不受 mousedown preventDefault 影响）
      e.preventDefault()
      window.addEventListener('mousemove', h.move)
      window.addEventListener('mouseup', h.up)
      window.addEventListener('keydown', h.key)
      window.addEventListener('scroll', h.scroll, true)
      window.addEventListener('resize', h.resize)
      window.addEventListener('blur', h.blur)
    }

    /** 框选真实发生后吞掉收笔 click（防误开灯箱/误勾选）；普通点击不受影响 */
    const onClickCapture = (e: React.MouseEvent): void => {
      if (!suppressClickRef.current) return
      e.stopPropagation()
      e.preventDefault()
      suppressClickRef.current = false
    }

    return { onMouseDown, onClickCapture }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { onMouseDown: ctrl.onMouseDown, onClickCapture: ctrl.onClickCapture, overlayRef, active }
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
  onMarqueeSelect,
  onPhotoContextMenu,
  onWallContextMenu,
  emptyTitle,
  emptyHint,
  density = 'large',
  layout = 'fill',
}) => {
  // —— 框选（marquee）——
  const wallRef = React.useRef<HTMLDivElement | null>(null)
  const marquee = useMarqueeSelection({
    wallRef,
    selectedIds,
    onSelect: onMarqueeSelect,
  })

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

  // 密度档位（#9）：small/medium 固定列数（inline style 注入，避免再开一组响应式断点）；
  // 列宽随容器收缩，小卡片仍由 #7 的固定 aspect 容器保证不重排。
  // timeline 模式（#10）改用 grid 行优先：视觉阅读顺序与数据序（时间序）一致
  const wallStyle: React.CSSProperties | undefined =
    layout === 'timeline'
      ? { display: 'grid', gridTemplateColumns: `repeat(auto-fill, minmax(${TIMELINE_MIN_COL[density]}, 1fr))`, gap: '1rem' }
      : density === 'large'
        ? undefined
        : { columnCount: DENSITY_COLUMN_COUNT[density], columnGap: '1rem' }

  return (
    <div
      ref={wallRef}
      data-testid="photo-wall"
      data-density={density}
      data-layout={layout}
      style={wallStyle}
      className={`gap-4 space-y-4 ${
        layout === 'fill' && density === 'large' ? 'columns-1 sm:columns-2 lg:columns-3' : ''
      }`}
      onMouseDown={marquee.onMouseDown}
      onClickCapture={marquee.onClickCapture}
      onContextMenu={(e) => {
        // 只有真正点在留白处（容器自身）才算空白区右键
        if (e.target === e.currentTarget) onWallContextMenu?.(e)
      }}
    >
      {/* 框选矩形：portal 到 body（脱离 columns/transform 祖先），fixed 视口坐标
          与命中计算同坐标系；命中盒样式随主题 token（primary） */}
      {marquee.active &&
        createPortal(
          <div
            ref={marquee.overlayRef}
            data-testid="marquee-rect"
            aria-hidden="true"
            className="pointer-events-none fixed left-0 top-0 z-40 rounded-sm border border-primary bg-primary/10"
            style={{ width: 0, height: 0, transform: 'translate3d(0,0,0)' }}
          />,
          document.body,
        )}
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
      className={`relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transition-shadow ${
        selected ? '' : 'border border-line'
      }`}
      data-testid="wall-card"
      data-photo-id={photo.id}
      data-selected={selected ? 'true' : 'false'}
    >
      <WallMedia photo={photo} />
      {selected && (
        <>
          <div className="absolute inset-0 bg-primary-soft/45 pointer-events-none" data-testid="selection-veil" />
          {/* 选中描边（#8）：inset ring 画在卡片内部——外置 box-shadow 会被
              .wall-item 的 content-visibility（paint containment）裁掉直边段，
              只剩圆角弧；inset 沿 rounded-xl 全周均匀、不依赖溢出绘制 */}
          <div
            className="absolute inset-0 rounded-xl ring-[3px] ring-inset ring-primary pointer-events-none z-10"
            data-testid="selection-ring"
          />
        </>
      )}

      {/* 多选勾选徽标（#8）：不透明底——半透明底叠照片后观感受底图明暗左右，
          浅色照片上发灰难辨。未选中 = 白底 + 深色圆环勾；选中 = success 实底 +
          白色粗实心勾，高对比且不依赖底图 */}
      {(selectionMode || selected) && (
        <div
          data-testid="select-badge"
          className={`absolute top-2 left-2 w-7 h-7 rounded-full flex items-center justify-center shadow-md ${
            selected ? 'bg-success text-white' : 'bg-surface text-ink-2'
          }`}
        >
          {selected ? <CheckFilledIcon size={18} /> : <CheckCircleIcon size={16} />}
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
