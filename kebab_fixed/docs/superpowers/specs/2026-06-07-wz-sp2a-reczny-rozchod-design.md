# SP-2a — Ręczny WZ z rozchodem magazynu

Data: 2026-06-07
Status: spec do przeglądu
Zależność: SP-1 (rdzeń WZ — `wz_documents`, `wz_service`, druk PDF) — ZROBIONE.

## Kontekst i cel

Sprzedaż towaru kończy się dokumentem WZ ([[kebab-wydanie-dokumenty-roadmap]]).
Decyzja właściciela: **WZ zawsze robi rozchód** ze stanu magazynowego. Żeby nie
zderzyć się z istniejącym rozchodem przy zamknięciu wydania (`dispatches`,
przepływ B1 — atomowy OUT wyrobów gotowych), wdrażamy **fazowo (podejście B)**:

- **SP-2a (ta specka)** — tryb **ręczny**: operator wybiera klienta z bazy i
  towar z magazynu (wyrób gotowy / surowiec), podaje ceny, wystawia WZ; WZ
  **zdejmuje towar ze stanu**. Brak istniejącego wydania → zero kolizji.
- **SP-2b** (osobna specka) — import z zamówienia + przekierowanie rozchodu
  zamknięcia wydania przez WZ (usunięcie podwójnego liczenia).
- **SP-2c** (osobna specka) — auto HDI (zawsze) + CMR (klient zagraniczny).

SP-2b i SP-2c są **poza zakresem**.

## Zakres SP-2a

Ekran „Nowy WZ" w biurze: klient z bazy → pozycje z magazynu (FG w szt / surowiec
w kg) + ceny ręczne → „Wystaw WZ". W jednej transakcji: walidacja stanu →
rozchód → `stock_movements` (`source_type='wz'`) → dokument WZ (reuse SP-1).
Wykrycie klienta zagranicznego z prefiksu NIP daje podpowiedź „wymagany CMR"
(samo wystawienie CMR/HDI to SP-2c).

## Model danych

Bez nowej tabeli. Rozszerzamy **pozycję WZ** (`wz_documents.lines`, jsonb) o pola
śladu magazynowego (opcjonalne, używane w trybie ręcznym):

```json
{ "name": "...", "qty": 0, "unit": "kg|szt", "price": 0, "value": 0,
  "batch_no": "347", "stock_type": "fg|raw", "stock_id": "<id>" }
```

`stock_type`/`stock_id`/`batch_no` wiążą pozycję z konkretnym rekordem
`finished_goods` lub `raw_batches`, z którego zdjęto towar — do audytu rozchodu.

Rozchód zapisujemy w istniejącym `stock_movements` przez `create_stock_movement`
(`source_type="wz"`, `source_id=<wz_id>`), spójnie z resztą ledgera.

## Komponenty

### Backend — czyste funkcje (TDD)

`app/services/wz_service.py`:

- `is_foreign_nip(nip: str) -> bool` — klient zagraniczny, gdy NIP zaczyna się od
  dwóch liter różnych od „PL" (np. `DE…`, `SK…`, `AT…`). Czyste cyfry lub `PL…`
  = krajowy. Puste = krajowy.
- `build_manual_wz_lines(selections, valued) -> (lines, total)` — mapuje wybór
  magazynu na pozycje WZ. `selections` = lista
  `{stock_type, stock_id, name, unit, qty, price, batch_no}`. Wartość = qty×price
  (gdy valued). Reużywa logiki `build_wz_lines` (cena/wartość/zaokrąglenia).

### Backend — serwis (transakcja)

`app/services/wz_service.py`:

- `create_manual_wz(buyer, selections, valued=True, place=None, issued_date=None,
  release_date=None, notes="") -> dict` — w jednej transakcji:
  1. walidacja: każdy `stock_id` istnieje i ma dość stanu
     (FG: `qty_available >= qty`; surowiec: `kg_available >= qty`); brak → `400`
     z nazwą partii i rollback całości;
  2. rozchód per pozycja:
     - **FG** (`stock_type='fg'`, qty w szt):
       `UPDATE finished_goods SET qty_available=qty_available-%s,
       qty_shipped=qty_shipped+%s` + `create_stock_movement(product_type=
       "finished_goods", batch_id=stock_id, qty=qty*kg_per_unit,
       movement_type="OUT", source_type="wz", source_id=wz_id)`;
     - **surowiec** (`stock_type='raw'`, qty w kg):
       `UPDATE raw_batches SET kg_available=GREATEST(0, kg_available-%s)` +
       `create_stock_movement(product_type="raw", batch_id=stock_id, qty=qty,
       movement_type="OUT", source_type="wz", source_id=wz_id)`;
  3. utworzenie dokumentu WZ: numer `WZ/NN/MM/RR`, `source_type='manual'`,
     `source_id=NULL` (zawsze nowy), `lines` ze śladem magazynowym, `valued`,
     sprzedający z `get_company()`, nabywca z `buyer`.
  Numer i wstawienie WZ wykonujemy w **tej samej** transakcji co rozchód
  (spójność: albo cały WZ + rozchód, albo nic). W praktyce kod rozchodu używa
  `cx_*` na `conn`, a wstawienie dokumentu — wydzielona funkcja
  `_insert_wz(conn, ...)` współdzielona z `generate_wz`.

### Backend — API

`app/routes/wz.py`:

- `GET /api/wz/stock/finished-goods` — pozycje FG z `qty_available > 0`
  (id, batch_no, recipe_name, product_type_name, qty_available, kg_per_unit).
- `GET /api/wz/stock/raw` — partie surowca z `kg_available > 0`
  (id, internal_batch_no, supplier_name, kg_available).
- `POST /api/wz/manual` — body: `{ buyer:{name,address,nip}, clientId?,
  valued, place?, issuedDate?, releaseDate?, notes?, items:[{stockType,
  stockId, qty, price, name?, unit?, batchNo?}] }` → `create_manual_wz`.

### Front

- Ekran `/office/wz/nowy` (`WzNewPage`):
  - wybór klienta z bazy (`clientsApi.list`) → autouzupełnia name/address/nip;
    `is_foreign_nip(nip)` po stronie front (lub flaga z odpowiedzi) → baner
    „Klient zagraniczny — wymagany CMR (SP-2c)";
  - dodawanie pozycji: przełącznik magazyn **Wyrób gotowy / Surowiec** → picker
    z `wzApi.stockFg()` / `wzApi.stockRaw()`; wybór + ilość + cena ręczna;
  - „Wystaw WZ" → `wzApi.createManual(...)` → przekierowanie na wydruk
    `/office/wz/:id/druk`.
- `wzApi` (w `src/lib/api.ts`): `stockFg()`, `stockRaw()`, `createManual(body)`.
- Wejście z `WzDocumentsPage` (przycisk „Nowy WZ") + trasa w `App.tsx`.

## Walidacja i błędy

- Brak pozycji → `400 „WZ wymaga co najmniej jednej pozycji"`.
- Niewystarczający stan → `400` z nazwą partii i ilością brakującą; cała
  transakcja wycofana (żaden rozchód nie zostaje).
- `stock_id` nieistniejący → `400 „Pozycja magazynowa nie istnieje"`.
- Ujemna/zerowa ilość → `400`.

## Testy (czyste, styl `backend/tests/`)

- `is_foreign_nip`: `"1234567890"`→False; `"PL1234567890"`→False; `"DE123"`→True;
  `"sk999"`→True (case-insensitive); `""`→False; `"  AT12 "`→True (trim).
- `build_manual_wz_lines`: FG + surowiec → poprawne `unit` (szt/kg), wartość
  qty×price, suma; `valued=False` → bez cen; zachowuje `stock_type/stock_id/batch_no`.

## Poza zakresem (kolejne specki)

- SP-2b: import z zamówienia (pozycje + flaga „może brakować") + rozchód
  zamknięcia wydania przez WZ.
- SP-2c: auto HDI (zawsze) + CMR (zagraniczny) spięte z WZ.
- Korekta/anulowanie WZ (zwrot na stan) — przyszłość, jeśli będzie potrzebne.
