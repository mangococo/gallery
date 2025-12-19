import React from 'react';
import { useNavigate } from 'react-router-dom';
import { storageService } from '../storage';
import { Trip } from '../types';
import TimelineItem from '../components/TimelineItem';
import TimelineAddButton from '../components/TimelineAddButton';
import AddTripModal from '../components/AddTripModal';
import FilterBar from '../components/FilterBar';
import SettingsModal from '../components/SettingsModal';
import AuthModal from '../components/AuthModal';

const HomePage: React.FC = () => {
  const navigate = useNavigate();
  const [allTrips, setAllTrips] = React.useState<Trip[]>([]);
  const [showAddModal, setShowAddModal] = React.useState(false);
  const [showSettingsModal, setShowSettingsModal] = React.useState(false);
  const [needsAuth, setNeedsAuth] = React.useState(false);
  const [showAuthModal, setShowAuthModal] = React.useState(false);

  // 加载旅行数据
  React.useEffect(() => {
    const loadTrips = async () => {
      const storagePath = storageService.getStoragePath();
      if (storagePath) {
        const hasAccess = await storageService.hasDirectoryAccess();
        if (!hasAccess) {
          setNeedsAuth(true);
          setShowAuthModal(true);
          return;
        }
        
        const trips = await storageService.getTrips();
        setAllTrips(trips);
      }
    };
    loadTrips();
  }, []);

  const handleAuthorizeAccess = async () => {
    try {
      await storageService.requestDirectoryAccess();
      setNeedsAuth(false);
      setShowAuthModal(false);
      const trips = await storageService.getTrips();
      setAllTrips(trips);
    } catch (error) {
      // User cancelled authorization
    }
  };

  const handleStoragePathChanged = async () => {
    const trips = await storageService.getTrips();
    setAllTrips(trips);
  };

  // 筛选状态
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const [timeRange, setTimeRange] = React.useState<[number, number]>([0, 0]);
  const [showFavoritesOnly, setShowFavoritesOnly] = React.useState(false);

  // 初始化时间范围
  React.useEffect(() => {
    if (allTrips && allTrips.length > 0) {
      const dates = allTrips.map(trip => new Date(trip.startDate)).filter(d => !isNaN(d.getTime()));
      if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

        const startDay = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
        const endDay = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
        const totalDays = Math.ceil((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        setTimeRange([0, totalDays - 1]);
      }
    }
  }, [allTrips]);

  // 应用筛选和排序
  const filteredTrips = React.useMemo(() => {
    let filtered = [...allTrips];

    // 按开始日期倒序排序（最新的在前）
    filtered.sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime());

    // 标签筛选
    if (selectedTags.length > 0) {
      filtered = filtered.filter((trip) =>
        (trip.tags || []).some((tag) => selectedTags.includes(tag))
      );
    }

    // 爱心筛选
    if (showFavoritesOnly) {
      filtered = filtered.filter((trip) => trip.isFavorite);
    }

    // 时间范围筛选
    if (allTrips && allTrips.length > 0) {
      const dates = allTrips.map(trip => new Date(trip.startDate)).filter(d => !isNaN(d.getTime()));
      if (dates.length > 0) {
        const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
        const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

        const startDay = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
        const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;

        if (totalDays > 0) {
        const startTime = startDay.getTime() + timeRange[0] * 24 * 60 * 60 * 1000;
        const endTime = startDay.getTime() + timeRange[1] * 24 * 60 * 60 * 1000;

          filtered = filtered.filter((trip) => {
            const tripTime = new Date(trip.startDate);
            const tripDayStart = new Date(tripTime.getFullYear(), tripTime.getMonth(), tripTime.getDate()).getTime();
            return tripDayStart >= startTime && tripDayStart <= endTime;
          });
        }
      }
    }

    return filtered;
  }, [allTrips, selectedTags, timeRange, showFavoritesOnly]);

  const handleEdit = (id: string) => {
    navigate(`/trip/${id}`);
  };

  const handleAddTrip = () => {
    setShowAddModal(true);
  };

  const handleTripAdded = async () => {
    const trips = await storageService.getTrips();
    setAllTrips(trips);
  };

  const handleToggleFavorite = async (tripId: string) => {
    const updatedTrips = allTrips.map(trip => 
      trip.id === tripId 
        ? { ...trip, isFavorite: !trip.isFavorite }
        : trip
    );
    setAllTrips(updatedTrips);
    
    // 保存到存储
    const tripToUpdate = updatedTrips.find(trip => trip.id === tripId);
    if (tripToUpdate) {
      await storageService.updateTrip(tripToUpdate);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-background/80 backdrop-blur-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-8 py-6 flex items-center justify-between">
          <h1 className="text-3xl font-bold text-primary">画廊</h1>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-6 text-sm text-text-tertiary">
              <span>{filteredTrips.length} 次旅行</span>
              <span>{filteredTrips.reduce((acc, t) => acc + (t.photos || []).length, 0)} 张照片</span>
            </div>
            <button
              onClick={() => setShowSettingsModal(true)}
              className="p-2 text-text-tertiary hover:text-primary transition-colors"
              title="系统设置"
            >
              ⚙️
            </button>
          </div>
        </div>
      </header>

      {/* Timeline */}
      <main className="max-w-7xl mx-auto px-8 py-12">
        {/* Filter Bar */}
        <FilterBar
          trips={allTrips}
          selectedTags={selectedTags}
          onTagsChange={setSelectedTags}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          showFavoritesOnly={showFavoritesOnly}
          onShowFavoritesChange={setShowFavoritesOnly}
        />

        {/* Timeline Container with continuous line */}
        <div className="relative">
          {/* 连续的时间线 */}
          {filteredTrips.length > 0 && (
            <div
              className="absolute left-14 top-2 bottom-0 w-0.5 bg-gray-300"
              style={{ height: 'calc(100% - 80px)' }}
            />
          )}

          {/* Timeline Items with Add Buttons */}
          <div className="relative">
            {filteredTrips.map((trip, index) => (
              <React.Fragment key={trip.id}>
                {/* Add Button before each trip (except first) */}
                {index > 0 && <TimelineAddButton key={`add-${index}`} onAdd={handleAddTrip} />}

                {/* Trip Item */}
                <TimelineItem trip={trip} onEdit={handleEdit} onToggleFavorite={handleToggleFavorite} />
              </React.Fragment>
            ))}

            {/* Add Button at the end */}
            {filteredTrips.length > 0 && <TimelineAddButton key="add-end" onAdd={handleAddTrip} />}
          </div>

          {/* Empty states */}
          {filteredTrips.length === 0 && allTrips.length > 0 && (
            <div className="text-center py-20">
              <p className="text-text-tertiary mb-6">没有符合筛选条件的旅行</p>
              <button
                onClick={() => {
                  setSelectedTags([]);
                  setShowFavoritesOnly(false);
                  if (allTrips && allTrips.length > 0) {
                    const dates = allTrips.map(trip => new Date(trip.startDate)).filter(d => !isNaN(d.getTime()));
                    if (dates.length > 0) {
                      const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
                      const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));

                      const startDay = new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate());
                      const endDay = new Date(maxDate.getFullYear(), maxDate.getMonth(), maxDate.getDate());
                      const totalDays = Math.ceil((endDay.getTime() - startDay.getTime()) / (1000 * 60 * 60 * 24)) + 1;

                      setTimeRange([0, totalDays - 1]);
                    }
                  }
                }}
                className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
              >
                清除筛选
              </button>
            </div>
          )}

          {allTrips.length === 0 && !needsAuth && (
            <div className="text-center py-20">
              {!storageService.getStoragePath() ? (
                <>
                  <p className="text-text-tertiary mb-6">
                    {window.location.protocol === 'file:' 
                      ? '请在设置中选择当前 HTML 文件所在的目录作为存储目录' 
                      : '请先设置存储目录'}
                  </p>
                  <button
                    onClick={() => setShowSettingsModal(true)}
                    className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
                  >
                    打开设置
                  </button>
                </>
              ) : (
                <>
                  <p className="text-text-tertiary mb-6">还没有旅行记录</p>
                  <button
                    onClick={handleAddTrip}
                    className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
                  >
                    创建第一次旅行
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </main>

      {/* Add Trip Modal */}
      {showAddModal && (
        <AddTripModal
          onClose={() => setShowAddModal(false)}
          onSuccess={handleTripAdded}
        />
      )}

      {/* Settings Modal */}
      {showSettingsModal && (
        <SettingsModal
          onClose={() => setShowSettingsModal(false)}
          onStoragePathChanged={handleStoragePathChanged}
        />
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal
          onClose={() => setShowAuthModal(false)}
          onAuthorize={handleAuthorizeAccess}
        />
      )}
    </div>
  );
};

export default HomePage;
