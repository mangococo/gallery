import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Trip } from '../types';

interface FilterBarProps {
  trips: Trip[];
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
  timeRange: [number, number];
  onTimeRangeChange: (range: [number, number]) => void;
  showFavoritesOnly: boolean;
  onShowFavoritesChange: (show: boolean) => void;
}

const FilterBar: React.FC<FilterBarProps> = ({
  trips,
  selectedTags,
  onTagsChange,
  timeRange,
  onTimeRangeChange,
  showFavoritesOnly,
  onShowFavoritesChange,
}) => {
  const [showFilters, setShowFilters] = React.useState(false);

  // 获取所有唯一标签
  const allTags = React.useMemo(() => {
    const tagSet = new Set<string>();
    (trips || []).forEach((trip) => {
      (trip.tags || []).forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [trips]);

  // 获取时间范围（以天为单位）
  const timelineDays = React.useMemo(() => {
    if (!trips || trips.length === 0) return { totalDays: 0, startTimestamp: 0, endTimestamp: 0, formatDate: () => '', getTimestamp: () => 0 };

    const dates = trips.map(trip => new Date(trip.startDate)).filter(d => !isNaN(d.getTime()));
    if (dates.length === 0) return { totalDays: 0, startTimestamp: 0, endTimestamp: 0, formatDate: () => '', getTimestamp: () => 0 };
    
    const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

    // 设置为当天的开始时间
    const startDay = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
    const endDay = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());

    const totalDays = Math.ceil((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;

    return {
      startTimestamp: startDay.getTime(),
      endTimestamp: endDay.getTime(),
      totalDays,
      formatDate: (dayIndex: number) => {
        const date = new Date(startDay.getTime() + dayIndex * 24 * 60 * 60 * 1000);
        return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
      },
      getTimestamp: (dayIndex: number) => {
        return startDay.getTime() + dayIndex * 24 * 60 * 60 * 1000;
      }
    };
  }, [trips]);

  const handleTagToggle = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onTagsChange(selectedTags.filter((t) => t !== tag));
    } else {
      onTagsChange([...selectedTags, tag]);
    }
  };

  const handleTimeRangeChange = (dayIndex: number, isStart: boolean) => {
    if (isStart) {
      onTimeRangeChange([dayIndex, Math.max(dayIndex, timeRange[1])]);
    } else {
      onTimeRangeChange([Math.min(timeRange[0], dayIndex), dayIndex]);
    }
  };

  const clearFilters = () => {
    onTagsChange([]);
    onTimeRangeChange([0, timelineDays.totalDays - 1]);
    onShowFavoritesChange(false);
  };

  const hasActiveFilters =
    selectedTags.length > 0 ||
    timeRange[0] !== 0 ||
    timeRange[1] !== timelineDays.totalDays - 1 ||
    showFavoritesOnly;

  if (!trips || trips.length === 0) return null;

  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-2 px-4 py-2 bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow border border-primary/20"
        >
          <span className="text-primary">筛选</span>
          {hasActiveFilters && (
            <span className="w-2 h-2 bg-primary rounded-full"></span>
          )}
          <span className={`text-primary transition-transform ${showFilters ? 'rotate-180' : ''}`}>
            ▼
          </span>
        </button>

        {hasActiveFilters && (
          <button
            onClick={clearFilters}
            className="text-sm text-text-tertiary hover:text-primary transition-colors"
          >
            清除筛选
          </button>
        )}
      </div>

      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="overflow-hidden"
          >
            <div className="bg-white rounded-xl shadow-md p-6 space-y-6">
              {/* 爱心筛选 */}
              <div>
                <h3 className="text-base font-medium text-secondary mb-3">
                  筛选
                </h3>
                <button
                  onClick={() => onShowFavoritesChange(!showFavoritesOnly)}
                  className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                    showFavoritesOnly
                      ? 'bg-red-100 text-red-600 shadow-md'
                      : 'bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-500'
                  }`}
                >
                  ❤️ 只看收藏
                </button>
              </div>

              {/* 标签筛选 */}
              {allTags.length > 0 && (
                <div>
                  <h3 className="text-base font-medium text-secondary mb-3">
                    标签
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {allTags.map((tag) => {
                      const isSelected = selectedTags.includes(tag);
                      return (
                        <button
                          key={tag}
                          onClick={() => handleTagToggle(tag)}
                          className={`px-3 py-1.5 rounded-full text-sm transition-all ${
                            isSelected
                              ? 'bg-primary text-white shadow-md'
                              : 'bg-primary/10 text-primary hover:bg-primary/20 border border-primary/30'
                          }`}
                        >
                          #{tag}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* 时间范围筛选 */}
              {timelineDays.totalDays > 1 && (
                <div>
                  <h3 className="text-base font-medium text-secondary mb-3">
                    时间范围
                  </h3>
                  <div className="space-y-4">
                    <div className="flex items-center gap-4 text-sm text-text-secondary">
                      <span>{timelineDays.formatDate(timeRange[0])}</span>
                      <span>-</span>
                      <span>{timelineDays.formatDate(timeRange[1])}</span>
                    </div>

                    {/* 双滑块 */}
                    <div className="relative pt-2 pb-6">
                      {/* 轨道 */}
                      <div className="absolute top-2 left-0 right-0 h-2 bg-gray-200 rounded-full" />

                      {/* 选中区域 */}
                      <div
                        className="absolute top-2 h-2 bg-primary rounded-full"
                        style={{
                          left: `${(timeRange[0] / (timelineDays.totalDays - 1)) * 100}%`,
                          right: `${((timelineDays.totalDays - 1 - timeRange[1]) / (timelineDays.totalDays - 1)) * 100}%`,
                        }}
                      />

                      {/* 开始滑块区域 - 左半部分 */}
                      <div 
                        className="absolute top-0 left-0 h-6 cursor-pointer"
                        style={{ 
                          width: `${50 + (timeRange[0] / (timelineDays.totalDays - 1)) * 25}%`,
                          zIndex: 5 
                        }}
                      >
                        <input
                          type="range"
                          min={0}
                          max={timelineDays.totalDays - 1}
                          value={timeRange[0]}
                          onChange={(e) =>
                            handleTimeRangeChange(parseInt(e.target.value), true)
                          }
                          className="w-full h-6 opacity-0 cursor-pointer"
                        />
                      </div>

                      {/* 结束滑块区域 - 右半部分 */}
                      <div 
                        className="absolute top-0 right-0 h-6 cursor-pointer"
                        style={{ 
                          width: `${50 + ((timelineDays.totalDays - 1 - timeRange[1]) / (timelineDays.totalDays - 1)) * 25}%`,
                          zIndex: 5 
                        }}
                      >
                        <input
                          type="range"
                          min={0}
                          max={timelineDays.totalDays - 1}
                          value={timeRange[1]}
                          onChange={(e) =>
                            handleTimeRangeChange(parseInt(e.target.value), false)
                          }
                          className="w-full h-6 opacity-0 cursor-pointer"
                        />
                      </div>

                      {/* 滑块指示器 */}
                      <div
                        className="absolute top-0 w-6 h-6 bg-primary rounded-full shadow-md border-4 border-white transition-transform hover:scale-110"
                        style={{
                          left: `calc(${(timeRange[0] / (timelineDays.totalDays - 1)) * 100}% - 12px)`,
                          pointerEvents: 'none',
                          zIndex: 15,
                        }}
                      />
                      <div
                        className="absolute top-0 w-6 h-6 bg-secondary rounded-full shadow-md border-4 border-white transition-transform hover:scale-110"
                        style={{
                          left: `calc(${(timeRange[1] / (timelineDays.totalDays - 1)) * 100}% - 12px)`,
                          pointerEvents: 'none',
                          zIndex: 16,
                        }}
                      />

                      {/* 刻度标记 */}
                      <div className="absolute top-8 left-0 right-0 text-xs text-text-tertiary">
                        <span
                          className="absolute"
                          style={{
                            left: `${(timeRange[0] / (timelineDays.totalDays - 1)) * 100}%`,
                            transform: 'translateX(-50%)',
                          }}
                        >
                          {timelineDays.formatDate(timeRange[0])}
                        </span>
                        <span
                          className="absolute"
                          style={{
                            left: `${(timeRange[1] / (timelineDays.totalDays - 1)) * 100}%`,
                            transform: 'translateX(-50%)',
                          }}
                        >
                          {timelineDays.formatDate(timeRange[1])}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default FilterBar;
