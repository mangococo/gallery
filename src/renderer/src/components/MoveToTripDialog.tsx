import React from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { toast } from './feedback'
import { displaySrc } from '../lib/api'
import type { MovePhotosResult, Trip } from '../types'
import type { Photo, TripDTO } from '../types'
import { MoveToFolderIcon, PlusIcon, SearchIcon, XIcon } from './icons'

interface MoveToTripDialogProps {
  /** 待移动的照片/视频（单选或多选） */
  photos: Photo[]
  /** 当前旅行 id（列表中标记「当前」，不可作为目标） */
  sourceTripId: string
  /** 当前相册的旅行列表（用于目标选择；新建旅行也建在该相册内） */
  trips: TripDTO[]
  onClose: () => void
  /** 移动完成（含失败不抛出——失败 toast 已在内部处理） */
  onMoved: (result: MovePhotosResult) => void
}

/**
 * 移动到旅行：搜索/选择已有旅行，或流程内直接新建旅行（创建+搬文件一气呵成，
 * 主进程保证不会留下空旅行中间态）。风格延续 AddTripModal 的手账卡片。
 */
const MoveToTripDialog: React.FC<MoveToTripDialogProps> = ({
  photos,
  sourceTripId,
  trips,
  onClose,
  onMoved,
}) => {
  const [query, setQuery] = React.useState('')
  const [pickedId, setPickedId] = React.useState<string | null>(null)
  const [creating, setCreating] = React.useState(false)
  const [moving, setMoving] = React.useState(false)
  const [newTitle, setNewTitle] = React.useState('')
  const [newStartDate, setNewStartDate] = React.useState('')
  const [newEndDate, setNewEndDate] = React.useState('')
  const listRef = React.useRef<HTMLDivElement>(null)

  const videoCount = photos.filter((p) => p.type === 'video').length
  const noun = photos.length === 1 ? (videoCount === 1 ? '个视频' : '张照片') : '项'

  const candidates = trips
    .filter((t) => t.title.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))

  const picked = trips.find((t) => t.id === pickedId) ?? null

  const escClose = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (creating) setCreating(false)
      else onClose()
    }
  }

  const doMove = async (target: { tripId?: string; createTrip?: { title: string; description: string; startDate: string; endDate: string; tags: string[] } }) => {
    if (moving) return
    setMoving(true)
    try {
      const result = await api.movePhotos(
        photos.map((p) => p.id),
        target,
      )
      onMoved(result)
      onClose()
    } catch (error: any) {
      toast('移动失败: ' + (error?.message ?? error), 'error')
      setMoving(false)
    }
  }

  const submitCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title || moving) return
    await doMove({
      createTrip: { title, description: '', startDate: newStartDate, endDate: newEndDate, tags: [] },
    })
  }

  const coverOf = (t: Trip): string => {
    const cover =
      (t.coverPhotoId && t.photos.find((p) => p.id === t.coverPhotoId)) ||
      t.photos.find((p) => p.thumbStatus === 'ready') ||
      t.photos[0]
    return cover ? displaySrc(cover) : ''
  }

  const formatDate = (s: string) => {
    if (!s) return ''
    const d = new Date(s)
    if (isNaN(d.getTime())) return s
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onKeyDown={escClose}
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.96, opacity: 0, y: 12 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-background rounded-2xl shadow-2xl w-[440px] max-w-full overflow-hidden"
        data-testid="move-dialog"
        style={{
          background: 'linear-gradient(160deg, var(--g-background) 0%, var(--g-surface-2) 100%)',
          border: '2px solid color-mix(in srgb, var(--g-primary) 22%, transparent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题区 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3 border-b border-dashed border-primary/20">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary-soft text-primary shrink-0">
              <MoveToFolderIcon size={17} />
            </span>
            <div className="min-w-0">
              <h3 className="font-display text-lg text-ink leading-tight">
                {creating ? '新建旅行并移入' : '移动到旅行'}
              </h3>
              <p className="text-xs text-ink-3 mt-0.5">
                {photos.length} {noun}
                {photos.length > 1 && videoCount > 0 ? `（含 ${videoCount} 个视频）` : ''} · 文件会一起搬到目标旅行文件夹
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full hover:bg-surface-2 text-ink-3 hover:text-ink transition-colors flex items-center justify-center shrink-0"
            title="关闭"
          >
            <XIcon size={15} />
          </button>
        </div>

        {creating ? (
          /* —— 内联新建旅行 —— */
          <form onSubmit={submitCreate} className="p-5 space-y-4">
            <div>
              <label className="block text-xs text-ink-3 mb-1.5">旅行标题</label>
              <input
                autoFocus
                type="text"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="给新旅行起个名字…"
                className="w-full px-4 py-2.5 bg-surface rounded-xl text-ink placeholder-ink-3 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-ink-3 mb-1.5">开始日期（可选）</label>
                <input
                  type="date"
                  value={newStartDate}
                  onChange={(e) => setNewStartDate(e.target.value)}
                  className="w-full px-3 py-2 bg-surface rounded-xl text-ink border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>
              <div>
                <label className="block text-xs text-ink-3 mb-1.5">结束日期（可选）</label>
                <input
                  type="date"
                  value={newEndDate}
                  onChange={(e) => setNewEndDate(e.target.value)}
                  className="w-full px-3 py-2 bg-surface rounded-xl text-ink border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setCreating(false)}
                className="px-4 py-2 text-sm text-ink-2 hover:text-ink rounded-lg transition-colors"
              >
                返回选择
              </button>
              <button
                type="submit"
                disabled={!newTitle.trim() || moving}
                className="px-5 py-2 bg-primary text-white rounded-lg text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {moving ? '移动中…' : `创建并移入 ${photos.length} ${noun}`}
              </button>
            </div>
          </form>
        ) : (
          /* —— 选择已有旅行 —— */
          <>
            <div className="px-5 pt-3.5">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 flex">
                  <SearchIcon size={14} />
                </span>
                <input
                  autoFocus
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="搜索旅行…"
                  className="w-full pl-9 pr-3 py-2 bg-surface rounded-xl text-sm text-ink placeholder-ink-3 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all"
                />
              </div>
            </div>

            <div ref={listRef} className="max-h-[264px] overflow-y-auto scroll-slim px-3 py-2.5">
              {candidates.length === 0 && (
                <p className="text-center text-xs text-ink-3 py-8">
                  没有匹配的旅行，试试下方「新建旅行」
                </p>
              )}
              {candidates.map((t) => {
                const isSource = t.id === sourceTripId
                const missing = t.status === 'missing'
                const active = pickedId === t.id
                const disabled = isSource || missing
                return (
                  <button
                    key={t.id}
                    disabled={disabled}
                    onClick={() => setPickedId(t.id)}
                    onDoubleClick={() => !disabled && void doMove({ tripId: t.id })}
                    className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-left transition-colors ${
                      disabled
                        ? 'opacity-40 cursor-default'
                        : active
                          ? 'bg-primary-soft'
                          : 'hover:bg-surface-2 cursor-pointer'
                    }`}
                  >
                    <span
                      className={`w-9 h-9 rounded-lg overflow-hidden bg-surface-2 shrink-0 flex items-center justify-center ${
                        active ? 'ring-2 ring-primary' : 'border border-line'
                      }`}
                    >
                      {coverOf(t) ? (
                        <img src={coverOf(t)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-[10px] text-ink-3">空</span>
                      )}
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm text-ink truncate">
                        {t.title}
                        {isSource && <span className="text-ink-3 text-xs ml-1.5">当前旅行</span>}
                        {missing && !isSource && (
                          <span className="text-danger text-xs ml-1.5">文件夹缺失</span>
                        )}
                      </span>
                      <span className="block text-xs text-ink-3 mt-0.5">
                        {formatDate(t.startDate)}
                        {t.photos.length > 0 && ` · ${t.photos.length} 张`}
                      </span>
                    </span>
                    <span
                      className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        active ? 'border-primary' : 'border-line'
                      }`}
                    >
                      {active && <span className="w-2 h-2 rounded-full bg-primary" />}
                    </span>
                  </button>
                )
              })}
            </div>

            <div className="border-t border-dashed border-primary/20 p-3 flex items-center gap-2">
              <button
                onClick={() => setCreating(true)}
                className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-sm text-primary bg-primary-soft hover:opacity-85 transition-opacity"
              >
                <PlusIcon size={14} />
                <span>新建旅行</span>
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-ink-2 hover:text-ink rounded-xl transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => picked && void doMove({ tripId: picked.id })}
                disabled={!picked || moving}
                className="px-6 py-2 bg-primary text-white rounded-xl text-sm hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {moving ? '移动中…' : `移动 ${photos.length} ${noun}`}
              </button>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  )
}

export default MoveToTripDialog
