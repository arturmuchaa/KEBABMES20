---
description: Lokalne lustro CI — typecheck + unit + backend + e2e. Uruchom przed każdym push/PR.
argument-hint: "[fast]  (fast = pomiń e2e)"
---

# /verify — pętla weryfikacji (NAJWAŻNIEJSZE: daj sobie sposób na sprawdzenie pracy)

Uruchom kolejno i **zaraportuj prawdziwy output** każdego kroku (bez „powinno działać"):

1. **Typecheck:** `npx tsc --noEmit`
2. **Unit (frontend):** `npx vitest run`  (TZ=UTC ustawia skrypt `npm test`, więc równoważnie `npm test`)
3. **Backend:** `cd backend && python3 -m pytest -q`
4. **E2E (Playwright):** `npx playwright test`  ← **pomiń, jeśli argument to `fast`**

To jest dokładnie to, co odpala CI (`.github/workflows/ci.yml`: backend pytest + e2e playwright). Zielono lokalnie ⇒ zielono w CI.

Jeśli coś padnie:
- **Najpierw root cause** (logi/diff/test), potem najmniejsza poprawka — zgodnie z WORKING STYLE w CLAUDE.md.
- Nie zgłaszaj „done", dopóki wszystkie kroki nie są zielone.
