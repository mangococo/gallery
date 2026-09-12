import React from 'react'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { toast } from './feedback'
import { CameraIcon, MoveToFolderIcon, SparklesIcon, XIcon } from './icons'
import { useEscClaim, isEscTop } from '../lib/esc'
import type { Album } from '../types'

/** registerAlbum 返回的 flat-media 描述符（主进程预检产物） */
export interface AdoptFlatPending {
  path: string
  fileCount: number
  sample: string[]
  suggestedName: string
}

interface AdoptFlatDialogProps {
  pending: AdoptFlatPending
  onClose: () => void
  /** 归档成功（相册已注册并切换） */
  onAdopted: (album: Album) => void
}

/** 路径末段（跨平台分隔符），仅展示用 */
function lastSegment(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

/**
 * 平铺照片归档确认（#2）：相册根目录直接放照片时引导用户确认——
 * 创建默认旅行并自动把照片移进对应目录；拒绝则整个相册不导入。
 */
const AdoptFlatDialog: React.FC<AdoptFlatDialogProps> = ({ pending, onClose, onAdopted }) => {
  const [name, setName] = React.useState(pending.suggestedName)
  const [submitting, setSubmitting] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement>(null)

  // 弹层认领 ESC（提交中不关）；与其它弹层共享 esc 栈语义
  const escRef = useEscClaim()
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isEscTop(escRef.current)) return
      if (submitting) return
      onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [submitting, escRef])

  React.useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  const dirName = lastSegment(pending.path)

  const handleConfirm = async () => {
    setSubmitting(true)
    try {
      const album = await api.adoptFlatMedia(pending.path, name)
      // 成功路径不调 onClose：由 onAdopted 收尾（避免误报取消 toast）
      onAdopted(album)
    } catch (err: any) {
      toast(err?.message ?? '归档失败', 'error')
      setSubmitting(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 no-drag bg-overlay backdrop-blur-sm flex items-center justify-center p-4"
      onClick={() => !submitting && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        data-testid="adopt-flat-dialog"
        className="bg-background rounded-3xl shadow-2xl max-w-xl w-full overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, var(--background) 0%, var(--surface-2) 100%)',
          border: '3px solid color-mix(in srgb, var(--primary) 25%, transparent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative bg-gradient-to-r from-primary/10 to-primary/5 px-7 py-5 border-b-2 border-dashed border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-primary font-display mb-1 flex items-center gap-2">
                <CameraIcon size={20} />
                <span>发现平铺在根目录的照片</span>
              </h2>
              <p className="text-xs text-ink-3">「{dirName}」目录根部有 {pending.fileCount} 张直接存放的照片</p>
            </div>
            <button
              onClick={() => !submitting && onClose()}
              className="w-8 h-8 rounded-full bg-surface/80 hover:bg-surface text-ink-2 hover:text-primary transition-all shadow-sm flex items-center justify-center"
            >
              <XIcon size={16} />
            </button>
          </div>
        </div>

        <div className="p-7 space-y-5">
          <p className="text-sm text-ink-2 leading-relaxed">
            系统将自动创建一个默认旅行，并把这些照片移动到该旅行对应的同名文件夹中；
            目录里已有的子目录旅行不受影响。整个过程由应用完成，不需要你手动整理文件。
          </p>

          {pending.sample.length > 0 && (
            <div className="px-4 py-3 bg-surface rounded-2xl border-2 border-dashed border-primary/15">
              <p className="text-xs text-ink-3 mb-1.5 font-display">样例文件</p>
              <p className="text-xs text-ink-2 break-all leading-relaxed">
                {pending.sample.join('、')}
                {pending.fileCount > pending.sample.length ? ` …（共 ${pending.fileCount} 张）` : ''}
              </p>
            </div>
          )}

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-ink-2 text-sm font-medium">
              <MoveToFolderIcon size={16} />
              <span>默认旅行名称</span>
            </label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="adopt-flat-name"
              className="w-full px-5 py-3.5 bg-surface rounded-2xl text-ink placeholder:text-ink-3/70 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
              placeholder="给这次旅行起个名字..."
            />
            <p className="text-xs text-ink-3 px-1">照片会被移动到「{name.trim() || pending.suggestedName}」文件夹中</p>
          </div>

          <div className="flex items-center justify-between gap-4 pt-4 border-t-2 border-dashed border-primary/10">
            <p className="text-xs text-ink-3">取消则不导入该相册，也不会移动任何文件</p>
            <div className="flex items-center gap-3 shrink-0">
              <button
                type="button"
                onClick={() => !submitting && onClose()}
                data-testid="adopt-flat-cancel"
                className="px-5 py-2.5 text-ink-2 hover:text-ink transition-colors rounded-2xl hover:bg-surface/50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void handleConfirm()}
                disabled={submitting}
                data-testid="adopt-flat-confirm"
                className="px-6 py-2.5 bg-primary text-primary-ink rounded-2xl hover:shadow-lg transition-all transform hover:scale-105 font-medium disabled:opacity-60 flex items-center gap-2 text-sm"
              >
                <SparklesIcon size={15} />
                <span>{submitting ? '归档中…' : '创建旅行并归档'}</span>
              </button>
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default AdoptFlatDialog
