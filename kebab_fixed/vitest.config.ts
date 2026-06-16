/**
 * vitest.config.ts — runner testów jednostkowych (CZYSTA logika).
 *
 * Celowo NIE używa vite.config.ts (plugin react + wiele wejść HTML) —
 * te testy to czyste funkcje domenowe (FEFO, dobór partii), bez DOM.
 * Uruchom: `npm test` (jednorazowo) lub `npm run test:watch`.
 */
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
