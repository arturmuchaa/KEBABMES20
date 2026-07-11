# Plan masowania — czytelniejszy wydruk partii mięsa dla operatora

## Problem

`MixingPlanPrintPage.tsx` (`/office/plan-masowania/druk`) drukuje kartkę dla pracownika mieszania,
który nie ma monitora na hali. W sekcji "Kolejka masowania" partie mięsa jednej pozycji planu są
dziś upakowane w jedną komórkę tabeli jako tekst rozdzielony kropkami:

```
LOT-001 · 200 kg · Udo · Dostawca A    LOT-002 · 150 kg · Udo · Dostawca B
```

Dwa problemy zgłoszone przez użytkownika:
1. Przy pozycji z kilkoma partiami trzeba się wczytać, żeby wyłowić samo kg z ciągu tekstu.
2. Liczba kg (najważniejsza wartość — to, co operator faktycznie odważa) nie wybija się wizualnie
   od numeru partii, rodzaju mięsa i dostawcy — ma taką samą wagę wizualną jak reszta.

## Zakres

Zmiana w 100% frontendowa, jeden plik: `src/pages/office/MixingPlanPrintPage.tsx`.
Wszystkie potrzebne pola (`meatLotNo`, `materialName`, `supplierName`, `kgPlanned`) są już
zwracane przez `mixingOrdersApi.dayPlan()` (patrz `mixing_service.py` linie 124-138) —
**bez zmian backendu**.

## Rozwiązanie

### 1. Jeden wiersz tabeli = jedna partia (nie jedna pozycja planu)

Dziś: 1 pozycja planu (receptura + suma kg) = 1 wiersz, partie sklejone w jednej komórce.

Nowo: tabela "Kolejka masowania" jest flattenowana do listy par `(pozycja, partia)`. Gdy pozycja
ma N partii, generuje N wierszy. Kolumny, które opisują pozycję jako całość — `Lp`, `Receptura`,
`Mięso [kg]` (suma kontrolna), `Status` — używają `rowSpan={N}` na pierwszym wierszu danej
pozycji i nie są renderowane w kolejnych, żeby nie powtarzać tych samych danych N razy.

Pozycja bez żadnej partii (edge case, dziś renderuje pustą komórkę) → jeden wiersz z myślnikami
(`—`) w kolumnach partii, `rowSpan=1`.

Pozycja z 1 partią (najczęstszy przypadek) → wygląda jak dziś, tyle że dane partii są w osobnych
kolumnach z dużym kg, a nie sklejone tekstem. `rowSpan=1` — nie wymaga specjalnego przypadku
w kodzie, to naturalny wynik ogólnej logiki flatten.

### 2. Kolumny nowej tabeli

Kolejność od lewej do prawej:

| Lp | Receptura | Nr partii | **Kg partii** | Rodzaj | Dostawca | Mięso [kg] | Status |
|----|-----------|-----------|----------------|--------|----------|------------|--------|
| scalone | scalone | per wiersz | **per wiersz, wyeksponowane** | per wiersz | per wiersz | scalone (suma) | scalone |

- **Kg partii** — duża, pogrubiona liczba (docelowo ok. 15-16px, vs ~10.5px resztu wiersza).
  To jedyna wartość na wydruku, którą operator musi fizycznie odważyć — ma dominować wizualnie.
- **Mięso [kg]** (suma pozycji) zostaje jako suma kontrolna, stylistycznie jak dotychczas
  (pogrubiona, ale NIE w powiększonej czcionce) — nie może konkurować wizualnie z kg partii,
  bo to liczba do weryfikacji, nie do działania.
- Nr partii / Rodzaj / Dostawca — styl jak dotychczasowy tekst w tabeli (bez zmian wizualnych),
  tylko rozbite na osobne kolumny miast jednego sklejonego stringa.

### 3. Rozgraniczenie pozycji: zebra per pozycja

Ponieważ jedna pozycja może teraz zajmować kilka wierszy, potrzeba wizualnego sygnału gdzie
kończy się jedna pozycja a zaczyna następna — bez tego wielorzędowe pozycje zleją się w jedną
masę. Rozwiązanie: naprzemienne tło (zebra) **per pozycja**, nie per wiersz — wszystkie wiersze
partii jednej pozycji dostają to samo tło (np. jasnoszare / białe), następna pozycja odwrotne.
Implementacja: `positionIndex % 2` decyduje o tle, przypisywane do wszystkich wierszy tej pozycji.

### 4. Zachowanie 1 strony A4

Istniejący komentarz w pliku ustala cel: layout ma zmieścić się na 1 stronie A4 nawet przy
4-5 recepturach. Rozbicie na wiersze per partia + większa czcionka kg zajmie więcej miejsca
w sekcji 1 — użytkownik potwierdził, że priorytetem jest zachowanie 1 strony, nie rozlanie na 2.

Kompensacja: lekka kompresja sekcji 2 (przepisy na wsady 200/600 kg) i sekcji 3 (przyprawy
łącznie) — zmniejszony padding komórek (`S.td`/`S.th`/`S.tdL`/`S.tdR`) i/lub `fontSize` o
ok. 0.5-1px. Czysto kosmetyczna zmiana istniejących stylów w obiekcie `S`, bez zmiany treści
tych sekcji.

### Poza zakresem

- Backend / API — brak zmian, dane już dostępne.
- Sekcja 2 (przepisy na wsady maszyn) i sekcja 3 (przyprawy łącznie) — bez zmian strukturalnych,
  tylko kosmetyczna kompresja stylów opisana w punkcie 4.
- Logika auto-print / `?pdf=1` — bez zmian.

## Ryzyko / kompromisy

- Kompresja stylów w sekcjach 2-3 to szacunek "na oko" — rzeczywiste zmieszczenie na 1 stronie
  zależy od liczby receptur i partii w konkretnym dniu; nie da się tego zagwarantować
  matematycznie bez testowania na rzeczywistych/granicznych planach dnia podczas implementacji.
