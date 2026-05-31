# Rozbiór HMI v2 — projekt nowego interfejsu operatora hali

**Data:** 2026-05-31
**Zakres:** wyłącznie moduł rozbioru (`/tablet/rozbior`). Mieszanie/produkcja bez zmian.
**Cel deploya:** web MES serwowany przez nginx na porcie 8080 (ekran na hali). Desktop (Tauri)
i backend bez zmian — nowy HMI to wyłącznie warstwa prezentacji nad istniejącymi hookami.

## Problem

Obecny `DeboningTabletPage.tsx` to wąska kolumna (`max-w-3xl mx-auto`) zaprojektowana pod telefon.
Na hali działa na ekranie **19"/21" w poziomie**, obsługiwany **w rękawicach, przy wodzie**, przez
operatora, który **nie powinien myśleć nad UI**. Wymagania: maksymalna czytelność, wielkie cele
dotykowe, zero scrolla w głównej pętli, **zero mikrorefreshy** (migotania) oraz wpisywanie wagi
**bez fizycznej klawiatury** (numpad ekranowy).

## Rozwiązanie — architektura

- Nowy komponent `src/pages/tablet/DeboningHmiPage.tsx` (HMI v2). Klasyczny ekran zostaje **nietknięty**.
- Przełącznik trybu: hook `src/features/deboning/useHmiMode.ts` — `useSyncExternalStore` nad wartością
  modułową + `localStorage` (`rozbior_hmi_v2`). Przełącznik działa per-urządzenie, trwały po reloadzie.
- `src/pages/tablet/RozbiorRoute.tsx` — komponent-przełącznik renderujący klasyk albo HMI v2 zależnie
  od trybu. Trasa `/tablet/rozbior` w `App.tsx` wskazuje na ten przełącznik.
- Przycisk „Nowy HMI / Klasyczny" w nagłówku `TabletLayout` — widoczny **tylko** na `/tablet/rozbior`.
- Dane i logika: reużycie `useProductionSession`, `useDeboningEntries`, `rawBatchesApi`, `usersApi`,
  `calcDeboning`, `getExpiryStatus`. Zero nowych endpointów.

## Layout (landscape, jeden ekran, bez scrolla w pętli głównej)

- **Nagłówek (TabletLayout):** tytuł „Rozbiór", zegar, przełącznik trybu.
- **Pasek statusu sesji:** ● SESJA OTWARTA · data · godzina; alert FEFO gdy partia ≤ 2 dni.
- **Lewa kolumna (selekcja, sticky):** KROK 1 — kafle partii (sort FEFO), KROK 2 — kafle pracowników.
  Zaznaczenie mocno podświetlone. Wybrane raz, „lepkie" dla wielu wpisów.
- **Prawa kolumna (ważenie — dominująca akcja):**
  - Dwa duże wyświetlacze: ĆWIARTKA (kgTaken) i MIĘSO (kgMeat). Jeden „aktywny" (podświetlony),
    tap przełącza cel wpisywania.
  - **Numpad ekranowy:** klawisze ≥ 72 px (`7 8 9 / 4 5 6 / 1 2 3 / 0 . ⌫`), działa w rękawicach.
  - Pasek wydajności + wartość %. Wielki komunikat „⛔ ZA DUŻO" gdy `kgTaken` > stan partii.
  - Przycisk **ZAPISZ WPIS** pełnej szerokości, aktywny tylko gdy wpis poprawny.
- **Pasek dolny:** chipy „DZIŚ" (wpisy bieżącej sesji, scroll poziomy), „Zakończ partię", „Zakończ zmianę".

## Zasady HMI

- Cele dotykowe min. 64–80 px; grube obrysy; wysoki kontrast (mokre ręce, odbicia).
- Kolor = znaczenie: zielony OK, bursztyn uwaga, czerwony błąd/przeterminowane.
- Stałe pozycje elementów — nic nie skacze, nic nie znika.
- Reużycie tokenów Tailwind (`ink/surface/brand/success/warn/danger`) — spójność z resztą aplikacji.

## Anti-flicker (ZERO mikrorefreshy)

- `useApi` już pomija `setData` przy identycznym wyniku pollingu (JSON-equality) — brak re-renderu
  gdy poll nic nie zmienia.
- Obszar ważenia trzyma **stan lokalny** (selBatch, selWorker, kgTaken, kgMeat) — poll nie kasuje wpisu.
- Kafle (`BatchTile`/`WorkerTile`) i pasek wpisów wydzielone jako `memo` ze stabilnymi kluczami →
  zmiana danych nie re-renderuje strefy wpisywania, brak migotania pętli głównej.

## Logika domenowa (bez zmian względem klasyka)

- Zapis wpisu: `addEntry({sessionId, rawBatchId, workerId, kgTaken, kgMeat})`.
- „Zakończ partię": modal kości/grzbietów — sugestia z `calcDeboning(sumaTaken, sumaMeat)`,
  rozkład proporcjonalny `kgBacks`/`kgBones` na niezakończone wpisy (te z `kgBacks==0 && kgBones==0`).
- „Zakończ zmianę": `closeDay()`.
- Block-screeny: brak sesji → „Rozpocznij dzień"; sesja closed/approved → ekran zablokowany.
- HACCP: blokada partii przeterminowanej (zachowana w hookach).

## Poza zakresem (YAGNI)

- Brak nowych endpointów, brak zmian w backendzie, desktopie, mieszaniu/produkcji.
- Brak motywu ciemnego (na razie), brak konfigurowalności układu.
