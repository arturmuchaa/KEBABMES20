# PROTRIMA — „Dodaj wyrób gotowy” (ręczne wprowadzenie z biura)

Data: 2026-11-26 · Gałąź: `feat/protrima-wyrob-reczny-20261126` (od `feat/zamowienia-biuro-20261126` = prod a90c22ed)

## Po co

Biuro wpisuje wyrób gotowy z ręki (produkcja nie ma jeszcze paneli). Stare okno
w MES (`src/features/finished-goods/components/AddFinishedGoodModal.tsx`) działa,
ale właściciel zgłosił trzy problemy:

1. Listy klientów nie da się zwinąć — długie przewijanie.
2. Dwa otwarte zamówienia jednego klienta (np. YALCIN) mieszają się w jednej liście.
3. Numer partii jest jeden na całe okno — 80 szt. × 10 kg z 23.11, z czego 30 szt.
   z partii 111 i 50 z partii 112, wymaga dwóch okien.

## Cele

- W PROTRIMA (moduł Wyrób gotowy) okno „Dodaj wyrób” robiące to samo co stare:
  wyrób na magazyn, zdjęcie tulei, zdjęcie mięsa przyprawionego, pokrycie zamówień.
- Drzewo **klient → zamówienie → pozycje**, każdy poziom zwijany osobno.
- **Pozycja rozbijana na kilka partii** w jednym oknie, każda partia z własną liczbą sztuk.
- Sekcja „Ręcznie” — wyrób bez zamówienia (receptura, rodzaj, waga, tuleja, klient opcjonalnie).
- Jeden zapis dla całości (`POST /finished-goods/bulk`, jedna transakcja).
- UX wg standardu PROTRIMA: klawiatura (Enter/Esc, autofocus), czytelne liczby,
  błędy przy polu, puste stany, zrzuty do akceptacji przed wydaniem.

## Poza zakresem

- Zmiany backendu (bulk już przyjmuje partię per pozycja). Jeśli wyjdzie potrzeba — osobno.
- Usuwanie/zmiana starego okna w MES (zostaje bez zmian).
- Druk etykiet Zebra.

## Anty-cele

- Wyrób, który nie łączy się z zamówieniem — dlatego receptura / waga / numer
  zamówienia przy pozycjach z zamówień biorą się z POZYCJI, nie z ręki.
- Pół zapisu przy błędzie.

## Podejścia (wybrane: A)

- **A. Duże okno „Dodaj wyrób” (wybrane przez właściciela).** Po lewej zwijane
  drzewo zamówień, po prawej koszyk z pozycjami rozbijanymi na partie. Spójne z
  innymi oknami PROTRIMA, rozwiązuje wszystkie trzy problemy.
- B. Osobna karta „Przyjęcie produkcji z dnia” jak arkusz — szybka przy masie
  wierszy, ale gorzej widać, co zostało w zamówieniach; nowy wzorzec ekranu.

## Jak (ustalone)

Układ:
```
Dodaj wyrób gotowy                       Data produkcji [23.11.2026]   ✕
┌ Zamówienia ───────────────┐┌ Do zapisu ─────────────────────────────┐
│ [szukaj…]                 ││ YALCIN · 41/11 · KEBAB 10 kg     80 szt│
│ ▾ YALCIN       2 zam.     ││   partia [111] [30] → 231126 111 ✓masow│
│   ▾ 41/11  zostało 800 kg ││   partia [112] [50] → 231126 112 ✓masow│
│     ☑ KEBAB 10 kg  80/80  ││   + partia                 razem 80 ✓  │
│   ▸ 44/11  zostało 300 kg ││ ─────────────────────────────────────  │
│ ▸ BULLI        1 zam.     ││ Ręcznie: + wyrób bez zamówienia        │
│ ▸ Ręcznie (bez zamówienia)││                                        │
└───────────────────────────┘│ 3 partie · 80 szt · 800 kg   [Zapisz]  │
                             └────────────────────────────────────────┘
```

- Zaznaczenie pozycji dodaje ją do koszyka z jednym wierszem partii i liczbą
  sztuk = ile zostało do zrobienia.
- Enter w polu partii/sztuk dodaje następny wiersz partii z resztą sztuk
  (reszta = sztuki pozycji − suma dotychczasowych wierszy). Wiersz można usunąć.
- Data produkcji jedna na okno (cały dzień naraz).
- Numer partii: wpisany np. `111`. Jeśli istnieje wsad masowni o tym numerze →
  `seasonedBatchNos=[111]`, `consumeSeasoned=true`, `batchNo=''` (backend składa
  `ddmmrr 111` z daty produkcji i zdejmuje mięso). W przeciwnym razie →
  `batchNo = normalizeManualBatchNo(wpis, data)`, bez zdejmowania mięsa.
  Pod polem podgląd numeru na wyrobie + znacznik „masownia ✓” / „bez masowni”.
  Podpowiedzi z listy wsadów masowni (`seasonedMeatApi.list`).
- Każdy wiersz partii = jeden element w `createBulk`.
- Po zapisie: odświeżenie stanu i zamówień, toast z podsumowaniem.
- Wejście: przycisk „Dodaj wyrób” w pasku modułu Wyrób gotowy + polecenie w Ctrl+K.

## Zostawione wykonawcy

Nazwy plików/komponentów, dokładne style (wg istniejących dialogów PROTRIMA,
np. `NowyKartonDialog`, `PoprawWyrob`), testy (logika podziału na partie i
budowa payloadu — jednostkowo; okno — test komponentu), wersja PROTRIMA.
