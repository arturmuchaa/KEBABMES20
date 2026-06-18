# Offline pakowanie (PWA + kolejka skanów)

Data: 2026-06-18 · Status: zatwierdzony (brainstorming)

## Problem
Na hali, gdzie magazynier pakuje, nie ma internetu. Telefon (PWA z adresu VPS)
nie otworzy apki bez sieci, a każdy skan to request do serwera. Trzeba: apka
ma działać offline na ekranie Pakowanie, skany buforować lokalnie i dosyłać po
złapaniu sieci.

## Decyzje (brainstorming)
- Zakres offline: **tylko ekran Pakowanie** (skan sztuk do kartonu/palety).
- Walidacja: **optymistycznie** — offline buforujemy każdy skan; po sieci dosyłamy
  i pokazujemy raport (które przeszły / odrzucone).
- Połączenie: **VPS przez internet** (jak teraz) → cache PWA + kolejka + sync.

## Architektura

### 1. Service Worker (apka offline) — ręcznie pisany `public/sw.js`
Bez nowej zależności (vite-plugin-pwa) — pełna kontrola, runtime caching:
- **navigation** (mode=navigate) → network-first, fallback cached `index.html`
  (SPA boot offline).
- **/assets/** (zahashowane) + fonty/ikony → cache-first (immutable).
- **/api GET** → network-first, fallback cache (ostatnie znane listy/szczegóły).
- **/api POST i reszta** → network-only (offline obsługuje kolejka w apce).
- install: skipWaiting; activate: clients.claim + czyszczenie starych cache.
- Rejestracja w `main.tsx` (`navigator.serviceWorker.register('/sw.js')`).

### 2. Kolejka skanów — IndexedDB (`src/features/offline/scanQueue.ts`)
- Rekord: `{id, kind: 'order'|'stock', containerId, code, ts}`.
- `enqueue/getAll/remove/count`.
- Pure helper `summarizeSync(results)` → `{sent, rejected, details[]}` (TDD vitest).

### 3. Integracja w MobilePakowaniePage
- Stan `online` (navigator.onLine + zdarzenia online/offline), `pendingCount`.
- Skan: próba API; przy błędzie sieci/offline → enqueue + optymistyczny `packedQty++`
  + feedback „zakolejkowano — czeka na sieć".
- Flush przy zdarzeniu `online`/wejściu: dosyła kolejkę po kolei wg `kind`
  (`palletsApi.packUnit` / `stockCartonsApi.scan`), zbiera wynik, usuwa z kolejki,
  pokazuje raport „Wysłano N, odrzucono M (powody)".
- UI: wskaźnik online/offline + licznik oczekujących.

### 4. Backend — idempotencja skanu
- `scan_unit_into_carton`: sztuka już w TYM kartonie → zwróć OK (nie 409), żeby
  ponowienie/dubel z kolejki nie wywalał błędu ani nie podwajał. (TDD)
- Palety: `pack_unit_into_pallet` zwraca `ok:false` dla już-spakowanej (bez podwajania,
  bo sprawdza pallet_id) — przy flushu traktujemy „już na tej palecie" łagodnie.

## Testy (TDD)
- `summarizeSync` (czysta): agregacja wyników (sent/rejected/details).
- backend: scan idempotentny (ta sama sztuka 2× do tego kartonu → 1 sztuka, OK).
- SW + IndexedDB: weryfikacja ręczna (DevTools offline / Playwright opcjonalnie).

## Ryzyka
- Stale cache po deployu → navigation network-first + cache-first tylko dla
  zahashowanych plików (immutable) → bezpieczne; SW auto-update (skipWaiting).
- Konflikty przy synchronizacji → raport pokazuje odrzucone, operator poprawia.

## Poza zakresem (YAGNI)
- Offline dla innych ekranów (produkcja, karta sztuki).
- Walidacja lokalna na telefonie (wybrano optymistycznie).
- Lokalny serwer na hali (wybrano VPS/internet).
