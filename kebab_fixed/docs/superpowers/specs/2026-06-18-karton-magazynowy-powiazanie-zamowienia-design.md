# Karton magazynowy z ręki + powiązanie z zamówieniem

Data: 2026-06-18 · Status: zatwierdzony (brainstorming) · Podejście: A (reuse finished_goods)

## Problem
Biuro robi karton „na magazyn" (np. 15×50kg) zanim wpłynie zamówienie. Dziś
karton (= paleta `order_pallets`) wymaga `order_id NOT NULL`, więc nie da się go
utworzyć bez zamówienia. Gdy wpadnie pasujące zamówienie, system ma zaproponować
powiązanie kartonu z zamówieniem.

## Decyzje (z brainstormingu)
- **Podejście A**: karton magazynowy = wpis `finished_goods` na magazyn (puste
  `client_order_no`). Reuse istniejącego `order_stock_service` + dokumentów.
- Karton ma **z góry przypisanego klienta**.
- Dopasowanie po: **client_id + recipe_id + product_type_id + packaging (tuleja) + kg_per_unit**.
- Powiązanie: **system sugeruje, biuro zatwierdza** jednym klikiem.

## Model (finished_goods + 2 kolumny)
- `carton_no INTEGER` — globalny numer, wspólny licznik `next_seq('carton_seq')`
  z paletami (unikalny w całym systemie). Obecność carton_no = karton magazynowy.
- `client_id TEXT` — pewne dopasowanie klienta (zamówienia mają client_id).
- Tuleja = istniejące `packaging_id`/`packaging_name` (bez nowej kolumny).

## Backend
- **migrations.py**: `ALTER TABLE finished_goods ADD COLUMN carton_no INTEGER`,
  `ADD COLUMN client_id TEXT`.
- **finished_goods_service.create_stock_carton(dto)**: nakładka na `create_finished_good`
  — `client_order_no` puste, nadaje `carton_no = next_seq('carton_seq')`, zapisuje
  `client_id`, zużywa tuleję (jak dziś). Zwraca wiersz z carton_no.
- **stock_carton_match_service** (nowy, izolowany):
  - `match_cartons(order_lines, cartons)` — CZYSTA funkcja: dla każdej linii znajduje
    pasujące kartony po (client_id, recipe_id, product_type_id, packaging_id, kg_per_unit).
    Zwraca `[{cartonId, orderLineId, qty, kgPerUnit, matches: bool}]`.
  - `suggestions_for_order(order_id)` — DB wrapper: ładuje zamówienie + linie +
    kartony magazynowe (carton_no IS NOT NULL, client_order_no pusty, qty_available>0),
    woła `match_cartons`.
- **finished_goods_service.assign_stock_carton_to_order(carton_id, order_id)**:
  waliduje zgodność specyfikacji (inaczej 409), stempluje `client_order_no = order_no`,
  uzupełnia `client_id`/`client_name` z zamówienia. Dalej `order_stock_service` liczy
  karton do pokrycia, dokumenty bez zmian.
- **Routes**:
  - `POST /api/finished-goods/stock-carton` → create_stock_carton
  - `GET  /api/client-orders/{id}/stock-carton-suggestions` → suggestions_for_order
  - `POST /api/client-orders/{id}/assign-stock-carton` {carton_id} → assign

## Frontend
- **api.ts**: stockCartonCreate, stockCartonSuggestions(orderId), assignStockCarton(orderId, cartonId).
- **FinishedGoodsPage**: przycisk/modal „Dodaj karton z ręki" (klient + receptura +
  rodzaj + tuleja + ilość × waga). Po zapisie odświeżenie + numer kartonu.
- **ClientOrdersPage**: panel „Pasujące kartony z magazynu" pod zamówieniem —
  lista z ✓ zgodności + przycisk **Przypisz** (assign → refresh).

## Testy (TDD)
- `match_cartons` (pure): zgodność po 5 kryteriach; odrzucenie przy różnym rodzaju/
  tulei/wadze/kliencie; brak kartonów → puste.
- `create_stock_carton` (DB): nadaje carton_no, client_order_no puste, qty_available=qty.
- `assign_stock_carton_to_order` (DB): stempluje client_order_no; niezgodna spec → 409.

## Poza zakresem (YAGNI)
- Automatyczne przypisanie bez potwierdzenia (odrzucone — ryzyko pomyłki fizycznej).
- Karton magazynowy bez klienta / generyczny (odrzucone — wybrano „z góry klient").
- Rozbicie kartonu na pojedyncze finished_units (karton = wiersz finished_goods qty×waga).
