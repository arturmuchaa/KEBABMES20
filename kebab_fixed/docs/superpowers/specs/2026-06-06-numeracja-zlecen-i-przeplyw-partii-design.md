# Spójna numeracja zleceń + naprawa przepływu partii

Data: 2026-06-06
Status: zatwierdzony (decyzje użytkownika potwierdzone w sesji)

## Problem

W systemie współistnieją dwa byty, które bywają mylone:

- **Numer partii** — fizyczny wsad (np. `326`). Dziedziczony przez cały łańcuch:
  przyjęcie → rozbiór → masowanie → mięso przyprawione → kebab (`ddmmrr 326`).
  Logika jest poprawna i scentralizowana w `app/utils/batch_numbers.py`.
- **Numer zlecenia** — identyfikator operacji (rozbiór, masowanie, produkcja).

Dwa konkretne defekty:

1. **Niespójna numeracja zleceń.** Rozbiór i masowanie nie używają wspólnego
   helpera `next_dated_no()` (z `app/utils/ids.py`), tylko lepią stare prefiksy
   ręcznie:
   - `deboning_service.py:111` → `session_no = f"RZB-{seq:03}"`
   - `mixing_service.py:210` → `order_no = f"MAS-{year}-{seq:03}"`

   Produkcja już używa `next_dated_no(conn, "PP", date)` → `PP/dd/mm/rr`.
   Linie `RZB-`/`MAS-` pochodzą z refaktora `ec91d32` (2026-04-10) i nie zostały
   objęte zmianą „jeden numer" (`batch_numbers.py`).

2. **Błąd w widoku „Przepływ partii".** `MobilePrzeplywPartiiPage.tsx:48` w kroku
   masowania pokazuje `mo.order_no` (numer *zlecenia*, `MAS-2025-001`) w miejscu,
   gdzie powinien być numer *partii* (`326`). To jedyny krok łańcucha mylący oba
   pojęcia — `mixing_orders` nie ma kolumny z numerem partii, partia żyje w
   skonsumowanych lotach (`mixing_order_lots → meat_stock.lot_no`).

## Decyzje użytkownika

- Numer zlecenia ma czytelnie mówić: **typ operacji + data**.
- Format: **`PREFIKS/dd/mm/rr`** ze slashami (spójnie z istniejącą produkcją `PP`),
  drugi tego samego dnia → sufiks `/2`, `/3` (obsługiwane przez `next_dated_no`).
- Partia (`326`) zostaje pojedynczym numerem płynącym przez łańcuch; numer nie
  koduje rodowodu (traceability w `batch_allocation` bez zmian).
- **Bez migracji bazy** — baza będzie wyczyszczona przed oficjalnym startem.

## Docelowy schemat

| Operacja | Dziś | Po zmianie |
|---|---|---|
| Rozbiór (`deboning_entries.session_no`) | `RZB-001` | `ROZ/dd/mm/rr` |
| Masowanie (`mixing_orders.order_no`) | `MAS-2025-001` | `MAS/dd/mm/rr` |
| Produkcja (`production_plans.plan_no`) | `PP/dd/mm/rr` | bez zmian |

Uwaga: prefiks `PP` jest już zajęty dwuznacznie — `next_dated_no("PP")` = plan
produkcji, a `combined_batch_no` = `PP{n}` = partia łączona. To istniejący wart,
poza zakresem tej zmiany (różne formaty: `PP/dd/mm/rr` vs `PP1`).

## Zakres zmian (touchpoints)

### Backend
1. `app/services/deboning_service.py` — `session_no` przez
   `next_dated_no(conn, "ROZ")`; wywołanie wewnątrz `with transaction()` (potrzebny
   `conn`); usunąć nieużywane `next_seq("deboning_seq")`; dodać import.
2. `app/services/mixing_service.py` — `order_no` przez `next_dated_no(conn, "MAS")`;
   wewnątrz transakcji; usunąć `next_seq("mixing_seq")`; import. `order_no` jest
   UNIQUE — `next_dated_no` gwarantuje unikalność per prefiks+dzień (sufiks `/n`).
3. `app/services/traceability_service.py` (~158–176) — do każdego `mo` w
   `result["mixingOrders"]` dopiąć listę numerów partii skonsumowanych lotów
   (`mo["batch_nos"] = [lot_no/raw_batch_no...]`), żeby front pokazał partię.

### Frontend
4. `src/pages/mobile/MobilePrzeplywPartiiPage.tsx:48` — krok masowania: `partia` =
   numery partii z `mo.batch_nos` (fallback do skonsumowanych lotów); `order_no`
   przenieść do `details`.
5. `src/pages/office/HaccpReportPage.tsx:69` — zastąpić `sessionNo.split('-')[2]`
   logiką odporną na nowy format (numer sesji nie jest już źródłem licznika HACCP;
   użyć innego, stabilnego identyfikatora/licznika dnia).
6. `src/pages/tablet/MixingTabletPage.tsx:745` — `PW-${rok}-${orderNo.split('-').pop()}`
   zależy od starego `-`; przy `MAS/dd/mm/rr` da cały string. Przebudować budowę
   numeru `PW` tak, by nie zależała od separatora `orderNo`.
7. `src/lib/mockApi.ts` (478, 890, 1471) + `src/features/deboning/types/index.ts:46`
   — zaktualizować mock dev i komentarze do nowego formatu (spójność środowiska dev).

### Testy
- Backend pytest: utworzenie rozbioru → `session_no` ~ `^ROZ/\d2/\d2/\d2$`;
  drugi tego dnia → `.../2`. Analogicznie masowanie `MAS/...`.
- Traceability: `mixingOrders[*].batch_nos` zawiera numer partii skonsumowanego lotu.
- Istniejące testy `batch_numbers` bez zmian.

## Poza zakresem
- Migracja istniejących numerów (baza czyszczona przed startem).
- Moduł „Wydanie" (jeszcze nie istnieje) — gdy powstanie: `WYD/dd/mm/rr`.
- Ujednolicenie dwuznacznego prefiksu `PP`.
