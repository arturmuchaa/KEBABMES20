# SP-2b — WZ zintegrowany: wydanie → WZ, ceny później, WZ z zamówienia

Data: 2026-06-07
Status: spec do przeglądu
Zależności: SP-1 (rdzeń WZ), SP-2a (`_insert_wz`, `create_stock_movement(source_type='wz')`) — ZROBIONE.

## Kontekst i cel

Decyzja właściciela: **WZ zawsze robi rozchód**. SP-2a pokrył tryb ręczny.
SP-2b integruje WZ z istniejącymi przepływami tak, by **nie liczyć stanu
podwójnie** i by każde wydanie towaru miało WZ. Trzy spójne części:

- **A. Zamknięcie wydania → WZ** — `close_dispatch` generuje WZ z zawartości
  wydania i przypisuje swój (jeden) rozchód do tego WZ.
- **B. Doliczanie cen na WZ** — WZ z wydania jest ilościowy (status wstępny);
  biuro uzupełnia ceny później na liście WZ.
- **C. WZ z zamówienia** — biuro generuje WZ z pozycji zamówienia
  (`qty_done`), z flagą „może brakować".

**Kolejność wdrożenia:** 2b-1 (A+B) → 2b-2 (C). Ryzykowny refaktor
`close_dispatch` izolowany w 2b-1, z testami na `loose_dispatch`.

**Założenie procesowe (zaakceptowane):** import z zamówienia (C) i przepływ
wydania (A) to dwie drogi wydania tych samych sztuk. Operator wybiera JEDNĄ —
podwójne policzenie przy użyciu obu jest ryzykiem procesowym, nie blokowanym
kodem (jak dziś WZ ręczny vs wydanie).

## A. Zamknięcie wydania → WZ (`close_dispatch`)

Stan obecny (`dispatches_service.close_dispatch`): w transakcji pobiera sztuki
wydania, `group_units_for_out` → grupy `(produced_date, batch_no, recipe_id) →
{count, kg}`, dla każdej grupy zdejmuje `finished_goods` (qty_available−,
qty_shipped+) i woła `create_stock_movement(source_type="dispatch",
source_id=dispatch_id)`; potem sztuki `shipped`, wydanie `shipped`.

Zmiana (minimalna, ta sama logika OUT):
1. Przed pętlą rozchodu zbuduj nabywcę z klienta wydania:
   `clients` po `disp.client_id` → `{name, address(=address+' '+city), nip}`
   (fallback `disp.client_name`).
2. Zbuduj pozycje WZ z grup: dla każdej grupy jedna linia
   `{name: <nazwa receptury z recipes.name po recipe_id, fallback 'Kebab'>,
   qty: count, unit: 'szt', price: 0, batch_no, stock_type: 'fg'}`
   (ilościowa — `valued=False`).
3. Idempotencja: jeśli istnieje WZ `(source_type='dispatch', source_id=
   dispatch_id)` — użyj jego `id`; inaczej `wid = _insert_wz(conn,
   source_type='dispatch', source_id=dispatch_id, valued=False, ...)`.
4. W istniejącej pętli rozchodu zmień TYLKO atrybucję ruchu:
   `create_stock_movement(..., source_type="wz", source_id=wid)`.
5. Zwróć `wzId`/`wzNumber` w odpowiedzi `close_dispatch`.

Brak nowej tabeli; brak zmiany liczby ruchów magazynowych (nadal jeden OUT na
grupę). Zmienia się tylko `source_type/source_id` ruchu + powstaje dokument WZ.

## B. Doliczanie cen na WZ

`wz_service.update_wz_prices(wz_id, prices)`:
- `prices` = lista `[{index, price}]` (index pozycji w `lines`).
- Dozwolone tylko gdy `status='wstepny'` (inaczej `409`).
- Ustawia `price`/`value=qty*price` na wskazanych pozycjach, `valued=True`,
  przelicza `total_value=Σ value`. Zwraca zaktualizowany dokument.
- `PATCH /api/wz/{id}/prices`.
- UI: na `WzDocumentsPage` przy WZ `valued=false` przycisk „Uzupełnij ceny" →
  prosty edytor (cena per pozycja) → zapis.

## C. WZ z zamówienia

`wz_service.create_wz_from_order(order_id)`:
- Pozycje z `production_plan_lines` zamówienia (jak `hdi_service.build`):
  `qty_done`, `kg_per_unit`, `recipe_name`, `batch_allocation` (partia per
  sztuka). Linia per (receptura, partia) z `qty`, `unit='szt'`, `price=0`,
  `batch_no`, `stock_type='fg'`.
- Flaga `incomplete`: `produced (Σ qty_done) < ordered (Σ client_order_lines.qty)`
  — zapisywana w `notes`/zwracana (info dla biura „może brakować"), dokument
  i tak powstaje (jak HDI `incomplete`).
- Rozchód z magazynu FG dla wyprodukowanych ilości — wzorzec rozchodu z
  `close_dispatch` (grupy po partii/recepturze, `finished_goods` FOR UPDATE,
  qty_available−/qty_shipped+, ruch OUT `source_type='wz'`). Gdy stanu brak →
  `400` + rollback (cały WZ wycofany).
- Idempotencja per `(source_type='order', source_id=order_id)`.
- `POST /api/wz/from-order?order_id=...`. UI: przycisk „WZ z zamówienia" na
  liście zamówień (`ClientOrdersPage`).

## Model danych

Bez nowych tabel. `wz_documents.source_type` rozszerza dozwolone wartości o
`'dispatch'` i `'order'` (kolumna tekstowa — bez migracji). Pozycje WZ niosą
`stock_type='fg'`/`batch_no` (jak w SP-2a).

## Obsługa błędów

- `close_dispatch` bez sztuk → `400` (jak dziś); brak stanu FG → `400` +
  rollback (jak dziś).
- `update_wz_prices` na WZ `status≠wstepny` → `409`; zła pozycja → `400`.
- `create_wz_from_order` bez wyprodukowanych pozycji → `400 „Brak
  wyprodukowanych pozycji do WZ"`; brak stanu → `400` + rollback.

## Testy (czyste, styl `backend/tests/`)

- `build_dispatch_wz_lines(groups, recipe_names)` (czysta): grupy →
  pozycje ilościowe (name z receptury, qty=count, unit='szt', batch_no);
  brak ceny (valued budowane osobno).
- `apply_wz_prices(lines, prices)` (czysta): nakłada ceny na pozycje, liczy
  `value`/sumę; pomija indeksy spoza zakresu.
- `wz_order_incomplete(produced, ordered)` (czysta): `produced<ordered → True`.
- Integracyjnie (smoke na bazie, jak w SP-2a): zamknięcie testowego wydania
  tworzy WZ i jeden OUT pod `source_id=wz`; brak podwójnego ruchu.

## Poza zakresem

- SP-2c: auto HDI (zawsze) + CMR (zagraniczny) spięte z WZ.
- SP-3: sprzedaż/utylizacja ABP (kości/grzbiety) + dokument handlowy ABP.
- Korekta/storno WZ (zwrot na stan) — przyszłość.
