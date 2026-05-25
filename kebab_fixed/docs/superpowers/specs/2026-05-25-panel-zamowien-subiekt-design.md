# Panel dodawania zamówienia — styl listy „Subiekt" (3 warianty do testu)

Data: 2026-05-25

## Problem
W oknie dodawania/edycji zamówienia (`OrderForm` w `ClientOrdersPage.tsx`) pozycje
wprowadza się jako duże kafelki (`Card`) jeden pod drugim — wolno i mało czytelnie.
Widok listy zamówień oraz magazyny są już w stylu Subiekt (gęsta tabela), ale samo
wprowadzanie pozycji odstaje. Cel: szybkie, czytelne wbijanie pozycji.

## Zakres
- Przerobić TYLKO sekcję „Pozycje zamówienia" w `OrderForm`.
- Bez zmian: widok listy, nagłówek formularza (Klient/Data/Termin), walidacja, zapis, sumy.
- Zbudować **3 warianty** wprowadzania i wystawić każdy na osobnej podstronie do testów.
  Po wyborze zwycięzcy — wstawić go do oryginału i usunąć podstrony testowe.

## Warianty
- **A `table`** — zwarta tabela: wiersz = pozycja, nagłówek raz, inputy/selecty h-8, stopka z sumą i „+ pozycja".
- **B `keyboard`** — jak A + obsługa klawiatury: Tab/Enter między polami, Enter na ostatnim polu dodaje nowy wiersz i ustawia fokus; typeahead w Select (wbudowany w Radix).
- **C `quickadd`** — pasek dodawania u góry (wypełnij → Enter dodaje na listę), poniżej zwarta lista dodanych pozycji z usuwaniem.

## Architektura
Nowy katalog `src/features/orders/order-form/`:
- `types.ts` — `LineForm`, `emptyLine`, `OrderLineVariant`, `LinesEditorProps`, helpery `lineKg`, `filterRecipesFor`, lekkie typy słowników.
- `OrderLinesCards.tsx` — obecny układ kart (wariant bazowy, fallback).
- `OrderLinesTable.tsx` — wariant A.
- `OrderLinesKeyboard.tsx` — wariant B.
- `OrderLinesQuickAdd.tsx` — wariant C.
- `LinesEditor.tsx` — dispatcher: po `variant` renderuje odpowiedni komponent.

`OrderForm` pozostaje wspólnym kontenerem (stan pozycji, słowniki, sumy, `handleSave`,
nagłówek, uwagi, stopka) i renderuje `<LinesEditor variant=… {...lineProps} />`.
Props pozycji: `{ lines, setLine, setLines, addLine, removeLine, productTypes, recipes, packaging }`.

`ClientOrdersPage` dostaje opcjonalny prop `variant` (domyślnie `cards`) i przekazuje go
do `OrderForm` w obu oknach (nowe/edycja).

## Routing i menu
`App.tsx` — 3 nowe routy renderujące `<ClientOrdersPage variant=…/>`:
- `/office/zamowienia-test-a` → `table`
- `/office/zamowienia-test-b` → `keyboard`
- `/office/zamowienia-test-c` → `quickadd`

`OfficeSidebar.tsx` — tymczasowa sekcja „Zamówienia — TEST" z 3 linkami.
`/office/zamowienia` pozostaje nietknięte.

## Kryteria sukcesu
- Każdy wariant zapisuje zamówienie identycznie jak oryginał (ten sam DTO, walidacja, sumy).
- Build przechodzi; popovery list rozwijanych działają (po wcześniejszym fixie zoomu).
- Użytkownik może przeklikać 3 podstrony i wskazać najlepszą.

## Poza zakresem (YAGNI)
- Brak nowych zależności (custom combobox); typeahead = wbudowany Radix Select.
- Brak zmian w backendzie i modelu danych.
- Sprzątanie wariantów-przegranych dopiero po decyzji użytkownika.
