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
      output: {
        // Podział na paczki wg biblioteki.
        //
        // Powód jest sieciowy, nie estetyczny: `main` urósł do 1,18 MB po
        // gzipie i na słabym łączu biura schodził w 19% po 8 sekundach, po
        // czym połączenie padało — MES nie wstawał w ogóle. Mniejsze paczki
        // z tego samego builda (41 KB, 56 KB) szły na tym samym łączu
        // w 0,000 s. Jedna wielka paczka to pojedynczy punkt awarii:
        // przerwany transfer = brak aplikacji.
        //
        // React trzymamy w JEDNEJ paczce (react + react-dom + scheduler +
        // router). Rozdzielenie ich potrafi wywrócić kolejność inicjalizacji.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom)[\\/]/.test(id)) return 'react'
          if (id.includes('pdfjs-dist')) return 'pdfjs'
          if (id.includes('pdf-lib') || id.includes('@pdf-lib')) return 'pdflib'
          if (id.includes('lucide-react')) return 'icons'
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts'
          if (id.includes('html5-qrcode')) return 'qr'
          if (id.includes('@radix-ui')) return 'radix'
          if (id.includes('@fontsource')) return 'fonts'
          return 'vendor'
        },
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
