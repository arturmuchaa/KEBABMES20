# Panel rozliczeń z odbiorcami — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Moduł „Rozrachunki” w PROTRIMA: salda odbiorców liczone automatycznie z WZ i ręcznie wpisanych faktur, wpłaty rozliczane od najstarszych osobno dla WZ i FV, pełna historia, wydruki salda dla klienta.

**Architecture:** Czysta arytmetyka księgi (bez bazy) w jednym module Pythona — jedyne miejsce, które liczy salda, przypisania wpłat i stany dokumentów; panel, wydruk na WZ i PDF-y biorą liczby wyłącznie z niej. Przypisania wpłat NIE są zapisywane — liczone od zera przy każdym odczycie. WZ z MES są synchronizowane do tabeli `rozl_dokumenty` przy każdym odczycie panelu/wydruku (pełna synchronizacja pod blokadą doradczą), dzięki czemu edycja i anulowanie WZ same zmieniają saldo i zostawiają ślad w historii. Nowe tabele `rozl_*`; stare `client_charges/client_payments/client_opening_balances` i `/api/rozrachunki` zostają nietknięte (zasada „bez usuwania”), ale nic nowego z nich nie korzysta.

**Tech Stack:** FastAPI + psycopg2 + PostgreSQL (`backend/app`, warstwy routes → services → db), React + TypeScript + Vite, vitest (jsdom), pytest. PDF: `render_url_to_pdf` ze stron `/office/*/druk?pdf=1`.

**Spec:** `docs/superpowers/specs/2026-11-09-panel-rozliczen-design.md` (czytaj razem z planem). Szkic wyglądu: https://claude.ai/artifact/VoU6PkHDpvVG3jcVhmPwfY

## Global Constraints

- Worktree `/opt/kebab/wt-rozliczenia`, gałąź `rozliczenia-panel` (z `protrima-fundament`). Kod w `kebab_fixed/`. Wszystkie ścieżki niżej względem `kebab_fixed/`.
- Znak: **minus = klient winien, plus = nadpłata.** Saldo księgi = kredyty − dokumenty.
- Księgi `wz` i `fv` rozliczane **zawsze osobno**; forma płatności (`gotowka`/`przelew`) niezależna od księgi.
- Do salda z MES wchodzi tylko seria **WZ** (`COALESCE(doc_series,'WZ')='WZ'`), nigdy `WM`; tylko nieanulowane i wycenione.
- Kwota WZ = **brutto z pozycji** (netto wg stawki + VAT, zaokrąglane per stawka jak `src/features/wz/wzVat.ts::podsumowanieVat`), nie `total_value`.
- Data dokumentu WZ = `release_date`, gdy pusta `issued_date`. Domyślne terminy: **WZ 0 dni, FV 7 dni**. Domyślne formy: WZ gotówka, FV przelew.
- Data startu: `app_settings['rozliczenia_start']`, domyślnie `2026-11-09`; liczą się dokumenty z datą **>= start** (saldo otwarcia = stan na początek dnia startu).
- Waluta kontrahenta: istniejąca kolumna `clients.settlement_currency`. Bez przeliczeń kursowych; dokument w innej walucie niż kontrahent nie wchodzi do sum i jest zgłaszany.
- Pieniądze: `NUMERIC(14,2)`, w Pythonie `Decimal` z `ROUND_HALF_UP`; na granicy API `float` zaokrąglony do 2 miejsc. Format w UI: `1 234,56 zł` / `1 234,56 €`.
- Każda zmiana kwoty/terminu/wpłaty/otwarcia → wiersz w `rozl_historia`; usunięcia miękkie z obowiązkowym powodem.
- `src/lib/api.ts` — zmiany tylko addytywne. Starej części webowej nie usuwamy (tylko podmiana linków/bloków).
- Nazwy firm/adresy nigdy w `src/protrima/modules` (dane firmy z `settingsApi.getCompany()`).
- Testy backendu DB: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test python3 -m pytest -q <plik>` (bez zmiennej testy SKIP — to nie jest zielono). Frontend: `npx vitest run --pool=forks --poolOptions.forks.singleFork <ścieżka>`; typy `npx tsc --noEmit`.
- Testy komponentów: docblock `// @vitest-environment jsdom`, `afterEach(cleanup)`, wzór `src/protrima/modules/rozbior/Rozbior.test.tsx`.
- Commity po każdym zadaniu, stopka: `Co-Authored-By: Claude Fable 5.2 <noreply@anthropic.com>` i `Claude-Session: https://claude.ai/code/session_01L7raTH8FLLzXQQXaXCuJL2`.
- **Bez wdrożenia.** Plan kończy się zrzutami ekranu do akceptacji właściciela.

## Review Focus

1. Kwota wpisana po polsku (`15 000,50`, ze spacją twardą, z kropką) → zapisuje 15000.50; `0`, pusta, ujemna, tekst → odmowa z komunikatem, nic się nie zapisuje. (Task 11)
2. Podwójne kliknięcie „Zapisz wpłatę” / „Zapisz fakturę” → dokładnie jeden zapis. (Task 11)
3. Dwie karty kontrahenta o tej samej nazwie, WZ bez zamówienia → WZ trafia na listę „bez kontrahenta”, nie do pierwszego z brzegu. (Task 3)
4. Zmiana waluty kontrahenta, gdy ma już dokumenty w starej walucie → dokumenty zgłoszone jako „inna waluta”, saldo ich nie sumuje po cichu. (Task 4)
5. Wpłata przypięta do dokumentu, który potem anulowano/usunięto, oraz wpłata większa niż cały dług → pieniądze idą na najstarsze otwarte, reszta jest nadpłatą; nic nie znika. (Task 1, Task 3)

---

### Task 1: Arytmetyka księgi (bez bazy)

**Files:**
- Create: `backend/app/services/rozliczenia_ksiega.py`
- Test: `backend/tests/test_rozliczenia_ksiega.py`

**Interfaces:**
- Produces:
  - `grosze(x) -> Decimal` — kwantyzacja do 0.01, `ROUND_HALF_UP`, przyjmuje float/str/Decimal/None.
  - `brutto_wz(lines: list[dict]) -> Decimal` — pozycje WZ (`value`, `vat_rate`); grupowanie po stawce, netto grupy zaokrąglone, VAT grupy zaokrąglony, suma brutto.
  - `ma_vat(lines) -> bool` — czy jakakolwiek pozycja ma `vat_rate > 0`.
  - `nip_krajowy(nip: str|None) -> bool` (port `wzVat.ts::nipKrajowy`), `waluta_z_nip(nip) -> 'PLN'|'EUR'`.
  - `rozlicz_ksiege(dokumenty: list[dict], kredyty: list[dict]) -> dict`
    - dokument: `{"id": str, "data": date, "numer": str, "kwota": Decimal (>0), "termin": date, "otwarcie": bool}`
    - kredyt: `{"id": str, "data": date, "kwota": Decimal (>0), "dokument_id": str|None}`
    - zwraca `{"dokumenty": [dok + {"zaplacono", "zostalo", "zamkniety": date|None, "pokrycie": [{"kredyt_id","kwota"}]}], "kredyty": [kredyt + {"przydzialy": [{"dokument_id","kwota"}], "reszta"}], "do_zaplaty": Decimal, "nadplata": Decimal, "saldo": Decimal}`; `saldo = nadplata − do_zaplaty`.
  - `stan_dokumentu(dok: dict, dzis: date) -> dict` — wejście: dokument z wyniku `rozlicz_ksiege`; zwraca `{"kod": "zaplacony"|"po_terminie"|"termin_dzis"|"termin_jutro"|"w_terminie", "dni": int, "czesciowo": bool}`; `dni` = dni po terminie / dni do terminu / dni od daty dokumentu do zamknięcia.
  - `na_dzien(dokumenty, kredyty, dzien: date) -> tuple[list, list]` — odfiltrowuje pozycje z datą > dzien.

- [ ] **Step 1: Testy (failing)**

```python
from datetime import date
from decimal import Decimal as D
from app.services.rozliczenia_ksiega import (brutto_wz, rozlicz_ksiege, stan_dokumentu,
                                             waluta_z_nip, na_dzien, grosze)

def _d(i, dzien, kwota, termin=None, otwarcie=False):
    return {"id": i, "data": date.fromisoformat(dzien), "numer": i, "kwota": D(str(kwota)),
            "termin": date.fromisoformat(termin or dzien), "otwarcie": otwarcie}
def _k(i, dzien, kwota, dok=None):
    return {"id": i, "data": date.fromisoformat(dzien), "kwota": D(str(kwota)), "dokument_id": dok}

FV = [_d("528", "2026-10-27", "14280.00", "2026-11-03"), _d("541", "2026-11-03", "12342.20", "2026-11-10"),
      _d("553", "2026-11-08", "10416.00", "2026-11-15")]

def test_brutto_5_procent_i_zero():
    assert brutto_wz([{"value": 1000, "vat_rate": 5}, {"value": 200.10, "vat_rate": 5}]) == D("1260.11")  # 1200.10 + 60.01 (60.005 → w górę)
    assert brutto_wz([{"value": 9569.75, "vat_rate": 0}]) == D("9569.75")
    assert brutto_wz([{"value": 100, "vat_rate": None}, {"value": 100, "vat_rate": 23}]) == D("223.00")
    assert brutto_wz([]) == D("0.00")

def test_wplata_od_najstarszych_ze_szkicu():
    w = rozlicz_ksiege(FV, [_k("p0", "2026-10-30", "7000"), _k("p1", "2026-11-09", "15000")])
    d = {x["id"]: x for x in w["dokumenty"]}
    assert (d["528"]["zostalo"], d["541"]["zostalo"], d["553"]["zostalo"]) == (D("0.00"), D("4622.20"), D("10416.00"))
    assert d["528"]["zamkniety"] == date(2026, 11, 9)
    assert w["do_zaplaty"] == D("15038.20") and w["nadplata"] == D("0.00") and w["saldo"] == D("-15038.20")

def test_nadplata_zostaje_i_zjada_pozniejszy_dokument():
    w = rozlicz_ksiege([_d("a", "2026-11-09", "100")], [_k("p", "2026-11-09", "350")])
    assert w["nadplata"] == D("250.00") and w["saldo"] == D("250.00")
    w = rozlicz_ksiege([_d("a", "2026-11-09", "100"), _d("b", "2026-11-20", "400")], [_k("p", "2026-11-09", "350")])
    assert {x["id"]: x["zostalo"] for x in w["dokumenty"]} == {"a": D("0.00"), "b": D("150.00")}
    assert w["nadplata"] == D("0.00")

def test_przypiecie_ma_pierwszenstwo_reszta_fifo():
    w = rozlicz_ksiege(FV, [_k("p", "2026-11-09", "11000", dok="553")])
    d = {x["id"]: x for x in w["dokumenty"]}
    assert d["553"]["zostalo"] == D("0.00") and d["528"]["zostalo"] == D("13696.00")  # 584 nadwyżki idzie na najstarszy

def test_przypiecie_do_nieistniejacego_dokumentu_idzie_fifo():
    w = rozlicz_ksiege(FV, [_k("p", "2026-11-09", "1000", dok="ANULOWANY")])
    assert w["dokumenty"][0]["zostalo"] == D("13280.00") and w["nadplata"] == D("0.00")

def test_otwarcie_splaca_sie_pierwsze_nawet_z_pozniejsza_data():
    docs = [_d("fv", "2026-11-09", "500"), _d("otw", "2026-11-09", "1000", otwarcie=True)]
    w = rozlicz_ksiege(docs, [_k("p", "2026-11-10", "1200")])
    assert {x["id"]: x["zostalo"] for x in w["dokumenty"]} == {"otw": D("0.00"), "fv": D("300.00")}

def test_kolejnosc_ta_sama_data_po_numerze_i_wynik_deterministyczny():
    docs = [_d("B", "2026-11-09", "100"), _d("A", "2026-11-09", "100")]
    w = rozlicz_ksiege(docs, [_k("p", "2026-11-09", "100")])
    assert [x["id"] for x in w["dokumenty"]] == ["A", "B"] and w["dokumenty"][0]["zostalo"] == D("0.00")

def test_stany():
    w = rozlicz_ksiege(FV, [_k("p0", "2026-10-30", "7000")])
    d = {x["id"]: x for x in w["dokumenty"]}
    dzis = date(2026, 11, 9)
    assert stan_dokumentu(d["528"], dzis) == {"kod": "po_terminie", "dni": 6, "czesciowo": True}
    assert stan_dokumentu(d["541"], dzis) == {"kod": "termin_jutro", "dni": 1, "czesciowo": False}
    assert stan_dokumentu(d["553"], dzis) == {"kod": "w_terminie", "dni": 6, "czesciowo": False}
    assert stan_dokumentu(d["541"], date(2026, 11, 10))["kod"] == "termin_dzis"
    z = rozlicz_ksiege([FV[0]], [_k("p", "2026-11-05", "14280")])["dokumenty"][0]
    assert stan_dokumentu(z, dzis) == {"kod": "zaplacony", "dni": 9, "czesciowo": False}

def test_na_dzien_obcina_przyszlosc():
    docs, kred = na_dzien(FV, [_k("p", "2026-11-09", "1")], date(2026, 11, 5))
    assert [x["id"] for x in docs] == ["528", "541"] and kred == []

def test_waluta_z_nip():
    assert waluta_z_nip("HU25341187") == "EUR" and waluta_z_nip("PL5252525252") == "PLN"
    assert waluta_z_nip("525-25-25-252") == "PLN" and waluta_z_nip(None) == "PLN"
```

- [ ] **Step 2:** Run `cd backend && python3 -m pytest -q tests/test_rozliczenia_ksiega.py` → FAIL (ImportError).
- [ ] **Step 3: Implementacja.** Algorytm `rozlicz_ksiege` (jedyny, którego testy nie wyznaczają w pełni):
  1. Dokumenty posortuj: `(not otwarcie, data, numer, id)`. Kredyty: `(data, id)`.
  2. Przebieg 1: każdy kredyt z `dokument_id` wskazującym istniejący dokument pokrywa go do wysokości `zostalo`; reszta kredytu zostaje w puli.
  3. Przebieg 2: reszty kredytów w kolejności kredytów pokrywają dokumenty w kolejności dokumentów (dwa wskaźniki), bez względu na daty.
  4. `zamkniety` = max(data dokumentu, najpóźniejsza data kredytu z `pokrycie`), gdy `zostalo == 0`.
  5. `nadplata` = suma `reszta`; `do_zaplaty` = suma `zostalo`.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(rozliczenia): arytmetyka księgi — brutto WZ, rozliczanie od najstarszych, stany`.

---

### Task 2: Schemat bazy

**Files:**
- Modify: `backend/app/migrations.py` (dopisz blok na końcu listy migracji DDL, po bloku `settlement_basis`)
- Modify: `backend/tests/conftest.py` (`_TRUNCATE` += `"rozl_dokumenty", "rozl_historia"` — nie mają twardego FK do `clients`)
- Test: `backend/tests/test_rozliczenia_schemat_db.py`

**Interfaces — Produces (tabele):**

```sql
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rozl_termin_wz INTEGER NOT NULL DEFAULT 0;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rozl_termin_fv INTEGER NOT NULL DEFAULT 7;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rozl_forma_wz TEXT NOT NULL DEFAULT 'gotowka';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rozl_forma_fv TEXT NOT NULL DEFAULT 'przelew';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS rozl_notatka TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS rozl_dokumenty (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,   -- NULL = WZ bez kontrahenta
  przypisano_recznie BOOLEAN NOT NULL DEFAULT false,
  ksiega TEXT NOT NULL CHECK (ksiega IN ('wz','fv')),
  zrodlo TEXT NOT NULL CHECK (zrodlo IN ('mes_wz','reczna','subiekt')),
  source_id TEXT NOT NULL DEFAULT '',        -- wz_documents.id dla mes_wz
  external_id TEXT NOT NULL DEFAULT '',      -- pod Subiekta
  numer TEXT NOT NULL,
  data_dok DATE NOT NULL,
  kwota NUMERIC(14,2) NOT NULL DEFAULT 0,    -- ujemna = faktura korygująca
  waluta TEXT NOT NULL DEFAULT 'PLN',
  termin DATE NOT NULL,
  termin_reczny BOOLEAN NOT NULL DEFAULT false,
  forma TEXT NOT NULL DEFAULT 'przelew' CHECK (forma IN ('gotowka','przelew')),
  stan_zrodla TEXT NOT NULL DEFAULT 'aktywny' CHECK (stan_zrodla IN ('aktywny','czeka_na_ceny','anulowany')),
  brak_vat BOOLEAN NOT NULL DEFAULT false,
  uwagi TEXT NOT NULL DEFAULT '',
  usuniety_at TIMESTAMPTZ, usuniety_przez TEXT, powod_usuniecia TEXT,
  utworzono TIMESTAMPTZ NOT NULL DEFAULT now(), utworzyl TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_rozl_dok_wz ON rozl_dokumenty(source_id) WHERE zrodlo='mes_wz';
CREATE UNIQUE INDEX IF NOT EXISTS uq_rozl_dok_fv ON rozl_dokumenty(client_id, numer) WHERE ksiega='fv' AND usuniety_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_rozl_dok_klient ON rozl_dokumenty(client_id, ksiega, data_dok);

CREATE TABLE IF NOT EXISTS rozl_wplaty (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ksiega TEXT NOT NULL CHECK (ksiega IN ('wz','fv')),
  forma TEXT NOT NULL CHECK (forma IN ('gotowka','przelew')),
  kwota NUMERIC(14,2) NOT NULL CHECK (kwota > 0),
  waluta TEXT NOT NULL,
  data DATE NOT NULL,
  dokument_id TEXT,                          -- przypięcie; bez FK (dokument może zniknąć)
  uwagi TEXT NOT NULL DEFAULT '',
  usuniety_at TIMESTAMPTZ, usuniety_przez TEXT, powod_usuniecia TEXT,
  utworzono TIMESTAMPTZ NOT NULL DEFAULT now(), utworzyl TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_rozl_wpl_klient ON rozl_wplaty(client_id, ksiega, data);

CREATE TABLE IF NOT EXISTS rozl_otwarcia (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  ksiega TEXT NOT NULL CHECK (ksiega IN ('wz','fv')),
  kwota NUMERIC(14,2) NOT NULL DEFAULT 0,    -- ze znakiem: minus dług, plus nadpłata
  waluta TEXT NOT NULL,
  zalegle_od DATE,
  uwagi TEXT NOT NULL DEFAULT '',
  zmieniono TIMESTAMPTZ NOT NULL DEFAULT now(), zmienil TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (client_id, ksiega)
);

CREATE TABLE IF NOT EXISTS rozl_historia (
  id TEXT PRIMARY KEY, client_id TEXT,
  obiekt TEXT NOT NULL,                      -- 'dokument'|'wplata'|'otwarcie'|'klient'
  obiekt_id TEXT NOT NULL DEFAULT '',
  akcja TEXT NOT NULL,                       -- 'dodano'|'kwota'|'termin'|'forma'|'uwagi'|'anulowano'|'usunieto'|'przypisano'|'wycena'|'zmiana'
  opis TEXT NOT NULL DEFAULT '', przed JSONB, po JSONB,
  powod TEXT NOT NULL DEFAULT '', kto TEXT NOT NULL DEFAULT '',
  kiedy TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rozl_hist ON rozl_historia(client_id, kiedy);
CREATE INDEX IF NOT EXISTS idx_rozl_hist_obiekt ON rozl_historia(obiekt, obiekt_id);

CREATE TABLE IF NOT EXISTS rozl_dziennik (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  tresc TEXT NOT NULL, przypomnij DATE, odhaczono_at TIMESTAMPTZ,
  kto TEXT NOT NULL DEFAULT '', kiedy TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO app_settings (key, value) VALUES ('rozliczenia_start', '"2026-11-09"'::jsonb) ON CONFLICT (key) DO NOTHING;
```

- [ ] **Step 1: Test** `test_rozliczenia_schemat_db.py` (fixture `db`): `run_migrations()` wywołane dwa razy nie rzuca; wstawienie klienta daje `rozl_termin_wz=0`, `rozl_termin_fv=7`, `rozl_forma_wz='gotowka'`, `rozl_forma_fv='przelew'`; druga faktura o tym samym `(client_id, numer)` → `psycopg2.errors.UniqueViolation`, a po ustawieniu `usuniety_at` pierwszej — przechodzi; drugi `mes_wz` z tym samym `source_id` → UniqueViolation; wpłata z `kwota=0` → CheckViolation; `app_settings['rozliczenia_start'] == "2026-11-09"`.
- [ ] **Step 2:** Run → FAIL. Przebuduj schemat bazy testowej: `DATABASE_URL="$TEST_DATABASE_URL" python3 -c "from app.migrations import run_migrations; run_migrations()"`.
- [ ] **Step 3:** Dopisz DDL do `migrations.py` wzorem sąsiednich wpisów (każda instrukcja osobnym elementem listy) + `_TRUNCATE` w conftest.
- [ ] **Step 4:** Run → PASS; dodatkowo `python3 -m pytest -q tests/test_rozrachunki_schemat_db.py` nadal PASS.
- [ ] **Step 5:** Commit `feat(rozliczenia): schemat rozl_* i ustawienia rozliczeń kontrahenta`.

---

### Task 3: Synchronizacja WZ z MES

**Files:**
- Create: `backend/app/services/rozliczenia_wz.py`
- Test: `backend/tests/test_rozliczenia_wz_db.py`

**Interfaces:**
- Consumes: `brutto_wz`, `ma_vat`, `nip_krajowy` (Task 1); tabele (Task 2).
- Produces:
  - `data_startu() -> date` (z `app_settings`, fallback `date(2026,11,9)`), `ustaw_date_startu(d: date, kto: str) -> None` (+ historia `obiekt='klient'`, `client_id=NULL`, akcja `zmiana`).
  - `historia(conn_or_none, *, client_id, obiekt, obiekt_id, akcja, opis, przed=None, po=None, powod="", kto="") -> None` — jedyny zapis do `rozl_historia`, używany też w Task 5.
  - `synchronizuj_wz() -> dict` — `{"dodane": int, "zmienione": int, "anulowane": int}`; idempotentna; cała w jednej transakcji pod `pg_advisory_xact_lock(hashtext('rozliczenia_wz'))`.
  - `przypisz_wz(dokument_id: str, client_id: str, kto: str) -> None` — ustawia `client_id`, `przypisano_recznie=true`, przelicza `termin` z terminu WZ klienta (gdy nie `termin_reczny`), historia `przypisano`.

**Reguły synchronizacji** (dla każdego wiersza `wz_documents` z serią WZ i datą `COALESCE(NULLIF(release_date,''), NULLIF(issued_date,''))::date >= data_startu()`):
- Kontrahent, gdy dokument nie jest `przypisano_recznie`: (1) `source_type='order'` → `client_orders.client_id`; (2) dokładnie jeden klient z `clients.nip` równym `buyer_nip` po usunięciu spacji/myślników (niepusty); (3) dokładnie jeden klient z `name = buyer_name OR display_name = buyer_name`; w każdym innym wypadku `client_id = NULL`.
- `stan_zrodla`: `anulowany` gdy `status='anulowany'`; `czeka_na_ceny` gdy `valued IS NOT TRUE` lub `brutto_wz(lines) == 0`; inaczej `aktywny`. `kwota` = `brutto_wz(lines)` (0 gdy nie aktywny).
- `waluta` = `wz_documents.currency` (domyślnie PLN). `brak_vat` = klient ma `nip_krajowy(nip)` i `not ma_vat(lines)` i stan aktywny.
- Nowy dokument: `termin = data + clients.rozl_termin_wz` (0 gdy brak klienta), `forma = clients.rozl_forma_wz`, historia `dodano` (`kto='MES'`).
- Istniejący: zmiana `kwota` → historia `kwota` z `przed/po` i opisem `kwota zmieniona z X na Y`; przejście na `anulowany` → historia `anulowano`; z `czeka_na_ceny` na `aktywny` → historia `wycena`; zmiana `numer`/`data_dok` aktualizowana cicho; `termin` przeliczany tylko gdy `termin_reczny = false`. `uwagi`, `forma`, `termin_reczny` nigdy nie są nadpisywane.
- WZ z datą < start, których nie ma w `rozl_dokumenty`, są pomijane; istniejących nie usuwa się nigdy.

- [ ] **Step 1: Testy** (helpery `_klient`, `_wz` wzorem `tests/test_rozrachunki_service_db.py`, ale `_wz` przyjmuje `lines`, `release_date`, `buyer_nip`, `valued`). Przypadki — każdy osobny test z asercjami na wiersz `rozl_dokumenty`:
  - WZ z zamówienia, pozycje `[{"value":1000,"vat_rate":5}]`, data 2026-11-10 → `kwota=1050.00`, `ksiega='wz'`, `client_id='c1'`, `termin=2026-11-10`, `forma='gotowka'`, `stan_zrodla='aktywny'`.
  - seria `WM` → brak wiersza. Data 2026-11-08 → brak wiersza. Data 2026-11-09 → jest wiersz.
  - `release_date='2026-11-12'`, `issued_date='2026-11-11'` → `data_dok=2026-11-12`.
  - `valued=false` → `stan_zrodla='czeka_na_ceny'`, `kwota=0`; po dopisaniu cen i ponownej synchronizacji → `aktywny`, `kwota` jak z pozycji, w historii akcja `wycena`.
  - zmiana pozycji na 2000 netto 5% → `kwota=2100.00`, historia `kwota` z `przed={"kwota":1050.0}`, `po={"kwota":2100.0}`; trzecia synchronizacja bez zmian nie dopisuje historii.
  - `status='anulowany'` po wcześniejszej synchronizacji → `stan_zrodla='anulowany'`, historia `anulowano`.
  - *(Review Focus 3)* dwóch klientów o `display_name='YALCIN'`, WZ bez zamówienia i bez NIP z `buyer_name='YALCIN'` → `client_id IS NULL`.
  - WZ bez zamówienia, `buyer_nip='PL 525-25-25-252'`, jeden klient z `nip='5252525252'`… → **uwaga:** porównanie po normalizacji usuwa też prefiks `PL`; asercja `client_id='c1'`.
  - klient z polskim NIP, pozycje bez VAT → `brak_vat=true`; klient `HU…` → `false`.
  - `przypisz_wz` na dokumencie bez kontrahenta → `client_id` ustawiony; kolejna synchronizacja go nie zeruje.
  - `termin_reczny=true` z ręcznym terminem → synchronizacja po zmianie daty WZ terminu nie rusza.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementacja wg reguł. Jedno zapytanie czytające WZ + jedno czytające istniejące `rozl_dokumenty WHERE zrodlo='mes_wz'`, porównanie w Pythonie, zapisy tylko dla różnic.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(rozliczenia): synchronizacja WZ z MES do księgi z historią zmian`.

---

### Task 4: Odczyt — karta klienta i lista kontrahentów

**Files:**
- Create: `backend/app/services/rozliczenia_service.py`
- Test: `backend/tests/test_rozliczenia_odczyt_db.py`

**Interfaces:**
- Consumes: Task 1, Task 3 (`synchronizuj_wz`, `data_startu`).
- Produces:
  - `ksiegi_klienta(client_id: str, na_dzien: date|None = None, dzis: date|None = None) -> dict` — wewnętrzny budulec dla Task 4–6: `{"klient": {...}, "wz": Ksiega, "fv": Ksiega, "inna_waluta": [dok], "czeka_na_ceny": [dok]}`; `Ksiega = wynik rozlicz_ksiege + {"po_terminie": Decimal, "najstarsza_dni": int}`, każdy dokument wzbogacony o `stan` (z `stan_dokumentu`), `forma`, `uwagi`, `zrodlo`, `ten_wiersz_to_otwarcie`. **Nie** woła `synchronizuj_wz` (robią to funkcje publiczne niżej, raz na żądanie).
  - Budowa wejścia księgi z bazy: dokumenty = aktywne, nieusunięte, `waluta == settlement_currency`, `kwota > 0`; **dokument z `kwota < 0` (korekta) staje się kredytem** `{"id", "data": data_dok, "kwota": -kwota, "dokument_id": None}`; saldo otwarcia ujemne → dokument `otwarcie=True`, `id='otwarcie-<ksiega>'`, `numer='Saldo otwarcia'`, `data = termin = zalegle_od or data_startu()`; dodatnie → kredyt z datą startu; wpłaty nieusunięte → kredyty.
  - `karta(client_id, dzis=None, od: date|None=None, do: date|None=None) -> dict` — JSON dla UI:
    ```
    {"klient": {"id","nazwa","nip","waluta","termin_wz","termin_fv","forma_wz","forma_fv","notatka","waluta_podpowiedz"},
     "start": "2026-11-09",
     "saldo": {"wz": float, "fv": float, "lacznie": float, "po_terminie_wz": float, "po_terminie_fv": float,
               "najstarsza_dni_wz": int, "najstarsza_dni_fv": int},
     "otwarcia": {"wz": {"kwota","zalegle_od","uwagi"}|null, "fv": ...},
     "dokumenty": {"wz": [Dok], "fv": [Dok]},      // najnowsze na górze; filtr od/do po data_dok dotyczy tylko listy, nie sald
     "wplaty": [{"id","ksiega","forma","kwota","data","uwagi","utworzyl","dokument_id","przydzialy":[{"numer","kwota"}],"reszta"}],
     "czeka_na_ceny": [{"id","numer","data"}], "inna_waluta": [{"id","numer","data","kwota","waluta"}],
     "dziennik": [{"id","tresc","przypomnij","odhaczono","kto","kiedy"}]}
    Dok = {"id","numer","data","kwota","zaplacono","zostalo","termin","forma","uwagi","zrodlo","otwarcie": bool,
           "stan": {"kod","dni","czesciowo"}, "zamkniety": str|null, "brak_vat": bool}
    ```
  - `lista(dzis=None) -> dict`:
    ```
    {"start": str,
     "podsumowanie": {"PLN": {"naleznosci","po_terminie","gotowka_wz","nadplaty"}, "EUR": {...}},   // liczby dodatnie
     "kontrahenci": [{"id","nazwa","nip","waluta","saldo_wz","saldo_fv","saldo","po_terminie","najstarsza_dni",
                      "najblizszy_termin_dni": int|null, "stan": "po_terminie"|"w_terminie"|"nadplata"|"rozliczony",
                      "przypomnienie": bool}],
     "bez_kontrahenta": [{"id","numer","data","kwota","waluta","nabywca"}], "inna_waluta": int}
    ```
    Na liście: klienci mający jakikolwiek nieusunięty dokument, wpłatę lub saldo otwarcia. `gotowka_wz` = suma `zostalo` dokumentów księgi WZ z `forma='gotowka'`. `przypomnienie` = istnieje wpis dziennika z `przypomnij <= dzis` i `odhaczono_at IS NULL`. Kolejność domyślna: `najstarsza_dni` malejąco, potem `saldo` rosnąco.
  - `dokument(dokument_id) -> dict` — `Dok` + `"pokrycie": [{"data","forma","kwota","uwagi"}]` + `"historia": [{"akcja","opis","przed","po","powod","kto","kiedy"}]`.

- [ ] **Step 1: Testy.** Scenariusz ROJPAK ze szkicu (klient `settlement_currency='EUR'`, start 2026-11-09 przestawiony w teście na `2026-10-01` przez `ustaw_date_startu`), `dzis=date(2026,11,9)`:
  - WZ (przez `_wz` + sync): 14/10 `18.10` 7425.00; 21/10 `27.10` 6120.00; 02/11 `03.11` 5289.50; 05/11 `08.11` 4464.00 (pozycje z `vat_rate` 0). Wpłaty WZ: 7425 (18.10), 3000 (27.10), 4464 przypięta do 05/11 (08.11).
  - FV ręczne: 512 `18.10` 17325.00; 528 `27.10` 14280.00; 541 `03.11` 12342.20; 553 `08.11` 10416.00; terminy +7. Wpłaty FV: 17325 (20.10), 7000 (30.10).
  - Asercje `karta`: `saldo == {"wz": -8409.50, "fv": -30038.20, "lacznie": -38447.70, "po_terminie_wz": 8409.50, "po_terminie_fv": 7280.00, "najstarsza_dni_wz": 13, "najstarsza_dni_fv": 6}`; stan WZ 21/10 `{"kod":"po_terminie","dni":13,"czesciowo":True}`; FV 541 `termin_jutro`; lista `dokumenty.fv` zaczyna się od 553.
  - `lista`: wiersz ROJPAK `saldo == -38447.70`, `po_terminie == 15689.50`, `najstarsza_dni == 13`, `stan == "po_terminie"`; `podsumowanie["EUR"]["naleznosci"] == 38447.70`, `["gotowka_wz"] == 8409.50`; `podsumowanie["PLN"]` same zera.
  - Saldo otwarcia: `rozl_otwarcia` FV `-1000` z `zalegle_od=2026-10-20` + wpłata 400 → dokument „Saldo otwarcia” `zostalo=600`, stan `po_terminie` z `dni=20`; otwarcie `+350` bez dokumentów → `saldo.wz == 350.0`, na liście `stan == "nadplata"`, `podsumowanie[...]["nadplaty"] == 350.0`.
  - Korekta: faktura `-500` przy fakturze `2000` → `saldo.fv == -1500.0`.
  - *(Review Focus 4)* klient z dokumentem PLN przestawiony na EUR → `saldo.lacznie == 0.0`, `inna_waluta` ma 1 pozycję, `lista()["inna_waluta"] == 1`.
  - Filtr `od/do` zawęża `dokumenty`, a `saldo` się nie zmienia.
  - Klient rozliczony (dokument i wpłata równe) → `stan == "rozliczony"`; klient bez niczego nie jest na liście.
  - `dokument(id)` dla FV 528: `pokrycie` ma jedną pozycję 7000.00, `historia[0]["akcja"] == "dodano"`.
- [ ] **Step 2:** Run → FAIL. (Faktury/wpłaty w testach tego zadania wstawiaj bezpośrednim `INSERT` — funkcje zapisu powstają w Task 5.)
- [ ] **Step 3:** Implementacja. `karta` i `lista` wołają `synchronizuj_wz()` raz na początku. `lista` liczy księgi wszystkich klientów dwoma zapytaniami zbiorczymi (dokumenty, wpłaty) i grupuje w Pythonie — bez zapytania per klient.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(rozliczenia): karta klienta i lista kontrahentów z saldami WZ/FV`.

---

### Task 5: Zapisy — faktury, wpłaty, otwarcie, ustawienia, dziennik

**Files:**
- Modify: `backend/app/services/rozliczenia_service.py`
- Test: `backend/tests/test_rozliczenia_zapis_db.py`

**Interfaces — Produces** (wszystkie rzucają `HTTPException(400, <komunikat po polsku>)` przy złych danych, `404` gdy brak obiektu; `kto` = login z sesji):
- `dodaj_fakture(client_id, *, numer: str, data: date, kwota, termin: date|None, forma: str|None, uwagi: str, kto: str) -> dict` — `kwota != 0` (ujemna = korekta); `termin` domyślnie `data + rozl_termin_fv`; `forma` domyślnie `rozl_forma_fv`; `data < data_startu()` → 400 „Faktura sprzed daty startu rozliczeń (DD.MM.RRRR) jest już w saldzie otwarcia”; duplikat numeru → 400 „Faktura {numer} jest już wpisana temu kontrahentowi”. Zwraca `Dok`.
- `edytuj_dokument(dokument_id, zmiany: dict, kto: str, powod: str = "") -> dict` — dozwolone pola: `termin`, `forma`, `uwagi` (każdy dokument; zmiana `termin` ustawia `termin_reczny=true`), `kwota`, `numer`, `data` (tylko `zrodlo='reczna'`, zmiana kwoty wymaga `powod`). Każde zmienione pole → wiersz historii z `przed/po`.
- `usun_dokument(dokument_id, powod: str, kto: str) -> None` — tylko `zrodlo='reczna'` (dla `mes_wz` → 400 „WZ anuluje się w dokumentach WZ”); pusty powód → 400.
- `podglad_wplaty(client_id, *, ksiega, kwota, dokument_id=None, data=None) -> dict` — bez zapisu: `{"przydzialy": [{"dokument_id","numer","kwota","zostalo_przed","zostalo_po","zamyka": bool}], "nadwyzka": float}`; liczone przez `rozlicz_ksiege` z dopisanym hipotetycznym kredytem (różnica względem stanu bieżącego).
- `dodaj_wplate(client_id, *, ksiega, forma, kwota, data: date, dokument_id: str|None, uwagi: str, kto: str) -> dict` — `kwota > 0`; `waluta` = waluta kontrahenta; zwraca to samo co `podglad_wplaty` + `"id"`.
- `usun_wplate(wplata_id, powod, kto) -> None` — miękko, powód obowiązkowy.
- `ustaw_otwarcie(client_id, ksiega, *, kwota, zalegle_od: date|None, uwagi: str, kto: str) -> None` — upsert + historia `zmiana` z `przed/po`; `zalegle_od > data_startu()` → 400.
- `ustaw_klienta(client_id, zmiany: dict, kto: str) -> None` — pola: `waluta` (`PLN`/`EUR` → `settlement_currency`), `termin_wz`, `termin_fv` (0–365), `forma_wz`, `forma_fv`, `notatka`; historia per pole. Zmiana terminów/form nie rusza istniejących dokumentów.
- `dodaj_wpis_dziennika(client_id, tresc, przypomnij: date|None, kto) -> dict`; `odhacz_wpis(wpis_id, kto) -> None`.

- [ ] **Step 1: Testy** (`dzis` i daty jak w Task 4):
  - `dodaj_fakture` bez terminu → `termin = data + 7`, `forma == 'przelew'`; klient z `rozl_termin_fv=14` → +14; duplikat numeru → 400; kwota `0` → 400; data sprzed startu → 400; po `usun_dokument` ten sam numer można wpisać ponownie.
  - `podglad_wplaty(FV, 15000)` na scenariuszu ze szkicu (zostało 7280 / 12342.20 / 10416) → przydziały `[("528", 7280.00, zamyka=True), ("541", 7720.00, zostalo_po=4622.20, zamyka=False)]`, `nadwyzka == 0`; podgląd niczego nie zapisuje (`SELECT count(*) FROM rozl_wplaty` bez zmian).
  - `dodaj_wplate` 15000 → `karta().saldo.fv == -15038.20`; wpłata w księdze `wz` nie zmienia `saldo.fv` (osobne księgi); wpłata `przelew` do księgi `wz` przechodzi.
  - *(Review Focus 5)* wpłata 50000 przy długu 30038.20 → `nadwyzka == 19961.80`, `saldo.fv == 19961.80`; potem nowa faktura 10000 → `saldo.fv == 9961.80`, faktura ma stan `zaplacony`.
  - *(Review Focus 5)* wpłata przypięta do faktury, potem `usun_dokument(faktura)` → kwota wpłaty pokrywa najstarszy otwarty dokument, suma `zaplacono + nadplata` równa sumie wpłat.
  - `usun_wplate` bez powodu → 400; z powodem → saldo wraca, wpłata znika z `karta().wplaty`, w `rozl_historia` akcja `usunieto` z powodem.
  - `edytuj_dokument` WZ z MES: zmiana `termin` → `termin_reczny=true`, historia `termin`; próba zmiany `kwota` → 400. Faktura ręczna: zmiana `kwota` bez powodu → 400, z powodem → historia `kwota`.
  - `ustaw_otwarcie` dwa razy → jeden wiersz, druga zmiana w historii z `przed/po`.
  - `ustaw_klienta({"termin_fv": 14})` → nowa faktura +14, stara bez zmian; `{"waluta": "USD"}` → 400.
  - dziennik: wpis z `przypomnij=2026-11-09` → `lista()` ma `przypomnienie == True`; po `odhacz_wpis` → `False`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementacja; każdy zapis + jego wiersz historii w jednej transakcji.
- [ ] **Step 4:** Run → PASS (oraz testy Task 4).
- [ ] **Step 5:** Commit `feat(rozliczenia): faktury, wpłaty z podglądem, saldo otwarcia, ustawienia, dziennik`.

---

### Task 6: Zestawienie na dzień i historia za okres

**Files:**
- Modify: `backend/app/services/rozliczenia_service.py`
- Test: `backend/tests/test_rozliczenia_wydruki_db.py`

**Interfaces — Produces:**
- `zestawienie(client_id, na_dzien: date|None = None, wz_id: str|None = None) -> dict`:
  ```
  {"klient": {"nazwa","nip","adres"}, "waluta": str, "na_dzien": str, "policzono": iso datetime,
   "wz": {"pozycje": [Poz], "razem": float}, "fv": {"pozycje": [Poz], "razem": float},
   "razem": float, "po_terminie": float, "nadplata_wz": float, "nadplata_fv": float}
  Poz = {"numer","data","termin","kwota","zaplacono","pozostalo","dni_po_terminie": int, "ten_dokument": bool}
  ```
  Tylko dokumenty z `pozostalo > 0`, od najstarszego. Stan liczony przez `ksiegi_klienta(na_dzien=...)`. `ten_dokument` = pozycja powstała z `wz_id`.
- `zestawienie_dla_wz(wz_id: str) -> dict|None` — ustala kontrahenta z `rozl_dokumenty.source_id`; `None`, gdy WZ jest serii WM, nie ma kontrahenta albo ma datę sprzed startu.
- `historia_okresu(client_id, od: date, do: date) -> dict`:
  ```
  {"klient": {...}, "waluta", "od", "do",
   "wz": {"saldo_poczatek": float, "wiersze": [W], "saldo_koniec": float}, "fv": {...},
   "saldo_poczatek": float, "saldo_koniec": float}
  W = {"data","rodzaj": "dokument"|"wplata"|"korekta","opis": str,"obciazenie": float,"wplata": float,"saldo": float}
  ```
  `saldo_poczatek` = saldo księgi z `na_dzien = od − 1 dzień`; wiersze w kolejności dat (dokument przed wpłatą tego samego dnia), `saldo` narastająco; `opis` wpłaty: `Wpłata gotówką` / `Wpłata przelewem` + uwagi.

- [ ] **Step 1: Testy** na scenariuszu ROJPAK z Task 4:
  - `zestawienie(c, date(2026,11,9))`: `wz.pozycje` = `[("WZ 21/10", pozostalo 3120.00, dni 13), ("WZ 02/11", 5289.50, 6)]`, `wz.razem == 8409.50`; `fv.pozycje` numery `528, 541, 553`, `dni_po_terminie == [6, 0, 0]`, `fv.razem == 30038.20`; `razem == 38447.70`, `po_terminie == 15689.50`.
  - `zestawienie(c, date(2026,10,28))` → FV tylko 528 z `pozostalo == 14280.00` (wpłata z 30.10 jeszcze nie istnieje), brak 541/553.
  - `zestawienie_dla_wz(<id WZ 02/11>)` → pozycja `ten_dokument == True`; dla WM → `None`.
  - klient rozliczony → `razem == 0`, puste pozycje; klient z nadpłatą 350 w WZ → `nadplata_wz == 350.0`.
  - `historia_okresu(c, 2026-11-01, 2026-11-09)`: `fv.saldo_poczatek == -7280.00`, wiersze FV: 541 (saldo −19622.20), 553 (saldo −30038.20), `fv.saldo_koniec == -30038.20`; `saldo_koniec == -38447.70`; `saldo_koniec` równe `karta().saldo.lacznie`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(rozliczenia): zestawienie należności na dzień i historia rozliczeń za okres`.

---

### Task 7: API

**Files:**
- Create: `backend/app/routes/rozliczenia.py`
- Modify: `backend/app/main.py` (dopisz `rozliczenia` w OBU listach importu/rejestracji routerów, obok `rozrachunki`)
- Test: `backend/tests/test_rozliczenia_routes_db.py`, `backend/tests/test_rozliczenia_router_zarejestrowany.py` (wzór: `test_rozrachunki_router_zarejestrowany.py`)

**Interfaces — Produces** (prefiks `/api/rozliczenia`; uprawnienie domyślne dla nieopisanych ścieżek — potwierdź testem, że `permission_for_path("/api/rozliczenia") == "office"`; login: `request.state.subject["username"]`, wzór `routes/deboning.py::_subject_of`):

| Metoda i ścieżka | Serwis |
|---|---|
| `GET ""` | `lista()` |
| `GET /ustawienia` · `PUT /ustawienia` `{start}` | `data_startu` / `ustaw_date_startu` |
| `GET /klient/{id}?od=&do=` | `karta` |
| `PUT /klient/{id}/ustawienia` | `ustaw_klienta` |
| `PUT /klient/{id}/otwarcie/{ksiega}` `{kwota, zalegle_od, uwagi}` | `ustaw_otwarcie` |
| `POST /klient/{id}/faktury` `{numer, data, kwota, termin?, forma?, uwagi?}` | `dodaj_fakture` |
| `POST /klient/{id}/wplaty/podglad` `{ksiega, kwota, dokument_id?}` | `podglad_wplaty` |
| `POST /klient/{id}/wplaty` `{ksiega, forma, kwota, data, dokument_id?, uwagi?}` | `dodaj_wplate` |
| `POST /wplaty/{id}/usun` `{powod}` | `usun_wplate` |
| `GET /dokumenty/{id}` · `PATCH /dokumenty/{id}` `{..., powod?}` | `dokument` / `edytuj_dokument` |
| `POST /dokumenty/{id}/usun` `{powod}` · `POST /dokumenty/{id}/przypisz` `{client_id}` | `usun_dokument` / `przypisz_wz` |
| `POST /klient/{id}/dziennik` `{tresc, przypomnij?}` · `POST /dziennik/{id}/odhacz` | dziennik |
| `GET /klient/{id}/zestawienie?na_dzien=&wz_id=` · `GET /na-wz/{wz_id}` (404 gdy `None`) | Task 6 |
| `GET /klient/{id}/historia?od=&do=` | `historia_okresu` |
| `GET /klient/{id}/zestawienie/pdf?na_dzien=` | `render_url_to_pdf(f"{settings.self_base_url}/office/rozliczenia/{id}/zestawienie/druk?pdf=1&na_dzien=...")`, nazwa `doc_pdf_filename("SALDO", <nazwa klienta>, <na_dzien>)` |
| `GET /klient/{id}/historia/pdf?od=&do=` | j.w. z `/office/rozliczenia/{id}/historia/druk?pdf=1&od=&do=`, prefiks `ROZLICZENIA` |

Daty w ciele i query jako `RRRR-MM-DD`; zła data → 400 „Nieprawidłowa data”. Kwoty przyjmowane jako liczba lub tekst z przecinkiem (`"15 000,50"` → 15000.50; helper `_kwota` w routes).

- [ ] **Step 1: Testy** (wołanie funkcji tras wprost, jak `test_rozrachunki_routes_db.py`): rejestracja routera; `permission_for_path` = office; `POST faktury` z `kwota="1 234,56"` zapisuje 1234.56; zła data → 400; `na-wz` dla WM → 404; trasy PDF z `monkeypatch` na `render_url_to_pdf` zwracają `application/pdf` i wołają URL zawierający `/office/rozliczenia/c1/zestawienie/druk?pdf=1`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementacja (trasy cienkie). **Step 4:** Run → PASS + cały `python3 -m pytest -q` bez nowych porażek.
- [ ] **Step 5:** Commit `feat(rozliczenia): API /api/rozliczenia z PDF zestawienia i historii`.

---

### Task 8: Wydruki — tabelka na WZ, zestawienie, historia

**Files:**
- Modify: `src/lib/api.ts` (dopisz `rozliczeniaApi` — metody 1:1 z tabelą Task 7: `lista, ustawienia, ustawStart, karta, ustawKlienta, ustawOtwarcie, dodajFakture, podgladWplaty, dodajWplate, usunWplate, dokument, edytujDokument, usunDokument, przypiszWz, dodajWpis, odhaczWpis, zestawienie, naWz, historia`; plus stałe `rozliczeniaPdf.zestawienie(clientId, naDzien)` i `.historia(clientId, od, do)` zwracające URL dla `downloadDocPdf`/`openDocument`)
- Create: `src/features/rozliczenia/druk.ts` (typy `Zestawienie`, `HistoriaOkresu`; `kwota(n, waluta)` → `1 234,56 €` / `1 234,56 zł`; `dataPl(iso)`)
- Create: `src/features/rozliczenia/TabelaSalda.tsx` — `export function TabelaSalda({ z }: { z: Zestawienie })`
- Create: `src/pages/office/ZestawienieNaleznosciPrintPage.tsx`, `src/pages/office/HistoriaRozliczenPrintPage.tsx`
- Modify: `src/App.tsx` (trasy `/office/rozliczenia/:clientId/zestawienie/druk`, `/office/rozliczenia/:clientId/historia/druk`, obok `/office/wz/:id/druk`)
- Modify: `src/components/wz/WzDocumentView.tsx:311` (`BlokSalda` → `BlokSaldaWz`), Create: `src/features/rozliczenia/BlokSaldaWz.tsx`
- Modify: `src/pages/office/ZaladunekDrukPage.tsx:306-311` (link „Rozliczenie tego kursu” → „Zestawienie należności”, do nowej trasy druku; potrzebny `client_id` w pozycji kursu — patrz Task 12, krok backendowy)
- Test: `src/features/rozliczenia/tabelaSalda.test.tsx`, `src/features/rozliczenia/blokSaldaWz.test.tsx`, `src/features/rozliczenia/druk.test.ts`

**Interfaces — Produces:** `TabelaSalda` (używana przez WZ, obie strony druku), `kwota`, `dataPl` (używane też w PROTRIMA).

**Treść `TabelaSalda`** (spec p. 10.1; wzór wyglądu: szkic, zakładka 3):
- Nagłówek: `Stan rozliczeń na dzień DD.MM.RRRR — dokumenty niezapłacone`.
- Dwie osobne tabele, każda tylko gdy ma pozycje: tytuły wierszy sumy `Razem WZ` i `Razem faktury`; kolumny: `Dokument | Data wystawienia | Termin płatności | Kwota | Zapłacono | Pozostało | Dni po terminie`.
- Wiersz z `dni_po_terminie > 0`: `data-po-terminie="1"`, kolor tekstu `#b00020`, liczba dni pogrubiona; `dni_po_terminie == 0` → `–`. Wiersz `ten_dokument` ma dopisek `(ten dokument)` przy numerze.
- Stopka sum: `W tym po terminie: X` (na czerwono, gdy > 0) i `Razem do zapłaty: Y`.
- Gdy `razem == 0` i brak nadpłat: jedna linia `Brak należności — dziękujemy`. Gdy `nadplata_wz/fv > 0`: linia `Nadpłata (WZ): X` / `Nadpłata (faktury): X`.
- Pod spodem: `Wpłaty zaksięgowane do DD.MM.RRRR. Jeżeli zapłacili Państwo w ostatnich dniach, prosimy uznać zestawienie za nieaktualne.`
- Style inline w konwencji `WzDocumentView` (druk czarno-biały: ramki `#9a9a9a`, nagłówki `#d7d7d7`).

`BlokSaldaWz({ wzId })`: woła `rozliczeniaApi.naWz(wzId)`; błąd/404 → nic nie renderuje (dokument drukuje się normalnie); sukces → `<TabelaSalda z=… />` w kontenerze `data-testid="blok-salda"`. `WzDocumentView` renderuje go tylko gdy `doc.doc_series !== 'WM'`.

Strony druku: nagłówek firmy z `settingsApi.getCompany()` i dane klienta wzorem `src/pages/office` stron `*PrintPage` (tryb `?pdf=1` jak w `WzPrintPage`), tytuł `Zestawienie należności` / `Historia rozliczeń DD.MM.RRRR – DD.MM.RRRR`. Historia: dla każdej księgi tabela `Data | Opis | Obciążenie | Wpłata | Saldo` z wierszami `Saldo na początek okresu` i `Saldo na koniec okresu`, na końcu `Saldo łącznie`.

- [ ] **Step 1: Testy.** `tabelaSalda.test.tsx` z danymi ROJPAK (Task 6): widać `WZ 21/10`, `3 120,00 €`, `Razem do zapłaty: 38 447,70 €`, `W tym po terminie: 15 689,50 €`; dokładnie 3 wiersze mają `data-po-terminie="1"`; FV 541 pokazuje `–`; pusty zestaw → tekst `Brak należności — dziękujemy` i brak `<table>`; nadpłata → `Nadpłata (WZ): 350,00 zł`. `blokSaldaWz.test.tsx`: odrzucona obietnica → brak `blok-salda`; sukces → jest. `druk.test.ts`: `kwota(1234.5,'EUR') === '1 234,50 €'`, `kwota(-38447.7,'PLN') === '−38 447,70 zł'` (minus typograficzny U+2212), `kwota(1000,'PLN') === '1 000,00 zł'`.
- [ ] **Step 2:** Run vitest na `src/features/rozliczenia` → FAIL. **Step 3:** Implementacja. **Step 4:** Run → PASS; `npx tsc --noEmit` czysto; istniejące `src/features/rozrachunki/*.test.tsx` nadal PASS (stare pliki zostają).
- [ ] **Step 5:** Commit `feat(rozliczenia): tabelka salda na WZ, zestawienie należności i historia do druku/PDF`.

---

### Task 9: PROTRIMA — model i lista kontrahentów

**Files:**
- Create: `src/protrima/modules/rozrachunki/model.ts`, `src/protrima/modules/rozrachunki/RozrachunkiModule.tsx`
- Modify: `src/protrima/shell/modules.tsx` (`W_PROTRIMA` += `'rozrachunki'`; `info` modułu: `['Salda odbiorców z WZ i faktur', 'Wpłaty rozliczane od najstarszych', 'Wydruk salda dla klienta']`), `src/protrima/App.tsx` (render `RozrachunkiModule` wzorem `RozbiorModule`, ok. linii 435)
- Test: `src/protrima/modules/rozrachunki/model.test.ts`, `src/protrima/modules/rozrachunki/Rozrachunki.test.tsx`; popraw `src/protrima/shell/modules.test.ts`, jeśli liczy moduły w PROTRIMA

**Interfaces — Produces (`model.ts`):**
- Typy `Kontrahent`, `ListaRozliczen`, `Karta`, `Dok`, `Wplata`, `Stan` (camelCase) + mapery `mapujListe(raw)`, `mapujKarte(raw)` — testowane (zasada „mapery z testami”).
- `pigulka(k: Kontrahent): { tekst: string; ton: 'late'|'soon'|'ok'|'zero' }` — `41 dni po terminie` / `1 dzień po terminie` / `termin dziś` / `termin jutro` / `termin za 3 dni` (gdy ≤ 3) / `w terminie` / `nadpłata` / `rozliczony`.
- `etykietaStanu(s: Stan): { tekst, ton }` — dla dokumentu: `zapłacona po 9 dniach`, `13 dni po terminie`, `termin dziś`, `termin jutro`, `za 6 dni`; `czesciowo` dodaje dopisek `· częściowo`.
- `sortuj(lista: Kontrahent[], kol: Kolumna, kier: 'asc'|'desc'): Kontrahent[]`; `type Kolumna = 'nazwa'|'waluta'|'saldoWz'|'saldoFv'|'saldo'|'poTerminie'|'najstarszaDni'`.
- `filtruj(lista, f: 'wszyscy'|'poTerminie'|'nadplaty'|'przypomnienia'|'PLN'|'EUR', szukaj: string)` — szukanie po nazwie i NIP, bez rozróżniania wielkości liter.
- `liczba(tekst: string): number` — parsowanie kwoty (`'15 000,50'`, spacja twarda, kropka) → `NaN` dla śmieci; używane w dialogach Task 11.

**Ekran** (szkic, zakładka 1; klasy i komponenty powłoki jak w `RozbiorModule`: `CommandBar`, `Pusto`, `SzkieletWierszy`, tabela `.tbl`, tagi `.tag warn`):
- Pasek sum osobno PLN i EUR (kafelek waluty ukryty, gdy wszystkie jej liczby są zerem): `Należności`, `w tym po terminie`, `Gotówka z WZ do odebrania`, `Nadpłaty klientów`.
- Filtry-chipy z licznikami, pole szukania, tabela: `Kontrahent | Waluta | Saldo WZ | Saldo FV | Saldo łącznie | Po terminie | Najstarsza zaległość`; salda ujemne czerwone, dodatnie zielone ze znakiem `+`; ikona dzwonka przy `przypomnienie`.
- Klik w nagłówek sortuje, drugi klik odwraca; strzałka przy aktywnej kolumnie; wybór zapamiętany w `localStorage['protrima.rozrachunki.sort']` (try/catch).
- Paski ostrzeżeń nad tabelą, gdy niepuste: `WZ bez kontrahenta (N)` — rozwija listę z wyborem kontrahenta (`Wybor` z `src/protrima/ui/Wybor.tsx`) i przyciskiem `Przypisz`; `Dokumenty w innej walucie niż kontrahent (N)`.
- Klik w wiersz / Enter → widok karty (Task 10) wewnątrz modułu: stan `wybrany: string | null`, przycisk `← Kontrahenci`.
- Komendy `CommandBar`: `Odśwież`, `Data startu rozliczeń` (dialog z jedną datą → `ustawStart`).

- [ ] **Step 1: Testy.** `model.test.ts`: maper nie gubi pól (`mapujListe` na surowym JSON z Task 4 → `saldoWz === -8409.5`, `najstarszaDni === 13`); `pigulka` dla każdego stanu; `sortuj` po `saldo` asc daje największego dłużnika pierwszego; `filtruj('poTerminie')`; `liczba('15 000,50') === 15000.5`, `liczba('15 000.5') === 15000.5`, `Number.isNaN(liczba('abc'))`. `Rozrachunki.test.tsx` (mock `rozliczeniaApi` przez `vi.hoisted`, wzór `Rozbior.test.tsx`): widać `ROJPAK`, `−38 447,70`, `13 dni po terminie`; klik nagłówka `Saldo łącznie` zmienia kolejność wierszy; filtr `Nadpłaty` zostawia tylko `BOSS KEBAB`; wpisanie `roj` w szukaj zostawia jeden wiersz; pusta lista → komunikat `Pusto` „Nikt jeszcze nie ma rozliczeń — dodaj saldo otwarcia albo wystaw WZ”; pasek `WZ bez kontrahenta (1)` i `Przypisz` woła `przypiszWz('d1','c2')`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementacja. **Step 4:** `npx vitest run --pool=forks --poolOptions.forks.singleFork src/protrima` → PASS; `npx tsc --noEmit`; `grep -rni 'księżyc\|91\.98' src/protrima/modules/rozrachunki` → pusto.
- [ ] **Step 5:** Commit `feat(protrima): moduł Rozrachunki — lista kontrahentów z saldami, sortowaniem i filtrami`.

---

### Task 10: PROTRIMA — karta klienta

**Files:**
- Create: `src/protrima/modules/rozrachunki/KartaKlienta.tsx`, `src/protrima/modules/rozrachunki/Dziennik.tsx`, `src/protrima/modules/rozrachunki/SzczegolyDokumentu.tsx`
- Modify: `src/protrima/modules/rozrachunki/RozrachunkiModule.tsx` (osadzenie karty)
- Test: `src/protrima/modules/rozrachunki/KartaKlienta.test.tsx`

**Interfaces:**
- Consumes: `model.ts` (Task 9), `rozliczeniaApi` (Task 8).
- Produces: `KartaKlienta({ clientId, onWroc, onOtworz }: { clientId: string; onWroc: () => void; onOtworz: (d: Okno) => void })`, `type Okno = { rodzaj: 'wplata'|'faktura'|'otwarcie'|'druk'|'ustawienia' } & {...}` — dialogi dostarcza Task 11; w tym zadaniu przyciski wołają `onOtworz`.

**Ekran** (szkic, zakładka 2 + spec p. 8.2):
- Nagłówek: nazwa, NIP, `Waluta: EUR`, `Termin FV: 7 dni`, `WZ: gotówka przy odbiorze` (z ustawień); notatka o kliencie edytowana w miejscu (zapis na blur → `ustawKlienta({notatka})`); przyciski `+ Wpłata`, `+ Faktura`, `Drukuj saldo`, `Saldo otwarcia`, `Ustawienia`.
- Kafelki: `Saldo WZ`, `Saldo FV`, `Saldo łącznie` z podpisem `po terminie X · najstarsza N dni`.
- Dwie tabele obok siebie (CSS grid `repeat(auto-fit, minmax(min(100%, 520px), 1fr))`): `WZ` i `Faktury`; kolumny `Data | Numer | Kwota | Zapłacono | Zostało | Termin | Stan | Uwagi`; zapłacone wyszarzone; wiersz „Saldo otwarcia” wyróżniony; WZ `czeka na ceny` jako wiersze bez kwoty z tagiem.
- Przełącznik `Ukryj zapłacone` i filtr okresu `Wszystko | Ten miesiąc | Kwartał | Rok | Od–do` (filtr po stronie klienta na `dokumenty`; salda bez zmian).
- Klik w dokument → `SzczegolyDokumentu` (panel/dialog): pokrycie wpłatami, historia zmian (`kiedy · kto · opis · powód`), edycja `termin`, `forma`, `uwagi`; dla faktury ręcznej też `Usuń` (z polem powodu, przycisk nieaktywny bez powodu).
- Sekcja `Wpłaty`: `Data | Do czego (WZ/FV) | Forma | Kwota | Rozliczyła | Uwagi | Kto`; `Rozliczyła` = `FV 528/2026 7 280,00; FV 541/2026 7 720,00` lub `nadpłata 250,00`; przy wierszu `Usuń` (powód obowiązkowy).
- `Dziennik`: lista wpisów (nieodhaczone przypomnienia na górze, zaległe wyróżnione), formularz `treść` + opcjonalna data przypomnienia, `Odhacz`.
- Paski ostrzeżeń: `brak_vat` na dokumencie → tag `bez VAT — sprawdź wycenę`; `inna_waluta` → lista dokumentów pominiętych w saldzie.

- [ ] **Step 1: Testy** (dane ROJPAK): widać trzy kafelki z `−8 409,50 €`, `−30 038,20 €`, `−38 447,70 €`; wiersz `WZ 21/10` ma `13 dni po terminie · częściowo`; zapłacona `FV 512/2026` jest widoczna, a po `Ukryj zapłacone` znika; filtr `Ten miesiąc` (czas zamrożony `vi.setSystemTime('2026-11-09')`) zostawia FV 541 i 553, kafelki bez zmian; klik `+ Wpłata` woła `onOtworz({rodzaj:'wplata', ...})`; wpis do dziennika woła `dodajWpis('c1','dzwoniłem','2026-11-12')`; usunięcie wpłaty bez powodu ma nieaktywny przycisk, z powodem woła `usunWplate('p1','pomyłka')`; zmiana uwag dokumentu woła `edytujDokument`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementacja. **Step 4:** Run → PASS; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(protrima): karta klienta — księgi WZ/FV z pełną historią, wpłaty, dziennik ustaleń`.

---

### Task 11: PROTRIMA — dialogi: wpłata, faktura, saldo otwarcia, ustawienia, druk

**Files:**
- Create w `src/protrima/modules/rozrachunki/`: `WplataDialog.tsx`, `FakturaDialog.tsx`, `OtwarcieDialog.tsx`, `UstawieniaKlientaDialog.tsx`, `DrukSaldaDialog.tsx`
- Modify: `RozrachunkiModule.tsx` (stan `okno`, render dialogów, odświeżenie karty i listy po zapisie)
- Test: `WplataDialog.test.tsx`, `FakturaDialog.test.tsx`, `OtwarcieDialog.test.tsx`, `DrukSaldaDialog.test.tsx`

**Interfaces:** Consumes `Dialog` z `shell/context`, `liczba`, `kwota`, `rozliczeniaApi`, `rozliczeniaPdf`, `openDocument`/`downloadDocPdf` z `@/lib/api`. Każdy dialog: `{ karta: Karta; onClose: () => void; onZapisano: () => void }`.

**Zachowanie:**
- **WplataDialog** — pola: `Do czego` (segment `WZ` / `Faktury`; domyślnie księga podana z karty), `Forma` (`Gotówka` / `Przelew`; domyślnie forma księgi z ustawień klienta, zmienia się przy zmianie księgi, dopóki użytkownik jej sam nie ruszył), `Kwota (waluta klienta)`, `Data` (dziś), `Dokument` (`Od najstarszych` + otwarte dokumenty wybranej księgi), `Uwagi`. Podgląd na żywo pod formularzem (debounce 250 ms → `podgladWplaty`): wiersze `FV 528/2026 — 7 280,00 € z 7 280,00 € → zapłacona`, `… → zostaje 4 622,20 €`, zielony wiersz `Nadwyżka +X zostaje jako saldo na plus`. `Zapisz wpłatę` nieaktywny, gdy kwota nie jest liczbą > 0; blokada na czas zapisu (`useRef` lock jak w `PapieryKursu.tsx`). Błąd serwera → komunikat w dialogu, dialog zostaje otwarty z danymi.
- **FakturaDialog** — `Numer`, `Data wystawienia` (dziś), `Kwota brutto` (ujemna dozwolona, podpis „ujemna = faktura korygująca”), `Termin` (przelicza się z daty + `terminFv`, dopóki nie zmieniony ręcznie), `Forma`, `Uwagi`.
- **OtwarcieDialog** — dwie sekcje `WZ` i `Faktury`: przełącznik `klient winien` / `nadpłata` + kwota dodatnia (do API idzie ze znakiem), `Zaległe od` (opcjonalna), `Uwagi`; tekst pomocy: `Stan na początek dnia DD.MM.RRRR. Dokumenty z tego dnia i późniejsze liczą się już w systemie.`
- **UstawieniaKlientaDialog** — `Waluta` (PLN/EUR; podpowiedź z `walutaPodpowiedz`, gdy różna: „NIP wskazuje na EUR”), terminy WZ/FV w dniach, formy WZ/FV. Zmiana waluty przy istniejących dokumentach pokazuje ostrzeżenie „Dokumenty w dotychczasowej walucie przestaną się liczyć do salda”.
- **DrukSaldaDialog** — wybór `Zestawienie należności na dzień` (data, domyślnie dziś) albo `Historia rozliczeń za okres` (`Ten miesiąc` / `Poprzedni miesiąc` / `Od–do`); przyciski `Podgląd / drukuj` (`openDocument(url)`) i `Zapisz PDF` (`downloadDocPdf(url, nazwa)`).

- [ ] **Step 1: Testy.**
  - *(Review Focus 1)* `WplataDialog`: wpisanie `15 000,50` → `podgladWplaty` wołany z `kwota: 15000.5`; zapis woła `dodajWplate('c1', {ksiega:'fv', forma:'przelew', kwota:15000.5, data:'2026-11-09', dokument_id:null, uwagi:''})`; dla `0`, pustej, `-5`, `abc` przycisk nieaktywny i `dodajWplate` niewołany; podgląd renderuje `zapłacona` i `zostaje 4 622,20 €`; zmiana na `WZ` przełącza formę na `Gotówka`, a po ręcznym wyborze `Przelew` zmiana księgi formy już nie rusza.
  - *(Review Focus 2)* dwa szybkie kliknięcia `Zapisz wpłatę` przy obietnicy w toku → `dodajWplate` wołany raz; to samo dla `FakturaDialog`.
  - odrzucenie z serwera (`Faktura 528/2026 jest już wpisana temu kontrahentowi`) → tekst widoczny, pola zachowane, `onZapisano` niewołany.
  - `FakturaDialog`: data `2026-11-09` przy `terminFv=7` → pole terminu `2026-11-16`; po ręcznej zmianie terminu zmiana daty go nie nadpisuje; kwota `-500` przechodzi.
  - `OtwarcieDialog`: `klient winien` + `6 300` → `ustawOtwarcie('c1','wz',{kwota:-6300,...})`; `nadpłata` + `350` → `kwota: 350`.
  - `DrukSaldaDialog`: `Poprzedni miesiąc` przy zamrożonym 2026-11-09 → URL z `od=2026-10-01&do=2026-10-31`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementacja. **Step 4:** `npx vitest run --pool=forks --poolOptions.forks.singleFork src/protrima` → PASS; `npx tsc --noEmit`.
- [ ] **Step 5:** Commit `feat(protrima): wpłata z podglądem rozliczenia, faktura, saldo otwarcia, ustawienia i druk salda`.

---

### Task 12: Zestawienie należności w papierach kursu

**Files:**
- Modify: `backend/app/services/loading_service.py` (zapytanie ok. linii 713: dopisz `o.client_id` i zwracaj `client_id` w każdej pozycji kursu — zmiana addytywna)
- Modify: `src/protrima/modules/wysylki/kurs.ts` (`PozycjaKursu.client_id?: string | null`), `src/protrima/modules/wysylki/PapieryKursu.tsx`
- Modify: `src/pages/office/ZaladunekDrukPage.tsx` (link z Task 8 używa `p.client_id`)
- Test: `backend/tests/test_rozliczenia_kurs_db.py` (albo dopisek do istniejącego testu papierów kursu, jeśli jest), `src/protrima/modules/wysylki/PapieryKursu.test.tsx`

**Zachowanie:** w „Dokumenty kursu” każdy odbiorca z `client_id` dostaje pozycję `Zestawienie należności` (PDF: `rozliczeniaPdf.zestawienie(client_id, dziś)`, plik `SALDO_<klient>_<data>.pdf`). Gdy odbiorca **nie ma** dokumentu serii WZ wychodzącego do klienta (wszystko na fakturę: brak `wz` z `doc_series !== 'WM'`), pozycja ma tag `do wydruku — brak WZ` i wchodzi do „Pobierz wszystkie PDF”; gdy ma WZ, pozycja jest dostępna pojedynczo, ale nie wchodzi do „wszystkich” (saldo jest już na WZ). Odbiorca bez `client_id` → brak pozycji.

- [ ] **Step 1: Testy.** Backend: pozycja kursu zawiera `client_id` zamówienia. Frontend: odbiorca tylko z WM/fakturą → widać `Zestawienie należności` z tagiem, „Pobierz wszystkie PDF” woła `downloadDocPdf` także z URL-em `/api/rozliczenia/klient/c1/zestawienie/pdf`; odbiorca z WZ klienta → pozycja jest, ale „wszystkie” jej nie pobiera; istniejące testy pliku nadal PASS.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implementacja. **Step 4:** Run → PASS (backend + `src/protrima` + `tsc`).
- [ ] **Step 5:** Commit `feat(wysyłki): zestawienie należności w papierach kursu, gdy wysyłka idzie bez WZ`.

---

### Task 13: Weryfikacja całości i zrzuty do akceptacji

**Files:**
- Create: `docs/protrima-ui/zrzuty/rozliczenia/` (PNG), dopisek w `docs/protrima-ui/BRAKI_API.md` tylko jeśli coś zostało bez API.

- [ ] **Step 1:** `cd backend && TEST_DATABASE_URL=… python3 -m pytest -q` — zapisz liczbę passed/failed/skipped; żadnego SKIP w `test_rozliczenia_*`.
- [ ] **Step 2:** `npx tsc --noEmit` · `npx vitest run --pool=forks --poolOptions.forks.singleFork src/protrima src/features/rozliczenia src/features/rozrachunki src/components/wz` · `npm run build`.
- [ ] **Step 3:** Uruchom backend na bazie testowej zasilonej scenariuszem ROJPAK + 5 klientów PLN (skrypt jednorazowy w scratchpadzie, nie w repo) i PROTRIMA w przeglądarce; przejdź ręcznie: lista → sortowanie → karta → wpłata 15 000 z podglądem → faktura → saldo otwarcia → druk zestawienia (PDF) → WZ z tabelką (PDF) → historia za okres (PDF). Sprawdź, że `Razem do zapłaty` na PDF == `Saldo łącznie` na karcie (wartość bezwzględna).
- [ ] **Step 4:** Zrzuty 1920×1080 i 1366×768, jasny i ciemny: lista, karta klienta, dialog wpłaty z podglądem; plus PDF zestawienia i strona WZ z tabelką. Zapisz w `docs/protrima-ui/zrzuty/rozliczenia/`.
- [ ] **Step 5:** Commit `docs(rozliczenia): zrzuty do akceptacji`. **Nie wdrażaj** — przekaż zrzuty właścicielowi; wdrożenie (z `proba_generalna.sh` na kopii produkcji) to osobna decyzja po akceptacji.
