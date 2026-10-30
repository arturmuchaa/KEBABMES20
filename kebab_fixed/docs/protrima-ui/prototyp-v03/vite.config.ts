import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dwa tryby budowania:
//  - domyślny: zwykła aplikacja (React z npm) — do uruchomienia lokalnie i zrzutów ekranu,
//  - "artifact": jeden plik; React/ReactDOM jako globalne UMD z CDN, czcionki osadzone.
export default defineConfig(({ mode }) => {
  const artifact = mode === 'artifact'
  return {
    plugins: [react({ jsxRuntime: 'classic' })],
    base: './',
    build: {
      outDir: artifact ? 'dist-artifact' : 'dist',
      assetsInlineLimit: artifact ? 100_000_000 : 4096,
      cssCodeSplit: false,
      rollupOptions: artifact
        ? {
            external: ['react', 'react-dom', 'react-dom/client'],
            output: {
              format: 'iife',
              inlineDynamicImports: true,
              globals: { react: 'React', 'react-dom': 'ReactDOM', 'react-dom/client': 'ReactDOM' },
            },
          }
        : {},
    },
  }
})
