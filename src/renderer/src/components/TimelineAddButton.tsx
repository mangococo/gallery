import React from 'react'
import { motion } from 'framer-motion'

interface TimelineAddButtonProps {
  onAdd: () => void
}

/** 时间线项之间的添加按钮：悬停时在书脊上浮现虚线圆点 */
const TimelineAddButton: React.FC<TimelineAddButtonProps> = ({ onAdd }) => {
  const [isHovered, setIsHovered] = React.useState(false)

  return (
    <div
      className="relative flex items-center mb-14 cursor-pointer"
      style={{ minHeight: '72px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onAdd}
    >
      <div className="flex flex-col items-center w-36 shrink-0 relative">
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute w-9 h-9 rounded-full border-2 border-dashed border-primary bg-background flex items-center justify-center text-primary font-bold shadow-sm z-10 pointer-events-none"
            style={{
              left: 'calc(50% - 18px)',
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '18px',
              lineHeight: '1',
            }}
          >
            +
          </motion.div>
        )}
      </div>

      {isHovered && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="ml-6 text-ink-3 text-sm"
        >
          在这里添一次旅行
        </motion.div>
      )}
    </div>
  )
}

export default TimelineAddButton
