import React from 'react';
import { X } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  const { borderRadius } = useThemeStore();

  const sizeClasses = {
    sm: 'max-w-sm',
    md: 'max-w-md',
    lg: 'max-w-lg',
    xl: 'max-w-xl',
  };

  // 处理ESC键关闭
  React.useEffect(() => {
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEsc);
      // 防止背景滚动
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = 'unset';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto"
      aria-modal="true"
      role="dialog"
    >
      {/* 使用flexbox确保在所有屏幕尺寸下都居中 */}
      <div className="flex items-center justify-center min-h-screen px-4 pt-4 pb-20 text-center sm:p-0">
        {/* Background overlay */}
        <div
          className="fixed inset-0 transition-opacity bg-gray-500 bg-opacity-75 dark:bg-gray-800 dark:bg-opacity-75"
          aria-hidden="true"
          onClick={onClose}
        />

        {/* Modal panel - 使用现代flexbox居中方法 */}
        <div
          className={`inline-block align-bottom bg-white dark:bg-neutral-700 ${borderRadius} text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col w-full ${size === 'xl' ? 'max-w-4xl' : size === 'lg' ? 'max-w-2xl' : size === 'md' ? 'max-w-lg' : 'max-w-md'} mx-auto ${size === 'xl' ? '2xl:max-w-5xl' : ''}`}
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-headline"
        >
          <div className={`px-4 pt-5 pb-4 bg-white dark:bg-neutral-700 ${borderRadius} sm:p-6 sm:pb-4 flex-shrink-0`}>
            <div className="flex items-center justify-between mb-4">
              <h3
                className="text-lg font-medium leading-6 text-gray-900 dark:text-white"
                id="modal-headline"
              >
                {title}
              </h3>
              <button
                type="button"
                className="text-gray-400 bg-white dark:bg-neutral-700 dark:text-gray-300 rounded-md hover:text-gray-500 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 p-1"
                onClick={onClose}
                aria-label="关闭对话框"
              >
                <span className="sr-only">关闭</span>
                <X className="w-6 h-6" aria-hidden="true" />
              </button>
            </div>
          </div>
          <div className="overflow-y-auto flex-grow px-4 pb-4 sm:px-6 sm:pb-6" style={{ maxHeight: 'calc(90vh - 150px)' }}>
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}