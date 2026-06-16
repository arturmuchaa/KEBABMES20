# Przyprawione mięso — rozdzielenie partii per (produkt + surowiec + dzień)

Data: 2026-06-16
Zakres: backend (`mixing_service.finish_mixing_session`, migracja DB, reverse-trace) + jednorazowa korekta danych. Frontend bez zmian (magazyn przyprawionego automatycznie pokaże rozdzielone wiersze). Strona „Historia masowania" = OSOBNY projekt (później).

## Problem

`seasoned_meat.batch_no` = numer wsadu surowca (`internal_batch_seq`, np. `364`).
`finish_mixing_session` wstawia przyprawione przez `INSERT … ON CONFLICT (batch_no)
DO UPDATE SET kg_available += …`. Gdy różne receptury używają tej samej partii
surowca, dostają ten sam `batch_no` → **zlewają się w jeden wiersz magazynu**.

Dowód z produkcji (2026-06-16): operator zmasował Gold2 i GOLD KEBAB z partii
surowca `364`; w magazynie przyprawionego jest **jeden** wiersz `364` (Gold2,
4940,4 kg, data 12.06) zamiast osobnych partii per produkt/dzień.

## Ustalenia (decyzje użytkownika)

- **Tożsamość partii przyprawionego = (recipe_id + batch_no/wsad + dzień).**
  Gold-364 i Gold2-364 z tego samego dnia = osobne; ten sam produkt+wsad+dzień
  (np. 2 maszyny) = dolewa. Różne dni = osobne.
- **Korygujemy istniejące dane** (rozdzielenie zlanego wiersza `364`).
- Najpierw fix; strona historii osobno.

## Fakty z kodu (dlaczego to bezpieczne)

- Produkcja kebaba pobiera przyprawione **po `material_type_id` + rezerwuje po
  `id` (FEFO)** (`production_plans_service.py:307`), NIE po `batch_no`. Więc wiele
  wierszy o tym samym materiale już działa.
- `batch_no` to identyfikator **wyświetlany / śladowy** oraz „wsad" na etykiecie
  kebaba. Reverse-trace: `finished_goods_service` `SELECT … seasoned_meat WHERE
  batch_no=%s`.
- Ograniczenie: `UNIQUE (batch_no)` na `seasoned_meat` — blokuje dwa wiersze `364`.

## Projekt

### 1. Migracja DB

- Zdjąć `UNIQUE (batch_no)` (`seasoned_meat_batch_no_key`).
- Dodać unikalność tożsamości: unikalny indeks na
  `(recipe_id, batch_no, (created_at::date))`.
  - Realizacja: kolumna `production_day date DEFAULT CURRENT_DATE` (czystsze niż
    indeks na wyrażeniu, bo upsert i tak porównuje po dniu) +
    `UNIQUE (recipe_id, batch_no, production_day)`. Migracja **backfilluje**
    istniejące wiersze: `UPDATE seasoned_meat SET production_day = created_at::date
    WHERE production_day IS NULL` (DEFAULT nie może referencjonować `created_at`).
- `batch_no` zostaje `364` — etykiety i numer kebaba bez zmian.

### 2. `finish_mixing_session` — jawny upsert zamiast ON CONFLICT(batch_no)

Zamiast `INSERT … ON CONFLICT (batch_no) DO UPDATE`:

1. `SELECT id FROM seasoned_meat WHERE recipe_id=%s AND batch_no=%s AND
   production_day=%s FOR UPDATE` (dziś).
2. Jest → `UPDATE … SET kg_produced += , kg_available +=`.
3. Brak → `INSERT` nowy wiersz (z `production_day = CURRENT_DATE`).

Efekt: Gold2-364-dziś i GOLD-KEBAB-364-dziś = dwa wiersze; druga maszyna tego
samego Golda z 364 dziś = dolewa.

### 3. Reverse-trace — obsługa >1 wiersza dla wsadu

`finished_goods_service._resolve_lineage` i inne `WHERE batch_no=%s` mogą teraz
zwrócić >1 wiersz (różne receptury z tego samego wsadu). Zmienić `query_one` →
agregacja/lista wszystkich pasujących (lineage wsadu = wszystkie partie z `364`).
Zweryfikować, że nie psuje to istniejących testów lineage.

### 4. Korekta istniejących danych (jednorazowy skrypt, PO migracji)

Rozdzielić wiersz `364` na podstawie `mixing_sessions` (recept przez `order_id`,
dzień przez `started_at::date`, kg = `kg_output`). Wyliczone z produkcji:

| Receptura | Dzień | kg_produced | kg_available | kg_used |
|---|---|---|---|---|
| Gold2 | 2026-06-12 | 720 | 0 | 720 |
| Gold2 | 2026-06-13 | 4080 | 4080 | 0 |
| Gold2 | 2026-06-16 | 360 | 360 | 0 |
| GOLD KEBAB | 2026-06-16 | 500,4 | 500,4 | 0 |

- Zużyte `kg_used=720` przypisane **FEFO** do najstarszej pod-partii (Gold2/12.06)
  — suma `available` = 4940,4 = dokładnie bieżący stan (spina się co do kg).
- **Zachować `id` oryginalnego wiersza** dla pod-partii Gold2/12.06 (`UPDATE`
  istniejącego wiersza: kg_produced=720, kg_available=0, kg_used=720,
  production_day=2026-06-12) — żeby nie osierocić referencji wyrobu, który zużył
  te 720 kg (`seasoned_batch_id`).
- Pozostałe 3 pod-partie = `INSERT` (nowe id, batch_no `364`, właściwy
  `production_day`, `material_type_id`/`material_name` skopiowane z oryginału).
- Skrypt idempotentny, w jednej transakcji, z asercją sumy kg przed/po
  (produced 5660,4; available 4940,4; used 720) — przerwij jeśli się nie zgadza.

### 5. Testy

- `test_mixing_reservation.py` lub nowy `test_seasoned_batch_identity.py`:
  czysta funkcja „klucz tożsamości" (recipe_id, batch_no, day) — różne receptury
  → różne klucze; ten sam → ten sam (merge). Wydzielić logikę klucza z upsertu do
  czystej funkcji (testowalnej bez DB), analogicznie do `normalize_reservation_lots`.
- Asercje korekty (sumy kg) zawarte w skrypcie korekty.

## Co poza zakresem

- Strona „Historia masowania" (request 2) — osobny spec/plan.
- Zmiana formatu numeru wsadu / numeru kebaba (`batch_no` zostaje `364`).
- Zmiana sposobu wyboru przyprawionego przez produkcję (po materiale, bez zmian).

## Kryteria sukcesu

1. Po zmasowaniu dwóch różnych produktów z tej samej partii surowca tego samego
   dnia → **dwa wiersze** w magazynie przyprawionego (per produkt).
2. Druga maszyna tego samego produktu+wsadu+dnia → dolewa do jednego wiersza.
3. Etykiety / numer kebaba / wybór przyprawionego przez produkcję — bez regresji
   (pełny pytest zielony).
4. Istniejący wiersz `364` rozdzielony na 4 pod-partie wg tabeli, sumy kg
   zachowane, referencje wyrobu (zużyte 720 kg) nieosierocone.
