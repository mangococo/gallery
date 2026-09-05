import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { api } from '../lib/api'
import { useApp } from '../lib/store'
import { hasMediaExt } from '../lib/media'
import PhotoWall from '../components/PhotoWall'
import TagInput from '../components/TagInput'
import Lightbox from '../components/Lightbox'
import CaptionEditor from '../components/CaptionEditor'
import PhotoTagEditor from '../components/PhotoTagEditor'
import MapView from '../components/MapView'
import { toast } from '../components/feedback'
import { confirmAndDeleteTrip } from '../lib/trip-actions'
import { dateToLocalStr, formatDotDate, parseLocalDate } from '@shared/dates'
import {
  ArrowLeftIcon,
  PlusIcon,
  HeartIcon,
  TrashIcon,
  XIcon,
  BookIcon,
  WarningIcon,
} from '../components/icons'
import type { JournalFormat } from '../types'
import { Photo, Trip } from '../types'

const TripPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { refreshAll } = useApp()
  const [trip, setTrip] = React.useState<Trip | null>(null)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editedTrip, setEditedTrip] = React.useState<Trip | null>(null)
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null)
  const [captionTarget, setCaptionTarget] = React.useState<Photo | null>(null)
  const [tagTarget, setTagTarget] = React.useState<Photo | null>(null)
  /** 照片墙过滤：只看收藏 / 按标签筛选（旅行页内） */
  const [favOnly, setFavOnly] = React.useState(false)
  const [tagFilter, setTagFilter] = React.useState<string | null>(null)
  /** 旅行页内容视图：照片墙 / 地图 */
  const [viewMode, setViewMode] = React.useState<'photos' | 'map'>('photos')
  const [exportOpen, setExportOpen] = React.useState(false)
  const [exporting, setExporting] = React.useState<JournalFormat | null>(null)
  const [isUploading, setIsUploading] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)
  const [isDeletingTrip, setIsDeletingTrip] = React.useState(false)

  React.useEffect(() => {
    const loadTrip = async () => {
      const tripData = await api.getTrip(id!)
      setTrip(tripData)
      setEditedTrip(tripData ? { ...tripData, tags: tripData.tags || [] } : null)
    }
    loadTrip()
  }, [id])

  const applyUpdate = async (updated: Trip) => {
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  const importPathsToTrip = async (paths: string[]) => {
    if (!trip || paths.length === 0) return
    setIsUploading(true)
    try {
      const newPhotos = await api.importPhotos(trip.id, paths)
      if (editedTrip && newPhotos.length > 0) {
        await applyUpdate({ ...editedTrip, photos: [...editedTrip.photos, ...newPhotos] })
      }
      toast(`已导入 ${newPhotos.length} 张照片`, 'success')
      await refreshAll()
    } catch (error: any) {
      toast('导入照片失败: ' + error.message, 'error')
    }
    setIsUploading(false)
  }

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0) return
    const paths = Array.from(files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
      .map((f) => api.getPathForFile(f))
    await importPathsToTrip(paths)
    event.target.value = ''
  }

  /** 拖拽照片进窗口即导入该旅行（方案决策17）；stopPropagation 避免触发首页级拖拽弹层 */
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragOver(false)
    const paths = Array.from(event.dataTransfer.files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
      .map((f) => api.getPathForFile(f))
      .filter((p) => !!p)
    await importPathsToTrip(paths)
  }

  const handleDeletePhoto = async (photoId: string) => {
    if (!editedTrip) return
    const idx = editedTrip.photos.findIndex((p: Photo) => p.id === photoId)
    try {
      await api.deletePhoto(photoId)
    } catch (error: any) {
      toast('删除失败: ' + error.message, 'error')
      return
    }
    const remaining = editedTrip.photos.filter((p: Photo) => p.id !== photoId)
    await applyUpdate({ ...editedTrip, photos: remaining })
    // 灯箱开着时跟随收缩；删空则关闭
    setLightboxIndex((cur) => {
      if (cur === null) return null
      if (remaining.length === 0) return null
      return Math.min(cur > idx ? cur - 1 : cur, remaining.length - 1)
    })
    toast('已移入废纸篓', 'success')
    await refreshAll()
  }

  const handleSetCover = async (photoId: string) => {
    if (!editedTrip) return
    await api.setCover(editedTrip.id, photoId)
    await applyUpdate({ ...editedTrip, coverPhotoId: photoId })
    await refreshAll()
  }

  /** 删除当前打开的旅行：确认弹窗期间锁住入口防重复点击，成功后回首页 */
  const handleDeleteTrip = async () => {
    if (!trip || isDeletingTrip) return
    setIsDeletingTrip(true)
    const deleted = await confirmAndDeleteTrip({
      id: trip.id,
      title: trip.title,
      photoCount: photos.length,
      status: trip.status,
    })
    if (deleted) {
      await refreshAll()
      navigate('/')
    }
    setIsDeletingTrip(false)
  }

  /** 导出手账：PDF 或长图 PNG（保存对话框由主进程弹出） */
  const handleExport = async (format: JournalFormat) => {
    if (!trip || exporting) return
    setExportOpen(false)
    setExporting(format)
    try {
      const path = await api.exportJournal(trip.id, format)
      if (path) toast(`手账已导出：${path.split('/').pop()}`, 'success')
    } catch (error: any) {
      toast('导出失败: ' + (error?.message ?? error), 'error')
    }
    setExporting(null)
  }

  const handleCaptionSaved = (photoId: string, caption: string) => {
    if (!editedTrip) return
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (p.id === photoId ? { ...p, caption } : p)),
    }
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  /** 照片级收藏：本地即时更新（不动统计与时间线，无需 refreshAll） */
  const handleTogglePhotoFavorite = async (photoId: string, favorite: boolean) => {
    if (!editedTrip) return
    try {
      await api.setPhotoFavorite(photoId, favorite)
    } catch (error: any) {
      toast('操作失败: ' + error.message, 'error')
      return
    }
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (p.id === photoId ? { ...p, favorite } : p)),
    }
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  /** 照片级标签保存（覆盖式） */
  const handlePhotoTagsSaved = (photoId: string, tags: string[]) => {
    if (!editedTrip) return
    const updated = {
      ...editedTrip,
      photos: editedTrip.photos.map((p: Photo) => (p.id === photoId ? { ...p, tags } : p)),
    }
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  const handleSave = async () => {
    if (editedTrip) {
      const saved = await api.updateTrip(editedTrip.id, {
        title: editedTrip.title,
        description: editedTrip.description,
        startDate: editedTrip.startDate,
        endDate: editedTrip.endDate,
        tags: editedTrip.tags,
      })
      if (saved) setTrip(saved)
      setIsEditing(false)
      await refreshAll()
    }
  }

  const handlePhotoClick = (photo: Photo) => {
    const list = editedTrip?.photos || trip?.photos || []
    setLightboxIndex(list.findIndex((p: Photo) => p.id === photo.id))
  }

  /** DatePicker 展示值：date-only 字符串按本地时区解析（UTC 解析会在西半球偏一天） */
  const asDate = (s: string): Date | null => {
    const d = parseLocalDate(s)
    return isNaN(d.getTime()) ? null : d
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-ink-3">加载中…</p>
      </div>
    )
  }

  const photos = editedTrip?.photos || trip.photos
  /** 照片墙过滤（旅行页内）：只看收藏 / 按照片标签筛选；灯箱始终浏览全量列表 */
  const photoTagList = [...new Set(photos.flatMap((p: Photo) => p.tags || []))].sort((a, b) =>
    a.localeCompare(b, 'zh'),
  )
  const visiblePhotos = photos.filter(
    (p: Photo) => (!favOnly || p.favorite) && (!tagFilter || (p.tags || []).includes(tagFilter)),
  )

  return (
    <div
      className="min-h-screen bg-background"
      onDragOver={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDragOver(true)
      }}
      onDragLeave={(e) => {
        e.stopPropagation()
        setDragOver(false)
      }}
      onDrop={handleDrop}
    >
      {/* 顶栏（可拖拽） */}
      <header className="drag-region sticky top-0 z-20 h-12 bg-background/85 backdrop-blur-sm border-b border-line flex items-center justify-between pl-5 pr-5">
        <button
          onClick={() => navigate('/')}
          className="no-drag flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary transition-colors"
        >
          <span className="flex items-center">
            <ArrowLeftIcon size={16} />
          </span>
          <span>返回</span>
        </button>
        <div className="flex items-center gap-3 no-drag">
          {isEditing ? (
            <>
              <button
                onClick={() => {
                  setEditedTrip(trip)
                  setIsEditing(false)
                }}
                className="px-4 py-1.5 text-sm text-ink-2 hover:text-ink transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                className="px-5 py-1.5 bg-primary text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
              >
                保存
              </button>
            </>
          ) : (
            <>
              <div className="relative">
                <button
                  onClick={() => setExportOpen((v) => !v)}
                  disabled={!!exporting}
                  className="px-3 py-1.5 text-sm text-ink-2 hover:text-ink rounded-lg transition-colors flex items-center gap-1.5 disabled:opacity-50"
                  title="导出手账"
                >
                  <BookIcon size={15} />
                  <span>{exporting === 'pdf' ? '生成 PDF…' : exporting === 'png' ? '生成长图…' : '导出手账'}</span>
                </button>
                {exportOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setExportOpen(false)} />
                    <div className="absolute right-0 top-full mt-1.5 z-40 w-52 bg-surface border border-line rounded-xl shadow-xl p-1.5 no-drag">
                      <button
                        onClick={() => void handleExport('pdf')}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-soft transition-colors"
                      >
                        <span className="block text-sm text-ink">PDF · 可打印</span>
                        <span className="block text-xs text-ink-3 mt-0.5">矢量文字，适合送印</span>
                      </button>
                      <button
                        onClick={() => void handleExport('png')}
                        className="w-full text-left px-3 py-2 rounded-lg hover:bg-primary-soft transition-colors"
                      >
                        <span className="block text-sm text-ink">长图 PNG</span>
                        <span className="block text-xs text-ink-3 mt-0.5">整卷一张，适合分享</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
              <button
                onClick={handleDeleteTrip}
                disabled={isDeletingTrip}
                title="删除这次旅行"
                className="p-2 text-ink-3 hover:text-danger rounded-lg transition-colors disabled:opacity-50"
              >
                <TrashIcon size={16} />
              </button>
              <button
                onClick={() => setIsEditing(true)}
                className="px-5 py-1.5 bg-primary text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
              >
                编辑
              </button>
            </>
          )}
        </div>
      </header>

      {/* 拖拽导入提示层 */}
      {dragOver && (
        <div className="fixed inset-0 z-40 bg-primary/10 backdrop-blur-[1px] pointer-events-none flex items-center justify-center">
          <div className="px-8 py-5 bg-surface rounded-2xl shadow-xl border-2 border-dashed border-primary">
            <p className="font-display text-lg text-primary">松手即导入这次旅行</p>
          </div>
        </div>
      )}

      <main className="max-w-[1100px] mx-auto px-10 py-10">
        {/* 文件夹缺失横幅（⌘K 等入口仍可能进到缺失旅行页） */}
        {trip.status === 'missing' && (
          <div className="mb-6 px-4 py-3 bg-danger/10 border border-danger/30 rounded-xl flex items-center gap-2 text-sm text-danger">
            <WarningIcon size={14} className="shrink-0" />
            <span>
              旅行文件夹已不在相册目录中（可能被移出或删除），照片无法读取；顶栏删除将只清理这条旅行记录。
            </span>
          </div>
        )}
        {/* 信息卡 */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface rounded-2xl border border-line shadow-sm p-8 mb-10"
        >
          {isEditing ? (
            <div className="space-y-7">
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">标题</label>
                <input
                  type="text"
                  value={editedTrip?.title || ''}
                  onChange={(e) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, title: e.target.value })
                    }
                  }}
                  className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all text-lg"
                  placeholder="输入旅行标题"
                />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">开始日期</label>
                  <DatePicker
                    selected={editedTrip?.startDate ? asDate(editedTrip.startDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({
                          ...editedTrip,
                          startDate: dateToLocalStr(date),
                        })
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="选择开始日期"
                    className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink-2 mb-2">结束日期</label>
                  <DatePicker
                    selected={editedTrip?.endDate ? asDate(editedTrip.endDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({
                          ...editedTrip,
                          endDate: dateToLocalStr(date),
                        })
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="选择结束日期"
                    className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">描述</label>
                <textarea
                  value={editedTrip?.description}
                  onChange={(e) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, description: e.target.value })
                    }
                  }}
                  rows={5}
                  className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all resize-none leading-relaxed"
                  placeholder="记录这次旅行的美好回忆…"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink-2 mb-2">标签</label>
                <TagInput
                  value={editedTrip?.tags ?? []}
                  onChange={(tags) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, tags })
                    }
                  }}
                />
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <h1 className="font-display text-3xl font-bold text-ink mb-3">{trip.title}</h1>
                {trip.isFavorite && (
                  <HeartIcon size={20} filled className="text-primary shrink-0" />
                )}
              </div>
              <div className="flex items-center gap-3 text-sm text-ink-3 mb-4">
                <span className="font-display">
                  {formatDotDate(trip.startDate)} — {formatDotDate(trip.endDate)}
                </span>
                <span>·</span>
                <span>{trip.photos.length} 张照片</span>
              </div>
              {trip.description && (
                <p className="text-ink-2 leading-relaxed mb-4 whitespace-pre-wrap">
                  {trip.description}
                </p>
              )}
              {trip.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {trip.tags.map((tag: string, index: number) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-primary-soft text-primary text-sm rounded-full"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* 照片墙 / 地图 */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="font-display text-2xl font-bold text-ink">照片</h2>
            <div className="flex items-center bg-surface-2 rounded-full p-0.5">
              {(['photos', 'map'] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => setViewMode(mode)}
                  className={`px-3 py-1 rounded-full text-xs transition-colors ${
                    viewMode === mode ? 'bg-surface text-primary shadow-sm' : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {mode === 'photos' ? '照片' : '地图'}
                </button>
              ))}
            </div>
          </div>
          {viewMode === 'photos' && (
            <div className="flex items-center gap-4">
              <span className="text-sm text-ink-3">
                {visiblePhotos.length === photos.length
                  ? `${photos.length} 张`
                  : `${visiblePhotos.length} / ${photos.length} 张`}
              </span>
              <label className="px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 text-sm">
                <PlusIcon size={13} />
                <span>{isUploading ? '导入中…' : '添加照片'}</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  disabled={isUploading}
                />
              </label>
            </div>
          )}
        </div>

        {viewMode === 'photos' ? (
          <>
            {/* 过滤 chips：只看收藏 / 按标签筛选 */}
            {(photoTagList.length > 0 || favOnly) && (
              <div className="flex flex-wrap items-center gap-2 mb-5">
                <button
                  onClick={() => setFavOnly((v) => !v)}
                  className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 transition-colors ${
                    favOnly ? 'bg-primary text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'
                  }`}
                >
                  <HeartIcon size={11} filled={favOnly} />
                  <span>只看收藏</span>
                </button>
                {photoTagList.map((tag) => (
                  <button
                    key={tag}
                    onClick={() => setTagFilter((cur) => (cur === tag ? null : tag))}
                    className={`px-3 py-1 rounded-full text-xs transition-colors ${
                      tagFilter === tag ? 'bg-primary text-white' : 'bg-surface-2 text-ink-2 hover:text-ink'
                    }`}
                  >
                    #{tag}
                  </button>
                ))}
                {(favOnly || tagFilter) && (
                  <button
                    onClick={() => {
                      setFavOnly(false)
                      setTagFilter(null)
                    }}
                    className="px-2.5 py-1 rounded-full text-xs text-ink-3 hover:text-ink flex items-center gap-1"
                  >
                    <XIcon size={10} />
                    <span>清除</span>
                  </button>
                )}
              </div>
            )}
            <PhotoWall
              photos={visiblePhotos}
              onPhotoClick={handlePhotoClick}
              onDeletePhoto={handleDeletePhoto}
              onEditCaption={setCaptionTarget}
              showDeleteButton
              coverPhotoId={editedTrip?.coverPhotoId ?? null}
              onSetCover={handleSetCover}
              onToggleFavorite={handleTogglePhotoFavorite}
            />
          </>
        ) : (
          <MapView photos={photos} onOpenPhoto={handlePhotoClick} />
        )}
      </main>

      {/* 灯箱 */}
      <AnimatePresence>
        {lightboxIndex !== null && photos[lightboxIndex] && (
          <Lightbox
            key="lightbox"
            photos={photos}
            index={lightboxIndex}
            onNavigate={setLightboxIndex}
            onClose={() => setLightboxIndex(null)}
            onDeletePhoto={handleDeletePhoto}
            onEditCaption={setCaptionTarget}
            coverPhotoId={editedTrip?.coverPhotoId ?? null}
            onSetCover={handleSetCover}
            onToggleFavorite={handleTogglePhotoFavorite}
            onEditTags={setTagTarget}
          />
        )}
      </AnimatePresence>

      {/* 图注编辑 */}
      {captionTarget && (
        <CaptionEditor
          key={captionTarget.id}
          photo={captionTarget}
          onClose={() => setCaptionTarget(null)}
          onSaved={handleCaptionSaved}
        />
      )}

      {/* 照片标签编辑 */}
      {tagTarget && (
        <PhotoTagEditor
          key={tagTarget.id}
          photo={tagTarget}
          onClose={() => setTagTarget(null)}
          onSaved={handlePhotoTagsSaved}
        />
      )}
    </div>
  )
}

export default TripPage
