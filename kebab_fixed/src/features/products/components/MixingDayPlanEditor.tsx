/**
 * MixingDayPlanEditor — plan dnia masowania (serce strony planowania).
 *
 * Biuro układa kolejkę 1→n receptur z OBOWIĄZKOWYM przypisaniem partii mięsa
 * FEFO. Pozycje w masownicy (in_progress) i gotowe (done) są zablokowane
 * (tylko kolejność). Auto-FEFO całość rozdziela dostępne partie po wierszach.
 * Zapis = PUT /api/mixing-orders/day-plan; panel operatora wykrywa zmianę (rev).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { mixingOrdersApi, meatStockApi } from '@/lib/apiClient'
import { useRecipes } from '@/features/ingredients/hooks'
import { fmtKg, todayIso, cn } from '@/lib/utils'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  CalendarDays, ChevronLeft, ChevronRight, Loader2, Plus, Printer, Save, Zap,
} from 'lucide-react'
import { PlanRow, type PlanRowData } from './PlanRow'
import type { PickerLot } from './MeatLotPicker'
import { PlanStockSidebar, type SpiceNeed } from './PlanStockSidebar'
import { autoFefoDistribute, type AvailLot } from '../lib/autoFefo'
import { reservedByLot, withDayPool, liveFreeByLot } from '../lib/planLiveBalance'
import { ConfirmMixingSplitDialog } from './ConfirmMixingSplitDialog'
import type { FinishBatch, SplitLotInput } from '../lib/mixingSplit'

// Przesunięcie daty ISO (YYYY-MM-DD) o N dni — bez zależności od strefy,
// liczymy na składnikach roku/miesiąca/dnia (Date lokalny o północy).
function shiftIsoDate(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, (m - 1), d + days)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

export function MixingDayPlanEditor({ onSaved }: { onSaved?: () => void }) {
  const { recipes, stock: spiceStock } = useRecipes()
  const [planDate, setPlanDate] = useState(todayIso())
  const [rows, setRows] = useState<PlanRowData[]>([])
  const [meatLots, setMeatLots] = useState<any[]>([])
  // Rezerwacje mięsa trzymane przez ZAPISANY plan tego dnia (stan z serwera).
  // kg_free z API już je odjęło — edytor oddaje je do puli dnia (withDayPool),
  // bo zapis planu najpierw zwalnia stare loty, potem rezerwuje nowe.
  const [savedByLot, setSavedByLot] = useState<Map<string, number>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null)
  const [splitRow, setSplitRow] = useState<PlanRowData | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const dragIdx = useRef<number | null>(null)
  const dirtyRef = useRef(dirty)
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const isToday = planDate === todayIso()
  // Plan z minionego dnia = tylko podgląd (część mięsa już zeszła, partie
  // skonsumowane). Edycja wstecz mogłaby zepsuć historię/rezerwacje — blokujemy
  // ją, ale partie i ilość mięsa nadal widać (do wydruku planu historycznego).
  const isPast = planDate < todayIso()
  // Partie mięsa NIE są wymagane do zapisu planu na dziś ani na przyszłość —
  // rozbiór często pracuje jeszcze mięso w trakcie dnia, a biuro chce zapisać
  // i przedstawić operatorowi WSTĘPNY plan; partie dogrywa się (Auto-FEFO),
  // gdy surowiec zejdzie, przed potwierdzeniem wykonania. Wymagane tylko przy
  // edycji planu wstecz (przeszłość). Jeśli partie JUŻ podano — muszą zgadzać
  // się z kg (patrz save/allLotsComplete).
  const requireLots = planDate < todayIso()

  // Partie mięsa do dyspozycji TEGO planu, FEFO. kgAvailable = PULA DNIA:
  // kg_free z API (available − reserved; NIE odejmować kgReserved drugi raz!)
  // + własne rezerwacje wczytanego planu (withDayPool) — po zapisie planu
  // saldo nie znika i nie jest odejmowane podwójnie.
  const pickerLots: PickerLot[] = useMemo(() =>
    withDayPool(
      (meatLots ?? [])
        .filter((m: any) => m.status !== 'DEPLETED' && m.status !== 'IN_PRODUCTION')
        .map((m: any) => ({
          id: m.id,
          lotNo: m.lotNo,
          rawBatchNo: m.rawBatchNo,
          kgAvailable: Math.max(0, Number(m.kgAvailable)),
          expiryDate: m.expiryDate,
          materialName: m.materialName,
          materialTypeId: m.materialTypeId,
          supplierName: m.supplierName,
        })),
      savedByLot,
    ).sort((a: PickerLot, b: PickerLot) => (a.expiryDate < b.expiryDate ? -1 : 1)),
    [meatLots, savedByLot],
  )

  // Rozdział składników: filet/indyk (przyjęte bez rozbioru) to INNY materiał
  // niż mięso z/s — Auto-FEFO rozdziela TYLKO z/s, filet dobiera się ręcznie
  // w pickerze (osobna sekcja). Inaczej automat mieszał filet do kebaba z/s.
  const zsLots = useMemo(
    () => pickerLots.filter(l => (l.materialTypeId ?? 'mat-mieso-zs') === 'mat-mieso-zs'),
    [pickerLots],
  )
  const otherLots = useMemo(
    () => pickerLots.filter(l => (l.materialTypeId ?? 'mat-mieso-zs') !== 'mat-mieso-zs'),
    [pickerLots],
  )
  const zsPool = zsLots.reduce((s, l) => s + l.kgAvailable, 0)

  // Ile bieżący SZKIC planu bierze z każdej partii — żywe saldo: zaznaczenie
  // partii w pickerze od razu schodzi z puli we wszystkich widokach,
  // odznaczenie wraca.
  const plannedByLot = useMemo(() => reservedByLot(rows), [rows])
  const liveFree = useMemo(
    () => liveFreeByLot(pickerLots, plannedByLot),
    [pickerLots, plannedByLot],
  )

  async function load() {
    try {
      // Plan i magazyn w PARZE (z tej samej chwili) — pula dnia to
      // kg_free + rezerwacje planu; mieszanie odczytów z różnych momentów
      // dawałoby fałszywe saldo tuż po zapisie.
      const [r, ms] = await Promise.all([
        mixingOrdersApi.dayPlan(planDate),
        meatStockApi.list(true),
      ])
      const mapped = (r.items ?? []).map((o: any) => ({
        rowKey: o.id, id: o.id, recipeId: o.recipeId, meatKg: String(o.meatKg),
        status: o.status, orderNo: o.orderNo, kgDone: o.kgDone,
        lots: (o.meatLots ?? []).map((l: any) => ({ meatLotId: l.meatLotId, kgPlanned: l.kgPlanned, kgActual: l.kgActual, lotNo: l.meatLotNo })),
      }))
      setRows(mapped)
      setSavedByLot(reservedByLot(mapped))
      setMeatLots(ms.data ?? [])
      setLoaded(true)
      setDirty(false)
    } catch { setLoaded(true) }
  }

  // Wczytaj plan przy montażu I przy zmianie wybranego dnia; odświeżaj co
  // 15 s (dla dnia bieżąco oglądanego), ale NIE nadpisuj edycji w toku
  // (dirty czytane przez ref, by efekt nie restartował przy każdej zmianie
  // dirty — inaczej dodanie wiersza natychmiast kasuje load()em).
  useEffect(() => {
    setExpandedKey(null)
    load()
    const t = setInterval(() => { if (!dirtyRef.current) load() }, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planDate])

  const recipeOutput = (recipeId: string, meatKg: number) => {
    const r = recipes.find((x: any) => x.id === recipeId)
    if (!r || meatKg <= 0) return 0
    const ingKg = (r.ingredients ?? [])
      .filter((ri: any) => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
      .reduce((s: number, ri: any) => s + (ri.qtyPer100kg * meatKg) / 100, 0)
    return Math.round((meatKg + ingKg) * 100) / 100
  }

  function update(idx: number, patch: Partial<PlanRowData>) {
    setRows(p => p.map((r, i) => i === idx ? { ...r, ...patch } : r)); setDirty(true)
  }
  function move(idx: number, dir: -1 | 1) {
    setRows(p => {
      const n = [...p]; const j = idx + dir
      if (j < 0 || j >= n.length) return p
      ;[n[idx], n[j]] = [n[j], n[idx]]; return n
    }); setDirty(true)
  }
  function reorder(from: number, to: number) {
    setRows(p => {
      if (from === to || from < 0 || to < 0) return p
      const n = [...p]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n
    }); setDirty(true)
  }
  function remove(idx: number) {
    setRows(p => p.filter((_, j) => j !== idx)); setDirty(true)
  }
  function addRow() {
    const key = `new-${Date.now()}`
    setRows(p => [...p, { rowKey: key, recipeId: '', meatKg: '100', status: 'new', lots: [] }])
    setExpandedKey(key); setDirty(true)
  }

  // Auto-FEFO ten wiersz: bierze pulę pomniejszoną o loty INNYCH wierszy
  function autoFefoRow(idx: number) {
    const row = rows[idx]
    const kg = parseFloat(row.meatKg) || 0
    const usedElsewhere = new Map<string, number>()
    rows.forEach((r, i) => {
      if (i === idx) return
      r.lots.forEach(l => usedElsewhere.set(l.meatLotId, (usedElsewhere.get(l.meatLotId) ?? 0) + l.kgPlanned))
    })
    const avail: AvailLot[] = zsLots.map(l => ({
      id: l.id, expiryDate: l.expiryDate,
      kgFree: Math.max(0, l.kgAvailable - (usedElsewhere.get(l.id) ?? 0)),
    }))
    const dist = autoFefoDistribute([{ rowKey: row.rowKey, kg }], avail)
    update(idx, { lots: dist[row.rowKey] ?? [] })
  }

  // Auto-FEFO całość: rozdziela pulę po wierszach edytowalnych w kolejności.
  // Pozycje zablokowane (w masownicy) trzymają swoje loty — ich kg schodzą
  // z puli przed rozdziałem.
  function autoFefoAll() {
    const editable = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status !== 'in_progress' && r.status !== 'done')
    const lockedUsed = new Map<string, number>()
    rows.forEach(r => {
      if (r.status !== 'in_progress' && r.status !== 'done') return
      r.lots.forEach(l =>
        lockedUsed.set(l.meatLotId, (lockedUsed.get(l.meatLotId) ?? 0) + (l.kgPlanned || 0)))
    })
    const avail: AvailLot[] = zsLots.map(l => ({
      id: l.id, expiryDate: l.expiryDate,
      kgFree: Math.max(0, l.kgAvailable - (lockedUsed.get(l.id) ?? 0)),
    }))
    const needs = editable.map(({ r }) => ({ rowKey: r.rowKey, kg: parseFloat(r.meatKg) || 0 }))
    const dist = autoFefoDistribute(needs, avail)
    setRows(p => p.map(r =>
      (r.status === 'in_progress' || r.status === 'done') ? r : { ...r, lots: dist[r.rowKey] ?? r.lots }
    ))
    setDirty(true)
  }

  const totalPlan = rows.reduce((s, r) => s + (parseFloat(r.meatKg) || 0), 0)
  const totalOutput = rows.reduce((s, r) => s + recipeOutput(r.recipeId, parseFloat(r.meatKg) || 0), 0)
  // Zapotrzebowanie planu na z/s: cały plan minus kg przypisane do fileta/innych
  // — kg bez przypisanej partii liczą się jako z/s (tak rozdziela Auto-FEFO),
  // więc saldo schodzi już przy wpisaniu kg pozycji, nie dopiero po dobraniu partii.
  const assignedOtherKg = otherLots.reduce((s, l) => s + (plannedByLot.get(l.id) ?? 0), 0)
  const zsDemand = Math.max(0, totalPlan - assignedOtherKg)
  const zsLeft = zsPool - zsDemand
  const overBudget = zsDemand > zsPool + 0.5

  // Zbiorcze zapotrzebowanie przypraw wg planu vs stan magazynu przypraw.
  // Kolejność = kolejność w recepturach (nie alfabetyczna) — spójna z
  // wydrukiem i z tym, jak planista dodaje składniki do receptury.
  const spiceNeeds: SpiceNeed[] = useMemo(() => {
    const stockById = new Map((spiceStock ?? []).map((s: any) => [s.ingredientId, s.qtyAvailable ?? 0]))
    const acc = new Map<string, SpiceNeed>()
    rows.forEach(r => {
      const kg = parseFloat(r.meatKg) || 0
      const rec: any = recipes.find((x: any) => x.id === r.recipeId)
      if (!rec || kg <= 0) return
      ;(rec.ingredients ?? []).forEach((ri: any) => {
        const cur = acc.get(ri.ingredientId) ?? {
          ingredientId: ri.ingredientId, name: ri.ingredientName, unit: ri.unit,
          need: 0, stock: Number(stockById.get(ri.ingredientId) ?? 0),
          isUnlimited: !!ri.isUnlimited,
        }
        cur.need += (ri.qtyPer100kg * kg) / 100
        acc.set(ri.ingredientId, cur)
      })
    })
    return [...acc.values()]
  }, [rows, recipes, spiceStock])

  // Gating zapisu. Plan wstępny (dziś/przyszłość, !requireLots): partie mogą być
  // BRAKUJĄCE albo CZĘŚCIOWE — rozbiór wciąż pracuje mięso, więc przypisujesz
  // partie na tyle ile masz, resztę dogrywasz Auto-FEFO. Blokujemy tylko NADMIAR
  // (nie wolno zarezerwować więcej kg niż pozycja potrzebuje). Edycja wstecz
  // (requireLots): pełne pokrycie partiami nadal obowiązkowe.
  const allLotsComplete = rows.every(r => {
    if (r.status === 'in_progress' || r.status === 'done') return true
    const kg = parseFloat(r.meatKg) || 0
    if (!r.recipeId || kg <= 0) return false
    const lotKg = r.lots.reduce((s, l) => s + (l.kgPlanned || 0), 0)
    if (!requireLots) return lotKg <= kg + 0.5
    if (r.lots.length === 0) return false
    return lotKg >= kg - 0.5
  })

  async function save() {
    setError('')
    if (!allLotsComplete) {
      setError(requireLots
        ? 'Każda pozycja musi mieć recepturę, kg > 0 i kompletne partie mięsa'
        : 'Każda pozycja musi mieć recepturę i kg > 0 (partie mogą być częściowe, ale nie mogą przekraczać kg pozycji)')
      return
    }
    setSaving(true)
    try {
      await mixingOrdersApi.saveDayPlan(rows.map((r, i) => ({
        id: r.id, recipeId: r.recipeId, meatKg: parseFloat(r.meatKg), seq: i + 1,
        meatLots: r.lots,
      })), planDate)
      await load()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu planu')
    } finally {
      setSaving(false)
    }
  }

  // Potwierdzenie wykonania BEZ HMI na masownicy: biuro potwierdza, że pozycja
  // została fizycznie wymieszana w całości (kgActual = zaplanowane kg) — to
  // wywołuje TĘ SAMĄ ścieżkę co zakończenie sesji z tabletu (finish-session):
  // mięso przyprawione trafia na magazyn, partie mięsa z planu są konsumowane,
  // przyprawy schodzą z magazynu FIFO, zlecenie dostaje status 'done'.
  async function confirmExecution(row: PlanRowData) {
    if (!row.id || !isToday) return
    const kg = parseFloat(row.meatKg) || 0
    const lotsWithKg = row.lots.filter(l => (l.kgPlanned || 0) > 0)
    // ≥2 partie → dialog podziału (czyste per partia + jedna mieszana PP).
    if (lotsWithKg.length >= 2) {
      setSplitRow(row)
      return
    }
    // 0/1 partia → jak dotąd: jedno potwierdzenie całości (backend nada czysty numer).
    if (!window.confirm(
      `Potwierdzić wykonanie: ${row.recipeId ? recipes.find((r: any) => r.id === row.recipeId)?.name ?? '' : ''} — ${fmtKg(kg, 0)} kg mięsa?\n\nMięso przyprawione wejdzie na magazyn, partie mięsa i przyprawy zostaną rozchodowane. Tej operacji nie da się cofnąć z tego ekranu.`
    )) return
    setConfirmingKey(row.rowKey)
    try {
      await mixingOrdersApi.finishSession(row.id, kg, '', [])
      await load()
      toast.success('Wykonanie potwierdzone — mięso przyprawione trafiło na magazyn')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd potwierdzenia wykonania')
    } finally {
      setConfirmingKey(null)
    }
  }

  // Potwierdzenie z podziałem: sekwencja finishSession (mieszana ostatnia domyka zlecenie).
  async function runSplitConfirm(row: PlanRowData, batches: FinishBatch[]) {
    setConfirmingKey(row.rowKey)
    try {
      for (const b of batches) {
        await mixingOrdersApi.finishSession(row.id!, b.kg, '', b.lotAllocations)
      }
      toast.success('Potwierdzone — partie zapisane (czyste + ewentualna mieszana PP)')
      setSplitRow(null)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd — zlecenie mogło zostać potwierdzone częściowo')
      await load()
    } finally {
      setConfirmingKey(null)
    }
  }

  // Cofnięcie potwierdzenia (undo): odwraca finish; działa tylko gdy partia niezużyta.
  async function undoConfirmExecution(row: PlanRowData) {
    if (!row.id || !isToday) return
    if (!window.confirm(
      `Cofnąć potwierdzenie: ${recipes.find((r: any) => r.id === row.recipeId)?.name ?? ''}?\n\nUsunie partię przyprawionego, przywróci mięso i przyprawy, zlecenie wróci do kolejki. Działa tylko gdy nic nie zużyto na produkcji.`
    )) return
    setConfirmingKey(row.rowKey)
    try {
      await mixingOrdersApi.undoConfirm(row.id)
      await load()
      toast.success('Cofnięto potwierdzenie — zlecenie wróciło do kolejki')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Nie można cofnąć potwierdzenia')
    } finally {
      setConfirmingKey(null)
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-3 items-start">
      {/* ── Plan dnia (lewa kolumna) ── */}
      <div className="bg-white border border-surface-4 rounded-lg overflow-hidden">
        {/* Pasek tytułu — Subiekt: tytuł + sumy + akcje w jednej linii */}
        <div className="px-4 py-2.5 bg-surface-2 border-b border-surface-4 flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <div className="flex items-center gap-1.5">
            <CalendarDays size={14} className="text-brand flex-shrink-0" />
            <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2 whitespace-nowrap">
              Plan masowania
            </span>
            <div className="flex items-center gap-0.5 ml-1">
              <button onClick={() => setPlanDate(d => shiftIsoDate(d, -1))}
                className="w-6 h-6 rounded flex items-center justify-center text-ink-3 hover:bg-surface-3"
                title="Dzień wcześniej">
                <ChevronLeft size={14} />
              </button>
              <input type="date" value={planDate} onChange={e => e.target.value && setPlanDate(e.target.value)}
                className="h-7 px-1.5 text-[12px] font-bold text-ink border border-surface-4 rounded bg-white" />
              <button onClick={() => setPlanDate(d => shiftIsoDate(d, 1))}
                className="w-6 h-6 rounded flex items-center justify-center text-ink-3 hover:bg-surface-3"
                title="Dzień później">
                <ChevronRight size={14} />
              </button>
              {!isToday && (
                <button onClick={() => setPlanDate(todayIso())}
                  className="ml-1 text-[11px] font-bold text-brand hover:underline whitespace-nowrap">
                  Dziś
                </button>
              )}
            </div>
            {isPast && (
              <span className="text-[10px] font-bold text-ink-2 bg-surface-3 border border-surface-4 rounded px-1.5 py-0.5 whitespace-nowrap">
                plan historyczny — tylko podgląd
              </span>
            )}
            {!isToday && !isPast && (
              <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 whitespace-nowrap">
                plan na przyszłość — partie mięsa opcjonalne
              </span>
            )}
          </div>
          <span className="text-[12px] font-bold text-ink [font-variant-numeric:tabular-nums]">
            {fmtKg(totalPlan, 0)} kg mięsa → <span className="text-emerald-700">{fmtKg(totalOutput, 0)} kg półproduktu</span>
          </span>
          {overBudget && (
            <span className="text-[11px] font-bold text-red-600 uppercase">
              plan przekracza wolne z/s ({fmtKg(zsPool, 0)} kg)!
            </span>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!isPast && (
              <>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-[12px]" onClick={autoFefoAll}
                  title="Rozdziel wolne partie z/s po wszystkich pozycjach wg terminu ważności">
                  <Zap size={13} /> Auto-FEFO całość
                </Button>
                <Button size="sm" variant="outline" className="h-8 gap-1 text-[12px]" onClick={addRow}>
                  <Plus size={13} /> Dodaj pozycję
                </Button>
              </>
            )}
            <Button size="sm" variant="outline" className="h-8 gap-1 text-[12px]"
              disabled={dirty || rows.length === 0}
              title={dirty ? 'Najpierw zapisz plan — wydruk pokazuje ZAPISANY plan' : 'Wydruk planu dla operatora: kolejka + przyprawy łącznie + przepisy na wsady 200/600 kg'}
              onClick={() => window.open(`/office/plan-masowania/druk?date=${planDate}`, '_blank')}>
              <Printer size={13} /> Plan dla operatora
            </Button>
            {!isPast && (
              <Button size="sm" disabled={saving || !dirty || !allLotsComplete} onClick={save}
                className="h-8 gap-1.5 text-[12px]">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                {dirty ? 'Zapisz plan' : 'Plan zapisany'}
              </Button>
            )}
          </div>
        </div>

        {/* Nagłówek kolumn */}
        <div className="hidden lg:grid grid-cols-[28px_20px_minmax(180px,1.2fr)_120px_96px_minmax(140px,1fr)_110px_88px] items-center gap-2 px-2.5 h-8 bg-surface-2 border-b border-surface-4 text-[10px] font-bold uppercase tracking-wide text-ink-4">
          <span />
          <span className="text-center">Lp</span>
          <span>Receptura</span>
          <span className="text-right pr-1">Mięso [kg]</span>
          <span className="text-right">Półprodukt</span>
          <span>Partie mięsa</span>
          <span>Status</span>
          <span className="text-right pr-1">Akcje</span>
        </div>

        <div>
          {!loaded ? (
            <div className="text-[12px] text-ink-4 py-6 text-center">Wczytuję…</div>
          ) : rows.length === 0 ? (
            <div className="text-[12px] text-ink-4 py-8 text-center">
              {isPast
                ? `Brak planu na ten dzień.`
                : <>Brak planu na {isToday ? 'dziś' : 'ten dzień'} — <button onClick={addRow} className="text-brand font-semibold hover:underline">dodaj pierwszą pozycję</button></>}
            </div>
          ) : (
            rows.map((r, i) => (
              <PlanRow
                key={r.rowKey}
                row={r}
                index={i}
                total={rows.length}
                recipes={recipes ?? []}
                lots={pickerLots}
                liveFree={liveFree}
                output={recipeOutput(r.recipeId, parseFloat(r.meatKg) || 0)}
                expanded={expandedKey === r.rowKey}
                onUpdate={patch => update(i, patch)}
                onMove={dir => move(i, dir)}
                onDelete={() => remove(i)}
                onToggle={() => setExpandedKey(k => k === r.rowKey ? null : r.rowKey)}
                onAutoFefoRow={() => autoFefoRow(i)}
                onConfirmExecution={() => confirmExecution(r)}
                onUndoConfirm={() => undoConfirmExecution(r)}
                confirmingExecution={confirmingKey === r.rowKey}
                canConfirmExecution={!dirty && !!r.id}
                showConfirmExecution={isToday}
                readOnly={isPast}
                dragHandlers={{
                  draggable: true,
                  onDragStart: () => { dragIdx.current = i },
                  onDragOver: e => e.preventDefault(),
                  onDrop: () => { if (dragIdx.current !== null) reorder(dragIdx.current, i); dragIdx.current = null },
                  onDragEnd: () => { dragIdx.current = null },
                }}
              />
            ))
          )}

          {error && (
            <div className="mx-3 my-2 text-[11px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded">
              {error}
            </div>
          )}

          {/* Stopka sum — jak w tabelach Subiekta */}
          {loaded && rows.length > 0 && (
            <div className={cn(
              'px-3 py-2 bg-surface-2 border-t border-surface-4 flex items-center gap-4 text-[12px] font-semibold text-ink-2 [font-variant-numeric:tabular-nums]',
            )}>
              <span>Pozycji: {rows.length}</span>
              <span className="ml-auto">Mięso: <b className="text-ink">{fmtKg(totalPlan, 0)} kg</b></span>
              <span>Półprodukt: <b className="text-emerald-700">{fmtKg(totalOutput, 0)} kg</b></span>
              <span className={overBudget ? 'text-red-600 font-bold' : ''}>
                Wolne z/s po planie: <b>{fmtKg(zsLeft, 0)} kg</b>
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── Magazyn do rozplanowania (prawa kolumna) ── */}
      <PlanStockSidebar
        zsLots={zsLots}
        otherLots={otherLots}
        plannedByLot={plannedByLot}
        spiceNeeds={spiceNeeds}
        planTotalKg={totalPlan}
      />

      {splitRow && (
        <ConfirmMixingSplitDialog
          open
          recipeName={recipes.find((r: any) => r.id === splitRow.recipeId)?.name ?? ''}
          meatKg={parseFloat(splitRow.meatKg) || 0}
          lots={splitRow.lots
            .filter(l => (l.kgPlanned || 0) > 0)
            .map((l): SplitLotInput => ({
              meatLotId: l.meatLotId,
              lotNo: l.lotNo ?? '?',
              kgPlanned: l.kgPlanned || 0,
            }))}
          loading={confirmingKey === splitRow.rowKey}
          onCancel={() => { if (confirmingKey !== splitRow.rowKey) setSplitRow(null) }}
          onConfirm={batches => runSplitConfirm(splitRow, batches)}
        />
      )}
    </div>
  )
}
