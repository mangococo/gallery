import React from 'react';
import { motion } from 'framer-motion';
import { Photo } from '../types';

interface PhotoWallProps {
  photos: Photo[];
  onPhotoClick?: (photo: Photo) => void;
  onDeletePhoto?: (photoId: string) => void;
  showDeleteButton?: boolean;
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
        delay: baseDelay,
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
              {photo.type === 'video' ? (
                <div className="relative">
                  <video
                    src={photo.url}
                    className="w-full h-auto"
                    muted
                    preload="metadata"
                  />
                  {/* 播放按钮覆盖层 */}
                  <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                    <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center shadow-lg">
                      <div className="w-0 h-0 border-l-[12px] border-l-primary border-y-[8px] border-y-transparent ml-1"></div>
                    </div>
                  </div>
                </div>
              ) : (
                <img
                  src={photo.url}
                  alt=""
                  className="w-full h-auto"
                  loading="lazy"
                />
              )}
              
              {/* Delete button */}
              {showDeleteButton && onDeletePhoto && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeletePhoto(photo.id);
                  }}
                  className="absolute top-2 right-2 w-8 h-8 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center hover:bg-red-600 text-sm font-bold"
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
