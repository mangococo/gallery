import React from 'react';
import { motion } from 'framer-motion';

interface TimelineAddButtonProps {
  onAdd: () => void;
}

const TimelineAddButton: React.FC<TimelineAddButtonProps> = ({ onAdd }) => {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <div
      className="relative flex items-center mb-16 cursor-pointer"
      style={{ minHeight: '80px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onClick={onAdd}
    >
      {/* 左侧时间线区域 - 整个区域都可以悬停 */}
      <div className="flex flex-col items-center w-28 flex-shrink-0 relative">
        {/* + 号 - 精确定位在时间线上并完全居中 */}
        {isHovered && (
          <motion.div
            initial={{ opacity: 0, scale: 0.5 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.5 }}
            className="absolute w-10 h-10 rounded-full border-2 border-dashed border-primary bg-background flex items-center justify-center text-primary font-bold shadow-md z-10 pointer-events-none"
            style={{ 
              left: '36px', // 精确居中在时间线上 (56px - 20px)
              top: '50%',
              transform: 'translateY(-50%)',
              fontSize: '20px',
              lineHeight: '1'
            }}
            whileHover={{ scale: 1.15 }}
          >
            +
          </motion.div>
        )}
      </div>

      {/* 提示文字 - 与圆圈水平对齐 */}
      {isHovered && (
        <motion.div
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -10 }}
          className="ml-8 text-text-tertiary text-sm"
        >
          点击添加新旅行
        </motion.div>
      )}
    </div>
  );
};

export default TimelineAddButton;
