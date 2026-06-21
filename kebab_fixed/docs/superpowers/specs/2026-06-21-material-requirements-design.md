# Kalkulator zapotrzebowania na surowiec — design

Data: 2026-06-21

## Cel

W MES, podczas wpisywania zamówienia (po wyborze rodzaju produktu i receptury),
pokazać ile surowca trzeba, aby zrealizować zamówienie: ćwiartki, mięsa z/s, a
przy składzie komponentowym (np. 70/30) — osobno ile ćwiartki (na mięso z/s) i
ile fileta. Na stronie głównej zamówień: ile surowca trzeba do realizacji
wszystkich zamówień oraz — dla zamówień częściowo wykonanych (np. 50%) — ile
aktualnie brakuje (zapotrzebowanie na resztę oraz niedobór netto względem
magazynu).

## Model danych (stan istniejący, wykorzystywany)

- `client_order_lines`: `qty`, `kg_per_unit`, `recipe_id`, `product_type_id`,
  `product_type_name`. `orders_service._hydrate_order` dokleja do każdej linii
  `qty_done` (faktyczna produkcja) — `reszta = qty - qty_done`.
- `recipes`: `total_output_per_100kg`, `recipe_ingredients` (qty_per_100kg, unit).
  `recipes_service.calc_kg_output(recipe_id, kg_meat)` liczy wydajność w przód
  (mięso + dodatki kg/L). Tę funkcję odwracamy.
- `product_types.components`: JSONB `[{materialTypeId, pct, sourceType, name}]` —
  **źródło prawdy składu** (np. 70/30). Fallback: `recipes.components`.
- `raw_material_types`: `mat-cwiartka` (requires_deboning=true, raw), `mat-mieso-zs`
  (produkt rozbioru, requires_deboning=false), `mat-filet-kurczak`, `mat-mieso-indyk`
  (bez rozbioru, przyjmowane 1:1).
- Stany magazynowe: `raw_batches.kg_available` (ćwiartka), `meat_stock.kg_free`
  (mięso z/s, filet, indyk — wynik `kg_available - kg_reserved`).
- `deboning_entries`: zawiera `yield_pct` per wpis (do średniej historycznej).

## Łańcuch obliczeń (odwrócenie produkcji)

Dla jednej pozycji zamówienia (lub jej części „pozostało"):

```
kg_output  = qty × kg_per_unit                       # kg gotowego produktu
kg_meat    = kg_output / (1 + Σ(qty_per_100kg_kg|l)/100)   # odwrócenie calc_kg_output
podział wg components:  kg_meat_komponentu = kg_meat × pct/100
dla każdego material_type komponentu:
   - requires_deboning (ćwiartka źródłowa mięsa z/s):
        kg_cwiartki = kg_mieso_zs / (yield_pct/100)
   - bez rozbioru (filet, indyk): kg_surowca = kg_mieso (1:1)
```

Reguły składu:
- Jeśli `product_types.components` niepuste → użyj ich.
- Inaczej, jeśli `recipes.components` niepuste → użyj ich.
- Inaczej → produkt jednoskładnikowy: cały `kg_meat` jako `mat-mieso-zs`
  (zachowanie dotychczasowe).

Odwrócenie wydajności: `calc_kg_output` dodaje liniowo dodatki proporcjonalne do
`kg_meat`, więc `output = kg_meat × (1 + f)` gdzie `f = Σ(qty_per_100kg)/100` dla
składników w kg/L lub `is_unlimited`. Zatem `kg_meat = output / (1 + f)`.

## Współczynnik wydajności rozbioru (planistyczny)

- Przechowywany w `settings` (klucz `deboning_yield_pct`), edytowalny w UI.
- Inicjalizacja: średnia `yield_pct` z `deboning_entries`; gdy brak danych → 70%.
- Używany WYŁĄCZNIE do planowania (przeliczenie mięsa z/s → ćwiartka). Nie
  wpływa na faktyczny rozbiór ani na meat_stock.

## Niedobór netto vs magazyn (kaskada)

Dla zapotrzebowania „pozostało" (suma po wszystkich otwartych zamówieniach):

Dla `mat-mieso-zs`:
1. `need_zs` = wymagane kg mięsa z/s.
2. `avail_zs` = `meat_stock.kg_free` dla `mat-mieso-zs`. **Najpierw zużyj gotowe
   mięso z/s.** `brak_zs = max(0, need_zs - avail_zs)`.
3. `need_cwiartka = brak_zs / (yield_pct/100)`.
4. `avail_cwiartka` = `raw_batches.kg_available` (status active) dla `mat-cwiartka`.
5. `netto_cwiartka = max(0, need_cwiartka - avail_cwiartka)` — ćwiartka do
   dokupienia/rozbioru.

Dla fileta/indyka (bez rozbioru):
- `netto = max(0, need - meat_stock.kg_free danego material_type)`.

## API (backend)

Nowy serwis `material_requirements_service.py` (czysta logika + zapytania
agregujące), nowe trasy w `routes/orders.py` (lub `routes/material_requirements.py`):

- `GET /api/orders/{id}/material-requirements`
  → rozbicie dla zamówienia: per pozycja + suma; warianty `total` (na `qty`) i
  `remaining` (na `qty - qty_done`).
- `GET /api/orders/material-requirements/summary`
  → agregat wszystkich otwartych zamówień: `total` (zapotrzebowanie całość),
  `remaining` (pozostało do zrobienia) oraz `net_shortage` (kaskada vs magazyn,
  per material_type, z polem `cwiartka_netto` dla mięsa z/s).
- `POST /api/orders/preview-requirements`
  → bezstanowy podgląd dla formularza: wejście
  `{recipe_id, product_type_id, qty, kg_per_unit}` (lub lista pozycji), wyjście
  rozbicie jak wyżej. Nie zapisuje nic.

Kształt pozycji wyniku:
```
{
  "material_type_id": "mat-cwiartka" | "mat-mieso-zs" | "mat-filet-kurczak" | ...,
  "material_name": "...",
  "requires_deboning": bool,
  "kg_meat": float,        # kg mięsa komponentu
  "kg_raw": float          # kg surowca (ćwiartka po yield lub filet 1:1)
}
```
Dla 70/30 wynik zawiera m.in. wiersz „mięso z/s → kg_raw ćwiartki" oraz
„filet → kg_raw fileta".

## Frontend

- `src/features/orders/order-form/OrderLinesQuickAdd.tsx`: po wyborze rodzaju +
  receptury panel „Potrzebny surowiec" — live (debounce) przez
  `POST /api/orders/preview-requirements`, rozbicie per pozycja (ćwiartka /
  mięso z/s / filet wg składu).
- `src/pages/office/ClientOrdersPage.tsx`: karta podsumowania na górze —
  „Surowiec do realizacji wszystkich zamówień" z kolumnami: *Zapotrzebowanie
  (całość)*, *Pozostało* oraz *Niedobór netto vs magazyn* (kolor ostrzegawczy
  gdy magazyn < potrzeba). Per wiersz zamówienia: ile surowca brakuje na resztę
  (`reszta = qty - qty_done`).
- Klient API: nowe metody w `src/lib/api.ts`.

## Testy

Backend (pytest), na czystej logice serwisu:
- Odwrócenie wydajności (calc_kg_output ↔ odwrotność) dla receptur z dodatkami i
  bez.
- Podział 70/30: poprawne kg per material_type; suma = kg_meat.
- Deboning: mięso z/s → ćwiartka przez yield_pct (w tym yield krawędziowy).
- Produkt bez komponentów → cały kg_meat jako mat-mieso-zs.
- Kaskada niedoboru: najpierw mięso z/s z magazynu, potem ćwiartka, potem
  odjęcie ćwiartki z magazynu; netto nieujemne.
- Agregacja po wielu zamówieniach i wariant „remaining" (qty_done).
- Krawędzie: qty=0, brak receptury, brak współczynnika (fallback 70%).

## Poza zakresem (YAGNI)

- Rezerwacja/blokowanie magazynu na podstawie zapotrzebowania.
- Wieloskładnikowe yieldy per receptura (na razie jeden globalny współczynnik).
- Prognozy zakupowe / sugestie dostaw poza pokazaniem netto.
