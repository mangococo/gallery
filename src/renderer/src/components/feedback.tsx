import React from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { CheckIcon } from './icons'

/**
 * 应用内反馈组件：toast 轻提示 + 确认弹窗，替代原生 confirm()/alert()。
 * 用法：App 挂一次 <FeedbackHost />，任意处调 toast() / confirmDialog()。
 * 坑（v0.9 踩过）：弹窗必须 portal 到 body——侧栏 sticky 会创建层叠上下文困住 z-50。
 */

// —— toast ——

export type ToastKind = 'info' | 'success' | 'error'

let pushToastFn: ((message: string, kind: ToastKind) => void) | null = null

/** 操作后的轻提示（删除/导入/保存…），2.8s 自动消失 */
export function toast(message: string, kind: ToastKind = 'info'): void {
  pushToastFn?.(message, kind)
}

const TOAST_DOT: Record<ToastKind, string> = {
  info: 'bg-primary',
  success: 'bg-primary',
  error: 'bg-danger',
}

function ToastHost() {
  const [items, setItems] = React.useState<{ id: number; message: string; kind: ToastKind }[]>([])

  React.useEffect(() => {
    let seq = 0
    pushToastFn = (message, kind) => {
      const id = ++seq
      setItems((prev) => [...prev.slice(-3), { id, message, kind }])
      window.setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id))
      }, 2800)
    }
    return () => {
      pushToastFn = null
    }
  }, [])

  return createPortal(
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] flex flex-col items-center gap-2 pointer-events-none">
      <AnimatePresence>
        {items.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="flex items-center gap-2 bg-surface border border-line shadow-lg rounded-xl px-4 py-2.5 text-sm text-ink"
          >
            {t.kind === 'success' ? (
              <CheckIcon size={14} className="text-primary shrink-0" />
            ) : (
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TOAST_DOT[t.kind]}`} />
            )}
            <span className="truncate max-w-[60vw]">{t.message}</span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>,
    document.body,
  )
}

// —— 确认弹窗 ——

export interface ConfirmOptions {
  title: string
  body?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（删除类）确认按钮用红色 */
  danger?: boolean
}

let askConfirmFn: ((o: ConfirmOptions) => Promise<boolean>) | null = null

/** Promise 化的应用内确认（替代原生 confirm）；Esc/点遮罩 = 取消 */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return askConfirmFn ? askConfirmFn(options) : Promise.resolve(false)
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (v: boolean) => void
}

function ConfirmHost() {
  const [pending, setPending] = React.useState<PendingConfirm | null>(null)

  React.useEffect(() => {
    askConfirmFn = (o) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...o, resolve })
      })
    return () => {
      askConfirmFn = null
    }
  }, [])

  React.useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        pending.resolve(false)
        setPending(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending])

  if (!pending) return null

  const close = (v: boolean) => {
    pending.resolve(v)
    setPending(null)
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[80] no-drag bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => close(false)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-surface rounded-2xl shadow-2xl border border-line p-5 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg text-ink mb-1.5">{pending.title}</h3>
        {pending.body && (
          <p className="text-sm text-ink-2 leading-relaxed whitespace-pre-wrap">{pending.body}</p>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => close(false)}
            className="px-4 py-1.5 text-sm text-ink-2 hover:text-ink rounded-lg transition-colors"
          >
            {pending.cancelText ?? '取消'}
          </button>
          <button
            autoFocus
            onClick={() => close(true)}
            className={`px-4 py-1.5 text-sm text-white rounded-lg transition-opacity hover:opacity-90 ${
              pending.danger ? 'bg-danger' : 'bg-primary'
            }`}
          >
            {pending.confirmText ?? '确定'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

/** 在 App 根部挂载一次 */
export function FeedbackHost() {
  return (
    <>
      <ToastHost />
      <ConfirmHost />
    </>
  )
}
