# Rozbiór dwufazowy — pobranie ćwiartki teraz, mięso później

**Data:** 2026-07-08
**Moduł:** rozbiór (deboning), HMI v10 + backend
**Status:** zaakceptowany projekt

## Problem

W hali rozbioru operator fizycznie pobiera ćwiartkę z magazynu, a mięso z niej
kroi dopiero po dłuższym czasie (np. godzinie). Obecny HMI wymusza wpisanie
**ćwiartki i mięsa razem** w jednym atomowym wpisie — nie odpowiada to
rzeczywistemu przepływowi pracy. Operator chce zapisać samo pobranie, odejść
kroić i wrócić później zważyć mięso, a system ma „trzymać w pamięci" co
zostało pobrane.

## Zasada nadrzędna

**Obecny flow zostaje bez zmian.** Zapis „od razu" (ćwiartka + mięso jednym
przyciskiem, z ważeniem auto RS232) działa dokładnie jak dziś. Dwufazowość to
**dodatkowa, równoległa ścieżka**, nie zamiennik.

## Decyzje (ustalone z użytkownikiem)

1. **Relacja:** jedno pobranie → jeden wpis mięsa (1:1). Bez puli/salda.
2. **Trwałość:** pobrania żyją w bazie (przeżywają restart tabletu). Nie tylko
   localStorage.
3. **Surowiec:** ćwiartka schodzi ze stanu partii (`kg_available`) **już przy
   pobraniu** — to prawda fizyczna (ćwiartka opuściła magazyn) i zarazem
   rezerwacja chroniąca przed przebraniem partii przez drugą osobę.
4. **Sanity-check wydajności (30–95%)** obowiązuje przy **domknięciu** mięsem —
   tak samo jak dziś przy zapisie od razu.
5. **Widoczność otwartych pobrań:** na razie **tylko na tablecie** (HMI).
   Monitoring biura — możliwy dodatek w osobnej iteracji.

## Model danych

Rozszerzenie istniejącej tabeli `deboning_entries` (bez nowej tabeli — jeden
wiersz żyje od pobrania do mięsa, dzięki czemu traceability i numeracja
pozostają ciągłe):

```sql
ALTER TABLE deboning_entries
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'complete';
```

- Wartości: `pending` (pobrane, czeka na mięso) oraz `complete` (domknięte).
- **Migracja idempotentna**, domyślnie `complete` → wszystkie istniejące
  wpisy pozostają `complete`, zero regresji dla starych danych i innych
  czytelników.
- Wiersz `pending`: `kg_quarter` wypełnione, `kg_meat = 0`, brak lotu mięsa,
  brak lotów ABP, `session_no` nadany od razu (numeracja ROZ przy pobraniu).

## Rozcięcie logiki serwisu (`deboning_service.py`)

Dzisiejsze `create_deboning_entry` wykonuje atomowo 5 kroków. Dzielimy na dwa
serwisy; istniejący `create_deboning_entry` (ścieżka „od razu") pozostaje
**nietknięty**.

### Faza 1 — `create_deboning_take` (pobranie)

W jednej transakcji:
1. Walidacja sesji (`validate_session_writable`), partii (istnieje, `active`),
   HACCP (`validate_batch_expiry`), dostępności (`kg_taken <= kg_available`).
2. `SELECT ... FOR UPDATE` na wierszu partii (jak dziś — brak przebrania przy
   równoległych pobraniach).
3. Insert wiersza `deboning_entries` ze `status='pending'`, `kg_quarter=kg_taken`,
   `kg_meat=0`, `session_no=next_dated_no('ROZ')`.
4. `UPDATE raw_batches SET kg_available -= kg_taken` + `create_stock_movement`
   OUT (`source_type='deboning'`, `source_id=entry_id`).
5. **Bez** lotu mięsa, **bez** ABP, **bez** sanity-checku wydajności
   (mięsa jeszcze nie ma).

### Faza 2 — `complete_deboning_take` (domknięcie mięsem)

To dokładnie „druga połowa" dzisiejszego create. W jednej transakcji:
1. `SELECT ... FOR UPDATE` wiersza pending; walidacja że `status='pending'`
   i sesja nadal zapisywalna.
2. Ustawienie `kg_meat` (+ audyt wagi: `kg_gross`, `tare_cart_kg`,
   `tare_e2_kg`, `e2_count`, `weigh_mode`; `validate_weighing_consistency`
   dla trybu auto).
3. Sanity-check: `kg_meat > 0`, `kg_meat <= kg_quarter`, wydajność 30–95%
   (blokada — jak przy zapisie od razu).
4. Wyliczenie `kg_remainder`, `yield_pct`; utworzenie lotu `meat_stock`
   (`lot_no = raw_batch_no`) + ruch IN; `create_byproduct_lots_for_entry`.
5. `UPDATE ... SET status='complete'`.

Surowiec **nie** jest ruszany w fazie 2 (zszedł już w fazie 1).

### Storno pobrania (pending)

Rozszerzenie `delete_deboning_entry`: dla wiersza `status='pending'` odwraca
tylko fazę 1 — oddaje `kg_quarter` do partii, kasuje ruch OUT i wiersz. Brak
lotu mięsa i ABP do odwracania. Dla `complete` — zachowanie jak dziś.

## API

| Endpoint | Metoda | Znaczenie |
|---|---|---|
| `/api/deboning/entries` | POST | Zapis od razu (bez zmian) |
| `/api/deboning/takes` | POST | Pobranie (kg_meat niewymagane) |
| `/api/deboning/takes/{id}/complete` | POST | Domknięcie mięsem |
| `/api/deboning/entries/{id}` | DELETE | Storno (obsługuje też pending) |

Model DTO:
- `DeboningTakeCreate` — jak `DeboningEntryCreate`, ale **bez** `kg_meat`
  (wymagane tylko `raw_batch_id`, `kg_taken`/`kg_quarter > 0`).
- `DeboningTakeComplete` — `kg_meat > 0` + pola audytu wagi.

Klient (`src/lib/api.ts` → `deboningEntriesApi`): `createTake(dto)`,
`completeTake(id, dto)`. Mock (`mockApi.ts`) — analogicznie.
Hook `useDeboningEntries`: dodaje `addTake` i `completeTake`
(walidacja przed wysyłką, refetch po sukcesie).

## UX na tablecie (HMI v10)

### Zapis pobrania
Obok głównego przycisku „Zapisz wpis" — drugi przycisk
**„Zapisz pobranie (mięso później)"**. Aktywny gdy: partia + pracownik +
`taken > 0` (mięso nieistotne, waga niepotrzebna). Po zapisie: pola się
czyszczą jak po normalnym zapisie, pobranie pojawia się jako kafelek.

### Kafelki otwartych pobrań
Sekcja **„Czeka na zważenie"** — lista wpisów `status='pending'` bieżącej
sesji. Każdy kafelek pokazuje:
- `pobrano XXX kg` (duża liczba, ćwiartka),
- partia (`internalBatchNo`) + pracownik,
- znacznik „⏳ czeka na mięso".

### Domknięcie po kliknięciu kafelka
Klik w kafelek → formularz wraca do trybu wpisu z **już wypełnioną ćwiartką**:
- partia, pracownik, `kgTaken` — ustawione i **zablokowane** (z pobrania),
- aktywne pole = **mięso**; operator wjeżdża wózkiem na wagę (auto RS232) lub
  wpisuje ręcznie,
- przycisk **„Zapisz mięso"** → `completeTake` domyka wpis (sanity 30–95%).
- Dostępny też storno pobrania (oddaje surowiec).

## Spójność czytelników (MUST — inaczej psują się statystyki)

Wpisy `pending` (`kg_meat=0`) muszą być **wykluczone** z agregatów, aby nie
zaniżały wydajności i kg/h:

- `calcSessionSummary` / podsumowanie sesji — pomija `pending`.
- `deboning_stats` (biuro) — `WHERE status='complete'` (lub filtr w Pythonie).
- Agregaty mięsa / meat_stock — pending nie tworzy lotu, więc naturalnie poza.
- Lista wpisów w HMI: `complete` w normalnej liście „ostatnie wpisy";
  `pending` osobno w sekcji „Czeka na zważenie".

Surowiec (kg_available partii) **jest** już pomniejszony o pending — to
zamierzone (prawda fizyczna), nie błąd.

## Podejście odrzucone

**Osobna tabela `deboning_takes`** konwertowana do `deboning_entries` przy
domknięciu — więcej ruchomych części, rwie ciągłość jednego wiersza (audyt,
numeracja ROZ, storno). Odrzucone na rzecz kolumny `status`.

## Zakres NIE objęty (YAGNI / kolejne iteracje)

- Monitoring otwartych pobrań w biurze (świadomie odłożone).
- Pula/saldo pobrań (odrzucone — model 1:1).
- Automatyczne wygasanie/alarmy starych pobrań.

## Testy

- `deboning_service`: pobranie zdejmuje surowiec i nie tworzy lotu mięsa;
  domknięcie tworzy lot + ABP i ustawia complete; storno pending oddaje
  surowiec; sanity 30–95% blokuje przy domknięciu; podwójne domknięcie
  (drugi complete na tym samym id) odrzucone.
- Czytelniki: `deboning_stats` i `calcSessionSummary` pomijają pending.
- Frontend: przycisk pobrania aktywny bez mięsa; kafelek pokazuje kg;
  klik pre-fill blokuje ćwiartkę i aktywuje mięso.
