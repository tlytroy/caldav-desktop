import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true
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
  },
});