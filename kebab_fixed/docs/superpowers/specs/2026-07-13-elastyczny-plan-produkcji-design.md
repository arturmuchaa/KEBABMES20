# Elastyczny plan produkcji („plan żywy") — projekt (Faza 1 / A)

Data: 2026-07-13
Status: zatwierdzony do implementacji

## Kontekst i cel nadrzędny

Północna gwiazda całego kierunku: **MES odwzorowuje produkcję 1:1 i pokazuje,
gdzie zakład traci kilogramy i pieniądze — per receptura, per etap.**

Obecnie plan produkcji jest zbyt sztywny: edytować można TYLKO plan w statusie
„Szkic" (`production_plans_service.update_plan` → `if plan["status"] != "draft"`),
a edycja robi pełną podmianę (przywróć wszystkie rezerwacje → skasuj wszystkie
pozycje → zarezerwuj od nowa). Skutek: gdy plan jest aktywny (partie
zarezerwowane, produkcja rusza), biuro musi **usunąć cały plan i złożyć go od
nowa**, a przy okazji „partie się rozjeżdżają".

Ten dokument obejmuje **tylko Fazę 1 (A): elastyczny plan**. Dalsze fazy (osobne
projekty): B — uzgadnianie ±kg z ekranu planu; koszty/ubytki per receptura;
C — mieszanie resztek (1-3 kg KIRMIZI → WROCŁAW). A ma NIE utrudniać tych faz.

## Zakres

W zakresie:
1. Plan edytowalny gdy status ∈ {`draft`, `active`} (nie `done`/`cancelled`).
2. Blokada per pozycja wg `qty_done`: wyprodukowana część nietykalna, reszta
   edytowalna; nie można zejść z `qty` poniżej `qty_done`.
3. Rezerwacje przyrostowe (delta), nie pełna podmiana. Odznaczenie partii →
   natychmiastowy zwrot jej niewyprodukowanych kg do dyspozycji.

Poza zakresem (świadomie): uzgadnianie ±kg w planie (B), mieszanie resztek (C),
raporty kosztów/ubytków (Faza 3), wychwytywanie realnych wag na etapach (Faza 2).

## Model danych (istniejący, bez zmian schematu jeśli się da)

- `production_plans`: `status` (draft/active/done/cancelled), `total_kg`,
  `total_units`, `tablet_pending_entries`, `tablet_finished_at`,
  `office_confirmed_at`.
- `production_plan_lines`: `qty`, **`qty_done`** (ile sztuk już spakowano —
  granica blokady), `line_status`, `kg_per_unit`, `total_kg`, `kg_assigned`,
  `batch_allocation` (JSON: partia→kg), `seasoned_batch_id`/`seasoned_batch_ids`
  (wybór partii), `worker_entries`, `progress_updated_at`.
- `seasoned_meat.kg_reserved` / `kg_available` / `kg_used`: rezerwacja idzie
  przez `kg_reserved`; produkcja (pakowanie) przenosi kg_reserved→kg_used.

Nie przewidujemy zmian schematu. Jeśli w implementacji okaże się potrzebna
kolumna (np. znacznik rewizji planu dla tabletu), dodajemy migracją
`ADD COLUMN IF NOT EXISTS` — do decyzji w planie wdrożenia.

## Projekt

### 1. Model edycji i blokad

- `update_plan` (i ścieżka edycji z UI) akceptuje plan o statusie `draft` LUB
  `active`. Odrzuca `done`/`cancelled`.
- **Blokada per pozycja wg `qty_done`:**
  - `qty_done == 0` → pozycja w pełni edytowalna (receptura, ilość, partie).
  - `0 < qty_done < qty` → edytowalna tylko RESZTA: można zmienić partie dla
    niewyprodukowanej części i podnieść/obniżyć `qty` (nie poniżej `qty_done`);
    receptury/rodzaju wyprodukowanej pozycji NIE zmieniamy.
  - `qty_done >= qty` (pozycja zrobiona) → read-only.
  - Usunięcie pozycji z planu dozwolone tylko gdy `qty_done == 0` (inaczej błąd:
    „pozycja częściowo/w całości wyprodukowana — nie można usunąć").
- Model spójny z edytorem planu masowania (zrobione = nietykalne).

### 2. Rezerwacje przyrostowe (rdzeń „1:1")

Zamiast full-replace, edycja **różnicuje** stan pozycji stary↔nowy i aplikuje
tylko delty na `seasoned_meat.kg_reserved`:

- **Odznaczenie partii** z pozycji → zwolnij rezerwację TEJ partii dla TEJ
  pozycji (jej niewyprodukowaną część): `kg_reserved -= zarezerwowane_tu`.
  Partia natychmiast wraca do dyspozycji (widoczna w „wolne kg").
- **Zaznaczenie partii / zmiana ilości / kg-na-sztukę** → policz nowe
  zapotrzebowanie pozycji i zarezerwuj tylko RÓŻNICĘ względem obecnej rezerwacji
  tej pozycji.
- **Zmiana receptury** (tylko gdy `qty_done == 0`) → zwolnij stare partie
  pozycji, zarezerwuj nowe.
- Rezerwowana jest zawsze tylko część niewyprodukowana (`qty - qty_done`);
  wyprodukowane siedzi w `kg_used` i jest nietykalne.
- Walidacja braków korzysta z istniejącej tolerancji `SEASONED_SHORTFALL_TOL_KG`
  (1 kg) — brak ≤1 kg nie blokuje.

Realizacja backendu: funkcja różnicująca, która dla każdej pozycji planu
porównuje dotychczasowe `batch_allocation`/rezerwacje z nowym wyborem i emituje
minimalne UPDATE-y `kg_reserved`. Odznaczenie = przypadek szczególny (nowy zbiór
partii nie zawiera starej → pełne zwolnienie jej udziału). Wszystko w JEDNEJ
transakcji z `FOR UPDATE` na planie, pozycjach i dotykanych partiach
(kolejność blokad deterministyczna — sort po id — jak w mixing_service, by
uniknąć deadlocków).

### 3. Bezpieczeństwo przy produkcji w toku

- Tablet pakuje `qty_done` na aktywnym planie równolegle. Edycja pod
  `FOR UPDATE`; ponowne odczytanie `qty_done` w transakcji edycji (nie z
  frontendowego snapshotu) — blokada liczona od ŻYWEGO `qty_done`, by nie zejść
  poniżej tego, co już spakowano między załadowaniem a zapisem.
- Zmniejszenie `qty` poniżej żywego `qty_done` → błąd z jasnym komunikatem.
- Rozważane (do decyzji w planie wdrożenia): lekki znacznik rewizji planu, żeby
  tablet pokazał „plan zmieniony" — jak `rev` w planie masowania. Domyślnie
  MVP bez tego; dołożyć jeśli tablet myli operatora.

## Zmiany w kodzie (szkic — uszczegółowi plan wdrożenia)

Backend (`production_plans_service.py`):
- Poluzuj bramkę statusu w `update_plan` (draft|active).
- Zamień pełną podmianę na różnicowanie rezerwacji per pozycja + walidację
  `qty_done` (nietykalność, brak zejścia poniżej, brak usuwania zrobionych).
- Ewentualny nowy, węższy endpoint/serwis do „odznacz partię" (natychmiastowe
  zwolnienie) — albo obsłużone przez tę samą ścieżkę edycji różnicowej.

Frontend (`ProductionPlanningPage.tsx`):
- Umożliw edycję aktywnego planu (nie tylko szkicu).
- Pozycje/część wyprodukowana wyświetlane jako zablokowane (wzór PlanRow
  masowania: `locked`), reszta edytowalna.
- Odznaczenie partii wysyła zmianę i odświeża „wolne kg" (partia wraca od razu).

## Przypadki brzegowe

- Odznaczenie partii częściowo zużytej (część `qty_done` z niej spakowana):
  zwalniamy tylko część zarezerwowaną (niewyprodukowaną); zużytej nie ruszamy.
- Wyścig z tabletem: `qty_done` wzrósł między załadowaniem UI a zapisem →
  liczymy blokady od żywego `qty_done`, edycja niewyprodukowanej reszty nadal
  bezpieczna; próba zejścia poniżej → błąd.
- Partia w całości zarezerwowana przez inną pozycję/plan → widoczna jako
  zarezerwowana; odznaczenie w NASZEJ pozycji zwalnia tylko nasz udział.
- Plan `done`/`cancelled` → edycja odrzucona.

## Testy

- Testy czyste (bez DB) na funkcji różnicującej rezerwacje: stary↔nowy zbiór
  partii → oczekiwane delty (odznaczenie = pełne zwolnienie udziału; zmiana
  ilości = delta; brak zmian = zero delt).
- Walidacja blokad `qty_done` (czysta funkcja): edytowalność, brak zejścia
  poniżej, brak usuwania zrobionych.
- Test DB (jeśli dostępna baza testowa) na `update_plan` aktywnego planu:
  odznaczenie partii zwalnia `kg_reserved`; zmiana ilości rezerwuje deltę;
  wyprodukowane nietknięte. Bez bazy testowej — weryfikacja przez staranny
  przegląd + kontrolowany test na realnym planie z rollbackiem wartości.

## Jak A karmi kolejne fazy

Utrzymując rezerwacje/zużycie per partia dokładne i „na żywo", A sprawia, że
plan = rzeczywistość. To warunek konieczny, żeby Faza 3 (koszty/ubytki per
receptura) mogła policzyć różnice teoria−realność. A świadomie nie dokłada
raportów ani wychwytywania wag — tylko czyści fundament.
