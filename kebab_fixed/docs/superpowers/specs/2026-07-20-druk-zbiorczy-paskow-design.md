# Druk zbiorczy pasków wypłat (4/A4, wielu pracowników naraz)

**Data:** 2026-07-20 · **Status:** zatwierdzony przez użytkownika

## Problem

Paski wypłat drukują się po 4 na A4 (siatka 2×2), ale UI pozwala zaznaczyć
paski tylko **jednego** pracownika (historia rozliczeń wybranego pracownika)
i do tego ze sztucznym limitem 4 zaznaczeń. Przy wypłatach dla ~12 osób
trzeba drukować pracownik-po-pracowniku i ręcznie przekładać kartki.

## Cel

Jeden klik: wybierz N rozliczeń (dowolnych pracowników), system układa
4 paski/A4 (⌈N/4⌉ kartek) i drukuje wszystko w jednym oknie wydruku.

## Zakres

Tylko **druk** już istniejących rozliczeń. Rozliczanie zbiorcze — poza
zakresem (decyzja użytkownika 2026-07-20).

## Rozwiązanie

Wyłącznie frontend, `src/pages/office/PayrollPage.tsx` + nowy moduł
`src/lib/paySlipPrint.ts`. **Zero zmian w backendzie** — `GET
/api/payroll/settlements` bez `workerId` już zwraca rozliczenia wszystkich
(ostatnie 100), a `printPaySlips()` już umie wiele stron.

### 1. Przycisk „Drukuj paski" w nagłówku strony

Widoczny zawsze (bez wybierania pracownika). Otwiera dialog druku zbiorczego.

### 2. Dialog druku zbiorczego

- Zakres dat od/do, domyślnie bieżący tydzień pon–niedz (`getDefaultRange()`).
- Lista rozliczeń wszystkich pracowników, których **okres zahacza o zakres**
  (`date_from ≤ zakres.do && date_to ≥ zakres.od`), sortowana po nazwisku.
- Wszystkie **domyślnie zaznaczone**; link „Zaznacz/Odznacz wszystkich".
- Stopka: licznik „N pasków → M kartek A4" + przycisk **Drukuj**.
- Druk: `Promise.all(getSettlement(id))` (lista zbiorcza nie ma potrąceń)
  → istniejące `printPaySlips(full)`.

### 3. Zdjęcie limitu 4 w historii pojedynczego pracownika

Checkboxy bez `disabled`, druk bez `slice(0, 4)` — druk wielostronicowy
już działa; limit to relikt jednostronicowego wydruku.

### 4. Ekstrakcja logiki do `src/lib/paySlipPrint.ts` (testowalne)

Wzorem `mixingPlanPrint.ts`: czyste funkcje
- `settlementOverlapsRange(s, from, to)` — filtr zakresu,
- `chunkIntoPages(items)` — podział na strony po 4 z dopełnieniem `null`
  (przeniesione z `printPaySlips`),
- `pageCount(n)` — ⌈n/4⌉ (min 1),
- `buildPaySlipsDocument(items)` — całe HTML wydruku (dawne `paySlipHtml`
  + CSS z `PayrollPage.tsx`).

Testy vitest: `src/lib/paySlipPrint.test.ts`.

## Iteracja 2 (2026-07-20): pasek poziomy

Feedback po pierwszym wdrożeniu: „czy możemy zrobić pasek nie w pionie a
w poziomie i bardziej czytelnie". Siatka 2×2 zostaje, zmienia się
orientacja kartki:

- `@page: A4 landscape` → arkusz 297×210 mm, komórka **148,5×105 mm**
  (pasek szeroki zamiast wąskiego i wysokiego).
- Układ paska: nagłówek (nazwisko + rola | okres) nad kreską, poniżej
  dwie kolumny — **dni pracy** po lewej, **rozliczenie** po prawej
  (kg, wynagrodzenie, potrącenia, ramka „Do wypłaty"), podpisy na dole.
- Czytelność: większa typografia (11→12 px baza, nazwisko 19 px, kwota
  netto 21 px), kwoty w formacie pl-PL (`1440,00` / `14 400,00`).
- Kolory (decyzja użytkownika, iteracja 3): potrącenia **czerwone**
  (`#c00000`), kwota do wypłaty **zielona** (`#166534`, tekst + ramka) —
  jak na ekranie. Wymaga `print-color-adjust:exact`, inaczej przeglądarka
  wycina kolory z wydruku.
- Kwoty nigdy nie łamią się do nowej linii: `nowrap` na liczbach +
  `td.r{width:1%}` (kolumna z liczbą kurczy się do treści, więc przy
  ciasnocie łamie się etykieta, nie kwota). Bug zgłoszony z hali:
  „kg zjeżdża na dół" przy długiej etykiecie i 5-cyfrowej wartości.
- Nazwiska i opisy potrąceń **escapowane** (znaki `<`, `&` rozbijały HTML).
- Rozliczenia > 8 dni: lista dni łamie się na dwie kolumny (wtedy data +
  kg, bez kolumny „Zarobek", która by się nie zmieściła czytelnie).

## Odrzucone alternatywy

- **Checkboxy przy pracownikach na liście po lewej** („drukuj ostatni pasek
  każdego") — niejednoznaczne przy >1 rozliczeniu w okresie, miesza
  zaznaczanie z nawigacją.
- **Nowy endpoint zbiorczy z potrąceniami** — optymalizacja zbędna przy
  ~12 wierszach w sieci lokalnej; `Promise.all` po `getSettlement` to
  istniejący wzorzec.

## Obsługa błędów

- Brak rozliczeń w zakresie → komunikat „Brak rozliczeń w wybranym okresie".
- Błąd pobierania szczegółów → toast błędu, bez otwierania okna wydruku.

## Testy

- Unit (vitest): overlap zakresu (brzegi włącznie), chunking 1/4/5/12
  elementów, pageCount.
- Ręczna weryfikacja: wydruk 12 pasków → 3 kartki, okno print otwiera się raz.
