# Projekt (F2-A): Uszczelnienie — czytelne wartości zamiast id/„ciągu cyfr"

Data: 2026-06-04
Status: zatwierdzony (oczekuje na plan implementacji)
Powiązane: F2-B „przepływ partii" (osobny, później). [[kebab-wydanie-dokumenty-roadmap]]

## Kontekst i diagnoza

Użytkownik widzi „jakiś ciąg cyfr" zamiast czytelnej wartości na **karcie skanu pojedynczej
sztuki** (mobile, „Karta sztuki") i na **wyrobie gotowym**. Dochodzenie (dane prod + kod):

- **Dane partii są poprawne** w bazie (`finished_units.batch_no` = '346'/'PP1';
  `seasoned_meat.batch_no` = '346'/'PP1'). Nic nie jest zepsute w zapisie.
- „Śmieci" to **id (cuid) lub format z prefiksem daty pokazywane zamiast nazwy/numeru**:
  1. **Karta skanu sztuki** (`MobileSztukaPage.tsx:185`): pole „Receptura" =
     `card.recipeId` → cuid (np. `39e6ff5912e04621a95c`). `finished_units` trzyma `recipe_id`,
     nie nazwę; endpoint `finished_units` lookup **nie zwraca** `recipeName`/`productTypeName`.
  2. **Wyrób gotowy** (`DetailModal.tsx:152` tytuł): `item.batchNo` = `'020626 PP1'` —
     format `kebab_batch_no` = `ddmmrr + partia`; prefiks daty „020626" czytany jako „ciąg cyfr".

### Zakres F2-A (ten spec — szybki fix, osobny deploy)

Pokazywać **czytelną wartość** (nazwa / czysty numer partii) zamiast id/prefiksu daty w
widokach operacyjnych. Audyt analogicznych miejsc. NIE zmieniamy przechowywanych wartości
(`batch_no` w bazie zostaje; zmieniamy tylko **wyświetlanie**).

### Poza zakresem

- F2-B: spójny widok „przepływu partii" (przyjęcie→rozbiór→masowanie→produkcja) — osobno.
- Zmiana formatu `finished_goods.batch_no` w bazie (zostaje `ddmmrr partia`; tylko display
  na ekranach pokazuje czysty numer).
- Niespójność `finished_units.batch_no` ('PP1') vs `finished_goods.batch_no` ('020626 PP1')
  przy dopasowaniu rozchodu (B1) — odnotowane do osobnej weryfikacji, nie tu.

## Architektura

### 1. Backend — lookup sztuki zwraca nazwy

`backend/app/services/finished_units_service.py` (funkcja lookup po `id`/QR): dołączyć
`recipeName` i `productTypeName` przez JOIN/lookup:

```python
recipe = query_one("SELECT name FROM recipes WHERE id=%s", (unit.get("recipe_id"),)) or {}
ptype  = query_one("SELECT name FROM product_types WHERE id=%s", (unit.get("product_type_id"),)) or {}
# do zwracanego dict:
"recipeName": recipe.get("name") or "",
"productTypeName": ptype.get("name") or "",
```
(zostawić istniejące `recipeId`/`productTypeId` dla zgodności; dodać nazwy.)

Front (`src/lib/api.ts` `FinishedUnitCard`): dodać `recipeName?: string`, `productTypeName?: string`.

### 2. Front — karta skanu pokazuje nazwy

`src/pages/mobile/MobileSztukaPage.tsx`:
- „Receptura": `card.recipeName || card.recipeId || '—'` (preferuj nazwę).
- (opcjonalnie) dodać wiersz „Produkt": `card.productTypeName`.

### 3. Front — czysty numer partii na ekranach (bez prefiksu daty)

Helper `src/lib/batchDisplay.ts`:
```ts
// usuwa wiodący prefiks daty "ddmmrr " z numeru partii do WYŚWIETLANIA na ekranach
export function cleanBatchNo(s?: string | null): string {
  const v = (s ?? '').trim()
  return v.replace(/^\d{6}\s+/, '')   // "020626 PP1" -> "PP1"; "PP1" -> "PP1"
}
```
Zastosować przy **wyświetlaniu** numeru partii wyrobu gotowego:
- `DetailModal.tsx` tytuł: `cleanBatchNo(item.batchNo)`.
- `FinishedGoodsPage.tsx` — jeśli pokazuje `batchNo` w kolumnie/wyszukiwarce wyników, owinąć
  wyświetlenie w `cleanBatchNo(...)` (wyszukiwanie może zostać po pełnej wartości).
Etykiety (druk) **bez zmian** — tam prefiks daty jest celowy.

### 4. Audyt id-leaków

`grep -rnE "value=\{[^}]*\.(recipeId|productTypeId|packagingId|clientId)\b" src/ --include=*.tsx`
oraz przegląd `MobileSztukaPage`/`DetailModal`/`FinishedGoodsPage` — każde **wyświetlenie**
surowego id/kodu zamiast nazwy/numeru → poprawić na czytelną wartość (nazwa / `cleanBatchNo`).
Nie ruszać `value=`/kluczy/zapisów.

## Obsługa błędów / brzegowe

| Sytuacja | Zachowanie |
|---|---|
| brak `recipeName` z backendu | fallback na `recipeId` (lepsze niż puste; ale po fixie backend zwraca nazwę) |
| `batch_no` bez prefiksu daty (np. 'PP1') | `cleanBatchNo` zwraca bez zmian |
| `batch_no` pusty | zwraca '' |

## Testy

- Backend: smoke — lookup sztuki zwraca `recipeName`/`productTypeName` (ręcznie/inline; brak
  dedykowanego testu lookup — opcjonalnie mały test mapowania jeśli wydzielimy czystą funkcję).
- Front: brak runnera → build + ręczna weryfikacja.
- E2e: zeskanuj sztukę → „Receptura" pokazuje nazwę (nie cuid); wyrób gotowy → numer partii
  bez prefiksu daty (np. „PP1", nie „020626 PP1").

## Otwarte kwestie

- Czy „Produkt" na karcie skanu też dodać (productTypeName) — domyślnie tak (przydatne),
  niskie ryzyko.
