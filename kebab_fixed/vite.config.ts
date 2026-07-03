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
        // Główna aplikacja (web + desktop pełny)
        main: path.resolve(__dirname, 'index.html'),
        // Stary kiosk rozbioru (wszystkie warianty z przełącznikiem)
        kiosk: path.resolve(__dirname, 'kiosk.html'),
        // Standalone HMI v7 "Precision Light" — panel PC 21", bez przełącznika
        'rozbior-v7': path.resolve(__dirname, 'rozbior-v7.html'),
        // Standalone HMI v10 — biel + akcent indygo, panel PC 21.5", bez przełącznika
        'rozbior-v10': path.resolve(__dirname, 'rozbior-v10.html'),
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
