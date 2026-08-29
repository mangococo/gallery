import React from 'react';
import { motion } from 'framer-motion';
import { Photo, PhotoDTO } from '../types';
import { displaySrc } from '../lib/api';

interface PhotoWallProps {
  photos: Photo[];
  onPhotoClick?: (photo: Photo) => void;
  onDeletePhoto?: (photoId: string) => void;
  showDeleteButton?: boolean;
}

/** 照片墙单元：图片用缩略图；视频用海报帧 + 播放角标 */
function WallMedia({ photo }: { photo: PhotoDTO }) {
  const src = displaySrc(photo);
  if (photo.type === 'video' && !src) {
    return (
      <div className="relative">
        <video src={photo.mediaUrl} className="w-full h-auto" muted preload="metadata" />
        <PlayBadge />
      </div>
    );
  }
  if (photo.type === 'video') {
    return (
      <div className="relative aspect-[4/3]">
        <img src={src} alt="" className="w-full h-full object-cover" loading="lazy" />
        <PlayBadge />
      </div>
    );
  }
  return <img src={src} alt="" className="w-full h-auto" loading="lazy" />;
}

function PlayBadge() {
  return (
    <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
      <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
        <div className="w-0 h-0 border-l-[12px] border-l-primary border-y-[8px] border-y-transparent ml-1"></div>
      </div>
    </div>
  );
}

const PhotoWall: React.FC<PhotoWallProps> = ({
  photos,
  onPhotoClick,
  onDeletePhoto,
  showDeleteButton = false
}) => {
  // 为每张照片生成随机的动画参数
  const getRandomAnimation = (index: number) => {
    const baseDelay = index * 0.1;
    return {
      initial: { opacity: 0, scale: 0.8, rotate: Math.random() * 10 - 5 },
      animate: {
        opacity: 1,
        scale: 1,
        rotate: 0,
      },
      transition: {
        duration: 0.6,
        delay: Math.min(baseDelay, 1.5),
      },
    };
  };

  // 风吹动画
  const swayAnimation = () => {
    const duration = 3 + Math.random() * 2;
    const delay = Math.random() * 2;
    return {
      animate: {
        rotate: [0, 0.8, -0.8, 0],
        y: [0, -3, 3, 0],
      },
      transition: {
        duration,
        delay,
        repeat: Infinity,
        ease: 'easeInOut',
      },
    };
  };

  return (
    <div className="columns-1 sm:columns-2 lg:columns-3 gap-4 space-y-4">
      {photos.map((photo, index) => {
        const animation = getRandomAnimation(index);
        const sway = swayAnimation();

        return (
          <motion.div
            key={photo.id}
            {...animation}
            whileHover={{ scale: 1.05, zIndex: 10 }}
            className="break-inside-avoid cursor-pointer relative group"
            onClick={() => onPhotoClick?.(photo)}
          >
            <motion.div
              {...sway}
              className="relative overflow-hidden rounded-lg shadow-lg hover:shadow-2xl transition-shadow"
            >
              <WallMedia photo={photo} />

              {/* Delete button */}
              {showDeleteButton && onDeletePhoto && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePhoto(photo.id);
                  }}
                  className="absolute top-2 right-2 w-8 h-8 bg-danger text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:opacity-80 text-sm font-bold"
                >
                  ×
                </button>
              )}
            </motion.div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default PhotoWall;
