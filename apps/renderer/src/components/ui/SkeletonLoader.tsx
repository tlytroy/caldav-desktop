import React from 'react';

interface SkeletonLoaderProps {
  type?: 'calendar' | 'event-list' | 'event-card';
}

export function SkeletonLoader({ type = 'calendar' }: SkeletonLoaderProps) {
  if (type === 'calendar') {
    return (
      <div className="animate-pulse">
        {/* 日历头部 */}
        <div className="flex justify-between items-center mb-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-1/4"></div>
          <div className="flex space-x-2">
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
            <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-20"></div>
          </div>
        </div>

        {/* 星期标题 */}
        <div className="grid grid-cols-7 gap-1 mb-2">
          {[...Array(7)].map((_, i) => (
            <div key={i} className="h-8 bg-gray-100 dark:bg-gray-800 rounded text-center py-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mx-auto"></div>
            </div>
          ))}
        </div>

        {/* 日历天格子 */}
        <div className="grid grid-cols-7 gap-1">
          {[...Array(42)].map((_, i) => (
            <div key={i} className="h-24 bg-gray-50 dark:bg-gray-800 rounded border border-gray-200 dark:border-gray-700 p-1">
              <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-1"></div>
              <div className="space-y-1">
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded"></div>
                <div className="h-3 bg-gray-100 dark:bg-gray-700 rounded w-2/3"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'event-list') {
    return (
      <div className="animate-pulse space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-16 bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
            <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-3/4 mb-2"></div>
            <div className="h-3 bg-gray-200 dark:bg-gray-700 rounded w-1/2"></div>
          </div>
        ))}
      </div>
    );
  }

  if (type === 'event-card') {
    return (
      <div className="animate-pulse">
        <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded w-1/3 mb-4"></div>
        <div className="space-y-2">
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-full"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-5/6"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-2/3"></div>
        </div>
        <div className="flex mt-4 space-x-2">
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-16"></div>
          <div className="h-6 bg-gray-200 dark:bg-gray-700 rounded-full w-16"></div>
        </div>
      </div>
    );
  }

  return null;
}