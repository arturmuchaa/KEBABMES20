# PROTRIMA — statystyki rozbioru, „Zamknij wszystkie” na kartach, załadunek na żywo na Pulpicie

Data: 2026-11-28 · gałąź `feat/protrima-rozbior-statystyki-20261128` (od prod cd579175, PROTRIMA 0.18.0)

## Po co

Właściciel (28.11):
- „możliwość prawym myszki i zamknij wszystkie karty i zostaje tylko pulpit” (doprecyzowane: zostaje
  **sam Pulpit**).
- „szczegółowe statystyki na temat rozbioru i widzieć, czy ważone było ręcznie czy z wagi … fajne,
  szczegółowe, czytelne statystyki na żywo z rozbioru i z dni archiwalnych”. Dla **biura i szefa**:
  „jaki procent rozbioru, ile pobrano itd.”. Polecenie: „zrób 1 [rozszerzenie sprawdzonego liczenia],
  ale dobrze sprawdź i rozszerz statystyki, aby to było profesjonalnie”.
- „na pulpicie widzieć, jeżeli np. pakują auto — na żywo postęp, klient itp.”

Stan dziś:
- Karty PROTRIMA (`shell/Chrome.tsx` `TabStrip`) zamyka się pojedynczo (X, środkowy przycisk, Ctrl+W).
  Pulpit jest przypięty. Menu kontekstowego nie ma. Karty edycji (nowe/edycja zamówienia, WZ, podział,
  przyjęcia, papiery kursu) **nie pilnują niezapisanych zmian** — zamknięcie je gubi.
- Dział Rozbiór w PROTRIMA (`modules/rozbior`) to tylko korekty wpisów. Menu „Statystyki rozbioru”
  otwiera ten sam ekran. Statystyki są tylko w starym MES (`DeboningReportsPage`, endpoint
  `GET /api/deboning/stats` → `deboning_service.deboning_stats`), który ma już wypracowane i
  udokumentowane w kodzie reguły: dzień = dzień **pobrania** wg Europe/Warsaw, uboczne z palet
  w dniu ważenia palety, jedno źródło na (partia, frakcja) — bez podwójnych kości, tempo na
  osobogodzinę z obsadą stanowiska, odchylenie pracownika od średniej własnej partii, koszt 1 kg mięsa.
- Pulpit ma panel „Kursy po załadunku” (`KursyNiezakonczone`, `GET /api/biuro/kursy-otwarte`):
  pokazuje, co **już stoi** na autach niezamkniętych kursów. Nie pokazuje postępu względem tego,
  co **ma** wjechać.

## Cele

1. Prawy przycisk na karcie → menu: **Zamknij**, **Zamknij pozostałe**, **Zamknij wszystkie**
   (zostaje sam Pulpit). Na Pulpicie menu ma tylko „Zamknij wszystkie”.
2. Dział Rozbiór dostaje zakładki **Statystyki** (domyślna) i **Korekty** (obecny ekran bez zmian).
   Statystyki: dziś na żywo + dowolny dzień / okres z przeszłości, dla biura i szefa.
3. Pulpit: panel **Załadunek na żywo** — każde auto, które się teraz ładuje: klient(ci), zamówienia,
   palety i kg załadowane / do załadowania, od kiedy, ostatnia paleta.

## Nie-cele

- Zmiany na tabletach/HMI hali i w sposobie ważenia.
- Zmiany w płacach (akord) i w starym `DeboningReportsPage` — stary ekran działa jak dziś
  (nowe pola w odpowiedzi są tylko dopisane).
- Raport do druku/eksport (zostaje stary „Raport rozbioru za okres”).
- Pilnowanie niezapisanych zmian w każdym edytorze (osobny temat) — tu tylko ostrzeżenie przy
  zamykaniu hurtem.

## Anty-cele (porażka, nawet jeśli „działa”)

- Liczby w PROTRIMA różne od płac, kafla HMI i starego raportu za ten sam dzień.
- Kilogramy policzone dwa razy (ta sama waga zapisana w dwóch tabelach) albo zgadywanie trybu
  ważenia tam, gdzie go nie zapisano — braki pokazujemy jako „nieznany”, nie jako „z wagi”.
- Wydajność z/s zaniżona przez b/s (b/s ma ~50–55 %, z/s ~60–71 % — średnia mieszana kłamie).
- Jedno kliknięcie „Zamknij wszystkie” gubiące niezapisane zamówienie bez pytania.

## Podejścia (wybrane: 1)

1. **Rozszerzyć sprawdzone `deboning_stats`** o brakujące sekcje (tryb ważenia, z/s vs b/s,
   porównanie z poprzednim okresem, „teraz na hali”, ręczne ważenia, furtki 0099, korekty),
   a w PROTRIMA zbudować nowy ekran na tej odpowiedzi. Liczby z jednego liczenia = zgodność
   z płacami i starym raportem. **Wybrane przez właściciela.**
2. Nowe liczenie od zera pod PROTRIMA — czystsze, ale ryzyko powtórki naprawionych błędów
   (dzień wieczornego wpisu, podwójne kości, tempo) i rozjazdu z płacami. Odrzucone.
3. Osadzić stary ekran w PROTRIMA — sprzeczne z zasadą „moduły przenosimy ulepszone”. Odrzucone.

Załadunek: jedno sensowne podejście — nowy lekki endpoint zbiorczy (jedno zapytanie na
odświeżenie dla wszystkich aut), zamiast odpytywania `vehicle_state` dla każdego auta.

## Projekt

### A. Menu kontekstowe kart

- `onContextMenu` na `.wtab` → małe menu przy kursorze (styl jak inne menu PROTRIMA, klawiatura:
  strzałki/Enter/Esc, zamyka się kliknięciem obok).
- „Zamknij” (nieaktywne na Pulpicie), „Zamknij pozostałe” (zostaje Pulpit + kliknięta),
  „Zamknij wszystkie” (zostaje Pulpit, Pulpit aktywny).
- Jeśli wśród zamykanych są **karty edycji** (kind ≠ `module`/`order`), najpierw okno:
  „Zamknąć też N okien edycji? Niezapisane zmiany w nich przepadną” z listą tytułów →
  [Zamknij wszystkie] [Zostaw okna edycji] [Anuluj]. „Zostaw okna edycji” zamyka resztę.
- Te same polecenia w menu „Okno” paska menu (obok „Zamknij okno”), skrót „Zamknij wszystkie”:
  Ctrl+Shift+W.

### B. Statystyki rozbioru

#### Backend — `deboning_stats` (dopisane klucze, istniejące bez zmian)

Zasada: **każdy kilogram z jednego źródła**, według tych samych reguł co dziś (dzień pobrania,
uboczne w dniu palety, jedno źródło na partię+frakcję). Nowe sekcje:

- `summary.meatByType`: z/s i b/s osobno — kg mięsa, kg ćwiartki, wydajność. Pobranie z porcjami
  obu rodzajów: ćwiartkę dzielimy proporcjonalnie do kg mięsa porcji (rodzaj z porcji, nie z wpisu —
  wpis ma typ ostatniej porcji). `avgYield` zostaje
  (zgodność), ale ekran pokazuje wydajność **z/s** jako główną i b/s obok.
- `weighing` — skąd wzięły się kilogramy, per frakcja (mięso, grzbiety, kości):
  `auto` / `manual` / `unknown` / `office` → liczba ważeń i kg. Źródła (każdy kg raz):
  - mięso — porcje `deboning_take_weighings.weigh_mode` (tu trafia też mięso z rozliczenia
    pracownika; `deboning_settlement_weighings` kind=`meat` to ta sama waga — NIE liczyć drugi raz);
    wpisy „za jednym razem” bez porcji — `deboning_entries.weigh_mode`;
  - grzbiety/kości — wyłącznie palety `batch_byproducts.*_pallets` (tam trafiają też palety
    z rozliczenia pracownika, z `weighingId`; ich tryb brać z `deboning_settlement_weighings`
    po `weighingId`); paleta kreatora `tareLabel = 'ręcznie'` = manual, z tarą = auto;
    pole `*_kg` bez palet = unknown; `byproduct_pallet_checks` (kontrolne przeważenie) — pomijać;
  - **przed 2026-07-07** (commit 61b34120, od kiedy ręczna paleta ma znacznik) palety zbiorcze = unknown;
    `weigh_mode` NULL = unknown (wpis ręczny mógł nie wysyłać trybu) — nigdy nie zgadujemy „z wagi”;
  - `office` = różnica, o którą biuro poprawiło kg wpisu/palety względem zapisanych ważeń
    (korekty `deboning_entry_corrections`, `byproduct_weighing_corrections`) — ze znakiem.
  Dzięki temu suma kg w `weighing` dla frakcji = kg tej frakcji w `summary` (test).
  Pobranie ćwiartki jest **nominalne** (pojemniki × kg), nie ważone — nie wchodzi do tej sekcji
  (ekran mówi to wprost w podpowiedzi).
  **„Z wagi %” = kg auto ÷ (kg auto + manual)**; unknown i office pokazane obok, poza mianownikiem.
- `workers[].manualWeighings`, `workers[].weighings`, `workers[].manualKg` — ręczne u pracownika.
- `manualList`: lista ręcznych ważeń okresu (czas, pracownik lub „partia zbiorczo”, partia,
  frakcja, kg, powód jeśli zapisany), najnowsze pierwsze, limit 200.
- `overrides`: liczba użyć furtki 0099 (z `yield_overrides`) + per pracownik.
- `corrections`: liczba korekt biura w okresie (`deboning_entry_corrections` bez wierszy furtki
  „Ominięcie…”) i usuniętych wpisów — tylko tych ze śladem `changes.usuniety` (wpisy kasuje się
  fizycznie; usunięć bez śladu nie da się policzyć — podpowiedź mówi to wprost).
- `previous`: te same KPI (`kgQuarter`, `kgMeat`, wydajność z/s, `%` grzbietów/kości, ubytek,
  tempo, udział ręcznych) za **poprzedni okres tej samej długości** (dla „Dziś” = ten sam dzień
  tygodnia tydzień temu, **do tej samej godziny** — inaczej rano wszystko byłoby na czerwono;
  porównanie z wczoraj myli przez inny skład zmiany; moja decyzja).
- `live` (tylko gdy okres obejmuje dziś): pobrania w toku (pracownik, partia, kg, od kiedy),
  per pracownik godzina ostatniego ważenia, liczba osób przy stołach w ostatniej godzinie.

Wydajność: odpowiedź za miesiąc musi się liczyć < 1,5 s na kopii prod (zapytania hurtem, bez N+1).

#### PROTRIMA — zakładka „Statystyki”

Okres: **Dziś** (na żywo, odświeżanie co 30 s gdy karta aktywna, znacznik „na żywo · 12:41”),
Wczoraj, 7 dni, Miesiąc, Zakres (dwa pola dat) + strzałki ‹ › dzień/okres wstecz i naprzód.

Układ od góry (najważniejsze dla szefa najwyżej):

1. **Rząd KPI** (każdy z deltą do poprzedniego okresu, zielono/czerwono wg tego, co jest dobre):
   Pobrano ćwiartki (kg, liczba pobrań) · Mięso z/s (kg) i **wydajność z/s %** · Mięso b/s (kg, %) ·
   Grzbiety % · Kości % · Ubytek/nadwyżka (kg, %) · Tempo kg mięsa/osobogodz. ·
   **Z wagi %** (np. „97 % z wagi · 4 ręcznie”, ręczne klikalne → lista).
2. **Bilans masy** — jeden poziomy pasek ćwiartki 100 %: mięso z/s | b/s | grzbiety | kości | ubytek.
3. **Przebieg** — dla dnia: kg mięsa na godzinę (słupki) + linia wydajności; dla okresu: dni.
4. **Pracownicy** — tabela: pobrano kg, pobrań, mięso kg, wydajność %, vs partia (p.p.),
   kg/h, dni, ręczne ważenia (n, wyróżnione gdy > 0), furtki 0099. Sortowanie po kolumnie.
   Klik → rozwinięcie dzień po dniu (z `workerDaily`).
5. **Partie** — dostawca, pobrano, mięso, wydajność, grzbiety %, kości %, ubytek,
   koszt 1 kg mięsa (gdy znana cena). Klik w partię → przejście do Korekt z filtrem partii.
6. **Ważenia ręczne** — lista z `manualList` (pusta: „Wszystko z wagi”).
7. **Na żywo** (tylko dziś) — pobrania w toku i ostatnie wpisy z godziną zważenia.

Brak danych → puste stany po polsku („W tym dniu nie było rozbioru”). Dni sprzed zapisu trybu
ważenia → „tryb nieznany” zamiast procentu z wagi.

Wykresy wg skilla `dataviz` (spójne z resztą PROTRIMA, jasny i ciemny motyw).

### C. Załadunek na żywo (Pulpit)

- Backend: `GET /api/biuro/zaladunek-na-zywo`. „Ładuje się teraz” = auto ma wiersze
  w `vehicle_loading_orders` (przypisane zamówienia; znikają po zamknięciu kursu) **i** albo stoi
  na nim co najmniej jedna paleta/karton z niezamkniętego kursu, albo przypisanie jest z dziś.
  Stare przypisania bez skanu nie trzymają panelu (moja decyzja).
  Na auto: nazwa, rejestracja, start = najwcześniejszy `loaded_at` palet/kartonów na aucie
  (bez skanu: „czeka na pierwszą paletę”), ostatnia paleta, suma.
  Na zamówienie (kolejność `position`): nr, klient (nazwa skrócona), palety/kartony na tym aucie,
  palety wysłane wcześniejszym kursem, wszystkie palety zamówienia; kg analogicznie; status.
  ✓ „komplet” = wszystkie palety zamówienia załadowane lub wysłane (dowolnym autem); pasek auta
  liczy tylko to auto.
  Jedno zapytanie hurtem dla wszystkich aut.
- PROTRIMA: panel „Załadunek na żywo” wysoko na Pulpicie, **chowa się, gdy nic się nie ładuje**.
  Kafel na auto: rejestracja, „ładuje od 10:31 (42 min)”, pasek palet i kg, wiersze zamówień
  z paskami, „ostatnia paleta 11:12”, ✓ przy komplecie; brak ruchu > 30 min → szary dopisek
  „bez ruchu od 11:12”. Klik w zamówienie → karta zamówienia. Odświeżanie co 15 s gdy Pulpit aktywny.
- „Kursy po załadunku” zostaje bez zmian.

## Testy i wydanie

- pytest (osobna baza testowa, nie dwie naraz): zgodność nowych sum z istniejącymi
  (`weighing` = `summary` per frakcja), z/s vs b/s, palety „ręcznie”, `unknown` dla starych,
  poprzedni okres, dzień pobrania wieczorem, załadunek (częściowy, komplet, dwa auta, kartony).
- vitest: menu kart (wszystkie warianty + okno przy kartach edycji), Statystyki (okresy, puste
  stany, odświeżanie tylko gdy aktywna), panel załadunku (chowanie, paski).
- Zrzuty do akceptacji właściciela przed wydaniem (stos jak przy Kontrahentach).
- Wydanie: backend + web na prod przez SSH, PROTRIMA 0.19.0.

## Zostawione wykonawcy

- Dokładne mapowanie, która ścieżka HMI pisze do której tabeli (żeby nic nie liczyć dwa razy) —
  ustalić z kodu i zabezpieczyć testami zgodności sum.
- Wygląd szczegółów (kolory, odstępy) w stylu PROTRIMA; zrzuty rozstrzygają.
