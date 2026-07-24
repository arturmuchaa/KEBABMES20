# Zamknięcie dnia produkcji — realna pozostałość przyprawionego (ścinki/straty)

Data: 2026-07-23

## Problem

Na finalnym etapie produkcji (formowanie kebaba, `finish_day` /
`finished_goods_service`) zużycie mięsa przyprawionego liczone jest **czysto
teoretycznie**: `qty * kg_per_unit` z receptury. Pracownicy przy formowaniu
obcinają kebab, żeby wyrównać kształt, biorąc przy tym więcej całego mięsa niż
zakłada receptura — powstałe ścinki wracają do kolejnego kebaba, ale nikt ich
nie waży (produkcja ~10 t/dzień). System nigdy nie widzi tej różnicy: nie ma
punktu pomiaru rzeczywistości na tym etapie — `finished_units.weight_kg` to
zawsze wartość teoretyczna z receptury, nigdy odczyt wagi. Efekt: żywy stan
`seasoned_meat.kg_available` rozjeżdża się cicho z rzeczywistością, a biuro
codziennie odkrywa brak mięsa dopiero przy planowaniu kolejnego miksu.

Zakład ma już dokładnie ten mechanizm dla wcześniejszego etapu (przyprawianie):
`seasoned_meat_service.reconcile_seasoned_batch()` — ręczna korekta
teoria↔fizyka per partia, z tolerancją, powodem i pełnym audytem (ruch
magazynowy `source_type='reconcile'`). Ten spec rozszerza ten sam,
sprawdzony mechanizm na poziom **grupy (receptura + dzień produkcji)**,
zamiast wymyślać nowy.

## Zakres (decyzje użytkownika, 2026-07-23)

1. Wpis jest **zbiorczy, raz dziennie per receptura** — nie per partia i nie
   per sztuka. Przy 10 t/dziennie nikt nie ma czasu ważyć ścinków sztuka po
   sztuce.
2. Wpisana wartość **koryguje żywy stan** `seasoned_meat.kg_available` (żeby
   kolejne planowanie miksu widziało prawdziwe dostępne mięso), a nie tylko
   loguje raport.
3. Nowa zakładka **na istniejącej stronie `SeasonedMeatPage.tsx`** ("Przyprawione"),
   nie osobna strona w menu.
4. Żadnej nowej tabeli audytowej ani nowego mechanizmu korekty — reużycie
   `reconcile_seasoned_batch` / ruchów magazynowych jako jedynego źródła
   audytu.
5. Poza zakresem v1 (świadomie, YAGNI): automatyczny współczynnik
   strat/predykcja zużycia, ważenie per-partia ścinków, wykres trendu w
   czasie (historia tekstowa wystarczy na start — wykres to prosty fast-follow,
   gdy dane się zbiorą).

## Architektura

### Backend — `app/services/seasoned_meat_service.py`

**Refaktor:** wydzielić z `reconcile_seasoned_batch` wspólny rdzeń
`_reconcile_row(conn, row, target_kg, reason) -> delta`, który robi dokładnie
to, co dziś cała funkcja robi na jednej partii (walidacja rezerwacji, update
`kg_available`/`kg_produced`/`status`/`reconciled_at`/`reconcile_reason`, ruch
magazynowy IN/OUT). `reconcile_seasoned_batch` staje się cienkim wrapperem nad
`_reconcile_row` dla pojedynczego id — zachowanie i kontrakt API bez zmian.

**Nowa funkcja `reconcile_production_day(recipe_id, production_day, actual_kg, reason)`:**

1. `SELECT ... FOR UPDATE` wszystkich `seasoned_meat` z `recipe_id` i
   `production_day` zadanym, `status != 'closed'`, sortowane FEFO
   (`expiry_date ASC, created_at ASC`).
2. `theoretical = suma kg_available` tych wierszy.
3. `reserved_total = suma kg_reserved` — jeśli `actual_kg < reserved_total`:
   `400` z tym samym komunikatem co dziś (partie zarezerwowane pod plan).
4. `delta = round(actual_kg - theoretical, 3)`. Jeśli `abs(delta) < 0.001`:
   `400 "Brak zmiany — podaj inną wartość"` (spójne z dzisiejszym zachowaniem
   pojedynczej korekty).
5. **Dystrybucja delty po wierszach** (pętla FEFO): dla każdego wiersza po
   kolei licz, ile delty może wchłonąć bez zejścia poniżej jego własnej
   `kg_reserved`; zastosuj `_reconcile_row` na tę część, przejdź do
   następnego wiersza z resztą. W typowym przypadku (jeden wiersz w grupie)
   to jedna operacja na jednej partii — identyczna z dzisiejszą.
6. **Brak żywych wierszy w grupie:**
   - `actual_kg > 0` → utwórz nową partię `seasoned_meat` z numerem `SC{n}`
     (nowa funkcja w `app/utils/batch_numbers.py`, ten sam wzorzec co
     `combined_batch_no`/`PP{n}`), `recipe_id`, `production_day`,
     `kg_produced = kg_available = actual_kg`, `status='available'`,
     `reconcile_reason=reason`, `reconciled_at=now`, ruch magazynowy IN
     `source_type='reconcile'`. To jest "pula ścinków z dnia X" z ustaleń —
     wchodzi do jutrzejszego FEFO jak każda inna partia.
   - `actual_kg == 0` → no-op, zwróć `{theoreticalKg: 0, actualKg: 0, delta: 0, affectedBatches: []}`.
7. Zwraca `{theoreticalKg, actualKg, delta, affectedBatches: [{id, batchNo, deltaApplied}]}`.

**Nowa funkcja `list_production_days(production_day)`** — dla **konkretnego
dnia** zwraca DISTINCT `(recipe_id, recipe_name)` ze wszystkich `seasoned_meat`
z tym `production_day`, **niezależnie od statusu** (żeby grupa z partiami już
w 100% `closed` też była widoczna — inaczej nie dałoby się kliknąć, żeby
dopisać `SC{n}` w przypadku z części 2). `theoreticalKg` liczone tylko z
wierszy `status != 'closed'` (0, gdy wszystkie zamknięte — to prawidłowy,
oczekiwany stan przy "domykaniu" dnia). Zwraca też `batchCount` (wszystkich,
nie tylko żywych), `lastReconciledAt`, `lastReconcileReason`. Czyste query,
bez zmian schematu.

**Nowa funkcja `list_day_reconciliation_history(limit=100)`** — czyta
`stock_movements` z `source_type='reconcile'` i `product_type='seasoned'`,
joinuje do `seasoned_meat` po `batch_id` dla `recipeName`/`productionDay`/
`reconcile_reason`. Zero nowych tabel — historia to istniejący log ruchów.

### Routing — `app/routes/seasoned_meat.py`

```
GET  /api/seasoned-meat/production-days           → list_production_days
POST /api/seasoned-meat/production-days/reconcile  → reconcile_production_day
     body: { recipeId, productionDay, actualKg, reason }
GET  /api/seasoned-meat/production-days/history    → list_day_reconciliation_history
```

### Frontend — `SeasonedMeatPage.tsx`

Prosty pasek zakładek (wzorzec `activeTab` z `useState`, jak w
`RawStockPage.tsx` — bez wprowadzania `shadcn/Tabs` po raz pierwszy w tym
miejscu): **"Partie"** (dzisiejszy widok, bez zmian) / **"Zamknięcie dnia"**
(nowy).

**Zakładka "Zamknięcie dnia":**

- Selektor daty (domyślnie dziś, `<Input type="date">`).
- `DataTable` grup z `list_production_days`: kolumny Receptura, Liczba partii,
  Teoretycznie zostało [kg], Ostatnia korekta.
- Klik wiersza → dialog (ten sam wzorzec wizualny co dzisiejsze "Koryguj
  partię"): karta "Teoretycznie: X kg", pole `Input type="number"` "Ile
  fizycznie zostało [kg]", `<select>` powodu — dokładam opcję **"ścinki /
  resztki z produkcji"** do istniejącej listy (`zaniżona teoria`, `resztka
  technologiczna`, `strata / odpad`, `korekta ważenia`, `ścinki / resztki z
  produkcji`, `inne`). Zapis → `POST .../reconcile`, potem refetch obu list.
- Rozwijana sekcja **"Historia zamknięć"** (wzorzec dzisiejszej "Historia ·
  wykorzystane partie"): data, receptura, teoretyczne, rzeczywiste, różnica
  (kg i %), powód — z `.../history`. Bez kolumny "kto": żaden istniejący
  mechanizm korekty w systemie (`reconcile_seasoned_batch`, korekty rozbioru)
  dziś nie zapisuje tożsamości użytkownika — patrz "Poza zakresem".

### `apiClient.ts` / `api.ts` / `mockApi.ts`

Dopisać do `seasonedMeatApi`: `productionDays()`, `reconcileDay(body)`,
`productionDayHistory()` — analogicznie do istniejącego `reconcile()`.

## Poza zakresem

- Automatyczny współczynnik strat / uczenie się z danych — możliwy fast-follow
  po zebraniu kilku tygodni historii z tej zakładki, nie teraz.
- Ważenie/rejestracja ścinków per sztuka lub per partia — świadomie
  zbiorcze, raz dziennie.
- Wykres trendu odchylenia w czasie — historia tekstowa wystarcza na start.
- Zmiany w `finish_day`/`finished_units_service` — zużycie teoretyczne
  `qty * kg_per_unit` zostaje bez zmian; ten spec dokłada tylko korektę
  końcową, nie przebudowuje modelu zużycia.
- Atrybucja "kto zrobił korektę" (login/user_id w audycie) — dziś brak jej w
  **całym** systemie korekt (nie tylko tu), więc dopisanie jej wyłącznie w tym
  miejscu tworzyłoby dwa niespójne standardy audytu. Osobny, przekrojowy
  fast-follow, jeśli kontrola weterynaryjna kiedyś tego zażąda.

## Testy

Backend (pytest, `TEST_DATABASE_URL`):

1. `reconcile_production_day` — jedna partia w grupie: identyczny efekt jak
   dzisiejszy `reconcile_seasoned_batch` na tej partii.
2. Dwie partie w grupie, delta ujemna większa niż wolne kg najstarszej —
   przechodzi na drugą partię (test dystrybucji FEFO).
3. Delta ujemna głębsza niż suma (wolne − zarezerwowane) obu partii → `400`.
4. Brak żywych partii w grupie, `actual_kg > 0` → tworzy `SC{n}`, widoczną
   potem w `list_seasoned()`.
5. Brak żywych partii, `actual_kg == 0` → no-op, brak nowych rekordów.
6. `abs(delta) < 0.001` → `400` "brak zmiany".
7. `list_day_reconciliation_history` zwraca wpis po udanej korekcie z
   poprawnym `recipeName`/`productionDay`/`reason`.

Frontend (vitest, jeśli logika wydzielona) — dystrybucja delty jeśli zostanie
wyciągnięta jako czysta funkcja pomocnicza po stronie backendu (Python, więc
pytest wystarczy; nie ma potrzeby czystej funkcji JS tutaj).
