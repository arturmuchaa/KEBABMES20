# Plan produkcji jako terminal dnia

Data: 2026-08-24
Status: zatwierdzony do wdrożenia

## Po co to robimy

Planowanie produkcji **odbiło**. W całej bazie produkcyjnej są dwa plany —
13 i 14 sierpnia 2026 — oba zamknięte, razem 21 pozycji, i jedno zamówienie
klienta w historii. Dla porównania masowanie żyje: 45 partii przyprawionego
w lipcu i sierpniu, 38,6 t. Biuro planuje produkcję poza systemem, bo ekran
planowania jest wolniejszy niż kartka.

Nie naprawiamy więc ekranu, do którego ktoś się przyzwyczaił. Przerabiamy
ekran, którego nikt nie chce używać, i mamy przy tym swobodę — ale też brak
danych o tym, jak wygląda dzień. Kierunek ustalony z właścicielem:

- plan dnia powstaje **po połowie** z zamówień klientów i z decyzji szefa,
  więc oba wejścia muszą być wygodne;
- partie przyprawionego **proponuje FEFO**, a biuro zatwierdza albo nadpisuje.

Wzorem jest terminal wprowadzania zamówień (`features/orders/order-entry`),
który przeszedł tę samą drogę: z formularza na klikanie myszką zrobiono ekran
pod klawiaturę i zaczął być używany.

## Czego ta zmiana NIE dotyka

Granice są tu ważniejsze niż zakres, bo pod spodem leży logika kupiona awariami.

- **Backend bez zmian.** DTO, `productionPlansApi`, `_compute_allocation`,
  `_check_plan_shortfalls` — nietknięte.
- **Matematyka przydziału bez zmian.** `planMeatAllocation.ts` jest lustrem
  backendu i ma komplet testów. `JOIN_LEFTOVER_PIECES` MUSI zostać zgodne
  z backendowym `MIXED_PIECE_NUMBERING`; nie ruszamy ani jednego, ani drugiego.
- **Bez zmian:** `planOwnReservations.ts` (własne rezerwacje planu przy
  edycji), `officeFinish.ts`, `remainderSplit.ts`, `productionCard.ts`,
  druk karty produkcji, zakładki historii i „wykonane".

Przebudowujemy **wyłącznie warstwę prezentacji** planu.

## Stan dzisiejszy

`pages/office/ProductionPlanningPage.tsx` — 2123 linie, osiem komponentów
w jednym pliku: `MeatStockOverview`, `ImportOrderModal`, `MeatPanel`,
`DoneQtyInput`, `PlanLineQuickAdd`, `LineFormRow`, `PlanForm`,
`ProductionPlanningPage`. Sam rozmiar pliku jest częścią problemu: nie da się
zmienić układu pozycji bez czytania obsługi zamówień i druku etykiet.

Pozycja planu (`PlanLineForm`) niesie: `qty`, `kgPerUnit`, `productTypeId`,
`recipeId`, `packagingId`, `clientId`/`clientName`, `seasonedBatchIds[]`
(kolejność ma znaczenie — przydział idzie partia po partii),
`clientOrderId`/`clientOrderLineId`.

### Wada do naprawienia po drodze

`LineFormRow` woła `allocatePlanMeat(lines, seasonedRaw)` **osobno dla każdego
wiersza** (linia 851), choć `PlanForm` policzył już `planAlloc` dla całego
formularza. Przy dziesięciu pozycjach to dziesięć pełnych przebiegów alokacji
na każdy render. Nowy układ przekazuje `planAlloc.lines[idx]` w dół.

## Docelowy ekran

```
PLAN PRODUKCJI . sroda 26.08.2026        [Wciagnij z zamowien 3]  [Zapisz]
+-- WSAD (pozycja 3) ----------------------------------------------------+
| [RODZAJ][RECEPTURA][TULEJA][KLIENT]  |  [SZTUK] x [WAGA] = [RAZEM]     |
+-- POZYCJE -----------------------------+-- PARTIE PRZYPRAWIONEGO ------+
| Lp Ilosc   Rodzaj Receptura Klient  Partie |  WROCLAW    2160 kg wolne |
|  1 20x35   Kebab  WROCLAW   Bulli   495    |   495 22.08 2160 -> poz.1 |
|  2 12x8,5  Kebab  BULLI     --      496    |   496 22.08  864 -> poz.3 |
|                                   -------- |  BULLI      1220 kg wolne |
|                                     802 kg |   496 22.08 1220          |
+--------------------------------------------+  [Przelicz FEFO od nowa]  |
```

**Kolumny pozycji:** Lp · Ilość (`20×35`) · Rodzaj · Receptura · Klient ·
Partie · Razem · akcje. Stałe szerokości, nagłówek wyrównany z wierszami —
tak jak zrobiliśmy to na liście pozycji zamówienia.

**Panel partii** (prawa kolumna): grupy per receptura. Nagłówek grupy pokazuje
wolne kg kontra potrzebne przez plan, więc brak widać przy wpisywaniu, a nie
dopiero przy zapisie. W grupie wiersz partii: numer, data produkcji, **żywe**
wolne kg (`planAlloc.freeByBatch`) i adnotacja `→ poz. 1, 3`, gdy plan ją
zajmuje. Receptury komponentowe (70/30) zostają poza panelem — ich partie
dobiera backend per komponent, dokładnie jak dziś.

**Kilogramy** formatujemy `fmtKgTrim` — `700 kg`, nie `700,0 kg`.

## FEFO: propozycja, nie wyrok

- Zmiana pozycji przelicza jej partie automatycznie, FEFO, najstarsze pierwsze
  (`fefoLotCompare`).
- Ręczne ruszenie partii w pozycji ustawia na niej `batchesManual: true`
  i automat **przestaje ją nadpisywać**. Bez tego znacznika każda ręczna
  decyzja ginęłaby przy następnym wpisanym kilogramie.
- „Przelicz FEFO od nowa" czyści znaczniki i rozdaje wszystko od zera.
- Pozycje rozpoczęte (`qtyDone > 0`) są **zamrożone** — ich alokacji nie wolno
  przeliczać (ustalenie z elastycznego planu produkcji). Automat je omija,
  a panel partii pokazuje je jako zajęte na stałe.
- Kolejność zaznaczenia trzymamy przez `toggleBatchSelection` w porządku FEFO:
  odznaczenie i ponowne zaznaczenie musi wrócić do tego samego stanu, inaczej
  pozycja podbiera mięso sąsiedniej.

## Dwa wejścia

**Z ręki** — pasek wsadu pod klawiaturę: Rodzaj → Receptura → Tuleja → Klient
→ Sztuk × Waga. `⏎` dopisuje pozycję, tożsamość (rodzaj/receptura/tuleja)
dziedziczy się do następnej, czyszczą się tylko liczby — ten sam kontrakt co
w zamówieniach.

**Z zamówień** — przycisk `Wciągnij z zamówień (N)` otwiera panel boczny
z niezrealizowanymi pozycjami zamówień potwierdzonych. Licznik pokazuje się
tylko, gdy `N > 0`; w dni bez zamówień panel nie zabiera miejsca. Wciągnięta
pozycja zachowuje `clientOrderId` i `clientOrderLineId`, żeby zamówienie dało
się później rozliczyć.

## Jeden plan na dzień

Dziś to wyłącznie ostrzeżenie przy zapisie (`existingPlans`, linia 1360) —
drugi plan na ten sam dzień da się zrobić i dopiero zapis protestuje. Zmiana:
wybór daty u góry **wczytuje istniejący plan tego dnia do edycji** albo
otwiera pusty. Duplikat przestaje być możliwy zamiast być wyłapywany.

## Podział na pliki

`features/production-plan/`:

| Plik | Odpowiedzialność |
|---|---|
| `usePlanDraft.ts` | stan szkicu: linie, data, `planAlloc`, `demandByRecipe`, `meatFreeByRecipe`, auto-FEFO, znaczniki ręczne |
| `components/PlanTerminal.tsx` | pasek wsadu |
| `components/PlanLinesTable.tsx` | pozycje w stałych kolumnach |
| `components/BatchPanel.tsx` | panel partii |
| `components/PullFromOrders.tsx` | panel boczny zamówień (z `ImportOrderModal`) |
| `PlanEditor.tsx` | kompozycja ekranu |

`ProductionPlanningPage.tsx` zostaje jako przegląd planów i chudnie o to, co
wyprowadzone.

Pola terminala (`FieldShell`, `ComboField`, `NumberField`) przenosimy
z `features/orders/order-entry/fields.tsx` do `components/terminal/`: od tej
zmiany używają ich dwa ekrany i mają pozostać jednym idiomem. Przeniesienie
dotyka działającego ekranu zamówień — jego 48 testów musi zostać zielonych,
inaczej cofamy przeniesienie i zostawiamy kopię.

## Testy

Matematyki nie testujemy ponownie — jest pokryta. Nowe testy dotyczą tego,
czego dziś nie ma:

- `usePlanDraft` — FEFO proponuje przy zmianie pozycji; ręczna decyzja
  przeżywa przeliczenie sąsiedniej pozycji; „przelicz od nowa" czyści
  znaczniki; pozycja rozpoczęta zostaje nietknięta.
- `PlanLinesTable` — kolumny i ich wyrównanie z nagłówkiem; partie w swojej
  kolumnie; pozycja bez partii nie udaje przypisanej.
- `BatchPanel` — żywe wolne kg schodzą przy wpisywaniu pozycji i wracają po
  jej usunięciu; adnotacja `→ poz. N`; brak mięsa widać przed zapisem.
- `PlanTerminal` — dziedziczenie tożsamości, `⏎` dodaje pozycję, lista wyboru
  rozwija się na żądanie (kontrakt przeniesionych pól).

## Ryzyka

1. **Przeniesienie pól terminala** dotyka ekranu, który działa i jest używany.
   Mitygacja: pełny zestaw testów zamówień po przeniesieniu; przy czerwonym —
   zostawiamy pola na miejscu i importujemy je do planu.
2. **Wiedza ukryta w komentarzach `PlanForm`** (własne rezerwacje przy edycji,
   komponenty 70/30, zamrożone pozycje, kolejność FEFO). Przenosimy 1:1 razem
   z komentarzami — to nie są ozdobniki, tylko zapis awarii.
3. **Moduł jest nieużywany**, więc nie ma ruchu produkcyjnego, który wyłapie
   regresję. Dlatego testy komponentów są tu obowiązkowe, a nie opcjonalne.

## Sprawdzian gotowości

Plan dnia na 10 pozycji — tyle mają dzisiejsze plany — daje się wbić
z klawiatury, bez sięgania po mysz, a przez cały czas widać, która partia
gdzie poszła i czy mięsa starczy.
