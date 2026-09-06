import React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import type { SearchHit, SearchMatchIn } from '../types'
import { CameraIcon, SearchIcon } from './icons'

const MATCH_LABEL: Record<SearchMatchIn, string> = {
  title: '标题',
  description: '描述',
  tags: '标签',
  caption: '图注',
  photoTag: '照片标签',
}

/** 命中词高亮：按不区分大小写的 occurrences 切片 */
function Hl({ text, query }: { text: string; query: string }) {
  const q = query.trim().toLowerCase()
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const parts: React.ReactNode[] = []
  let from = 0
  let i = lower.indexOf(q)
  let key = 0
  while (i >= 0) {
    if (i > from) parts.push(text.slice(from, i))
    parts.push(
      <span key={key++} className="hl">
        {text.slice(i, i + q.length)}
      </span>,
    )
    from = i + q.length
    i = lower.indexOf(q, from)
  }
  if (from < text.length) parts.push(text.slice(from))
  return <>{parts}</>
}

/** ⌘K 搜索面板：搜索旅行标题/描述/标签/图注，键盘上下选择回车跳转 */
const CommandPalette: React.FC = () => {
  const { searchOpen, setSearchOpen, activeAlbumId, trips } = useApp()
  const navigate = useNavigate()
  const [query, setQuery] = React.useState('')
  const [hits, setHits] = React.useState<SearchHit[]>([])
  const [searching, setSearching] = React.useState(false)
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchSeq = React.useRef(0)

  // ⌘K / Ctrl+K 全局开关
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setSearchOpen(!searchOpen)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchOpen, setSearchOpen])

  // 打开时重置
  React.useEffect(() => {
    if (searchOpen) {
      setQuery('')
      setHits([])
      setActive(0)
      setSearching(false)
    }
  }, [searchOpen])

  // 防抖搜索（响应序号守卫：慢的旧请求回来不覆盖新词的结果）
  React.useEffect(() => {
    const q = query.trim()
    if (!searchOpen || !q || !activeAlbumId) {
      setHits([])
      setSearching(false)
      return
    }
    setSearching(true)
    const seq = ++searchSeq.current
    const timer = window.setTimeout(async () => {
      try {
        const result = await api.searchTrips(activeAlbumId, q)
        if (searchSeq.current === seq) setHits(result)
      } catch {
        if (searchSeq.current === seq) setHits([])
      }
      if (searchSeq.current === seq) setSearching(false)
    }, 150)
    return () => window.clearTimeout(timer)
  }, [query, searchOpen, activeAlbumId])

  React.useEffect(() => setActive(0), [hits.length, query])

  const showQuickList = searchOpen && !query.trim() && trips.length > 0

  const jumpTo = (tripId: string) => {
    setSearchOpen(false)
    navigate(`/trip/${tripId}`)
  }

  // 面板内键盘导航
  const rowCount = showQuickList ? Math.min(trips.length, 8) : hits.length
  const onPanelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setSearchOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, rowCount - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(a - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (showQuickList) {
        const t = trips[active]
        if (t) jumpTo(t.id)
      } else {
        const h = hits[active]
        if (h) jumpTo(h.tripId)
      }
    }
  }

  // 选中项滚入视野
  React.useEffect(() => {
    listRef.current
      ?.querySelector('[data-active="true"]')
      ?.scrollIntoView({ block: 'nearest' })
  }, [active, hits])

  return createPortal(
    <AnimatePresence>
      {searchOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[75] no-drag bg-black/30 backdrop-blur-[2px] flex items-start justify-center"
          onClick={() => setSearchOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            className="mt-[12vh] w-[560px] max-w-[90vw] bg-surface rounded-2xl border border-line shadow-2xl overflow-hidden flex flex-col max-h-[68vh]"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={onPanelKeyDown}
          >
            {/* 输入行 */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-line shrink-0">
              <span className="text-ink-3 flex items-center">
                <SearchIcon size={17} />
              </span>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索旅行标题、描述、标签、图注、照片标签…"
                className="flex-1 bg-transparent outline-none text-[15px] text-ink placeholder-ink-3"
              />
              {searching && (
                <span className="w-3.5 h-3.5 rounded-full border-2 border-line border-t-primary animate-spin" />
              )}
              <kbd className="px-1.5 py-0.5 rounded-md bg-surface-2 border border-line text-[10px] text-ink-3">
                ESC
              </kbd>
            </div>

            {/* 结果列表 */}
            <div ref={listRef} className="flex-1 min-h-0 overflow-y-auto scroll-slim py-1.5">
              {!activeAlbumId && (
                <p className="px-4 py-8 text-center text-sm text-ink-3">
                  先在左侧「相册」注册并激活一个相册
                </p>
              )}

              {activeAlbumId && showQuickList && (
                <>
                  <p className="px-4 pt-1.5 pb-1 text-[11px] text-ink-3 tracking-widest">
                    全部旅行 · ⌘K 搜标题 / 描述 / 标签 / 图注
                  </p>
                  {trips.slice(0, 8).map((t, i) => (
                    <button
                      key={t.id}
                      data-active={i === active}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => jumpTo(t.id)}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                        i === active ? 'bg-primary-soft' : ''
                      }`}
                    >
                      <TripThumb thumbUrl="" fallbackCount={t.photos.length} />
                      <span className="flex-1 min-w-0">
                        <span className="block text-sm text-ink truncate">{t.title}</span>
                        <span className="block text-xs text-ink-3 font-display">
                          {t.startDate || '未填日期'} · {t.photos.length} 张
                        </span>
                      </span>
                    </button>
                  ))}
                </>
              )}

              {activeAlbumId && query.trim() && hits.length === 0 && !searching && (
                <p className="px-4 py-8 text-center text-sm text-ink-3">
                  没有匹配「{query.trim()}」的旅行
                </p>
              )}

              {hits.map((h, i) => (
                <button
                  key={h.tripId}
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => jumpTo(h.tripId)}
                  className={`w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors ${
                    i === active ? 'bg-primary-soft' : ''
                  }`}
                >
                  <TripThumb thumbUrl={h.thumbUrl} />
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink truncate">
                      <Hl text={h.title} query={query} />
                    </span>
                    <span className="flex items-center gap-1.5 mt-0.5 text-xs text-ink-3 min-w-0">
                      {h.matchedIn.map((m) => (
                        <span
                          key={m}
                          className="px-1.5 py-px rounded-full bg-surface-2 text-[10px] text-ink-2 shrink-0"
                        >
                          {MATCH_LABEL[m]}
                        </span>
                      ))}
                      <span className="truncate">
                        {h.sampleCaption ? (
                          <Hl text={h.sampleCaption} query={query} />
                        ) : (
                          h.startDate && <span className="font-display">{h.startDate}</span>
                        )}
                      </span>
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function TripThumb({ thumbUrl, fallbackCount }: { thumbUrl: string; fallbackCount?: number }) {
  if (thumbUrl) {
    return (
      <img
        src={thumbUrl}
        alt=""
        className="w-10 h-10 rounded-lg object-cover border border-line shrink-0"
      />
    )
  }
  return (
    <span className="w-10 h-10 rounded-lg bg-surface-2 border border-line shrink-0 flex items-center justify-center text-ink-3">
      {fallbackCount === 0 ? <CameraIcon size={16} /> : fallbackCount != null ? (
        <span className="text-xs font-display">{fallbackCount}</span>
      ) : (
        <CameraIcon size={16} />
      )}
    </span>
  )
}

export default CommandPalette
