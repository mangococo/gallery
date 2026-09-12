import React from 'react'
import { motion } from 'framer-motion'
import { Trip, PhotoDTO } from '../types'
import { displaySrc } from '../lib/api'
import { coverFirstOrder } from '../lib/media'

interface PhotoStackProps {
  trip: Trip
  onClick: () => void
}

/** 堆叠/网格内的媒体缩略块：视频优先用已生成的海报帧 */
function StackMedia({ photo, className }: { photo: PhotoDTO; className?: string }) {
  const src = displaySrc(photo)
  // 缩略图未就绪（图片/视频同理）：占位块，绝不回退原图（#3 首扫卡死根因）
  if (!src) {
    return (
      <div className="absolute inset-0 bg-surface-2 flex items-center justify-center">
        <span className="font-display text-[10px] text-ink-3">生成中…</span>
      </div>
    )
  }
  return <img src={src} alt="" className={className} loading="lazy" />
}

const PhotoStack: React.FC<PhotoStackProps> = ({ trip, onClick }) => {
  const [isHovered, setIsHovered] = React.useState(false)
  // 封面优先：「设为封面」在时间线卡片上立即生效（此前堆叠永远按导入顺序，封面只改徽标）
  const displayPhotos = coverFirstOrder(trip.photos, trip.coverPhotoId).slice(0, 9)

  return (
    <div
      className="relative w-56 h-40 cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {!isHovered ? (
        // 堆叠状态：拍立得白边斜叠，封面在最上层
        <div className="relative w-full h-full">
          {displayPhotos.length === 0 && (
            <div className="polaroid-frame absolute inset-0 flex items-center justify-center">
              <span className="font-display text-xs text-ink-3">还没有照片</span>
            </div>
          )}
          {displayPhotos.slice(0, 4).map((photo, index) => (
            <motion.div
              key={`stacked-${photo.id}`}
              className="polaroid-frame absolute inset-0"
              // 封面（index 0）z 最高盖在最上；旋转/位移保持斜叠节奏
              style={{ zIndex: 4 - index }}
              animate={{
                rotate: index * 3 - 4.5,
                x: index * 8,
                y: index * 4,
                scale: 1,
              }}
              transition={{
                duration: 0.4,
                ease: 'easeOut',
              }}
            >
              <StackMedia
                photo={photo}
                className="w-full h-full object-cover rounded-[3px]"
              />
            </motion.div>
          ))}
        </div>
      ) : (
        // 散开状态
        <div className="grid grid-cols-3 gap-1.5 w-full h-full">
          {displayPhotos.length === 0 && (
            <div className="col-span-3 flex items-center justify-center rounded-md bg-surface border border-dashed border-line">
              <span className="font-display text-xs text-ink-3">还没有照片</span>
            </div>
          )}
          {displayPhotos.map((photo, index) => (
            <motion.div
              key={`spread-${photo.id}`}
              initial={{
                scale: 0.8,
                rotate: (index % 2 === 0 ? -1 : 1) * 15,
                opacity: 0,
              }}
              animate={{
                scale: 1,
                rotate: 0,
                opacity: 1,
              }}
              transition={{
                duration: 0.3,
                delay: index * 0.02,
                ease: 'easeOut',
              }}
              className="relative overflow-hidden rounded-md shadow-md bg-surface"
            >
              <StackMedia photo={photo} className="w-full h-full object-cover" />
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}

export default PhotoStack
