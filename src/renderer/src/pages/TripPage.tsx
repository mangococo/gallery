import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { api } from '../lib/api';
import PhotoWall from '../components/PhotoWall';
import { Photo, Trip } from '../types';

const TripPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [trip, setTrip] = React.useState<Trip | null>(null);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editedTrip, setEditedTrip] = React.useState<Trip | null>(null);
  const [selectedPhoto, setSelectedPhoto] = React.useState<Photo | null>(null);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = React.useState<number>(0);
  const [tagInput, setTagInput] = React.useState('');
  const [isUploading, setIsUploading] = React.useState(false);

  React.useEffect(() => {
    const loadTrip = async () => {
      const tripData = await api.getTrip(id!);
      setTrip(tripData);
      setEditedTrip(tripData ? { ...tripData, tags: tripData.tags || [] } : null);
      setTagInput((tripData?.tags || []).join(', '));
    };
    loadTrip();
  }, [id]);

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0 || !trip) return;

    setIsUploading(true);
    try {
      const paths = Array.from(files)
        .filter(f => f.type.startsWith('image/') || f.type.startsWith('video/'))
        .map(f => api.getPathForFile(f));
      const newPhotos = await api.importPhotos(trip.id, paths);
      if (editedTrip && newPhotos.length > 0) {
        const updatedTrip = { ...editedTrip, photos: [...editedTrip.photos, ...newPhotos] };
        setEditedTrip(updatedTrip);
        if (!isEditing) setTrip(updatedTrip);
      }
    } catch (error: any) {
      alert('导入照片失败: ' + error.message);
    }

    setIsUploading(false);
    event.target.value = '';
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (editedTrip) {
      const updatedTrip = {
        ...editedTrip,
        photos: editedTrip.photos.filter((p: Photo) => p.id !== photoId),
      };
      setEditedTrip(updatedTrip);
      if (!isEditing) {
        await api.deletePhoto(photoId);
        setTrip(updatedTrip);
      }
    }
  };

  const handleSave = async () => {
    if (editedTrip) {
      const saved = await api.updateTrip(editedTrip.id, {
        title: editedTrip.title,
        description: editedTrip.description,
        startDate: editedTrip.startDate,
        endDate: editedTrip.endDate,
        tags: editedTrip.tags,
      });
      if (saved) setTrip(saved);
      setIsEditing(false);
    }
  };

  const handlePhotoClick = (photo: Photo) => {
    const photos = editedTrip?.photos || trip?.photos || [];
    const index = photos.findIndex((p: Photo) => p.id === photo.id);
    setSelectedPhoto(photo);
    setSelectedPhotoIndex(index);
  };

  const handlePrevPhoto = () => {
    const photos = editedTrip?.photos || trip?.photos || [];
    const newIndex = selectedPhotoIndex > 0 ? selectedPhotoIndex - 1 : photos.length - 1;
    setSelectedPhoto(photos[newIndex]);
    setSelectedPhotoIndex(newIndex);
  };

  const handleNextPhoto = () => {
    const photos = editedTrip?.photos || trip?.photos || [];
    const newIndex = selectedPhotoIndex < photos.length - 1 ? selectedPhotoIndex + 1 : 0;
    setSelectedPhoto(photos[newIndex]);
    setSelectedPhotoIndex(newIndex);
  };

  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelectedPhoto(null);
      } else if (selectedPhoto) {
        if (e.key === 'ArrowLeft') {
          handlePrevPhoto();
        } else if (e.key === 'ArrowRight') {
          handleNextPhoto();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedPhoto, selectedPhotoIndex]);

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`;
  };

  if (!trip) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <p className="text-text-tertiary mb-4">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-sm border-b border-border-soft">
        <div className="max-w-7xl mx-auto px-8 py-4 flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 text-text-secondary hover:text-primary transition-colors"
          >
            <span>←</span>
            <span>返回</span>
          </button>
          <div className="flex items-center gap-4">
            {isEditing ? (
              <>
                <button
                  onClick={() => {
                    setEditedTrip(trip);
                    setIsEditing(false);
                  }}
                  className="px-4 py-2 text-text-secondary hover:text-text-primary transition-colors"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
                >
                  保存
                </button>
              </>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="px-6 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
              >
                编辑
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-8 py-12">
        {/* Trip Info Card */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-surface rounded-xl shadow-md p-8 mb-12"
        >
          {isEditing ? (
            <div className="space-y-8">
              <div>
                <label className="block text-base font-medium text-text-secondary mb-3">
                  标题
                </label>
                <input
                  type="text"
                  value={editedTrip?.title || ''}
                  onChange={(e) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, title: e.target.value });
                    }
                  }}
                  className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-surface transition-all text-lg"
                  placeholder="输入旅行标题"
                />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-base font-medium text-text-secondary mb-3">
                    开始日期
                  </label>
                  <DatePicker
                    selected={editedTrip?.startDate ? new Date(editedTrip.startDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({ ...editedTrip, startDate: date.toISOString().split('T')[0] });
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="选择开始日期"
                    className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-surface transition-all"
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-text-secondary mb-3">
                    结束日期
                  </label>
                  <DatePicker
                    selected={editedTrip?.endDate ? new Date(editedTrip.endDate) : null}
                    onChange={(date: Date | null) => {
                      if (editedTrip && date) {
                        setEditedTrip({ ...editedTrip, endDate: date.toISOString().split('T')[0] });
                      }
                    }}
                    dateFormat="yyyy-MM-dd"
                    placeholderText="选择结束日期"
                    className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-surface transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-base font-medium text-text-secondary mb-3">
                  描述
                </label>
                <textarea
                  value={editedTrip?.description}
                  onChange={(e) => {
                    if (editedTrip) {
                      setEditedTrip({ ...editedTrip, description: e.target.value });
                    }
                  }}
                  rows={5}
                  className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-surface transition-all resize-none leading-relaxed"
                  placeholder="记录这次旅行的美好回忆..."
                />
              </div>
              <div>
                <label className="block text-base font-medium text-text-secondary mb-3">
                  标签
                </label>
                <div className="space-y-3">
                  <input
                    type="text"
                    value={tagInput}
                    onChange={(e) => {
                      setTagInput(e.target.value);
                      if (editedTrip) {
                        setEditedTrip({
                          ...editedTrip,
                          tags: e.target.value.split(',').map(t => t.trim()).filter(t => t),
                        });
                      }
                    }}
                    placeholder="用逗号分隔标签"
                    className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-surface transition-all"
                  />
                  {editedTrip?.tags && editedTrip.tags.length > 0 && editedTrip.tags[0] !== '' && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {editedTrip.tags.map((tag: string, index: number) => (
                        <span
                          key={index}
                          className="px-3 py-1.5 bg-primary-soft text-primary text-sm rounded-full border border-primary/30"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <>
              <h1 className="text-3xl font-bold text-text-primary mb-4">
                {trip.title}
              </h1>
              <div className="flex items-center gap-4 text-sm text-text-tertiary mb-4">
                <span>
                  {formatDate(trip.startDate)} - {formatDate(trip.endDate)}
                </span>
                <span>•</span>
                <span>{trip.photos.length} 张照片</span>
              </div>
              <p className="text-text-secondary leading-relaxed mb-4">
                {trip.description}
              </p>
              {trip.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {trip.tags.map((tag: string, index: number) => (
                    <span
                      key={index}
                      className="px-3 py-1 bg-primary-soft text-primary text-sm rounded-full"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </>
          )}
        </motion.div>

        {/* Photo Wall */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
        >
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-bold text-text-primary">照片</h2>
            <div className="flex items-center gap-4">
              <span className="text-sm text-text-tertiary">
                {trip.photos.length} 张照片
              </span>
              <label className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors cursor-pointer flex items-center gap-2">
                <span>+</span>
                <span>{isUploading ? '导入中...' : '添加照片'}</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,video/*"
                  onChange={handlePhotoUpload}
                  className="hidden"
                  disabled={isUploading}
                />
              </label>
            </div>
          </div>
          <PhotoWall
            photos={editedTrip?.photos || trip.photos}
            onPhotoClick={handlePhotoClick}
            onDeletePhoto={isEditing ? handleDeletePhoto : undefined}
            showDeleteButton={isEditing}
          />
        </motion.div>
      </main>

      {/* Lightbox */}
      <AnimatePresence>
        {selectedPhoto && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-8"
            onClick={() => setSelectedPhoto(null)}
          >
            {/* 左箭头 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handlePrevPhoto();
              }}
              className="absolute left-8 top-1/2 -translate-y-1/2 text-white text-4xl hover:text-primary transition-colors z-10"
            >
              ←
            </button>

            {/* 右箭头 */}
            <button
              onClick={(e) => {
                e.stopPropagation();
                handleNextPhoto();
              }}
              className="absolute right-8 top-1/2 -translate-y-1/2 text-white text-4xl hover:text-primary transition-colors z-10"
            >
              →
            </button>

            <motion.div
              key={selectedPhoto.id}
              initial={{ scale: 0.8 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.8 }}
              className="h-full flex items-center justify-center"
              onClick={(e) => e.stopPropagation()}
            >
              {selectedPhoto.type === 'video' ? (
                <video
                  src={selectedPhoto.mediaUrl}
                  controls
                  autoPlay
                  className="h-full w-auto"
                />
              ) : (
                <img
                  src={selectedPhoto.mediaUrl}
                  alt=""
                  className="h-full w-auto"
                />
              )}
            </motion.div>

            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-8 right-8 text-white text-4xl hover:text-primary transition-colors"
            >
              ×
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default TripPage;
