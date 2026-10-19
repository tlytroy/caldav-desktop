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

  // ESC 关闭 + 防止背景滚动
  React.useEffect(() => {
    if (!isOpen) return;
    const handleEsc = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    // 外层：固定铺满视口
    <div className="fixed inset-0 z-50">
      {/* 半透明遮罩：独立 fixed 层，不参与 flex 布局，避免挤偏 panel */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-[2px] transition-opacity"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* 居中容器：另一独立 fixed 层，用 flex 让 panel 真正居中 */}
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <div
            className={`relative bg-white dark:bg-neutral-900 ${borderRadius} shadow-2xl ring-1 ring-black/5 w-full ${sizeClasses[size]} max-h-[90vh] flex flex-col`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-headline"
          >
            <div className={`px-5 pt-5 pb-4 ${borderRadius} flex items-start justify-between flex-shrink-0 border-b border-gray-100 dark:border-neutral-800`}>
              <h3
                className="text-lg font-semibold text-gray-900 dark:text-white pr-4"
                id="modal-headline"
              >
                {title}
              </h3>
              <button
                type="button"
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-brand rounded-md p-1 -m-1"
                onClick={onClose}
                aria-label="关闭对话框"
              >
                <span className="sr-only">关闭</span>
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>
            <div className="overflow-y-auto flex-grow px-5 py-4">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}