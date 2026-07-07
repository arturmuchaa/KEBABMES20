import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import fs from 'fs'

// Wersja kiosku v10 z jedynego źródła prawdy (src-tauri/tauri.rozbior-v10.conf.json),
// wstrzykiwana w czasie builda — żeby na ekranie dało się na oko zweryfikować,
// że cichy auto-update faktycznie podmienił wersję (bez tego nie było jak
// odróżnić starej instalacji od nowej patrząc tylko na panel).
const rozbiorV10Version = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'src-tauri/tauri.rozbior-v10.conf.json'), 'utf-8')
).version as string
// Wariant „wzmocnione prowadzenie" — osobny build/instalator (v11).
const rozbiorV11Version = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, 'src-tauri/tauri.rozbior-v11.conf.json'), 'utf-8')
).version as string

export default defineConfig({
  plugins: [react()],
  define: {
    __ROZBIOR_V10_VERSION__: JSON.stringify(rozbiorV10Version),
    __ROZBIOR_V11_VERSION__: JSON.stringify(rozbiorV11Version),
  },
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
        // Wariant v11 „wzmocnione prowadzenie" — ten sam ekran + baner kroków
        'rozbior-v11': path.resolve(__dirname, 'rozbior-v11.html'),
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
