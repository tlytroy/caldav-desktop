import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import './index.css'
import './styles/touch-optimized.css'
import { useThemeStore, getCurrentColors } from './store/themeStore'

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

// 在应用渲染前初始化主题
initializeTheme();

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
)
