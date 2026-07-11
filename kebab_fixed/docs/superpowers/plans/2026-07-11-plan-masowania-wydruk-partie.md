# Plan masowania — czytelniejszy wydruk partii mięsa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Przebudować sekcję "Kolejka masowania" na wydruku `/office/plan-masowania/druk`, tak żeby
każda partia mięsa miała własny wiersz z dużym, wyeksponowanym kg — zamiast dzisiejszego sklejonego
tekstu `nr · kg · rodzaj · dostawca` w jednej komórce.

**Architecture:** Czysta funkcja `buildLotRows()` spłaszcza plan (pozycje + partie) do listy wierszy
tabeli (z `rowSpan`/`zebra` per pozycja), wydzielona do `src/lib/mixingPlanPrint.ts` i pokryta testami
jednostkowymi (vitest) — jedyny plik z realną logiką do testowania w tej zmianie. Komponent
`MixingPlanPrintPage.tsx` używa jej do renderowania tabeli; brak zmian backendu (dane już są w
odpowiedzi `mixingOrdersApi.dayPlan()`).

**Tech Stack:** React + TypeScript, Vite, vitest. Brak zmian API/DB.

## Global Constraints

- Zero zmian backendu — wszystkie potrzebne pola (`meatLotNo`, `materialName`, `supplierName`,
  `kgPlanned`) już są w `mixing_service.build_mixing_order` (`backend/app/services/mixing_service.py:124-138`).
- Layout musi zmieścić się na 1 stronie A4 (istniejący cel projektowy, potwierdzony jako priorytet
  nadrzędny nad rozlaniem na 2. stronę) — patrz spec, sekcja 4 i "Ryzyko".
- Cała reszta strony (nagłówek, sekcja 2 — przepisy na wsady, sekcja 3 — przyprawy łącznie,
  auto-print/`?pdf=1`) bez zmian strukturalnych.
- Teksty UI po polsku, w stylu już użytym w pliku (np. "Nr partii", "Kg partii" — konwencja
  `Nazwa [jednostka]` używana już dla "Mięso [kg]").
- Spec: `docs/superpowers/specs/2026-07-11-plan-masowania-wydruk-partie-design.md`.

---

## Task 1: Czysta funkcja `buildLotRows` (spłaszczenie planu do wierszy partii)

**Files:**
- Create: `src/lib/mixingPlanPrint.ts`
- Test: `src/lib/mixingPlanPrint.test.ts`

**Interfaces:**
- Produces: `buildLotRows(plan: PlanPositionInput[]): LotRow[]` — używane przez Task 2
  (`MixingPlanPrintPage.tsx`). `LotRow` ma pola: `positionId: string`, `rowKey: string`,
  `isFirstRow: boolean`, `rowSpan: number`, `zebra: boolean`, `lp: number`, `recipeName: string`,
  `meatKg: number`, `status: string`, `lotNo: string`, `lotKg: number | null`,
  `materialName: string`, `supplierName: string`.

- [ ] **Step 1: Napisz plik testów (failing)**

Utwórz `src/lib/mixingPlanPrint.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildLotRows } from './mixingPlanPrint'

describe('buildLotRows — spłaszczenie planu masowania do wierszy partii', () => {
  it('pozycja z jedną partią → jeden wiersz, rowSpan=1, isFirstRow=true', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'Klasyczna', meatKg: 100, status: 'planned',
        meatLots: [{ meatLotNo: 'LOT-1', materialName: 'Udo', supplierName: 'Dostawca A', kgPlanned: 100 }] },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      isFirstRow: true, rowSpan: 1, zebra: false, lp: 1,
      lotNo: 'LOT-1', lotKg: 100, materialName: 'Udo', supplierName: 'Dostawca A',
    })
  })

  it('pozycja z trzema partiami → trzy wiersze, wspólny rowSpan=3, tylko pierwszy isFirstRow', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'Klasyczna', meatKg: 300, status: 'planned',
        meatLots: [
          { meatLotNo: 'LOT-1', kgPlanned: 100 },
          { meatLotNo: 'LOT-2', kgPlanned: 100 },
          { meatLotNo: 'LOT-3', kgPlanned: 100 },
        ] },
    ])
    expect(rows).toHaveLength(3)
    expect(rows.map(r => r.isFirstRow)).toEqual([true, false, false])
    expect(rows.every(r => r.rowSpan === 3)).toBe(true)
    expect(rows.map(r => r.lotNo)).toEqual(['LOT-1', 'LOT-2', 'LOT-3'])
  })

  it('pozycja bez partii → jeden wiersz z myślnikami, lotKg=null', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'Klasyczna', meatKg: 50, status: 'planned', meatLots: [] },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ lotNo: '—', lotKg: null, rowSpan: 1, isFirstRow: true })
  })

  it('zebra alternuje per pozycja, nie per wiersz partii', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'A', meatKg: 200, status: 'planned',
        meatLots: [{ meatLotNo: 'L1', kgPlanned: 100 }, { meatLotNo: 'L2', kgPlanned: 100 }] },
      { id: 'p2', recipeName: 'B', meatKg: 50, status: 'planned',
        meatLots: [{ meatLotNo: 'L3', kgPlanned: 50 }] },
      { id: 'p3', recipeName: 'C', meatKg: 50, status: 'planned',
        meatLots: [{ meatLotNo: 'L4', kgPlanned: 50 }] },
    ])
    expect(rows.filter(r => r.positionId === 'p1').every(r => r.zebra === false)).toBe(true)
    expect(rows.filter(r => r.positionId === 'p2').every(r => r.zebra === true)).toBe(true)
    expect(rows.filter(r => r.positionId === 'p3').every(r => r.zebra === false)).toBe(true)
  })

  it('lp numeruje pozycje od 1, wspólne dla wszystkich wierszy tej pozycji', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'A', meatKg: 100, status: 'planned',
        meatLots: [{ meatLotNo: 'L1', kgPlanned: 50 }, { meatLotNo: 'L2', kgPlanned: 50 }] },
      { id: 'p2', recipeName: 'B', meatKg: 50, status: 'planned',
        meatLots: [{ meatLotNo: 'L3', kgPlanned: 50 }] },
    ])
    expect(rows.filter(r => r.positionId === 'p1').every(r => r.lp === 1)).toBe(true)
    expect(rows.filter(r => r.positionId === 'p2').every(r => r.lp === 2)).toBe(true)
  })

  it('brakujące pola partii → fallback jak w dotychczasowym wydruku (lotNo „?", materialName „Mięso z/s")', () => {
    const rows = buildLotRows([
      { id: 'p1', recipeName: 'A', meatKg: 50, status: 'planned', meatLots: [{ kgPlanned: 50 }] },
    ])
    expect(rows[0].lotNo).toBe('?')
    expect(rows[0].materialName).toBe('Mięso z/s')
    expect(rows[0].supplierName).toBe('')
  })
})
```

- [ ] **Step 2: Uruchom testy, potwierdź że failują (moduł nie istnieje)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/lib/mixingPlanPrint.test.ts`
Expected: FAIL — `Cannot find module './mixingPlanPrint'` (lub podobny błąd importu).

- [ ] **Step 3: Zaimplementuj `buildLotRows`**

Utwórz `src/lib/mixingPlanPrint.ts`:

```ts
/**
 * mixingPlanPrint.ts — czyste przekształcenie planu masowania (pozycje + partie mięsa)
 * do listy wierszy tabeli "Kolejka masowania" na wydruku dla operatora
 * (src/pages/office/MixingPlanPrintPage.tsx). Wydzielone, żeby dało się to
 * testować bez renderowania React.
 */

export interface MeatLotInput {
  meatLotNo?: string
  materialName?: string
  supplierName?: string
  kgPlanned?: number
}

export interface PlanPositionInput {
  id: string
  recipeName?: string
  meatKg?: number
  status?: string
  meatLots?: MeatLotInput[]
}

export interface LotRow {
  positionId: string
  rowKey: string
  isFirstRow: boolean
  rowSpan: number
  zebra: boolean
  lp: number
  recipeName: string
  meatKg: number
  status: string
  lotNo: string
  lotKg: number | null
  materialName: string
  supplierName: string
}

export function buildLotRows(plan: PlanPositionInput[]): LotRow[] {
  const rows: LotRow[] = []

  plan.forEach((position, positionIndex) => {
    const lots = position.meatLots ?? []
    const rowSpan = lots.length > 0 ? lots.length : 1
    const zebra = positionIndex % 2 === 1
    const lp = positionIndex + 1
    const recipeName = position.recipeName || '—'
    const meatKg = position.meatKg || 0
    const status = position.status || ''

    if (lots.length === 0) {
      rows.push({
        positionId: position.id, rowKey: `${position.id}-0`,
        isFirstRow: true, rowSpan, zebra, lp, recipeName, meatKg, status,
        lotNo: '—', lotKg: null, materialName: '', supplierName: '',
      })
      return
    }

    lots.forEach((lot, lotIndex) => {
      rows.push({
        positionId: position.id, rowKey: `${position.id}-${lotIndex}`,
        isFirstRow: lotIndex === 0, rowSpan, zebra, lp, recipeName, meatKg, status,
        lotNo: lot.meatLotNo || '?',
        lotKg: lot.kgPlanned ?? 0,
        materialName: lot.materialName || 'Mięso z/s',
        supplierName: lot.supplierName || '',
      })
    })
  })

  return rows
}
```

- [ ] **Step 4: Uruchom testy, potwierdź że przechodzą**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && TZ=UTC npx vitest run src/lib/mixingPlanPrint.test.ts`
Expected: PASS — 6/6 testów zielonych.

- [ ] **Step 5: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/lib/mixingPlanPrint.ts src/lib/mixingPlanPrint.test.ts
git commit -m "feat: buildLotRows — spłaszczenie planu masowania do wierszy partii mięsa"
```

---

## Task 2: Przebudowa tabeli "Kolejka masowania" w `MixingPlanPrintPage.tsx`

**Files:**
- Modify: `src/pages/office/MixingPlanPrintPage.tsx`

**Interfaces:**
- Consumes: `buildLotRows(plan: PlanPositionInput[]): LotRow[]` z Task 1 (import z `@/lib/mixingPlanPrint`).

- [ ] **Step 1: Dodaj import `buildLotRows`**

W bloku importów (linia 21-23), po istniejącym imporcie `mixingOrdersApi, recipesApi`:

```ts
import { mixingOrdersApi, recipesApi } from '@/lib/apiClient'
import { buildLotRows } from '@/lib/mixingPlanPrint'
```

- [ ] **Step 2: Dodaj styl `kgBig` do obiektu `S`**

Znajdź blok:

```ts
  tdR: { border: '1px solid #bfbfbf', padding: '2.5px 5px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const },
}
```

Zamień na:

```ts
  tdR: { border: '1px solid #bfbfbf', padding: '2.5px 5px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const },
  // Kg partii mięsa — jedyna liczba na wydruku, którą operator fizycznie odważa,
  // ma dominować wizualnie nad numerem partii/rodzajem/dostawcą w tym samym wierszu.
  kgBig: { border: '1px solid #bfbfbf', padding: '1px 5px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const, fontSize: 16, fontWeight: 800, lineHeight: 1.15 },
}
```

- [ ] **Step 3: Dodaj `lotRows` useMemo**

Znajdź linię:

```ts
  const recipeById = useMemo(() => new Map(recipes.map((r: any) => [r.id, r])), [recipes])
```

Zaraz po niej dodaj:

```ts
  const lotRows = useMemo(() => buildLotRows(plan ?? []), [plan])
```

- [ ] **Step 4: Zastąp tabelę sekcji 1**

Znajdź cały blok od `{/* ── 1. Kolejka pozycji ── */}` do zamykającego `</table>` tej sekcji
(obecna zawartość — nagłówek `<thead>` z 5 kolumnami i `<tbody>` z `plan.map(...)` sklejającym
partie tekstem w jednej komórce). Zamień w całości na:

```tsx
      {/* ── 1. Kolejka pozycji ── */}
      <div style={S.section}>Kolejka masowania</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: 20 }}>Lp</th>
            <th style={S.th}>Receptura</th>
            <th style={{ ...S.th, width: 74 }}>Nr partii</th>
            <th style={{ ...S.th, width: 78 }}>Kg partii</th>
            <th style={S.th}>Rodzaj</th>
            <th style={S.th}>Dostawca</th>
            <th style={{ ...S.th, width: 62 }}>Mięso [kg]</th>
            <th style={{ ...S.th, width: 68 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {lotRows.map(row => {
            const bg = row.zebra ? '#f2f2f2' : '#fff'
            return (
              <tr key={row.rowKey}>
                {row.isFirstRow && (
                  <>
                    <td style={{ ...S.td, background: bg }} rowSpan={row.rowSpan}><b>{row.lp}</b></td>
                    <td style={{ ...S.tdL, fontWeight: 700, background: bg }} rowSpan={row.rowSpan}>
                      {row.recipeName}
                    </td>
                  </>
                )}
                <td style={{ ...S.tdL, background: bg }}>{row.lotNo}</td>
                <td style={{ ...S.kgBig, background: bg }}>
                  {row.lotKg == null ? '—' : `${nf0.format(row.lotKg)} kg`}
                </td>
                <td style={{ ...S.tdL, background: bg }}>{row.materialName || '—'}</td>
                <td style={{ ...S.tdL, background: bg }}>{row.supplierName || '—'}</td>
                {row.isFirstRow && (
                  <>
                    <td style={{ ...S.tdR, fontWeight: 800, background: bg }} rowSpan={row.rowSpan}>
                      {nf0.format(row.meatKg)}
                    </td>
                    <td style={{ ...S.td, background: bg }} rowSpan={row.rowSpan}>
                      {STATUS_PL[row.status] ?? row.status}
                    </td>
                  </>
                )}
              </tr>
            )
          })}
          <tr>
            <td style={{ ...S.tdL, fontWeight: 800, background: '#efefef' }} colSpan={6}>RAZEM</td>
            <td style={{ ...S.tdR, fontWeight: 800, background: '#efefef' }}>{nf0.format(totalMeat)}</td>
            <td style={{ ...S.td, background: '#efefef' }} />
          </tr>
        </tbody>
      </table>
```

Sprawdź, że liczba kolumn się zgadza: `thead` ma 8 `th`. Każdy wiersz z `isFirstRow=true` renderuje
2 (Lp, Receptura) + 4 (Nr partii, Kg partii, Rodzaj, Dostawca) + 2 (Mięso, Status) = 8 `td`.
Wiersze z `isFirstRow=false` renderują tylko środkowe 4 `td` — pierwsze 2 i ostatnie 2 kolumny są
pokryte przez `rowSpan` z wiersza pierwszego tej pozycji. Wiersz RAZEM: `colSpan={6}` (kolumny
1-6) + 1 komórka z sumą (kolumna 7) + 1 puste `td` (kolumna 8) = 8.

- [ ] **Step 5: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów TypeScript (kod repo nie ma testów renderowania dla stron do druku — patrz
`DeboningReportPrintPage.tsx` i inne strony w `src/pages/office/` — weryfikacja wizualna jest w Task 4).

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/MixingPlanPrintPage.tsx
git commit -m "feat: wydruk planu masowania — partia mięsa = jeden wiersz, duże kg, zebra per pozycja"
```

---

## Task 3: Kompresja stylów sekcji 2-3 (miejsce na większą sekcję 1, cel: 1 strona A4)

**Files:**
- Modify: `src/pages/office/MixingPlanPrintPage.tsx`

**Interfaces:**
- Consumes: obiekt stylów `S` zmodyfikowany w Task 2 (Step 2) — ta zmiana dotyka tych samych kluczy
  (`table`, `th`, `td`, `tdL`, `tdR`, `section`, `page`), więc musi być wykonana PO Task 2.

- [ ] **Step 1: Zmniejsz padding/fontSize komórek tabel i odstępy nagłówków sekcji**

Znajdź blok `S` (po zmianach z Task 2, zaczyna się `const S = {`):

```ts
const S = {
  page: { maxWidth: 800, margin: '0 auto', padding: '14px 20px', background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11 } as const,
  h1: { fontSize: 17, fontWeight: 800, letterSpacing: 0.4, margin: 0 } as const,
  section: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, margin: '8px 0 3px', borderBottom: '1.5px solid #111', paddingBottom: 2 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10.5 },
  th: { border: '1px solid #bfbfbf', background: '#efefef', padding: '2.5px 5px',
    fontSize: 9, textTransform: 'uppercase' as const, fontWeight: 700, textAlign: 'center' as const },
  td: { border: '1px solid #bfbfbf', padding: '2.5px 5px', textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums' as const },
  tdL: { border: '1px solid #bfbfbf', padding: '2.5px 5px', textAlign: 'left' as const },
```

Zamień na:

```ts
const S = {
  page: { maxWidth: 800, margin: '0 auto', padding: '10px 20px', background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11 } as const,
  h1: { fontSize: 17, fontWeight: 800, letterSpacing: 0.4, margin: 0 } as const,
  section: { fontSize: 11, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: 0.5, margin: '6px 0 2px', borderBottom: '1.5px solid #111', paddingBottom: 2 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10 },
  th: { border: '1px solid #bfbfbf', background: '#efefef', padding: '2px 4px',
    fontSize: 8.5, textTransform: 'uppercase' as const, fontWeight: 700, textAlign: 'center' as const },
  td: { border: '1px solid #bfbfbf', padding: '2px 4px', textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums' as const },
  tdL: { border: '1px solid #bfbfbf', padding: '2px 4px', textAlign: 'left' as const },
```

I dalej w tym samym obiekcie:

```ts
  tdR: { border: '1px solid #bfbfbf', padding: '2.5px 5px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const },
```

Zamień na:

```ts
  tdR: { border: '1px solid #bfbfbf', padding: '2px 4px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const },
```

(Wpis `kgBig` dodany w Task 2 zostaje bez zmian — ma własny, celowo większy padding/fontSize,
niezależny od kompresji `td`/`tdL`/`tdR`.)

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/office/MixingPlanPrintPage.tsx
git commit -m "style: kompresja padding/fontSize sekcji 2-3 wydruku planu masowania (miejsce dla sekcji 1)"
```

---

## Task 4: Weryfikacja wizualna w przeglądarce (dane rzeczywiste, tylko odczyt)

**Files:** brak zmian kodu — weryfikacja.

To środowisko obsługuje realną, działającą produkcję (backend na `127.0.0.1:8010`, Postgres na
`5433`, deploy z `/opt/kebab/app/` — osobna kopia od tego repo). Weryfikacja MUSI być tylko-odczyt:
żadnych zmian w bazie danych bez zgody użytkownika.

- [ ] **Step 1: Znajdź w bazie realny dzień planu z pozycją mającą ≥2 partie (tylko SELECT)**

Użyj `mcp__kebab-mes-db__execute_sql` (tryb read-only) z zapytaniem:

```sql
SELECT o.plan_date, o.id, o.order_no, o.recipe_name, COUNT(l.id) AS lot_count
FROM mixing_orders o
JOIN mixing_order_lots l ON l.order_id = o.id
WHERE o.status <> 'cancelled' AND COALESCE(l.kg_planned, 0) > 0
GROUP BY o.plan_date, o.id, o.order_no, o.recipe_name
HAVING COUNT(l.id) >= 2
ORDER BY o.plan_date DESC
LIMIT 5;
```

- Jeśli zapytanie zwróci wiersze → zapamiętaj `plan_date` z najnowszego wiersza, przejdź do Step 2.
- Jeśli zwróci 0 wierszy → **zatrzymaj się i zapytaj użytkownika**, czy chce, żebyś dodał tymczasowe
  dane testowe do bazy (osobny, oznaczony `order_no`, do usunięcia po weryfikacji), czy woli
  zweryfikować tylko przypadek "1 partia na pozycję" na dowolnym istniejącym dniu z planem. NIE
  twórz żadnych danych testowych bez wyraźnej zgody — baza jest współdzielona z produkcją.

- [ ] **Step 2: Odpal frontend deweloperski**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run dev`

Zanotuj port, na którym Vite wystartował (domyślnie 5173). Jeśli strona nie może pobrać danych
(błąd sieci/CORS w konsoli), sprawdź `src/lib/api.ts:37-45` — może być potrzebny
`VITE_API_URL=http://127.0.0.1:8010` w `.env.local` (żeby dev-server odpytywał ten sam, już
działający backend, bez ruszania jego konfiguracji).

- [ ] **Step 3: Otwórz wydruk dla znalezionej daty i sprawdź strukturę DOM**

Użyj Playwright MCP (`mcp__plugin_playwright_playwright__browser_navigate`) do otwarcia:
`http://localhost:<port>/office/plan-masowania/druk?date=<plan_date z Step 1>&pdf=1`
(`pdf=1` wyłącza auto-`window.print()`, żeby dało się spokojnie zbadać stronę).

Następnie `mcp__plugin_playwright_playwright__browser_evaluate` z funkcją:

```js
() => {
  const rows = [...document.querySelectorAll('table')[0].querySelectorAll('tbody tr')]
  const withRowSpan = rows.filter(tr => [...tr.children].some(td => td.rowSpan > 1))
  return {
    totalRows: rows.length,
    rowsWithRowSpan: withRowSpan.length,
    pageScrollHeight: document.querySelector('div').scrollHeight,
  }
}
```

Sprawdź: `rowsWithRowSpan > 0` (potwierdza, że przynajmniej jedna pozycja z ≥2 partiami faktycznie
scaliła kolumny Lp/Receptura/Mięso/Status). `pageScrollHeight` zanotuj — orientacyjny wysokościowy
budżet dla A4 (297mm, margin 8mm ×2 z `@page`) to ok. 1000-1060px przy `fontSize` bazowym z `S.page`;
znaczące przekroczenie sygnalizuje ryzyko rozlania na 2. stronę (patrz "Ryzyko" w spec) — jeśli tak,
zgłoś to użytkownikowi zamiast dalej zgadywać kolejne kompresje stylów.

- [ ] **Step 4: Zrób zrzut ekranu i oceń wizualnie**

Użyj `mcp__plugin_playwright_playwright__browser_take_screenshot` (pełna strona). Sprawdź na oko:
kg partii wyraźnie większe/pogrubione względem numeru partii/rodzaju/dostawcy w tym samym wierszu;
naprzemienne tło widoczne między pozycjami (nie między wierszami tej samej pozycji); tabela nie
"rozłazi się" (kolumny wyrównane, brak nachodzenia tekstu).

- [ ] **Step 5: Zamknij przeglądarkę i zatrzymaj dev-server**

`mcp__plugin_playwright_playwright__browser_close`, następnie zatrzymaj proces `npm run dev`
(Ctrl+C / zabij proces w tle, w zależności jak został odpalony).

Brak commitu w tym zadaniu — to czysta weryfikacja. Jeśli Step 3/4 wykryją problem (kolumny się nie
zgadzają, przekroczenie wysokości strony, błąd renderowania), wróć do Task 2/3 i popraw, potem
powtórz Task 4 od Step 3.
