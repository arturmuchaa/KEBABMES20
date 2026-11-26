# Palety mięsa przyprawionego, skan z blokadą i bilans — plan A

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Każda paleta po masowaniu jest bytem z kodem QR. Kierownik skanuje ją przy wywozie na halę i system puszcza tylko palety z dzisiejszego planu. Sztuka z partii, której paleta nie wyjechała, nie wchodzi na magazyn. Końcówka wraca zważona, a strata liczy się przy potwierdzeniu planu przez biuro.

**Architecture:** Nowa tabela `seasoned_pallets` (paleta i końcówka) oraz `plan_line_pallets` (jawne przypisanie palet do pozycji; zapisuje je dopiero plan B, plan A ma tylko odczyt z fallbackiem na partię). Logika w nowym `services/seasoned_pallets_service.py`, trasy w `routes/seasoned_pallets.py`. Blokada działa tylko w planach z `production_plans.pallet_gate = true`, więc stare plany i stary MES działają bez zmian, dopóki gate jest wyłączony.

**Tech Stack:** FastAPI + psycopg2 (`app.db`), pytest (testy `_db` na `TEST_DATABASE_URL`), React + Vitest (tablety), ZPL (Zebra).

**Spec:** `kebab_fixed/docs/superpowers/specs/2026-11-26-plan-produkcji-partie-design.md` (§4, §6.1, §6.2, §6.4, §6.5). Plan B (PROTRIMA: §6.3, §6.6, druk etykiet sztuk, **druk etykiet końcówek i palet z backfillu**, zapis `plan_line_pallets`, naprawa niezwalnianej rezerwacji) to osobny plan.

## Global Constraints

- Migracje wyłącznie addytywne w `backend/app/migrations.py` (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).
- Kod QR palety: `SP|<id palety>` (id = `cuid()`, 20+ znaków).
- Numer palety: ciąg `seasoned_pallet_seq` (ten sam co `mixing_charges.out_pallet_no`; paleta z masownicy dostaje `out_pallet_no`, końcówka i backfill — `next_seq("seasoned_pallet_seq")`).
- Statusy palety: `in_cold` (chłodnia), `on_hall` (wywieziona), `closed` (zużyta/zastąpiona końcówką).
- Komunikaty po polsku, konkretne, z numerem palety/partii (styl istniejących `HTTPException(409, …)`).
- Data „dziś” planu = `plan_date` porównywane z datą lokalną `Europe/Warsaw` (`datetime.now(ZoneInfo("Europe/Warsaw")).date().isoformat()`).
- Nic z hali nie wpisuje się z ręki poza kg końcówki (anty-cel spec §7).
- Testy DB: `TEST_DATABASE_URL=postgresql://postgres:…@localhost:55437/kebab_mes_test_… python3 -m pytest tests/test_seasoned_pallets_*_db.py` (instrukcja budowy bazy w `tests/conftest.py`); dopisać nowe tabele do `_TRUNCATE` w `tests/conftest.py`.

## Review Focus

1. Dwa skany tej samej palety naraz (dwa tablety) — tylko jeden przechodzi (UPDATE … WHERE status='in_cold' RETURNING jako bramka, jak `finish_charge`).
2. Partia z kilkoma paletami (ta sama surowa partia w dwóch masownicach → ten sam `batch_no`) — gate po partii przepuszcza każdą z nich; bilans liczy partię jako całość.
3. Plan bez `pallet_gate` — skan sztuk i office-confirm działają dokładnie jak dziś (regresja = zatrzymana hala).
4. Zwrot końcówki z kg większym niż paleta miała — odrzucony („więcej niż wyjechało”).
5. Office-confirm, gdy końcówka po bilansie < rezerwacje innych planów na tę partię — czytelny 409 zamiast wyjątku z `_reconcile_row`.

Testy pinujące 1–5 są w zadaniach 3, 4, 5 i 6.

---

### Task 1: Tabele palet + paleta przy odbiorze z masownicy

**Files:**
- Modify: `backend/app/migrations.py` (dopisać na końcu listy migracji)
- Create: `backend/app/services/seasoned_pallets_service.py`
- Modify: `backend/app/services/masownia_service.py:618-720` (`finish_charge`)
- Modify: `backend/tests/conftest.py` (`_TRUNCATE` += `plan_line_pallets`, `seasoned_pallets`)
- Test: `backend/tests/test_seasoned_pallets_masownia_db.py`

**Interfaces:**
- Produces:
  - tabela `seasoned_pallets(id TEXT PK, pallet_no INTEGER NOT NULL, charge_id TEXT NULL, seasoned_meat_id TEXT NULL, batch_no TEXT NOT NULL, recipe_id TEXT DEFAULT '', recipe_name TEXT DEFAULT '', kg_weighed NUMERIC(10,3) NOT NULL, status TEXT NOT NULL DEFAULT 'in_cold', parent_id TEXT NULL, is_remainder BOOLEAN NOT NULL DEFAULT false, label_printed_at TIMESTAMPTZ NULL, taken_at TIMESTAMPTZ NULL, taken_by TEXT DEFAULT '', taken_plan_id TEXT NULL, returned_at TIMESTAMPTZ NULL, kg_returned NUMERIC(10,3) NULL, created_at TIMESTAMPTZ DEFAULT now())` + indeksy na `status`, `batch_no`, `taken_plan_id`
  - tabela `plan_line_pallets(plan_line_id TEXT NOT NULL, pallet_id TEXT NOT NULL, PRIMARY KEY(plan_line_id, pallet_id))`
  - `ALTER TABLE production_plans ADD COLUMN IF NOT EXISTS pallet_gate BOOLEAN NOT NULL DEFAULT false`
  - tabela `plan_batch_balance(plan_id TEXT, batch_no TEXT, kg_in NUMERIC(10,3), kg_goods NUMERIC(10,3), kg_returned NUMERIC(10,3), kg_loss NUMERIC(10,3), created_at TIMESTAMPTZ DEFAULT now(), PRIMARY KEY(plan_id, batch_no))`
  - `seasoned_pallets_service.create_from_charge(conn, charge: dict, kg_output: float) -> dict` — zwraca wiersz palety
  - `seasoned_pallets_service.qr_of(pallet_id: str) -> str` → `"SP|" + pallet_id`
  - `finish_charge(...)` zwraca dodatkowo `pallet_id`, `pallet_qr`

- [ ] **Step 1: Write the failing test** `test_odbior_tworzy_palete_z_waga_z_paleciaka`: załaduj wsad 600 kg z partii „511” (helpery `_zlecenie`/`_partia` jak w `test_masownia_wsady_db.py`), `start_charge`, `finish_charge(id, ChargeFinish(kgOutput=598))`; asercje: `out["pallet_qr"] == "SP|" + out["pallet_id"]`; wiersz `seasoned_pallets`: `kg_weighed == 598.0`, `batch_no == "511"`, `status == "in_cold"`, `pallet_no == out["out_pallet_no"]`, `charge_id == charge id`, `seasoned_meat_id` = id wiersza `seasoned_meat` o `batch_no='511'`.
- [ ] **Step 2: Run, expect FAIL** (`relation "seasoned_pallets" does not exist`).
- [ ] **Step 3: Migracje + `create_from_charge`** — `seasoned_meat_id` szukać `SELECT id FROM seasoned_meat WHERE batch_no=%s AND recipe_id=%s ORDER BY created_at DESC LIMIT 1`; wywołać w `finish_charge` po zapisie `kg_output` (osobna transakcja; błąd tu loguje `masownia.pallet_create_failed` i NIE cofa odbioru — paleta dostanie się przez backfill z zadania 2).
- [ ] **Step 4: Run, expect PASS**; uruchom też `tests/test_masownia_*_db.py` (regresja).
- [ ] **Step 5: Commit** `feat(palety): paleta mięsa przyprawionego przy odbiorze z masownicy`

### Task 2: QR na etykiecie palety + rozpoznawanie `SP|` + backfill chłodni

**Files:**
- Modify: `src/features/masownia/mixingLabelZpl.ts` (nowe pole wejścia `palletQr?: string`)
- Modify: `src/pages/tablet/MasowanieHmiPage.tsx:320-340` (przekazać `palletQr`)
- Modify: `backend/app/services/masownia_service.py` (`list_charges_today` dokłada `pallet_id`, `pallet_qr` z `seasoned_pallets` po `charge_id`)
- Modify: `src/features/scan/skanKodu.ts` (+ `idPaletyMiesa(wartosc: string): string | null`, uwzględnić w `czyKompletnyKod`)
- Modify: `backend/app/migrations.py` (backfill)
- Test: `src/features/masownia/mixingLabelZpl.test.ts`, `src/features/scan/skanKodu.test.ts`, `backend/tests/test_seasoned_pallets_masownia_db.py`

**Interfaces:**
- Produces: `idPaletyMiesa("SP|abc…") → "abc…"`, `null` dla innych; `mixingLabelZpl({...palletQr})` zawiera `^BQN,2,…^FDQA,SP|<id>^FS` (gdy brak `palletQr` — etykieta bez zmian).
- Backfill (idempotentny, `WHERE NOT EXISTS`): dla każdego `seasoned_meat` z `kg_available > 0 AND status <> 'closed'` bez żadnej palety `in_cold` — jedna paleta `kg_weighed = kg_available`, `charge_id NULL`, `pallet_no = next seq` (w SQL: `UPDATE id_sequences … RETURNING` tak jak robi `next_seq`; sprawdź nazwę tabeli w `app/utils/ids.py`).

- [ ] **Step 1: Failing tests:** `mixingLabelZpl` z `palletQr: 'SP|x1'` → `zpl` zawiera `'SP|x1'` i `'^BQ'`; bez `palletQr` → nie zawiera `'^BQ'`. `idPaletyMiesa('SP|ckabc123def456ghi789')` → `'ckabc123def456ghi789'`; `idPaletyMiesa('PAL|z|1')` → `null`; `czyKompletnyKod('SP|ckabc123def456ghi789')` → `true`. DB: `test_backfill_zaklada_palete_dla_zywej_partii` (wstaw `seasoned_meat` 120 kg, uruchom `run_migrations()`, jest 1 paleta 120 kg; drugie `run_migrations()` nie dubluje).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** QR w prawym górnym rogu etykiety; nie przesuwać istniejących pól (zrzut przed/po do akceptacji w zadaniu 7).
- [ ] **Step 4: Run** `npx vitest run src/features/masownia src/features/scan` i test DB — PASS.
- [ ] **Step 5: Commit** `feat(palety): kod QR na etykiecie palety i stan chłodni`

### Task 3: Wywóz palety na halę — skan z blokadą

**Files:**
- Modify: `backend/app/services/seasoned_pallets_service.py`
- Create: `backend/app/routes/seasoned_pallets.py` (prefix `/api/seasoned-pallets`), zarejestrować w `backend/app/main.py` (lista `include_router`)
- Create: `backend/app/models/seasoned_pallets.py` (`TakeDto{code: str, workerName: str = ''}`, `ReturnDto{kg: float >= 0}`)
- Test: `backend/tests/test_seasoned_pallets_wywoz_db.py`

**Interfaces:**
- Produces:
  - `take_pallet(code: str, worker_name: str = "") -> dict` → `{"ok": True, "palletId", "palletNo", "batchNo", "planId", "planNo", "lines": [{"lineId", "label"}]}`; `label` = `f"{qty} × {kg_per_unit} kg {recipe_name}"` (kg bez zbędnych zer)
  - `pallet_belongs_to_line(conn, pallet: dict, line: dict) -> bool` — jeśli linia ma wpisy w `plan_line_pallets` → tylko te palety; inaczej `pallet.seasoned_meat_id ∈ line.seasoned_batch_ids` lub `pallet.batch_no ∈ keys(line.batch_allocation)` lub `== line.seasoned_batch_id`
  - `POST /api/seasoned-pallets/take` (TakeDto), `GET /api/seasoned-pallets?status=` (lista)
- Reguły (kolejność sprawdzeń i komunikaty dokładnie):
  1. kod nie `SP|` / brak palety → 404 `"Nie znam tej palety"`
  2. `closed` → 409 `"Paleta {nr} jest już zużyta"`
  3. `on_hall` → 409 `"Paleta {nr} już wyjechała na halę ({HH:MM})"`
  4. brak planu `status='active' AND pallet_gate AND plan_date=dziś` z pasującą linią → 409 `"Paleta {nr} (partia {batch}) nie jest w planie na dziś — zmiana tylko przez biuro"`
  5. OK → `UPDATE … SET status='on_hall', taken_at=now(), taken_by=%s, taken_plan_id=%s WHERE id=%s AND status='in_cold' RETURNING *`; pusty wynik → 409 jak w 3.

- [ ] **Step 1: Failing tests** (fixture: plan aktywny na dziś z `pallet_gate=true`, linia 20 × 40 KIRMIZI z `seasoned_batch_ids=[sm_724]`): `test_paleta_z_planu_wyjezdza` (status `on_hall`, `lines[0].label == "20 × 40 kg KIRMIZI"`); `test_paleta_spoza_planu_blokada` (409, „nie jest w planie na dziś”); `test_plan_na_jutro_blokuje`; `test_plan_bez_gate_blokuje` (gate wyłączony = brak planu z blokadą → 409); `test_drugi_skan_tej_samej_palety` (409 „już wyjechała”); `test_dwie_palety_tej_samej_partii_obie_wyjezdzaja`; `test_jawne_przypisanie_wygrywa` (linia ma `plan_line_pallets` = paleta A → paleta B tej samej partii 409); `test_rownolegly_skan_przechodzi_raz` (dwa wątki `take_pallet` na tej samej palecie → dokładnie jeden OK).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** `take_pallet`, `pallet_belongs_to_line`, trasy.
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(palety): wywóz palety na halę ze sprawdzeniem planu`

### Task 4: Sztuka tylko z wywiezionej partii

**Files:**
- Modify: `backend/app/services/finished_units_service.py:387-440` (`scan_produced`)
- Test: `backend/tests/test_seasoned_pallets_sztuki_db.py`

**Interfaces:**
- Consumes: `seasoned_pallets` (zadanie 1), `take_pallet` (zadanie 3)
- Produces: `assert_unit_batch_on_hall(conn, unit: dict, plan_id: str) -> None` w `seasoned_pallets_service` — 409 `"Partia {batch} nie wyjechała na halę — najpierw zeskanuj jej paletę"`; dla `PM…`: wszystkie palety z `plan_line_pallets` linii sztuki muszą mieć `taken_plan_id = plan_id`.

- [ ] **Step 1: Failing tests:** plan z gate, sztuki wygenerowane `generate_units_from_plan_line`: `test_sztuka_przed_wywozem_odbija` (409, sztuka dalej `planned`); `test_sztuka_po_wywozie_wchodzi`; `test_plan_bez_gate_bez_zmian` (plan `pallet_gate=false`, brak palet → skan OK jak dziś); `test_sztuka_pm_wymaga_wszystkich_koncowek` (linia PM z dwiema paletami w `plan_line_pallets`, wywieziona jedna → 409, obie → OK).
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement** — wołać po ustaleniu planu sztuki, przed zmianą statusu, tylko gdy `pallet_gate`.
- [ ] **Step 4: Run** + `tests/test_finished_units.py tests/test_scan_expected_plan.py` — PASS.
- [ ] **Step 5: Commit** `feat(palety): sztuka wchodzi tylko z partii wywiezionej na halę`

### Task 5: Zwrot końcówki

**Files:**
- Modify: `backend/app/services/seasoned_pallets_service.py`, `backend/app/routes/seasoned_pallets.py`
- Test: `backend/tests/test_seasoned_pallets_zwrot_db.py`

**Interfaces:**
- Produces: `return_pallet(code_or_id: str, kg: float) -> dict` → `{"ok", "palletNo", "closed": True, "remainder": None | {"id", "palletNo", "qr", "kg"}}`; `POST /api/seasoned-pallets/return` `{code, kg}`.
- Reguły: tylko `on_hall` (inaczej 409 `"Paleta {nr} nie jest na hali"`); `kg > kg_weighed` → 409 `"Końcówka {kg} kg to więcej niż wyjechało ({kg_weighed} kg)"`; zawsze: oryginał `status='closed', returned_at=now(), kg_returned=kg`; `kg > 0` → nowa paleta `in_cold`, `is_remainder=true`, `parent_id`, ta sama partia/receptura/`seasoned_meat_id`, `kg_weighed=kg`, `pallet_no=next_seq`, `label_printed_at NULL`.

- [ ] **Step 1: Failing tests:** `test_zwrot_24kg_tworzy_koncowke`; `test_zwrot_zero_zamyka_bez_koncowki`; `test_zwrot_wiecej_niz_wyjechalo_odrzucony`; `test_zwrot_palety_z_chlodni_odrzucony`; `test_koncowke_mozna_znow_wywiezc` (końcówka w planie następnego dnia → `take_pallet` OK).
- [ ] **Step 2: Run, expect FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(palety): zwrot zważonej końcówki do chłodni`

### Task 6: Biuro potwierdza dopiero po zwrotach + bilans partii

**Files:**
- Modify: `backend/app/services/production_plans_service.py:1528-1589` (`office_confirm`)
- Modify: `backend/app/services/seasoned_pallets_service.py` (+ `settle_plan_balance`)
- Modify: `backend/app/routes/production_plans.py` (+ `GET /{plan_id}/balance`, `PATCH /{plan_id}/pallet-gate` `{enabled: bool}` — tylko gdy plan `draft`)
- Test: `backend/tests/test_seasoned_pallets_bilans_db.py`

**Interfaces:**
- Consumes: `_reconcile_row(conn, row, target_kg, reason, close)` z `seasoned_meat_service`.
- Produces: `settle_plan_balance(conn, plan_id: str, plan_no: str) -> list[dict]` — dla każdej partii palet z `taken_plan_id=plan_id`: `kg_in` = Σ `kg_weighed` tych palet; `kg_returned` = Σ `kg_returned`; `kg_goods` = Σ `weight_kg` sztuk planu (`finished_units.status <> 'planned'`) o tym `batch_no`; `kg_loss = kg_in − kg_goods − kg_returned` (zaokr. 3); upsert do `plan_batch_balance`; potem `_reconcile_row(row seasoned_meat FOR UPDATE, target = Σ kg_weighed palet tej partii w statusie in_cold, reason=f"Bilans planu {plan_no}", close=target==0)`.
- `office_confirm`: gdy `pallet_gate` i istnieje paleta `taken_plan_id=plan_id AND status='on_hall'` → 409 `"Paleta {nr} nie ma zwrotu końcówki — zważ ją albo wpisz 0"` (przed `finish_day`). Po `finish_day` → `settle_plan_balance` w transakcji; błąd rezerwacji z `_reconcile_row` → 409 `"Partia {batch}: po bilansie zostaje {kg} kg, a inne plany mają zarezerwowane {rez} kg — popraw tamte plany"`.
- `GET /{plan_id}/balance` → lista wierszy `plan_batch_balance` (camelCase).

- [ ] **Step 1: Failing tests** (liczby ze spec §4.5 / rozmowy): paleta 724 `kg_weighed 598`, wywieziona, 14 sztuk × 40 kg zeskanowanych, zwrot 24 → `office_confirm` → wiersz bilansu `kg_in 598, kg_goods 560, kg_returned 24, kg_loss 14`; `seasoned_meat.kg_available == 24` (końcówka); ruch `stock_movements` source `reconcile`. Dalej: `test_brak_zwrotu_blokuje_potwierdzenie` (409, plan dalej nie `done`); `test_plan_bez_gate_potwierdza_jak_dzis`; `test_zwrot_zero_zamyka_partie` (`status closed`); `test_rezerwacja_innego_planu_czytelny_blad`.
- [ ] **Step 2: Run, expect FAIL.** - [ ] **Step 3: Implement.** - [ ] **Step 4: Run** + `tests/test_seasoned_reconcile_db.py tests/test_plan_*` — PASS.
- [ ] **Step 5: Commit** `feat(palety): bilans partii przy potwierdzeniu planu`

### Task 7: Tablet produkcji — wywóz i zwrot palety

**Files:**
- Modify: `src/lib/api.ts` (+ `seasonedPalletsApi = { take(code, workerName?), return(code, kg), list(status?) }`, `productionPlansApi.balance(id)`, `productionPlansApi.setPalletGate(id, enabled)`)
- Create: `src/features/production-hmi/components/WywozPalety.tsx` (wynik skanu `SP|`: zielony „Paleta 724 → 20 × 40 kg KIRMIZI” / czerwony z komunikatem serwera, dźwięk `beepOk`/`beepErr`)
- Create: `src/features/production-hmi/components/ZwrotKoncowki.tsx` (lista palet `on_hall` tego planu, duże pole kg z klawiaturą numeryczną, przycisk „Zużyta do zera”)
- Modify: `src/pages/tablet/ProductionHmiPage.tsx` (skaner: `idPaletyMiesa(kod)` → `take` zamiast skanu sztuki; przycisk „Zwrot końcówki” widoczny, gdy plan ma `palletGate`)
- Test: `src/features/production-hmi/components/wywozPalety.test.tsx`, `zwrotKoncowki.test.tsx`

**Interfaces:**
- Consumes: trasy z zadań 3, 5; `idPaletyMiesa` z zadania 2.

- [ ] **Step 1: Failing tests:** skan `SP|…` woła `seasonedPalletsApi.take` (nie `scanProduced`) i pokazuje etykietę pozycji; odpowiedź 409 → komunikat serwera widoczny i trwały (jak lista błędów `ScanPanel`); `ZwrotKoncowki`: wpis „24” + Zatwierdź → `return(code, 24)`; „Zużyta do zera” → `return(code, 0)`; kg > `kgWeighed` → przycisk nieaktywny z podpowiedzią.
- [ ] **Step 2: Run, expect FAIL.** - [ ] **Step 3: Implement** (style tabletu jak `ScanPanel`/`MovePiecesModal`). - [ ] **Step 4: Run** `npx vitest run src/features/production-hmi src/pages/tablet` — PASS.
- [ ] **Step 5: Zrzuty do akceptacji** (tablet produkcji: wywóz OK, blokada, zwrot; etykieta palety przed/po z zadania 2) na lokalnym stosie; opublikować jako artefakt, czekać na akceptację właściciela przed wydaniem.
- [ ] **Step 6: Commit** `feat(palety): wywóz i zwrot palety na tablecie produkcji`

### Task 8: Weryfikacja całości

- [ ] **Step 1:** `cd backend && TEST_DATABASE_URL=… python3 -m pytest -q` (pełny zestaw; znany niezależny błąd: `test_production_rates_db::test_jedna_probka…` — porównać z wynikiem na `1c8f429f`).
- [ ] **Step 2:** `npx vitest run` i `npx tsc --noEmit` w `kebab_fixed`.
- [ ] **Step 3:** Przejście ręczne na lokalnym stosie: masownia odbiór → etykieta z QR → plan z gate (PATCH pallet-gate) → aktywacja → skan palety z planu (OK) i spoza (blokada) → sztuki → zwrot 24 kg → office-confirm → `GET /balance`.
- [ ] **Step 4:** Wydanie NIE w tym planie — po akceptacji zrzutów, razem z planem B albo osobno (decyzja właściciela); deploy wg pamięci `deploy-sh-gotchas`.
