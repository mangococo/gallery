import React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api, displaySrc } from '../lib/api'
import { useApp } from '../lib/store'
import { hasMediaExt } from '../lib/media'
import { Trip } from '../types'
import { toast } from './feedback'
import { CameraIcon, PlusIcon } from './icons'

/**
 * 首页拖拽导入（方案决策 17 的完整形态）：
 * 窗口级监听拖拽 → 显示提示层 → 松手弹「放进哪次旅行」选择器（已有旅行或新建）。
 * TripPage 的拖拽（落入当前旅行）在自己容器内 stopPropagation，不会走到这里。
 */
const DropImportLayer: React.FC = () => {
  const [dragActive, setDragActive] = React.useState(false)
  const [pendingPaths, setPendingPaths] = React.useState<string[] | null>(null)
  const hideTimer = React.useRef<number | undefined>(undefined)

  React.useEffect(() => {
    const hasFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // 持续 preventDefault 才允许 drop；dragover 高频触发，用定时器检测「已拖离窗口」
      e.preventDefault()
      window.clearTimeout(hideTimer.current)
      setDragActive(true)
      hideTimer.current = window.setTimeout(() => setDragActive(false), 160)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      window.clearTimeout(hideTimer.current)
      setDragActive(false)
      const paths = Array.from(e.dataTransfer?.files ?? [])
        .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
        .map((f) => api.getPathForFile(f))
        .filter((p) => !!p)
      if (paths.length === 0) return
      setPendingPaths(paths)
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
      window.clearTimeout(hideTimer.current)
    }
  }, [])

  return (
    <>
      {dragActive && !pendingPaths && (
        <div className="fixed inset-0 z-[45] bg-primary/10 backdrop-blur-[1px] pointer-events-none flex items-center justify-center">
          <div className="px-8 py-5 bg-surface rounded-2xl shadow-xl border-2 border-dashed border-primary">
            <p className="font-display text-lg text-primary">松手把照片放进某次旅行</p>
          </div>
        </div>
      )}
      {pendingPaths && (
        <ImportPickerModal paths={pendingPaths} onClose={() => setPendingPaths(null)} />
      )}
    </>
  )
}

interface ImportPickerModalProps {
  paths: string[]
  onClose: () => void
}

/** 拖入照片后的目标旅行选择弹层：筛选已有旅行 / 新建旅行并导入 */
const ImportPickerModal: React.FC<ImportPickerModalProps> = ({ paths, onClose }) => {
  const { trips, refreshAll } = useApp()
  const [query, setQuery] = React.useState('')
  const [creating, setCreating] = React.useState(false)
  const [newTitle, setNewTitle] = React.useState('')
  const [busy, setBusy] = React.useState(false)

  const list = trips.filter(
    (t) => !query || t.title.toLowerCase().includes(query.toLowerCase()),
  )

  const importTo = async (tripId: string, title: string) => {
    setBusy(true)
    try {
      const photos = await api.importPhotos(tripId, paths)
      await refreshAll()
      toast(`已导入 ${photos.length} 张照片到「${title}」`, 'success')
      onClose()
    } catch (err: any) {
      toast('导入照片失败: ' + (err?.message ?? err), 'error')
      setBusy(false)
    }
  }

  const handleCreate = async () => {
    setBusy(true)
    try {
      const trip = await api.createTrip({
        title: newTitle.trim() || '未命名旅行',
        description: '',
        startDate: '',
        endDate: '',
        tags: [],
      })
      await importTo(trip.id, trip.title)
    } catch (err: any) {
      toast('创建旅行失败: ' + (err?.message ?? err), 'error')
      setBusy(false)
    }
  }

  const coverOf = (t: Trip): string => {
    const photo =
      (t.coverPhotoId ? t.photos.find((p) => p.id === t.coverPhotoId) : undefined) ?? t.photos[0]
    return photo ? displaySrc(photo) : ''
  }

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
        onClick={busy ? undefined : onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 12 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 12 }}
          transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          className="bg-surface rounded-2xl shadow-2xl border border-line w-[420px] max-w-full max-h-[75vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <header className="px-5 pt-5 pb-3">
            <h3 className="font-display text-lg text-ink">放进哪次旅行？</h3>
            <p className="text-xs text-ink-3 mt-0.5">拖入了 {paths.length} 张照片</p>
          </header>

          {list.length > 0 && (
            <div className="px-5 pb-2">
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="筛选旅行…"
                className="w-full px-3 py-2 bg-background border border-line rounded-lg text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-colors"
              />
            </div>
          )}

          <div className="flex-1 min-h-0 overflow-y-auto scroll-slim px-3 pb-2">
            {list.map((t) => {
              const cover = coverOf(t)
              return (
                <button
                  key={t.id}
                  disabled={busy}
                  onClick={() => void importTo(t.id, t.title)}
                  className="w-full flex items-center gap-3 px-2.5 py-2 rounded-xl hover:bg-surface-2 transition-colors text-left disabled:opacity-50"
                >
                  {cover ? (
                    <img
                      src={cover}
                      alt=""
                      className="w-10 h-10 rounded-lg object-cover border border-line shrink-0"
                    />
                  ) : (
                    <span className="w-10 h-10 rounded-lg bg-surface-2 border border-line shrink-0 flex items-center justify-center text-ink-3">
                      <CameraIcon size={16} />
                    </span>
                  )}
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-ink truncate">{t.title}</span>
                    <span className="block text-xs text-ink-3">
                      {t.startDate || '未填日期'} · {t.photos.length} 张
                    </span>
                  </span>
                </button>
              )
            })}
            {list.length === 0 && (
              <p className="text-xs text-ink-3 text-center py-6">
                {trips.length === 0
                  ? '还没有旅行，新建一个开始吧'
                  : '没有匹配的旅行'}
              </p>
            )}
          </div>

          <div className="border-t border-line px-5 py-3.5">
            {creating ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !busy && void handleCreate()}
                  placeholder="新旅行标题"
                  className="flex-1 min-w-0 px-3 py-2 bg-background border border-line rounded-lg text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-colors"
                />
                <button
                  onClick={() => void handleCreate()}
                  disabled={busy}
                  className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-60 shrink-0"
                >
                  {busy ? '导入中…' : '创建并导入'}
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                disabled={busy}
                className="w-full flex items-center justify-center gap-1.5 px-4 py-2 border-2 border-dashed border-line rounded-lg text-sm text-ink-2 hover:text-primary hover:border-primary/50 transition-colors disabled:opacity-50"
              >
                <PlusIcon size={14} />
                <span>新建旅行并导入</span>
              </button>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

export default DropImportLayer
