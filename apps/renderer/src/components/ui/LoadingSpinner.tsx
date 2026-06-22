// import React from 'react'; // 不需要导入React，因为使用的是函数式组件且没有使用React变量

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  message?: string;
}

export function LoadingSpinner({ size = 'md', message }: LoadingSpinnerProps) {
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12',
  };

  const borderSizeClasses = {
    sm: 'border-2',
    md: 'border-4',
    lg: 'border-4',
  };

  return (
    <div className="flex flex-col items-center justify-center">
      <div
        className={`${sizeClasses[size]} ${borderSizeClasses[size]} border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent rounded-full animate-spin`}
      />
      {message && <p className="mt-2 text-gray-600 dark:text-gray-300">{message}</p>}
    </div>
  );
}