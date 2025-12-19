import React from 'react';
import { motion } from 'framer-motion';

interface AuthModalProps {
  onClose: () => void;
  onAuthorize: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onClose, onAuthorize }) => {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.9 }}
        className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4"
      >
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-secondary">目录授权</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-secondary transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4">
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-sm text-blue-700 mb-3">
              📁 需要授权访问目录以加载旅行数据
            </p>
            <p className="text-xs text-blue-600">
              {window.location.protocol === 'file:' 
                ? '请选择一个目录作为旅行数据的存储位置，所有旅行记录将保存在该目录的子文件夹中'
                : '需要重新授权访问之前选择的存储目录'
              }
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
            onClick={onAuthorize}
            className="flex-1 px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-colors"
          >
            {window.location.protocol === 'file:' ? '选择存储目录' : '重新授权'}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

export default AuthModal;
