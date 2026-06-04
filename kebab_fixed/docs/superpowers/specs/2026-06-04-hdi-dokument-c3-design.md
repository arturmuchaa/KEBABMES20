# Projekt (HDI C-3): Dokument HDI wstępny — generowanie dwujęzyczne z zamówienia

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: HDI fundament (zrobione: klient język+destynacja, firma nr wet/rynek/załadunek).
C-3b (skan-weryfikacja → potwierdzony/korekta) i C-4 (sidebar/archiwum, CMR, WZ) — osobno.
[[kebab-wydanie-dokumenty-roadmap]]

## Kontekst

HDI (handlowy dokument identyfikacyjny) — Część C. Ten spec: **generowanie dokumentu
WSTĘPNEGO przez biuro z zamówienia klienta**, dwujęzyczne (PL + język klienta), numeracja
**NN/MM/RR**, podgląd/druk. Skan-weryfikacja przy załadunku i archiwum — C-3b/C-4.

Wzór: `/root/HDI wzor.pdf` (PL+DE).

### Źródło danych (zatwierdzone)

Pozycje dokumentu = **wyprodukowane sztuki tego zamówienia** (`finished_units` z
`order_id = <zamówienie>`). Gdy wyprodukowano = zamówiono → komplet; gdy mniej → **stan
faktyczny** (częściowy) z flagą „niekompletne". Realne partie/wagi z `finished_units`.

### Stan zastany

- `finished_units`: `order_id` (= `client_order_id`), `product_type_id`, `recipe_id`,
  `weight_kg`, `batch_no`, `produced_date`, `status`.
- `product_types` (nazwa), `recipes` (`shelf_life_days`), `client_order_lines` (zamówione qty).
- Helpery: `unit_codes.best_before(produced_date, shelf_life_days)`,
  `batch_numbers.kebab_batch_no(produced_date, batch_no)` = „ddmmrr partia".
- `clients`: name, address, city, nip, **language, dest_name, dest_address, dest_city** (C-1).
- Ustawienia firmy (JSON): name, address, city, postal_code, **vet_number, market_domestic,
  market_eu, load_place** (C-2).
- `hdi_lang.lang_from_nip` (C-1).
- Wzorce druku HTML: `OrderPrintPage.tsx` (HTML + `window.print`, `@page`).
- Generowanie z zamówienia: `ClientOrdersPage.tsx` (akcja „Drukuj" → `/office/zamowienia/{id}/druk`).

## Architektura

### 1. Model danych

Tabela `hdi_documents` (snapshot — dokument zamrożony przy generowaniu):
```sql
CREATE TABLE IF NOT EXISTS hdi_documents (
    id           TEXT PRIMARY KEY,
    number       TEXT NOT NULL,            -- "NN/MM/RR"
    seq          INTEGER NOT NULL,         -- NN w danym miesiącu
    year_month   TEXT NOT NULL,            -- "RRMM" do numeracji/filtra
    order_id     TEXT,
    client_name  TEXT DEFAULT '',
    language     TEXT DEFAULT 'pl',
    status       TEXT NOT NULL DEFAULT 'wstepny',  -- wstepny | potwierdzony | korekta (C-3b)
    incomplete   BOOLEAN NOT NULL DEFAULT false,
    header       JSONB NOT NULL DEFAULT '{}',   -- producent, odbiorca, sprzedawca, miejsca, nr wet, rynek, data
    items        JSONB NOT NULL DEFAULT '[]',   -- pozycje (snapshot)
    totals       JSONB NOT NULL DEFAULT '{}',   -- {qty, kg}
    issue_date   TEXT DEFAULT '',
    created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_hdi_status ON hdi_documents(status);
CREATE INDEX IF NOT EXISTS idx_hdi_order ON hdi_documents(order_id);
```
Numeracja: `seq` = MAX(seq)+1 dla bieżącego `year_month` (reset miesięczny); `number` =
`f"{seq}/{MM}/{RR}"`.

### 2. Backend — budowa pozycji (czyste, testowalne)

`backend/app/services/hdi_service.py`:

- `_product_label(product_type_name, weight_kg)` → np. `"KEBAB 40KG"` (`f"{nazwa} {int(round(w))}KG"`).
- `group_hdi_items(units, recipe_shelf) -> List[dict]` — **czysta**: grupuj sztuki po
  (`product_type_name`, waga zaokrąglona). Dla każdej grupy:
  - `name` = `_product_label(...)`, `qty` = liczba, `kg` = suma `weight_kg`,
  - `batches` = lista `{partia: kebab_batch_no(produced_date,batch_no), qty, termin:
    best_before(produced_date, shelf)→dd.mm.yyyy}` per (batch, produced_date),
  Zwraca pozycje jak w tabeli HDI (wiersz może mieć kilka partii).
- `build_hdi(order_id) -> dict` — pobiera zamówienie, jego `finished_units`, recepturę
  (shelf_life), product_types (nazwy), klienta, ustawienia firmy; składa:
  - `header`: producent (firma + adres), nr wet., rynek (krajowy/UE), odbiorca (klient +
    adres + NIP), miejsce rozładunku (`dest_*` lub adres klienta), miejsce załadunku
    (`load_place` lub adres firmy), sprzedawca (firma), data wystawienia (dziś).
  - `items` = `group_hdi_items(...)`, `totals` = {qty, kg}.
  - `language` = `client.language or lang_from_nip(client.nip)`.
  - `incomplete` = (suma wyprodukowanych < suma zamówionych z `client_order_lines`).
- `generate_hdi(order_id) -> dict` — nadaje numer (NN/MM/RR, seq miesięczny), INSERT
  `hdi_documents` (status `wstepny`, snapshot `header/items/totals`), zwraca rekord.
- `get_hdi(id)`, `list_hdi()` (lista do archiwum/C-4; tu minimalnie do druku).

Endpoint (`backend/app/routes/hdi.py`, prefix `/api/hdi`):
| Metoda | Ścieżka | Akcja |
|---|---|---|
| POST | `/generate?order_id=` | wygeneruj wstępny HDI z zamówienia |
| GET | `/{id}` | pobierz dokument (do druku/podglądu) |
| GET | `` | lista (archiwum — pełne w C-4) |

Rejestracja routera w `main.py`.

### 3. Tłumaczenia (dwujęzyczność)

`backend/app/services/hdi_i18n.py` — słownik etykiet per język (`pl/de/sk/cs/en`):
nagłówki tabeli (NAZWA TOWARU/SZT/MASA NETTO/NR PARTII/TERMIN), etykiety bloków (Producent,
Odbiorca, Miejsce rozładunku, Miejsce załadunku, Sprzedawca, Numer HDI, Data wystawienia,
RAZEM, rynek krajowy/UE, nr weterynaryjny, tytuł dokumentu, oświadczenie nadzór+HACCP).
- **PL** i **DE** — z wzoru (pełne). **EN** — z wzoru (część). **SK/CZ** — etykiety pól
  przetłumaczone; długi blok „uwagi/reklamacje" na razie **fallback EN** (do uzupełnienia
  przez użytkownika). Dokument zawsze pokazuje **PL + język klienta** (dwie kolumny/linie).
- Długi tekst „uwagi/warunki reklamacji": PL + (DE/EN ze wzoru); helper `complaints_text(lang)`.

### 4. Front — druk HDI

`src/pages/office/HdiPrintPage.tsx`, trasa `/office/hdi/{id}/druk`:
- Pobiera `hdiApi.get(id)`; renderuje układ A4 wg wzoru (nagłówek, tabela pozycji z RAZEM,
  bloki Odbiorca/Rozładunek/Nr rej./Załadunek/Sprzedawca, data wysyłki, uwagi), **dwujęzycznie**
  (PL + `doc.language`). Status `wstepny` → **baner „WSTĘPNY — towar niezeskanowany, możliwe
  błędy"** (nie drukuje się albo drukuje jako adnotacja — do ustalenia, domyślnie widoczny
  na ekranie, dyskretny na wydruku).
- Auto-print po załadowaniu (jak `OrderPrintPage`), `@page A4`.

### 5. Front — wyzwalanie z zamówienia

`src/pages/office/ClientOrdersPage.tsx`: obok „Drukuj" dodać akcję **„HDI"** →
`hdiApi.generate(order.id)` → po sukcesie `navigate('/office/hdi/{id}/druk')`.
`src/lib/api.ts`: `hdiApi` (`generate`, `get`, `list`) + typy.
Trasa w `src/App.tsx`.

## Obsługa błędów / brzegowe

| Sytuacja | Zachowanie |
|---|---|
| brak wyprodukowanych sztuk dla zamówienia | błąd „Brak wyprodukowanych sztuk do HDI" (nie generuj pustego) |
| wyprodukowano < zamówiono | `incomplete=true`; baner „niekompletne wzg. zamówienia"; dokument z faktycznych |
| brak języka klienta | `lang_from_nip(nip)` |
| brak `dest_*` | miejsce rozładunku = adres klienta |
| brak `load_place` | miejsce załadunku = adres firmy |
| brak tłumaczenia SK/CZ dla uwag | fallback EN |

## Testy

Pytest (`test_hdi.py`) — czyste funkcje:
- `_product_label` ('KEBAB', 40.0) == 'KEBAB 40KG'.
- `group_hdi_items`: 2 produkty → 2 wiersze z qty/kg; wiele partii w jednym produkcie →
  lista `batches`; termin = best_before sformatowany; nr partii = kebab_batch_no.
- numeracja: format `NN/MM/RR` (seq miesięczny) — funkcja formatująca.
Druk i realny wygląd — build + ręczny e2e (wygeneruj HDI z zamówienia, sprawdź PL+język).

## Poza zakresem (C-3b / C-4)

- Skan-weryfikacja przy załadunku → status potwierdzony/korekta.
- Sekcja „HDI/Dokumenty" w sidebarze + archiwum kopii (lista/podgląd/reprint).
- CMR, WZ (te same szyny; wzór `/root/cmr wzor.pdf`).
- Pełne tłumaczenia SK/CZ długiego bloku uwag.

## Otwarte kwestie

- Czy baner „WSTĘPNY" ma być też na wydruku — domyślnie dyskretna adnotacja; do potwierdzenia.
- Czy „NAZWA TOWARU" zawsze `produkt + waga` (np. „KEBAB 40KG") czy nazwa receptury — przyjęto
  produkt+waga (zgodnie ze wzorem).
