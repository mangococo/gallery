import React from 'react';
import { motion } from 'framer-motion';
import { storageService } from '../storage';
import { Trip, Photo } from '../types';

interface AddTripModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const AddTripModal: React.FC<AddTripModalProps> = ({ onClose, onSuccess }) => {
  const [formData, setFormData] = React.useState({
    title: '',
    description: '',
    startDate: '',
    endDate: '',
    tags: '',
  });
  const [selectedFiles, setSelectedFiles] = React.useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = React.useState<string[]>([]);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles([...selectedFiles, ...files]);

    // 生成预览
    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setPreviewUrls((prev) => [...prev, e.target?.result as string]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeFile = (index: number) => {
    setSelectedFiles(selectedFiles.filter((_, i) => i !== index));
    setPreviewUrls(previewUrls.filter((_, i) => i !== index));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    try {
      // 创建旅行目录
      const tripDirHandle = await storageService.createTripDirectory(formData.title);
      
      // 复制照片到旅行目录
      const photos: Photo[] = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const photo = await storageService.copyPhotoToTrip(tripDirHandle, selectedFiles[i]);
        photos.push(photo);
      }

      // 创建旅行对象
      const newTrip: Trip = {
        id: Date.now().toString(),
        title: formData.title,
        description: formData.description,
        startDate: formData.startDate,
        endDate: formData.endDate,
        photos,
        tags: formData.tags.split(',').map((t) => t.trim()).filter((t) => t),
        coverPhotoIndex: 0,
        isFavorite: false,
      };

      await storageService.saveTrip(newTrip);
      onSuccess();
    } catch (error: any) {
      alert(error.message || '创建旅行失败，请确保已设置全局存储目录');
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-background rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, #FAF8F5 0%, #F5F0E8 100%)',
          border: '3px solid rgba(212, 165, 116, 0.2)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 装饰性顶部 */}
        <div className="relative bg-gradient-to-r from-primary/10 to-secondary/10 px-8 py-6 border-b-2 border-dashed border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-primary mb-1" style={{ fontFamily: 'cursive' }}>
                ✈️ 新的旅程
              </h2>
              <p className="text-xs text-text-tertiary">记录美好时光</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-white/80 hover:bg-white text-text-secondary hover:text-primary transition-all shadow-sm flex items-center justify-center text-xl"
            >
              ×
            </button>
          </div>
          {/* 装饰性小星星 */}
          <div className="absolute top-2 right-20 text-primary/30 text-xs">✦</div>
          <div className="absolute bottom-2 right-32 text-primary/20 text-xs">✧</div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 100px)' }}>
          {/* 时间范围 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-secondary mb-3">
              <span className="text-lg">📅</span>
              <span className="font-medium">旅行时间</span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="relative">
                <label className="block text-xs text-text-tertiary mb-2 ml-2">出发</label>
                <input
                  type="date"
                  required
                  value={formData.startDate}
                  onChange={(e) =>
                    setFormData({ ...formData, startDate: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-white rounded-2xl text-text-primary border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
                />
              </div>
              <div className="relative">
                <label className="block text-xs text-text-tertiary mb-2 ml-2">返程</label>
                <input
                  type="date"
                  required
                  value={formData.endDate}
                  onChange={(e) =>
                    setFormData({ ...formData, endDate: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-white rounded-2xl text-text-primary border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
                />
              </div>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t-2 border-dashed border-primary/10"></div>

          {/* 标题 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-lg">🎯</span>
              <span className="font-medium">旅行主题</span>
            </div>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="给这次旅行起个名字..."
              className="w-full px-5 py-4 bg-white rounded-2xl text-text-primary placeholder-text-tertiary/60 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm text-lg"
            />
          </div>

          {/* 描述 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-lg">✍️</span>
              <span className="font-medium">旅行故事</span>
            </div>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={5}
              placeholder="写下你的旅行感受和难忘瞬间..."
              className="w-full px-5 py-4 bg-white rounded-2xl text-text-primary placeholder-text-tertiary/60 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm resize-none leading-relaxed"
              style={{ lineHeight: '1.8' }}
            />
          </div>

          {/* 照片 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-lg">📸</span>
              <span className="font-medium">精彩瞬间</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {previewUrls.map((url, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  className="relative group"
                >
                  <div className="w-28 h-28 bg-white p-2 rounded-xl shadow-md transform hover:scale-105 hover:rotate-2 transition-all">
                    <img
                      src={url}
                      alt=""
                      className="w-full h-full object-cover rounded-lg"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeFile(index)}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-red-400 text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-md hover:bg-red-500 flex items-center justify-center text-sm"
                  >
                    ×
                  </button>
                </motion.div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-28 h-28 border-3 border-dashed border-primary/30 rounded-xl flex flex-col items-center justify-center text-primary/60 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all"
              >
                <span className="text-3xl mb-1">+</span>
                <span className="text-xs">添加照片</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* 标签 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-secondary">
              <span className="text-lg">🏷️</span>
              <span className="font-medium">旅行标签</span>
            </div>
            <input
              type="text"
              value={formData.tags}
              onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
              placeholder="用逗号分隔标签"
              className="w-full px-5 py-3 bg-white rounded-2xl text-text-primary placeholder-text-tertiary/60 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
            />
            {formData.tags && (
              <div className="flex flex-wrap gap-2 pt-2">
                {formData.tags.split(',').map((tag, index) => {
                  const trimmed = tag.trim();
                  if (!trimmed) return null;
                  return (
                    <span
                      key={index}
                      className="px-3 py-1.5 bg-gradient-to-r from-primary/20 to-secondary/20 text-primary text-xs rounded-full border-2 border-primary/30 shadow-sm"
                    >
                      #{trimmed}
                    </span>
                  );
                })}
              </div>
            )}
          </div>

          {/* 按钮 */}
          <div className="flex items-center justify-end gap-4 pt-6 border-t-2 border-dashed border-primary/10">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-text-secondary hover:text-text-primary transition-colors rounded-2xl hover:bg-white/50"
            >
              取消
            </button>
            <button
              type="submit"
              className="px-8 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-2xl hover:shadow-lg transition-all transform hover:scale-105 font-medium"
            >
              ✨ 创建旅行
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default AddTripModal;
