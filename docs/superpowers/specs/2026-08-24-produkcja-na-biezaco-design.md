# Produkcja na bieżąco — materiały, korekty, skan, płaca

Rozszerzenie stanowiska produkcyjnego (`produkcja-1.0.0`) o pięć rzeczy, które
zgłosiła hala 24.08.2026 wieczorem. Wszystkie mają jeden wspólny mianownik:
**zdarzenia mają być księgowane wtedy, kiedy zachodzą fizycznie**, a nie
zbiorczo przy potwierdzeniu biura.

## Stan dzisiejszy (zweryfikowany w kodzie)

| Zdarzenie | Kiedy trafia do systemu |
|---|---|
| Sztuki policzone przez operatora | od razu (`update_line_progress`) |
| **Tuleje** | dopiero `office-confirm` → `finish_day` → `_consume_packaging` |
| **Wyrób gotowy** | dopiero `office-confirm` |
| Folia stretch | od razu przy pobraniu (wdrożone dziś) |
| Skan QR sztuki | `scan_produced` przestawia `planned → produced`, **stanu NIE rusza** |

## Błąd w płacach — do naprawy przy okazji

`workers_service.get_worker_days` dla roli `*PRODUCTION*`:

```sql
SELECT SUM(total_kg) FROM finished_goods_sessions
WHERE %s = ANY(worker_names) ...
```

`total_kg` to kilogramy CAŁEJ pozycji, a warunek sprawdza tylko obecność
nazwiska w tablicy. **Trzy osoby przy pozycji 700 kg dają 3 × 700 kg do wypłaty.**

Sprawdzone na produkcji 24.08.2026: **błąd jeszcze nie wypalił** — wszystkie 43
sesje z nazwiskiem mają dokładnie jedną osobę, a rozliczeń produkcji jest zero.
Zapali się przy pierwszej pozycji robionej przez dwie osoby, czyli dokładnie
w scenariuszu, pod który powstało nowe stanowisko. Rozbiór tego nie ma — tam
`deboning_entries` trzyma `worker_id` per wpis.

Stanowisko produkcyjne zapisuje `workerEntries` ze sztukami per osoba, więc
kilogramy da się policzyć dokładnie: `Σ pieces × kg_per_unit`.

## 1. Tuleje schodzą na bieżąco

Zdejmowane przy KAŻDYM zapisie sztuk, proporcjonalnie do przyrostu
(1 sztuka = 1 tuleja). Korekta w dół oddaje tuleje na magazyn.

**Warunek konieczny: `finish_day` nie może zdjąć ich drugi raz.** Linia planu
dostaje licznik `packaging_used`; `finish_day` konsumuje wyłącznie resztę
(`qty − packaging_used`), więc dni sprzed zmiany i dni bez kiosku działają
dalej tak samo.

**Brak tulei na stanie NIE blokuje zapisu sztuk.** Hala zapisuje pracę, która
fizycznie się wydarzyła; blokowanie jej z powodu nieaktualnego stanu w biurze
kończy się omijaniem systemu. Zdejmujemy tyle, ile jest, resztę dobiera
`finish_day` — i dopiero tam biuro zobaczy, że musi przyjąć tuleje.

## 2. Przeniesienie sztuk między pracownikami

Pomyłka operatora („kliknął na złą osobę") ma się dać poprawić **także po
zamknięciu pozycji**, dopóki biuro nie potwierdziło dnia.

- Ekran pozycji dostaje panel „Popraw wpisy": lista osób z `−`/`+`.
- **Suma sztuk pozycji się NIE zmienia** — przenosimy między ludźmi, nie
  dopisujemy produkcji. Dzięki temu stan tulei i wyrobu gotowego zostaje
  nietknięty, a poprawka dotyczy wyłącznie tego, komu należy się wypłata.
- Ślad: każda korekta zapisuje kto/kiedy/z kogo na kogo.

## 3. Zmiana tulei z poziomu hali

Operator dotyka tulei w wierszu planu i wybiera inną z listy
(np. `METAL 65` → `KARTON 65`).

Jeśli część tulei już zeszła ze stanu, zamiana **oddaje stare i pobiera nowe**
w jednej transakcji. Bez tego zmiana rodzaju tulei po 10 sztukach zostawiałaby
10 metalowych zdjętych z magazynu na zawsze.

## 4. Skan QR → wyrób gotowy na magazyn

Podsystem sztuk JUŻ ISTNIEJE: `finished_units` (QR = id sztuki), generowanie
z linii planu, druk etykiet, `scan_produced`, ekran mobilny. Brakuje jednego
ogniwa — skan nie tworzy stanu magazynowego.

**Model docelowy — dwa różne zdarzenia, nie jedno:**

| | Co znaczy | Co uruchamia |
|---|---|---|
| Licznik `−/+` | „tyle pracy zrobiono" | postęp planu, tempo, tuleje, **płaca** |
| Skan QR | „ta konkretna sztuka istnieje i jest gotowa" | **wejście na magazyn wyrobu gotowego** |

`scan_produced` dopisuje kilogramy tej sztuki do wiersza `finished_goods`
(albo go tworzy) i wystawia ruch `IN`. Skan jest **idempotentny** — powtórka
daje 409 i nie dubluje stanu, tak jak dziś.

**Żeby nie było podwójnego wejścia:** `finish_day` przy potwierdzeniu biura
tworzy wyrób gotowy **tylko dla sztuk NIEzeskanowanych** (`qty − zeskanowane`).
Dzień w pełni zeskanowany zamyka się bez tworzenia czegokolwiek; dzień bez
skanera działa dokładnie jak dziś. To jedyny wariant, w którym oba tryby mogą
istnieć obok siebie.

**Warunek wstępny:** sztuki muszą być wygenerowane dla linii planu
(`generate_units_from_plan_line`) i etykiety wydrukowane — inaczej nie ma
czego skanować. Kiosk pokazuje to wprost, zamiast milczeć.

## 5. Płaca z faktycznych kilogramów pracownika

Źródłem dla roli produkcyjnej przestaje być `finished_goods_sessions`
(nazwisko w tablicy), a zaczyna być rozbicie per osoba z pozycji planu:

```
kg pracownika w dniu = Σ (sztuki tej osoby × kg_per_unit pozycji)   ← układanie
                     + kg zapisane w production_wrapping             ← foliowanie
```

To ta sama zasada co na rozbiorze (`deboning_entries.worker_id`), więc
`_apply_kg_adjustments`, `settled_days` i rozliczenia działają bez zmian.

Dni sprzed wdrożenia HMI nie mają rozbicia per osoba — dla nich zostaje stare
źródło, żeby historia rozliczeń się nie zmieniła.

## 6. Foliowczycy — kilogramy zafoliowane

Przy linii stoi ~10 osób układających kebaby i **2 foliowczyków**. Ich pracy nie
da się policzyć sztukami z licznika — foliują to, co zrobiła cała linia — więc
zapisujemy im kilogramy wprost.

**Gdzie:** dolny pasek stanowiska, dokładnie jak w rozbiorze (76 px, `--barBg`,
kafle z liczbą i podpisem, część klikalna). Kafel **„Foliowanie · X kg ▸"**
otwiera okno zapisu. Pasek jest widoczny cały dzień, więc zapis nie jest
przywiązany do zamykania dnia — foliowczyk, który kończy wcześniej, dostaje
swoje kilogramy od razu.

**Okno zapisu:**
- lista foliowczyków (zaznaczani z operatorów działu),
- przycisk **„Podziel po równo"** — dzieli kilogramy dnia przez liczbę
  zaznaczonych (2 → po 50%, 3 → po 33,3%), reszta z zaokrąglenia idzie do
  pierwszego, żeby suma zgadzała się co do kilograma,
- **ręczne wpisanie kilogramów z klawiaturą numeryczną** — tu klawiatura jest
  właściwa, inaczej niż przy liczniku sztuk: to wpis raz na dzień, nie ruch
  wykonywany w rękawicy co chwilę.

**Zapis:** tabela `production_wrapping` (dzień, pracownik, kg, kto wpisał).
Ponowny zapis dla tej samej osoby i dnia **nadpisuje** — poprawka ma być
poprawką, nie drugim wpisem.

Kilogramy foliowania wchodzą do płacy tak samo jak układanie: `kg × stawka`.
Osoba, która robiła jedno i drugie, dostaje sumę.

## Co weszło (25.08.2026)

Wszystkie sześć punktów zrobione i przetestowane (backend 1266, frontend 1448).

| Punkt | Backend | Ekran |
|---|---|---|
| 1. Tuleje na bieżąco | `line_packaging_service.sync_line_packaging` w transakcji `update_line_progress`; licznik `production_plan_lines.packaging_used`; `finish_day` bierze resztę | — |
| 2. Przeniesienie sztuk | `production_plans_service.move_line_pieces` + ślad `production_worker_moves`; blokada po `office_confirmed_at` | chip osoby w `LineCounter` → `MovePiecesModal` |
| 3. Zmiana tulei | `line_packaging_service.change_line_packaging` (oddaje stare, bierze nowe) | dotknięcie kolumny TULEJE → `PackagingPicker` |
| 4. Skan QR → magazyn | `unit_stock_service.book_scanned_unit` w `scan_produced`; `stock_booked_at` na sztuce; `finish_day` dopisuje resztę **per partia** | kafel „Skanowanie" → `ScanPanel` |
| 5. Płaca z kg pracownika | `workers_service` liczy z `worker_entries` × `kg_per_unit` + `production_wrapping` | — |
| 6. Foliowczycy | `production_wrapping_service` | kafel „Foliowanie" → `WrappingModal` |

Przy okazji naprawione dwie rzeczy zastane:

* **Kiosk produkcji nie miał uprawnień do niczego.** `/api/production-plans`
  wpadało w domyślne „office", więc operator działu `produkcja` nie zapisałby
  ani jednej sztuki. Teraz odczyt planu, postęp, tuleje, przeniesienie sztuk
  i zamknięcie zmiany to `produkcja`; układanie planu i potwierdzenie dnia
  zostają w biurze.
* **Martwa reguła `/api/finished_units`** (podkreślenie zamiast myślnika)
  nigdy nie pasowała do trasy `/api/finished-units` — cały podsystem sztuk
  wymagał konta biura. Teraz `produkcja|pakowanie`, a generowanie sztuk
  i etykiet zostaje w biurze.

## Czego NIE robimy

- Nie zmieniamy moment potwierdzenia biura — plan dalej zamyka biuro.
- Nie ruszamy pakowania w kartony (osobny podsystem, działa).
- Nie przenosimy zdejmowania tulei na planowanie — plan rezerwuje mięso,
  nie materiały pomocnicze.
