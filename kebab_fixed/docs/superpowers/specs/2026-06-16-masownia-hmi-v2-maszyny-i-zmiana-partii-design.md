# HMI v2 masowania — maszyny w trakcie + kg-z-partii + zmiana partii

Data: 2026-06-16
Zakres: tylko `src/pages/tablet/MixingHmiV2Page.tsx` (HMI v2 masowania). Bez zmian w v1/klasycznym.

## Problem

Operator po wczytaniu wszystkich zaplanowanych zleceń do maszyn widzi komunikat
„Biuro nie zaplanowało masowania", ale:

1. **Znikają maszyny w trakcie.** Panel „Masownice w pracy" (kafelki z timerami) jest
   renderowany tylko w gałęzi `orders.length > 0`. Stan pusty (`orders.length === 0`,
   linie ~216–231) robi wczesny `return` z samym komunikatem — choć masownice dalej
   chłodzą (50 min) i operator nie widzi które maszyny pracują ani ile czasu zostało.
2. **Brak rozbicia kg-z-partii na liście zlecenia.** Karta zlecenia pokazuje tylko
   „X partie", bez informacji ile kg z której partii zaplanowano.
3. **Brak możliwości zmiany partii.** Gdy zaplanowanej partii nie ma fizycznie na
   magazynie, operator nie może podmienić jej na inną dostępną.

## Ustalenia (decyzje użytkownika)

- **Zmiana partii — „oba"**: szybka podmiana per sesja (ślad) ORAZ opcja trwałej
  aktualizacji planu zlecenia.
- **Walidacja — tylko ze stanu**: lista zastępczych partii ograniczona do faktycznie
  dostępnych na magazynie, FEFO, blokada gdy za mało kg.
- **Panel maszyn — zawsze widoczny**, także w stanie pustym.

## Stan obecny (fakty z kodu)

- Flow HMI v2: lista/empty (`OrderListV2`) → `MachineScreenV2` (wybór masownicy 1/2/3)
  → `MeatScreenV2` (wpisanie kg per partia) → składniki → `finishSession`.
- `MeatScreenV2` **już** pokazuje per wiersz: `meatLotNo`, `rawBatchNo`, maks. `kgPlanned`,
  `expiryDate` — czyli kg-z-partii na ekranie mięsa już jest.
- Komponent `ActiveMachineTile` (timer z `lock.unlocksAt`) istnieje; panel „Masownice
  w pracy" jest tylko w gałęzi z listą zleceń (linia ~315).
- Backend (`src/lib/api.ts`):
  - `mixingOrdersApi.start(id, dto)` → `PATCH /mixing-orders/{id}/start`, przyjmuje
    zmodyfikowane `meat_lots`.
  - `mixingOrdersApi.finishSession(id, kg, batchNo, lotAllocations?)` →
    `PATCH /mixing-orders/{id}/finish-session` — `lotAllocations` niesie faktycznie
    zużyte partie (haczyk śladu partii).
  - `mixingOrdersApi.dayPlan` PUT — plan biura (zawiera `meatLots`).
  - `meatStockApi.list()` → `MeatStock[]`: `lotNo`, `rawBatchNo`, `materialName`,
    `materialTypeId`, `kgAvailable` (`kg_free`), `expiryDate`, `expiryStatus`, `status`.
- Typy: `MixingOrderMeatLot { meatLotId, meatLotNo, rawBatchNo, kgPlanned, expiryDate }`,
  `MachineLock { machineId, orderId, orderNo, unlocksAt, status: 'mixing'|'cooling' }`.

## Projekt

### A. Panel „Masownice w pracy" — zawsze widoczny

- Wydzielić nowy komponent `ActiveMachinesPanel({ locks, inProgress })` opakowujący
  istniejące `ActiveMachineTile`. Każdy kafelek: nr masownicy · zlecenie/produkt
  (`recipeName`/`orderNo` z `lock`) · pozostały czas (z `unlocksAt`) · status
  `mixing/cooling`.
- W `OrderListV2` renderować `ActiveMachinesPanel` w obu gałęziach:
  - **stan pusty**: komunikat „Biuro nie zaplanowało" + `ActiveMachinesPanel` (gdy
    `locks.length > 0`) + suma pozostałych kg (jak dziś z `inProgress`).
  - **lista zleceń**: jak dziś (panel na dole), z tego samego komponentu.
- Brak nowych endpointów — dane (`locks`, `inProgress`) już są w props.

### B. Rozbicie kg-z-partii na liście zlecenia

- Na karcie zlecenia w `OrderListV2` zamiast „{n} partie" pokazać krótkie rozbicie
  partii z planu: `rawBatchNo · {kgPlanned} kg` dla każdej z `o.meatLots` (czytelne
  „chipy" lub lista). Przy wielu partiach — zwięźle, ewentualnie skrót „+N".
- `MeatScreenV2` bez zmian w tym zakresie (już pokazuje partię+kg+termin).

### C. Zmiana partii (FEFO, blokada brakiem stanu)

- Nowy komponent `BatchPickerSheet({ requiredMaterialTypeId, neededKg, onPick, onClose })`:
  - źródło: `meatStockApi.list()`,
  - filtr: `status === 'AVAILABLE'`, `kgAvailable > 0`,
    `materialTypeId === requiredMaterialTypeId` (gdy znany),
  - sort **FEFO**: `expiryDate` rosnąco; badge wg `expiryStatus`,
  - wiersz: `lotNo` · `rawBatchNo` · `materialName` · **dostępne kg** · termin,
  - **blokada**: pozycja z `kgAvailable <` potrzeba oznaczona/niewybieralna lub limit
    wpisu kg = `kgAvailable`.
- W `MeatScreenV2` każdy wiersz partii dostaje przycisk **„Zmień partię"** otwierający
  `BatchPickerSheet`. Po wyborze wiersz (lokalny stan `lots`) przyjmuje nową partię:
  `meatLotId`/`meatLotNo`(=`lotNo`)/`rawBatchNo`/`expiryDate`, a maks. kg wiersza =
  `kgAvailable` wybranej partii (zamiast `kgPlanned`).
- **Warstwa 1 (zawsze) — ślad**: faktycznie użyte partie przekazywane do
  `finishSession(..., lotAllocations)`. W pełni pokryte istniejącym endpointem.
- **Warstwa 2 (opcjonalnie) — aktualizacja planu**: przełącznik „Zaktualizuj plan
  zlecenia" przy podmienionym wierszu. Gdy zaznaczony, dodatkowo trwale podmienia
  zaplanowaną partię na zleceniu.
  - **Zależność do weryfikacji w planie**: brak dedykowanego endpointu „update
    meatLots zlecenia". Opcje do rozstrzygnięcia na etapie planu:
    (a) podpiąć pod `start` (`meat_lots`), gdy zlecenie startuje;
    (b) dodać mały endpoint backendu `PATCH /mixing-orders/{id}/meat-lots`;
    (c) zapisać przez `dayPlan` PUT.
  - Warstwa 2 może zostać wydzielona jako osobny, mniejszy krok, jeśli wymaga zmian
    backendu. Warstwa 1 musi działać niezależnie.

## Co poza zakresem (YAGNI)

- v1/klasyczny masowania.
- Zmiany w planowaniu biura (poza opcjonalną warstwą 2).
- Nowe statusy maszyn / zmiana logiki locków.

## Kryteria sukcesu

1. W stanie pustym widać aktywne masownice z numerem, zleceniem/produktem i odliczanym
   czasem.
2. Na liście zleceń widać ile kg z której partii zaplanowano.
3. Operator może podmienić zaplanowaną partię na inną dostępną (FEFO, blokada brakiem
   kg), a faktycznie użyta partia trafia do śladu (`finishSession.lotAllocations`).
4. Opcjonalnie operator może trwale zaktualizować plan zlecenia podmienioną partią.
5. Typecheck na zielono; bez zmian w v1/klasycznym.
