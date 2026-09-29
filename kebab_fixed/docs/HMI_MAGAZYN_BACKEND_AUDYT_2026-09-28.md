# HMI magazynu — poprawki odpowiedzi backendu skanu (2026-09-28)

Zakres: `POST /api/magazyn/pakowanie/skan` → `magazyn_pakowanie_service.skanuj_sztuke`.
Reguły dopasowania i kolejności (ACTIVE/OTHER), blokady transakcyjne, klient,
pojemność i schemat DB — bez zmian.

## 1. Wyścig duplikatu dwóch stanowisk

Wcześniej: dwa stanowiska czytają tę samą sztukę jako `produced`.
- paleta: drugi zapis dostaje `ok=False` („już przypisana") → `_zapisz` = False →
  routing próbował dalszych kartonów → finalnie **NO_PLACE**;
- karton magazynowy: drugi zapis trafia w gałąź idempotentną (`ok=True`) →
  **ACTIVE** (i ewentualne „Wyjmij") dla skanu, który nic nie dopakował.

Teraz:
- `scan_unit_into_carton` w gałęzi idempotentnej zwraca dodatkowo `already: True`
  (addytywnie; `ok` i pozostałe pola bez zmian dla innych konsumentów).
- `_zapisz` zwraca wynik serwisu tylko przy FAKTYCZNYM zapisie, inaczej `None`
  (odmowa palety, 409 kartonu, idempotencja).
- Po `None` routing ponownie czyta sztukę (`_sztuka`) i stosuje te same reguły
  co przed pętlą (`_odmowa_sztuki`):
  - sztuka ma już `carton_id`/`pallet_id` → **ALREADY** z aktualnym `where`
    i `sameCarton` (bez prób zapisu do kolejnych kontenerów),
  - status ≠ `produced` → **NOT_PRODUCED** (ochrona statusu produkcji),
  - dalej wolna i `produced` (ostatnie miejsce zajęła INNA sztuka) → kolejny
    pasujący kontener; brak → **NO_PLACE**.
- Błędy inne niż 409 dalej lecą wyjątkiem.

## 2. Payload pełnego kartonu

Wcześniej: po zapisie szukano kartonu w `otwarte_kontenery()`; pełny już tam
nie występował, więc zwracano starą migawkę z `packedQty + 1` i starymi
`lines[].packedQty` (np. `full=true, packedQty=1, lines[0].packedQty=0`),
a „zniknął z otwartych" utożsamiano z „pełny".

Teraz `_kontener_po_zapisie(k)` robi wąski odczyt TEGO kontenera po `id`
i rodzaju, bez filtra statusu (paleta: `order_pallets`+`client_orders`
+ `_linie_palet([id])`; karton: `stock_cartons` + `stock_carton_lines`).
`packedQty`/`targetQty` to sumy aktualnych pozycji, a
`full = targetQty > 0 and packedQty >= targetQty`.

Skrajny przypadek: zapis potwierdzony, ale odczyt po `id` nie znalazł
kontenera. Wynik (ACTIVE/OTHER) zostaje — zapis się odbył i nie jest
zamieniany w błąd. `packedQty`/`targetQty` i `full` pochodzą z wyniku
transakcji zapisu (`full` / `palletStatus == "packed"`), `lines: []`
i addytywny marker `detailsAvailable: false`. **Brak rozpisu nie oznacza
pustego kartonu** — oznacza, że pozycji nie udało się odczytać; stare `lines`
z migawki sprzed zapisu nie są już zwracane jako aktualne. Normalny payload
nie ma pola `detailsAvailable` (zgodność wsteczna).
Przy okazji odpada drugi pełny odczyt wszystkich otwartych kartonów na skan.

## Testy

- Nowy `backend/tests/test_magazyn_pakowanie_race.py` (bez DB: atrapy serwisów
  zapisu i odczytów SQL, zablokowana pula połączeń): idempotencja stock →
  ALREADY/sameCarton; odmowa palety przy duplikacie → ALREADY z lokalizacją,
  bez prób dalej; 409 stock przez duplikat w innym kartonie → ALREADY; zajęte
  ostatnie miejsce INNĄ sztuką → kolejny karton / NO_PLACE; zmiana statusu →
  NOT_PRODUCED; nie-409 → wyjątek; pełny stock 1/1 i paleta 2/2 z aktualnymi
  `lines`; niepełny ≠ full; ACTIVE vs OTHER; ALREADY przed skanem.
  Po review dodano 2 przypadki: kontener (stock → ACTIVE, order → OTHER)
  nieznaleziony przy odczycie po zapisie — sumy i `full` z transakcji,
  `lines: []`, `detailsAvailable: false`.
- `backend/tests/test_stock_cartons_db.py`: asercja markera `already`
  (test DB — w tym zadaniu NIE uruchamiany).
- Wykonanie: Senior uruchomił
  `env -u TEST_DATABASE_URL PYTHON_DOTENV_DISABLED=1 DATABASE_URL=postgresql://x@127.0.0.1:9/x python3 -m pytest -o addopts='' -q tests/test_magazyn_pakowanie_race.py`
  — **14 passed in 0.24s**, łącznie z przypadkami fallbacku. Bez testów
  integracyjnych DB i fizycznego czytnika, bez wdrożenia.
- Powtórzenie 29.09.2026: Senior ponownie uruchomił ten sam test —
  **14 passed in 0.41s**, bez bazy produkcyjnej i integracyjnej.
- Hook PostToolUse (`/root/.claude/settings.json`, log `/tmp/kebab-pytest.log`)
  sprawdzony przez Seniora: wykonuje pełny `pytest`, ostatni przebieg zielony,
  ale z masowymi SKIP testów integracyjnych — w środowisku nie ma
  `TEST_DATABASE_URL`, więc zielony hook nie potwierdza testów DB.
- Nie sprawdzono prawdziwej współbieżności na bazie (dwie równoległe
  transakcje) ani testów integracyjnych — wyścig odtworzono tylko atrapami.
