import React from 'react';
import { motion } from 'framer-motion';
import { storageService } from '../storage';

interface SettingsModalProps {
  onClose: () => void;
  onStoragePathChanged?: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ onClose, onStoragePathChanged }) => {
  const [storagePath, setStoragePath] = React.useState(() => {
    return storageService.getStoragePath() || '';
  });
  const [needsAuth, setNeedsAuth] = React.useState(false);

  React.useEffect(() => {
    // 检查是否需要授权
    const checkAuth = async () => {
      const hasAccess = await storageService.hasDirectoryAccess();
      setNeedsAuth(!!storagePath && !hasAccess);
    };
    checkAuth();
  }, [storagePath]);

  const handleAuthorize = async () => {
    try {
      await storageService.requestDirectoryAccess();
      setNeedsAuth(false);
      onStoragePathChanged?.();
    } catch (error) {
      console.log('用户取消了授权');
    }
  };

  const handleSelectFolder = async () => {
    try {
      if ('showDirectoryPicker' in window) {
        const dirHandle = await (window as any).showDirectoryPicker();
        const newPath = dirHandle.name;
        setStoragePath(newPath);
        // 直接保存句柄，不需要再次授权
        await storageService.setStoragePathWithHandle(newPath, dirHandle);
        setNeedsAuth(false);
        onStoragePathChanged?.();
      }
    } catch (error) {
      console.log('用户取消了目录选择');
    }
  };

  const handleSave = async () => {
    if (storagePath) {
      await storageService.setStoragePath(storagePath);
      onStoragePathChanged?.();
    }
    onClose();
  };

  const handleClearData = () => {
    if (confirm('确定要清除所有数据吗？此操作不可恢复。')) {
      storageService.clearAllData();
      window.location.reload();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-secondary">系统设置</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-secondary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-secondary mb-2">
              全局存储目录
            </label>
            {window.location.protocol === 'file:' && (
              <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-sm text-blue-700">
                  💡 检测到您正在使用独立 HTML 文件，建议选择当前 HTML 文件所在的目录作为存储目录
                </p>
              </div>
            )}
            <div className="flex gap-2">
              <input
                type="text"
                value={storagePath}
                onChange={(e) => setStoragePath(e.target.value)}
                placeholder={window.location.protocol === 'file:' ? "选择 HTML 文件所在目录" : "选择存储目录路径"}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/50"
              />
              <button
                onClick={handleSelectFolder}
                className="px-4 py-2 bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
              >
                选择
              </button>
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              {window.location.protocol === 'file:' 
                ? '选择当前 HTML 文件所在的目录，旅行数据将保存在该目录下的子文件夹中'
                : '设置所有旅行记录的存储根目录，每个旅行将在此目录下创建子文件夹'
              }
            </p>
            {needsAuth && (
              <div className="mt-2">
                <button
                  onClick={handleAuthorize}
                  className="w-full px-4 py-2 bg-orange-50 text-orange-600 rounded-lg hover:bg-orange-100 transition-colors text-sm"
                >
                  🔐 点击授权访问目录
                </button>
                <p className="text-xs text-orange-600 mt-1">
                  需要授权才能访问存储目录中的旅行数据
                </p>
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-gray-200">
            <button
              onClick={handleClearData}
              className="w-full px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors text-sm"
            >
              清除所有数据
            </button>
            <p className="text-xs text-red-500 mt-1">
              此操作将删除所有旅行记录，不可恢复
            </p>
          </div>
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border border-gray-300 text-text-secondary rounded-lg hover:bg-gray-50 transition-colors"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
          >
            保存
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default SettingsModal;
