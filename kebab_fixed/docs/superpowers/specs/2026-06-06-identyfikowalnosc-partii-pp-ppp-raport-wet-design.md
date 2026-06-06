# Identyfikowalność partii: PP vs PPP + raport dla weterynarii

Data: 2026-06-06
Status: zatwierdzony (decyzje użytkownika potwierdzone w sesji)

## Kontekst i problem

System śledzi towar od ćwiartki do wyrobu. Audyt na żywej bazie potwierdził, że
**warstwa danych jest spójna**: brak złamanych łańcuchów, bilans masy partii się
domyka (`kg_produced = kg_used + kg_available + kg_reserved`), suma ruchów OUT per
partia == `kg_used`, gotowy wyrób trzyma spłaszczony `source_deboning_ids` aż do
rozbioru. Wymóg HACCP/178-2002/931-2011 (krok w tył / w przód) jest spełniony na
poziomie danych.

Dwa realne braki:

1. **Brak rozróżnienia GDZIE nastąpiło zmieszanie partii.** Dziś partia łączona to
   zawsze `PP{n}`, niezależnie czy zmieszano w mieszalniku (na masowaniu), czy z
   marynowanego mięsa na produkcji. Inspektor nie widzi z numeru, gdzie powstała
   mieszanka.
2. **Brak jednego czytelnego dokumentu na partię** dla inspekcji weterynaryjnej
   (skład + trasa + bilans), mimo że dane są w bazie.

## Dwa fizyczne przypadki (słownik domenowy)

- **Beczka / mieszalnik (masowanie):** np. 355 (300 kg) + 356 (300 kg) → ~750 kg
  wyrobu → partia łączona, wszystkie kebaby z tej masy noszą ten numer.
- **Produkcja / formowanie:** z marynowanego mięsa, np. resztka 357 (5 kg) +
  358 (15 kg) → 20 kg kebaba. Biuro decyduje o tym **na etapie planowania**
  (alokacja partii + kg na linię planu — już zapisywana w
  `production_plan_lines.batch_allocation`).

## Decyzje użytkownika

- **Numeracja partii łączonej:**
  - `PP{n}` = **P**artia **P**ołączona — zmieszane w **mieszalniku/beczce** (masowanie). Bez zmian.
  - `PPP{n}` = **P**artia **P**ołączona na **P**rodukcji — zmieszane z marynowanego mięsa przy formowaniu.
- Numer kebaba pozostaje `ddmmrr <wsad>`; `<wsad>` ∈ { goły numer | `PP{n}` | `PPP{n}` }.
- Skład (rodzice + kg) pochodzi z alokacji planu — już istnieje w bazie.
- **Bez migracji** istniejących numerów (dane testowe, baza czyszczona przed startem).
- Sposób planowania przez biuro bez zmian.

## Konwencja numeru (pełny obraz)

| Sytuacja | Kod wsadu | Przykład | Gdzie powstaje |
|---|---|---|---|
| Jedna partia | goły numer | `060626 326` | dziedziczony |
| Zmieszane w beczce | `PP{n}` | `060626 PP1` | masowanie |
| Zmieszane na produkcji | `PPP{n}` | `060626 PPP1` | zamknięcie produkcji z ≥2 partii marynowanych |
| Sztuki rozdzielne (każda z jednej partii) | goły numer per sztuka | `060626 357` | produkcja, alokacja dzieli się czysto na sztuki |

## Zakres zmian (touchpoints)

### Backend — logika numeracji (chirurgiczna)
1. `app/utils/batch_numbers.py` — dodać czystą funkcję
   `production_combined_batch_no(n) -> "PPP{n}"` oraz predykat
   `is_production_combined(batch_no)`. (TDD: rozszerzyć `test_batch_numbers.py`.)
   Pozostawić `combined_batch_no -> "PP{n}"` i `is_combined` bez zmian.
2. `app/services/finished_goods_service.py:_compute_kebab_batch_no` (≈434) —
   gałąź „>1 partia" zmienić z `combined_batch_no(next_seq("pp_seq"))` na
   `production_combined_batch_no(next_seq("ppp_seq"))`. To JEDYNA zmiana logiki
   produkcji.
3. **Bez zmian:** `mixing_service.py:481` i `seasoned_meat_service.py:153`
   (oba = wyjście z mieszalnika → `PP`).

### Backend — raport identyfikowalności
4. `app/services/traceability_service.py` — rozszerzyć wynik o dane potrzebne do
   raportu: dla każdej partii łączonej (PP/PPP) skład rodziców z **kg** (z
   `mixing_order_lots.kg` dla PP; z `production_plan_lines.batch_allocation` dla
   PPP) oraz bilans masy (`kg_produced/used/available`). PPP rekurencyjnie rozwija
   rodziców-PP aż do ćwiartek (mechanizm spłaszczania `source_deboning_ids` już
   istnieje — raport ma to czytelnie pokazać).
5. Nowy endpoint, np. `GET /api/traceability/batch-report/{batch_no}` zwracający
   komplet: nagłówek partii, skład (rodzice + kg + daty), trasę ćwiartka→wyrób,
   bilans masy.

### Frontend — wydruk dla weterynarii
6. Nowa strona druku `BatchReportPage` (wzorzec jak `HaccpReportPage` /
   `OrderPrintPage` — HTML do druku/PDF z przeglądarki), zasilana endpointem z pkt 5.
   Pokazuje: numer partii + typ (goły / PP-mieszalnik / PPP-produkcja), skład z kg,
   pełną trasę, bilans masy, daty. Wejście np. z `RecallPage` / „Przepływ partii”.

### Testy
- `test_batch_numbers.py`: `production_combined_batch_no(1) == "PPP1"`,
  `is_production_combined("PPP1")` prawda, `is_production_combined("PP1")` fałsz.
- Test jednostkowy `_compute_kebab_batch_no`: 1 partia → `ddmmrr <numer>`;
  ≥2 partie → `ddmmrr PPP{n}` (NIE `PP`).
- Jeśli wykonalne bez DB: test kształtu danych raportu (skład + bilans) na
  atrapach; w innym wypadku weryfikacja zapytań na bazie testowej (read-only).

## Poza zakresem
- Migracja/przenumerowanie istniejących partii.
- Zmiana UI planowania (alokacja biura działa).
- Moduł „Wydanie”/WZ (osobny tor).
- Ujednolicenie podwójnego znaczenia prefiksu `PP` w numeracji zleceń produkcji
  (`PP/dd/mm/rr` plan) vs partia łączona (`PP{n}`) — to inny namespace, formaty się
  nie mylą (slashe vs cyfry); poza zakresem.

## Ryzyka / uwagi
- `_compute_kebab_batch_no` jest jedynym miejscem produkcyjnego łączenia — po
  zmianie produkcja daje `PPP`, masowanie nadal `PP`. Potwierdzić, że żadna inna
  ścieżka (`create_finished_good`, `tablet-finish`, `finish-day`) nie tworzy partii
  łączonej z pominięciem tej funkcji.
- Fallback „równy podział kg” w `_consume_seasoned_for_entry` zostaje, ale w
  praktyce produkcja idzie zawsze przez plan z alokacją (potwierdzone: wszystkie
  wyroby mają `plan_no`). Gdyby pojawiła się ścieżka ad-hoc bez alokacji — osobne
  zadanie.
