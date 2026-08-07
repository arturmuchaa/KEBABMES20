# Pracownicy: archiwizacja, godziny, potrącenia oczekujące, WZ→potrącenie

Data: 2026-08-07

## Problem

Zakładka Pracownicy i ekran Rozliczeń obsługują dziś wyłącznie akord kilogramowy
rozbioru i produkcji. Cztery rzeczy nie mają w systemie ścieżki:

1. **Zwolniony pracownik zostaje na liście na zawsze.** Kolumna `workers.active`
   istnieje i `list_workers()` już po niej filtruje, ale nie ma sposobu, żeby ją
   przestawić z UI. Kasowanie rekordu nie wchodzi w grę — trzyma go
   `deboning_entries`, `payroll_settlements` i traceability.

2. **Pracownicy ogólni nie mają czego rozliczać.** `get_worker_days()` obsługuje
   tylko role zawierające `DEBONING` i `PRODUCTION`; dla `WORKER_GENERAL` zwraca
   pustą listę. Biuro zna ich godziny, ale nie ma gdzie ich wpisać.

3. **Potrącenie da się dopisać wyłącznie w chwili rozliczania.**
   `settlement_deductions` powstaje razem z rozliczeniem. Potrącenie znane
   w poniedziałek trzeba zapamiętać na kartce do piątku.

4. **WZ na pracownika nie zostawia śladu w płacy.** Pracownicy kupują ćwiartkę
   lub mięso na własny użytek; biuro wystawia WZ, żeby zeszło ze stanów.
   Produkcja to potwierdza: `WZ/3/08/26` → „DENYS", 56,00 zł, bez NIP;
   `WZ/50/07/26` → „RAJA", 14,00 zł. Kwota nie trafia nigdzie dalej.

## Ustalenia z rozmowy

- Godziny wpisujemy **tylko pracownikom ogólnym**. Rozbiór i produkcja zostają
  czysto akordowe — pasek wypłaty ma jedną podstawę.
- Forma wpisu: **od–do** (`6:00`–`15:00`), system liczy godziny.
- Dzień bywa **niedokończony**: rano zapisujemy start, koniec dopisujemy po
  południu, a bywa że nadrabiamy dwa dni wstecz. Około 10 osób godzinowych.
- Znaczniki dnia bez pracy: **Wolne / Urlop / Chorobowe / Nieobecność**.
- Potrącenie oczekujące wchodzi do rozliczenia **tylko gdy jego data mieści się
  w zakresie** rozliczenia.
- WZ: automat **wykrywa i pokazuje przełącznik** na formularzu, nie działa po
  cichu.

## Rozwiązanie

### 1. Archiwizacja pracownika

Archiwizacja = `workers.active = false`. Rekord i cała historia zostają.

- `GET /api/workers` **bez zmian** — zwraca tylko aktywnych. Z tej listy żyją
  panele hali i kioski rozbioru (`DeboningHmiV3..V10Page`,
  `ProductionTabletPage`, `EntryFixDialogs`), więc zarchiwizowany znika z hali
  natychmiast i to jest efekt zamierzony.
- Nowy parametr `GET /api/workers?includeInactive=1`, używany wyłącznie przez
  `WorkersPage` i `PayrollPage`.
- Przestawianie flagi idzie istniejącym `PUT /api/workers/{id}` (`WorkerUpdate`
  ma już `active`); `usersApi.update` przyjmuje `active`. Backend bez nowego
  endpointu.
- `WorkersPage`: przełącznik `Aktywni | Archiwum` nad tabelą, w wierszu akcja
  **Archiwizuj** (dialog potwierdzenia z nazwiskiem i zdaniem: „zniknie z paneli
  hali i z list wyboru; wpisy, historia i rozliczenia zostają — możesz przywrócić
  w każdej chwili"), w widoku Archiwum akcja **Przywróć**.
- Kafelki statystyk u góry liczą aktywnych; w widoku Archiwum pokazują
  zarchiwizowanych.
- `PayrollPage` dociąga `includeInactive=1` i renderuje zarchiwizowanych
  w osobnej, zwiniętej grupie **Archiwum**. Bez tego po archiwizacji nie dałoby
  się domknąć ostatniego tygodnia.

### 2. Godziny pracowników ogólnych

#### Dane

Nowa kolumna:

```sql
ALTER TABLE workers ADD COLUMN IF NOT EXISTS rate_per_hour NUMERIC(10,2) DEFAULT 0
```

```sql
CREATE TABLE IF NOT EXISTS worker_hours (
    id          TEXT PRIMARY KEY,
    worker_id   TEXT NOT NULL,
    work_date   DATE NOT NULL,
    status      TEXT NOT NULL DEFAULT 'work',
    -- 'work' | 'off' | 'vacation' | 'sick' | 'absent'
    time_from   TEXT,            -- 'HH:MM'; NULL dla dni bez pracy
    time_to     TEXT,            -- NULL = zmiana otwarta, czeka na domknięcie
    hours       NUMERIC(5,2),    -- NULL dopóki time_to jest NULL
    note        TEXT DEFAULT '',
    created_by  TEXT,
    created_at  TIMESTAMPTZ DEFAULT now(),
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (worker_id, work_date)
);
CREATE INDEX IF NOT EXISTS idx_worker_hours_date ON worker_hours (work_date);
```

Zasady liczenia (`hours` wyliczane po stronie backendu przy zapisie — jedno
miejsce prawdy, front tylko podpowiada):

- `status <> 'work'` → `time_from`, `time_to`, `hours` = NULL. Znacznik nie
  wnosi godzin ani wypłaty; płatny urlop wpisuje się godzinami.
- `status = 'work'` i `time_to IS NULL` → wpis **otwarty**, `hours = NULL`.
- `time_to < time_from` → zmiana przez północ, `hours = (24h − from) + to`.
- `hours` zaokrąglane do 2 miejsc.

**Brak wiersza ≠ wolne.** Brak wiersza znaczy „jeszcze nie wpisane" i to
rozróżnienie jest powodem, dla którego `status` jest osobną kolumną, a nie
wywnioskowaną z pustych godzin.

#### Ekran „Godziny pracy"

Nowa strona `/office/godziny` (`WorkHoursPage`), w menu Administracja między
Pracownikami a Rozliczeniami.

Siatka: wiersze = aktywni `WORKER_GENERAL`, kolumny = Pn–Nd wybranego tygodnia,
strzałki `< >` przeskakują tygodnie. Komórka to dwa pola czasu i pod nimi stan:

```
TYDZIEŃ 3–9.08.2026                    [<]  [>]     [Start 6:00 wszystkim]
                                                    [Koniec 15:00 otwartym]
Pracownik   Poniedziałek   Wtorek        Środa            RAZEM
─────────────────────────────────────────────────────────────────
ADRIAN      6:00–15:00     6:00–[    ]   WOLNE            9,00 h
              9,00 h        otwarty        —
ARAZ        6:00–14:30     URLOP         6:00–15:00      17,50 h
              8,50 h          —            9,00 h
Marcin      [    ]         CHOROBOWE     6:00–15:00       9,00 h
            brak wpisu        —            9,00 h
─────────────────────────────────────────────────────────────────
RAZEM        17,50 h        0,00 h        18,00 h         35,50 h

1 dzień otwarty · 1 dzień bez wpisu
```

(szkic pokazuje trzy dni tygodnia; ekran ma wszystkie siedem)

- **Zapis automatyczny po wyjściu z pola** (blur), jeden `PUT` na komórkę. Wpisany
  sam start zapisuje się od razu i czeka jako otwarty — to jest scenariusz
  „pracownik melduje się o 6:00, koniec znamy dopiero po południu".
- **Stemple zbiorcze** — przy 10 osobach ręczne wpisywanie startu to 10 pól:
  - **Start 6:00 wszystkim** — zakłada otwarty wpis na dziś każdemu, kto nie ma
    jeszcze wiersza. Nie rusza wpisów istniejących ani znaczników.
  - **Koniec 15:00 otwartym** — domyka wszystkie otwarte wpisy dnia.
  - Godzina w obu stemplach jest edytowalna przed użyciem; odstępstwa poprawia
    się pojedynczo w komórkach.
- **Znacznik dnia** wybierany z małego menu w komórce: Wolne, Urlop, Chorobowe,
  Nieobecność, Wyczyść.
- **Licznik braków** w nagłówku (`3 dni otwarte · 1 dzień bez wpisu`) liczony do
  dnia dzisiejszego włącznie — dni przyszłe nie są brakiem. To ściągawka przy
  nadrabianiu po dwóch dniach.
- Dni już rozliczone (`settled_days`) są **read-only** z kłódką.

#### API

```
GET    /api/payroll/hours?dateFrom=&dateTo=          → wiersze wszystkich ogólnych
PUT    /api/payroll/hours                            → upsert jednej komórki
DELETE /api/payroll/hours?workerId=&workDate=        → czyszczenie komórki
POST   /api/payroll/hours/stamp                      → stempel zbiorczy
```

`PUT` body: `{ workerId, workDate, status, timeFrom?, timeTo?, note? }`.
`stamp` body: `{ workDate, mode: 'start'|'end', time }`.

Wszystkie odrzucają zapis na dzień objęty `settled_days` (400 z nazwą dnia).

#### Rozliczenie godzinowe

- Formularz pracownika: dla roli **Ogólny** pole „Stawka akordowa (zł/kg)"
  zamienia się na **„Stawka godzinowa (zł/h)"** (`rate_per_hour`). Pozostałe role
  bez zmian. Zmiana roli nie kasuje `rate_per_kg` (ADRIAN i ARAZ mają dziś
  zostawione 0,55 z czasów rozbioru) — przy podstawie godzinowej po prostu nie
  jest używane.
- `get_worker_days()` dla `WORKER_GENERAL` czyta `worker_hours` i zwraca dni
  w kształcie `{ workDate, hours, timeFrom, timeTo, status, open, settled }`.
  Dni otwarte (`open = true`) i znaczniki (0 h) **nie są zaznaczalne** — dzień
  otwarty wpadłby jako 0 h i pracownik dostałby za mało. Widać je z opisem
  „brak godziny końca".
- `PayrollPage` dla podstawy godzinowej liczy `godziny × rate_per_hour`; reszta
  ekranu (zaznaczanie dni, potrącenia, pasek, historia) bez zmian.
- `payroll_settlements` dostaje `hours_total NUMERIC(10,2) DEFAULT 0`,
  `rate_per_hour NUMERIC(10,2) DEFAULT 0`, `basis TEXT DEFAULT 'kg'`.
  `work_dates_detail` dla podstawy godzinowej trzyma
  `{work_date, hours, time_from, time_to}`.
- `paySlipPrint.ts`: przy `basis = 'hours'` etykieta „Godziny" i wartość
  `44,00 h`, wiersz wynagrodzenia `h × zł/h`. Reszta paska i druk zbiorczy bez
  zmian.
- **Zmiana roli w czasie.** ADRIAN ma dziś rolę `WORKER_GENERAL`, a w bazie 40
  wpisów rozbioru do 23.07 (rozliczonych jako „Rozbiór" do 26.07). Podstawa
  rozliczenia idzie za **bieżącą** rolą, więc gdyby ogólny miał w zakresie
  nierozliczone dni rozbioru, Rozliczenia pokażą bursztynową notkę: „ma N
  nierozliczonych dni rozbioru (X kg) — przestaw rolę na Rozbiór, żeby je
  rozliczyć". Bez mieszania dwóch podstaw na jednym pasku.

### 3. Potrącenia oczekujące

```sql
CREATE TABLE IF NOT EXISTS worker_deductions (
    id             TEXT PRIMARY KEY,
    worker_id      TEXT NOT NULL,
    deduction_date DATE NOT NULL,
    description    TEXT NOT NULL,
    amount         NUMERIC(10,2) NOT NULL,
    source_type    TEXT DEFAULT 'manual',   -- 'manual' | 'wz'
    source_id      TEXT,                    -- wz_documents.id
    status         TEXT DEFAULT 'pending',  -- 'pending' | 'settled' | 'cancelled'
    settlement_id  TEXT,
    created_by     TEXT,
    created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_worker_deductions_worker
    ON worker_deductions (worker_id, status, deduction_date);
```

- Na karcie pracownika w Rozliczeniach przycisk **Dodaj potrącenie** (data +
  opis + kwota), dostępny **zawsze**, nie tylko przy zaznaczonych dniach. To jest
  ten poniedziałkowy wpis, który czeka do rozliczenia.
- Sekcja Potrącenia przy rozliczaniu pokazuje oczekujące z datą **w zakresie**
  `[dateFrom, dateTo]`, domyślnie zaznaczone, każde z datą, opisem i źródłem
  (ręczne / numer WZ). Obok zostają jak dziś puste wiersze na pozycje doraźne.
- Pozycję oczekującą można **usunąć** (`cancelled`) — służy to pomyłkom.
- `CreateSettlementDto` dostaje `deduction_ids: List[str]`. W tej samej
  transakcji `create_settlement`:
  1. sprawdza każdą pozycję: należy do tego pracownika, `status = 'pending'`,
     `deduction_date` w `[date_from, date_to]` (inaczej 400),
  2. przepisuje ją do `settlement_deductions`,
  3. ustawia `status = 'settled'` i `settlement_id`.
  Blokada `SELECT … FOR UPDATE` na pozycjach, żeby dwa równoległe rozliczenia nie
  wzięły tej samej.
- Pasek wypłaty, podgląd i druk zbiorczy **bez zmian** — nadal czytają
  `settlement_deductions`, które pozostaje jedynym źródłem dla dokumentu.
- **Zaległe** (`pending`, `deduction_date < date_from`) nie wchodzą po cichu, ale
  są widoczne jako ostrzeżenie: „Zaległe potrącenia: 2 poz. · 70,00 zł — cofnij
  datę »Od«, żeby je objąć". Reguła zakresu zostaje ścisła, a nic nie ginie.

### 4. WZ na pracownika → potrącenie

#### Dopasowanie

`match_worker_by_name(name, nip)` w `workers_service`:

- działa **tylko przy pustym NIP** (pracownik go nie ma; firma ma),
- porównuje po `trim` + `casefold`, **dokładnie**, po **aktywnych** pracownikach,
- zwraca `None` przy zerze albo więcej niż jednym trafieniu.

Żadnego dopasowania rozmytego: firma o imieniu pracownika nie może wygenerować
potrącenia przez przypadek.

```
GET /api/payroll/match-worker?name=&nip=   → { workerId, name, role } | null
```

#### Formularz WZ

`WzNewPage` odpytuje endpoint (debounce) po zmianie nazwy odbiorcy, gdy NIP jest
pusty. Trafienie pokazuje pasek nad przyciskiem zapisu:

> ☑ Odbiorca to pracownik **VADYM** — dopisz potrącenie [ 56,00 ] zł

- checkbox zaznaczony domyślnie, kwota edytowalna,
- kwota domyślna = wartość dokumentu; przy walucie EUR przeliczona kursem
  zapisanym na dokumencie,
- WZ bez wyceny albo o wartości 0 → pasek pokazuje „WZ bez wyceny — uzupełnij
  ceny, żeby powstało potrącenie", checkbox nieaktywny.

#### Zapis

`wzApi.createManual` dostaje opcjonalne
`payrollDeduction: { workerId, amount }`. `create_manual_wz` w **tej samej
transakcji** co dokument i rozchód wstawia `worker_deductions`:

- `source_type = 'wz'`, `source_id = wz.id`,
- `description = "Zakup — WZ/3/08/26"`,
- `deduction_date = issued_date`,
- `status = 'pending'`.

Rozchód i potrącenie albo powstają oba, albo żadne.

#### Cykl życia

- `cancel_wz`: powiązane potrącenie `pending` → `cancelled`. Jeśli było już
  rozliczone, zostaje nietknięte, a odpowiedź niesie ostrzeżenie „potrącenie
  56,00 zł jest już na pasku — skoryguj ręcznie", które SPA pokazuje toastem.
- `update_wz_prices`: jeśli dokument ma potrącenie w stanie `pending`, jego kwota
  jest aktualizowana (ceny bywają dopisywane po wystawieniu). Potrącenia
  rozliczonego nie rusza.
- WZ wystawiony bez wyceny nie zakłada potrącenia i nie dorabia go później —
  biuro dopisuje je ręcznie na ekranie Rozliczeń.

## Testy

Testy DB backendu na `kebab_mes_test`
(`TEST_DATABASE_URL=postgres:p@localhost:55437/kebab_mes_test` — bez tego testy
DB cicho się pomijają i dają fałszywą zieloną):

- liczenie godzin: pełny dzień, przez północ, wpis otwarty (`hours IS NULL`),
  znacznik (`Wolne` zeruje godziny i czasy),
- stempel zbiorczy: zakłada otwarte tylko tam, gdzie nie ma wiersza; domyka
  tylko otwarte,
- odrzucenie zapisu godzin na dzień rozliczony,
- `get_worker_days` dla `WORKER_GENERAL`: dni otwarte oznaczone `open`,
  znaczniki z 0 h, dni rozliczone z `settled`,
- potrącenia: cykl `pending → settled`, odrzucenie pozycji spoza zakresu dat,
  cudzej i już rozliczonej; kwoty na pasku po rozliczeniu,
- WZ: atomowość WZ + potrącenie (rollback przy braku stanu), anulowanie WZ
  z potrąceniem `pending` i `settled`, aktualizacja kwoty przy zmianie cen,
- archiwizacja: `GET /api/workers` pomija nieaktywnego, `?includeInactive=1` go
  zwraca.

Vitest: `match_worker_by_name` po stronie pomocnika frontowego (normalizacja
nazwy, odrzucenie przy niepustym NIP), wyliczanie godzin w komórce siatki,
licznik „otwarte / bez wpisu".

## Poza zakresem

- **Przerwa w komórce godzin.** `6:00–15:00` = 9 h płatnych; odliczanie przerwy
  wymagałoby trzeciego pola w każdej komórce.
- **Dwie zmiany w jednym dniu** (`UNIQUE (worker_id, work_date)`). Wpis dzielony
  na `7:00–11:00` i `13:00–17:00` nie jest obsługiwany.
- **Godziny dla rozbioru i produkcji** — te role zostają czysto akordowe.
- **Płatny urlop/chorobowe naliczane automatycznie.** Znaczniki liczą 0 h;
  płatną nieobecność wpisuje się godzinami.
