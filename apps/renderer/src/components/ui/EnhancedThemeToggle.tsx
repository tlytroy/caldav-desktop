import React from 'react';
import { Sun, Moon, Monitor } from 'lucide-react';
import { useThemeStore } from '../../store/themeStore';

export function EnhancedThemeToggle() {
  const { theme, borderRadius, setTheme, setBorderRadius } = useThemeStore();

  const handleThemeChange = (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
  };

  const handleBorderRadiusChange = (newRadius: string) => {
    setBorderRadius(newRadius);
  };

  return (
    <div className="relative group">
      <button className="p-2 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full transition-colors">
        {theme === 'dark' ? (
          <Moon className="h-5 w-5" />
        ) : theme === 'light' ? (
          <Sun className="h-5 w-5" />
        ) : (
          <Monitor className="h-5 w-5" />
        )}
      </button>

      <div className="absolute right-0 z-10 mt-2 w-64 origin-top-right rounded-lg bg-white dark:bg-gray-800 shadow-lg ring-1 ring-black ring-opacity-5 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
        <div className="p-4">
          <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
            外观设置
          </h3>

          <div className="space-y-4">
            {/* 主题选择 */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block">
                主题
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleThemeChange('light')}
                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                    theme === 'light'
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <Sun className="h-4 w-4 mx-auto mb-1" />
                  浅色
                </button>
                <button
                  onClick={() => handleThemeChange('dark')}
                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                    theme === 'dark'
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <Moon className="h-4 w-4 mx-auto mb-1" />
                  深色
                </button>
                <button
                  onClick={() => handleThemeChange('system')}
                  className={`px-3 py-2 text-sm rounded-md transition-colors ${
                    theme === 'system'
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  <Monitor className="h-4 w-4 mx-auto mb-1" />
                  系统
                </button>
              </div>
            </div>

            {/* 圆角设置 */}
            <div>
              <label className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2 block">
                圆角样式
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => handleBorderRadiusChange('rounded-sm')}
                  className={`px-3 py-2 text-sm rounded-sm transition-colors ${
                    borderRadius === 'rounded-sm'
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  小
                </button>
                <button
                  onClick={() => handleBorderRadiusChange('rounded')}
                  className={`px-3 py-2 text-sm rounded transition-colors ${
                    borderRadius === 'rounded'
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  中
                </button>
                <button
                  onClick={() => handleBorderRadiusChange('rounded-lg')}
                  className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                    borderRadius === 'rounded-lg'
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-200'
                      : 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                  }`}
                >
                  大
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}