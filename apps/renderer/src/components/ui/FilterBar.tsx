import React from 'react';
import { Search, X } from 'lucide-react';
import { useCalendarStore } from '../../store/calendarStore';
import type { EventFilter } from '../../types';

interface FilterBarProps {
  onFilterChange: (filter: EventFilter) => void;
}

export function FilterBar({ onFilterChange }: FilterBarProps) {
  const { categories, tags, eventFilter } = useCalendarStore();

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onFilterChange({ ...eventFilter, searchText: e.target.value });
  };

  const handleCategoryChange = (categoryId: string) => {
    const newFilter = { ...eventFilter };
    if (newFilter.categoryId === categoryId) {
      delete newFilter.categoryId;
    } else {
      newFilter.categoryId = categoryId;
    }
    onFilterChange(newFilter);
  };

  const handleTagToggle = (tagId: string) => {
    const newFilter = { ...eventFilter };
    const currentTags = newFilter.tagIds || [];

    if (currentTags.includes(tagId)) {
      newFilter.tagIds = currentTags.filter(id => id !== tagId);
    } else {
      newFilter.tagIds = [...currentTags, tagId];
    }

    onFilterChange(newFilter);
  };

  const clearFilters = () => {
    onFilterChange({});
  };

  const hasActiveFilters = eventFilter.categoryId ||
                          (eventFilter.tagIds && eventFilter.tagIds.length > 0) ||
                          eventFilter.searchText;

  return (
    <div className="mb-6 bg-white dark:bg-neutral-700 rounded-lg shadow p-4">
      {/* 搜索框 */}
      <div className="relative mb-4">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
          <Search className="h-5 w-5 text-gray-400" />
        </div>
        <input
          type="text"
          value={eventFilter.searchText || ''}
          onChange={handleSearchChange}
          placeholder="搜索事件..."
          className="block w-full pl-10 pr-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:bg-gray-600 dark:text-white"
        />
      </div>

      {/* 分类过滤 */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">分类</h3>
        <div className="flex flex-wrap gap-2">
          {categories.map(category => (
            <button
              key={category.id}
              onClick={() => handleCategoryChange(category.id)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                eventFilter.categoryId === category.id
                  ? `text-white ${category.color === '#3b82f6' ? 'bg-blue-500' :
                                 category.color === '#10b981' ? 'bg-green-500' :
                                 category.color === '#f59e0b' ? 'bg-yellow-500' : 'bg-gray-500'}`
                  : 'bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-500'
              }`}
            >
              {category.name}
            </button>
          ))}
        </div>
      </div>

      {/* 标签过滤 */}
      <div className="mb-4">
        <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">标签</h3>
        <div className="flex flex-wrap gap-2">
          {tags.map(tag => (
            <button
              key={tag.id}
              onClick={() => handleTagToggle(tag.id)}
              className={`px-3 py-1 text-sm rounded-full transition-colors ${
                eventFilter.tagIds?.includes(tag.id)
                  ? `text-white ${tag.color === '#ef4444' ? 'bg-red-500' :
                                tag.color === '#f97316' ? 'bg-orange-500' : 'bg-gray-500'}`
                  : 'bg-gray-100 dark:bg-gray-600 text-gray-800 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-500'
              }`}
            >
              {tag.name}
            </button>
          ))}
        </div>
      </div>

      {/* 清除过滤器按钮 */}
      {hasActiveFilters && (
        <div className="flex justify-end">
          <button
            onClick={clearFilters}
            className="flex items-center text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300"
          >
            <X className="h-4 w-4 mr-1" />
            清除所有过滤器
          </button>
        </div>
      )}
    </div>
  );
}