# Masowanie: multi-machine fix + planowanie UI — Plan implementacji

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Model:** claude-opus-4-8

**Goal:** Zlecenie masowania pozostaje widoczne na liście HMI po załadowaniu pierwszej masownicy — operator może od razu załadować kolejną masownicę z tego samego zlecenia bez czekania 50 min.

**Architecture:** Zmiana filtra listy zleceń w `MixingTabletPage` (dodanie `in_progress` z kgRemaining > 0.1). Po częściowej sesji masowania operator wraca do DoneScreen (nie CooldownTimer) i klika "Kolejna maszyna" — lista odświeżona pokazuje zlecenie z pozostałymi kg. Backend niezmieniony.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, shadcn/ui

---

## Pliki do zmiany

- Modify: `src/pages/tablet/MixingTabletPage.tsx` (filtr listy, badge in_progress, handleStartMixing, usunięcie sekcji "Wznów")
- Modify: `src/features/products/components/MixingDayPlanEditor.tsx` (strzałki ▲▼, domyślne meatKg)

---

## Task 1: Filtr listy — dodaj zlecenia in_progress

**Files:**
- Modify: `src/pages/tablet/MixingTabletPage.tsx:660-665`

- [ ] **Krok 1: Zmień zapytanie plannedAll**

Otwórz `src/pages/tablet/MixingTabletPage.tsx`. Znajdź blok (ok. linia 660):

```tsx
const { data: plannedAll, loading, refetch } = useApi(() =>
  mixingOrdersApi.list().then((all: any[]) =>
    all.filter((o: any) => o.status === 'confirmed')
  )
)
const planned = plannedAll
```

Zastąp całość:

```tsx
const { data: plannedAll, loading, refetch } = useApi(() =>
  mixingOrdersApi.list().then((all: any[]) =>
    all
      .filter((o: any) =>
        o.status === 'confirmed' ||
        (o.status === 'in_progress' && ((o as any).kgRemaining ?? o.meatKg) > 0.1)
      )
      .sort((a: any, b: any) =>
        a.status === 'in_progress' && b.status !== 'in_progress' ? -1
        : b.status === 'in_progress' && a.status !== 'in_progress' ? 1
        : 0
      )
  )
)
const planned = plannedAll
```

- [ ] **Krok 2: Sprawdź TypeScript**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck 2>&1 | tail -20
```

Oczekiwane: `Found 0 errors.` lub istniejące błędy bez nowych.

- [ ] **Krok 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingTabletPage.tsx
git commit -m "fix(masowanie): lista HMI obejmuje in_progress z pozostałymi kg"
```

---

## Task 2: Badge aktywnej masownicy na karcie zlecenia in_progress

**Files:**
- Modify: `src/pages/tablet/MixingTabletPage.tsx` (sekcja listy zleceń, ok. linia 914-960)

Kafelki zleceń na liście powinny pokazywać która masownica masuje i ile minut pozostało, gdy zlecenie jest `in_progress`.

- [ ] **Krok 1: Dodaj helper do obliczania timerów aktywnych masownic**

W `MixingTabletPage` jest już `currentLocks = locks ?? []`. W sekcji renderowania listy (wewnątrz `phase === 'list'`, w bloku `.map(o => ...)`, ok. linia 915) dodaj przed `return`:

```tsx
{(planned??[]).map(o => {
  const kgDone      = (o as any).kgDone ?? 0
  const kgRemaining = (o as any).kgRemaining ?? o.meatKg
  const pct         = o.meatKg > 0 ? (kgDone / o.meatKg) * 100 : 0
  // Aktywne blokady maszyn dla tego zlecenia
  const orderLocks  = currentLocks.filter((l: any) => l.orderId === o.id)
  return (
```

Upewnij się, że zamknięcie bloku `})` jest na końcu (bez zmian).

- [ ] **Krok 2: Dodaj badge in_progress do karty zlecenia**

W tej samej karcie zlecenia, po linii z `o.productTypeName` (ok.:
```tsx
{o.productTypeName && <div className="text-sm text-ink-3">{o.productTypeName}</div>}
```
), dodaj:

```tsx
{o.status === 'in_progress' && orderLocks.length > 0 && (
  <div className="flex flex-wrap gap-1 mt-1">
    {orderLocks.map((l: any) => {
      const minsLeft = Math.max(0, Math.ceil((new Date(l.unlocksAt).getTime() - Date.now()) / 60000))
      return (
        <span key={l.machineId}
          className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">
          <Timer size={9} /> Masownica {l.machineId} · {minsLeft} min
        </span>
      )
    })}
  </div>
)}
{o.status === 'in_progress' && orderLocks.length === 0 && (
  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 border border-blue-200 mt-1">
    Do wznowienia
  </span>
)}
```

Upewnij się, że `Timer` jest już w importach na górze pliku:
```tsx
import {
  Play, CheckCircle, RotateCcw, AlertTriangle,
  Scale, ClipboardList, Lock, Timer, Beef, ChevronLeft, Home, Info, LogOut,
} from 'lucide-react'
```
`Timer` już tam jest — brak potrzeby zmiany importów.

- [ ] **Krok 3: Sprawdź TypeScript**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck 2>&1 | tail -20
```

- [ ] **Krok 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingTabletPage.tsx
git commit -m "fix(masowanie): badge aktywnej masownicy na karcie zlecenia in_progress"
```

---

## Task 3: handleStartMixing — częściowa sesja → DoneScreen, nie CooldownTimer

**Files:**
- Modify: `src/pages/tablet/MixingTabletPage.tsx:769-790`

Teraz po załadowaniu masownicy 3 (600 kg z 3000 kg) operator widzi 50-minutowy CooldownTimer i musi czekać. Po zmianie: częściowa sesja → DoneScreen z przyciskiem "Kolejna maszyna" → lista.

- [ ] **Krok 1: Zmień handleStartMixing**

Znajdź blok (ok. linia 769):

```tsx
const handleStartMixing = useCallback(async () => {
  if (!liveOrder) return
  try {
    const finished = await finishMut.mutate({ id: liveOrder.id, kg: kgActual, batchNo: '', lotAllocations: lotAllocs })
    setLiveOrder(finished)
    // Prawdziwy numer partii nadaje backend (np. 326 / PP1) — bierzemy go z ostatniej sesji,
    // a nie budujemy z numeru zlecenia (który jest teraz MAS/dd/mm/rr).
    const sess = (finished as any).sessions || []
    const batchNo = sess.length ? (sess[sess.length - 1]?.batchNo || '') : ''
    setSeasonedBatchNo(batchNo)
    // BUG (zgłoszony: "3000 kg znika po 600 kg"): warunek miał odwrócony status
    // ('in_progress' zamiast 'done') — częściowy wsad pokazywał "Zakończ
    // masowanie", a klik robił auto-approve całego zlecenia.
    const fullyDone = (finished as any).kgRemaining < 0.1 || finished.status === 'done'
    setSessionFullyDone(fullyDone)
    const lock = await lockMut.mutate({ m: liveOrder.machineId!, id: liveOrder.id, no: liveOrder.orderNo })
    setActiveLock(lock)
    setPhase('done')
    refetch(); rIP(); rL()
  } catch(e) { showToast(e instanceof Error ? e.message : 'Błąd') }
}, [liveOrder, kgActual, lotAllocs, finishMut, lockMut, refetch, rIP, rL])
```

Zastąp całość:

```tsx
const handleStartMixing = useCallback(async () => {
  if (!liveOrder) return
  try {
    const finished = await finishMut.mutate({ id: liveOrder.id, kg: kgActual, batchNo: '', lotAllocations: lotAllocs })
    setLiveOrder(finished)
    const sess = (finished as any).sessions || []
    const batchNo = sess.length ? (sess[sess.length - 1]?.batchNo || '') : ''
    setSeasonedBatchNo(batchNo)
    const fullyDone = (finished as any).kgRemaining < 0.1 || finished.status === 'done'
    setSessionFullyDone(fullyDone)
    const lock = await lockMut.mutate({ m: liveOrder.machineId!, id: liveOrder.id, no: liveOrder.orderNo })
    // Pełna sesja → CooldownTimer (operator musi czekać na ostygnięcie).
    // Częściowa sesja → DoneScreen z "Kolejna maszyna" — operator może od razu
    // załadować kolejną masownicę. Blokada maszyny i tak jest w DB i widać ją
    // jako "🔒 X min" w MachineScreen przy wyborze maszyny dla kolejnej sesji.
    setActiveLock(fullyDone ? lock : null)
    setPhase('done')
    refetch(); rIP(); rL()
  } catch(e) { showToast(e instanceof Error ? e.message : 'Błąd') }
}, [liveOrder, kgActual, lotAllocs, finishMut, lockMut, refetch, rIP, rL])
```

- [ ] **Krok 2: Sprawdź TypeScript**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck 2>&1 | tail -20
```

- [ ] **Krok 3: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingTabletPage.tsx
git commit -m "fix(masowanie): częściowa sesja → DoneScreen, nie CooldownTimer"
```

---

## Task 4: Usuń sekcję "Wznów sesję" i zmienną resumable (redundantna)

**Files:**
- Modify: `src/pages/tablet/MixingTabletPage.tsx:793-881`

Sekcja "Wznów sesję" była potrzebna gdy `in_progress` nie pojawiało się na głównej liście. Teraz jest redundantna. Zmienna `cooling` ZOSTAJE — jest nadal używana w sekcji "Masownice w pracy" i "Suma wszystkich masownic".

- [ ] **Krok 1: Usuń zmienną resumable**

Znajdź blok (ok. linia 793):

```tsx
const resumable = (inProgress ?? []).filter(o =>
  !currentLocks.some(l => l.orderId === o.id)
)
const cooling = (inProgress ?? []).filter(o =>
  currentLocks.some(l => l.orderId === o.id)
)
```

Usuń TYLKO linię `resumable` (2 linie). `cooling` zostaw bez zmian:

```tsx
const cooling = (inProgress ?? []).filter(o =>
  currentLocks.some(l => l.orderId === o.id)
)
```

- [ ] **Krok 2: Usuń blok resumable z JSX**

Znajdź blok (ok. linia 868):

```tsx
{resumable.length > 0 && (
  <div className="bg-blue-50 border-b border-blue-200 px-5 py-3">
    <div className="text-[11px] font-semibold text-blue-700 mb-1.5 flex items-center gap-1.5">
      <AlertTriangle size={13} /> Wznów sesję
    </div>
    {resumable.map(o => (
      <button key={o.id} onClick={() => { setSelOrder(o); setLiveOrder(o); setPhase('machine') }}
        className="w-full text-left bg-white border border-blue-200 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-blue-700 hover:bg-blue-50 mb-1.5">
        {o.orderNo} · {o.recipeName} · zostało {fmtKg((o as any).kgRemaining ?? o.meatKg, 0)} kg → Wznów
      </button>
    ))}
  </div>
)}
```

Usuń cały blok (9 linii od `{resumable.length > 0 &&` do zamykającego `}`).

- [ ] **Krok 3: Sprawdź TypeScript i brak referencji do resumable**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck 2>&1 | tail -20
grep -n "resumable" src/pages/tablet/MixingTabletPage.tsx
```

Oczekiwane: brak wyników `grep resumable`, TypeScript OK.

- [ ] **Krok 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/pages/tablet/MixingTabletPage.tsx
git commit -m "refactor(masowanie): usuń sekcję 'Wznów sesję' — in_progress na liście głównej"
```

---

## Task 5: MixingDayPlanEditor — większe strzałki ▲▼

**Files:**
- Modify: `src/features/products/components/MixingDayPlanEditor.tsx:164-169`

- [ ] **Krok 1: Zamień przyciski strzałek**

Znajdź blok (ok. linia 164):

```tsx
<div className="flex flex-col flex-shrink-0">
  <button onClick={() => move(i, -1)} disabled={i === 0}
    className="h-4 text-muted-foreground hover:text-ink disabled:opacity-20"><ArrowUp size={12}/></button>
  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
    className="h-4 text-muted-foreground hover:text-ink disabled:opacity-20"><ArrowDown size={12}/></button>
</div>
```

Zastąp:

```tsx
<div className="flex flex-col flex-shrink-0 gap-0.5">
  <button onClick={() => move(i, -1)} disabled={i === 0}
    className="h-8 w-8 rounded flex items-center justify-center cursor-pointer text-muted-foreground hover:text-ink hover:bg-muted/60 disabled:opacity-20 disabled:cursor-not-allowed">
    <ArrowUp size={14}/>
  </button>
  <button onClick={() => move(i, 1)} disabled={i === rows.length - 1}
    className="h-8 w-8 rounded flex items-center justify-center cursor-pointer text-muted-foreground hover:text-ink hover:bg-muted/60 disabled:opacity-20 disabled:cursor-not-allowed">
    <ArrowDown size={14}/>
  </button>
</div>
```

- [ ] **Krok 2: Zmień domyślne meatKg dla nowego wiersza**

Znajdź (ok. linia 190):

```tsx
onClick={() => { setRows(p => [...p, { recipeId: '', meatKg: '', status: 'new' }]); setDirty(true) }}
```

Zastąp:

```tsx
onClick={() => { setRows(p => [...p, { recipeId: '', meatKg: '100', status: 'new' }]); setDirty(true) }}
```

- [ ] **Krok 3: Sprawdź TypeScript**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npm run typecheck 2>&1 | tail -20
```

- [ ] **Krok 4: Commit**

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add src/features/products/components/MixingDayPlanEditor.tsx
git commit -m "fix(planowanie): strzałki ▲▼ 32px + domyślne 100 kg w nowym wierszu"
```

---

## Task 6: Weryfikacja manualna

Uruchom dev server i przetestuj:

- [ ] **Krok 1: Uruchom serwer**

```bash
cd /opt/kebab/kebab_new/kebab_fixed && npm run dev
```

- [ ] **Krok 2: Test planowania (MixingDayPlanEditor)**

1. Otwórz panel biura → Planowanie masowania
2. Kliknij `+ Dodaj pozycję` — powinno pojawić się pole z recepturą i `100` kg
3. Kliknij strzałkę ▲ na drugiej pozycji — powinna zmienić się kolejność
4. Kliknij strzałkę ▼ — powinna wrócić na miejsce
5. Zapisz plan — biuro widzi "Plan zapisany"

- [ ] **Krok 3: Test multi-machine HMI (wymaga danych w bazie)**

1. Otwórz tablet masowania (`/tablet/mixing-hmi-v1` lub `/tablet/mixing`)
2. Powinno być widoczne zlecenie ze statusem `confirmed`
3. Kliknij zlecenie → wybierz masownicę 3 → wpisz 600 kg → zatwierdź składniki → "Rozpocznij masowanie"
4. Po kliknięciu "Kolejna maszyna" — lista powinna pokazywać to samo zlecenie z "2400 kg pozostało" i badge "Masownica 3 · 49 min"
5. Kliknij zlecenie → w MachineScreen masownica 3 jest zablokowana (🔒), masownice 1 i 2 wolne
6. Wybierz masownicę 1 → wpisz 200 kg → zatwierdź → "Rozpocznij masowanie"
7. Wróć do listy — zlecenie pokazuje "2200 kg pozostało", 2 badge aktywnych masownic

- [ ] **Krok 4: Commit weryfikacji (jeśli są poprawki)**

Jeśli podczas testów znaleziono drobne problemy i je naprawiono:

```bash
cd /opt/kebab/kebab_new/kebab_fixed
git add -p  # dodaj tylko zmienione pliki
git commit -m "fix(masowanie): poprawki po weryfikacji manualnej"
```
