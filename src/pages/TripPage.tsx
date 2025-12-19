import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import { storageService } from '../storage';
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
      const storagePath = storageService.getStoragePath();
      if (storagePath) {
        const hasAccess = await storageService.hasDirectoryAccess();
        if (!hasAccess) {
          try {
            await storageService.requestDirectoryAccess();
          } catch (error: any) {
            if (error.message?.includes('目录不存在')) {
              alert('存储目录不存在，请重新配置全局存储目录');
              navigate('/');
            }
            return;
          }
        }
        const tripData = await storageService.getTripById(id!);
        setTrip(tripData);
        setEditedTrip(tripData ? { ...tripData, tags: tripData.tags || [] } : null);
        setTagInput((tripData?.tags || []).join(', '));
      }
    };
    loadTrip();
  }, [id, navigate]);

  const handlePhotoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    // 检测是否为单文件模式（file:// 协议）
    const isStandaloneMode = window.location.protocol === 'file:';
    
    if (isStandaloneMode) {
      // 单文件模式下提示用户手动操作
      const fileNames = Array.from(files).map(f => f.name).join('\n');
      alert(`单文件模式下无法自动上传文件。\n\n请手动将以下文件复制到旅行目录中：\n${fileNames}\n\n旅行目录：${trip?.title || '当前旅行'}\n\n复制完成后请刷新页面。`);
      event.target.value = '';
      return;
    }

    console.log('开始上传照片，文件数量:', files.length);
    setIsUploading(true);
    const newPhotos: Photo[] = [];

    // 获取旅行目录句柄
    try {
      const rootDirHandle = await storageService.getDirectoryHandle();
      let tripDirHandle = null;
      
      // 找到当前旅行的目录
      for await (const [, handle] of rootDirHandle.entries()) {
        if (handle.kind === 'directory') {
          try {
            const settingsHandle = await handle.getFileHandle('.settings.json');
            const settingsFile = await settingsHandle.getFile();
            const settings = JSON.parse(await settingsFile.text());
            if (settings.id === trip?.id) {
              tripDirHandle = handle;
              break;
            }
          } catch {
            // 跳过没有配置文件的目录
          }
        }
      }

      if (!tripDirHandle) {
        throw new Error('找不到旅行目录');
      }

      // 保存文件到目录
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        console.log('处理文件:', file.name, file.type);
        if (file.type.startsWith('image/') || file.type.startsWith('video/')) {
          const fileName = `${Date.now()}_${i}_${file.name}`;
          const fileHandle = await tripDirHandle.getFileHandle(fileName, { create: true });
          const writable = await fileHandle.createWritable();
          await writable.write(file);
          await writable.close();

          // 创建 URL 用于显示
          const url = URL.createObjectURL(file);
          const photo: Photo = {
            id: fileName,
            url,
            thumbnail: url,
            caption: '',
            type: file.type.startsWith('video/') ? 'video' : 'image',
          };
          newPhotos.push(photo);
          console.log('文件保存完成:', fileName);
        }
      }

      console.log('新照片数量:', newPhotos.length);
      if (editedTrip) {
        const updatedTrip = {
          ...editedTrip,
          photos: [...(editedTrip.photos || []), ...newPhotos],
        };
        console.log('更新后照片总数:', updatedTrip.photos.length);
        setEditedTrip(updatedTrip);
        
        // 如果不在编辑模式，直接保存
        if (!isEditing) {
          console.log('保存到存储');
          await storageService.updateTrip(updatedTrip);
          setTrip(updatedTrip);
        }
      }
    } catch (error: any) {
      console.error('上传照片失败:', error);
      alert('上传照片失败: ' + error.message);
    }

    setIsUploading(false);
    // 清空input
    event.target.value = '';
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (editedTrip) {
      const updatedTrip = {
        ...editedTrip,
        photos: editedTrip.photos.filter((p: Photo) => p.id !== photoId),
      };
      setEditedTrip(updatedTrip);
      
      // 如果不在编辑模式，直接保存
      if (!isEditing) {
        await storageService.updateTrip(updatedTrip);
        setTrip(updatedTrip);
      }
    }
  };

  const handleSave = async () => {
    if (editedTrip) {
      await storageService.updateTrip(editedTrip);
      setTrip(editedTrip);
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
      <header className="sticky top-0 z-20 bg-background/80 backdrop-blur-sm border-b border-gray-200">
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
          className="bg-white rounded-xl shadow-md p-8 mb-12"
        >
          {isEditing ? (
            <div className="space-y-8">
              <div>
                <label className="block text-base font-medium text-secondary mb-3">
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
                  className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-white transition-all text-lg"
                  placeholder="输入旅行标题"
                />
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-base font-medium text-secondary mb-3">
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
                    className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-white transition-all"
                  />
                </div>
                <div>
                  <label className="block text-base font-medium text-secondary mb-3">
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
                    className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-white transition-all"
                  />
                </div>
              </div>
              <div>
                <label className="block text-base font-medium text-secondary mb-3">
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
                  className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-white transition-all resize-none leading-relaxed"
                  placeholder="记录这次旅行的美好回忆..."
                />
              </div>
              <div>
                <label className="block text-base font-medium text-secondary mb-3">
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
                    className="w-full px-5 py-3 bg-background border-2 border-primary/20 rounded-xl text-text-primary placeholder-text-tertiary focus:outline-none focus:border-primary focus:bg-white transition-all"
                  />
                  {editedTrip?.tags && editedTrip.tags.length > 0 && editedTrip.tags[0] !== '' && (
                    <div className="flex flex-wrap gap-2 pt-2">
                      {editedTrip.tags.map((tag: string, index: number) => (
                        <span
                          key={index}
                          className="px-3 py-1.5 bg-primary/15 text-primary text-sm rounded-full border border-primary/30"
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
                      className="px-3 py-1 bg-primary/10 text-primary text-sm rounded-full"
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
                <span>{isUploading ? '上传中...' : '添加照片'}</span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
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
                  src={selectedPhoto.url}
                  controls
                  autoPlay
                  className="h-full w-auto"
                />
              ) : (
                <img
                  src={selectedPhoto.url}
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
