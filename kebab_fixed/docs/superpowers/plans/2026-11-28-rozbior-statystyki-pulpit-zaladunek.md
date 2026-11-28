# Statystyki rozbioru, „Zamknij wszystkie”, załadunek na żywo — plan wykonania

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** PROTRIMA 0.19.0: menu kontekstowe kart, zakładka Statystyki w Rozbiorze (na żywo + archiwum, z/s vs b/s, źródło ważenia), panel „Załadunek na żywo” na Pulpicie.

**Architecture:** Backend rozszerza istniejące `deboning_stats` o sekcje liczone w nowym module `deboning_stats_extra.py`, włączane parametrem `extended=true` (stary MES bez zmian i bez kosztu). Nowy endpoint `GET /api/biuro/zaladunek-na-zywo` w `biuro_zamowienia_service`. Frontend: czysta logika w plikach `model.ts`/`zamykanieKart.ts` (testy vitest), komponenty w module rozbioru i na Pulpicie.

**Tech Stack:** FastAPI + psycopg2 (PostgreSQL), pytest z `TEST_DATABASE_URL`; React + TypeScript, vitest + Testing Library, recharts (już w zależnościach).

**Spec:** `kebab_fixed/docs/superpowers/specs/2026-11-28-rozbior-statystyki-pulpit-zaladunek-design.md`

Ścieżki poniżej względem `kebab_fixed/` w worktree `/opt/kebab/wt-rozbior-statystyki`.

## Global Constraints

- Dzień = dzień **pobrania** wg `Europe/Warsaw`; uboczne w dniu ważenia palety; jedno źródło na (partia, frakcja) — reguły z obecnego `deboning_stats`, bez zmian.
- Istniejące klucze odpowiedzi `/api/deboning/stats` bez zmian (stary `DeboningReportsPage`).
- Tryb ważenia: `NULL` = `unknown`; palety zbiorcze ważone przed `2026-07-07` = `unknown`; nigdy nie zgadujemy „z wagi”.
- „Z wagi %” = kg auto ÷ (kg auto + kg manual); `unknown` i `office` poza mianownikiem.
- Pobranie ćwiartki nominalne — nie ma trybu ważenia.
- Teksty po polsku, liczby `pl-PL`, kg z jednym miejscem po przecinku (helper `kg` z `RozbiorModule`).
- Testy serwera na osobnej bazie testowej, nigdy dwa przebiegi pytest naraz (mało pamięci).
- Repo publiczne: w testach tylko fikcyjne nazwiska/firmy/NIP-y.
- Wersja PROTRIMA: `src-tauri/tauri.protrima.conf.json` → `0.19.0`.

## Review Focus

1. Pobranie zaczęte wczoraj, mięso zważone dziś → mięso i jego tryb liczą się we wczoraj (dzień pobrania), nie dziś — test w Task 1.
2. Pobranie z porcjami z/s i b/s → ćwiartka dzielona proporcjonalnie, suma z/s+b/s = `summary.kgQuarter` — test w Task 1.
3. „Dziś” o 10:00 → poprzedni okres liczony tylko do 10:00 — test w Task 2.
4. Zamówienie w połowie wysłane wcześniejszym kursem → ✓ dopiero, gdy reszta na aucie; pasek auta nie liczy wysłanych — test w Task 3.
5. „Zamknij wszystkie”, gdy aktywna jest karta edycji, a użytkownik wybiera „Zostaw okna edycji” → aktywna zostaje pierwsza zostawiona karta edycji, nie Pulpit — test w Task 4.

---

### Task 1: Źródło ważenia, z/s vs b/s, ręczne ważenia (backend)

**Files:**
- Create: `backend/app/services/deboning_stats_extra.py`
- Modify: `backend/app/services/deboning_service.py` (`deboning_stats`: SELECT wpisów + `weigh_mode`, `meat_type`; parametr `extended`; dołączenie sekcji)
- Modify: `backend/app/routes/deboning.py:185` (query `extended: bool = False`)
- Test: `backend/tests/test_deboning_stats_extra_db.py`

**Interfaces:**
- Produces:
  - `deboning_stats(date_from: str, date_to: str, extended: bool = False, until_time: str | None = None) -> dict` — przy `extended` dodaje klucze `weighing`, `manualList`, `summary.meatByType`, `workers[].weighings|manualWeighings|manualKg`.
  - `weighing_sources(entries: list[dict], summary: dict, covered: dict[str, set[str]], date_from: str, date_to: str) -> dict` →
    `{"meat"|"backs"|"bones": {"auto": {"n": int, "kg": float}, "manual": {...}, "unknown": {...}, "office": {"kg": float}}, "autoPct": float | None, "manualCount": int}`
  - `meat_by_type(entries: list[dict], portions: dict[str, list[dict]]) -> {"zs": {"kgQuarter","kgMeat","yieldPct"}, "bs": {...}}`
  - `manual_list(...) -> list[{"at": iso, "workerName": str | None, "batchNo": str, "fraction": "meat"|"backs"|"bones", "kg": float, "reason": str}]` (limit 200, najnowsze pierwsze)

Reguły klasyfikacji (spec §B): mięso — porcje `deboning_take_weighings` wpisów z okresu (dzień = dzień pobrania wpisu); wpis bez porcji — `deboning_entries.weigh_mode`. Grzbiety/kości — palety `batch_byproducts.*_pallets` w dniu palety: z `weighingId` → tryb z `deboning_settlement_weighings`; `tareLabel == 'ręcznie'` → manual; inna tara → auto; `weighedAt < 2026-07-07` → unknown; `*_kg` bez palet i per-wpisowe `kg_backs/kg_bones` → unknown. `byproduct_pallet_checks` i `deboning_settlement_weighings` kind=`meat` pomijane. `office` = kg frakcji w `summary` − (auto+manual+unknown), zaokrąglone do 0,1; dzięki temu suma się zgadza.

- [ ] **Step 1: Testy (failing)** w `test_deboning_stats_extra_db.py` (helpery seedujące jak `_seed_entry_at` w `test_deboning_stats_day_db.py`):
  - `test_bez_extended_odpowiedz_bez_nowych_kluczy` — `"weighing" not in deboning_stats(d, d)`.
  - `test_porcje_auto_i_manual_mieso` — wpis 200 kg ćwiartki, porcje 100 auto + 32 manual → `weighing["meat"]["auto"] == {"n": 1, "kg": 100.0}`, `manual == {"n": 1, "kg": 32.0}`, `autoPct == 75.8`.
  - `test_weigh_mode_null_to_unknown` — wpis bez porcji, `weigh_mode` NULL → `meat.unknown.kg == 132.0`, `autoPct is None`.
  - `test_mieso_z_rozliczenia_nie_liczone_dwa_razy` — ten sam kg w `deboning_take_weighings` i `deboning_settlement_weighings` (kind meat) → suma meat (auto+manual+unknown+office) == `summary.kgMeat`.
  - `test_paleta_reczna_i_z_tara` — `backs_pallets` = [{tareLabel:'E2', net:40, weighedAt:dziś}, {tareLabel:'ręcznie', net:10, weighedAt:dziś}] → backs auto 40 / manual 10.
  - `test_paleta_sprzed_lipca_unknown` — paleta `tareLabel:'E2'`, `weighedAt` 2026-07-01 → `backs.unknown.kg == 40.0` dla zakresu 2026-07-01.
  - `test_paleta_pracownika_bierze_tryb_z_rozliczenia` — paleta z `weighingId` wskazującym `deboning_settlement_weighings` z `weigh_mode='manual'` → manual.
  - `test_korekta_biura_jako_office` — `kg_meat` wpisu poprawione na 140 przy porcjach 132 auto → `meat.office.kg == 8.0`.
  - `test_wieczorne_pobranie_mieso_dzis_liczy_sie_wczoraj` — pobranie 2026-11-27 18:00 PL, porcja 2026-11-28 07:00 → tryb w raporcie 27.11, nie 28.11.
  - `test_zs_bs_proporcjonalnie` — wpis 200 kg, porcje z/s 90 + b/s 30 → zs.kgQuarter 150.0, bs.kgQuarter 50.0, zs.yieldPct 60.0, bs.yieldPct 60.0; zs+bs kgQuarter == summary.kgQuarter.
  - `test_reczne_u_pracownika_i_lista` — `workers[0]["manualWeighings"] == 1`, `manualList[0]["fraction"] == "meat"`.
- [ ] **Step 2:** `cd backend && TEST_DATABASE_URL=… python3 -m pytest tests/test_deboning_stats_extra_db.py -q` → FAIL.
- [ ] **Step 3:** Zaimplementować funkcje z Interfaces; zapytania hurtem (`= ANY(%s)`), bez N+1.
- [ ] **Step 4:** Ten sam pytest → PASS; plus `tests/test_deboning_stats_day_db.py tests/test_deboning_stats_supplier_name_db.py tests/test_deboning_worker_metrics_db.py` → PASS (bez regresji).
- [ ] **Step 5:** Commit `feat(rozbior): statystyki — źródło ważenia, z/s vs b/s, ręczne ważenia`.

### Task 2: Poprzedni okres, na żywo, furtki, korekty (backend)

**Files:**
- Modify: `backend/app/services/deboning_stats_extra.py`, `backend/app/services/deboning_service.py` (`until_time` w SELECT wpisów i palet)
- Test: `backend/tests/test_deboning_stats_extra_db.py`

**Interfaces:**
- Consumes: `deboning_stats(..., extended, until_time)` z Task 1.
- Produces (klucze przy `extended`):
  - `previous: {"dateFrom","dateTo","untilTime": str|None, "kgQuarter","kgMeat","yieldZs": float|None,"backsPct","bonesPct","missingPct","kgPerHour","autoPct": float|None}`
  - `live: {"openTakes": [{"entryId","workerName","batchNo","kgQuarter","since"}], "lastWeighByWorker": {workerId: iso}, "peopleLastHour": int} | None` (None, gdy okres nie obejmuje dziś)
  - `overrides: {"total": int, "byWorker": {workerId: int}}`
  - `corrections: {"edits": int, "deleted": int}`
  - `previous_range(date_from: str, date_to: str, today: date, now_time: str) -> tuple[str, str, str | None]`

Reguły: okres = sam dzisiejszy dzień → poprzedni = dziś−7, `untilTime` = teraz (HH:MM PL); inny okres N dni → N dni bezpośrednio przed, bez cięcia godziny. `corrections.edits` = wiersze `deboning_entry_corrections` w okresie bez `reason` zaczynającego się od „Ominięcie” i bez `changes.usuniety`; `deleted` = z `changes.usuniety`. `overrides` z istniejącej `yield_overrides(date_from, date_to)`.

- [ ] **Step 1: Testy (failing):**
  - `test_previous_range_dzis` — `previous_range("2026-11-28","2026-11-28", date(2026,11,28), "10:00") == ("2026-11-21","2026-11-21","10:00")`.
  - `test_previous_range_tydzien` — `("2026-11-22","2026-11-28", …)` → `("2026-11-15","2026-11-21", None)`.
  - `test_previous_tnie_do_godziny` — wpisy 21.11 o 09:00 i 14:00 PL; `deboning_stats("2026-11-21","2026-11-21", until_time="10:00")["summary"]["quarters"] == 1`.
  - `test_live_tylko_gdy_dzis` — `live is None` dla wczoraj; dla dziś otwarte pobranie (status ≠ complete) jest w `openTakes`.
  - `test_korekty_bez_furtki` — 1 korekta + 1 „Ominięcie…” + 1 `usuniety` → `{"edits": 1, "deleted": 1}`, `overrides.total == 1`.
- [ ] **Step 2:** pytest pliku → FAIL.
- [ ] **Step 3:** Implementacja; `previous` liczy `deboning_stats(pf, pt, extended=False, until_time=…)` i dolicza `yieldZs`/`autoPct` przez funkcje z Task 1 (bez rekurencji `extended`).
- [ ] **Step 4:** pytest pliku i trzech plików regresji z Task 1 → PASS. Czas: `deboning_stats` za 30 dni z `extended` na bazie testowej z ~3000 wpisów < 1,5 s (test `test_wydajnosc_miesiaca` z `time.perf_counter`, oznaczony `@pytest.mark.slow`).
- [ ] **Step 5:** Commit `feat(rozbior): statystyki — poprzedni okres, na żywo, furtki i korekty`.

### Task 3: Załadunek na żywo (backend)

**Files:**
- Modify: `backend/app/services/biuro_zamowienia_service.py` (nowa funkcja), `backend/app/routes/biuro.py` (trasa)
- Test: `backend/tests/test_zaladunek_na_zywo_db.py` (helpery z `tests/test_biuro_zamowienia_db.py` i `tests/test_finalize_loading_db.py`)

**Interfaces:**
- Produces: `zaladunek_na_zywo(today: date | None = None) -> list[dict]`; `GET /api/biuro/zaladunek-na-zywo`. Element:
  `{"vehicleId","name","plate","startedAt": iso|None,"lastLoadedAt": iso|None,"unitsLoaded": int,"unitsToLoad": int,"kgLoaded": float,"kgToLoad": float,"orders": [{"orderId","orderNo","clientName","clientShortName","position","unitsHere","unitsShippedBefore","unitsTotal","kgHere","kgTotal","complete": bool,"orderStatus"}]}`
  Jednostka = paleta `order_pallets` lub karton `stock_cartons` powiązany z zamówieniem. `unitsToLoad` auta = Σ(`unitsTotal − unitsShippedBefore`). `complete` = każda jednostka zamówienia `loaded` lub `shipped`. Auto widoczne, gdy ma wiersze `vehicle_loading_orders` **i** (≥1 jednostka `loaded` na nim albo `vehicle_loading_orders.created_at` z dziś PL). Sortowanie: `startedAt` rosnąco, auta bez startu na końcu.

- [ ] **Step 1: Testy (failing):**
  - `test_brak_aut_pusta_lista` → `[]`.
  - `test_czesciowy_zaladunek` — zamówienie 3 palety, 2 `loaded` na aucie → `unitsLoaded == 2`, `unitsToLoad == 3`, `orders[0]["complete"] is False`, `startedAt` = najwcześniejszy `loaded_at`.
  - `test_czesc_wyslana_wczesniej` — 4 palety: 2 `shipped` innym autem, 2 `loaded` tu → `unitsShippedBefore == 2`, `unitsToLoad == 2`, `complete is True`.
  - `test_stare_przypisanie_bez_skanu_ukryte` — `vehicle_loading_orders.created_at` = wczoraj, brak skanów → `[]`; to samo z dziś → 1 auto, `startedAt is None`.
  - `test_karton_magazynowy_liczy_sie` — karton `stock_cartons` z `linked_order_id`, `loaded_vehicle_id` = auto → `unitsHere == 1`.
  - `test_dwa_auta_kolejnosc_position` — kolejność zamówień wg `position`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementacja: 3 zapytania hurtem (przypisania+auta+zamówienia; jednostki zamówień z UNION palet i kartonów; kg z `order_pallet_items`×`kg_per_unit` / `stock_carton_lines`).
- [ ] **Step 4:** pytest pliku + `tests/test_biuro_zamowienia_db.py` → PASS.
- [ ] **Step 5:** Commit `feat(pulpit): załadunek na żywo — endpoint`.

### Task 4: Menu kontekstowe kart (PROTRIMA)

**Files:**
- Create: `src/protrima/shell/zamykanieKart.ts`, `src/protrima/shell/zamykanieKart.test.ts`, `src/protrima/shell/MenuKarty.tsx`, `src/protrima/shell/MenuKarty.test.tsx`
- Modify: `src/protrima/shell/Chrome.tsx` (`TabStrip`: prop `onMenu(id: string, x: number, y: number)` na `onContextMenu`, `preventDefault`), `src/protrima/App.tsx` (`closeMany`, stan menu, okno potwierdzenia, pozycje w menu „Okno”, Ctrl+Shift+W)

**Interfaces:**
- Produces:
  - `type TrybZamykania = 'jedna' | 'pozostale' | 'wszystkie'`
  - `doZamkniecia(tabs: WTab[], tryb: TrybZamykania, kartaId: string): { zwykle: string[]; edycja: WTab[] }` — nigdy nie zawiera `'pulpit'`; `'pozostale'` pomija `kartaId`; karta edycji = `kind` ∉ {`module`,`order`}.
  - `MenuKarty({ x, y, kartaId, onWybierz(tryb), onClose })` — role `menu`/`menuitem`, strzałki/Enter/Esc, klik obok zamyka; na Pulpicie tylko „Zamknij wszystkie”.
  - W `App.tsx`: `closeMany(ids: string[])` — aktywna: jeśli aktywna zamknięta → pierwsza pozostała karta inna niż Pulpit, inaczej Pulpit.
- Okno (istniejący `Dialog` z `shell/context.tsx`), tytuł „Zamknąć też okna edycji?”, treść „Niezapisane zmiany w nich przepadną:” + lista tytułów, przyciski: „Zamknij wszystkie”, „Zostaw okna edycji”, „Anuluj”.

- [ ] **Step 1: Testy (failing):**
  - `zamykanieKart.test.ts`: `wszystkie` na [pulpit, rozbior, order:1, new:1] → `zwykle == ['rozbior','order:1']`, `edycja` = [new:1]; `pozostale` z `kartaId='rozbior'` → `zwykle == ['order:1']`; `jedna` → `[kartaId]` (lub do `edycja`, gdy to edytor).
  - `MenuKarty.test.tsx`: prawy klik na karcie „Rozbiór” w `TabStrip` pokazuje trzy pozycje; na Pulpicie jedną; Esc zamyka.
  - Test w `Root.test.tsx` (lub nowy `App.zamykanie.test.tsx`): „Zamknij wszystkie” bez edytorów → zostaje tylko Pulpit, aktywny; z edytorem → okno; „Zostaw okna edycji” → zostaje Pulpit + edytor i edytor jest aktywny; Ctrl+Shift+W otwiera ten sam przepływ.
- [ ] **Step 2:** `npx vitest run src/protrima/shell` → FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** `npx vitest run src/protrima/shell src/protrima/Root.test.tsx` → PASS.
- [ ] **Step 5:** Commit `feat(protrima): prawy przycisk na karcie — zamknij, pozostałe, wszystkie`.

### Task 5: Model statystyk i typy API (PROTRIMA)

**Files:**
- Modify: `src/lib/api.ts` (`DeboningStats` — opcjonalne nowe pola; `deboningApi.stats(from, to, extended?: boolean)`; `biuroApi.zaladunekNaZywo()` + typ `ZaladunekAuta`)
- Create: `src/protrima/modules/rozbior/statystyki/model.ts`, `model.test.ts`

**Interfaces:**
- Produces:
  - `type RodzajOkresu = 'dzis' | 'wczoraj' | '7dni' | 'miesiac' | 'zakres'`
  - `okres(rodzaj: RodzajOkresu, dzis: Date, zakres?: {od: string; do: string}): { od: string; do: string; etykieta: string; naZywo: boolean }` (`miesiac` = od 1. dnia bieżącego miesiąca do dziś; `7dni` = dziś−6..dziś)
  - `przesun(o: {od; do}, kierunek: -1 | 1, dzis: Date): {od; do}` — przesuwa o długość okresu, nie poza dziś.
  - `delta(teraz: number | null, poprzednio: number | null, lepiej: 'wiecej' | 'mniej' | 'brak', jednostka: 'kg' | 'pp' | '%'): { tekst: string; poziom: 'dobrze' | 'zle' | 'neutral' } | null` — `pp` dla procentów (np. „+1,2 p.p.”), null gdy brak poprzedniego.
  - `tekstZWagi(w: DeboningStats['weighing']): string` — np. „97,4% z wagi · 4 ręcznie”, „tryb nieznany”, gdy `autoPct` null.
  - `pasekBilansu(s: DeboningStats): { klucz: 'zs'|'bs'|'grzbiety'|'kosci'|'ubytek'; kg: number; pct: number }[]` (ubytek ujemny → klucz `ubytek` z kg < 0 i pct 0, osobny dopisek „nadwyżka”).

- [ ] **Step 1: Testy (failing)** w `model.test.ts`: `okres('7dni', new Date(2026,10,28))` → od `2026-11-22`; `okres('dzis', …).naZywo === true`; `przesun({od:'2026-11-22',do:'2026-11-28'}, 1, dzis)` nie wychodzi poza 28.11; `delta(64.1, 62.9, 'wiecej', 'pp')` → `{tekst:'+1,2 p.p.', poziom:'dobrze'}`; `delta(5, 3, 'mniej', 'pp').poziom === 'zle'`; `tekstZWagi({autoPct:null,…}) === 'tryb nieznany'`; suma `pct` w `pasekBilansu` = 100 ±0,1.
- [ ] **Step 2:** `npx vitest run src/protrima/modules/rozbior/statystyki` → FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** → PASS; `npx tsc --noEmit -p .` bez nowych błędów.
- [ ] **Step 5:** Commit `feat(rozbior): model statystyk i typy API`.

### Task 6: Zakładka Statystyki w Rozbiorze (PROTRIMA)

**Files:**
- Create: `src/protrima/modules/rozbior/statystyki/Statystyki.tsx`, `Statystyki.test.tsx`, style w `src/protrima/styles/` (plik modułu rozbioru lub nowy `rozbior-statystyki.css` importowany w komponencie, zgodnie z konwencją modułów)
- Modify: `src/protrima/modules/rozbior/RozbiorModule.tsx` (zakładki „Statystyki” | „Korekty”, domyślnie Statystyki; prop `filtrPartii` do Korekt), `src/protrima/App.tsx:368-369` (menu: „Statystyki rozbioru” → zakładka Statystyki)

**Interfaces:**
- Consumes: Task 5 (`okres`, `przesun`, `delta`, `tekstZWagi`, `pasekBilansu`, `deboningApi.stats(od, do, true)`).
- Produces: `Statystyki({ active, onPartia(batchNo: string) })`.

Układ i treści wg spec §B „PROTRIMA — zakładka Statystyki” (punkty 1–7). Odświeżanie: `useLiveRefresh` co 30 s tylko gdy `active && naZywo`. Znacznik „na żywo · HH:MM”. Wykresy recharts (przebieg dnia: słupki kg/godz. + linia wydajności; okres: dni) — przed pisaniem wczytać skill `dataviz`. Tabela pracowników sortowana klikiem w nagłówek, wiersz rozwija `workerDaily`. Klik w partię → `onPartia` → Korekty z wpisanym filtrem.

- [ ] **Step 1: Testy (failing)** (mock `deboningApi.stats` jak w `Rozbior.test.tsx`):
  - pokazuje KPI „Wydajność z/s 64,1%” i deltę „+1,2 p.p.”;
  - „97,4% z wagi · 4 ręcznie”; klik przewija do „Ważenia ręczne”;
  - pusty dzień → „W tym dniu nie było rozbioru”;
  - `autoPct` null → „tryb nieznany”;
  - zmiana na „7 dni” woła `stats('2026-11-22','2026-11-28', true)`;
  - `active=false` → brak ponownego zapytania po 30 s (fake timers);
  - klik w partię wywołuje `onPartia('850')`; w `RozbiorModule` przełącza na Korekty z filtrem „850”.
- [ ] **Step 2:** vitest katalogu rozbioru → FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** vitest `src/protrima/modules/rozbior` → PASS (stare testy Korekt też).
- [ ] **Step 5:** Commit `feat(rozbior): zakładka Statystyki — na żywo i archiwum`.

### Task 7: Panel „Załadunek na żywo” na Pulpicie (PROTRIMA)

**Files:**
- Create: `src/protrima/modules/dashboard/ZaladunekNaZywo.tsx`, `ZaladunekNaZywo.test.tsx`
- Modify: `src/protrima/modules/dashboard/Dashboard.tsx` (panel nad „Przebieg dnia”), style Pulpitu

**Interfaces:**
- Consumes: `biuroApi.zaladunekNaZywo()` i `ZaladunekAuta` z Task 5.
- Produces: `ZaladunekNaZywo({ active })` — zwraca `null`, gdy lista pusta.

Kafel: rejestracja + nazwa, „ładuje od HH:MM (N min)” lub „czeka na pierwszą paletę”, pasek jednostek i kg auta, wiersze zamówień (nr, klient skrócony, pasek `unitsHere/(unitsTotal−unitsShippedBefore)`, ✓ przy `complete`, „+N wysłane wcześniej” gdy > 0), „ostatnia paleta HH:MM”; `lastLoadedAt` starsze niż 30 min → szary dopisek „bez ruchu od HH:MM”. Klik w zamówienie → `app.openOrder(orderId)`. Odświeżanie 15 s gdy `active`.

- [ ] **Step 1: Testy (failing):** pusta lista → nic nie renderuje; auto z 14/21 → tekst „14 / 21”; `complete` → ✓; `lastLoadedAt` 40 min temu → „bez ruchu od”; klik zamówienia woła `openOrder`.
- [ ] **Step 2:** vitest → FAIL.
- [ ] **Step 3:** Implementacja.
- [ ] **Step 4:** `npx vitest run src/protrima/modules/dashboard` → PASS.
- [ ] **Step 5:** Commit `feat(pulpit): załadunek na żywo`.

### Task 8: Wersja, pełne testy, zrzuty do akceptacji

**Files:**
- Modify: `src-tauri/tauri.protrima.conf.json` (`0.19.0`)

- [ ] **Step 1:** Wersja 0.19.0.
- [ ] **Step 2:** Pełny `npm test` (TZ=UTC vitest) → zielone; pełny pytest na osobnej bazie → zielone poza znanym testem tempa.
- [ ] **Step 3:** Stos zrzutów (backend + vite jak przy Kontrahentach, baza z fikcyjnym seedem: dzień z ręcznymi ważeniami, b/s, dwa auta w załadunku): zrzuty Pulpitu z panelem, menu karty, okna potwierdzenia, Statystyk (dziś, 7 dni, pusty dzień), jasny i ciemny motyw. Opublikować jako artefakt do akceptacji właściciela.
- [ ] **Step 4:** Commit `chore(protrima): 0.19.0`.
- [ ] **Step 5:** Przegląd całej gałęzi (świeży recenzent), poprawki, dopiero potem wydanie po akceptacji zrzutów.
