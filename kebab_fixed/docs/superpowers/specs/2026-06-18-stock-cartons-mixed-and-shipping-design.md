# Karton magazynowy: skład mieszany + ścieżka wysyłki + spójność dokumentów

Data: 2026-06-18
Status: zaakceptowany (projekt)

## Kontekst i problem

Sekcja „pakowanie w kartony na zapas" (bez zamówienia) ma solidny rdzeń, ale audyt
ujawnił luki integracyjne:

- **A (ślepa uliczka wysyłki).** Sztuki spakowane do `stock_cartons` dostają
  `carton_id` + `status='packed'`, ale wysyłka (`loading_service.finalize_loading`)
  działa wyłącznie po `pallet_id`/`order_pallets`, a wydanie luzem odrzuca `packed`
  (`validate_loose_dispatch`). `assign_carton_to_order` ustawia tylko `order_id` na
  sztukach i `linked_order_id` na kartonie — nie daje ścieżki wysyłki. Efekt: karton
  na zapas nie ma jak fizycznie wyjechać.
- **B (RBAC).** `/api/pallets/*` i `/api/stock-cartons/*` nie są w
  `DEPARTMENT_PREFIXES`, więc wpadają w default‑deny `office`. Ekran hali
  `MobilePakowaniePage` jest dla operatora działu „pakowanie" → operator dostaje 403.
- **C (podwójne liczenie).** Dwa nieuzgodnione tory pokrycia zamówienia: per‑sztuka
  (`assign_carton_to_order` na `stock_cartons`) vs zagregowany FIFO `finished_goods`
  (`order_stock_service`, używany w WZ/HDI/CMR). Dokumenty nie czytają linku kartonu.
- **D (klucz dopasowania).** Skan i `eligible_units` dopasowują tuleję po
  `carton.packaging_name`, dedup i match‑service po `packaging_id`.
- **E (równość float).** Dedup kartonu porównuje `kg_per_unit` surowym float, skan
  używa zaokrąglenia do 3 miejsc.
- **F (strażnik assign).** `assign_carton_to_order` powiąże nawet pusty karton.

Dodatkowo nowy wymóg biznesowy: **karton mieszany** — jeden klient, wiele pozycji
(różne receptury/rodzaje/wagi, różne partie), np. „Zagros 30×10 kg + 20×15 kg".
Sztuki dodawane skanem na hali **albo** ręcznie w biurze z wyrobów gotowych.

## Decyzje (zatwierdzone)

1. Karton mieszany = jeden klient, wiele pozycji; dopasowanie do zamówienia
   **per‑pozycja, ten sam klient**.
2. Dokumenty WZ/HDI = **fizyczna prawda**: liczymy faktycznie wydane sztuki; FIFO
   `finished_goods` **wyklucza** sztuki spakowane do kartonów powiązanych z tym
   zamówieniem (koniec podwójnego liczenia).
3. Zakres iteracji: pełny — mix + wysyłka + A–F.

## Fakty z kodu (potwierdzone)

- `finished_units` ma `recipe_id, product_type_id, tuleja (TEXT), weight_kg,
  batch_no, status, carton_id, pallet_id, dispatch_id, order_id, client_name`.
  **Brak `packaging_id`** → strona sztuki dopasowuje tuleję po nazwie.
- `dispatches` jest **po kliencie** (`client_id, client_name, trip_id`), **bez
  `order_id`**. `close_dispatch` przełącza sztuki z `dispatch_id` na `shipped`.
- `scan_into_dispatch` (luzem) blokuje `packed` — dla kartonu potrzebna osobna ścieżka.

## Architektura docelowa

### Model danych — nagłówek + pozycje

`stock_cartons` staje się nagłówkiem:
`id, carton_no, client_id, client_name, status (open|packed), linked_order_id,
linked_order_no, created_at, closed_at`.
Dotychczasowe kolumny składu (`recipe_id, product_type_id, packaging_id/name,
kg_per_unit, target_qty, packed_qty`) zostają w bazie jako *nullable* dla
kompatybilności, ale logika ich nie używa.

Nowa tabela `stock_carton_lines`:
`id, carton_id (FK), recipe_id, recipe_name, product_type_id, product_type_name,
packaging_id, packaging_name, kg_per_unit, target_qty, packed_qty`.

Agregaty nagłówka do UI: `target_qty = SUM(lines.target_qty)`,
`packed_qty = SUM(lines.packed_qty)`. Karton `packed` ⇔ każda pozycja pełna.

Karton jednorodny = jedna pozycja (ten sam kod obsługuje oba przypadki).

**Migracja** (`migrations.py`): utwórz `stock_carton_lines`; dla każdego istniejącego
kartonu wstaw jedną pozycję z jego kolumn składu (idempotentnie, tylko gdy karton nie
ma jeszcze pozycji). Zero utraty danych.

### Pakowanie sztuk — dwa wejścia, wspólna walidacja

Czysta funkcja dopasowania pozycji (testowalna bez DB):
`pick_line_for_unit(unit, lines) -> line | None` — pierwsza pozycja, gdzie
`recipe_id`, `product_type_id`, `tuleja==packaging_name`, `_kg(weight)==_kg(kg_per_unit)`
i `packed_qty < target_qty`.

- **Skan na hali** (`scan_unit_into_carton`): jak dziś (idempotencja, `FOR UPDATE`,
  status sztuki `produced`, sztuka nie w innym kartonie), ale zamiast porównania ze
  stałym składem — `pick_line_for_unit`; inkrement `line.packed_qty`; nagłówek
  `packed` gdy wszystkie pozycje pełne. Komunikaty błędów rozróżniają „pozycja pełna"
  vs „brak pasującej pozycji".
- **Ręczne dodanie w biurze** (`add_units_to_carton_line(carton_id, line_id, qty)`):
  bierze do `qty` sztuk `produced`, `carton_id IS NULL`, zgodnych z pozycją,
  uporządkowanych FIFO po partii (`batch_no, qr_seq`); pakuje je tą samą operacją co
  skan (`status='packed'`, `carton_id`). Zwraca ile faktycznie spakowano.

`eligible_units_for_carton` → `eligible_units_for_line(line_id)` (sztuki uprawnione
per pozycja, do walidacji offline i do podglądu w biurze).

### Wysyłka kartonu (naprawa A) — jedna ścieżka

Wyjazd (`dispatches`) jest po kliencie, więc skan kartonu na wyjazd obsługuje **oba**
przypadki: ad‑hoc (karton niepowiązany) i pod zamówienie (karton z `linked_order_id`,
sztuki niosą `order_id`).

Nowa operacja `scan_carton_into_dispatch(dispatch_id, code)` w `dispatches_service`:
- `parse_stock_carton(code)` z `SCARTON|<id>`,
- `dispatch` `FOR UPDATE`, status `open`,
- karton istnieje; jeśli `dispatch.client_id`/`client_name` ustawione — musi zgadzać
  się z klientem kartonu,
- ustaw `dispatch_id` na **wszystkich** sztukach kartonu w stanie `packed`
  (idempotencja: sztuki już na tym wyjeździe pomijamy),
- zwróć podsumowanie (ile sztuk dorzucono, batch breakdown).

`close_dispatch` (bez zmian) przełącza sztuki → `shipped`. `list_cartons` ukrywa
karton gdy `shipped >= packed` (już zaimplementowane). Route:
`POST /api/dispatches/{id}/scan-carton`.

### Dopasowanie do zamówienia (per‑pozycja)

`suggestions_for_order`: karton (niepowiązany, z ≥1 spakowaną sztuką) sugerowany, gdy
**każda** jego pozycja z `packed_qty>0` pasuje do jakiejś linii zamówienia tego klienta
(`recipe_id + product_type_id + packaging_id + kg_per_unit`). `match_cartons` rozszerzony
o iterację po pozycjach kartonu.

`assign_carton_to_order` (fix F): odrzuć karton bez spakowanych sztuk
(`SUM(packed_qty)=0`); walidacja klienta jak dziś; stempluje `order_id` na sztukach.

### Dokumenty WZ/HDI — fizyczna prawda (fix C)

Zasada: ilości pokrycia zamówienia liczone z faktycznie wydanych/załadowanych sztuk.
Reconciliacja w `order_stock_service`: przy liczeniu pokrycia **wyklucz** z FIFO
`finished_goods` sztuki, które są już spakowane do kartonu powiązanego z TYM
zamówieniem (liczą się raz, jako pokrycie kartonem). Konkretnie: pokrycie zamówienia =
produkcja z planów (qty_done) **+** sztuki kartonów `linked_order_id = order` **+**
porcje FIFO `finished_goods` z wykluczeniem sztuk już skartonowanych pod to zamówienie.
Pełne TDD na scenariuszu „plan + karton na to samo (recipe, waga)".

### RBAC (fix B) — świadome metody/podścieżki

`permission_for_path(method, path)` rozszerzone o metodę. Mapowania:
- **pakowanie**: `GET /api/stock-cartons/open`, `GET /api/stock-cartons/{id}`,
  `GET /api/stock-cartons/{id}/eligible-units`, `POST /api/stock-cartons/{id}/scan`;
  `GET /api/pallets/to-pack|by-id|lookup|batch-breakdown`, `POST /api/pallets/{id}/pack`.
- **wydanie**: `/api/dispatches/*` (w tym `scan-carton`), `POST /api/pallets/scan`,
  `GET /api/pallets/in-cold-storage`.
- **office** (nadzbiór): `POST /api/stock-cartons` (utwórz), ręczne dodanie sztuk,
  `assign-stock-carton`, edycja palet (`/api/client-orders/*`).

Biuro zachowuje dostęp do wszystkiego (poza kontami biura) — rozszerzenie tylko
dopuszcza operatorów hali do ich akcji.

### Drobne

- **D**: dopasowanie sztuki ↔ pozycja po nazwie tulei (sztuka nie ma `packaging_id`);
  dopasowanie karton ↔ linia zamówienia pozostaje po `packaging_id`. Udokumentowane
  testem. Bez zmiany schematu.
- **E**: dedup pustego kartonu i wszystkie porównania wagi przez `_kg()` (round 3).

## Frontend

- `StockCartonModal` (biuro): tworzenie kartonu jako lista pozycji (dodaj/usuń
  rodzaj+waga+ilość), klient wspólny; opcja „dodaj sztuki z magazynu" per pozycja
  (podgląd dostępnych z `eligible-units`).
- `MobilePakowaniePage`: nagłówek aktywnego kartonu pokazuje pozycje i postęp per
  pozycja; walidacja lokalna offline rozszerzona o zbiór uprawnionych sztuk per
  pozycja.
- Ekran wydania (mobile): rozpoznanie `SCARTON|` → `scan-carton`; obok dotychczasowego
  skanu luzem/palet.

## Testy (TDD)

Czyste funkcje: `pick_line_for_unit`, `match_cartons` (mix), `compute_shortfalls`
z wykluczeniem kartonów, agregaty nagłówka. DB: mix pack (skan + ręczny), pełność
kartonu po wszystkich pozycjach, `scan_carton_into_dispatch` + `close_dispatch` →
`shipped`, ad‑hoc bez zamówienia, walidacja klienta, reconciliacja dokumentów (plan +
karton), `assign` odrzuca pusty karton, dedup po `_kg`. RBAC: `permission_for_path`
dla nowych ścieżek/metod. Front: walidacja offline per pozycja.

## Poza zakresem (YAGNI)

- Częściowa wysyłka kartonu (rozbijanie kartonu między wyjazdy) — karton jedzie w
  całości.
- Automatyczne łączenie wielu kartonów w jeden wyjazd ponad istniejący model `trip_id`.
- Zmiana modelu palet zamówień (klasyczny tor pozostaje bez zmian).
