import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { useEscClaim, isEscTop } from '../lib/esc'
import { eligibleMigrationTargets, type MigrationCandidateTrip } from '../lib/trip-migrate'

/**
 * 删除旅行确认弹窗（旅行内有照片时替代通用 confirmDialog）：
 * ① 连同照片一起移入回收站（默认，与历史行为一致）
 * ② 把照片迁移到其他旅行，再删除旅行（其余内容照常入回收站）
 *
 * 与 feedback.tsx 同一套 host 模式：App 根部挂一次 <DeleteTripDialogHost />，
 * 任意处 confirmDeleteTripDialog() 得到 Promise 结果；Esc/点遮罩 = 取消。
 * portal 到 body——避免被侧栏层叠上下文困住（v0.9 的坑）。
 */

export interface DeleteTripRequest {
  id: string
  title: string
  photoCount: number
}

export interface DeleteTripChoice {
  /** null = 连同照片一起删除；其余 = 迁移到该旅行 id */
  migrateToTripId: string | null
}

let askDeleteTripFn: ((req: DeleteTripRequest, candidates: MigrationCandidateTrip[]) => Promise<DeleteTripChoice | null>) | null =
  null

/** Promise 化的删除旅行确认；无候选目标时调用方应退回通用 confirmDialog */
export function confirmDeleteTripDialog(
  req: DeleteTripRequest,
  candidates: MigrationCandidateTrip[],
): Promise<DeleteTripChoice | null> {
  return askDeleteTripFn ? askDeleteTripFn(req, candidates) : Promise.resolve(null)
}

interface PendingDelete extends DeleteTripRequest {
  candidates: MigrationCandidateTrip[]
  resolve: (v: DeleteTripChoice | null) => void
}

/** 在 App 根部挂载一次（与 FeedbackHost 并列） */
export function DeleteTripDialogHost() {
  const [pending, setPending] = React.useState<PendingDelete | null>(null)
  const [mode, setMode] = React.useState<'delete' | 'migrate'>('delete')
  const [targetId, setTargetId] = React.useState<string | null>(null)
  // 弹窗打开期间认领 Esc 处理权：多选态/灯箱等底层的 Esc 处理器不得穿透
  const escRef = useEscClaim(!!pending)

  React.useEffect(() => {
    askDeleteTripFn = (req, candidates) =>
      new Promise<DeleteTripChoice | null>((resolve) => {
        setPending({ ...req, candidates, resolve })
        setMode('delete')
        setTargetId(null)
      })
    return () => {
      askDeleteTripFn = null
    }
  }, [])

  React.useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (!isEscTop(escRef.current)) return
      e.preventDefault()
      pending.resolve(null)
      setPending(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, escRef])

  if (!pending) return null

  const close = (choice: DeleteTripChoice | null) => {
    pending.resolve(choice)
    setPending(null)
  }

  const migrateReady = mode === 'migrate' && targetId !== null

  return createPortal(
    <div
      data-testid="delete-trip-backdrop"
      className="fixed inset-0 z-[80] no-drag bg-overlay backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={() => close(null)}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 10 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-surface rounded-2xl shadow-2xl border border-line p-5 w-[26rem] max-h-[86vh] overflow-y-auto scroll-slim"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-display text-lg text-ink mb-1.5">删除「{pending.title}」？</h3>
        <p className="text-sm text-ink-2 leading-relaxed">
          整个旅行文件夹将移入回收站，可随时恢复。里面的 {pending.photoCount} 张照片：
        </p>

        <div role="radiogroup" aria-label="照片处理方式" className="mt-4 space-y-2">
          <label
            data-testid="delete-trip-option-delete"
            className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
              mode === 'delete' ? 'border-primary bg-primary-soft/50' : 'border-line hover:border-ink-3/40'
            }`}
          >
            <input
              type="radio"
              name="delete-trip-mode"
              className="mt-0.5 accent-primary"
              checked={mode === 'delete'}
              onChange={() => setMode('delete')}
            />
            <span className="text-sm text-ink leading-relaxed">
              一并移入回收站
              <span className="block text-xs text-ink-3 mt-0.5">照片随旅行整体入回收站，恢复时一起回来</span>
            </span>
          </label>

          <label
            data-testid="delete-trip-option-migrate"
            className={`flex items-start gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
              mode === 'migrate' ? 'border-primary bg-primary-soft/50' : 'border-line hover:border-ink-3/40'
            }`}
          >
            <input
              type="radio"
              name="delete-trip-mode"
              className="mt-0.5 accent-primary"
              checked={mode === 'migrate'}
              onChange={() => setMode('migrate')}
            />
            <span className="text-sm text-ink leading-relaxed">
              迁移到其他旅行
              <span className="block text-xs text-ink-3 mt-0.5">照片文件移动到所选旅行，再删除这次旅行</span>
            </span>
          </label>
        </div>

        {mode === 'migrate' && (
          <div data-testid="delete-trip-target-list" className="mt-3 ml-1 mr-1" role="listbox" aria-label="选择目标旅行">
            {pending.candidates.length === 0 ? (
              <p className="px-3 py-3 text-xs text-ink-3 bg-surface-2 rounded-xl">相册里没有可接收照片的其他旅行</p>
            ) : (
              <div className="max-h-44 overflow-y-auto scroll-slim rounded-xl border border-line divide-y divide-line">
                {pending.candidates.map((t) => (
                  <button
                    key={t.id}
                    role="option"
                    aria-selected={targetId === t.id}
                    data-testid="delete-trip-target-item"
                    data-trip-id={t.id}
                    data-selected={targetId === t.id ? 'true' : 'false'}
                    onClick={() => setTargetId(t.id)}
                    className={`w-full text-left px-3 py-2 flex items-center justify-between gap-3 transition-colors ${
                      targetId === t.id ? 'bg-primary-soft/60' : 'hover:bg-surface-2'
                    }`}
                  >
                    <span className="text-sm text-ink truncate">{t.title}</span>
                    <span className="text-xs text-ink-3 shrink-0">{(t.photos ?? []).length} 张</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={() => close(null)}
            className="px-4 py-1.5 text-sm text-ink-2 hover:text-ink rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            autoFocus
            data-testid="delete-trip-confirm"
            disabled={mode === 'migrate' && !migrateReady}
            onClick={() =>
              close({ migrateToTripId: mode === 'migrate' ? targetId : null })
            }
            className="px-4 py-1.5 text-sm text-scrim-ink rounded-lg transition-opacity hover:opacity-90 bg-danger disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {mode === 'migrate' ? '迁移并删除' : '移入回收站'}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}
