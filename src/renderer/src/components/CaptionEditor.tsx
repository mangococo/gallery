import React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { api, displaySrc } from '../lib/api'
import { Photo } from '../types'
import { toast } from './feedback'

interface CaptionEditorProps {
  photo: Photo
  onClose: () => void
  onSaved: (photoId: string, caption: string) => void
}

/** 图注编辑弹层：照片墙悬停按钮与灯箱共用（后端 photosSetCaption IPC 已有） */
const CaptionEditor: React.FC<CaptionEditorProps> = ({ photo, onClose, onSaved }) => {
  const [text, setText] = React.useState(photo.caption)
  const [saving, setSaving] = React.useState(false)

  const save = async () => {
    if (saving) return
    setSaving(true)
    try {
      const caption = text.trim()
      await api.setCaption(photo.id, caption)
      onSaved(photo.id, caption)
      toast('图注已保存', 'success')
      onClose()
    } catch (err: any) {
      toast('图注保存失败: ' + (err?.message ?? err), 'error')
      setSaving(false)
    }
  }

  const thumb = displaySrc(photo)

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[70] no-drag bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 10 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          className="bg-surface rounded-2xl shadow-2xl border border-line p-5 w-[420px] max-w-full"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex gap-4">
            {thumb ? (
              <img
                src={thumb}
                alt=""
                className="w-20 h-20 object-cover rounded-lg border border-line shrink-0"
              />
            ) : (
              <div className="w-20 h-20 rounded-lg border border-line bg-surface-2 shrink-0 flex items-center justify-center">
                <span className="text-[10px] text-ink-3">视频</span>
              </div>
            )}
            <div className="flex-1 min-w-0">
              <h3 className="font-display text-lg text-ink mb-2">图注</h3>
              <textarea
                autoFocus
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.stopPropagation()
                    onClose()
                  } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    void save()
                  }
                }}
                rows={4}
                placeholder="给这张照片写点什么…"
                className="w-full px-3 py-2 bg-background border border-line rounded-lg text-sm text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-colors resize-none leading-relaxed"
              />
            </div>
          </div>
          <div className="flex items-center justify-between mt-4 gap-3">
            <span className="text-xs text-ink-3 truncate">{photo.fileName} · ⌘↩ 保存</span>
            <div className="flex gap-2 shrink-0">
              <button
                onClick={onClose}
                className="px-4 py-1.5 text-sm text-ink-2 hover:text-ink rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="px-4 py-1.5 text-sm bg-primary text-white rounded-lg hover:opacity-90 transition-opacity disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  )
}

export default CaptionEditor
