import React from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import DatePicker from 'react-datepicker'
import 'react-datepicker/dist/react-datepicker.css'
import { api, displaySrc } from '../lib/api'
import { useApp } from '../lib/store'
import PhotoWall from '../components/PhotoWall'
import { Photo, Trip } from '../types'

const TripPage: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { refreshAll } = useApp()
  const [trip, setTrip] = React.useState<Trip | null>(null)
  const [isEditing, setIsEditing] = React.useState(false)
  const [editedTrip, setEditedTrip] = React.useState<Trip | null>(null)
  const [selectedPhoto, setSelectedPhoto] = React.useState<Photo | null>(null)
  const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState<number>(0)
  const [tagInput, setTagInput] = React.useState('')
  const [isUploading, setIsUploading] = React.useState(false)
  const [dragOver, setDragOver] = React.useState(false)

  React.useEffect(() => {
    const loadTrip = async () => {
      const tripData = await api.getTrip(id!)
      setTrip(tripData)
      setEditedTrip(tripData ? { ...tripData, tags: tripData.tags || [] } : null)
      setTagInput((tripData?.tags || []).join(', '))
    }
    loadTrip()
  }, [id])

  const applyUpdate = async (updated: Trip) => {
    setEditedTrip(updated)
    if (!isEditing) setTrip(updated)
  }

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files
    if (!files || files.length === 0 || !trip) return

    setIsUploading(true)
    try {
      const paths = Array.from(files)
        .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/'))
        .map((f) => api.getPathForFile(f))
      const newPhotos = await api.importPhotos(trip.id, paths)
      if (editedTrip && newPhotos.length > 0) {
        await applyUpdate({ ...editedTrip, photos: [...editedTrip.photos, ...newPhotos] })
        await refreshAll()
      }
    } catch (error: any) {
      alert('导入照片失败: ' + error.message)
    }

    setIsUploading(false)
    event.target.value = ''
  }

  /** 拖拽照片进窗口即导入该旅行（方案决策17） */
  const handleDrop = async (event: React.DragEvent) => {
    event.preventDefault()
    setDragOver(false)
    if (!trip || isUploading) return
    const paths = Array.from(event.dataTransfer.files)
      .filter((f) => f.type.startsWith('image/') || f.type.startsWith('video/') || hasMediaExt(f.name))
      .map((f) => api.getPathForFile(f))
      .filter((p) => !!p)
    if (paths.length === 0) return

    setIsUploading(true)
    try {
      const newPhotos = await api.importPhotos(trip.id, paths)
      if (editedTrip && newPhotos.length > 0) {
        await applyUpdate({ ...editedTrip, photos: [...editedTrip.photos, ...newPhotos] })
        await refreshAll()
      }
    } catch (error: any) {
      alert('导入照片失败: ' + error.message)
    }
    setIsUploading(false)
  }

  const handleDeletePhoto = async (photoId: string) => {
    if (editedTrip) {
      const updatedTrip = {
        ...editedTrip,
        photos: editedTrip.photos.filter((p: Photo) => p.id !== photoId),
      }
      await applyUpdate(updatedTrip)
      await api.deletePhoto(photoId)
      await refreshAll()
    }
  }

  const handleSetCover = async (photoId: string) => {
    if (!editedTrip) return
    await api.setCover(editedTrip.id, photoId)
    await applyUpdate({ ...editedTrip, coverPhotoId: photoId })
    await refreshAll()
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
    const photos = editedTrip?.photos || trip?.photos || []
    const index = photos.findIndex((p: Photo) => p.id === photo.id)
    setSelectedPhoto(photo)
    setSelectedPhotoIndex(index)
  }

  const handlePrevPhoto = () => {
    const photos = editedTrip?.photos || trip?.photos || []
    if (photos.length === 0) return
    const newIndex = selectedPhotoIndex > 0 ? selectedPhotoIndex - 1 : photos.length - 1
    setSelectedPhoto(photos[newIndex])
    setSelectedPhotoIndex(newIndex)
  }

  const handleNextPhoto = () => {
    const photos = editedTrip?.photos || trip?.photos || []
    if (photos.length === 0) return
    const newIndex = selectedPhotoIndex < photos.length - 1 ? selectedPhotoIndex + 1 : 0
    setSelectedPhoto(photos[newIndex])
    setSelectedPhotoIndex(newIndex)
  }

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPhoto(null)
      } else if (selectedPhoto) {
        if (e.key === 'ArrowLeft') {
          handlePrevPhoto()
        } else if (e.key === 'ArrowRight') {
          handleNextPhoto()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectedPhoto, selectedPhotoIndex])

  const formatDate = (dateStr: string) => {
    if (!dateStr) return '——'
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  }

  if (!trip) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-ink-3">加载中…</p>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen bg-background"
      onDragOver={(e) => {
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* 顶栏（可拖拽） */}
      <header className="drag-region sticky top-0 z-20 h-12 bg-background/85 backdrop-blur-sm border-b border-line flex items-center justify-between pl-5 pr-5">
        <button
          onClick={() => navigate('/')}
          className="no-drag flex items-center gap-1.5 text-sm text-ink-2 hover:text-primary transition-colors"
        >
          <span>←</span>
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
            <button
              onClick={() => setIsEditing(true)}
              className="px-5 py-1.5 bg-primary text-white rounded-lg text-sm hover:opacity-90 transition-opacity"
            >
              编辑
            </button>
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
                    selected={editedTrip?.startDate ? new Date(editedTrip.startDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({
                          ...editedTrip,
                          startDate: date.toISOString().split('T')[0],
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
                    selected={editedTrip?.endDate ? new Date(editedTrip.endDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({
                          ...editedTrip,
                          endDate: date.toISOString().split('T')[0],
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
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value)
                    if (editedTrip) {
                      setEditedTrip({
                        ...editedTrip,
                        tags: e.target.value.split(',').map((t) => t.trim()).filter((t) => t),
                      })
                    }
                  }}
                  placeholder="用逗号分隔标签"
                  className="w-full px-5 py-3 bg-background border-2 border-line rounded-xl text-ink placeholder-ink-3 focus:outline-none focus:border-primary transition-all"
                />
                {editedTrip?.tags && editedTrip.tags.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-2">
                    {editedTrip.tags.map((tag: string, index: number) => (
                      <span
                        key={index}
                        className="px-3 py-1 bg-primary-soft text-primary text-sm rounded-full"
                      >
                        #{tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-start justify-between gap-4">
                <h1 className="font-display text-3xl font-bold text-ink mb-3">{trip.title}</h1>
                {trip.isFavorite && <span className="text-xl">❤️</span>}
              </div>
              <div className="flex items-center gap-3 text-sm text-ink-3 mb-4">
                <span className="font-display">
                  {formatDate(trip.startDate)} — {formatDate(trip.endDate)}
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

        {/* 照片墙 */}
        <div className="flex items-center justify-between mb-5">
          <h2 className="font-display text-2xl font-bold text-ink">照片</h2>
          <div className="flex items-center gap-4">
            <span className="text-sm text-ink-3">{trip.photos.length} 张</span>
            <label className="px-4 py-2 bg-primary text-white rounded-lg hover:opacity-90 transition-opacity cursor-pointer flex items-center gap-1.5 text-sm">
              <span>＋</span>
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
        </div>
        <PhotoWall
          photos={editedTrip?.photos || trip.photos}
          onPhotoClick={handlePhotoClick}
          onDeletePhoto={handleDeletePhoto}
          showDeleteButton
          coverPhotoId={editedTrip?.coverPhotoId ?? null}
          onSetCover={handleSetCover}
        />
      </main>

      {/* 灯箱 */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
            onClick={() => setSelectedPhoto(null)}
          >
            <button
              onClick={(e) => {
                e.stopPropagation()
                handlePrevPhoto()
              }}
              className="absolute left-8 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-4xl z-10 transition-colors"
            >
              ←
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleNextPhoto()
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-white/80 hover:text-white text-4xl z-10 transition-colors"
            >
              →
            </button>

            <motion.div
              key={selectedPhoto.id}
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.92 }}
              className="h-full flex flex-col items-center justify-center gap-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="min-h-0 flex-1 flex items-center justify-center">
                {selectedPhoto.type === 'video' ? (
                  <video
                    src={selectedPhoto.mediaUrl}
                    controls
                    autoPlay
                    className="max-h-full max-w-full"
                  />
                ) : (
                  <img
                    src={selectedPhoto.mediaUrl}
                    alt={selectedPhoto.caption || ''}
                    className="max-h-full max-w-full object-contain"
                  />
                )}
              </div>
              {selectedPhoto.caption && (
                <p className="text-white/70 text-sm">{selectedPhoto.caption}</p>
              )}
            </motion.div>

            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-6 right-8 text-white/80 hover:text-white text-3xl transition-colors"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function hasMediaExt(name: string): boolean {
  return /\.(jpe?g|png|gif|bmp|webp|heic|tiff|mp4|m4v|mov|avi|mkv|webm)$/i.test(name)
}

export default TripPage
