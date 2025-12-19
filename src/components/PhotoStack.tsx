import React from 'react';
import { motion } from 'framer-motion';
import { Trip } from '../types';

interface PhotoStackProps {
  trip: Trip;
  onClick: () => void;
}

const PhotoStack: React.FC<PhotoStackProps> = ({ trip, onClick }) => {
  const [isHovered, setIsHovered] = React.useState(false);
  const displayPhotos = trip.photos.slice(0, 9);

  return (
    <div
      className="relative w-56 h-40 cursor-pointer"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onClick}
    >
      {!isHovered ? (
        // 堆叠状态
        <div className="relative w-full h-full">
          {displayPhotos.slice(0, 4).map((photo, index) => (
            <motion.div
              key={`stacked-${photo.id}`}
              className="absolute inset-0"
              style={{
                zIndex: index,
              }}
              animate={{
                rotate: index * 3 - 4.5,
                x: index * 8,
                y: index * 4,
                scale: 1,
              }}
              transition={{ 
                duration: 0.4,
                ease: "easeOut"
              }}
            >
              {photo.type === 'video' ? (
                <video
                  src={photo.url}
                  className="w-full h-full object-cover rounded-lg shadow-lg"
                  muted
                />
              ) : (
                <img
                  src={photo.thumbnail}
                  alt=""
                  className="w-full h-full object-cover rounded-lg shadow-lg"
                />
              )}
            </motion.div>
          ))}
        </div>
      ) : (
        // 散开状态
        <div className="grid grid-cols-3 gap-2 w-full h-full">
          {displayPhotos.map((photo, index) => (
            <motion.div
              key={`spread-${photo.id}`}
              initial={{ 
                scale: 0.8,
                rotate: (index % 2 === 0 ? -1 : 1) * 15,
                opacity: 0
              }}
              animate={{ 
                scale: 1, 
                rotate: 0,
                opacity: 1
              }}
              transition={{
                duration: 0.3,
                delay: index * 0.02,
                ease: "easeOut"
              }}
              className="relative overflow-hidden rounded-md shadow-md"
            >
              {photo.type === 'video' ? (
                <video
                  src={photo.url}
                  className="w-full h-full object-cover"
                  muted
                />
              ) : (
                <img
                  src={photo.thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                />
              )}
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
};

export default PhotoStack;
