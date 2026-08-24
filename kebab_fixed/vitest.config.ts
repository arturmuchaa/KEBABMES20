/**
 * vitest.config.ts — runner testów jednostkowych.
 *
 * Trzon to CZYSTA logika domenowa (FEFO, dobór partii, bilanse) — biegnie
 * w `node`, bez DOM, i tak ma zostać: jest szybka i nie wymaga przeglądarki.
 *
 * Od 2026-08-19 dopuszczamy też testy KOMPONENTÓW (`*.test.tsx`). Powód:
 * edycja przyjęcia otwierała pusty formularz, bo zaraz po zasianiu danych
 * wykonywał się reset z czasów okna modalnego. Mapowanie miało komplet testów
 * i wszystkie były zielone — błąd siedział w KOLEJNOŚCI EFEKTÓW, czyli
 * dokładnie tam, gdzie czysta logika nie sięga.
 *
 * Takie testy włączają sobie DOM same, docblockiem `// @vitest-environment jsdom`,
 * żeby reszta zestawu nie płaciła za środowisko, którego nie używa.
 *
 * Uruchom: `npm test` (jednorazowo) lub `npm run test:watch`.
 */
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  // Stałe podstawiane normalnie przez vite.config przy budowaniu kiosku.
  // Bez nich test ekranu hali wywraca się na ReferenceError, zanim cokolwiek
  // sprawdzi — wartość jest nieistotna, liczy się samo istnienie.
  define: {
    __ROZBIOR_V10_VERSION__: JSON.stringify('test'),
    __PRODUKCJA_VERSION__: JSON.stringify('test'),
    __ROZBIOR_V11_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
})
