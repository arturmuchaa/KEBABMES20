import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  build: {
    rollupOptions: {
      input: {
        // Główna aplikacja (web + desktop pełny) oraz dedykowane wejście kiosku
        // rozbioru (osobny build Tauri, fullscreen, tylko panel rozbioru).
        main: path.resolve(__dirname, 'index.html'),
        kiosk: path.resolve(__dirname, 'kiosk.html'),
      },
    },
  },
  server: {
    port: 5173,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL || 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
