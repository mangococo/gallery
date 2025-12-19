import React from 'react';
import { motion } from 'framer-motion';
import { Trip } from '../types';
import PhotoStack from './PhotoStack';

interface TimelineItemProps {
  trip: Trip;
  onEdit: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
}

const TimelineItem: React.FC<TimelineItemProps> = ({
  trip,
  onEdit,
  onToggleFavorite,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  const getDaysDiff = () => {
    const start = new Date(trip.startDate);
    const end = new Date(trip.endDate);
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    return diff + 1;
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative flex mb-16 bg-transparent"
    >
      {/* 时间线区域 */}
      <div className="flex flex-col items-center w-28 flex-shrink-0 relative">
        {/* 时间标签 - 悬浮在线条上 */}
        <div className="px-3 py-1 bg-background text-xs font-medium text-primary whitespace-nowrap z-10 rounded-full border border-primary/30 shadow-sm">
          {formatDate(trip.startDate)}
        </div>
      </div>

      {/* 照片堆叠 */}
      <div className="ml-8 mr-8 bg-transparent">
        <PhotoStack trip={trip} onClick={() => onEdit(trip.id)} />
      </div>

      {/* 简介区域 */}
      <div className="flex-1 bg-transparent">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-xl font-bold text-text-primary cursor-pointer hover:text-primary transition-colors bg-transparent"
              onClick={() => onEdit(trip.id)}>
            {trip.title}
          </h3>
          {onToggleFavorite && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite(trip.id);
              }}
              className="text-2xl hover:scale-110 transition-transform"
            >
              {trip.isFavorite ? '❤️' : '🤍'}
            </button>
          )}
        </div>
        <p className="text-text-secondary text-sm leading-relaxed mb-3 line-clamp-3 bg-transparent">
          {trip.description}
        </p>
        <div className="flex items-center gap-4 text-xs text-text-tertiary bg-transparent">
          <span>{(trip.photos || []).length} 张照片</span>
          <span>{getDaysDiff()} 天旅程</span>
        </div>
        {(trip.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3 bg-transparent">
            {(trip.tags || []).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
};

export default TimelineItem;
