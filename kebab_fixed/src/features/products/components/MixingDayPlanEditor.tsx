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
import { useApi } from '@/hooks/useApi'
import { fmtKg } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { CalendarDays, Loader2, Plus, Save, Zap } from 'lucide-react'
import { PlanRow, type PlanRowData } from './PlanRow'
import type { PickerLot } from './MeatLotPicker'
import { autoFefoDistribute, type AvailLot } from '../lib/autoFefo'

export function MixingDayPlanEditor({ onSaved }: { onSaved?: () => void }) {
  const { recipes } = useRecipes()
  const { data: meatData } = useApi(() => meatStockApi.list())
  const [rows, setRows] = useState<PlanRowData[]>([])
  const [loaded, setLoaded] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const dragIdx = useRef<number | null>(null)
  const dirtyRef = useRef(dirty)
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  // Dostępne partie mięsa, FEFO. UWAGA: m.kgAvailable z mapMeatStock to już
  // kg_free (= available - reserved), NIE odejmować kgReserved drugi raz!
  const pickerLots: PickerLot[] = useMemo(() =>
    (meatData?.data ?? [])
      .filter((m: any) => m.status !== 'DEPLETED' && m.status !== 'IN_PRODUCTION')
      .map((m: any) => ({
        id: m.id,
        lotNo: m.lotNo,
        rawBatchNo: m.rawBatchNo,
        kgAvailable: Math.max(0, Number(m.kgAvailable)),
        expiryDate: m.expiryDate,
        materialName: m.materialName,
        materialTypeId: m.materialTypeId,
      }))
      .filter((l: PickerLot) => l.kgAvailable > 0)
      .sort((a: PickerLot, b: PickerLot) => (a.expiryDate < b.expiryDate ? -1 : 1)),
    [meatData],
  )

  const totalAvail = pickerLots.reduce((s, l) => s + l.kgAvailable, 0)

  // Rozdział składników: filet/indyk (przyjęte bez rozbioru) to INNY materiał
  // niż mięso z/s — Auto-FEFO rozdziela TYLKO z/s, filet dobiera się ręcznie
  // w pickerze (osobna sekcja). Inaczej automat mieszał filet do kebaba z/s.
  const zsLots = useMemo(
    () => pickerLots.filter(l => (l.materialTypeId ?? 'mat-mieso-zs') === 'mat-mieso-zs'),
    [pickerLots],
  )
  const zsAvail = zsLots.reduce((s, l) => s + l.kgAvailable, 0)
  const otherAvail = totalAvail - zsAvail

  async function load() {
    try {
      const r = await mixingOrdersApi.dayPlan()
      setRows((r.items ?? []).map((o: any) => ({
        rowKey: o.id, id: o.id, recipeId: o.recipeId, meatKg: String(o.meatKg),
        status: o.status, orderNo: o.orderNo, kgDone: o.kgDone,
        lots: (o.meatLots ?? []).map((l: any) => ({ meatLotId: l.meatLotId, kgPlanned: l.kgPlanned })),
      })))
      setLoaded(true)
      setDirty(false)
    } catch { setLoaded(true) }
  }

  // Wczytaj plan przy montażu; odświeżaj co 15 s, ale NIE nadpisuj edycji
  // w toku (dirty czytane przez ref, by efekt nie restartował przy każdej
  // zmianie dirty — inaczej dodanie wiersza natychmiast kasuje load()em).
  useEffect(() => {
    load()
    const t = setInterval(() => { if (!dirtyRef.current) load() }, 15000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  // Auto-FEFO całość: rozdziela pulę po wierszach edytowalnych w kolejności
  function autoFefoAll() {
    const editable = rows
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status !== 'in_progress' && r.status !== 'done')
    const avail: AvailLot[] = zsLots.map(l => ({ id: l.id, expiryDate: l.expiryDate, kgFree: l.kgAvailable }))
    const needs = editable.map(({ r }) => ({ rowKey: r.rowKey, kg: parseFloat(r.meatKg) || 0 }))
    const dist = autoFefoDistribute(needs, avail)
    setRows(p => p.map(r =>
      (r.status === 'in_progress' || r.status === 'done') ? r : { ...r, lots: dist[r.rowKey] ?? r.lots }
    ))
    setDirty(true)
  }

  const totalPlan = rows.reduce((s, r) => s + (parseFloat(r.meatKg) || 0), 0)
  const totalOutput = rows.reduce((s, r) => s + recipeOutput(r.recipeId, parseFloat(r.meatKg) || 0), 0)
  const overBudget = totalPlan > totalAvail + 0.5

  // Gating zapisu: każda edytowalna pozycja musi mieć kompletne partie
  const allLotsComplete = rows.every(r => {
    if (r.status === 'in_progress' || r.status === 'done') return true
    const kg = parseFloat(r.meatKg) || 0
    const lotKg = r.lots.reduce((s, l) => s + (l.kgPlanned || 0), 0)
    return r.recipeId && kg > 0 && lotKg >= kg - 0.5
  })

  async function save() {
    setError('')
    if (!allLotsComplete) { setError('Każda pozycja musi mieć recepturę, kg > 0 i kompletne partie mięsa'); return }
    setSaving(true)
    try {
      await mixingOrdersApi.saveDayPlan(rows.map((r, i) => ({
        id: r.id, recipeId: r.recipeId, meatKg: parseFloat(r.meatKg), seq: i + 1,
        meatLots: r.lots,
      })))
      await load()
      onSaved?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd zapisu planu')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="overflow-hidden border-violet-200">
      <div className="px-4 py-2.5 bg-violet-50/60 border-b border-violet-200 flex flex-wrap items-center gap-x-4 gap-y-1">
        <div className="flex items-center gap-2">
          <CalendarDays size={14} className="text-violet-600" />
          <span className="text-[12px] font-bold text-violet-800 uppercase tracking-wide">Plan dnia masowania</span>
        </div>
        <span className="text-[12px] font-black text-violet-700">
          Σ {fmtKg(totalPlan, 0)} kg → {fmtKg(totalOutput, 0)} kg półprodukt
        </span>
        <span className={`text-[12px] font-semibold ${overBudget ? 'text-red-600' : 'text-muted-foreground'}`}>
          Dostępne z/s: {fmtKg(zsAvail, 0)} kg
          {otherAvail > 0.5 && <> · filet/inne: {fmtKg(otherAvail, 0)} kg (ręcznie)</>}
          {overBudget ? ' — za mało!' : ''}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="outline" className="h-8 gap-1 text-[12px]" onClick={autoFefoAll}>
            <Zap size={13} /> Auto-FEFO całość
          </Button>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {!loaded ? (
          <div className="text-[12px] text-muted-foreground py-3 text-center">Wczytuję…</div>
        ) : rows.length === 0 ? (
          <div className="text-[12px] text-muted-foreground py-3 text-center border border-dashed rounded-lg">
            Brak planu na dziś — dodaj pierwszą pozycję
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
              output={recipeOutput(r.recipeId, parseFloat(r.meatKg) || 0)}
              expanded={expandedKey === r.rowKey}
              onUpdate={patch => update(i, patch)}
              onMove={dir => move(i, dir)}
              onDelete={() => remove(i)}
              onToggle={() => setExpandedKey(k => k === r.rowKey ? null : r.rowKey)}
              onAutoFefoRow={() => autoFefoRow(i)}
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
          <div className="text-[11px] text-destructive bg-destructive/10 border border-destructive/20 px-3 py-1.5 rounded">
            {error}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" className="h-8 gap-1 text-[12px]" onClick={addRow}>
            <Plus size={13} /> Dodaj pozycję
          </Button>
          <Button size="sm" disabled={saving || !dirty || !allLotsComplete} onClick={save}
            className="h-8 gap-1.5 text-[12px] ml-auto bg-violet-600 hover:bg-violet-700">
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            {dirty ? 'Zapisz plan (operator zobaczy zmianę)' : 'Plan zapisany'}
          </Button>
        </div>
      </div>
    </Card>
  )
}
