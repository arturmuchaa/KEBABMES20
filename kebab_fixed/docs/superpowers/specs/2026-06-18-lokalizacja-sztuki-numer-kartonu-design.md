# Lokalizacja sztuki, globalny numer kartonu i domknięcie łańcucha partii

Data: 2026-06-18 · Status: zatwierdzony (brainstorming)

## Cel
Sztuka (finished_unit) i partia mają być w pełni czytelne dla hali i biura:
gdzie fizycznie jest kebab, w jakim kartonie, oraz pełny łańcuch aż do wyrobu
gotowego. Dochodzi globalny, unikalny numer kartonu.

Ustalenia z brainstormingu:
- **Karton = paleta** (`order_pallets`). Nie wprowadzamy osobnej encji kartonu —
  paleta dostaje globalny unikalny numer.
- **Biuro**: oba — podsumowanie lokalizacji per partia **i** wyszukiwarka sztuki po QR.

## Zakres (5 elementów)

### 1. Lokalizacja sztuki wg statusu (wspólna logika)
Jedna funkcja TS `unitLocation(status, cartonNo, clientName)` (testowana vitest),
używana w skanerze mobilnym i w biurze:

| status sztuki | lokalizacja |
|---|---|
| `planned` | „W produkcji" |
| `produced` | „Mroźnia szokowa" |
| `packed` | „Karton {cartonNo} · Mroźnia składowa" |
| `shipped` | „Wydano do klienta: {clientName}" |

### 2. Globalny numer kartonu (= paleta)
- Migracja: `order_pallets.carton_no INTEGER` (+ indeks). Brak backfillu (baza po czyszczeniu).
- Nadawany **przy tworzeniu palety** z licznika `next_seq('carton_seq')`.
- Format 6-cyfrowy: `format_carton_no(n) -> "000001"`. Po czyszczeniu start od 000001.
- UI: numer w **lewym górnym rogu** karty palety (ekran pakowania: aktywna paleta +
  lista „do spakowania"; oraz `PalletsEditor`).
- Wydruk (`PalletLabelPrintPage`): numer **mały, prawy górny róg** etykiety.

### 3. Tuleja w skanerze sztuki
`MobileSztukaPage` już renderuje Tuleję; `lookup_unit` już zwraca `tuleja`.
Zapewnić, że sztuki produkcyjne niosą tuleję (kopiowana z linii planu przy tworzeniu).
Weryfikacja + ewentualny fix danych.

### 4. Biuro — wyroby gotowe (`FinishedGoodsPage`)
- **Podsumowanie lokalizacji per partia**: rozkład sztuk po statusach,
  np. „8× szokowa · 4× karton 000042/składowa · 2× wydane".
  Backend: rozszerzenie listy wyrobów / nowy endpoint zliczający finished_units
  per partia wg statusu (+ numery kartonów dla packed).
- **Wyszukiwarka sztuki po QR**: pole → `lookup_unit` → ta sama karta co mobile
  (współdzielony komponent karty + helper lokalizacji).

### 5. Domknięcie łańcucha partii do wyrobu gotowego
`MobilePrzeplywPartiiPage` ma już krok „Produkcja / wyrób", ale
`traceability_service._trace_backward` nie dociąga wyrobów, gdy wejściem jest
partia przyprawionego (idzie tylko w tył). Fix: gdy wejście to seasoned/meat,
doszukać finished_goods zawierające tę partię przyprawionego (po
`seasoned_batch_nos`/`source_seasoned_ids`) i dodać do `finishedGoods`.
Etykieta kroku: **`ddmmrr nrpartii`** (data produkcji + batch_no wyrobu).

## Backend — zmiany
- `migrations.py`: kolumna `order_pallets.carton_no` + indeks.
- `app/utils/ids.py` (lub pallets util): `format_carton_no(n)`.
- `pallets_service.py`: nadanie `carton_no` przy każdym tworzeniu palety.
- `finished_units_service.lookup_unit`: dołącz `cartonNo` (join `order_pallets`
  po `pallet_id`), zwróć `clientName`, `status`, `tuleja` (już jest).
- `finished_goods_service` / nowy serwis: `location_summary_by_batch()`.
- `traceability_service._trace_backward`: domknięcie do finished_goods od partii
  przyprawionego.

## Frontend — zmiany
- `src/lib/unitLocation.ts` (+ test vitest).
- `MobileSztukaPage`: lokalizacja z helpera; wyodrębnienie karty sztuki do
  współdzielonego komponentu (użycie w biurze).
- `MobilePakowaniePage`, `PalletsEditor`: numer kartonu (lewy górny).
- `PalletLabelPrintPage`: numer kartonu (mały, prawy górny).
- `FinishedGoodsPage`: podsumowanie lokalizacji per partia + wyszukiwarka sztuki.
- `MobilePrzeplywPartiiPage`: etykieta wyrobu `ddmmrr nrpartii`.

## Testy (TDD)
- Backend: `format_carton_no`; carton_no nadawany przy tworzeniu palety;
  `lookup_unit` zwraca cartonNo dla packed; `location_summary_by_batch` zlicza
  statusy; backward trace dociąga wyrób od partii przyprawionego.
- Frontend: `unitLocation` (wszystkie 4 statusy) — vitest.

## Poza zakresem (YAGNI)
- Osobna encja kartonu (sztuki→karton→paleta) — odrzucone, karton = paleta.
- Zmiana numeracji palet per-zamówienie (P1/P2 zostaje, dochodzi tylko globalny carton_no).
