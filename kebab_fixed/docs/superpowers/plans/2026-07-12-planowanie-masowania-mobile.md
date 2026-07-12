# Responsywność mobilna planowania masowania — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sekcja planowania masowania działa wygodnie na telefonie (karty) i bez zmian na desktopie (tabela), breakpoint `lg`.

**Architecture:** Czysto warstwa prezentacji (Tailwind + drobny `useState` zwijania). `PlanRow` renderuje dwa układy ze wspólnych kontrolek: desktop grid (`hidden lg:grid`, identyczny) i karta (`lg:hidden`). `MixingDayPlanEditor` chowa nagłówki kolumn poniżej `lg` i przełącza kontener na `lg:grid-cols`. `PlanStockSidebar` zwijany poniżej `lg`.

**Tech Stack:** React + TypeScript, Tailwind, vitest (bez nowej logiki).

## Global Constraints

- Breakpoint: `lg` (≥1024px) = desktop/tabela; `<lg` = karty. Desktop wygląd MUSI zostać identyczny.
- Tylko prezentacja — bez zmian handlerów, danych, backendu. Testy jednostkowe bez zmian (105/105).
- Reorder na telefonie strzałkami ↑/↓ (`onMove`); drag&drop tylko desktop.
- Spec: `docs/superpowers/specs/2026-07-12-planowanie-masowania-mobile-design.md`.

---

## Task 1: `PlanRow` — dwa układy (desktop grid + karta mobile)

**Files:**
- Modify: `src/features/products/components/PlanRow.tsx` (pełne przepisanie ciała komponentu — sekcja `return`)

**Interfaces:**
- Bez zmian API komponentu (te same propsy). Wewnętrznie: wspólne zmienne JSX `recipeSelect`, `kgInput`, `outputEl`, `lotsBtn`, `statusEl`, `moveActions`.

- [ ] **Step 1: Zastąp ciało `return` w PlanRow**

W `src/features/products/components/PlanRow.tsx` zastąp cały blok od `return (` (linia 94) do końcowego `)` funkcji (linia 240, przed `}`) poniższym. Zmienne wyliczane wyżej (`st`, `locked`, `kg`, `lotKg`, `lotsOk`, `lotNo`, `shownLots`, `canConfirmNow`) zostają bez zmian.

```tsx
  // ── Wspólne kontrolki (używane w układzie desktop i mobile) ──
  const recipeSelect = (
    <Select value={row.recipeId || '__none'} disabled={locked}
      onValueChange={v => onUpdate({ recipeId: v === '__none' ? '' : v })}>
      <SelectTrigger className="h-8 text-[12px]"><SelectValue placeholder="Receptura..." /></SelectTrigger>
      <SelectContent>
        <SelectItem value="__none">Receptura...</SelectItem>
        {recipes.map(rc => <SelectItem key={rc.id} value={rc.id}>{rc.name}</SelectItem>)}
      </SelectContent>
    </Select>
  )

  const kgInput = (
    <span className="flex items-center gap-1 justify-end">
      <Input type="number" min="1" step="10" value={row.meatKg} disabled={locked}
        onChange={e => onUpdate({ meatKg: e.target.value })}
        className="h-8 w-20 text-[13px] font-bold text-right tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
      <span className="text-[10px] text-ink-4">kg</span>
    </span>
  )

  const outputEl = (
    <span className="text-right text-[12px] text-emerald-700 font-bold tabular-nums whitespace-nowrap">
      {output > 0 ? `${fmtKg(output, 0)} kg` : '—'}
    </span>
  )

  const lotsBtn = (
    <button onClick={onToggle} disabled={locked}
      className="flex items-center gap-1 flex-wrap text-left disabled:cursor-default min-h-[26px]"
      title={locked ? undefined : 'Kliknij, aby dobrać partie'}>
      {row.lots.length === 0 ? (
        !locked && (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700">
            <AlertTriangle size={12} /> przypisz partie
          </span>
        )
      ) : (
        <>
          {shownLots.map(l => (
            <span key={l.meatLotId}
              className={cn(
                'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[11px] font-mono font-bold tabular-nums',
                lotsOk ? 'bg-surface-2 border-surface-4 text-ink' : 'bg-amber-50 border-amber-200 text-amber-800',
              )}>
              {lotNo(l.meatLotId)}
              <span className="font-sans font-semibold text-ink-3">{fmtKg(l.kgPlanned, 0)}</span>
            </span>
          ))}
          {row.lots.length > 3 && (
            <span className="text-[11px] font-semibold text-ink-4">+{row.lots.length - 3}</span>
          )}
          {!lotsOk && (
            <span className="text-[10px] font-bold text-amber-700 whitespace-nowrap">
              {fmtKg(lotKg, 0)}/{fmtKg(kg, 0)}
            </span>
          )}
        </>
      )}
    </button>
  )

  const statusEl = (
    <span className="flex flex-col items-start gap-1">
      <StatusBadge tone={st.tone}
        label={row.status === 'in_progress' && row.kgDone ? `${st.label} · ${fmtKg(row.kgDone, 0)} kg` : st.label} />
      {!locked && showConfirmExecution && (
        <button
          onClick={onConfirmExecution}
          disabled={!canConfirmNow || confirmingExecution}
          title={
            !canConfirmExecution ? 'Najpierw zapisz plan'
            : !lotsOk ? 'Uzupełnij partie mięsa, żeby potwierdzić wykonanie'
            : 'Brak HMI na masownicy — biuro potwierdza, że pozycja została wymieszana; mięso przyprawione wejdzie na magazyn'
          }
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap',
            canConfirmNow && !confirmingExecution
              ? 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
              : 'border-surface-4 text-ink-5 cursor-not-allowed',
          )}>
          {confirmingExecution
            ? <Loader2 size={10} className="animate-spin" />
            : <CheckCheck size={10} />}
          Potwierdź
        </button>
      )}
      {row.status === 'done' && showConfirmExecution && (
        <button
          onClick={onUndoConfirm}
          disabled={confirmingExecution}
          title="Cofnij potwierdzenie — usuwa partię przyprawionego, przywraca mięso i przyprawy; działa tylko gdy nic nie zużyto na produkcji"
          className={cn(
            'inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded border whitespace-nowrap',
            'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100',
            confirmingExecution && 'opacity-60 cursor-wait',
          )}>
          {confirmingExecution
            ? <Loader2 size={10} className="animate-spin" />
            : <RotateCcw size={10} />}
          Cofnij
        </button>
      )}
    </span>
  )

  const moveActions = (
    <span className="flex items-center justify-end gap-0.5">
      <span className="flex flex-col">
        <button onClick={() => onMove(-1)} disabled={index === 0}
          className="h-3.5 w-6 flex items-center justify-center text-ink-4 hover:text-ink disabled:opacity-20">
          <ArrowUp size={12} />
        </button>
        <button onClick={() => onMove(1)} disabled={index === total - 1}
          className="h-3.5 w-6 flex items-center justify-center text-ink-4 hover:text-ink disabled:opacity-20">
          <ArrowDown size={12} />
        </button>
      </span>
      <button onClick={onToggle} disabled={locked}
        className="w-6 h-6 rounded flex items-center justify-center text-ink-4 hover:bg-surface-2 disabled:opacity-20"
        title="Partie i składniki">
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      <button onClick={onDelete} disabled={locked}
        className="w-6 h-6 rounded flex items-center justify-center text-ink-4 hover:text-destructive hover:bg-destructive/10 disabled:opacity-20"
        title={locked ? 'Pozycja w masownicy/gotowa' : 'Usuń z planu'}>
        <Trash2 size={13} />
      </button>
    </span>
  )

  return (
    <div className={cn('border-b border-surface-3 last:border-b-0', locked ? 'bg-surface-2/60' : 'bg-white')}
      onDragOver={dragHandlers.onDragOver} onDrop={dragHandlers.onDrop}>

      {/* ── Układ DESKTOP (≥lg) — identyczny grid jak dotąd ── */}
      <div className={cn(GRID, 'hidden lg:grid px-2.5 py-1.5')}>
        <span
          draggable={dragHandlers.draggable && !locked}
          onDragStart={dragHandlers.onDragStart}
          onDragEnd={dragHandlers.onDragEnd}
          className={cn('flex justify-center', locked ? 'opacity-20' : 'cursor-grab text-ink-4 hover:text-ink')}
          title={locked ? 'Pozycja w masownicy/gotowa' : 'Przeciągnij, by zmienić kolejność'}>
          <GripVertical size={15} />
        </span>
        <span className="text-center text-[13px] font-black text-brand tabular-nums">{index + 1}</span>
        {recipeSelect}
        {kgInput}
        {outputEl}
        {lotsBtn}
        {statusEl}
        {moveActions}
      </div>

      {/* ── Układ MOBILE (<lg) — karta ── */}
      <div className="lg:hidden px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[13px] font-black text-brand tabular-nums">{index + 1}.</span>
          <div className="flex-1 min-w-0">{recipeSelect}</div>
          {moveActions}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">Mięso</span>
          {kgInput}
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">Półprodukt</span>
          {outputEl}
        </div>
        <div className="flex items-start justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-4 pt-1">Partie</span>
          <div className="flex-1 flex justify-end">{lotsBtn}</div>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-4">Status</span>
          {statusEl}
        </div>
      </div>

      {expanded && !locked && (
        <div className="px-3 pb-3 pt-2 border-t border-surface-3 bg-surface-2/50 grid grid-cols-1 lg:grid-cols-2 gap-3">
          <MeatLotPicker
            lots={lots} value={row.lots} targetKg={kg}
            onChange={next => onUpdate({ lots: next })}
            onAutoFefo={onAutoFefoRow} />
          <IngredientPreview
            recipe={recipes.find(r => r.id === row.recipeId)} meatKg={kg} />
        </div>
      )}
    </div>
  )
```

- [ ] **Step 2: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów.

- [ ] **Step 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/products/components/PlanRow.tsx
git commit -m "feat: PlanRow — karta na mobile (<lg), tabela na desktop (>=lg) bez zmian"
```

---

## Task 2: Editor kontener/nagłówki + Sidebar zwijany na mobile

**Files:**
- Modify: `src/features/products/components/MixingDayPlanEditor.tsx`
- Modify: `src/features/products/components/PlanStockSidebar.tsx`

- [ ] **Step 1: Kontener strony na `lg`**

W `MixingDayPlanEditor.tsx` zamień (linia 320):

```tsx
    <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_360px] gap-3 items-start">
```
na:
```tsx
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
```

- [ ] **Step 2: Nagłówek kolumn tylko na `lg`**

W `MixingDayPlanEditor.tsx` w wierszu nagłówka kolumn (linia 387) zmień `hidden md:grid` na `hidden lg:grid`:

```tsx
        <div className="hidden lg:grid grid-cols-[28px_20px_minmax(180px,1.2fr)_120px_96px_minmax(140px,1fr)_110px_88px] items-center gap-2 px-2.5 h-8 bg-surface-2 border-b border-surface-4 text-[10px] font-bold uppercase tracking-wide text-ink-4">
```

- [ ] **Step 3: Sidebar zwijany poniżej `lg` — import + stan**

W `PlanStockSidebar.tsx` zmień import lucide (linia 11):

```tsx
import { Warehouse, FlaskConical, ChevronDown, ChevronRight } from 'lucide-react'
```
i dodaj import `useState` na górze pliku (po linii 9 `import { fmtKg... }`):

```tsx
import { useState } from 'react'
```

- [ ] **Step 4: Sidebar — przełącznik na mobile + zawijanie treści**

W `PlanStockSidebar.tsx` w funkcji `PlanStockSidebar`, zaraz po `const shortages = ...` (linia 81) dodaj:

```tsx
  const [open, setOpen] = useState(false)   // rozwinięcie na mobile; na lg+ zawsze widoczne
```

Zamień nagłówek panelu (linie 85-88) na klikalny na mobile:

```tsx
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 bg-surface-2 border-b border-surface-4 flex items-center gap-2 lg:cursor-default">
        <Warehouse size={14} className="text-brand" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Magazyn do rozplanowania</span>
        <span className="ml-auto lg:hidden text-ink-4">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      <div className={cn(open ? 'block' : 'hidden', 'lg:block')}>
```

ORAZ dodaj zamknięcie tego `<div>` bezpośrednio przed końcowym `</div>` panelu (przed linią 129 `  )` zamykającą `return`). Konkretnie zamień końcówkę:

```tsx
        })
      )}
    </div>
  )
}
```
na:
```tsx
        })
      )}
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Typecheck**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck`
Expected: brak błędów.

- [ ] **Step 6: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/products/components/MixingDayPlanEditor.tsx src/features/products/components/PlanStockSidebar.tsx
git commit -m "feat: planowanie masowania — kontener/naglowki na lg, magazyn zwijany na mobile"
```

---

## Task 3: Weryfikacja wizualna (@390px telefon, @1280px desktop) + testy

**Files:** brak zmian — weryfikacja.

- [ ] **Step 1: Testy jednostkowe (bez regresji)**

Run: `cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck && TZ=UTC npm test 2>&1 | tail -4`
Expected: typecheck OK; 105/105.

- [ ] **Step 2: Dev proxy→prod + login**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
sed -i "s#target: process.env.VITE_API_URL || 'http://localhost:8000'#target: process.env.VITE_API_URL || 'http://127.0.0.1:8010'#" vite.config.ts
npm run dev -- --port 5183   # w tle; poczekaj na port 5183
```
Playwright: login (`am` / hasło od użytkownika jeśli sesja wygasła).

- [ ] **Step 3: Widok telefonu (390×800)**

`browser_resize 390 800` → `browser_navigate http://localhost:5183/office/planowanie-masowania`.
`browser_evaluate`: `() => ({ overflow: document.body.scrollWidth <= window.innerWidth + 2, cofnij: [...document.querySelectorAll('button')].filter(b=>b.textContent.trim()==='Cofnij').length })` — oczekiwane `overflow: true` (brak poziomego rozjazdu).
`browser_take_screenshot` (fullPage) — karty czytelne (Receptura/Mięso/Partie/Status), Magazyn zwinięty; kliknij nagłówek „Magazyn do rozplanowania" → rozwija listę partii.

- [ ] **Step 4: Widok desktop (1280×900)**

`browser_resize 1280 900` → reload. `browser_take_screenshot` — tabela z nagłówkami kolumn i sidebar z boku, identycznie jak przed zmianą (bez kart).

- [ ] **Step 5: Sprzątanie**

```bash
pkill -f "vite --port 5183"; cd /opt/kebab/kebab_new/kebab_fixed && git checkout -- vite.config.ts; rm -f vite.config.ts.timestamp-*.mjs
```
`browser_close`. Jeśli Step 3/4 pokażą problem (rozjazd, złe kolumny, desktop zmieniony) → wróć do Task 1/2.

- [ ] **Step 6: Deploy**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && git push origin main && bash deploy/deploy.sh frontend 2>&1 | tail -3
```
Expected: `✓ frontend OK — serwowany: main-…js`.
