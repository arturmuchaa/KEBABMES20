# Analityka KPI (trendy) — MVP — design

Data: 2026-06-17
Zakres MVP (decyzja użytkownika): **uzysk masowania %**, **wolumen (kg/szt)**, **koszt/kg** — granulacja **dzień / tydzień / miesiąc**, zakres dat.

## Cel

Live-dashboard pokazuje stan TERAZ; brakuje **trendów w czasie**. Dodać stronę analityki z wykresami (recharts — już zainstalowany) + kartami KPI z Δ vs poprzedni okres.

## Dane (potwierdzone w kodzie)

- **Uzysk masowania:** `mixing_sessions` (kg_meat, kg_output, started_at) → uzysk% = Σkg_output / Σkg_meat.
- **Wolumen:** `mixing_sessions` (kg masowane) + `production_plan_lines` (qty_done, total_kg) per okres.
- **Koszt/kg:** REUSE `cost_service` — `get_averages(window)` (ważona cena surowca `price_per_kg`×`kg_received`), `_window_sql(date_expr, window)`, `compute_recipe_cost`. MVP = **koszt mięsa/kg w czasie** (dominujący driver, niskie ryzyko); pełny koszt wyrobu per receptura = Faza 2.

## Architektura

### Backend — `analytics_service` + `routes/analytics.py`
Czyste agregacje SQL `GROUP BY` po okresie (`date_trunc`). Granulacja przez helper:
`_bucket_sql(date_col, granularity)` → `date_trunc('day'|'week'|'month', date_col)`.

Endpointy (dostęp: biuro; parametry `from`, `to` ISO date, `granularity`=day|week|month):
- `GET /api/analytics/mixing-yield` → `[{period, kgMeat, kgOutput, yieldPct}]` (z `mixing_sessions`).
- `GET /api/analytics/volume` → `[{period, kgMixed, unitsProduced, kgProduced}]` (mixing_sessions + production_plan_lines).
- `GET /api/analytics/cost-trend` → `[{period, rawCostPerKg}]` — ważona cena surowca per okres (reuse `cost_service`/`get_averages` per bucket).
- (opcja) `GET /api/analytics/summary?from&to` → karty KPI (sumy okresu + Δ vs poprzedni równy okres).

Walidacja: domyślnie ostatnie 30 dni; max zakres np. 730 dni; granularity z whitelisty.

### Frontend — `AnalitykaPage` (`/office/analityka`)
- Górny pasek: zakres dat (od/do) + segmentowany przełącznik **Dzień/Tydzień/Miesiąc**.
- **Karty KPI** (3): uzysk masowania % (śr. okresu + Δ), wolumen kg masowane (+ Δ), koszt mięsa/kg (+ Δ). Δ vs poprzedni równy okres, kolor zielony/czerwony.
- **Wykresy trendów** (recharts):
  - LineChart: uzysk masowania % w czasie.
  - BarChart: wolumen (kg masowane / szt wyprodukowane) — dwie serie.
  - LineChart: koszt mięsa/kg.
- Design jak reszta (Fira, tokeny ink/brand, StatusBadge gdzie pasuje). Stan pusty + skeleton. Dostępność (aria, kontrast).
- Trasa `/office/analityka` + link w sidebarze (sekcja Produkcja). Dostęp biuro.

### Testy
- Harness bazy testowej (z #1): `tests/test_analytics_db.py` — seed `mixing_sessions` z różnych dni → asercja uzysku i wolumenu per bucket (day/week/month). Pure helper `_bucket_sql` przez asercję wyników. Cost-trend opiera się na istniejącym `cost_service` (osobne pokrycie).
- Frontend: typecheck + weryfikacja wizualna na :8080.

## Fazowanie

- **Faza 1 (TEN spec):** mixing-yield + volume + cost-trend (koszt mięsa/kg) + strona z 3 wykresami + karty KPI + zakres/granulacja. Testy agregacji.
- **Faza 2:** uzysk produkcji %, **straty per etap**, wydajność operatorów (`worker_entries`/`settled_days`), stany magazynowe w czasie, pełny koszt wyrobu per receptura.
  - **Definicja strat = wsad_teoretyczny − wyrób_faktyczny** na etapie. Masowanie: `kg_meat × (1 + uzysk_receptury)` (teoret., z `recipes.total_output_per_100kg` / `calc_kg_output`) − zważony `kg_output`. Produkcja: kg przyprawionego zużyte − `szt × kg/szt` faktyczne (ścinki/podłoga). UWAGA: ma sens DOPIERO na realnych danych operacyjnych (faktyczne wagi z produkcji) — przed uruchomieniem trend byłby pusty. Dane są (receptura zna teoret. uzysk, produkcja zapisze faktyczne).
- **Faza 3:** eksport CSV/PDF, drill-down (klik okres → szczegóły).

## Poza zakresem (YAGNI w MVP)

- Uzysk produkcji %, straty, wydajność operatorów (Faza 2).
- Cache/materializowane widoki (agregacje na żywo wystarczą dla skali zakładu).
- Predykcje/AI.

## Kryteria sukcesu

1. Strona `/office/analityka` pokazuje 3 trendy (uzysk masowania %, wolumen, koszt mięsa/kg) z przełącznikiem dzień/tydzień/miesiąc i zakresem dat.
2. Karty KPI z wartością okresu i Δ vs poprzedni okres.
3. Backend agregacje pokryte testami integracyjnymi (bucketowanie dzień/tydzień/miesiąc).
4. Typecheck/build zielone, brak nowych zależności (recharts już jest).
