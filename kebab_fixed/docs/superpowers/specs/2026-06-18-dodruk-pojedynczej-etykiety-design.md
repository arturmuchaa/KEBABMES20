# Dodruk pojedynczej etykiety sztuki (awaria druku QR)

Data: 2026-06-18 · Status: zatwierdzony (brainstorming)

## Problem
Drukarka wydrukowała zamazany QR jednej sztuki (18 szt./40kg, zeskanowano 17,
1 nie do zeskanowania). Dziś druk etykiet (`LabelPrintPage`, `/etykiety/druk?planLineId=`)
drukuje WSZYSTKIE sztuki linii planu naraz — brak dodruku pojedynczej.

## Decyzje (brainstorming)
- Miejsce: **Biuro → Planowanie produkcji** (przy linii planu).
- Wybór: **lista sztuk ze statusem, dodruk wybranej** (zwykle niezeskanowanej).
- Reprint = ten sam QR (`U|<unit_id>`) → bez nowej sztuki, bez wpływu na traceability.

## Zakres (tylko frontend, zero zmian backendu)
`finishedUnitsApi.listByPlanLine` już zwraca sztuki ze statusem + qrCode.

### 1. LabelPrintPage — parametr `unitIds`
- Czyta `unitIds` (CSV) z query. Gdy ustawiony → drukuje TYLKO te sztuki
  (filtr po `unit.id`). Bez parametru = dotychczasowe zachowanie (wszystkie).
- Helper czysty `filterUnitsByIds(units, ids)` (vitest).

### 2. ProductionPlanningPage — „Dodruk etykiet" per linia
- Przy linii planu przycisk „Dodruk etykiet" → `UnitReprintModal`.
- Modal: lista sztuk (`listByPlanLine(line.id)`) — nr/partia, status
  (Zeskanowana / **Niezeskanowana** podświetlona), numer kartonu jeśli jest.
- Przy każdej sztuce „Dodrukuj" → otwiera `/etykiety/druk?planLineId=&clientId=&recipeId=&unitIds=<id>`
  (clientId=clientName, recipeId — jak w istniejącym handleGenerateLabels).
- Status → etykieta: `planned` = Niezeskanowana, `produced/packed/shipped` = Zeskanowana
  (helper `isScanned(status)`).

## Testy (TDD, vitest)
- `filterUnitsByIds`: zwraca podzbiór po idach; pusty zbiór idów → wszystkie (lub puste?
  → wszystkie, bo brak filtra); nieistniejące idy → puste.
- `isScanned`: planned→false; produced/packed/shipped→true; nieznany→false.

## Poza zakresem (YAGNI)
- Dodruk na tablecie/mobile (wybrano: biuro).
- „Dodrukuj wszystkie niezeskanowane" jednym klikiem (wybrano: dodruk wybranej;
  można dołożyć później).
- Zmiany w backendzie / nowe endpointy.
