import React from 'react'
import { motion } from 'framer-motion'
import { Photo, PhotoDTO } from '../types'
import { displaySrc } from '../lib/api'
import { confirmDialog } from './feedback'
import { HeartIcon, PenIcon, StarIcon, TrashIcon } from './icons'

interface PhotoWallProps {
  photos: Photo[]
  onPhotoClick?: (photo: Photo) => void
  onDeletePhoto?: (photoId: string) => void
  onEditCaption?: (photo: Photo) => void
  showDeleteButton?: boolean
  coverPhotoId?: string | null
  onSetCover?: (photoId: string) => void
  /** 照片级收藏开关（悬停心形按钮） */
  onToggleFavorite?: (photoId: string, favorite: boolean) => void
}

/** 照片墙单元：图片用缩略图；视频用海报帧 + 播放角标 */
function WallMedia({ photo }: { photo: PhotoDTO }) {
  const src = displaySrc(photo)
  if (photo.type === 'video' && !src) {
    return (
      <div className="relative aspect-[4/3]">
        <PlaceholderBackdrop />
        <PlayBadge />
      </div>
    )
  }
  if (photo.type === 'video') {
    return (
      <div className="relative aspect-[4/3]">
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        <PlayBadge />
      </div>
    )
  }
  return <img src={src} alt="" className="w-full h-auto" loading="lazy" />
}

function PlaceholderBackdrop() {
  return (
    <div className="absolute inset-0 bg-surface-2 flex items-center justify-center">
      <span className="font-display text-ink-3 text-xs">视频海报生成中…</span>
    </div>
  )
}

function PlayBadge() {
  return (
    <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
      <div className="w-14 h-14 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
        <div className="w-0 h-0 border-l-[11px] border-l-primary border-y-[7px] border-y-transparent ml-1"></div>
      </div>
    </div>
  )
}

const PhotoWall: React.FC<PhotoWallProps> = ({
  photos,
  onPhotoClick,
  onDeletePhoto,
  onEditCaption,
  showDeleteButton = false,
  coverPhotoId = null,
  onSetCover,
  onToggleFavorite,
}) => {
  const handleDelete = async (photo: Photo) => {
    const ok = await confirmDialog({
      title: '把这张照片移入废纸篓？',
      body: photo.fileName,
      confirmText: '移入废纸篓',
      danger: true,
    })
    if (ok) onDeletePhoto?.(photo.id)
  }

  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
      {photos.map((photo, index) => (
        <motion.div
          key={photo.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: Math.min(index * 0.05, 0.8) }}
          whileHover={{ scale: 1.03, zIndex: 10 }}
          className="break-inside-avoid cursor-pointer relative group"
          onClick={() => onPhotoClick?.(photo)}
        >
          <div className="relative overflow-hidden rounded-xl shadow-md hover:shadow-xl transition-shadow border border-line">
            <WallMedia photo={photo} />

            {/* 封面/收藏徽标 */}
            {coverPhotoId === photo.id && (
              <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-primary text-white text-xs shadow-sm flex items-center gap-1">
                <StarIcon size={10} filled />
                <span>封面</span>
              </div>
            )}
            {photo.favorite && (
              <div
                className={`absolute top-2 ${coverPhotoId === photo.id ? 'left-[64px]' : 'left-2'} px-1.5 py-0.5 rounded-full bg-danger text-white shadow-sm flex items-center`}
                title="已收藏"
              >
                <HeartIcon size={10} filled />
              </div>
            )}

            {/* 悬停操作 */}
            <div className="absolute top-2 right-2 flex gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
              {onToggleFavorite && (
                <button
                  title={photo.favorite ? '取消收藏' : '收藏'}
                  onClick={(e) => {
                    e.stopPropagation()
                    onToggleFavorite(photo.id, !photo.favorite)
                  }}
                  className={`w-7 h-7 rounded-full hover:bg-danger transition-colors flex items-center justify-center ${
                    photo.favorite ? 'bg-danger/80 text-white' : 'bg-black/45 text-white'
                  }`}
                >
                  <HeartIcon size={13} filled={photo.favorite} />
                </button>
              )}
              {onEditCaption && (
                <button
                  title="编辑图注"
                  onClick={(e) => {
                    e.stopPropagation()
                    onEditCaption(photo)
                  }}
                  className="w-7 h-7 bg-black/45 text-white rounded-full hover:bg-primary transition-colors flex items-center justify-center"
                >
                  <PenIcon size={13} />
                </button>
              )}
              {onSetCover && coverPhotoId !== photo.id && (
                <button
                  title="设为封面"
                  onClick={(e) => {
                    e.stopPropagation()
                    onSetCover(photo.id)
                  }}
                  className="w-7 h-7 bg-black/45 text-white rounded-full hover:bg-primary transition-colors flex items-center justify-center"
                >
                  <StarIcon size={13} filled />
                </button>
              )}
              {showDeleteButton && onDeletePhoto && (
                <button
                  title="删除（移入废纸篓）"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(photo)
                  }}
                  className="w-7 h-7 bg-black/45 text-white rounded-full hover:bg-danger transition-colors flex items-center justify-center"
                >
                  <TrashIcon size={13} />
                </button>
              )}
            </div>

            {/* 图注：点击直接编辑 */}
            {photo.caption && (
              <div
                role="button"
                title={onEditCaption ? '点击编辑图注' : undefined}
                onClick={(e) => {
                  if (!onEditCaption) return
                  e.stopPropagation()
                  onEditCaption(photo)
                }}
                className={`px-3 py-2 bg-surface text-xs text-ink-2 ${
                  onEditCaption ? 'cursor-text hover:text-ink' : ''
                }`}
              >
                {photo.caption}
              </div>
            )}
          </div>
        </motion.div>
      ))}
    </div>
  )
}

export default PhotoWall
