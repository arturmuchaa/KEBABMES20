# Plan produkcji w PROTRIMA — palety w planie, etykiety, bilans — plan B

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Biuro wieczorem układa w PROTRIMA plan dnia z konkretnych palet z chłodni (także kebaby z kilku rodzajów mięsa — mix udo/filet 70/30, 80/20, 95/5 — i pozycje „z końcówek” jako PM), wysyła go do produkcji, drukuje na Zebrze etykiety sztuk z QR w kolejności palet oraz etykiety końcówek, drukuje kartę dla kierownika, a po potwierdzeniu widzi bilans partii (teoria → ważone → wyroby → końcówka → strata) dla dnia i dla zakresu dat.

**Architecture:** Serwer dostaje zapis palet przy pozycjach (`palletIds`, `fromRemainders`, `palletGate` w istniejącym `POST/PUT /production-plans`), stan etykiet (`finished_units.label_printed_at`, `seasoned_pallets.label_printed_at`) i zestawienia (lista planów ze stanem, bilans za zakres). PROTRIMA dostaje moduł `src/protrima/modules/plan-produkcji/` zbudowany jak Plan masowania: czyste funkcje w `model.ts` z testami, szablony ZPL w `etykiety.ts`, druk przez `src/protrima/drukarka/`. Plan z PROTRIMA ma zawsze `pallet_gate = true`; stary edytor MES przestaje tworzyć plany.

**Tech Stack:** FastAPI + psycopg2 (`app.db`), pytest (`_db` na `TEST_DATABASE_URL`), React + Vitest (jsdom), ZPL (Zebra, `src/lib/zebra` przez `src/protrima/drukarka`).

**Spec:** `kebab_fixed/docs/superpowers/specs/2026-11-26-plan-produkcji-partie-design.md` (§6.2 druk końcówek, §6.3, §6.6, §7 anty-cel o starym MES, §8 znane błędy, §9). Plan A (wykonany, `5c50819d..be5d138f`): `…/plans/2026-11-26-plan-produkcji-palety-A.md`.

## Global Constraints

- Migracje wyłącznie addytywne w `backend/app/migrations.py` (`ADD COLUMN IF NOT EXISTS`, `CREATE … IF NOT EXISTS`); nowe tabele/kolumny dopisać do `_TRUNCATE` w `tests/conftest.py`, jeśli tabela jest nowa.
- Endpointy, z których korzystają tablety i stary MES (`/production-plans`, `/finished-units/*`, `/seasoned-pallets/*`), zmieniać tylko wstecznie zgodnie: nowe pola opcjonalne, domyślnie dotychczasowe zachowanie.
- `src/lib/api.ts` — zmiany tylko addytywne (wspólne z kioskami).
- Nic z nazw firm/adresów/progów zakładu w modułach.
- Etykiety sztuk i palet/końcówek z biura: rolka **100 × 150 mm** (profil `'100x150'` z `src/lib/zebraProfiles.ts`) — decyzja właściciela 27.11.
- Leżakowanie NIE blokuje i nie jest liczone jako warunek (właściciel 27.11: mięso z dnia D idzie zawsze dzień później). Tylko informacja: licznik „leży N h” od zważenia palety po masowaniu (`mixed_at`); podpowiedź bierze najpierw palety leżące najdłużej.
- Kebab z kilku rodzajów mięsa (komponenty z rodzaju produktu albo receptury, `_line_components`) MUSI działać w planie z blokadą palet (właściciel 27.11: „dużo robimy”).
- Kod QR sztuki: istniejące `finished_units.qr_code` (`U|…`); kod palety: `SP|<id>` (`seasoned_pallets_service.qr_of`).
- Numer kebaba na etykiecie: `ddmmrr <partia>` z daty planu (spec §3), np. `271126 PP7`.
- Liczba sztuk z palety = `floor(kg_weighed / kg_per_unit)`; reszta = przewidywana końcówka (informacyjnie).
- Komunikaty po polsku, z numerem palety/partii/pozycji (styl `HTTPException(409, "Paleta 41 …")`).
- Testy: `cd backend && TEST_DATABASE_URL=postgresql://postgres:p@localhost:55437/kebab_mes_test_palety python3 -m pytest tests/<plik> -q`; front: `npx tsc --noEmit` i `npx vitest run --pool=forks --poolOptions.forks.singleFork <ścieżki>`.
- Zrzuty 1920×1080 i 1366×768, jasny i ciemny, do akceptacji właściciela przed wydaniem (ZASADY_PROTRIMA §8).

## Review Focus

1. Biuro zmienia partię/palety pozycji po wydruku etykiet — sztuki z nową partią wracają na listę „do przedruku”, a stare etykiety są nazwane jako nieważne; nic nie zmienia się po cichu (dziś `generate_units_from_plan_line` po cichu przepisuje `batch_no`).
2. Panel palet jest nieaktualny (paleta w międzyczasie wyjechała lub jest zużyta) — zapis planu odbija się 409 z numerem palety, a nie zapisuje martwej palety.
3. Pozycja „z końcówek” na więcej kg, niż ważą końcówki — 400 z sumą kg i liczbą pełnych sztuk, zanim powstanie rezerwacja.
4. Drukarka pada w połowie serii — żadna sztuka z tej serii nie jest oznaczona jako wydrukowana; ponowny „Drukuj niewydrukowane” drukuje całą serię jeszcze raz.
5. Kebab mix 70/30, w którym kierownik wywiózł tylko paletę udka, a nie filetu — skan sztuki „355/356” odbija się z nazwą brakującej partii (plan A sprawdza tylko numer partii wprost, a „355/356” nie jest numerem żadnej palety).

Testy pinujące 1–5: zadania 3 (1), 1 (2), 2 (3), 6 (4), 2 (5). Ta sama paleta w dwóch planach — chip „w planie PROD/…” w panelu (zadania 3 i 7), zapis dozwolony (spec §9).

---

### Task 1: Palety przy pozycjach planu (serwer)

**Files:**
- Modify: `backend/app/models/production.py` (`PlanLineCreate`, `ProductionPlanCreate`)
- Modify: `backend/app/services/production_plans_service.py` (`create_plan`, `update_plan`, `get_plan`, `list_plans`)
- Modify: `backend/app/services/seasoned_pallets_service.py` (nowe `resolve_line_pallets`, `write_line_pallets`)
- Test: `backend/tests/test_plan_palety_zapis_db.py` (helpery z `tests/test_seasoned_pallets_wywoz_db.py`: `partia`, `paleta`)

**Interfaces:**
- Consumes: tabele `seasoned_pallets`, `plan_line_pallets`, kolumna `production_plans.pallet_gate` (plan A).
- Produces:
  - `PlanLineCreate.pallet_ids: List[str]` (alias `palletIds`, domyślnie `[]`), `PlanLineCreate.from_remainders: bool` (alias `fromRemainders`, domyślnie `False`), `ProductionPlanCreate.pallet_gate: bool` (alias `palletGate`, domyślnie `False`; przy `update_plan` ignorowane).
  - `seasoned_pallets_service.resolve_line_pallets(conn, line: PlanLineCreate) -> list[dict]` — wiersze palet `FOR UPDATE` w kolejności `pallet_ids`; ustawia `line.seasoned_batch_ids` = unikalne `seasoned_meat_id` w tej kolejności.
  - `seasoned_pallets_service.write_line_pallets(conn, plan_line_id: str, pallet_ids: list[str]) -> None` — `DELETE` + `INSERT` do `plan_line_pallets`.
  - Pozycje w `get_plan`/`list_plans` mają klucz `pallets: [pallet_out(...) + {"position": int}]`.

- [ ] **Step 1: Write the failing tests**
  - `test_plan_z_paletami_zapisuje_przypisanie_i_blokade`: dwie palety partii „724” (KIRMIZI, 600 i 598 kg), `create_plan(ProductionPlanCreate(planDate=…, palletGate=True, lines=[PlanLineCreate(qty=29, kgPerUnit=40, recipeId=KIRMIZI, palletIds=[p2, p1])]))`; asercje: `plan["pallet_gate"] is True`; `plan_line_pallets` ma obie palety; linia ma `seasoned_batch_ids`/`seasoned_batch_nos == ["724"]`; `get_plan(id)["lines"][0]["pallets"]` w kolejności `[p2, p1]`.
  - `test_paleta_innej_receptury_odbija_sie`: paleta receptury DONER przy pozycji KIRMIZI → `HTTPException` 400, treść zawiera `"Paleta "` i `"DONER"`.
  - `test_paleta_zuzyta_albo_na_hali_odbija_sie` (Review Focus 2): paleta `status='closed'` → 409 `"Paleta {nr} jest już zużyta"`; `status='on_hall'` → 409 zawiera `"wyjechała na halę"`; żaden plan nie powstał (`SELECT count(*) FROM production_plans` = 0).
  - `test_kebab_mix_z_paletami_obu_rodzajow`: rodzaj produktu z komponentami UDO 70 / FILET 30, palety: udo partii 355 (600 kg), filet partii 356 (300 kg), obie receptury KIRMIZI; pozycja `qty=20, kgPerUnit=40, palletIds=[udo, filet]`, `palletGate=True` → alokacja `{"355/356": {"pieces": 20, "parts": {"355": {"kg": 560.0}, "356": {"kg": 240.0}}}}`; `plan_line_pallets` ma obie palety.
  - `test_kebab_mix_bez_palety_jednego_rodzaju_odbija_sie`: ta sama pozycja tylko z paletą udka → 400 zawiera `"brak palety z mięsem"` i nazwę komponentu (`FILET`).
  - `test_plan_z_blokada_wymaga_palet_w_kazdej_pozycji`: `palletGate=True`, jedna pozycja bez `palletIds` → 400 zawiera `"wybierz palety"` i nazwę receptury.
  - `test_plan_bez_blokady_dziala_jak_dotad`: bez `palletIds`/`palletGate`, `seasonedBatchIds=[sm]` → plan powstaje, `pallet_gate` false, `plan_line_pallets` pusty.
  - `test_edycja_planu_podmienia_palety`: plan jak w pierwszym teście, `update_plan` z `palletIds=[p1]` → w `plan_line_pallets` tylko `p1`; pozycja z `qty_done>0` zachowuje swoje palety (pozycje zamrożone nietknięte, jak dziś).
- [ ] **Step 2: Run, expect FAIL** (`unexpected keyword argument palletIds` / brak `pallets`).
- [ ] **Step 3: Implement.** W `create_plan` i `update_plan` (edytowalne pozycje), PRZED `_lock_seasoned_batches`: dla pozycji z `pallet_ids` → `resolve_line_pallets` (walidacja: istnieje, `status='in_cold'` (inaczej komunikaty jak w `take_pallet`), `recipe_id` zgodne z pozycją — 400 `"Paleta {nr} (partia X) to {recipe_name palety}, a pozycja to {recipe_name pozycji}"`). Gdy `pallet_gate` i pozycja bez palet → 400 `"Pozycja {n} ({receptura}): wybierz palety — plan z kontrolą palet nie bierze mięsa bez palety"`. Pozycja komponentowa (`_line_components` niepuste) z paletami: `seasoned_batch_ids` z palet zawęża pule `_compute_component_allocation` (istniejąca ścieżka); przed alokacją każdy komponent musi mieć ≥1 paletę o `seasoned_meat.material_type_id` komponentu, inaczej 400 `"Pozycja {n} ({receptura}): brak palety z mięsem {materialName} — kebab {udziały, np. 70/30} potrzebuje palet każdego rodzaju"`. Po `_insert_line` → `write_line_pallets`. `pallet_gate` zapisać w `INSERT INTO production_plans`.
- [ ] **Step 4: Run, expect PASS**; regresja: `tests/test_production_plans*_db.py tests/test_seasoned_pallets_*_db.py`.
- [ ] **Step 5: Commit** `feat(plan-produkcji): palety przy pozycjach planu i blokada z PROTRIMA`

### Task 2: Pozycja „z końcówek” (PM), sztuki z kilku partii na hali i ich bilans (serwer)

**Files:**
- Modify: `backend/app/services/production_plans_service.py` (nowe `_remainders_allocation`; wywołanie w `create_plan`/`update_plan`)
- Modify: `backend/app/services/seasoned_pallets_service.py` (`assert_unit_batch_on_hall` i `settle_plan_balance`: sztuki z częściami — PM i mix)
- Modify: `backend/app/services/finished_goods_service.py:185` (bez podziału po równo dla planów z blokadą)
- Test: `backend/tests/test_plan_pm_koncowki_db.py`

**Interfaces:**
- Consumes: Task 1 (`resolve_line_pallets`), `MIXED_KEY`, `_assign_pm_numbers` (istniejące), `assert_unit_batch_on_hall` dla PM (plan A).
- Produces: `_remainders_allocation(line: PlanLineCreate, pallets: list[dict]) -> tuple[list[str], dict, str | None, str]` — ten sam kształt co `_compute_allocation`; dla ≥2 różnych partii: `{MIXED_KEY: {"pieces": qty, "kg": qty*kgpu, "parts": {batch_no: {"kg", "batch_id"}}}}`, kg części brane po kolei z palet do wyczerpania `kg_weighed`; dla jednej partii — zwykła alokacja jednej partii (bez PM).

- [ ] **Step 1: Write the failing tests**
  - `test_pozycja_z_koncowek_dostaje_pm_przy_aktywacji`: końcówki 724 (24 kg) i 731 (31 kg), pozycja `qty=1, kgPerUnit=40, fromRemainders=True, palletIds=[k724, k731]`, `palletGate=True`; po `create_plan`: alokacja ma `MIXED_KEY` z `parts == {"724": {"kg": 24.0,…}, "731": {"kg": 16.0,…}}`; po `update_plan_status(id, "active")` klucz alokacji pasuje do `^PM\d+$`; `generate_units_from_plan_line` daje sztukę z tym numerem.
  - `test_pozycja_z_koncowek_ponad_wage_odbija_sie` (Review Focus 3): końcówki 24 + 31 kg, `qty=2, kgPerUnit=40` → 400 zawiera `"55 kg"` i `"1 pełna sztuka"`.
  - `test_bilans_dzieli_sztuke_pm_na_partie`: plan jak w pierwszym teście, wywóz obu końcówek, skan sztuki (40 kg), zwrot 0 i 15 kg, `office_confirm`; `plan_batch_balance`: 724 → `kg_goods 24.0, kg_loss 0.0`; 731 → `kg_in 31.0, kg_goods 16.0, kg_returned 15.0, kg_loss 0.0`.
  - `test_sztuka_mix_wymaga_wywozu_palet_obu_partii` (Review Focus 5): plan z pozycją mix z Task 1, wywieziona tylko paleta 355 → skan sztuki `355/356` daje 409 zawierające `"356"`; po wywozie palety 356 skan przechodzi.
  - `test_bilans_dzieli_sztuke_mix_na_partie`: 20 sztuk mix zeskanowanych, zwroty 40 kg (udo) i 60 kg (filet), `office_confirm` → 355: `kg_goods 560.0, kg_loss 0.0`; 356: `kg_goods 240.0, kg_returned 60.0, kg_loss 0.0`.
  - `test_finish_day_bez_podzialu_po_rowno_w_planie_z_blokada`: linia planu z blokadą z pustą alokacją → `_consume_seasoned_for_entry` nie tworzy ruchów (log `finish_day.seasoned_consume.no_target`), plan bez blokady — po równo jak dziś.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** W `create_plan`/`update_plan`: pozycja z `from_remainders` → `_remainders_allocation` zamiast `_compute_allocation` (walidacja wagi: `qty*kgpu > Σ kg_weighed + SEASONED_SHORTFALL_TOL_KG` → 400 `"Końcówki ważą {suma} kg — to {n} pełna/pełne/pełnych sztuk(i) po {kgpu} kg"`; odmiana liczebnika jak w istniejących komunikatach, wystarczy 1/2–4/5+). `_apply_reservations` już obsługuje `parts`. W `assert_unit_batch_on_hall`: gdy wpis alokacji linii pod `unit.batch_no` ma `parts` (PM albo mix „355/356”) → każda partia z `parts` musi mieć paletę wywiezioną w tym planie (`taken_plan_id`, ta sama receptura); 409 `"Partia {nr sztuki} nie wyjechała cała na halę — brakuje palety partii {lista}"`; dotychczasowa gałąź PM (`batch.startswith("PM")`) zastąpiona tą regułą. W `settle_plan_balance`: sztuki, których wpis alokacji ma `parts`, wchodzą do `kg_goods` każdej partii części jako `weight_kg × part.kg / bucket.kg` (zamiast dopasowania `u.batch_no = partia`). W `_consume_seasoned_for_entry`: fallback po równo tylko, gdy plan nie ma `pallet_gate`.
- [ ] **Step 4: Run, expect PASS**; regresja `tests/test_mixed_piece_numbering.py tests/test_finish_day*_db.py tests/test_seasoned_pallets_bilans_db.py`.
- [ ] **Step 5: Commit** `feat(plan-produkcji): pozycja z końcówek jako PM i jej bilans`

### Task 3: Stan etykiet i dane do druku (serwer)

**Files:**
- Modify: `backend/app/migrations.py` (`finished_units.label_printed_at TIMESTAMPTZ NULL`, `seasoned_pallets.mixed_at TIMESTAMPTZ NULL`, `seasoned_pallets.kg_theory NUMERIC(10,3) NULL` + jednorazowe uzupełnienie z `mixing_charges`)
- Modify: `backend/app/services/finished_units_service.py` (`generate_units_from_plan_line`, nowe `units_for_plan`, `mark_labels_printed`)
- Modify: `backend/app/services/seasoned_pallets_service.py` (`create_from_charge`, `return_pallet`, `pallet_out`, lista, `mark_pallet_labels_printed`)
- Modify: `backend/app/routes/finished_units.py`, `backend/app/routes/seasoned_pallets.py`
- Test: `backend/tests/test_plan_etykiety_db.py`

**Interfaces:**
- Produces:
  - `GET /api/finished-units/for-plan?plan_id=` → `[{id, qrCode, qrSeq, planLineId, linePosition, batchNo, recipeName, productTypeName, packagingName, clientName, weightKg, producedDate, status, labelPrintedAt}]`, kolejność: pozycja planu, `qr_seq`.
  - `POST /api/finished-units/label-printed` `{ids: string[]}` → `{marked: int}` (tylko `status='planned'`).
  - `generate_units_from_plan_line` zwraca dodatkowo `reprint: string[]` (id sztuk, którym zmieniła się partia, a miały wydruk; ich `label_printed_at` → NULL) i dopasowuje liczbę sztuk do `qty`, gdy wszystkie są `planned` (dopisuje z kolejnym `qr_seq` / usuwa od najwyższego `qr_seq`; zwraca `added`, `removed`).
  - `POST /api/seasoned-pallets/label-printed` `{ids}` → `{marked}`.
  - `pallet_out` dodatkowo: `mixedAt`, `kgTheory`, `expiryDate` (z `seasoned_meat.expiry_date`), `materialTypeId`, `materialName` (z `seasoned_meat`), `parentPalletNo`, `planIds` (plany `draft`/`active` z `plan_line_pallets`).
  - `kg_teoria(charge: dict) -> float | None` = `kg_meat + water_l + Σ spices` (`unit` `kg`/`l` → `qty`, `g` → `qty/1000`, inne pomijane).

- [ ] **Step 1: Write the failing tests**
  - `test_sztuki_planu_w_kolejnosci_pozycji_i_palet`: plan z dwiema pozycjami, `generate…` dla obu, `GET for-plan` → `linePosition` rosnąco, w pozycji `qrSeq` 1..n, `labelPrintedAt is None`.
  - `test_oznaczenie_wydruku_tylko_dla_planned`: `label-printed` dla 3 sztuk (jedna `produced`) → `marked == 2`.
  - `test_zmiana_partii_po_wydruku_wraca_do_przedruku` (Review Focus 1): pozycja 10 szt. z palety partii 724, wydruk wszystkich, `update_plan` z paletą partii 725, ponowne `generate…` → `len(reprint) == 10`, wszystkie `batch_no == "725"`, `label_printed_at IS NULL`.
  - `test_zmiana_ilosci_przed_produkcja_dopisuje_i_usuwa_sztuki`: 10 → 12 → `added == 2`, `qr_seq` 11 i 12; 12 → 9 → `removed == 3`, zostają `qr_seq` 1..9.
  - `test_paleta_z_masownicy_ma_teorie_i_czas_masowania`: `finish_charge` dla wsadu `kg_meat=240, water_l=10, spices=[{qty: 6, unit: 'kg'}, {qty: 500, unit: 'g'}]` → paleta `kg_theory == 256.5`, `mixed_at == finished_at`; końcówka z `return_pallet` dziedziczy `mixed_at` po rodzicu, `kg_theory` NULL.
  - `test_lista_palet_pokazuje_plany_z_paleta` (Review Focus 5): paleta w pozycji planu `draft` → `planIds == [plan_id]`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (trasy cienkie, logika w serwisach; uzupełnienie `mixed_at`/`kg_theory` dla istniejących palet z `mixing_charges` po `charge_id`, reszta `mixed_at = created_at`).
- [ ] **Step 4: Run, expect PASS**; regresja `tests/test_finished_units*.py tests/test_seasoned_pallets_*_db.py tests/test_masownia_*_db.py`.
- [ ] **Step 5: Commit** `feat(plan-produkcji): stan etykiet sztuk i palet, teoria i czas masowania palety`

### Task 4: Lista planów ze stanem i bilans za zakres (serwer)

**Files:**
- Modify: `backend/app/services/production_plans_service.py` (`list_plans`: podsumowanie), `backend/app/services/seasoned_pallets_service.py` (`balance_range`)
- Modify: `backend/app/routes/production_plans.py` (`GET /balance-range` — PRZED `/{plan_id}`)
- Test: `backend/tests/test_plan_lista_bilans_db.py`

**Interfaces:**
- Produces:
  - Każdy plan z `list_plans` ma `summary: {units, labelsPrinted, pallets, palletsTaken, palletsReturned, balanceReady: bool}`.
  - `GET /api/production-plans/balance-range?from=YYYY-MM-DD&to=YYYY-MM-DD` → `{rows: [{planId, planNo, planDate, batchNo, recipeId, recipeName, kgTheory, kgIn, kgGoods, kgReturned, kgLoss, lossPct}], days: [{date, kgIn, kgLoss, lossPct}], recipes: [{recipeId, recipeName, kgIn, kgLoss, lossPct}]}`; `lossPct = round(kgLoss / kgIn * 100, 1)` (0 przy `kgIn = 0`); `kgTheory` = Σ `kg_theory` palet planu tej partii, które nie są końcówkami (NULL, gdy brak).
- [ ] **Step 1: Write the failing tests** — `test_lista_planow_ma_stan_etykiet_i_palet` (plan: 3 sztuki, 1 wydrukowana; 2 palety, 1 wywieziona → `units 3, labelsPrinted 1, pallets 2, palletsTaken 1`); `test_bilans_zakresu_sumuje_dni_i_receptury` (dwa plany w dwóch dniach z gotowym `plan_batch_balance` → `days` po dacie rosnąco, `recipes` zsumowane, `lossPct` 2.3 dla 14/598); `test_bilans_zakresu_zle_daty` (`from > to` → 400 `"Data od jest po dacie do"`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** (podsumowanie jednym zapytaniem grupującym po `plan_id`, nie N+1).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(plan-produkcji): stan planów i bilans strat za zakres dat`

### Task 5: Model i etykiety ZPL modułu (front, czyste funkcje)

**Files:**
- Modify: `src/lib/api.ts` (addytywnie: `CreatePlanLineDto.palletIds?`, `.fromRemainders?`, `CreateProductionPlanDto.palletGate?`; `finishedUnitsApi.forPlan(planId)`, `.markLabelsPrinted(ids)`; `seasonedPalletsApi.markLabelsPrinted(ids)`; `productionPlansApi.balanceRange(from, to)`; `mapPlan` → `summary`, linie → `pallets`; `generateFromPlanLine` typ zwrotu `+ reprint?, added?, removed?`)
- Create: `src/protrima/modules/plan-produkcji/model.ts`, `model.test.ts`
- Create: `src/protrima/modules/plan-produkcji/etykiety.ts`, `etykiety.test.ts`

**Interfaces:**
- Consumes: kształty z zadań 1–4.
- Produces (`model.ts`):
  - `type Paleta` (= `pallet_out` camelCase z Task 3), `type Pozycja { klucz, id?, qty, kgPerUnit, recipeId, productTypeId, packagingId?, klient?, zamowienie?, palety: string[], zKoncowek: boolean }`
  - `sztukZPalety(kg: number, kgSztuki: number): number`; `prognozaKoncowki(palety: Paleta[], qty: number, kgSztuki: number): number` (kg)
  - `lezyGodzin(p: Paleta, teraz: Date): number` (pełne godziny od `mixedAt`; tylko informacja)
  - `type Skladnik { materialTypeId: string; nazwa: string; pct: number }`; skład pozycji z `lineComponents` (`src/features/production-plan/planComponents.ts`) — `[]` = kebab z jednego mięsa.
  - `podpowiedzPalet(pozycja: Pozycja, sklad: Skladnik[], palety: Paleta[], zajete: Map<string, number>): string[]` — palety `in_cold` tej receptury; dla składu: osobno dla każdego składnika palety jego `materialTypeId`, na `qty × kgPerUnit × pct/100` kg; kolejność: końcówki, potem najdłużej leżące (`mixedAt` rosnąco), aż `Σ sztukZPalety ≥ qty`; `zajete` = kg już przypisane z palety w innych pozycjach tego planu.
  - `sumaKoncowek(palety: Paleta[]): { kg: number; sztuk: (kgSztuki: number) => number }`
  - `doDto(pozycje: Pozycja[], dzien: string): CreateProductionPlanDto` (`palletGate: true`)
  - `bledyPozycji(p: Pozycja, sklad: Skladnik[], palety: Map<string, Paleta>): string[]` (brak palet, za mało kg: „Palety dają 29 szt., a pozycja ma 30”, przy składzie liczone dla każdego składnika: „FILET: palety dają 12 szt., a pozycja ma 20”, brak palety składnika: „Brak palety z mięsem FILET”, paleta innej receptury, paleta nie w chłodni)
  - `stanPlanu(plan): 'szkic' | 'do-druku' | 'gotowy' | 'w-produkcji' | 'do-bilansu' | 'zamkniety'` z `status` + `summary`
- Produces (`etykiety.ts`):
  - `numerKebaba(dataPlanu: string, partia: string): string` (`'2026-11-27','PP7'` → `'271126 PP7'`)
  - `etykietaSztukiZpl(s: SztukaDoDruku, dpi = 203): string` — 100×150 mm (`^PW`/`^LL` z profilu `'100x150'`), `^BQN,2,mag^FDQA,<qrCode>^FS`, pola: numer kebaba (duży), receptura, rodzaj, tuleja, kg, data planu, klient, `nr/razem`; polskie znaki przez `^CI28`.
  - `etykietaPaletyZpl(p: Paleta, dpi = 203): string` — 100×150 mm, QR `p.qr`, „PALETA {nr}”, partia, receptura, kg, „KOŃCÓWKA z palety {parentPalletNo}” gdy `isRemainder`, data masowania.

- [ ] **Step 1: Write the failing tests** (`model.test.ts`, `etykiety.test.ts`):
  - `sztukZPalety(598, 40) === 14`; `prognozaKoncowki([598, 600 kg], 29, 40) === 38`.
  - `podpowiedzPalet`, jedno mięso: palety KIRMIZI: końcówka 120 kg (3 szt., mixedAt wczoraj 10:00), A 600 kg (przedwczoraj), B 600 kg (wczoraj 08:00), C 600 kg (dziś 20:00) → `qty=20, kg=40` → `[koncowka, A, B]`; z `zajete = {A: 600}` → `[koncowka, B, C]`.
  - `podpowiedzPalet`, mix UDO 70 / FILET 30, `qty=20, kg=40`: udo U1 600 kg, filet F1 200 kg (przedwczoraj), F2 300 kg (wczoraj) → `[U1, F1, F2]` (filet: 240 kg potrzeba, F1 daje 16 szt. udziału 12 kg → za mało, dochodzi F2).
  - `lezyGodzin({mixedAt: '2026-11-26T20:00:00+01:00'}, new Date('2026-11-27T22:30:00+01:00')) === 26`.
  - `bledyPozycji` z paletą DONER przy KIRMIZI zawiera `'Paleta 42 to DONER'`; 30 szt. z jednej palety 598 kg → `'Palety dają 14 szt., a pozycja ma 30'`; mix 70/30 tylko z paletą udka → `'Brak palety z mięsem FILET'`.
  - `doDto` → `palletGate === true`, `lines[0].palletIds` w kolejności wyboru, `fromRemainders` przeniesione.
  - `stanPlanu({status:'active', summary:{units:10, labelsPrinted:4,…}}) === 'do-druku'`; `{status:'done', summary:{balanceReady:false}}` → `'do-bilansu'`.
  - `numerKebaba('2026-11-27','PP7') === '271126 PP7'`; `etykietaSztukiZpl(...)` zawiera `'^FDQA,U|abc'`, `'^CI28'`, `'271126 724'`, `'40 kg'`, `'3/20'`; `etykietaPaletyZpl(koncowka)` zawiera `'^FDQA,SP|'` i `'KOŃCÓWKA z palety 41'`.
- [ ] **Step 2: Run, expect FAIL** (moduły nie istnieją).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(protrima): model planu produkcji z paletami i etykiety ZPL sztuk i palet`

### Task 6: Druk serii etykiet przez warstwę drukarki

**Files:**
- Modify: `src/protrima/drukarka/drukarka.ts`, `src/protrima/drukarka/drukarka.test.ts`

**Interfaces:**
- Produces: `export const ROLKA_ETYKIET: ZebraProfileId = '100x150'`; `drukujEtykiety(zpl: readonly string[], profil: ZebraProfileId, p?: Postep): Promise<void>` — `drukarka()`, `przygotuj(dev, profil)` (inna rolka niż ostatnio → drukarka sama kalibruje, jak przy zawieszkach), tryb `trybSerii()`; „ciągiem” = jedno zadanie. Nastawa stanowiska zawieszek (`przyjmijSkok`/`saveCalibration`) zmienia się tylko dla `ROLKA_ZAWIESZEK`. `drukujZawieszki` woła `drukujEtykiety(receptionTagsPrintJobs(...), ROLKA_ZAWIESZEK)` — zachowanie zawieszek bez zmian.
- [ ] **Step 1: Write the failing tests** (mock `@/lib/zebra` jak w istniejącym `drukarka.test.ts`): `drukujEtykiety(['A','B','C'], ROLKA_ETYKIET)` przy rolce 80×100 w pamięci → `calibrateZebra` z `'100x150'` i bez zmiany nastawy zawieszek; w trybie ciągiem → jedno `sendZplJobs` z `'A\nB\nC'`; w trybie pojedynczo → trzy zadania; błąd `sendZplJobs` → odrzucona obietnica (Review Focus 4: wołający nie oznacza wydruku). Istniejące testy zawieszek przechodzą bez zmian.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS** (`src/protrima/drukarka`).
- [ ] **Step 5: Commit** `refactor(protrima): wspólny druk serii etykiet w warstwie drukarki`

### Task 7: Moduł Plan produkcji — lista planów i edytor dnia z paletami

**Files:**
- Create: `src/protrima/modules/plan-produkcji/PlanProdukcjiModule.tsx` (lista dni/planów + edytor), `PanelPalet.tsx`, `PlanProdukcji.test.tsx`
- Modify: `src/protrima/App.tsx` (render `plan-produkcji`, skrót Ctrl+N jak w `plan-masowania`), `src/protrima/shell/modules.tsx` (`W_PROTRIMA` += `'plan-produkcji'`, `info` zgodne z tym, co moduł robi)

**Interfaces:**
- Consumes: `model.ts` (Task 5), `productionPlansApi` (`list`, `byId`, `create`, `update`, `remove`), `seasonedPalletsApi.list('in_cold')`, `clientOrdersApi` + `pullableLines` z `src/features/production-plan/pullFromOrders.ts` (import z odliczeniem zrobionego), `recipesApi`, `packagingApi`.
- Produces: komponent `PlanProdukcjiModule({ active, setCtx, setCmds })` (ten sam kontrakt co `PlanMasowaniaModule`). Układ jak Plan masowania: nawigacja dnia (← dziś →), lista planów z `stanPlanu` (chip), tabela pozycji z wpisywaniem z klawiatury (`qty`, `kg/szt`, receptura, rodzaj, tuleja, klient), zakładki boczne „Z zamówień” i „Palety w chłodni”. Panel palet: nr, partia, receptura, rodzaj mięsa (udo/filet…), kg ważone, termin, „leży N h” (sortowanie: końcówki, potem najdłużej leżące), końcówki z kg z wagi, chip „w planie PROD/…”; przy zaznaczonej pozycji mix panel filtruje po recepturze i grupuje po składnikach („UDO 70% — potrzeba 560 kg”, „FILET 30% — potrzeba 240 kg”). Klik w paletę dodaje/zdejmuje ją z zaznaczonej pozycji; „Podpowiedz palety” (`podpowiedzPalet`) dla pozycji bez palet; „Pozycja z końcówek” = zaznacz końcówki → nowa pozycja `zKoncowek` z liczbą pełnych sztuk. Przy pozycji: `N szt. z palet, końcówka ~X kg` (mix: osobno dla każdego składnika). Skład pozycji z rodzaju produktu/receptury przez `lineComponents`. Zapis = `create`/`update` z `doDto`; błąd serwera w `note crit` z treścią 409/400.
- [ ] **Step 1: Write the failing tests** (`PlanProdukcji.test.tsx`, jsdom, mock `@/lib/api`):
  - `pokazuje palety w chłodni z końcówką na górze i licznikiem leżenia` (testid `panel-palet`, tekst `'leży 26 h'`).
  - `pozycja mix grupuje palety po składnikach i podpowiada palety obu rodzajów` (`'UDO 70%'`, `'FILET 30%'`; „Podpowiedz palety” → `palletIds` z paletą udka i filetu).
  - `klik w paletę przypina ją do zaznaczonej pozycji i liczy sztuki` → tekst `'14 szt. z palet'`.
  - `zapis wysyła palletIds i palletGate` → `productionPlansApi.create` wywołane z `palletGate: true` i `lines[0].palletIds = ['p41']`.
  - `błąd 409 serwera pokazuje się z numerem palety` (`'Paleta 41 jest już zużyta'` w `role=alert`).
  - `pozycja z końcówek sumuje kg i liczy pełne sztuki` (24 + 31 kg, 40 kg/szt → `'55 kg → 1 szt.'`).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npx tsc --noEmit`; `npx vitest run … src/protrima`.
- [ ] **Step 5: Commit** `feat(protrima): Plan produkcji — lista planów i edytor dnia z paletami z chłodni`

### Task 8: Wyślij do produkcji, druk etykiet sztuk i końcówek

**Files:**
- Create: `src/protrima/modules/plan-produkcji/OknoEtykiet.tsx`, `KoncowkiDoOznaczenia.tsx`
- Modify: `PlanProdukcjiModule.tsx`, `PlanProdukcji.test.tsx`

**Interfaces:**
- Consumes: `drukujEtykiety` (Task 6), `etykietaSztukiZpl`/`etykietaPaletyZpl` (Task 5), `finishedUnitsApi.generateFromPlanLine/forPlan/markLabelsPrinted`, `seasonedPalletsApi.markLabelsPrinted`, `productionPlansApi.updateStatus`.
- Produces:
  - „Wyślij do produkcji” (plan `draft`, bez zmian niezapisanych): `updateStatus(id,'active')`, potem `generateFromPlanLine` dla każdej pozycji w kolejności `position`; otwiera `OknoEtykiet`.
  - `OknoEtykiet`: sztuki z `forPlan` pogrupowane po pozycji (i palecie/partii), licznik `wydrukowane / razem`, „Drukuj niewydrukowane” (cała seria jednym `drukujEtykiety(…, ROLKA_ETYKIET)`; po sukcesie `markLabelsPrinted(ids)`; po błędzie nic nie oznacza i pokazuje `opisBledu`), dodruk pojedynczej sztuki (wiersz → „Drukuj ponownie”), sekcja „Do przedruku po zmianie planu” (z `reprint` zwróconego przez `generateFromPlanLine` po zapisie wysłanego planu: komunikat `'Zmieniła się partia N sztuk — wyrzuć stare etykiety nr … i wydrukuj nowe'`).
  - Zapis planu `active`: po `update` → `generateFromPlanLine` dla każdej pozycji; jeśli którakolwiek zwróci `reprint`/`added` > 0, otwiera `OknoEtykiet` z sekcją przedruku.
  - `KoncowkiDoOznaczenia` (zakładka panelu palet): palety `in_cold` z `labelPrintedAt == null` (końcówki i palety z wdrożenia), „Drukuj etykiety” → `drukujEtykiety(etykietaPaletyZpl…, ROLKA_ETYKIET)` → `seasonedPalletsApi.markLabelsPrinted`.
- [ ] **Step 1: Write the failing tests:**
  - `wyślij do produkcji aktywuje plan i generuje sztuki pozycja po pozycji` (kolejność wywołań `generateFromPlanLine` = kolejność pozycji).
  - `drukuj niewydrukowane oznacza wydruk dopiero po sukcesie` i `błąd drukarki nie oznacza żadnej sztuki` (mock `drukujEtykiety` odrzuca → `markLabelsPrinted` nie wywołane, `role=alert` z opisem).
  - `zmiana partii po wydruku pokazuje sztuki do przedruku` (mock `generateFromPlanLine` → `{reprint: ['u1','u2']}` → tekst `'Zmieniła się partia 2 sztuk'`).
  - `końcówki bez etykiety drukują się i znikają z listy`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS**; `npx tsc --noEmit`.
- [ ] **Step 5: Commit** `feat(protrima): wysyłka planu do produkcji i druk etykiet sztuk oraz końcówek`

### Task 9: Karta produkcji dla kierownika

**Files:**
- Create: `src/protrima/modules/plan-produkcji/KartaProdukcji.tsx`
- Modify: `PlanProdukcjiModule.tsx`, `PlanProdukcji.test.tsx`

**Interfaces:**
- Consumes: `productionPlansApi.byId` (pozycje z `pallets`), `drukuj` z `@/lib/print` (rodzaj `'karta-produkcji'`), wzorzec `DrukPlanuDialog` z `plan-masowania/Okna.tsx` (Dialog + podgląd `doc-paper` + portal `print-sheet`).
- Produces: `KartaProdukcjiDialog({ planId, onClose })` — kartka A4: nagłówek (plan, data, firma z `settingsApi.getCompany`), dla każdej pozycji: receptura, rodzaj, tuleja, klient, `qty × kg`, palety w kolejności (`nr · partia · rodzaj mięsa · kg · ~szt.`; mix — pogrupowane po składnikach), przewidywana końcówka, pole „końcówka z wagi: ____ kg” przy każdej palecie.
- [ ] **Step 1: Write the failing test** `karta pokazuje palety pozycji w kolejności i miejsce na wagę końcówki` (teksty `'Paleta 41 · 724 · 598 kg · 14 szt.'`, `'końcówka z wagi'`).
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(protrima): karta produkcji z paletami dla kierownika`

### Task 10: Bilans planu i straty za zakres

**Files:**
- Create: `src/protrima/modules/plan-produkcji/Bilans.tsx`
- Modify: `PlanProdukcjiModule.tsx`, `PlanProdukcji.test.tsx`

**Interfaces:**
- Consumes: `productionPlansApi.balance(planId)`, `.settleBalance(planId)`, `.balanceRange(from, to)` (Task 4).
- Produces: przy planie `done` zakładka „Bilans”: tabela partii (receptura, partia, teoria z masowania, ważone, na wyroby, końcówka, strata kg, strata %), suma receptury i dnia; gdy brak bilansu (`balanceError` przy potwierdzeniu) — `note warn` z przyciskiem „Policz bilans” (`settleBalance`). Widok „Straty” (komenda modułu): zakres dat (domyślnie ostatnie 14 dni), tabela dni i receptur z `lossPct`, wiersz z największą stratą wyróżniony.
- [ ] **Step 1: Write the failing tests** `bilans planu pokazuje stratę partii w kg i procentach` (`'14 kg'`, `'2,3%'`); `brak bilansu daje przycisk Policz bilans i woła settleBalance`; `straty za zakres sumują receptury`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(protrima): bilans planu i straty mięsa za zakres dat`

### Task 11: Stary edytor MES tylko do podglądu, wersja PROTRIMA

**Files:**
- Modify: `src/pages/office/ProductionPlanningPage.tsx` (przycisk „Nowy plan” → wyłączony z opisem), `src/pages/office/ProductionPlanEditorPage.tsx` (trasa `/nowy` → komunikat zamiast edytora; edycja planu z `pallet_gate` → tylko podgląd)
- Modify: `src-tauri/tauri.protrima.conf.json` (`version` → `0.16.0`)
- Test: istniejący test strony planowania (lub nowy `src/pages/office/productionPlanningReadonly.test.tsx`)

**Interfaces:**
- Produces: w starym MES „Nowy plan” wyłączony, `title`/opis: `'Plany produkcji układa się teraz w PROTRIMA (Plan produkcji)'`; plan z `palletGate` otwiera się bez zapisu, z tym samym komunikatem. Plany bez blokady (stare) — edycja jak dotąd, żeby nie zatrzymać dni już rozpisanych.
- [ ] **Step 1: Write the failing tests** `nowy plan jest wyłączony z odesłaniem do PROTRIMA`; `plan z blokadą palet otwiera się tylko do podglądu`.
- [ ] **Step 2: Run, expect FAIL.** **Step 3: Implement.** **Step 4: Run, expect PASS**; pełne `npx vitest run --pool=forks --poolOptions.forks.singleFork` i `npx tsc --noEmit`, pełny pytest backendu (dwa znane czerwone z bazy: `test_production_rates_db::test_jedna_probka…`, `test_take_settlement_db::test_complete_flow_preserves_real_weights…`).
- [ ] **Step 5: Commit** `feat(plan-produkcji): stary edytor tylko do podglądu; PROTRIMA 0.16.0`

---

**Poza tym planem (świadomie):**
- Rezerwacja niezwalniana po „Dodaj wyrób” (spec §8) dotyczy ręcznego zapisu wyrobu (`/finished-goods/bulk`), nie przepływu z planu: `finish_day` zwalnia rezerwacje planu (`release_plan_reservations`). Osobna poprawka.
- Zwrot z tabletu palet z wczorajszego planu, N+1 w `list_charges_today`, importy w środku modułu — drobiazgi z planu A.
- Śledzenie wstecz/w przód (projekt 3) i edytor etykiet (projekt 4).
