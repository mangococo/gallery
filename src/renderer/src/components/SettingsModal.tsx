import React from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { confirmDialog, toast } from './feedback'
import { WarningIcon, XIcon } from './icons'
import type { LegacyImportResult } from '../types'

interface SettingsModalProps {
  onClose: () => void
  onChanged: () => Promise<void>
}

/** 设置弹窗：相册管理 / 重新扫描 / 导入旧数据 / 清除数据 */
const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onChanged }) => {
  const { albums, reloadAlbums } = useApp()
  const [busy, setBusy] = React.useState<string | null>(null)
  const [importResult, setImportResult] = React.useState<LegacyImportResult | null>(null)

  const handleImportLegacy = async () => {
    setBusy('import')
    try {
      const result = await api.importLegacy()
      if (result) {
        await reloadAlbums()
        await onChanged()
        setImportResult(result)
      }
    } catch (err: any) {
      toast('导入失败: ' + (err?.message ?? err), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleRescanAll = async () => {
    setBusy('rescan')
    try {
      for (const album of albums) {
        if (album.status === 'ok') await api.rescanAlbum(album.id)
      }
      await onChanged()
    } finally {
      setBusy(null)
    }
  }

  const handleRemoveAlbum = async (id: string, name: string) => {
    const ok = await confirmDialog({
      title: `移除相册「${name}」？`,
      body: '仅解除注册，不会删除磁盘上的任何文件。',
      confirmText: '移除',
      danger: true,
    })
    if (ok) {
      await api.removeAlbum(id)
      await reloadAlbums()
      await onChanged()
      toast(`已移除相册「${name}」`)
    }
  }

  const handleClearData = async () => {
    const ok = await confirmDialog({
      title: '清除应用数据？',
      body: '将清除应用数据库中的所有相册注册与旅行记录。\n照片文件不会被删除；之后可重新注册相册恢复。',
      confirmText: '清除',
      danger: true,
    })
    if (ok) {
      for (const album of albums) {
        await api.removeAlbum(album.id)
      }
      await onChanged()
      toast('已清除，照片文件原地未动')
    }
  }

  // portal 到 body：侧栏是 sticky 层叠上下文，弹窗留在内部会被照片堆叠盖住
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ type: 'spring', damping: 26, stiffness: 320 }}
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-md border border-line"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-6 py-4 border-b border-line">
          <h2 className="font-display text-xl font-bold text-primary">设置</h2>
          <button
            onClick={onClose}
            title="关闭"
            className="w-7 h-7 rounded-full text-ink-3 hover:text-ink hover:bg-surface-2 transition-colors flex items-center justify-center"
          >
            <XIcon size={14} />
          </button>
        </header>

        <div className="px-6 py-5 space-y-5 max-h-[60vh] overflow-y-auto scroll-slim">
          {/* 相册管理 */}
          <section>
            <h3 className="text-sm font-medium text-ink mb-2">相册</h3>
            <ul className="space-y-1.5">
              {albums.map((album) => (
                <li
                  key={album.id}
                  className="flex items-center gap-2 px-3 py-2 bg-background rounded-lg border border-line"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm text-ink truncate">
                      {album.name}
                      {album.status === 'missing' && (
                        <span className="text-danger text-xs ml-1 inline-flex items-center gap-0.5 align-baseline">
                          <WarningIcon size={11} className="self-center" />
                          目录缺失
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-3 truncate">{album.path}</div>
                  </div>
                  <button
                    onClick={() => handleRemoveAlbum(album.id, album.name)}
                    className="text-xs text-ink-3 hover:text-danger transition-colors shrink-0"
                  >
                    移除
                  </button>
                </li>
              ))}
              {albums.length === 0 && (
                <li className="text-xs text-ink-3 py-2">还没有注册相册</li>
              )}
            </ul>
          </section>

          {/* 操作 */}
          <section className="space-y-2">
            <button
              onClick={handleRescanAll}
              disabled={busy !== null}
              className="w-full px-4 py-2.5 text-sm bg-primary-soft text-primary rounded-xl hover:opacity-85 transition-opacity disabled:opacity-50"
            >
              {busy === 'rescan' ? '扫描中…' : '重新扫描所有相册'}
            </button>
            <button
              onClick={handleImportLegacy}
              disabled={busy !== null}
              className="w-full px-4 py-2.5 text-sm bg-primary-soft text-primary rounded-xl hover:opacity-85 transition-opacity disabled:opacity-50"
            >
              {busy === 'import' ? '导入中…' : '导入旧版数据目录'}
            </button>
            {importResult && (
              <p className="text-xs text-ink-3 leading-relaxed">
                已导入「{importResult.album.name}」：{importResult.trips} 次旅行、
                {importResult.photos} 个文件
                {importResult.skippedCaptions > 0 &&
                  `；跳过 ${importResult.skippedCaptions} 个失效图注`}
              </p>
            )}
            <button
              onClick={handleClearData}
              disabled={busy !== null}
              className="w-full px-4 py-2.5 text-sm bg-danger/10 text-danger rounded-xl hover:bg-danger/20 transition-colors disabled:opacity-50"
            >
              清除应用数据
            </button>
            <p className="text-xs text-ink-3 leading-relaxed">
              清除仅影响应用数据库（注册与记录），照片文件原地不动。
            </p>
          </section>
        </div>
      </motion.div>
    </div>,
    document.body,
  )
}

export default SettingsModal
