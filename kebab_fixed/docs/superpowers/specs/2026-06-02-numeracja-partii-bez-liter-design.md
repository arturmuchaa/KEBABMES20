# Numeracja partii bez liter — projekt

**Data:** 2026-06-02
**Status:** zaakceptowany model, do wdrożenia

## Problem

Obecnie numer partii zmienia prefiks na każdym etapie produkcji, co utrudnia
śledzenie i nie odzwierciedla rzeczywistego procesu w zakładzie:

| Etap | Obecny numer | Plik |
|------|--------------|------|
| Przyjęcie (`raw_batches.internal_batch_no`) | `R330` | `raw_batches_service.py:100` |
| Rozbiór (`meat_stock.lot_no`) | `M330` | `deboning_service.py:156` |
| Mieszanie/przyprawianie (`seasoned_meat.batch_no`) | `MP330` / `MPP{n}` | `mixing_service.py:455`, `seasoned_meat_service.py:145` |
| Produkcja kebab (`finished_goods.batch_no`) | `P{seq}` / `PP{seq}` | `finished_goods_service.py:288,585` |

Zakład celowo dzieli każdą dostawę (~9 ton ćwiartek) na 2–3 mniejsze partie,
żeby przy salmonelli/wycofaniu niszczyć tylko zakażoną mniejszą partię, a nie
całą dostawę. Numeracja musi tę ochronę (recall containment) zachować.

## Docelowy model numeracji

Zasada przewodnia: **jeden numer ciągnie się przez cały proces bez liter.
Litera pojawia się wyłącznie tam, gdzie partie są fizycznie łączone (`PP`),
oraz na finalnym kebabie (data).**

| Etap | Nowy numer | Przykład |
|------|-----------|----------|
| Przyjęcie | goły numer z sekwencji `batch_seq` | `330` |
| Rozbiór | ten sam numer co partia surowca | `330` |
| Mieszanie (jedna partia) | ten sam numer | `330` |
| Mieszanie (kilka partii łączonych) | `PP{n}` z sekwencji `pp_seq` | `PP1` |
| Kebab (jedna partia wsadowa) | `ddmmrr` + spacja + numer partii | `020626 330` |
| Kebab (fizycznie zmieszane wsady) | `ddmmrr` + spacja + `PP{n}` | `020626 PP1` |

### Reguły łączenia (zgodne z HACCP / recall containment)

1. **Pojedyncza partia płynie jako goły numer** przez przyjęcie → rozbiór →
   mieszanie bez zmiany (`330` → `330` → `330`).
2. **Łączenie kilku partii** (np. wspólne masowanie/zasyp różnych partii)
   tworzy NOWĄ partię `PP{n}`. Numery źródłowe (`330`, `331`) zapisane są
   w lineage w bazie (`populate_lineage`, `raw_batch_nos`, `source_*_ids`) —
   nie w samym numerze. `PP` to dla weterynarii czytelny sygnał „partia
   łączona, sprawdź źródła".
3. **Na etapie kebaba produkcja jest rozbijana per partia wsadowa.** Jeśli
   wpis produkcji dotyczy jednej partii zaprawionej → kebab dostaje goły numer
   tej partii (`020626 330`). Dopiero gdy mięso z kilku partii trafia
   fizycznie do tych samych sztuk (wpis z wieloma partiami wsadowymi) →
   powstaje `PP{n}` i kebab to `020626 PP1`. Operator uzyskuje rozbicie
   per partia przez zgłaszanie osobnych wpisów produkcji na każdą partię.
4. **Stałość recall:** najwęższy możliwy zakres wycofania = dokładnie ta jedna
   mniejsza partia, dla której dzielono dostawę. Drzewo `PP1 → {330, 331}`
   trzyma lineage i działa „krok w tył / krok w przód".

## Zakres zmian w kodzie

### Backend

1. **`raw_batches_service.py`**
   - `_BATCH_NO_RE`: `r"^R(\d+)$"` → `r"^(\d+)$"`.
   - `next_batch_number()`: `nextNo`/`suggestedBatchNo` = `str(next_val)`
     (bez `R`).
   - `create_batch()`: `internal_no = str(seq)` (bez `R`); komunikat błędu
     walidacji → „Numer partii musi być liczbą, np. 330". Usunąć `.upper()`
     (zbędne dla cyfr, zostawienie nieszkodliwe — usunąć dla czytelności).

2. **`deboning_service.py:156`**
   - `meat_lot_no = f"M{batch['internal_batch_seq']}"` →
     `meat_lot_no = batch["internal_batch_no"]` (dokładnie numer partii surowca,
     np. `330`).

3. **`mixing_service.py:455-457`** oraz **`seasoned_meat_service.py:145-147`**
   (identyczny blok w obu):
   - jedna partia: `batch_no = str(seqs[0])` (zamiast `f"MP{seqs[0]}"`).
   - kilka partii: `batch_no = f"PP{next_seq('pp_seq')}"`
     (zamiast `f"MPP{next_seq('mixed_seq')}"`).

4. **`seasoned_meat_service.py:313`** (fallback lineage)
   - regex `r"^MP(\d+)$"` → `r"^(\d+)$"`, żeby gołe numery (`330`) dało się
     dopasować do `internal_batch_seq`.

5. **`finished_goods_service.py`** — strategia nazewnictwa kebaba
   (`_process_finish_day_entry`, blok ~530-585 i `create_finished_good:288`):
   - Pomocnicza funkcja: `ddmmrr(produced_date)` → `datetime`/`strftime("%d%m%y")`.
   - Jedna partia wsadowa (`len(seasoned_batch_nos) == 1`):
     `batch_no = f"{ddmmrr} {seasoned_batch_nos[0]}"` (np. `020626 330`).
   - Wiele partii wsadowych (fizycznie zmieszane):
     `pp = f"PP{next_seq('pp_seq')}"`; `batch_no = f"{ddmmrr} {pp}"`.
   - **Grupowanie (dedup) `existing`:** dołożyć `batch_no` do klucza, tak aby
     partie `330` i `331` z tego samego dnia NIE łączyły się w jeden wpis
     `finished_goods`. Kolejność: najpierw policz `batch_no`, potem szukaj
     `existing` po `batch_no` + reszcie klucza (packaging/kg_per_unit/klient).
   - `create_finished_good`: `default_batch_no` w tym samym formacie
     (`ddmmrr` + numer wsadu, jeśli dostępny; w razie braku — `ddmmrr PP{n}`).

6. **Sekwencje** — `pp_seq` tworzona leniwie przez `next_seq` (jak pozostałe
   klucze w tabeli `sequences`), bez osobnej migracji schematu.

### Frontend

Większość ekranów bierze numer z backendu (`suggestedBatchNo`), więc zmiany są
minimalne:
- `features/raw-batches/types.ts`: komentarze `"R171"`/`"R308"` → `"330"`.
- `features/raw-batches/components/CreateRawBatchModal.tsx:75`: `.toUpperCase()`
  — nieszkodliwe dla cyfr; zostawić.
- Audyt tekstów pomocniczych/placeholderów pod kątem „format R…".

### Czyszczenie starych danych (operacja jednorazowa, destrukcyjna)

Użytkownik chce **czysty start**: skasować cały łańcuch produkcyjny łącznie
z partiami surowca, a numerację ustawić tak, by następna przyjęta partia
dostała numer **344** (`batch_seq = 343`).

- Skrypt `cleanup_legacy_batches.py` (wzorzec jak `migrate_batch_numbers.py`),
  w jednej transakcji, z potwierdzeniem `tak/nie` przed wykonaniem, usuwa:
  - `finished_goods` + `finished_goods_sessions` (kebab),
  - `seasoned_meat` + `mixing_sessions` + `mixing_orders` + `mixing_order_lots`
    (masowanie),
  - `meat_stock` + `deboning_entries` + sesje rozbioru (ćwiartka),
  - `raw_batches` (surowiec),
  - powiązane `stock_movements` oraz dane pochodne (`production_plans`/
    `production_plan_lines` z odwołaniami do skasowanych partii — do audytu
    podczas wdrożenia).
- Reset sekwencji: `batch_seq = 343` (następna partia → `344`), `pp_seq = 0`,
  `mixed_seq`/`finished_goods_seq` — wyzerować (już nieużywane do nowego
  formatu, ale czyścimy dla porządku).
- Operacja destrukcyjna — uruchamiana **ręcznie na VPS**, nie w ramach
  normalnego deployu. Kolejność DELETE musi respektować klucze obce
  (od `finished_goods` w dół do `raw_batches`).

## Testy

Zgodnie z kontraktem MES (każda zmiana stocku = `stock_movement`,
identyfikowalność w obie strony):

1. **Przyjęcie:** po czyszczeniu (`batch_seq=343`) pierwsza partia →
   `internal_batch_no == "344"` (goły numer, sekwencja +1).
2. **Walidacja:** ręczny numer `"abc"` → 400; `"344"` → OK.
3. **Rozbiór:** partia `344` → `meat_stock.lot_no == "344"`.
4. **Mieszanie pojedyncze:** jedna partia `344` → `seasoned_meat.batch_no == "344"`.
5. **Mieszanie łączone:** partie `344` + `345` → `batch_no == "PP1"`, lineage
   zawiera oba numery źródłowe.
6. **Kebab pojedynczy:** wsad `344`, data 2026-06-02 → `batch_no == "020626 344"`.
7. **Kebab — rozbicie per partia:** dwa osobne wpisy (`344`, `345`) tego samego
   dnia → dwa rekordy `finished_goods` (`020626 344`, `020626 345`), nie jeden.
8. **Kebab łączony:** jeden wpis z wsadami `344`+`345` → `020626 PP{n}`.
9. **Recall:** wycofanie partii `344` znajduje tylko kebaby zawierające `344`
   (bezpośrednio lub przez `PP{n}`), nie te z `345`.
10. **Identyfikowalność wstecz:** `020626 PP1` → `{344, 345}` → dostawcy.
