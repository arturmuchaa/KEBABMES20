# Rozbiór: częściowe ważenia mięsa + lista ważeń ubocznych z dolnego paska

Data: 2026-07-18 · Status: zaakceptowany przez użytkownika

## Problem

1. **Częściowe ważenia mięsa.** Pracownik pobiera np. 300 kg ćwiartki (pobranie,
   wpis `pending`). Zanim wykroi całość, biuro/masowanie potrzebuje „na szybko"
   już wykrojonego mięsa — ważymy np. 100 kg i zabieramy. System musi
   zapamiętać zważoną część, wpuścić ją OD RAZU na Magazyn mięsa (decyzja
   użytkownika), a pobranie zostawić otwarte do dowiezienia reszty (godzinę
   później). Ważeń częściowych może być dowolnie wiele.
2. **Lista ważeń ubocznych.** Klik w kafelek „Kości"/„Grzbiety" na dolnym pasku
   HMI ma pokazać poszczególne dzisiejsze ważenia frakcji (godzina, partia,
   wózek, pojemniki, kg) z sumą na dole — zgodną z liczbą na kafelku.

## Decyzje projektowe (z rozmowy)

- Mięso z częściowego ważenia wchodzi na Magazyn mięsa natychmiast.
- Interakcja: **jeden przycisk ZAPISZ + pytanie sterowane %** (wariant wybrany
  świadomie zamiast dwóch przycisków):
  - łączny % (zważone wcześniej + bieżąca porcja) / pobrane **≥ 63%** →
    pobranie domyka się bez pytania (jak dziś);
  - **< 63%** → dialog „Zważono łącznie X z Y kg (Z%) — czy to już całość?"
    z przyciskami **[DOWIOZĄ RESZTĘ — zapisz część]** / **[TO CAŁOŚĆ — zamknij]**.
  - Zaakceptowane ryzyko: część o % w normie (np. 200/300 = 66%) zamknie się
    bez pytania; ratunkiem jest istniejąca korekta z biura
    (`POST /deboning/entries/{id}/correct` podbija kg mięsa o dowiezioną resztę).
- Lista ważeń ubocznych: **ważenia z DZISIAJ, wszystkie partie**, wiersz =
  jedno ważenie (paleta) z kreatora.

## Część 1 — częściowe ważenia mięsa

### Dane

Nowa tabela `deboning_take_weighings` (jedno ważenie = jeden wiersz):

```
id            text PK (cuid)
entry_id      text NOT NULL REFERENCES deboning_entries(id) ON DELETE CASCADE
kg_meat       numeric NOT NULL CHECK (kg_meat > 0)
kg_gross      numeric NULL      -- audyt wagi RS232 (jak kolumny na wpisie)
tare_cart_kg  numeric NULL
tare_e2_kg    numeric NULL
e2_count      integer NULL
weigh_mode    text NULL         -- 'auto' | 'manual'
weighed_at    timestamptz NOT NULL DEFAULT now()
created_at    timestamptz NOT NULL DEFAULT now()
```

Indeks po `entry_id`. `deboning_entries` bez zmian schematu: wpis zostaje
`pending` aż do domknięcia; przy domknięciu `kg_meat` = suma ważeń
(częściowych + ostatniej porcji), z niej `yield_pct` i `kg_remainder`.
Kolumny audytu wagi na wpisie wypełnia ostatnia porcja (jak dotąd);
pełny audyt per porcja jest w nowej tabeli.

### Backend

- **`POST /api/deboning/takes/{entry_id}/weigh-part`** — dto jak
  `DeboningTakeComplete` (kgMeat = porcja + pola audytu wagi). Transakcyjnie:
  1. `SELECT … FOR UPDATE` wpisu; wymagany status `pending`.
  2. Walidacja: `sum(dotychczasowe ważenia) + kgMeat ≤ kg_quarter`
     (inaczej 400 „Mięso przekracza pobraną ćwiartkę"); przy `weigh_mode='auto'`
     istniejąca `validate_weighing_consistency`.
  3. INSERT do `deboning_take_weighings`.
  4. Dopisanie porcji do lotu mięsa: istniejący INSERT do `meat_stock`
     z `ON CONFLICT (lot_no) DO UPDATE` (lot_no = raw_batch_no) + ruch
     magazynowy IN — dokładnie ten sam kod co w `complete_deboning_take`
     (wyciągnąć wspólny helper). REGUŁA kolejności ruchów zachowana.
  5. Zwrot wpisu z agregatem `kgMeatWeighed` i listą ważeń.
  Sesja „przez noc": ta sama logika przepinania do otwartej sesji co w
  `complete_deboning_take`.
- **`complete_deboning_take` (istniejący) rozszerzony:** `kg_meat` w dto to
  **ostatnia porcja**. Backend: `kg_meat_total = sum(weighings) + porcja`;
  walidacja `validate_meat_yield(kg_taken, kg_meat_total)`; ostatnia porcja
  też trafia do `deboning_take_weighings` (lista ważeń kompletna); na magazyn
  wchodzi TYLKO porcja (wcześniejsze części już weszły). Wpis: `kg_meat =
  kg_meat_total`, `status='complete'`. Bez wcześniejszych ważeń działa 1:1
  jak dziś.
- **Storno (`delete_deboning_entry`):** dla wpisu z ważeniami odejmuje z
  `meat_stock` SUMĘ wszystkich porcji (dziś odejmuje `kg_meat` wpisu —
  dla pending z częściami odejmowałby 0); istniejący guard „mięso już
  zużyte" (kg_available lotu) obejmuje sumę. Wiersze ważeń schodzą kaskadą.
- **`update_deboning_take` (edycja kg pobrania):** walidacja
  `kgTaken ≥ suma zważonych porcji`.
- **`list_entries(withOpenTakes)`:** dla pending dokłada `kgMeatWeighed`
  (suma porcji; 0 gdy brak) — jedno zapytanie agregujące, bez N+1.

### HMI (DeboningHmiV10Page)

- Tryb domykania (klik w kafelek pracownika z ⏳) — bez zmian układu, jeden
  przycisk ZAPISZ. Nagłówek trybu pokazuje „Zważono już 100,0 kg", gdy
  `kgMeatWeighed > 0`.
- Po ZAPISZ czysta funkcja decyzyjna (nowy moduł w
  `features/deboning/utils`, testy vitest):
  - `(zważone + porcja) > pobrane` → blokada (istniejące `meatTooBig`,
    liczone od sumy);
  - łączny % ≥ `PARTIAL_ASK_BELOW_PCT = 63` → `completeTake` od razu;
  - łączny % < 63 → dialog część/całość (wzór istniejących modali v10):
    „Zważono łącznie 160 z 300 kg (53%) — czy to już całość?"
    [DOWIOZĄ RESZTĘ — zapisz część] / [TO CAŁOŚĆ — zamknij pobranie].
- Część → `weighPart`, toast „Zapisano 100,0 kg — razem 100/300 kg, pobranie
  otwarte", wyjście z trybu domykania (reset jak po completeTake), kafelek
  pracownika: „⏳ 411 · zważono 100/300 kg".
- Całość → `completeTake` (ostatnia porcja) — dalszy przebieg jak dziś
  (auto-zakończenie partii/prompt ubocznych przy domknięciu OSTATNIEGO
  pobrania — częściowe ważenie NIE triggeruje).
- Statystyki dnia i pasek dolny liczą jak dziś tylko wpisy `complete`
  (świadomie: pary kg pobrane/mięso spójne; żywy stan mięsa i tak widzi
  Magazyn mięsa od razu).
- Warstwa api/hooks: `weighPart` w `DeboningApi`, `apiClient` i
  `useDeboningEntries`.

## Część 2 — lista ważeń ubocznych z dolnego paska

- Kafelki „Grzbiety" i „Kości" na dolnym pasku stają się przyciskami
  (wzór kafelka „Statystyki"). Klik → modal (układ jak `statsModal`, 720 px):
  - nagłówek „Kości — ważenia dzisiaj" / „Grzbiety — ważenia dzisiaj";
  - wiersz = jedno ważenie: **Nr · godzina · partia · wózek (tareLabel:
    H1/ręcznie/korekta) · pojemniki · kg netto**;
  - stopka: **suma kg + suma pojemników** — co do grosza równa liczbie na
    kafelku; pusty stan „Brak ważeń dzisiaj".
- Backend: `GET /deboning/byproducts/today` rozszerzony o
  `weighings: [{ kind, rawBatchNo, weighedAt, tareLabel, containers, netKg }]`
  — rozpakowanie `backs_pallets`/`bones_pallets` (JSONB) z `batch_byproducts`
  filtrowane po `weighedAt::date = dziś` w `Europe/Warsaw`, sortowane po
  `weighedAt`.
- **Dwie naprawy przy okazji (kafelek = modal, zawsze):**
  1. `backsKg`/`bonesKg` w `today` liczone **z palet po ich `weighedAt`**,
     nie z narastającego `backs_kg` po `backs_at` — dziś partia ważona przez
     2 dni wrzuca CAŁĄ frakcję do dnia ostatniego ważenia.
  2. Kafelek przestaje dodawać `shift.totBacks`/`totBones` (per-wpisowe
     `kg_backs`/`kg_bones` — w produkcji zawsze 0, sprawdzone w bazie
     2026-07-18); przy ręcznym zakończeniu partii te same kg wchodzą do
     `batch_byproducts` jako paleta „ręcznie", więc kafelek liczyłby je
     podwójnie. Jedno źródło = `batch_byproducts` (zgodnie z regułą
     „JEDNO źródło na (partia, frakcja)").

## Obsługa błędów

- Race dwóch stanowisk: `FOR UPDATE` na wpisie w `weigh-part` i `complete`;
  drugi zapis na domkniętym wpisie → 409 (jak dziś).
- Błąd `weighPart`/`completeTake` na HMI → toast z komunikatem backendu,
  tryb domykania zostaje (operator ponawia) — wzór istniejący.
- Modal ubocznych czyta dane odświeżane co 5 s (`byprodToday`); przy braku
  danych pusty stan, bez blokady HMI.

## Testy

- **Backend (pytest, baza `kebab_mes_test`, wzór testu undo masowania):**
  - weigh-part: porcja → `meat_stock` rośnie, wpis `pending`, ważenie w tabeli;
  - complete po częściach: `kg_meat` = suma, `yield_pct` z sumy, na magazyn
    weszła tylko ostatnia porcja;
  - walidacje: suma porcji > pobrane → 400; weigh-part na `complete` → 409;
  - storno wpisu z ważeniami → magazyn cofnięty o sumę;
  - edycja pobrania poniżej zważonych → 400;
  - `today`: palety z 2 dni → do dziś liczą się tylko dzisiejsze; suma
    `weighings` = `backsKg`/`bonesKg`.
- **Frontend (vitest):** czysta funkcja decyzji (blokada / pytaj / domknij)
  + format podpisu kafelka „zważono X/Y kg".

## Wdrożenie

Migracja SQL (nowa tabela), backend: cp `app/` + **restart** (nie reload),
przed deployem OBOWIĄZKOWO diff prod↔repo. Kiosk: tag `rozbior-v10-*` z
bumpem wersji w `tauri.rozbior-v10.conf.json` (auto-update z VPS).

## Poza zakresem

- Widok ważeń częściowych w biurze (feed rozbioru) — follow-up.
- Konfigurowalny próg 63% — stała w kodzie.
- Ważenia częściowe dla wpisów „od razu" (bez pobrania) — nie dotyczy.
