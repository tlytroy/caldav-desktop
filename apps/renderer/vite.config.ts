import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // dev 下不注册 Service Worker，避免缓存错乱 / 打开页面时 SW 报错
      devOptions: {
        enabled: false
      },
      manifest: {
        name: 'CalDAV Calendar',
        short_name: 'CalDAV',
        description: 'Cross-platform calendar application with full CalDAV support',
        theme_color: '#8d9ba8',
        background_color: '#f9fafb',
        display: 'standalone',
        icon: 'src/assets/icon-512.svg'
      }
    })
  ],
  server: {
    port: 5173,
    fs: {
      /**
       * 允许读取项目根目录的 plugins/ 目录。
       * 插件组件放在那里（与 apps/renderer 平级），
       * 配合 import.meta.glob 实现「放文件即装模块」。
       */
      allow: [path.resolve(__dirname, '..', '..')],
    },
  },
  build: {
    rollupOptions: {
      input: {
        // 主入口
        index: path.resolve(__dirname, 'index.html'),
      },
    },
  },
});