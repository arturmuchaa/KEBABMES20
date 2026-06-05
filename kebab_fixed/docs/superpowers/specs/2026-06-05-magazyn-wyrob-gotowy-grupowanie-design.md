# Magazyn wyrobu gotowego — widok połączony + rozbicie partii (projekt)

**Data:** 2026-06-05
**Status:** zaakceptowany kierunek, do przeglądu specu
**Cel:** Lista magazynu łączy partie w jeden czytelny wiersz na produkt (koniec
„śmiecenia"), a pełne rozbicie „ile sztuk z jakiej partii" + czysty łańcuch
traceability pokazuje się dopiero w podglądzie.

## Kontekst / dane (bez zmian backendu)

Po naprawie `finish_day` ([[kebab-traceability-partie]]) każdy wiersz
`finished_goods` to JEDNA partia kebaba (`batch_no` w formacie `ddmmrr nr`, np.
`060626 347`) z poprawną ilością i genealogią. API `finishedGoodsApi.list()`
zwraca te wiersze per partia; `traceabilityApi.backward(id)` zwraca łańcuch dla
danej partii. Grupowanie i rozbicie liczymy **na froncie** z już pobranych
danych — **żadnych zmian w backendzie ani API**.

`FinishedGoodsItem` ma m.in.: `id`, `batchNo`, `qty`/`qtyAvailable`, `kgPerUnit`,
`totalKg`, `productTypeName`, `recipeName`, `packagingName`, `clientName`,
`producedDate`, `producedBy[]`, `subEntries?`.

## 1. Lista magazynu — grupowanie po SKU

Wiersze grupowane po kluczu **SKU** =
`productTypeName | recipeName | packagingName | clientName | kgPerUnit`.
Wszystkie partie i daty danego SKU sumują się w jeden wiersz.

- Kolumny: **Ilość (suma szt)**, **kg (kg/szt)**, **Rodzaj**, **Receptura**,
  **Tuleja**, **Klient**, **Razem kg (suma)**. **Kolumna „Partia" USUNIĘTA.**
- `qty` grupy = Σ `qtyAvailable` partii; `totalKg` grupy = Σ `qtyAvailable *
  kgPerUnit`.
- Filtr: po rodzaju/recepturze/tulei/kliencie/kg (bez nr partii).
- Sort: po tych polach + ilości/razem-kg (jak teraz, minus `batchNo`).
- KPI „Pozycji" liczy GRUPY (nie pojedyncze partie); „Szt"/„Kg" = sumy.
- Klik wiersza → podgląd z CAŁĄ grupą (lista partii tej grupy).

Struktura grupy (front): `{ key, productTypeName, recipeName, packagingName,
clientName, kgPerUnit, qty, totalKg, batches: FinishedGoodsItem[] }`.

## 2. Podgląd — rozbicie wg partii

`DetailModal` przyjmuje teraz **grupę** (SKU + `batches[]`) zamiast jednej partii.

- **Nagłówek**: „{Rodzaj} · {Klient} · {kg}KG" + „{Σszt} szt · {Σkg} kg".
  Drobne pola: Receptura, Tuleja. (BEZ zakresu dat.)
- **„Skład wg partii"**: lista `batches` w naturalnej kolejności (jak zwraca
  API). Każdy rząd: **pełny numer `ddmmrr partia`** (mono, wyróżniony) +
  „{szt} szt · {kg} kg" + data produkcji. Rząd **rozwijalny** (akordeon).
- Rozwinięcie partii → **`LineageChain` dla `batch.id`** (istniejący, 4‑krokowy:
  Surowiec → Rozbiór → Masowanie → Wyrób gotowy; partia na każdym kroku).
- Sekcja „Pracownicy" = suma `producedBy` z partii grupy (unikalne).

## 3. Łańcuch — czytelność (koniec z 347/350/347)

Rozbicie per partia wyrobu sprawia, że łańcuch każdej partii jest naturalnie
czysty (jedna partia → jedno źródło). Dodatkowo w `LineageChain`:
- na kroku „Masowanie" wsady **odduplikowane** (unikalne `batch_no`) i
  **posortowane** rosnąco — żeby przy ewentualnej partii łączonej (PP) nie było
  powtórek ani chaotycznej kolejności.
- analogicznie dedup na „Surowiec" i „Rozbiór" (po kluczu wyświetlanym).

## 4. Komponenty / pliki

- `src/pages/office/FinishedGoodsPage.tsx`: dodać grupowanie po SKU (useMemo),
  usunąć kolumnę/sort `batchNo`, przeliczać sumy i KPI per grupa, renderować
  wiersze grup, otwierać podgląd z grupą. Filtr/sort dostosować do pól SKU.
- `src/features/finished-goods/components/DetailModal.tsx`: props
  `group` (zamiast `item`); nagłówek SKU + zakres dat; akordeon „Skład wg partii"
  (stan rozwinięcia per partia); render `LineageChain` per partia. Dedup/sort
  wsadów w `LineageChain`.
- Bez zmian w backendzie / `lib/api`.

## 5. Jakość / testy

Brak frontowego test‑runnera → weryfikacja **wizualna** (Playwright/zrzuty):
(a) lista pokazuje jeden wiersz na produkt (partie połączone, brak kol. Partia);
(b) podgląd pokazuje rozbicie „X szt · ddmmrr 347, Y szt · ddmmrr 350" sort. malejąco;
(c) rozwinięcie partii → czysty łańcuch bez duplikatów. Implementacja z użyciem
skilla **frontend-design** (czysta, czytelna estetyka, spójna z systemem).

## Decyzje (potwierdzone)

- Grupowanie listy: po SKU, łączy wszystkie partie i daty.
- Podgląd: rozbicie wg partii, każda rozwijalna do swojego łańcucha.
- Partie w podglądzie: naturalna kolejność (BEZ sortowania malejąco po ilości).
- Nagłówek podglądu: BEZ zakresu dat.
- Numer partii w rozbiciu: pełny `ddmmrr partia`.
