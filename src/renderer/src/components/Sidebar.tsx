import React from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { Album } from '../types'
import { confirmDialog, toast } from './feedback'
import ThemeSwitch from './ThemeSwitch'
import SettingsModal from './SettingsModal'
import {
  EllipsisIcon,
  GearIcon,
  HeartIcon,
  PlusIcon,
  WarningIcon,
} from './icons'

/** 左侧常驻侧栏：收藏 / 相册 / 标签 / 年份 + 底部统计与主题 */
const Sidebar: React.FC = () => {
  const navigate = useNavigate()
  const {
    albums,
    activeAlbumId,
    trips,
    stats,
    progress,
    filters,
    setFilters,
    setActiveAlbum,
    reloadAlbums,
    reloadTrips,
    reloadStats,
    refreshAll,
  } = useApp()
  const [menuAlbum, setMenuAlbum] = React.useState<Album | null>(null)
  const [renamingAlbum, setRenamingAlbum] = React.useState<Album | null>(null)
  const [renameText, setRenameText] = React.useState('')
  const [showSettings, setShowSettings] = React.useState(false)

  const allTags = React.useMemo(() => {
    const s = new Set<string>()
    trips.forEach((t) => t.tags.forEach((tag) => s.add(tag)))
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
  }, [trips])

  const years = React.useMemo(() => {
    const s = new Set<string>()
    trips.forEach((t) => {
      const y = t.startDate?.slice(0, 4)
      if (y && /^\d{4}$/.test(y)) s.add(y)
    })
    return Array.from(s).sort((a, b) => b.localeCompare(a))
  }, [trips])

  const hasFilter =
    filters.favoritesOnly || filters.tags.length > 0 || filters.year !== null

  const handleRegister = async () => {
    const album = await api.registerAlbum()
    if (album) {
      await reloadAlbums()
      await setActiveAlbum(album.id)
    }
  }

  const handleRelocate = async (album: Album) => {
    const updated = await api.relocateAlbum(album.id)
    setMenuAlbum(null)
    if (updated) {
      await reloadAlbums()
      await refreshAll()
    }
  }

  const handleRemove = async (album: Album) => {
    const ok = await confirmDialog({
      title: `移除相册「${album.name}」？`,
      body: '仅解除注册，不会删除磁盘上的任何文件。',
      confirmText: '移除',
      danger: true,
    })
    if (ok) {
      await api.removeAlbum(album.id)
      setMenuAlbum(null)
      await refreshAll()
      toast(`已移除相册「${album.name}」`)
    }
  }

  const handleRescan = async (album: Album) => {
    setMenuAlbum(null)
    await api.rescanAlbum(album.id)
    await refreshAll()
  }

  const handleRenameSubmit = async () => {
    if (renamingAlbum && renameText.trim()) {
      await api.renameAlbum(renamingAlbum.id, renameText.trim())
      await reloadAlbums()
    }
    setRenamingAlbum(null)
  }

  const favoriteCount = trips.filter((t) => t.isFavorite).length

  return (
    <aside className="w-60 shrink-0 h-screen sticky top-0 flex flex-col border-r border-line bg-surface">
      {/* 顶部留出红绿灯区域 */}
      <div className="drag-region h-12 shrink-0 flex items-end pl-20 pr-3 pb-1">
        <span className="font-display font-bold text-xl text-primary tracking-wide">画廊</span>
      </div>

      <nav className="flex-1 overflow-y-auto scroll-slim px-3 pb-3 space-y-5">
        {/* 收藏 */}
        <button
          onClick={() => setFilters({ favoritesOnly: !filters.favoritesOnly })}
          className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            filters.favoritesOnly
              ? 'bg-primary-soft text-primary font-medium'
              : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
          }`}
        >
          <span className="flex items-center">
            <HeartIcon size={16} filled={filters.favoritesOnly} />
          </span>
          <span>收藏</span>
          {favoriteCount > 0 && (
            <span className="ml-auto text-xs text-ink-3">{favoriteCount}</span>
          )}
        </button>

        {/* 相册 */}
        <section>
          <header className="flex items-center justify-between px-3 mb-1">
            <h2 className="text-xs font-medium text-ink-3 tracking-widest">相册</h2>
            <button
              onClick={handleRegister}
              title="注册相册目录"
              className="w-5 h-5 rounded text-ink-3 hover:text-primary hover:bg-primary-soft transition-colors flex items-center justify-center"
            >
              <PlusIcon size={14} />
            </button>
          </header>
          <ul className="space-y-0.5">
            {albums.map((album) => {
              const active = album.id === activeAlbumId
              const missing = album.status === 'missing'
              return (
                <li key={album.id} className="relative group">
                  <button
                    onClick={() => {
                      if (missing) {
                        void handleRelocate(album)
                      } else {
                        void setActiveAlbum(album.id)
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm text-left transition-colors ${
                      missing
                        ? 'text-ink-3 border border-dashed border-line'
                        : active
                          ? 'bg-primary-soft text-primary font-medium'
                          : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        missing ? 'bg-danger/60' : active ? 'bg-primary' : 'bg-line'
                      }`}
                    />
                    <span className="truncate flex-1 flex items-center gap-1">
                      {album.name}
                      {missing && <WarningIcon size={12} className="text-danger shrink-0" />}
                    </span>
                    <span
                      role="button"
                      tabIndex={0}
                      onClick={(e) => {
                        e.stopPropagation()
                        setMenuAlbum(menuAlbum?.id === album.id ? null : album)
                      }}
                      onKeyDown={(e) => e.key === 'Enter' && setMenuAlbum(album)}
                      className={`opacity-0 group-hover:opacity-100 text-ink-3 hover:text-primary px-0.5 rounded flex items-center ${
                        menuAlbum?.id === album.id ? 'opacity-100' : ''
                      }`}
                    >
                      <EllipsisIcon size={14} />
                    </span>
                  </button>

                  {/* 相册操作菜单 */}
                  {menuAlbum?.id === album.id && (
                    <div
                      className="absolute right-2 top-8 z-30 w-36 bg-surface rounded-lg shadow-lg border border-line py-1 text-sm"
                      onMouseLeave={() => setMenuAlbum(null)}
                    >
                      {missing ? (
                        <MenuItem onClick={() => handleRelocate(album)}>重新定位</MenuItem>
                      ) : (
                        <>
                          <MenuItem
                            onClick={() => {
                              setRenamingAlbum(album)
                              setRenameText(album.name)
                              setMenuAlbum(null)
                            }}
                          >
                            重命名
                          </MenuItem>
                          <MenuItem onClick={() => handleRescan(album)}>重新扫描</MenuItem>
                        </>
                      )}
                      <MenuItem danger onClick={() => handleRemove(album)}>
                        移除相册
                      </MenuItem>
                    </div>
                  )}
                </li>
              )
            })}
            {albums.length === 0 && (
              <li className="px-3 py-2 text-xs text-ink-3 leading-relaxed">
                还没有相册，点击「相册」右侧的加号选择照片根目录
              </li>
            )}
          </ul>
        </section>

        {/* 标签 */}
        {allTags.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-ink-3 tracking-widest px-3 mb-1.5">标签</h2>
            <div className="flex flex-wrap gap-1.5 px-2">
              {allTags.map((tag) => {
                const on = filters.tags.includes(tag)
                return (
                  <button
                    key={tag}
                    onClick={() =>
                      setFilters({
                        tags: on
                          ? filters.tags.filter((t) => t !== tag)
                          : [...filters.tags, tag],
                      })
                    }
                    className={`px-2 py-0.5 rounded-full text-xs transition-colors ${
                      on
                        ? 'bg-primary text-white'
                        : 'bg-surface-2 text-ink-2 hover:bg-primary-soft hover:text-primary'
                    }`}
                  >
                    #{tag}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        {/* 年份 */}
        {years.length > 0 && (
          <section>
            <h2 className="text-xs font-medium text-ink-3 tracking-widest px-3 mb-1.5">年份</h2>
            <div className="flex flex-wrap gap-1 px-2">
              {years.map((year) => {
                const on = filters.year === year
                return (
                  <button
                    key={year}
                    onClick={() => setFilters({ year: on ? null : year })}
                    className={`px-2.5 py-0.5 rounded-full text-xs font-display transition-colors ${
                      on
                        ? 'bg-primary text-white'
                        : 'text-ink-2 hover:bg-surface-2 hover:text-ink'
                    }`}
                  >
                    {year}
                  </button>
                )
              })}
            </div>
          </section>
        )}
      </nav>

      {/* 底部固定：进度 / 统计 / 主题 / 设置 */}
      <footer className="shrink-0 border-t border-line px-4 py-3 space-y-2.5">
        {progress && (
          <div>
            <div className="flex justify-between text-xs text-ink-3 mb-1">
              <span>{progress.phase === 'scan' ? '正在扫描' : '生成缩略图'}</span>
              <span>
                {progress.done}/{progress.total}
              </span>
            </div>
            <div className="h-1 rounded-full bg-surface-2 overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{
                  width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%`,
                }}
              />
            </div>
          </div>
        )}
        {hasFilter && (
          <button
            onClick={() => setFilters({ favoritesOnly: false, tags: [], year: null })}
            className="text-xs text-ink-3 hover:text-primary transition-colors"
          >
            清除筛选
          </button>
        )}
        <div className="text-xs text-ink-3 flex flex-wrap gap-x-2">
          <span>{stats ? `${stats.albums} 相册` : '—'}</span>
          <span>{stats ? `${stats.trips} 旅行` : ''}</span>
          <span>{stats ? `${stats.photos} 张` : ''}</span>
          {stats && stats.storageBytes > 0 && (
            <span>{formatBytes(stats.storageBytes)}</span>
          )}
        </div>
        <div className="flex items-center justify-between">
          <ThemeSwitch />
          <button
            onClick={() => setShowSettings(true)}
            title="设置"
            className="text-ink-3 hover:text-primary transition-colors flex items-center"
          >
            <GearIcon size={16} />
          </button>
        </div>
      </footer>

      {/* 重命名弹层（portal 到 body，避免被 sticky 侧栏的层叠上下文困住） */}
      {renamingAlbum &&
        createPortal(
          <div
            className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center"
            onClick={() => setRenamingAlbum(null)}
          >
          <div
            className="bg-surface rounded-xl shadow-xl p-5 w-72"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-medium text-ink mb-3">重命名相册</h3>
            <input
              autoFocus
              value={renameText}
              onChange={(e) => setRenameText(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
              className="w-full px-3 py-2 bg-background border border-line rounded-lg text-sm text-ink focus:outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => setRenamingAlbum(null)}
                className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink rounded-lg"
              >
                取消
              </button>
              <button
                onClick={handleRenameSubmit}
                className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:opacity-90"
              >
                确定
              </button>
            </div>
          </div>
          </div>,
          document.body,
        )}

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onChanged={async () => {
            await refreshAll()
          }}
        />
      )}
    </aside>
  )
}

function MenuItem({
  children,
  onClick,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void | Promise<void>
  danger?: boolean
}) {
  return (
    <button
      onClick={() => void onClick()}
      className={`w-full text-left px-3 py-1.5 hover:bg-surface-2 transition-colors ${
        danger ? 'text-danger' : 'text-ink-2'
      }`}
    >
      {children}
    </button>
  )
}

function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(0)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`
}

export default Sidebar
