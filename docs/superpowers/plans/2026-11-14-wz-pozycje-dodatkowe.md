# WZ — pozycje dodatkowe i poprawki WM — plan wdrożenia

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pozycje „z ręki” (jogurt) i „z magazynu surowca” (łój) na WZ/WM — w edytorze i dopisywane do wystawionych dokumentów, także z kursu — oraz wydruk WM jako „Wydanie zewnętrzne” bez czerwonego paska.

**Architecture:** Linie dodatkowe żyją w `wz_documents.lines` (JSONB) z `stock_type` `'reczna'` albo `raw|meat|byproduct` i `line_id`. Nowy moduł serwera `wz_pozycje_dodatkowe.py` dopisuje/usuwa je wg reguł WM/WZ; rozchód i zwrot surowca wyciągnięte do wspólnych funkcji w `wz_service.py`. Konsumenci linii, którzy liczą wyrób (załadunek, HDI, „wydano”), biorą tylko `stock_type=='fg'`. PROTRIMA: wiersze dodatkowe w edytorze WZ + wspólne okno „Dopisz pozycję”.

**Tech Stack:** FastAPI + psycopg2 (PostgreSQL), React 18 + TS, vitest, pytest na `kebab_mes_test`.

**Spec:** `docs/superpowers/specs/2026-11-14-wz-pozycje-dodatkowe-design.md`

## Global Constraints

- WM = wszystko, co wyszło z magazynu (rusza stan); WZ = dokument dla klienta do zapłaty (Rozrachunki liczą tylko serię WZ).
- Ceny w walucie dokumentu: PLN albo EUR z kursem NBP zapisanym na WZ (`currency`, `eur_rate`); bez przeliczania, bez mieszania walut.
- Pozycja z ręki nie rusza stanu; pozycja z surowca zdejmuje stan przy wystawieniu/dopisaniu i oddaje przy usunięciu/anulowaniu.
- J.m. pozycji z ręki: `szt`, `kg`, `opak.`; wartość = (total_kg gdy kg, inaczej qty) × cena; VAT per pozycja.
- Teksty UI po polsku; komunikat blokady jogurtu na samym WM: „Ten kurs idzie w całości na fakturę z Subiekta — dopisz tę pozycję na fakturze.”
- Testy DB tylko na bazie z `kebab_mes_test` w nazwie; nie uruchamiać dwóch przebiegów pytest naraz. Vitest: `--pool=forks --poolOptions.forks.singleFork`.
- Przed wdrożeniem zrzuty do akceptacji właściciela.

## Review Focus

1. Cena z przecinkiem („12,50”) i ilość z przecinkiem („15,5 kg”) — przyjęte jak z kropką (test w Task 6 i 7).
2. Łój ponad wolny stan partii (15 kg przy 10 wolnych) — odmowa 400 z numerem partii, nic nie zapisane (test w Task 2).
3. Podwójne kliknięcie „Dopisz” — ta sama pozycja nie wchodzi dwa razy (klient wysyła `line_id`; serwer ignoruje powtórzony) (test w Task 2).
4. Anulowanie WM/kompletu z dopisanym łojem — łój wraca na stan (test w Task 1).
5. Dokument w EUR — okno pokazuje „€” i kurs, wartość liczona w EUR, saldo klienta w EUR (test w Task 2 i 7).

---

### Task 1: Wspólny rozchód i zwrot surowca

**Files:**
- Modify: `kebab_fixed/backend/app/services/wz_service.py` (gałęzie `raw`/`meat`/`byproduct` w `create_manual_wz` ok. l. 973–1060; zwroty w `cancel_wz` ok. l. 1406–1450)
- Modify: `kebab_fixed/backend/app/services/split_documents_service.py` (`anuluj_dokumenty_podzialu`, pętla pomijająca `stock_type != 'fg'`)
- Test: `kebab_fixed/backend/tests/test_wz_pozycje_dodatkowe_db.py` (nowy)

**Interfaces:**
- Produces: `wydaj_surowiec(conn, wz_id: str, sel: dict) -> dict` — zdejmuje stan wg `sel["stock_type"]`, robi ruch OUT, zwraca pola do linii (`batch_no`, `stock_type`, `stock_id`, daty partii, `containers`); `zwroc_surowiec(conn, wz_id: str, line: dict, qty: float | None = None) -> None` — oddaje `qty` (domyślnie całą ilość linii), ruch CANCEL, lot wraca do `open`/`AVAILABLE`.

- [ ] **Step 1: Test** `test_anulowanie_kompletu_oddaje_dopisany_surowiec`: komplet WM z linią `stock_type='raw'` 15 kg (wstawioną przez `wydaj_surowiec`) → `anuluj_dokumenty_podzialu` → `raw_batches.kg_available` wraca do wartości sprzed; `test_cancel_wz_raw_bez_zmian` — dotychczasowe zachowanie `cancel_wz` dla ręcznej WZ z surowcem.
- [ ] **Step 2: Uruchom** `TEST_DATABASE_URL=… python3 -m pytest tests/test_wz_pozycje_dodatkowe_db.py -v` → FAIL (split nie oddaje surowca).
- [ ] **Step 3: Wyciągnij** obie funkcje (bez zmiany zachowania `create_manual_wz`/`cancel_wz`), użyj `zwroc_surowiec` w `anuluj_dokumenty_podzialu` dla linii nie-`fg` z `stock_id`.
- [ ] **Step 4: Uruchom** nowy plik + `tests/test_wz*_db.py tests/test_*split*_db.py` → PASS.
- [ ] **Step 5: Commit** `refactor(wz): wspólny rozchód/zwrot surowca; anulowanie kompletu oddaje surowiec`

### Task 2: Serwer — dopisywanie i usuwanie pozycji dodatkowych

**Files:**
- Create: `kebab_fixed/backend/app/services/wz_pozycje_dodatkowe.py`
- Modify: `kebab_fixed/backend/app/routes/wz.py` (dwa endpointy)
- Test: `kebab_fixed/backend/tests/test_wz_pozycje_dodatkowe_db.py`, `kebab_fixed/backend/tests/test_wz_pozycje_dodatkowe.py` (czyste funkcje)

**Interfaces:**
- Consumes: `wydaj_surowiec`, `zwroc_surowiec` (Task 1); `_rebook_wz_containers(conn, wz_id)`, `get_wz(wz_id)` z `wz_service`.
- Produces:
  - `linia_reczna(dane: dict, valued: bool) -> dict` — `{line_id, stock_type:'reczna', name, qty, unit, price, vat_rate, value, total_kg?}`; odmowa 400 przy pustej nazwie, qty ≤ 0, j.m. spoza listy.
  - `cel_pozycji(conn, wz: dict, rodzaj: str) -> {"stan": wz_id | None, "zaplata": wz_id | None}` — reguły tabeli ze spec: zwykła WZ → oba = ta WZ; WM `calosc` + WZ klienta (to samo `source_id` i `loading_id`, `split_scope='wz_klienta'`, nieanulowana) → surowiec: stan=WM, zapłata=WZ klienta (gdy `do_zaplaty`), ręczna: stan=None, zapłata=WZ klienta; sam WM → ręczna = 409 z komunikatem z Global Constraints, surowiec: stan=WM, zapłata=None. Wywołanie na WZ klienta przekierowuje do pary.
  - `dopisz_pozycje(wz_id: str, body: dict) -> dict` (zwraca `get_wz(wz_id)`); body: `{lineId, rodzaj:'reczna'|'surowiec', name, qty, unit, price, vatRate, stockType?, stockId?, doZaplaty?: bool=True}`. Kopia linii na WZ klienta dostaje ten sam `line_id`, bez `stock_id` (bez ruchu stanu). Przelicza `total_value` każdego zmienionego dokumentu, `_rebook_wz_containers`, stempluje `dopisana_at`.
  - `usun_pozycje(wz_id: str, line_id: str) -> dict` — usuwa linię o `line_id` z obu dokumentów pary; surowiec → `zwroc_surowiec`; odmowa 409 dla linii bez `line_id` (wyrób) i dla dokumentu anulowanego.
  - Route: `POST /api/wz/{wz_id}/pozycje`, `DELETE /api/wz/{wz_id}/pozycje/{line_id}`.

- [ ] **Step 1: Testy czyste** (`test_wz_pozycje_dodatkowe.py`): `linia_reczna({"name":"Jogurt naturalny","qty":"10","unit":"szt","price":"4,50","vatRate":5}, True)` → `value == 45.0`, brak `total_kg`; `unit:"kg", qty:"15,5", price:"2"` → `total_kg == 15.5`, `value == 31.0`; pusta nazwa → HTTPException 400.
- [ ] **Step 2: Testy DB**: (a) zwykła WZ + jogurt → `total_value` +45, stan bez zmian, saldo klienta (Rozrachunki, karta klienta) +45 brutto; (b) WM+WZ klienta + łój 15 kg `doZaplaty` → `raw_batches` −15, linia na WM ze `stock_id`, linia na WZ klienta z ceną bez `stock_id`, ten sam `line_id`; (c) sam WM + jogurt → 409 z komunikatem; (d) łój 15 kg przy 10 wolnych → 400 z numerem partii, dokumenty bez zmian; (e) powtórzony `lineId` → druga linia nie powstaje, stan zdjęty raz; (f) `usun_pozycje` łoju → stan +15, linia znika z obu dokumentów; (g) WZ w EUR z `eur_rate` → wartość w EUR, waluta dokumentu bez zmian; (h) dokument anulowany → 409.
- [ ] **Step 3: Uruchom** → FAIL.
- [ ] **Step 4: Implementuj** moduł i endpointy (liczby przez ten sam parser przecinka co reszta serwera; jedna transakcja `FOR UPDATE` na obu dokumentach pary, kolejność blokad: WM przed WZ klienta).
- [ ] **Step 5: Uruchom** oba pliki → PASS.
- [ ] **Step 6: Commit** `feat(wz): dopisywanie i usuwanie pozycji dodatkowych (z ręki / z surowca) wg zasad WM/WZ`

### Task 3: Konsumenci linii liczą tylko wyrób

**Files:**
- Modify: `kebab_fixed/backend/app/services/loading_service.py` (`verify_wz_against_loaded`, gałąź WM przed `picks_z_dokumentu`, `pozycje_kursu`)
- Modify: `kebab_fixed/backend/app/services/hdi_service.py`, `order_stock_service.py`, `orders_service.py` (quantity-chain / „wydano”), `split_documents_service.py` (`_kg_z_linii` dla pokrycia kursu) — tylko miejsca czytające linie WZ/WM
- Test: `kebab_fixed/backend/tests/test_wz_pozycje_dodatkowe_db.py`

**Interfaces:**
- Produces: `linie_wyrobu(lines: list[dict]) -> list[dict]` w `wz_service.py` — linie z `stock_type in (None, 'fg')` (stare linie bez `stock_type` = wyrób).

- [ ] **Step 1: Testy**: `verify_wz_against_loaded(linie + [jogurt, łój], loaded)` → `'potwierdzony'`; quantity-chain zamówienia z dopisanym jogurtem — „na WZ” bez zmian; HDI kursu z dopisanym łojem — pozycje HDI bez zmian; pokrycie kursu (`_pokrycie_wysylki`) bez łoju.
- [ ] **Step 2: Uruchom** → FAIL (rozjazd od jogurtu).
- [ ] **Step 3: Implementuj** `linie_wyrobu` i użyj w wymienionych miejscach (grep `lines` w tych plikach; Rozrachunki i suma wartości zostają na wszystkich liniach).
- [ ] **Step 4: Uruchom** nowy plik + `tests/test_loading*_db.py tests/test_hdi*_db.py tests/test_usluga_pozycje_db.py` → PASS.
- [ ] **Step 5: Commit** `fix(wz): załadunek, HDI i „wydano” liczą tylko wyrób, nie pozycje dodatkowe`

### Task 4: Edytor — wystawienie WZ z pozycjami dodatkowymi (serwer)

**Files:**
- Modify: `kebab_fixed/backend/app/services/wz_service.py` (`create_manual_wz`, `build_manual_wz_lines`)
- Modify: `kebab_fixed/backend/app/routes/wz.py` (`manual`: przepuść `lineId`)
- Test: `kebab_fixed/backend/tests/test_wz_pozycje_dodatkowe_db.py`

**Interfaces:**
- Consumes: `linia_reczna` (Task 2).
- Produces: `POST /wz/manual` przyjmuje `items[].stockType == 'reczna'` bez `stockId` (linia przez `linia_reczna`, bez ruchu stanu); `raw|meat|byproduct` jak dotąd. Gdy `orderId` wskazuje zamówienie z podziałem — bez zmian (ta ścieżka i tak odmawia, patrz `_odmow_jesli_koliduje`).

- [ ] **Step 1: Test** `test_manual_wz_z_wyrobem_jogurtem_i_lojem`: yaprak (fg) + jogurt + łój 15 kg w jednym `create_manual_wz(order_id=…)` → 3 linie, stan fg i łoju zdjęty, jogurt bez ruchu, `total_value` = suma.
- [ ] **Step 2: Uruchom** → FAIL („Nieznany typ magazynu: reczna”).
- [ ] **Step 3: Implementuj.**
- [ ] **Step 4: Uruchom** → PASS + `tests/test_wz*_db.py`.
- [ ] **Step 5: Commit** `feat(wz): ręczna WZ przyjmuje pozycje z ręki`

### Task 5: Wydruk WM — „Wydanie zewnętrzne” bez paska

**Files:**
- Modify: `kebab_fixed/src/components/wz/WzDocumentView.tsx:186-215` (tytuł, pasek), sekcja uwag
- Modify: `kebab_fixed/backend/app/services/split_documents_service.py:45,214` (nowe WM bez `_NOTATKA_WM`)
- Test: `kebab_fixed/src/components/wz/wzDocumentView.test.tsx`

- [ ] **Step 1: Test**: WM z `ukrywa_czesc_poza_faktura: true` i `notes: 'DOKUMENT WEWNĘTRZNY — NIE WYDAWAĆ KLIENTOWI'` → brak tekstu „NIE WYDAWAĆ”, jest „Wydanie zewnętrzne” i numer `WM/…`.
- [ ] **Step 2: Uruchom** `npx vitest run src/components/wz/wzDocumentView.test.tsx --pool=forks --poolOptions.forks.singleFork` → FAIL.
- [ ] **Step 3: Implementuj**: tytuł „Wydanie zewnętrzne {numer}” dla WZ i WM; usuń pasek; uwagi pomijają dokładnie tę starą notatkę; serwer nie zapisuje jej w nowych WM.
- [ ] **Step 4: Uruchom** → PASS (+ `test_order_split*_db.py` oczekujące notatki poprawione).
- [ ] **Step 5: Commit** `fix(wz): WM drukuje się jako Wydanie zewnętrzne, bez paska „nie wydawać klientowi”`

### Task 6: PROTRIMA — wiersze dodatkowe w edytorze WZ

**Files:**
- Modify: `kebab_fixed/src/lib/api.ts` (`wzApi.createManual` typ `stockType` + `'reczna'`, `stockId?`; `wzApi.dopiszPozycje(id, body)`, `wzApi.usunPozycje(id, lineId)`)
- Modify: `kebab_fixed/src/protrima/modules/orders/wz/model.ts` (`WierszDodatkowy`, `FormWz.dodatkowe`, `doDto`, `sumy`, `walidacja`)
- Create: `kebab_fixed/src/protrima/modules/orders/wz/PozycjaDodatkowa.tsx` (formularz „Z ręki” i wybór partii „Z magazynu surowca” — używany też w Task 7)
- Modify: `kebab_fixed/src/protrima/modules/orders/wz/WzZamowienia.tsx`
- Test: `kebab_fixed/src/protrima/modules/orders/wz/model.test.ts`, `WzZamowienia.test.tsx`

**Interfaces:**
- Produces: `interface WierszDodatkowy { lineId: string; rodzaj: 'reczna' | 'surowiec'; name: string; qtyStr: string; unit: 'szt' | 'kg' | 'opak.'; priceStr: string; vatRate: number; stockType?: 'raw' | 'meat' | 'byproduct'; stockId?: string; batchNo?: string; wolneKg?: number }`; `PozycjaDodatkowaForm({ waluta: 'PLN' | 'EUR'; kurs?: number; vatDomyslny: number; onDodaj: (w: WierszDodatkowy) => void; onAnuluj })` z zakładkami „Z ręki” / „Z magazynu surowca” (lista `wzApi.stockRaw()`: szukaj, FEFO po dacie ważności, wolne kg; domyślna ilość pusta, nie cała partia).

- [ ] **Step 1: Testy modelu**: `doDto` z jogurtem (`qtyStr:'10', priceStr:'4,50'`) → item `{stockType:'reczna', name:'Jogurt naturalny', unit:'szt', qty:10, price:4.5}` bez `stockId`; łój `qtyStr:'15,5'` → `{stockType:'raw', stockId, unit:'kg', qty:15.5}`; `walidacja` — łój ponad `wolneKg` i pusta nazwa jogurtu → błąd przy polu; `sumy` doliczają wartość dodatkowych.
- [ ] **Step 2: Test ekranu**: dodanie jogurtu i łoju → przycisk wystaw wysyła oba w `createManual`; przy walucie EUR pole ceny pokazuje „€”.
- [ ] **Step 3: Uruchom** → FAIL.
- [ ] **Step 4: Implementuj** (sekcja „Pozycje dodatkowe” pod tabelą wyrobu, dwa przyciski „+ Z magazynu surowca” / „+ Pozycja z ręki”, tagi „z ręki” / „surowiec”, usuń; podpowiedź nazw z ostatnich WZ — `<datalist>` z nazw linii `reczna` z `wzApi.list()`).
- [ ] **Step 5: Uruchom** `npx vitest run src/protrima/modules/orders/wz …` → PASS; `npx tsc --noEmit -p .` → 0.
- [ ] **Step 6: Commit** `feat(protrima): pozycje z ręki i z magazynu surowca w edytorze WZ`

### Task 7: PROTRIMA — „Dopisz pozycję…” na wystawionym dokumencie

**Files:**
- Create: `kebab_fixed/src/protrima/modules/orders/wz/DopiszPozycjeDialog.tsx`
- Modify: `kebab_fixed/src/protrima/modules/orders/tabs/Documents.tsx` (akcja przy WZ/WM na liście „Wszystkie dokumenty zamówienia”)
- Modify: `kebab_fixed/src/protrima/modules/wysylki/PapieryKursu.tsx` (akcja przy wystawionym komplecie odbiorcy)
- Test: `kebab_fixed/src/protrima/modules/orders/wz/DopiszPozycje.test.tsx`

**Interfaces:**
- Consumes: `PozycjaDodatkowaForm` (Task 6), `wzApi.dopiszPozycje/usunPozycje`, `wzApi.byId`.
- Produces: `DopiszPozycjeDialog({ wzId: string; onClose: () => void; onZmiana: () => void })` — nagłówek: numer, waluta (i kurs dla EUR); lista pozycji dokumentu z dopisanymi (tag, kosz z potwierdzeniem przy surowcu „oddaje N kg na stan partii X”); formularz dodawania; przy parze WM+WZ klienta ptaszek „do zapłaty na WZ klienta” (domyślnie zaznaczony) dla surowca; przy samym WM zakładka „Z ręki” wyłączona z komunikatem z Global Constraints.

- [ ] **Step 1: Testy**: dopisanie jogurtu woła `dopiszPozycje(id, {rodzaj:'reczna', qty:10, price:4.5, lineId: expect.any(String)})`; podwójny klik — jedno wywołanie (przycisk zablokowany w trakcie); odpowiedź 409 pokazana w oknie; WM bez pary — zakładka „Z ręki” wyłączona; EUR — „€” i kurs w nagłówku.
- [ ] **Step 2: Uruchom** → FAIL.
- [ ] **Step 3: Implementuj** i podepnij w obu miejscach.
- [ ] **Step 4: Uruchom** `npx vitest run src/protrima --pool=forks --poolOptions.forks.singleFork` → PASS; `tsc` → 0.
- [ ] **Step 5: Commit** `feat(protrima): dopisywanie pozycji do wystawionej WZ/WM, także z kursu`

### Task 8: Zrzuty, wersja, wdrożenie

- [ ] **Step 1:** Lokalny stos (baza `kebab_mes_zrzuty_dokumenty`, backend :8635, vite :5635): zrzuty 1366×768 — edytor WZ z jogurtem i łojem, okno „Dopisz pozycję” (PLN i EUR, sam WM), wydruk WM. Do akceptacji właściciela.
- [ ] **Step 2:** Po akceptacji: `"version": "0.10.0"` w `kebab_fixed/src-tauri/tauri.protrima.conf.json`, commit, push, CI zielone.
- [ ] **Step 3:** Prod (SSH `root@91.98.105.107`): wydanie `/opt/kebab/releases/wz-pozycje-20261114` (source = ten commit), próba generalna, `deploy.sh all` z `KEBAB_REPO=<release>/source/kebab_fixed`, smoke; `gh workflow run tauri-protrima.yml --ref feat/protrima-dokumenty-20261114`.
