import React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRightIcon } from './icons'

/**
 * 应用级右键上下文菜单：与 toast/confirmDialog 同一套「模块级函数 + Host 挂载」模式。
 * 用法：App 根部挂一次 <ContextMenuHost />，任意处调 showContextMenuAt(e, items)。
 * 视觉与 Sidebar 相册菜单/导出下拉同源（surface 卡片 + primary-soft 悬停）。
 * 支持：disabled / 危险项 / 分隔线 / 快捷键提示 / 子菜单 / 键盘操作 / ESC / 点击外部关闭 /
 * 窗口边界翻转。全部渲染层实现：三平台行为一致，且不破坏暖褐主题的视觉统一。
 */

export type MenuEntry =
  | {
      kind?: 'item'
      label: string
      icon?: React.ReactNode
      /** 快捷键提示（仅展示，如 "⌫"） */
      shortcut?: string
      disabled?: boolean
      danger?: boolean
      onSelect?: () => void
    }
  | { kind: 'separator' }
  | { kind: 'header'; label: string }
  | {
      kind: 'submenu'
      label: string
      icon?: React.ReactNode
      disabled?: boolean
      children: MenuEntry[]
    }

let openMenuFn: ((x: number, y: number, items: MenuEntry[]) => void) | null = null

/** 在屏幕坐标 (x, y) 处打开菜单（调用方自行 preventDefault） */
export function showContextMenu(x: number, y: number, items: MenuEntry[]): void {
  openMenuFn?.(x, y, items)
}

/** 便捷入口：传右键事件，自动 preventDefault 并在指针处打开 */
export function showContextMenuAt(
  e: { clientX: number; clientY: number; preventDefault?: () => void },
  items: MenuEntry[],
): void {
  e.preventDefault?.()
  showContextMenu(e.clientX, e.clientY, items)
}

/** 立即关闭当前菜单（路由切换/开弹窗前防御性收起） */
export function closeContextMenu(): void {
  openMenuFn?.(NaN, NaN, [])
}

/** 所有面板（含子菜单）共用的标记 class，外部关闭判定靠它识别「菜单内部」 */
const PANEL_MARK = 'ctx-menu-panel'

interface OpenState {
  x: number
  y: number
  items: MenuEntry[]
}

function entriesAtLevel(root: MenuEntry[], path: number[], level: number): MenuEntry[] {
  let entries = root
  for (let d = 0; d < level; d++) {
    const e = entries[path[d]]
    entries = e && e.kind === 'submenu' ? e.children : []
  }
  return entries
}

/** 单层面板（根与子菜单共用）。根面板由 Host 定位；子菜单面板自行 portal 到 body */
const MenuPanel: React.FC<{
  entries: MenuEntry[]
  activeIndex: number
  style?: React.CSSProperties
  onHover: (index: number) => void
  onTrigger: (index: number) => void
  renderSubmenu?: (index: number, anchorRect: DOMRect) => React.ReactNode
}> = ({ entries, activeIndex, style, onHover, onTrigger, renderSubmenu }) => {
  return (
    <div
      role="menu"
      className={`${PANEL_MARK} fixed z-[70] min-w-[200px] max-w-[300px] max-h-[calc(100vh-24px)] overflow-y-auto scroll-slim bg-surface border border-line rounded-xl shadow-xl py-1.5 px-1 select-none`}
      style={style}
    >
      {entries.map((entry, i) => {
        if (entry.kind === 'separator') {
          return <div key={`sep-${i}`} className="my-1 mx-2 border-t border-line" />
        }
        if (entry.kind === 'header') {
          return (
            <div key={`head-${i}`} className="px-2.5 pb-1 pt-1.5 text-[11px] text-ink-3 select-none">
              {entry.label}
            </div>
          )
        }
        const disabled = !!entry.disabled
        const danger = 'danger' in entry && !!entry.danger
        const isSub = entry.kind === 'submenu'
        const active = activeIndex === i
        const cls = `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] leading-none transition-colors ${
          disabled
            ? 'opacity-40 cursor-default'
            : danger
              ? `text-danger cursor-pointer ${active ? 'bg-danger/10' : 'hover:bg-danger/10'}`
              : `text-ink-2 cursor-pointer ${active ? 'bg-primary-soft text-primary' : 'hover:bg-primary-soft hover:text-primary'}`
        }`
        return (
          <div key={`${entry.label}-${i}`} className="relative">
            <div
              role="menuitem"
              className={cls}
              onMouseEnter={() => !disabled && onHover(i)}
              onClick={(ev) => {
                ev.stopPropagation()
                if (!disabled) onTrigger(i)
              }}
            >
              {'icon' in entry && entry.icon != null && (
                <span className="flex w-4 shrink-0 justify-center">{entry.icon}</span>
              )}
              <span className="flex-1 truncate">{entry.label}</span>
              {isSub ? (
                <ChevronRightIcon size={13} className="shrink-0 text-ink-3" />
              ) : (
                'shortcut' in entry &&
                entry.shortcut && (
                  <span className="shrink-0 text-[11px] text-ink-3 tabular-nums">{entry.shortcut}</span>
                )
              )}
            </div>
            {/* 子菜单锚点：面板卸载即收起；锚点 rect 传给面板做 fixed 定位 */}
            {renderSubmenu && isSub && !disabled && (
              <SubmenuAnchor render={(rect) => renderSubmenu(i, rect)} ownIndex={i} activeIndex={activeIndex} />
            )}
          </div>
        )
      })}
    </div>
  )
}

/** 子菜单锚点：只负责把父项 rect 交给渲染函数（面板真正渲染在 body 下，绝不被裁切） */
const SubmenuAnchor: React.FC<{
  ownIndex: number
  activeIndex: number
  render: (rect: DOMRect) => React.ReactNode
}> = ({ render }) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [rect, setRect] = React.useState<DOMRect | null>(null)
  React.useLayoutEffect(() => {
    // 父级 .relative 容器即菜单项本体
    const item = ref.current?.parentElement
    if (item) setRect(item.getBoundingClientRect())
  }, [])
  return (
    <div ref={ref} className="hidden">
      {rect ? render(rect) : null}
    </div>
  )
}

function ContextMenuHost() {
  const [state, setState] = React.useState<OpenState | null>(null)
  /** 子菜单打开路径：[2] = 根第 2 项的子菜单开着；[2,0] = 再下一级也开着 */
  const [path, setPath] = React.useState<number[]>([])
  /** 每级键盘/悬停高亮下标（-1 无） */
  const [highlights, setHighlights] = React.useState<number[]>([-1])

  const close = React.useCallback(() => {
    setState(null)
    setPath([])
    setHighlights([-1])
  }, [])

  React.useEffect(() => {
    openMenuFn = (x, y, items) => {
      if (!Number.isFinite(x)) {
        close()
        return
      }
      setState({ x, y, items })
      setPath([])
      setHighlights([-1])
    }
    return () => {
      openMenuFn = null
    }
  }, [close])

  // 菜单外 mousedown / 滚轮 / 失焦 / 缩放 → 关闭。子菜单面板 portal 在 body 下，
  // 靠 PANEL_MARK 识别为「菜单内部」
  React.useEffect(() => {
    if (!state) return
    const isInside = (t: EventTarget | null) =>
      t instanceof Element && !!t.closest?.(`.${PANEL_MARK}`)
    const onDown = (e: MouseEvent) => {
      if (!isInside(e.target)) close()
    }
    const onWheel = (e: WheelEvent) => {
      if (!isInside(e.target)) close()
    }
    const onBlur = () => close()
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('wheel', onWheel, { passive: true, capture: true })
    window.addEventListener('blur', onBlur)
    window.addEventListener('resize', onBlur)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('wheel', onWheel, true)
      window.removeEventListener('blur', onBlur)
      window.removeEventListener('resize', onBlur)
    }
  }, [state, close])

  // 触发项：关菜单再执行（避免菜单树挡住随后打开的弹层）
  const triggerEntry = React.useCallback(
    (entry: MenuEntry) => {
      if (entry.kind === 'separator' || entry.kind === 'header' || entry.disabled) return
      close()
      if (entry.kind !== 'submenu') entry.onSelect?.()
    },
    [close],
  )

  // 键盘：↑↓ 移动、→ 展开、← 收起、Enter 触发、Esc 逐级关闭
  React.useEffect(() => {
    if (!state) return
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const level = path.length
      const entries = entriesAtLevel(state.items, path, level)
      const selectable = entries
        .map((en, i) => ({ en, i }))
        .filter(({ en }) => en.kind !== 'separator' && en.kind !== 'header' && !en.disabled)
      const cur = highlights[level] ?? -1
      const curSel = selectable.findIndex(({ i }) => i === cur)

      const highlight = (index: number) =>
        setHighlights((h) => {
          const copy = [...h.slice(0, level), index]
          return copy
        })

      if (e.key === 'Escape') {
        e.preventDefault()
        if (level > 0) {
          setPath((p) => p.slice(0, -1))
          setHighlights((h) => h.slice(0, -1))
        } else {
          close()
        }
        return
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        if (selectable.length === 0) return
        const next =
          e.key === 'ArrowDown'
            ? curSel < 0
              ? 0
              : (curSel + 1) % selectable.length
            : curSel < 0
              ? selectable.length - 1
              : (curSel - 1 + selectable.length) % selectable.length
        highlight(selectable[next].i)
        // 移动即收起当前高亮项下可能展开的子菜单
        setPath((p) => p.slice(0, level))
        return
      }
      if (e.key === 'ArrowRight') {
        const entry = entries[cur]
        if (entry && entry.kind === 'submenu') {
          e.preventDefault()
          setPath((p) => [...p.slice(0, level), cur])
          setHighlights((h) => [...h.slice(0, level + 1), -1])
        }
        return
      }
      if (e.key === 'ArrowLeft') {
        if (level > 0) {
          e.preventDefault()
          setPath((p) => p.slice(0, -1))
          setHighlights((h) => h.slice(0, -1))
        }
        return
      }
      if (e.key === 'Enter') {
        const entry = entries[cur]
        if (!entry || entry.kind === 'separator' || entry.kind === 'header' || entry.disabled) return
        e.preventDefault()
        if (entry.kind === 'submenu') {
          setPath((p) => [...p.slice(0, level), cur])
          setHighlights((h) => [...h.slice(0, level + 1), -1])
        } else {
          triggerEntry(entry)
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, path, highlights, close, triggerEntry])

  // 每级共用的悬停/触发行为
  const handlersFor = (level: number) => ({
    onHover: (index: number) => {
      const entry = entriesAtLevel(state!.items, path, level)[index]
      setPath((p) => {
        const cut = p.slice(0, level)
        return entry && entry.kind === 'submenu' ? [...cut, index] : cut
      })
      setHighlights((h) => [...h.slice(0, level), index])
    },
    onTrigger: (index: number) => {
      const entry = entriesAtLevel(state!.items, path, level)[index]
      if (!entry || entry.kind === 'separator' || entry.kind === 'header' || entry.disabled) return
      if (entry.kind === 'submenu') {
        setPath((p) => [...p.slice(0, level), index])
        return
      }
      triggerEntry(entry)
    },
  })

  // 根面板定位：渲染后测量（offsetWidth 不受入场缩放动画影响）并钳制到窗口内
  const rootRef = React.useRef<HTMLDivElement | null>(null)
  const [rootPos, setRootPos] = React.useState<{ left: number; top: number } | null>(null)
  React.useLayoutEffect(() => {
    if (!state) {
      setRootPos(null)
      return
    }
    const panel = rootRef.current?.querySelector(`.${PANEL_MARK}`) as HTMLElement | null
    if (!panel) return
    setRootPos({
      left: Math.max(8, Math.min(state.x, window.innerWidth - panel.offsetWidth - 8)),
      top: Math.max(8, Math.min(state.y, window.innerHeight - panel.offsetHeight - 8)),
    })
  }, [state])

  if (!state) return null

  const rootHandlers = handlersFor(0)

  // 递归渲染子菜单：父项 rect 定位，右侧放不下翻到左侧
  const renderSubmenu = (level: number) => (index: number, anchorRect: DOMRect): React.ReactNode => {
    if (path[level] !== index) return null
    const entries = entriesAtLevel(state.items, path, level)
    const entry = entries[index]
    if (!entry || entry.kind !== 'submenu') return null
    const h = handlersFor(level + 1)
    return <SubmenuPanel key={`${entry.label}-${index}`} entries={entry.children} activeIndex={highlights[level + 1] ?? -1} onHover={h.onHover} onTrigger={h.onTrigger} renderSubmenu={renderSubmenu(level + 1)} anchorRect={anchorRect} />
  }

  return createPortal(
    <div ref={rootRef}>
      <AnimatePresence>
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.98 }}
          transition={{ duration: 0.12, ease: 'easeOut' }}
          style={{
            position: 'fixed',
            left: rootPos?.left ?? -9999,
            top: rootPos?.top ?? -9999,
            transformOrigin: 'top left',
          }}
          onContextMenu={(e) => e.preventDefault()}
        >
          <MenuPanel
            entries={state.items}
            activeIndex={highlights[0] ?? -1}
            onHover={rootHandlers.onHover}
            onTrigger={rootHandlers.onTrigger}
            renderSubmenu={renderSubmenu(0)}
          />
        </motion.div>
      </AnimatePresence>
    </div>,
    document.body,
  )
}

/** 子菜单面板：portal 到 body，fixed 定位（右缘放不下翻左侧，纵向钳制） */
const SubmenuPanel: React.FC<{
  entries: MenuEntry[]
  activeIndex: number
  anchorRect: DOMRect
  onHover: (index: number) => void
  onTrigger: (index: number) => void
  renderSubmenu?: (index: number, anchorRect: DOMRect) => React.ReactNode
}> = ({ entries, activeIndex, anchorRect, onHover, onTrigger, renderSubmenu }) => {
  const ref = React.useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = React.useState<{ left: number; top: number } | null>(null)
  React.useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.innerHeight
    const left =
      anchorRect.right + 4 + rect.width > vw - 8
        ? Math.max(8, anchorRect.left - rect.width - 4)
        : anchorRect.right + 4
    const top = Math.max(8, Math.min(anchorRect.top - 6, vh - rect.height - 8))
    setPos({ left, top })
  }, [entries, anchorRect])

  return createPortal(
    <div
      ref={ref}
      style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuPanel
        entries={entries}
        activeIndex={activeIndex}
        onHover={onHover}
        onTrigger={onTrigger}
        renderSubmenu={renderSubmenu}
      />
    </div>,
    document.body,
  )
}

export default ContextMenuHost
