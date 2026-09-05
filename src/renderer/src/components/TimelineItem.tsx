import React from 'react'
import { motion } from 'framer-motion'
import { Trip } from '../types'
import PhotoStack from './PhotoStack'
import { HeartIcon, TrashIcon, WarningIcon } from './icons'

interface TimelineItemProps {
  trip: Trip
  onEdit: (id: string) => void
  onToggleFavorite?: (id: string) => void
  onDelete?: (id: string) => void
}

const TimelineItem: React.FC<TimelineItemProps> = ({ trip, onEdit, onToggleFavorite, onDelete }) => {
  const missing = trip.status === 'missing'
  const formatDate = (dateStr: string) => {
    if (!dateStr) return '——'
    const date = new Date(dateStr)
    if (isNaN(date.getTime())) return dateStr
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
  }

  const getDaysDiff = () => {
    const start = new Date(trip.startDate)
    const end = new Date(trip.endDate)
    if (isNaN(start.getTime()) || isNaN(end.getTime())) return '?'
    const diff = Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    return diff + 1
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="relative flex mb-14"
    >
      {/* 书脊 + 和纸胶带日期贴 */}
      <div className="flex flex-col items-center w-36 shrink-0 relative">
        <div className="washi-label px-3.5 py-1 text-sm whitespace-nowrap z-10 rounded-[3px]">
          {formatDate(trip.startDate)}
        </div>
      </div>

      {/* 拍立得照片堆叠（文件夹缺失时降透明度，点击会触发删除提示而非进入旅行页） */}
      <div className={`ml-6 mr-8 mt-1 ${missing ? 'opacity-40 saturate-50' : ''}`}>
        <PhotoStack trip={trip} onClick={() => onEdit(trip.id)} />
      </div>

      {/* 简介 */}
      <div className="flex-1 min-w-0 mt-1">
        <div className="flex items-center justify-between gap-3 mb-1.5">
          <h3
            className="font-display text-xl font-bold text-ink cursor-pointer hover:text-primary transition-colors truncate"
            onClick={() => onEdit(trip.id)}
          >
            {trip.title}
          </h3>
          <div className="flex items-center gap-1.5 shrink-0">
            {onToggleFavorite && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggleFavorite(trip.id)
                }}
                className={`transition-transform shrink-0 hover:scale-110 ${
                  trip.isFavorite ? 'text-primary' : 'text-ink-3 hover:text-ink-2'
                }`}
                title={trip.isFavorite ? '取消收藏' : '收藏'}
              >
                <HeartIcon size={20} filled={trip.isFavorite} />
              </button>
            )}
            {onDelete && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(trip.id)
                }}
                className="transition-transform shrink-0 hover:scale-110 text-ink-3 hover:text-danger"
                title="删除这次旅行"
              >
                <TrashIcon size={17} />
              </button>
            )}
          </div>
        </div>
        {trip.description && (
          <p className="text-ink-2 text-sm leading-relaxed mb-2.5 line-clamp-3">
            {trip.description}
          </p>
        )}
        <div className="flex items-center gap-3 text-xs text-ink-3">
          <span>{(trip.photos || []).length} 张照片</span>
          <span className="font-display">{getDaysDiff()} 天旅程</span>
          {missing && (
            <span className="px-2 py-0.5 bg-danger/10 text-danger rounded-full flex items-center gap-1">
              <WarningIcon size={10} />
              <span>文件夹已缺失，点击可删除记录</span>
            </span>
          )}
        </div>
        {(trip.tags || []).length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {(trip.tags || []).map((tag, index) => (
              <span
                key={index}
                className="px-2 py-0.5 bg-primary-soft text-primary text-xs rounded-full"
              >
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  )
}

export default TimelineItem
