# E2E (Playwright)

Testy end-to-end na silniku Chromium (= ten sam co Tauri WebView2 u klienta).

## Setup (raz)
```bash
npm install                      # podciąga @playwright/test
npx playwright install chromium  # pobiera przeglądarkę (~150 MB)
```

## Uruchomienie
```bash
npm run test:e2e        # headless
npm run test:e2e:ui     # tryb UI (debug, podgląd kroków)
```
`webServer` w `playwright.config.ts` sam wystartuje `npm run dev` (:5173).
Aby użyć już działającego serwera: `E2E_BASE_URL=http://localhost:5173 npm run test:e2e`.

## Co jest gotowe, a co czeka
| plik | status | wymaga |
|---|---|---|
| `zoom.spec.ts` — rdzeń (Ctrl+=/−/0, localStorage, clamp) | ✅ działa | tylko vite |
| `zoom.spec.ts` — wyrównanie popper↔trigger 125/150% | ⏳ `skip` | selektor realnego `<Select>` |
| `traceability.spec.ts` — raw↔finished przez UI | ⏳ `skip` | backend :8000 + seed bazy |

> Logika rozbicia per partia jest już pokryta unit-testami w `backend/tests/`.
> E2E ma chronić PEŁNY przepływ przez UI (zoom + traceability), nie samą logikę.

## ⚠️ Uwaga (uczciwie)
Scaffold utworzony, ale **nie został odpalony** (przeglądarka Playwright nie była
pobrana w tej sesji). Po `npx playwright install chromium` część "rdzeń zoom"
powinna przejść od razu; testy `skip` trzeba uzupełnić o selektory/seed.
