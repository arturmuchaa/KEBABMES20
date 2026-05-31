# Rozbiór HMI v4 — dopracowanie paska górnego, sekcji i KPI

Data: 2026-05-31
Plik: `kebab_fixed/src/pages/tablet/DeboningHmiV4Page.tsx` (tylko ten — v4 to niezależna warstwa prezentacji; klasyk/v2/v3 nietknięte). Dane: istniejące `useProductionSession` / `useDeboningEntries` / `useApi`.

## Cel
Czytelniejszy, „idiotoodporny" panel dla dużego zakładu. Mniej tekstu w pasku górnym, brak przewijania w lewej kolumnie, sensowny zestaw KPI na dole, dwa nowe widoki (historia, statystyki) w modalach.

## Motyw jasny — „Grafit jasny"
Panele nie czysto białe, tło stalowo-szare, wyraźne ramki.
`--app #dfe3e8 · --panel #eef1f5 · --panel2 #e2e7ee · --bd #b8c0cc · --bd2 #cdd4dd · --ink #1a2230 · --mut #586273`.
Semafory bez zmian: `--grn #15803d · --amb #b45309 · --red #dc2626 · --blu #1d4ed8`. Dark bez zmian.

## Pasek górny
- Lewa: **jedna kropka** statusu (zielona = online / czerwona = offline; offline = `batchData.error`) + `ROZBIÓR` + podtytuł.
- Środek (tag-cells): **Partie: N** (liczba aktywnych) · **Pozostało: X kg** (suma `kgAvailable` aktywnych partii) · zegar.
- Prawa: **Operator** (nazwa wybranego lub „—") + przełącznik motywu. Alerty FEFO zostają (czerwony badge).

## Obszar główny (3 kolumny)
- **Lewa — partie:** max **6 najpilniejszych FEFO** (`batches.slice(0,6)`), grid 2 kol, **bez scrolla**. Sekcja `flex-shrink-0`.
- **Lewa — operatorzy:** sekcja `flex-1`, **większe kafle** (`min-h-[68px]`), bez przewijania dla typowej obsady.
- **Środek:** readouty (ćwiartka/mięso) + pasek wydajności + keypad — jak teraz (logika v2/v4).
- **Prawa — operacje:** `ZAPISZ` (flex-1) · `Zakończ partię` · wiersz 2 przyciski `Historia` | `Statystyki` · `Zakończ zmianę`.

## Dolny pasek KPI (styl v4, 6 komórek)
Ćwiartka dziś (`Σ kgTaken`) · Mięso (`Σ kgMeat`) · Wydajność % (`meat/taken`) · Grzbiety (`Σ kgBacks`) · Kości (`Σ kgBones`) · Wpisy (liczba). Pasek wpisów (EntriesStrip) zostaje nad KPI.

## Modale
- **Historia wpisów:** pełna lista dzisiejszych wpisów (od najnowszego): czas (`createdAt`), partia, operator, ćwiartka→mięso, %, grzbiety/kości. Przewijalna.
- **Statystyki (live z dnia):** grupowanie po `workerId` → tabela: operator · ćwiartka pobrana (kg) · mięso (kg) · % uzysku. Sortowanie malejąco po mięsie. Wiersz „Razem".

## Niezmienne zasady
Anti-flicker: stan selekcji lokalny, memo kafli/pasków, izolowane timery (zegar 1s, KPI 30s), `useApi` pomija setData przy identycznym pollu. Modale jako warunkowy overlay (jak `finishModal`/`shiftModal`), bez remountu obszaru roboczego.
