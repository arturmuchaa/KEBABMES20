# Projekt (Część B1): Model wydania + zejście ze stanu + wydanie luzem (ad-hoc)

Data: 2026-06-03
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: [[kebab-wydanie-dokumenty-roadmap]], [[2026-06-03-pakowanie-po-kliencie-design]]

## Kontekst

Wszystko w produkcji kończy się **wydaniem zewnętrznym** — sztuki schodzą ze stanu.
Dwie skale: cała ciężarówka (wielu klientów / palety) oraz drobne wydanie luzem (klient
przyjeżdża po kilka sztuk). Dokumenty (WZ/HDI/CMR) są **per klient**. Wybrany model
(dwupoziomowy):

- **wyjazd** (transport: pojazd, data) — grupuje wydania jednej ciężarówki. **Należy do B2.**
- **wydanie** (per klient) — jednostka dokumentów; może być częścią wyjazdu albo luźne
  (ad-hoc, bez wyjazdu).

Tryb: hybryda — biuro planuje wyjazdy (B2), ale magazyn może też utworzyć **wydanie luzem
w locie** (B1).

### Zakres B1 (ten spec)

Fundament modelu wydania + przepływ **wydania luzem ad-hoc**:
- byt `dispatches` (wydanie), `finished_units.dispatch_id`, status `shipped`;
- mobilny tryb „Wydanie luzem": magazynier wybiera klienta → skanuje sztuki → zatwierdza
  → sztuki `shipped` (schodzą ze stanu);
- skład partii per wydanie (dane pod dokumenty C).

### Poza zakresem B1

- **B2:** tabela `dispatch_trips` (wyjazd), planowanie w biurze, skan palet na wyjazd,
  grupowanie per klient. `dispatches.trip_id` jest już przewidziane (nullable), ale sama
  tabela wyjazdu i wpinanie palet — w B2.
- **C:** generowanie dokumentów WZ/HDI/CMR (B1 dostarcza tylko dane: skład partii,
  klienta, wagi).
- Integracja z `stock_movements` (OUT) — patrz „Otwarte kwestie".

### Stan zastany (istotny)

- `finished_units`: statusy `planned → produced → packed → shipped` (`SHIPPED="shipped"`
  już w `unit_codes.py`). Ma `client_name`, `status`, `weight_kg`, `batch_no`, `pallet_id`.
- Reguła klienta z Części A: `unit_codes._client_matches(unit_client, target_client)` —
  „na magazyn"/pusty = wildcard, porównanie bez wielkości liter. **Reużywamy.**
- `clients`: `id, code, name, nip, regon, address, city, ...` (dane do dokumentów w C).
- `vehicles`: aktywne pojazdy (`vehiclesApi`).
- `finished_goods`: **agregat stanu wyrobów**, kluczowany przez
  `(produced_date, batch_no, recipe_id, COALESCE(client_name,''))`. Kolumny:
  `qty`, `qty_available`, `qty_shipped`, `kg_per_unit`, `total_kg`. Produkcja emituje
  ruch `IN`. **Rozchodu (OUT) dziś nie ma — wprowadza go wydanie (sekcja 6).**
- `stock_movements`: ruchy IN/OUT/TRANSFORM. Helper
  `app.utils.stock.create_stock_movement(conn, product_type, batch_id, qty, movement_type,
  source_type, source_id)` — `qty` dodatnie; OUT zapisywany jako ujemny. Produkcja wyrobów
  woła go z `product_type="finished_goods"`, `batch_id=finished_goods.id`, `qty=kg`.
- Wzorzec serwisu skanu: `pallets_service.pack_unit_into_pallet` (transakcja, FOR UPDATE,
  walidacja czysta + UPDATE sztuki) — analogiczny wzorzec dla wydania.

## Architektura

### 1. Model danych (migracje w `backend/app/migrations.py`)

```sql
CREATE TABLE IF NOT EXISTS dispatches (
    id            TEXT PRIMARY KEY,
    trip_id       TEXT,                            -- B2: wyjazd; NULL = luz ad-hoc
    client_id     TEXT,
    client_name   TEXT NOT NULL DEFAULT '',
    vehicle_id    TEXT,                            -- opcjonalny (luz może bez pojazdu)
    cmr_requested BOOLEAN NOT NULL DEFAULT false,
    status        TEXT NOT NULL DEFAULT 'open',    -- open → shipped
    operator      TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    created_at    TIMESTAMPTZ DEFAULT now(),
    shipped_at    TIMESTAMPTZ
);
-- indeksy:
CREATE INDEX IF NOT EXISTS idx_dispatches_status ON dispatches(status);
CREATE INDEX IF NOT EXISTS idx_dispatches_client ON dispatches(client_id);

ALTER TABLE finished_units ADD COLUMN IF NOT EXISTS dispatch_id TEXT;
CREATE INDEX IF NOT EXISTS idx_finished_units_dispatch
    ON finished_units(dispatch_id) WHERE dispatch_id IS NOT NULL;
```

Cykl wydania: `open` (trwa skanowanie) → `shipped` (zatwierdzone, sztuki wydane).

### 2. Walidacja skanu sztuki do wydania (czysta funkcja)

`backend/app/utils/unit_codes.py` — nowa czysta funkcja (reużywa `_client_matches`):

```python
def validate_loose_dispatch(unit: Dict, dispatch_client: Optional[str]) -> Tuple[bool, str]:
    """Czy sztukę można wydać luzem na to wydanie.

    unit: {status, client_name, dispatch_id}
    dispatch_client: klient wydania.
    Zwraca (ok, reason).
    """
    status = unit.get("status")
    if status == SHIPPED:
        return False, "Sztuka już wydana"
    if status == PACKED:
        return False, "Sztuka spakowana na paletę — wydaj przez wyjazd"
    if status != PRODUCED:
        return False, "Sztuka nie potwierdzona na produkcji"
    if unit.get("dispatch_id"):
        return False, "Sztuka już na innym wydaniu"
    if not _client_matches(unit.get("client_name"), dispatch_client):
        return False, "Inny klient niż wydanie"
    return True, ""
```

Uwaga: sztuka `packed` (na palecie) NIE idzie luzem — należy do wyjazdu (B2).
Sztuka „na magazyn" przechodzi do dowolnego realnego klienta (wildcard z `_client_matches`).

### 3. Serwis (nowy plik `backend/app/services/dispatches_service.py`)

- `create_dispatch(dto)` — INSERT `dispatches` (client_id, client_name, vehicle_id,
  cmr_requested, operator), status `open`. Zwraca `{id, status}`.
- `scan_into_dispatch(dispatch_id, code)` — w transakcji, FOR UPDATE na wydaniu i sztuce:
  1. wydanie istnieje i ma status `open` (inaczej błąd „Wydanie zamknięte");
  2. `parse_unit_qr(code)` → sztuka istnieje;
  3. `validate_loose_dispatch(unit, dispatch.client_name)`;
  4. OK: `UPDATE finished_units SET dispatch_id=%s WHERE id=%s`. **NIE nadpisujemy
     `client_name` sztuki** (inaczej niż przy palecie w Części A) — żeby zachować
     dopasowanie do wiersza `finished_goods` przy rozchodzie (sekcja 6). Powiązanie
     z klientem trzyma `dispatches.client_id/client_name`. Status sztuki pozostaje
     `produced` aż do zamknięcia.
  5. zwraca `{ok, reason, qty (=liczba sztuk na wydaniu), batchBreakdown}`.
- `close_dispatch(dispatch_id)` — finalizacja wydania w jednej transakcji:
  1. wydanie `open` (inaczej „Wydanie zamknięte");
  2. pobierz sztuki wydania; pusto → błąd „Brak sztuk na wydaniu";
  3. **rozchód `finished_goods` OUT** wg sekcji 6 (z gwarancją zapasu — atomowo);
  4. `UPDATE finished_units SET status='shipped' WHERE dispatch_id=%s`;
  5. `UPDATE dispatches SET status='shipped', shipped_at=now() WHERE id=%s`.
- `remove_unit(dispatch_id, code)` — cofnij błędnie zeskanowaną sztukę (`dispatch_id=NULL`),
  tylko gdy wydanie `open`.
- `dispatch_detail(dispatch_id)` — nagłówek (klient, pojazd, cmr, status) + liczba sztuk
  + skład partii.
- `list_open_dispatches()` — wydania `open` (do wznowienia na mobile).
- `dispatch_batch_breakdown(dispatch_id)` — `SELECT batch_no, COUNT(*), SUM(weight_kg)
  FROM finished_units WHERE dispatch_id=%s GROUP BY batch_no` → dane dla dokumentów (C).

### 4. API (`backend/app/routes/dispatches.py`, prefix `/api/dispatches`)

| Metoda | Ścieżka | Akcja |
|---|---|---|
| POST | `` | utwórz wydanie |
| GET | `/open` | lista otwartych |
| GET | `/{id}` | szczegóły + skład partii |
| GET | `/{id}/batch-breakdown` | skład partii (C) |
| POST | `/{id}/scan` | skan sztuki `{code}` |
| POST | `/{id}/remove` | cofnij sztukę `{code}` |
| POST | `/{id}/close` | zatwierdź → shipped |

Trasy stałe (`/open`) przed `/{id}`; zarejestrować router w `backend/app/main.py`.

### 5. Front

- `src/lib/api.ts`: `dispatchesApi` (`create`, `listOpen`, `detail`, `scan`, `remove`,
  `close`, `batchBreakdown`) + typy `DispatchScanResult`, `DispatchOpen`, `DispatchBatchRow`.
- Nowy ekran mobilny `src/pages/mobile/MobileWydanieLuzemPage.tsx`:
  1. **Brak aktywnego wydania:** przycisk „Nowe wydanie luzem" (formularz: klient z listy
     `clientsApi`, opcjonalnie pojazd `vehiclesApi`, checkbox CMR) + lista otwartych wydań
     (`listOpen`) do wznowienia.
  2. **Aktywne wydanie:** nagłówek (klient, licznik sztuk), pole skanu sztuki + kamera
     (`QrScannerModal`), feedback (`beepOk`/`beepErr`), skład partii na żywo; przyciski
     „Zatwierdź wydanie" (close) i „Cofnij sztukę".
  - Reużyć styl/komponenty z `MobilePakowaniePage`.
- Trasa + kafel w menu mobilnym (`MobilePickerPage`).

### 6. Rozchód magazynu wyrobów (`finished_goods` OUT) — rdzeń `close_dispatch`

Przy zamknięciu wydania towar realnie schodzi ze stanu wyrobów. Reguła dopasowania
(zatwierdzona): grupuj sztuki wydania po **(produced_date, batch_no, recipe_id)** — BEZ
kryterium klienta (fizycznie to ten sam towar z partii). Dla każdej grupy zdejmij `count`
sztuk z wierszy `finished_goods` tej partii.

Pomocnicza czysta funkcja (testowalna) w `dispatches_service` lub `unit_codes`:
```python
def group_units_for_out(units) -> Dict[tuple, dict]:
    """Grupuj sztuki po (produced_date, batch_no, recipe_id) → {count, kg}."""
    out: Dict[tuple, dict] = {}
    for u in units:
        key = (u.get("produced_date") or "", u.get("batch_no") or "", u.get("recipe_id") or "")
        g = out.setdefault(key, {"count": 0, "kg": 0.0})
        g["count"] += 1
        g["kg"] += float(u.get("weight_kg") or 0)
    return out
```

Algorytm w transakcji `close_dispatch` (po pobraniu sztuk wydania):
```
dla każdej grupy (produced_date, batch_no, recipe_id) -> {count}:
    rows = SELECT * FROM finished_goods
           WHERE produced_date=%s AND batch_no=%s AND recipe_id=%s
           ORDER BY (COALESCE(client_name,'')='') DESC, qty_available DESC
           FOR UPDATE                      # najpierw wiersz „na magazyn", potem klienta
    remaining = count
    for row in rows:
        take = min(remaining, max(0, row.qty_available))
        if take > 0:
            UPDATE finished_goods
               SET qty_available = qty_available - take,
                   qty_shipped   = qty_shipped + take
             WHERE id = row.id
            create_stock_movement(conn, product_type="finished_goods",
                batch_id=row.id, qty=take * float(row.kg_per_unit or 0),
                movement_type="OUT", source_type="dispatch", source_id=dispatch_id)
            remaining -= take
        if remaining == 0: break
    if remaining > 0:
        raise HTTPException(400,
            f"Za mało na stanie wyrobów dla partii {batch_no} (brakuje {remaining} szt)")
```

Atomowość: brak zapasu albo brak wiersza partii → wyjątek → rollback całej transakcji
(stan nigdy się nie rozjedzie). `create_stock_movement` waliduje OUT tylko dla
`product_type="meat"`, więc nasz własny strażnik `qty_available` decyduje dla wyrobów.

## Obsługa błędów

| Sytuacja | Komunikat |
|---|---|
| zły/pusty kod QR | „Nieprawidłowy kod QR sztuki" |
| sztuka nieznaleziona | „Sztuka nie znaleziona" |
| status `planned` | „Sztuka nie potwierdzona na produkcji" |
| status `packed` | „Sztuka spakowana na paletę — wydaj przez wyjazd" |
| status `shipped` | „Sztuka już wydana" |
| na innym wydaniu | „Sztuka już na innym wydaniu" |
| inny realny klient | „Inny klient niż wydanie" |
| wydanie zamknięte | „Wydanie zamknięte" |
| zamknięcie pustego | „Brak sztuk na wydaniu" |
| brak zapasu wyrobów przy zamknięciu | „Za mało na stanie wyrobów dla partii {batch_no} (brakuje N szt)" |

Błędy walidacji skanu → `{ok:false, reason}` (HTTP 200, jak w pakowaniu); błędy
strukturalne (złe wydanie) → HTTP 4xx.

## Testy

Czyste funkcje (`backend/tests/test_loose_dispatch.py`):

`validate_loose_dispatch`:
- OK (produced, ten sam klient, brak dispatch_id);
- sztuka „na magazyn" do realnego klienta → OK (wildcard);
- `planned` → „produkcj"; `packed` → „palet"; `shipped` → „wydana";
- już na wydaniu (`dispatch_id` ustawiony) → „innym wydaniu";
- inny realny klient → „klient".

`group_units_for_out`:
- sztuki z 2 partii → 2 grupy z poprawnym `count` i `kg`;
- ta sama partia, różne wagi → jedna grupa, `kg` zsumowane;
- pusta lista → pusty dict.

Walidacja czysta (bez DB). Rozchód `finished_goods` OUT (dekrement, ruch OUT, gwarancja
zapasu, atomowość), `close → shipped` i `batch breakdown` — weryfikowane w ręcznym e2e
(repo nie ma harnessu DB dla testów serwisowych). Scenariusz e2e: sztuka „na magazyn",
wiersz `finished_goods` (client=''), wydanie do klienta X, zamknięcie → sztuka `shipped`,
`finished_goods.qty_available−1`, `qty_shipped+1`, ruch `OUT` w `stock_movements`.

## Otwarte kwestie

- **Rozstrzygnięte — rozchód stanu:** wydanie zdejmuje OBA: sztuki QR (`status='shipped'`)
  ORAZ agregat `finished_goods` (`qty_available−`, `qty_shipped+`) + ruch `OUT`
  w `stock_movements` (kg). Dopasowanie po `(produced_date, batch_no, recipe_id)`, bez
  klienta; preferencja wiersza „na magazyn" → klienta (sekcja 6).
- **Sztuka bez wiersza `finished_goods`:** jeśli partia sztuki nie ma żadnego wiersza
  stanu wyrobów (niespójność danych historycznych), zamknięcie zgłasza błąd „Za mało na
  stanie wyrobów…" i nie commituje. To celowe — wymusza spójność, zamiast cicho gubić
  rozchód. (Gdyby w praktyce okazało się częste — do rozważenia łagodniejszy tryb w B2.)
- **client_id na sztuce:** `finished_units` ma `client_name` (string), nie `client_id`.
  Alokacja przy wydaniu ustawia `client_name`. Dokumenty (C) rozwiążą dane klienta po
  `dispatches.client_id` (zapisywanym na wydaniu). W B1 zapisujemy `client_id` na
  `dispatches`, sztuki trzymają `client_name`.
