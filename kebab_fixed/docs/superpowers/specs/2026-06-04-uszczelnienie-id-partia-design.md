# Projekt (F2-A): Uszczelnienie — nazwa/numer partii zamiast id („ciągu cyfr")

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: F2-B „przepływ partii" (osobny, później). [[kebab-wydanie-dokumenty-roadmap]]

## Kontekst i diagnoza

Użytkownik widzi „ciąg cyfr"/kod (np. `527cafc1`) zamiast numeru partii / nazwy w kilku
widokach. Dochodzenie (dane prod + kod) — **dane w bazie są poprawne**; problem to
**wyświetlanie surowego id (cuid) zamiast czytelnej wartości**. Dwa wzorce:

**Wzorzec 1 — fallback `id.slice(0,8)`** w łańcuchu pochodzenia `LineageChain`
(`src/features/finished-goods/components/DetailModal.tsx`), gdy właściwe pole jest puste:
- linia 89 (Przyjęcie): `rb.internal_batch_no || rb.id.slice(0,8)`
- linia 99 (**Rozbiór**): `d.meatLotNo || d.meat_lot_no || d.id.slice(0,8)` → gdy `meatLotNo`
  puste, pokazuje `id.slice(0,8)` = **„527cafc1"**. Powinno użyć **`rawBatchNo`** (numer partii
  rozbioru) — backend już go zwraca (`deboning_service._map_deboning_entry` → `rawBatchNo`).
- linia 112 (Masowanie): `mo.order_no || mo.id.slice(0,8)`
- linia 122 (Mięso przyprawione): `sm.batch_no || sm.id.slice(0,8)`

**Wzorzec 2 — surowe `*Id` jako tekst:**
- `MobileSztukaPage.tsx:185` (karta skanu sztuki): „Receptura" = `card.recipeId` → cuid.
  Endpoint `finished_units` lookup **nie zwraca** `recipeName`/`productTypeName`.
- `LabelTemplatesPage.tsx:117`: fallback `{tpl.recipeId}` zamiast nazwy receptury.

**Poprawne, ZOSTAJE bez zmian:**
- Format **`ddmmrr nr partii`** na końcowym produkcie (`finished_goods.batch_no`,
  `DetailModal` tytuł) — celowa identyfikacja wyrobu (potwierdzone przez użytkownika).
- Selecty `<Select value={...Id}>` — `value` to identyfikacja (klucz), etykiety opcji są
  czytelne; NIE ruszamy.

### Zakres F2-A (szybki fix, osobny deploy)

Zamienić każde **wyświetlenie surowego id/„ciągu cyfr"** na czytelną wartość (numer partii /
nazwa). Backend dostarcza brakujące nazwy. NIE zmieniamy zapisów, kluczy ani formatu partii.

### Poza zakresem

- F2-B: spójny widok „przepływu partii" (przyjęcie→rozbiór→masowanie→produkcja) — osobno.
- Niespójność `finished_units.batch_no` ('PP1') vs `finished_goods.batch_no` ('020626 PP1')
  przy dopasowaniu rozchodu (B1) — do osobnej weryfikacji.

## Architektura

### 1. Backend — lookup sztuki zwraca nazwy

`backend/app/services/finished_units_service.py` (lookup po id/QR) — dołączyć nazwy:
```python
recipe = query_one("SELECT name FROM recipes WHERE id=%s", (unit.get("recipe_id"),)) or {}
ptype  = query_one("SELECT name FROM product_types WHERE id=%s", (unit.get("product_type_id"),)) or {}
# do zwracanego dict (obok istniejących recipeId/productTypeId):
"recipeName": recipe.get("name") or "",
"productTypeName": ptype.get("name") or "",
```
Front `src/lib/api.ts` `FinishedUnitCard`: dodać `recipeName?: string`, `productTypeName?: string`.

### 2. Front — karta skanu sztuki (`MobileSztukaPage.tsx`)

- „Receptura": `card.recipeName || card.recipeId || '—'`.
- (opcjonalnie) wiersz „Produkt": `card.productTypeName || '—'`.

### 3. Front — łańcuch pochodzenia (`DetailModal.tsx` LineageChain)

Każdy `extractLabel` ma preferować **czytelny numer/partię** przed `id.slice(0,8)`:
- Rozbiór (l. 99): `(d) => d.rawBatchNo || d.raw_batch_no || d.meatLotNo || d.meat_lot_no || d.id.slice(0,8)`.
- Pozostałe (89/112/122) — zostawić istniejące dobre pola, a `id.slice(0,8)` zostaje jako
  ostateczny fallback (gdy naprawdę brak danych). Tam gdzie istnieje lepsze pole partii
  (np. `internal_batch_no`, `order_no`, `batch_no`) jest już użyte.

### 4. Front — `LabelTemplatesPage.tsx:117`

Fallback `{tpl.recipeId}` → nazwa receptury (rozwiązać z listy receptur, którą strona już ma;
jeśli brak — `'—'` zamiast cuid).

### 5. Audyt „znajdź wszystko"

Komendy audytu (uruchomić i przejrzeć każdy wynik):
```
grep -rnE "\.id\.slice\(" src/ --include=*.tsx
grep -rnE ">\{[a-zA-Z]+\.(recipeId|productTypeId|packagingId|sessionId|rawBatchId)\b|value=\{[^}]*\.(recipeId|productTypeId)\b[^}]*\}\s*>" src/ --include=*.tsx
```
Każde **wyświetlenie** surowego id/cuid jako tekstu (nie `value=` selecta) → zamienić na
czytelną wartość. (Aktualnie znane: pkt 2–4 powyżej; audyt potwierdza brak innych.)

## Obsługa błędów / brzegowe

| Sytuacja | Zachowanie |
|---|---|
| brak `recipeName` z backendu | fallback `recipeId` (po fixie backend zwraca nazwę) |
| `rawBatchNo` puste przy rozbiorze | dalszy fallback (meatLotNo → id.slice jak dziś) |
| brak danych w łańcuchu | `id.slice(0,8)` jako ostateczność (lepsze niż puste) |

## Testy

- Backend: smoke — lookup sztuki zwraca `recipeName`/`productTypeName`.
- Front: brak runnera → build + ręczna weryfikacja.
- E2e: (a) skan sztuki → „Receptura" = nazwa (nie cuid); (b) wyrób gotowy → Śledzenie →
  Rozbiór pokazuje numer partii rozbioru (nie „527cafc1"); (c) format partii wyrobu gotowego
  `ddmmrr partia` bez zmian.

## Otwarte kwestie

- Czy dodać „Produkt" (productTypeName) na karcie skanu — domyślnie tak, niskie ryzyko.
