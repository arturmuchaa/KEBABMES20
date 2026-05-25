# Kalkulacja kosztu 1 kg wyrobu wg receptury

Data: 2026-05-25

## Cel
Policzyć koszt 1 kg wyrobu (kebabu) wg receptury: mięso z rozbioru (z akordem, uzyskiem,
kredytem za grzbiety/kości), przyprawy/bindingi wg receptury, opcjonalnie tuleje/opakowania,
plus koszt zakładu. Hybryda: średnie z realnych danych podstawiane, każde pole nadpisywalne.

## Wzór (potwierdzony z użytkownikiem)
```
koszt_mięsa/kg = (cena_ćwiartki/kg + akord/kg_ćwiartki − %grzbiety×cena_grzb − %kości×cena_kości) / uzysk
koszt_wsadu/100kg mięsa = 100 × koszt_mięsa/kg + Σ(skł.qty_per_100kg × cena_jedn_z_faktury)
koszt_1kg_wyrobu (bez opak.) = koszt_wsadu / recipe.total_output_per_100kg + koszt_zakładu_zł/kg
opakowanie/kg = (cena_tuleja + cena_opakowanie) / kg_na_sztukę        [opcjonalne]
koszt_1kg_wyrobu (z opak.) = koszt_1kg_wyrobu + opakowanie/kg
```
Akord liczony OD kg pobranej ćwiartki (input) → w przeliczeniu na mięso dzielony przez uzysk.

## Źródła danych
Domyślne (średnie, nadpisywalne w kalkulatorze):
- cena_ćwiartki/kg = średnia ważona `raw_batches.price_per_kg` (po kg_received, status active/aktualne).
- akord/kg = średnia `workers.rate_per_kg` dla pracowników roli rozbiorowej (role zawiera 'rozbi'/'debon').
- uzysk%, %grzbiety, %kości = średnie z `deboning_entries` (kg_meat/kg_quarter, kg_backs/kg_quarter, kg_bones/kg_quarter).
- cena składnika = `unit_price` z OSTATNIEJ faktury `invoices` (category='PRZYPRAWY_I_DODATKI', ingredient_id=…).
- cena opakowania/tulei = `unit_price` z OSTATNIEJ faktury (category='OPAKOWANIA_TULEJE', packaging_id=…).
Parametry w `app_settings` (edytowalne): `cost_backs_price` (0.50), `cost_bones_price` (0.02),
`cost_plant_per_kg` (2.00).

## Obsługa braków
Składnik/opakowanie bez ceny w fakturach → pokazany w rozbiciu, ale NIEDOLICZONY, z flagą
`missingPrice=true` ("brak ceny"). Suma jasno oznacza, że jest niepełna, gdy są takie pozycje.

## Architektura
Backend (`server_pg.py`):
- klucze `app_settings` z domyślnymi wartościami (przez migracje/seed lub on-read default).
- helper `_cost_averages()` → {quarterPrice, akord, yieldPct, backsPct, bonesPct}.
- helper `_latest_invoice_price(category, key_col, key_id)` → float|None.
- `GET /api/cost/params` / `PUT /api/cost/params` — odczyt/zapis 3 parametrów.
- `GET /api/cost/averages` — średnie do podstawienia w UI.
- `GET /api/cost/recipe/{id}` z opcjonalnymi query-override (quarterPrice, akord, yieldPct,
  backsPct, bonesPct, backsPrice, bonesPrice, plantPerKg, packagingIds=csv, kgPerUnit) →
  zwraca pełne rozbicie: meat/kg, lista składników (qty, unitPrice|null, cost, missingPrice),
  ingredients/kg, plant/kg, subtotal/kg (bez opak.), packaging lines + packaging/kg, total/kg.

Frontend:
- `apiClient`: costApi (params get/put, averages, recipeCost).
- `CostCalculatorPage` (`/office/kalkulacja-kosztow`): wybór receptury; panel parametrów
  (prefill średnimi+settings, nadpisywalny); rozbicie kosztu (tabela, flagi braków);
  opcjonalny wybór tulei+opakowania+kg/szt; sumy zł/kg bez i z opakowaniem.
- route w `App.tsx`, link w `OfficeSidebar.tsx` (sekcja Produkcja lub Zakupy).

Bez zmian w schemacie bazy dla cen (są w `invoices`). Jedyne nowe dane: 3 klucze w `app_settings`.

## Wdrożenie
Backend: edycja `kebab_fixed/backend/server_pg.py` → kopia do `/opt/kebab/app/backend/` + restart
`kebab-mes.service`. Frontend: `npm run build` → `/opt/kebab/app/dist` (backup + stare hashe).
Commit na gałęzi roboczej. (Desktop dostaje przy kolejnym release — patrz proces release.)

## Faza 2 (poza tym specem)
Koszt zakładu z realnych faktur (kategorie kosztów / total kg produkcji w miesiącu) zamiast stałej 2 zł/kg.
Podpowiadanie kg/szt opakowania z definicji produktu. Historia/snapshot kosztu w czasie.

## Poza zakresem (YAGNI)
Marże/ceny sprzedaży, wielowalutowość kosztu, wersjonowanie receptur.
