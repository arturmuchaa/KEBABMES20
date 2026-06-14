import { defineConfig } from '@playwright/test'

/**
 * E2E Kebab MES.
 *
 * Cel: chronić przed regresjami, które boli ręcznie testować —
 *  • zoom / kompensacja popperów Radix (125/150%) — patrz e2e/zoom.spec.ts
 *  • traceability raw↔finished (szkielet) — patrz e2e/traceability.spec.ts
 *
 * Silnik: tylko Chromium — desktop produkcyjny to Tauri WebView2 (Chromium),
 * więc testujemy ten sam engine, na którym chodzi klient.
 *
 * webServer startuje TYLKO vite (:5173). Backend (:8000) i seedowana baza
 * muszą działać OSOBNO dla testów dotykających danych (traceability).
 * Test zoomu działa bez backendu.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Serwer współdzielony / mało RAM + uruchamianie jako root: lekki headless-shell
    // + flagi które zapobiegają zawieszaniu newPage przy ciasnej pamięci.
    launchOptions: {
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', viewport: { width: 1280, height: 720 } },
    },
  ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:5173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
