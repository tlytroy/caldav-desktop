import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/touch-optimized.css'
import './styles/responsive.css'
import { useThemeStore, getCurrentColors } from './store/themeStore'

// 初始化Capacitor（如果在原生环境中）
const initializeCapacitor = async () => {
  if (typeof window !== 'undefined' && (window as any).Capacitor) {
    try {
      const { StatusBar } = await import('@capacitor/status-bar');
      const { Keyboard } = await import('@capacitor/keyboard');

      // 设置状态栏
      await StatusBar.setStyle({ style: 'DARK' as any });

      // 配置键盘行为
      await Keyboard.setAccessoryBarVisible({ isVisible: true });
    } catch (error) {
      console.warn('Capacitor plugins not available:', error);
    }
  }
};

// 初始化CSS变量
const initializeTheme = () => {
  const themeState = useThemeStore.getState();
  const colors = getCurrentColors(themeState);
  const root = document.documentElement;
  Object.entries(colors).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  // 设置暗色模式
  if (themeState.isDarkMode) {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

// 在应用渲染前初始化
Promise.all([
  initializeCapacitor(),
  initializeTheme()
]).then(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
