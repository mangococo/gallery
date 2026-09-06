import React from 'react';
import { motion } from 'framer-motion';
import { api } from '../lib/api';
import { toast } from './feedback';
import {
  CalendarIcon,
  CameraIcon,
  PenIcon,
  PlaneIcon,
  PlusIcon,
  SparklesIcon,
  StarIcon,
  TagIcon,
  TargetIcon,
  XIcon,
} from './icons';
import TagInput from './TagInput';

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
    tags: [] as string[],
  });
  // 选中文件与预览一对一（视频无预览为 null）——此前两个独立数组在混选图片+视频时下标错位
  const [items, setItems] = React.useState<{ id: number; file: File; url: string | null }[]>([]);
  const itemIdRef = React.useRef(0);
  const [submitting, setSubmitting] = React.useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const added = Array.from(e.target.files || []).map((file) => {
      const item = { id: ++itemIdRef.current, file, url: null as string | null };
      if (file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          // 按 id 回填，与文件列表严格对齐
          setItems((prev) =>
            prev.map((it) =>
              it.id === item.id ? { ...it, url: ev.target?.result as string } : it,
            ),
          );
        };
        reader.readAsDataURL(file);
      }
      return item;
    });
    setItems((prev) => [...prev, ...added]);
  };

  const removeItem = (id: number) => {
    setItems((prev) => prev.filter((it) => it.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.startDate && formData.endDate && formData.endDate < formData.startDate) {
      toast('结束日期不能早于开始日期', 'error');
      return;
    }
    setSubmitting(true);

    try {
      const trip = await api.createTrip({
        title: formData.title,
        description: formData.description,
        startDate: formData.startDate,
        endDate: formData.endDate,
        tags: formData.tags,
      });

      // 文件经主进程复制进旅行目录
      const paths = items.map((it) => api.getPathForFile(it.file));
      if (paths.length > 0) {
        const { failed } = await api.importPhotos(trip.id, paths);
        if (failed.length > 0) {
          const etc = failed.length > 1 ? ` 等 ${failed.length} 个` : '';
          toast(`旅行已创建，但 ${failed[0].name}${etc}导入失败（${failed[0].reason}）`, 'info');
        }
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      toast(error.message || '创建旅行失败', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 no-drag bg-black/40 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.95, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="bg-background rounded-3xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden"
        style={{
          background: 'linear-gradient(135deg, var(--g-background) 0%, var(--g-surface-2) 100%)',
          border: '3px solid color-mix(in srgb, var(--g-primary) 25%, transparent)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 装饰性顶部 */}
        <div className="relative bg-gradient-to-r from-primary/10 to-secondary/10 px-8 py-6 border-b-2 border-dashed border-primary/20">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-2xl font-bold text-primary mb-1 flex items-center gap-2" style={{ fontFamily: 'cursive' }}>
                <PlaneIcon size={22} />
                <span>新的旅程</span>
              </h2>
              <p className="text-xs text-text-tertiary">记录美好时光</p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 rounded-full bg-surface/80 hover:bg-surface text-text-ink-2 hover:text-primary transition-all shadow-sm flex items-center justify-center"
            >
              <XIcon size={16} />
            </button>
          </div>
          {/* 装饰性小星星 */}
          <div className="absolute top-2 right-20 text-primary/30">
            <StarIcon size={10} filled />
          </div>
          <div className="absolute bottom-2 right-32 text-primary/20">
            <StarIcon size={8} filled />
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-8 space-y-8 overflow-y-auto" style={{ maxHeight: 'calc(90vh - 100px)' }}>
          {/* 时间范围 */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-text-ink-2 mb-3">
              <CalendarIcon size={18} />
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
                  className="w-full px-4 py-3 bg-surface rounded-2xl text-text-primary border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
                />
              </div>
              <div className="relative">
                <label className="block text-xs text-text-tertiary mb-2 ml-2">返程</label>
                <input
                  type="date"
                  required
                  min={formData.startDate || undefined}
                  value={formData.endDate}
                  onChange={(e) =>
                    setFormData({ ...formData, endDate: e.target.value })
                  }
                  className="w-full px-4 py-3 bg-surface rounded-2xl text-text-primary border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
                />
              </div>
            </div>
          </div>

          {/* 分隔线 */}
          <div className="border-t-2 border-dashed border-primary/10"></div>

          {/* 标题 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-ink-2">
              <TargetIcon size={18} />
              <span className="font-medium">旅行主题</span>
            </div>
            <input
              type="text"
              required
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="给这次旅行起个名字..."
              className="w-full px-5 py-4 bg-surface rounded-2xl text-text-primary placeholder-text-tertiary/60 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm text-lg"
            />
          </div>

          {/* 描述 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-ink-2">
              <PenIcon size={18} />
              <span className="font-medium">旅行故事</span>
            </div>
            <textarea
              value={formData.description}
              onChange={(e) =>
                setFormData({ ...formData, description: e.target.value })
              }
              rows={5}
              placeholder="写下你的旅行感受和难忘瞬间..."
              className="w-full px-5 py-4 bg-surface rounded-2xl text-text-primary placeholder-text-tertiary/60 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm resize-none leading-relaxed"
              style={{ lineHeight: '1.8' }}
            />
          </div>

          {/* 照片 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-ink-2">
              <CameraIcon size={18} />
              <span className="font-medium">精彩瞬间</span>
            </div>
            <div className="flex flex-wrap gap-3">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.8, rotate: -5 }}
                  animate={{ opacity: 1, scale: 1, rotate: 0 }}
                  className="relative group"
                >
                  <div className="w-28 h-28 bg-surface p-2 rounded-xl shadow-md transform hover:scale-105 hover:rotate-2 transition-all">
                    {item.url ? (
                      <img
                        src={item.url}
                        alt=""
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="w-full h-full rounded-lg bg-primary-soft flex flex-col items-center justify-center text-primary text-xs gap-1">
                        <CameraIcon size={18} />
                        <span>视频</span>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => removeItem(item.id)}
                    className="absolute -top-2 -right-2 w-7 h-7 bg-danger text-white rounded-full opacity-0 group-hover:opacity-100 transition-all shadow-md hover:opacity-80 flex items-center justify-center"
                  >
                    <XIcon size={13} />
                  </button>
                </motion.div>
              ))}
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-28 h-28 border-3 border-dashed border-primary/30 rounded-xl flex flex-col items-center justify-center text-primary/60 hover:text-primary hover:border-primary/50 hover:bg-primary/5 transition-all"
              >
                <PlusIcon size={28} className="mb-1" />
                <span className="text-xs">添加照片</span>
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,video/*"
                multiple
                onChange={handleFileSelect}
                className="hidden"
              />
            </div>
          </div>

          {/* 标签 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-text-ink-2">
              <TagIcon size={18} />
              <span className="font-medium">旅行标签</span>
            </div>
            <TagInput
              value={formData.tags}
              onChange={(tags) => setFormData({ ...formData, tags })}
              inputClassName="w-full px-5 py-3 bg-surface rounded-2xl text-text-primary placeholder-text-tertiary/60 border-2 border-primary/10 focus:outline-none focus:border-primary/40 transition-all shadow-sm"
              pillClassName="px-3 py-1.5 bg-gradient-to-r from-primary/20 to-secondary/20 text-primary text-xs rounded-full border-2 border-primary/30 shadow-sm"
            />
          </div>

          {/* 按钮 */}
          <div className="flex items-center justify-end gap-4 pt-6 border-t-2 border-dashed border-primary/10">
            <button
              type="button"
              onClick={onClose}
              className="px-6 py-3 text-text-ink-2 hover:text-text-primary transition-colors rounded-2xl hover:bg-surface/50"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-8 py-3 bg-gradient-to-r from-primary to-secondary text-white rounded-2xl hover:shadow-lg transition-all transform hover:scale-105 font-medium disabled:opacity-60 flex items-center gap-2"
            >
              <SparklesIcon size={16} />
              <span>{submitting ? '创建中…' : '创建旅行'}</span>
            </button>
          </div>
        </form>
      </motion.div>
    </motion.div>
  );
};

export default AddTripModal;
