import { useEffect } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useThemeStore, getCurrentColors } from '../../store/themeStore';

export function ThemeToggle() {
  const themeState = useThemeStore();
  const { isDarkMode, toggleTheme } = themeState;

  // 当主题状态改变时，更新DOM class和CSS变量
  useEffect(() => {
    // 更新暗色模式class
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }

    // 更新CSS变量
    const colors = getCurrentColors(themeState);
    const root = document.documentElement;
    Object.entries(colors).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });
  }, [isDarkMode, themeState]);

  return (
    <button
      onClick={toggleTheme}
      className="p-2 rounded-full bg-neutral-100 dark:bg-neutral-700 text-neutral-700 dark:text-neutral-200 hover:bg-neutral-200 dark:hover:bg-neutral-600 transition-colors duration-200"
      aria-label={isDarkMode ? '切换到浅色模式' : '切换到深色模式'}
    >
      {isDarkMode ? (
        <Sun className="w-5 h-5" />
      ) : (
        <Moon className="w-5 h-5" />
      )}
    </button>
  );
}