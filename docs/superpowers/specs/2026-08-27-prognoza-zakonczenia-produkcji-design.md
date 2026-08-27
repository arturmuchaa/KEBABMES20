# Prognoza godziny zakończenia produkcji

**Data:** 2026-08-27
**Status:** zatwierdzony do wdrożenia
**Ekran:** HMI Produkcja (`produkcja.html` → `ProductionHmiPage`)

## Problem

Kierownik hali nie wie, o której skończy się dzień. Pyta o to biuro, biuro zgaduje,
a decyzje zależne od tej godziny (drugi kurs auta, nadgodziny, zamówienie na jutro)
zapadają na wyczucie.

Na pasku dnia ma stanąć kafel `Koniec ok. ~15:40`, liczony z tego, co dzieje się
na hali teraz, i poprawiający się z każdą zakończoną produkcją.

## Stan wyjściowy — co system dziś wie

Zbadane na produkcji 27.08.2026:

| Fakt | Znaczenie |
|---|---|
| 5 planów w bazie, 2 ze statusem `done` (13. i 14.08) | brak danych historycznych |
| Na obu `tablet_finished_at` **wcześniejszy** niż `created_at` | to plany wpisane po fakcie, nie zmierzone dni |
| `BreakState` żyje w `useState`, nigdzie nie zapisywany | przerwy giną przy odświeżeniu ekranu |
| `workerEntries[].addedAt` — `HH:MM`, tylko przy PIERWSZYM wpisie osoby na pozycji | nie da się odtworzyć przebiegu |
| `progress_updated_at` — tylko OSTATNI zapis pozycji | jw. |
| Ruchy tulei (`stock_movements`, `source_type='plan_line'`) — 3 wiersze | powstają tylko gdy pozycja ma tuleję na stanie; nie jest to wiarygodny log |

**Wniosek:** po dniu produkcyjnym nie zostaje żaden ślad czasowy. Zanim cokolwiek
zacznie się uczyć, system musi zacząć nagrywać przebieg dnia.

Wartość startowa od właściciela: **jedna osoba układa ok. 120 kg/h.**

## Decyzje

Podjęte przez właściciela 27.08.2026:

1. **Liczba osób = tylko układający, na żywo.** Liczą się osoby mające dziś wpisane
   sztuki, bo załoga zmienia się w ciągu dnia (ktoś odchodzi na foliowanie).
   Świadomie przyjęte ryzyko: rano, po pierwszym wpisie, widać 1 osobę — gasi to próg
   z sekcji „Prognoza".
2. **Przerwy zapisywane w bazie, a prognoza dolicza przerwę, która jeszcze dziś będzie.**
   Bez tego ETA jest zawsze zaniżone o długość obiadu.
3. **Uczenie per receptura od pierwszego dnia** — nie globalne. Wariant „najpierw jedno
   tempo, potem klasy wagi" został odrzucony.

Do punktu 3 zastosowanie ma **kurczenie do rodzica** zamiast progu liczby próbek:
receptura wpływa na prognozę od pierwszego dnia, ale z wagą rosnącą wraz z liczbą dni.
Twardy próg („receptura liczy się od 3. dnia") dawałby skok prognozy w dniu przejścia —
dokładnie to skakanie, przed którym ostrzegano przy wyborze wariantu.

## Architektura

Trzy niezależne kawałki, wdrażane w tej kolejności:

```
(1) NAGRYWANIE            (2) UCZENIE                 (3) PROGNOZA
production_work_events  →  production_rate_samples  →  GET /api/production-rates
production_breaks          (upsert przy zamknięciu      → finishForecast.ts
                            dnia przez halę)            → kafel na pasku dnia
```

Kolejność jest wiążąca: nagrywanie wchodzi **pierwsze i osobno**, żeby zaczęło zbierać
od pierwszej pełnej produkcji. Prognoza może dojść tydzień później i od razu ma na czym stać.

### 1. Nagrywanie

#### `production_work_events`

Jeden wiersz na każdy zapis sztuk, pisany w **tej samej transakcji** co
`update_line_progress` — inaczej log rozjedzie się z postępem przy błędzie zapisu.

| Kolumna | Typ | Uwagi |
|---|---|---|
| `id` | TEXT PK | cuid |
| `plan_id` | TEXT | |
| `plan_line_id` | TEXT | |
| `recipe_id` | TEXT | z linii planu; klucz uczenia |
| `recipe_name` | TEXT | denormalizacja — receptura może zniknąć z kartoteki |
| `kg_per_unit` | NUMERIC | waga sztuki w chwili zapisu |
| `pieces_delta` | INTEGER | **ze znakiem**; ujemne = korekta w dół |
| `worker_id`, `worker_name` | TEXT | kto zapisał |
| `crew_size` | INTEGER | ilu ludzi ma wpisy na tym planie w chwili zapisu |
| `at` | TIMESTAMPTZ | `now()` |

`pieces_delta` liczone jako `qty_done_nowe − qty_done_stare`; `update_line_progress`
i tak czyta wiersz linii przed zapisem, więc nie potrzeba dodatkowego odczytu.

Zdarzenia z `pieces_delta <= 0` **nie wchodzą do uczenia** (korekta nie jest pracą),
ale są zapisywane — bez nich nie da się później zbadać, co się na hali działo.

#### `production_breaks`

| Kolumna | Typ |
|---|---|
| `id` | TEXT PK |
| `plan_id` | TEXT |
| `started_at` | TIMESTAMPTZ |
| `ended_at` | TIMESTAMPTZ NULL — `NULL` = przerwa trwa |

Endpointy `POST /api/production-plans/{id}/breaks/start` i `/end`. HMI trzyma stan
lokalny dla natychmiastowej reakcji ekranu, ale źródłem prawdy jest serwer.

Naprawia to przy okazji istniejący błąd: dziś przerwa ginie przy odświeżeniu ekranu,
a razem z nią blokada zapisu sztuk w trakcie przerwy (`canSave`).

### 2. Uczenie

#### Przypisanie roboczogodzin do receptury

Pozycje przeplatają się w ciągu dnia, więc godzin nie da się rozdzielić z sum dobowych.
Model dyskretyzacji: **praca między dwoma kolejnymi zapisami poszła w to, co właśnie
zapisano.**

Dla każdego zdarzenia `e` z `pieces_delta > 0`:

```
Δt      = at(e) − at(poprzednie zdarzenie tego dnia)
Δt      = Δt − (przerwy nachodzące na ten przedział)
Δt      = min(Δt, PRZERWA_MAX)                            [30 min]
rbh(e)  = Δt × crew_size(e)                               [roboczogodziny]
kg(e)   = pieces_delta(e) × kg_per_unit(e)
```

**Pierwsze zdarzenie dnia nie wchodzi do próbki — ani kilogramami, ani godzinami.**
Nie wiadomo, kiedy zaczęła się praca, która do niego doprowadziła: między wejściem
na halę a pierwszym zapisem jest przygotowanie stanowiska o nieznanej długości.
Zaliczenie mu kilogramów przy zerowych godzinach zawyżałoby tempo, a tym mocniej,
im mniej zapisów ma dzień. Pierwsze zdarzenie ustawia zegar i tyle.

`PRZERWA_MAX` chroni przed przerwą, której nikt nie odnotował: bez sufitu jedna
czterogodzinna dziura (awaria, brak surowca) wywraca tempo całego dnia.

Sumując po recepturze: `kg_receptury / rbh_receptury` = kg na roboczogodzinę tego dnia.

#### `production_rate_samples`

Jeden wiersz na `(plan_id, recipe_id)`, **UPSERT** przy `tablet_finish`.

| Kolumna | Typ |
|---|---|
| `plan_id`, `recipe_id` | TEXT, PK złożony |
| `plan_date` | DATE |
| `kg` | NUMERIC |
| `person_hours` | NUMERIC |
| `computed_at` | TIMESTAMPTZ |

**Świadomie trzymamy próbki, a nie gotową średnią wykładniczą.** `tablet_reopen`
pozwala cofnąć zamknięcie dnia i zamknąć go ponownie; średnia doliczana przyrostowo
nie da się cofnąć i po każdym „cofnij → zamknij" dzień liczyłby się drugi raz.
UPSERT po `(plan_id, recipe_id)` jest odporny na powtórzenie.

Uczenie odpala się przy `tablet_finish` (hala zamyka dzień), nie przy `office_confirm` —
biuro potwierdza czasem po kilku dniach, a prognoza ma się poprawić na jutro.

#### Odczyt tempa — kurczenie do rodzica

`GET /api/production-rates` liczy tempa z próbek (kilkaset wierszy rocznie, bez cache):

```
tempo(receptura) = (n·średnia_receptury + k·tempo_globalne) / (n + k)
tempo_globalne   = (m·średnia_wszystkich + k·ZIARNO)      / (m + k)
ZIARNO           = app_settings['production.seed_kg_per_person_hour']  (120)
```

gdzie `n`, `m` = liczba dni z próbką, `k = 2`. Przy pierwszym dniu receptura waży ⅓,
po pięciu dniach ⅚. Nigdy nie ma skoku i nigdy nie brakuje liczby.

Próbki starsze niż **90 dni** odpadają — hala zmienia obsadę i maszyny.

Ziarno 120 kg/h siedzi w `app_settings` (tabela już istnieje), żeby dało się je poprawić
z biura bez wdrożenia.

### 3. Prognoza

Czysty moduł `src/features/production-hmi/finishForecast.ts`, testowany jak `shiftStats`.

```
zostało_kg(pozycja) = (qty − qtyDone) × kgPerUnit
godzin(pozycja)     = zostało_kg / (tempo(receptura) × ilu_układa)
koniec              = teraz + Σ godzin + nierozliczona przerwa
```

Godziny sumują się po pozycjach, bo hala robi pozycję po pozycji — jeden wózek naraz.
Gdyby kiedyś ruszyły dwa stanowiska równolegle, ten wzór trzeba będzie zmienić i jest
to jedyne miejsce, które o tym wie.

**Tempo dzisiejsze wygrywa z uczonym.** Gdy dzień ma ≥ 30 min zarejestrowanej pracy,
tempa miesza się wagą rosnącą wraz z czasem pracy — dzisiejsza obsada i nastrój są
prawdziwsze niż średnia z historii. Uczone tempo zostaje jako podkład na start dnia
i na receptury, których dziś jeszcze nie robiono.

**Nierozliczona przerwa:** `app_settings['production.planned_break_minutes']` (domyślnie 30)
minus przerwy już wykorzystane dzisiaj, nie mniej niż 0.

#### Kiedy kafel pokazuje kreskę

Prognozy nie ma, gdy jest bezwartościowa:

- zero układających (nikt nie ma dziś wpisów),
- mniej niż **20 min** zarejestrowanej pracy — pierwszy wpis jednej osoby o 6:05 dałby
  godzinę 23:40 i kafel przestałby być wiarygodny na resztę dnia,
- plan zrobiony w całości → `Zrobione` zamiast godziny.

#### Panel uzasadnienia

Dotknięcie kafla otwiera panel z rozbiciem: tempo (dzisiejsze / uczone i jak zmieszane),
ilu układa, ile kg zostało per receptura, ile przerwy doliczono. Liczba bez uzasadnienia
na ścianie hali zostaje zignorowana albo obwiniona o pierwszą pomyłkę.

## Obsługa błędów

| Sytuacja | Zachowanie |
|---|---|
| `GET /production-rates` padnie | Prognoza liczy z samego dzisiejszego tempa; przy jego braku kafel pokazuje `—`. Ekran produkcyjny nie może paść przez kafel informacyjny. |
| Uczenie rzuci wyjątkiem przy `tablet_finish` | Złapane i zalogowane; **zamknięcie dnia idzie dalej**. Hala nie może zostać z niezamkniętym dniem przez statystykę. |
| Zdarzenie bez `recipe_id` (pozycja bez receptury) | Wchodzi do tempa globalnego, pomijane w per-recepturowym. |
| Dzień bez ani jednego zdarzenia (praca sprzed wdrożenia) | Brak próbek — nic się nie uczy, prognoza stoi na ziarnie. |
| Ujemne/zerowe `person_hours` | Próbka odrzucona (dzielenie przez zero). |
| Dzień z jednym zdarzeniem | Brak próbki — pierwsze zdarzenie tylko ustawia zegar. |

## Testy

**Czyste (vitest):** `finishForecast.test.ts` — zimny start na ziarnie, mieszanie
z tempem dzisiejszym, zmiana liczby układających w ciągu dnia, doliczanie przerwy,
progi wygaszania kafla (0 osób / < 20 min / plan zrobiony), plan pusty.

**Backend (pytest + `TEST_DATABASE_URL`):**
- zdarzenie zapisuje się przy dodaniu i przy odjęciu sztuk (delta ze znakiem),
- zdarzenie i `qty_done` wchodzą albo oba, albo żadne (rollback transakcji),
- przerwa przeżywa odświeżenie ekranu; `ended_at` domyka właściwą przerwę,
- przypisanie roboczogodzin: dwie receptury przeplatane w jednym dniu,
- pierwsze zdarzenie dnia nie wnosi ani kilogramów, ani godzin,
- `PRZERWA_MAX` ucina nieodnotowaną dziurę,
- przerwa odjęta od `Δt`,
- `tablet_reopen` → `tablet_finish` **nie** liczy dnia drugi raz (UPSERT),
- kurczenie do rodzica: 0 próbek → ziarno; 1 próbka → ⅓ wagi; próbki > 90 dni odpadają,
- błąd uczenia nie blokuje `tablet_finish`.

## Pliki

**Backend**
- `app/migrations.py` — 3 tabele + wiersze `app_settings`
- `app/services/production_plans_service.py` — zapis zdarzenia w `update_line_progress`, wywołanie uczenia w `tablet_finish`
- `app/services/production_rates_service.py` — **nowy**: uczenie i odczyt temp
- `app/services/production_breaks_service.py` — **nowy**: start/koniec przerwy
- `app/routes/production_plans.py` — trasy przerw
- `app/routes/production_rates.py` — **nowy**
- `tests/conftest.py` — nowe tabele do listy `_TRUNCATE`

**Frontend**
- `src/features/production-hmi/finishForecast.ts` — **nowy**, czysty
- `src/features/production-hmi/components/ForecastPanel.tsx` — **nowy**
- `src/pages/tablet/ProductionHmiPage.tsx` — kafel, źródło temp, przerwy przez API
- `src/lib/api.ts` — `productionRatesApi`, przerwy

## Poza zakresem

- Prognoza per pozycja („ta pozycja skończy się o 12:10") — najpierw musi się sprawdzić dla całego dnia.
- Klasy wagi sztuki jako osobny wymiar uczenia — receptura już nosi typową wagę; dokładać wymiar przy zerowych danych to zgadywanie.
- Pokazywanie prognozy w biurze — najpierw hala ma jej zaufać.
- Uczenie z rozbioru i masowania — inny rytm pracy, osobny temat.
