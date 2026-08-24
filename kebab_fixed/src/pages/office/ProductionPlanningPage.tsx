import { useOtworzDokument } from '@/lib/otworzDokument'
/**
 * ProductionPlanningPage v3
 * - Panel mięsa: zgrupowany per receptura, zwinięty domyślnie
 * - Rezerwacja: proporcjonalna wg pojemności partii (nie równa)
 * - Partie w pozycji: czytelny dropdown zamiast checkboxów
 * - Klient: wybór z listy kontrahentów
 */
import { useState, useMemo, useEffect, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { useClientNames } from '@/lib/clientNames'
import { productionPlansApi, seasonedMeatApi, finishedUnitsApi, labelTemplatesApi } from '@/lib/apiClient'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { UnitReprintModal, type ReprintLine } from '@/features/production/components/UnitReprintModal'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { fefoLotCompare } from '@/lib/utils/fefo'
import {
  AlertTriangle,
  BarChart2,
  CheckSquare,
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  Download,
  Factory,
  Pencil,
  Plus,
  Printer,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { allocatePlanMeat, batchIdsFromAllocation } from '@/features/production-plan/planMeatAllocation'
import { buildOfficeFinishEntries, officeFinishSummary } from '@/features/production-plan/officeFinish'
import { splitRemainder, changedAssignments } from '@/features/production-plan/remainderSplit'
import type { ProductionPlan, ProductionPlanLine, CreatePlanLineDto, ClientOrder } from '@/lib/mockApi'

interface PlanLineForm {
  id?:              string   // id istniejącej pozycji (edycja) — puste dla nowej
  qty:              string
  kgPerUnit:        string
  productTypeId:    string
  recipeId:         string
  packagingId:      string
  clientId:         string
  clientName:       string
  // Partie mięsa — lista id z priorytetem
  seasonedBatchIds: string[]
  seasonedBatchId:  string
  clientOrderId:    string
  clientOrderNo:    string
  clientOrderLineId: string
}

const emptyLine = (): PlanLineForm => ({
  id:'', qty:'', kgPerUnit:'', productTypeId:'', recipeId:'', packagingId:'',
  clientId:'', clientName:'',
  seasonedBatchIds:[], seasonedBatchId:'',
  clientOrderId:'', clientOrderNo:'', clientOrderLineId:'',
})

// Przydział mięsa liczy planMeatAllocation — JEDEN wspólny przebieg po
// pozycjach, całe sztuki z jednej partii (bez sztuk mieszanych PM).
// Tu zostają tylko cienkie nakładki na kształt formularza.

// Automatyczny przydział partii (FEFO) dla nowych linii — pula = wolne kg
// po odjęciu tego, co biorą już istniejące linie formularza. Partię dokładamy
// tylko wtedy, gdy zmieści choć jedną CAŁĄ sztukę.
function autoAssignNewLines(newLines: PlanLineForm[], existing: PlanLineForm[], seasonedRaw: any[]): PlanLineForm[] {
  const free = allocatePlanMeat(existing, seasonedRaw ?? []).freeByBatch
  const pool = (seasonedRaw ?? [])
    .map((s:any) => ({
      id: s.id, recipeId: s.recipeId, expiryDate: s.expiryDate, batchNo: s.batchNo,
      rem: free[s.id] ?? Math.max(0, (s.kgFree ?? s.kgAvailable) ?? 0),
    }))
    .sort((a,b)=>fefoLotCompare(
      { expiryDate: a.expiryDate, no: a.batchNo, id: a.id },
      { expiryDate: b.expiryDate, no: b.batchNo, id: b.id },
    ))
  return newLines.map(line => {
    if (line.seasonedBatchIds?.length>0 || line.seasonedBatchId) return line
    const qty  = parseFloat(line.qty)||0
    const kgPu = parseFloat(line.kgPerUnit)||0
    if (qty<=0 || kgPu<=0 || !line.recipeId) return line
    let still = qty
    const assigned: string[] = []
    for (const b of pool) {
      if (still<=0) break
      if (b.recipeId!==line.recipeId) continue
      const pcs = Math.min(still, Math.floor(b.rem / kgPu))
      if (pcs<=0) continue
      b.rem -= pcs * kgPu; still -= pcs
      assigned.push(b.id)
    }
    return assigned.length===0 ? line : { ...line, seasonedBatchIds: assigned, seasonedBatchId: assigned[0] }
  })
}

// ─── Kebab komponentowy (np. 70/30) ───────────────────────────
// Receptura ze składem produkcyjnym: partie per komponent dobiera backend
// (FEFO po rodzaju mięsa) — planista nie zaznacza partii ręcznie.
interface RecipeComponentLite { materialTypeId: string; materialName: string; pct: number }

function recipeComponents(recipes: any[], recipeId: string): RecipeComponentLite[] {
  if (!recipeId) return []
  const r = (recipes ?? []).find((x: any) => x.id === recipeId)
  return (r?.components ?? []) as RecipeComponentLite[]
}

// Dostępność mięsa per komponent (wolne kg wg rodzaju surowca)
function componentAvailability(
  comps: RecipeComponentLite[], qty: number, kgPu: number, seasonedRaw: any[],
) {
  return comps.map(c => {
    const free = (seasonedRaw ?? [])
      .filter((s: any) => (s.materialTypeId ?? '') === c.materialTypeId)
      .reduce((s2: number, s: any) => s2 + Math.max(0, (s.kgFree ?? s.kgAvailable) - 0), 0)
    const need = qty * kgPu * c.pct / 100
    return { ...c, free, need, ok: free >= need - 0.1 }
  })
}

const STATUS_LABELS: Record<ProductionPlan['status'], string> = {
  draft:'Szkic', active:'Aktywny', done:'Ukończony', cancelled:'Anulowany',
}
const STATUS_CLASS: Record<ProductionPlan['status'], string> = {
  draft: '',
  active: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
  done: 'bg-green-50 text-green-700 border-green-200 hover:bg-green-50',
  cancelled: 'bg-red-50 text-red-700 border-red-200 hover:bg-red-50',
}

// ─── Przegląd mięsa na stronie głównej ────────────────────────
// Planista widzi stan mięsa przyprawionego per receptura bez
// otwierania formularza planu.
function MeatStockOverview() {
  const { data: seasoned, loading } = useApi(() => seasonedMeatApi.list())
  const [collapsed, setCollapsed] = useState(false)

  const byRecipe = useMemo(() => {
    const m: Record<string, {
      recipeName: string
      freeKg: number; reservedKg: number; totalKg: number
      batches: number; nearestExpiry: string
    }> = {}
    ;(seasoned ?? []).forEach((s: any) => {
      const free     = Math.max(0, s.kgFree ?? s.kgAvailable ?? 0)
      const reserved = Math.max(0, s.kgReserved ?? 0)
      if (free <= 0 && reserved <= 0) return
      if (!m[s.recipeId]) {
        m[s.recipeId] = { recipeName: s.recipeName, freeKg: 0, reservedKg: 0, totalKg: 0, batches: 0, nearestExpiry: '' }
      }
      const r = m[s.recipeId]
      r.freeKg     += free
      r.reservedKg += reserved
      r.totalKg    += free + reserved
      r.batches    += 1
      if (free > 0 && s.expiryDate && (!r.nearestExpiry || s.expiryDate < r.nearestExpiry)) {
        r.nearestExpiry = s.expiryDate
      }
    })
    return Object.values(m).sort((a, b) => b.freeKg - a.freeKg)
  }, [seasoned])

  const totalFree = byRecipe.reduce((s, r) => s + r.freeKg, 0)

  function expiryDays(iso: string): number | null {
    if (!iso) return null
    const d = Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000)
    return Number.isFinite(d) ? d : null
  }

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setCollapsed(c => !c)}
        className="w-full px-4 py-2.5 flex items-center gap-2 border-b bg-surface-3/60 hover:bg-surface-3 transition-colors"
      >
        <BarChart2 size={14} className="text-ink-2"/>
        <span className="text-[12px] font-bold text-ink uppercase tracking-wide">Mięso do dyspozycji</span>
        {!loading && (
          <span className="text-[12px] font-black text-ink ml-1">{fmtKg(totalFree, 0)} kg</span>
        )}
        <span className="ml-auto text-muted-foreground">
          {collapsed ? <ChevronDown size={15}/> : <ChevronUp size={15}/>}
        </span>
      </button>
      {!collapsed && (
        loading ? (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {[1,2,3,4].map(i => <Skeleton key={i} className="h-20 w-full"/>)}
          </div>
        ) : byRecipe.length === 0 ? (
          <div className="px-4 py-5 text-[12px] text-muted-foreground">
            Brak mięsa przyprawionego w magazynie — zaplanuj masowanie, aby mieć z czego produkować.
          </div>
        ) : (
          <div className="p-3 grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-2">
            {byRecipe.map(r => {
              const days     = expiryDays(r.nearestExpiry)
              const expSoon  = days !== null && days <= 2
              const pctFree  = r.totalKg > 0 ? (r.freeKg / r.totalKg) * 100 : 0
              const isEmpty  = r.freeKg < 0.1
              return (
                <div key={r.recipeName} className={`rounded-lg border p-3 ${isEmpty ? 'bg-muted/40 border-muted' : 'bg-white border-surface-3'}`}>
                  <div className="text-[11px] font-bold truncate mb-1" title={r.recipeName}>{r.recipeName}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className={`text-2xl font-black leading-none ${isEmpty ? 'text-muted-foreground' : 'text-green-700'}`}>
                      {fmtKg(r.freeKg, 0)}
                    </span>
                    <span className="text-[11px] font-semibold text-muted-foreground">kg wolne</span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden mt-2">
                    <div className={`h-full rounded-full ${isEmpty ? 'bg-muted' : 'bg-green-500'}`} style={{ width: `${pctFree}%` }}/>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1.5 flex flex-wrap gap-x-2">
                    <span>{r.batches} parti{r.batches === 1 ? 'a' : r.batches < 5 ? 'e' : 'i'}</span>
                    {r.reservedKg > 0.1 && <span className="text-amber-600">zarez. {fmtKg(r.reservedKg, 0)} kg</span>}
                    {days !== null && (
                      <span className={expSoon ? 'text-red-600 font-bold' : ''}>
                        ważność: {fmtDatePl(r.nearestExpiry)}{expSoon ? ` (${days <= 0 ? 'dziś!' : `${days} dn.`})` : ''}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )
      )}
    </Card>
  )
}

// ─── Import z zamówień ────────────────────────────────────────

// ─── Panel mięsa (zgrupowany per receptura) ───────────────────
interface MeatPanelProps {
  seasonedAvail: any[]
  seasonedUsed:  Record<string, number>
  /** Żywe zapotrzebowanie kg per receptura — WSZYSTKIE linie szkicu, także
   * BEZ przypisanych partii (saldo schodzi już przy wpisaniu szt × kg).
   * Receptury komponentowe (70/30) rozlicza backend per komponent — poza mapą. */
  demandByRecipe: Record<string, { name: string; kg: number }>
  onAutoAssign:  (recipeId: string) => void
}


// ─── Wykonane sztuki wpisywane przez BIURO ────────────────────────────
// Dopóki hala nie ma kiosku, produkcję kwituje biuro z kartki. Zapis idzie
// tym samym endpointem co postęp z tabletu (updateLineProgress), więc
// backend sam pilnuje zakresu 0..qty i statusu pozycji.
function DoneQtyInput({ planId, lineId, qty, qtyDone, onSaved }: {
  planId: string; lineId: string; qty: number; qtyDone: number; onSaved: () => void
}) {
  const [val, setVal]   = useState(String(qtyDone || ''))
  const [busy, setBusy] = useState(false)
  useEffect(() => { setVal(String(qtyDone || '')) }, [qtyDone])

  async function save(next: number) {
    const clamped = Math.max(0, Math.min(next, qty))
    if (clamped === qtyDone) { setVal(String(clamped || '')); return }
    setBusy(true)
    try {
      await productionPlansApi.updateLineProgress(planId, lineId, {
        qtyDone: clamped,
        lineStatus: clamped >= qty ? 'DONE' : clamped > 0 ? 'IN_PROGRESS' : 'PLANNED',
        workerEntries: [],
      })
      onSaved()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Nie udało się zapisać wykonania')
      setVal(String(qtyDone || ''))
    } finally { setBusy(false) }
  }

  const pct = qty > 0 ? Math.round((qtyDone / qty) * 100) : 0
  return (
    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
      <Input
        type="number" min="0" max={qty} value={val} disabled={busy}
        onChange={e => setVal(e.target.value)}
        onBlur={() => save(parseInt(val, 10) || 0)}
        onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
        className="h-6 w-14 px-1.5 text-[11px] text-center tabular-nums"
        title={`Wykonane sztuki (max ${qty})`}
      />
      <span className="text-[10px] text-muted-foreground">/ {qty}</span>
      {qtyDone > 0 && (
        <span className={`text-[10px] font-bold ${pct >= 100 ? 'text-green-700' : 'text-amber-700'}`}>
          {pct >= 100 ? '✓' : `${pct}%`}
        </span>
      )}
      {qtyDone < qty && (
        <button onClick={() => save(qty)} disabled={busy}
          className="text-[10px] px-1 rounded text-muted-foreground hover:text-green-700 hover:bg-green-50"
          title="Wykonano wszystko">wsz.</button>
      )}
    </div>
  )
}

// ─── Pasek szybkiego dodawania pozycji (styl POS, jak w zamówieniach) ─
interface QuickAddProps {
  onAdd:            (line: PlanLineForm) => void
  productTypes:     any[]
  recipes:          any[]
  packaging:        any[]
  clients:          any[]
  meatFreeByRecipe: Record<string, number>
}


// ─── Formularz pozycji ────────────────────────────────────────
interface LineFormProps {
  line:           PlanLineForm
  idx:            number
  total:          number
  lines:          PlanLineForm[]    // wszystkie linie (do obliczenia zajętości innych)
  productTypes:   any[]
  recipes:        any[]
  packaging:      any[]
  clients:        any[]
  seasonedAvail:  any[]
  seasonedUsed:   Record<string,number>
  seasonedRaw:    any[]
  onChange:       (k: keyof PlanLineForm, v: any) => void
  onRemove:       () => void
}


// ─── Formularz planu ──────────────────────────────────────────
interface PlanFormProps {
  onSave:        (lines: CreatePlanLineDto[], date: string) => Promise<string>
  onClose:       () => void
  initialPlan?:  ProductionPlan   // gdy edycja
  existingPlans?: ProductionPlan[] // do ostrzeżenia "jeden dzień = jeden plan"
  /** Pełna strona (edytor) zamiast modala — bez własnego okna przewijania.
   *  W modalu formularz MUSI mieć ograniczoną wysokość i swój scroll;
   *  na stronie to samo ograniczenie robiło „okno w oknie" i zostawiało
   *  puste pole na dole, zwłaszcza po pomniejszeniu widoku do 50–70%. */
  fullPage?:     boolean
}


// ─── Strona główna ────────────────────────────────────────────
export function ProductionPlanningPage() {
  const otworz = useOtworzDokument()
  const clientDisplay = useClientNames()
  const { data: plans, loading, refetch } = useApi(()=>productionPlansApi.list())
  // Okna modalne planowania zdjęte 2026-08-24: plan ma własną stronę
  // (ProductionPlanEditorPage), a modal był węższy niż potrzeba i trzymał
  // drugą kopię tego samego formularza.
  const [expanded, setExpanded] = useState<string|null>(null)
  const navigate = useNavigate()
  const [generatingLine, setGeneratingLine] = useState<string|null>(null)
  const [reprintLine, setReprintLine] = useState<ReprintLine|null>(null)
  // Rozliczenie pozostałości po zatwierdzeniu produkcji — patrz `finishPlan`.
  const [closing, setClosing] = useState<{ planNo: string; rows: any[] }|null>(null)
  const [closingBusy, setClosingBusy] = useState(false)

  /**
   * Zamknięcie produkcji PRZEZ BIURO — dopóki hala nie ma kiosku.
   *
   * `all` = cały plan wykonany zgodnie z założeniem (bez wpisywania sztuk),
   * inaczej bierzemy to, co biuro wpisało w kolumnie „Wykonano".
   *
   * Wykonanie MUSI najpierw wylądować na pozycjach: finish_day tworzy wyroby
   * z przekazanych wpisów, ale qty_done na pozycjach zostawia w spokoju —
   * bez tego kroku plan pokazywałby 0 szt. mimo wyprodukowanego kebaba.
   * Dalej idzie ta sama ścieżka co z tabletu (tablet-finish → office-confirm).
   */
  async function finishPlan(plan: ProductionPlan, all: boolean) {
    const entries = buildOfficeFinishEntries(plan, { all })
    if (entries.length === 0) {
      alert(all
        ? 'Plan nie ma pozycji do zatwierdzenia.'
        : 'Najpierw wpisz wykonane sztuki — rozwiń plan i uzupełnij kolumnę „Wykonano".')
      return
    }
    const pieces = entries.reduce((s, e) => s + e.qty, 0)
    const kg     = entries.reduce((s, e) => s + e.qty * e.kgPerUnit, 0)
    const s      = officeFinishSummary(plan)
    const uwaga  = !all && s.partial > 0
      ? `\n\nUWAGA: ${s.partial} pozycji wykonano tylko w części — reszta NIE zostanie wyprodukowana.`
      : ''
    if (!confirm(
      `Zatwierdzić produkcję planu ${plan.planNo}?\n\n`
      + `${pieces} szt · ${fmtKg(kg, 0)} kg w ${entries.length} pozycjach`
      + `${all ? ' (cały plan)' : ''}.\n`
      + `Kebab trafi do magazynu wyrobów gotowych, a rezerwacje mięsa zostaną rozliczone.`
      + uwaga)) return

    try {
      for (const e of entries) {
        const line = plan.lines.find(l => l.id === e.planLineId)
        if (Number((line as any)?.qtyDone ?? 0) === e.qty) continue
        await productionPlansApi.updateLineProgress(plan.id, e.planLineId, {
          qtyDone: e.qty,
          lineStatus: e.qty >= (Number(line?.qty) || 0) ? 'DONE' : 'IN_PROGRESS',
          workerEntries: [],
        })
      }
      await productionPlansApi.tabletFinish(plan.id, entries)
      await productionPlansApi.officeConfirm(plan.id)
      refetch()
      await zapytajOPozostalosc(plan)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Błąd zatwierdzenia produkcji')
      refetch()
    }
  }

  /**
   * Pytanie o POZOSTAŁOŚĆ mięsa przyprawionego — jeden pomiar dziennie.
   *
   * Kilogramy partii są WYLICZONE z receptury, a realny ubytek (masowanie,
   * podłoga, ścinki poza wyrób) powstaje tam, gdzie nikt nie waży. Bez tego
   * pytania karta 2.5.1 podawałaby teorię jako pomiar, a strata produkcyjna
   * zostawałaby pustym polem. Odpowiedź księgujemy korektą partii
   * (reconcile), więc różnica ma ślad w ruchach magazynowych.
   */
  async function zapytajOPozostalosc(plan: ProductionPlan) {
    const uzyte = new Set<string>()
    for (const l of plan.lines ?? []) {
      for (const id of batchIdsFromAllocation(
        (l as any).batchAllocation, (l as any).seasonedBatchNos,
      )) uzyte.add(id)
    }
    if (uzyte.size === 0) return
    try {
      const wszystkie = await seasonedMeatApi.all()
      const partie = (wszystkie ?? [])
        .filter((s: any) => uzyte.has(s.id) && Number(s.kgAvailable || 0) > 0.05)
      // Pytamy per RECEPTURA — w chłodni nikt nie rozdziela resztek na partie.
      // Przypisanie do partii robi splitRemainder (FEFO).
      const wgReceptury = new Map<string, any>()
      for (const s of partie) {
        const k = s.recipeId || s.recipeName
        const g = wgReceptury.get(k) ?? {
          recipeId: k, recipeName: s.recipeName, teoria: 0, batches: [] as any[],
        }
        g.teoria += Number(s.kgAvailable || 0)
        g.batches.push({
          id: s.id, batchNo: s.batchNo,
          theoryKg: Number(s.kgAvailable || 0), expiryDate: s.expiryDate,
        })
        wgReceptury.set(k, g)
      }
      const rows = [...wgReceptury.values()].map(g => ({
        ...g,
        teoria: Math.round(g.teoria * 1000) / 1000,
        wpis: String(Math.round(g.teoria * 1000) / 1000),
      }))
      if (rows.length > 0) setClosing({ planNo: plan.planNo, rows })
    } catch { /* rozliczenie można zrobić później na magazynie przyprawionego */ }
  }

  async function zapiszPozostalosc() {
    if (!closing) return
    setClosingBusy(true)
    try {
      for (const r of closing.rows) {
        const podane = parseFloat(String(r.wpis).replace(',', '.'))
        if (!Number.isFinite(podane)) continue
        for (const a of changedAssignments(splitRemainder(r.batches, podane))) {
          await (seasonedMeatApi as any).reconcile(a.id, {
            targetKg: a.targetKg,
            reason: `rozliczenie produkcji ${closing.planNo} — ubytek masowania/produkcji`,
            close: a.close,
          })
        }
      }
      setClosing(null)
      refetch()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Nie udało się zapisać pozostałości')
    } finally { setClosingBusy(false) }
  }

  async function handleGenerateLabels(planId: string, line: ProductionPlanLine) {
    setGeneratingLine(line.id)
    try {
      await finishedUnitsApi.generateFromPlanLine(line.id)
    } catch {
      // Ignoruj błąd — często jednostki już istnieją; i tak przechodzimy do druku
    }
    const params = new URLSearchParams({ planLineId: line.id })
    if (line.clientName) params.set('clientId', line.clientName)
    if (line.recipeId)   params.set('recipeId', line.recipeId)

    // Jeden przycisk „Etykieta" — system sam wie, czy dla tej pary (klient+receptura)
    // zdefiniowano etykietę Zebra (drukarka etykiet) czy PDF (zwykła drukarka).
    let kind: 'zebra' | 'pdf' | 'none' = 'pdf'
    try {
      const r = await labelTemplatesApi.resolve(line.clientName || '', line.recipeId || '')
      kind = r.kind
    } catch {
      // Brak rozstrzygnięcia → domyślnie PDF (pokaże ekran konfiguracji, jeśli brak szablonu).
    }
    setGeneratingLine(null)
    navigate(`/etykiety/${kind === 'zebra' ? 'zebra' : 'druk'}?${params.toString()}`)
  }

  const activePlans = (plans??[]).filter(p=>p.status!=='done'&&p.status!=='cancelled')

  return (
    <div className="space-y-4 animate-fade-in">
      <UnitReprintModal
        line={reprintLine}
        open={!!reprintLine}
        onClose={() => setReprintLine(null)}
      />

      {/* Pozostałość mięsa po produkcji — jeden pomiar dziennie. Bez niego
          karta 2.5.1 nie ma realnej straty produkcyjnej, bo kg partii są
          wyliczone z receptury, a nie zważone. */}
      <Dialog open={!!closing} onOpenChange={o => { if (!o) setClosing(null) }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Ile mięsa przyprawionego zostało?</DialogTitle>
          </DialogHeader>
          <p className="text-[12px] text-muted-foreground -mt-2">
            Poniższe kilogramy są <strong>wyliczone z receptury</strong>, nie zważone.
            Podaj, ile realnie zostało z każdej receptury — partie rozdzieli system
            (FEFO: zostaje najmłodsza). Różnica zostanie zaksięgowana jako strata
            produkcyjna (masowanie, podłoga, ścinki) i trafi na kartę realizacji.
          </p>
          <div className="space-y-2">
            {(closing?.rows ?? []).map((r, i) => (
              <div key={r.recipeId} className="flex items-center gap-2 border rounded-lg px-3 py-2">
                <span className="font-bold text-[12px] flex-1 truncate">{r.recipeName}</span>
                <span className="text-[10px] text-muted-foreground">
                  {r.batches.length} parti{r.batches.length === 1 ? 'a' : r.batches.length < 5 ? 'e' : 'i'}
                  {' · '}wyliczone {fmtKg(r.teoria, 1)} kg
                </span>
                <Input
                  type="number" min="0" step="0.1" value={r.wpis}
                  onChange={e => setClosing(c => c && ({
                    ...c, rows: c.rows.map((x, j) => j === i ? { ...x, wpis: e.target.value } : x),
                  }))}
                  className="h-8 w-24 text-sm text-right tabular-nums"
                />
                <Button variant="outline" size="sm" className="h-8 text-[11px]"
                  onClick={() => setClosing(c => c && ({
                    ...c, rows: c.rows.map((x, j) => j === i ? { ...x, wpis: '0' } : x),
                  }))}>
                  Nic nie zostało
                </Button>
              </div>
            ))}
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setClosing(null)} disabled={closingBusy}>
              Rozliczę później
            </Button>
            <Button onClick={zapiszPozostalosc} disabled={closingBusy}
              className="bg-green-600 hover:bg-green-700 text-white">
              {closingBusy ? 'Zapisuję…' : 'Zapisz pozostałość'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <div className="flex gap-3">
        <div className="grid grid-cols-2 gap-3 flex-1">
          {[
            { label:'Planowane kg', val:`${fmtKg(activePlans.reduce((s,p)=>s+p.totalKg,0),0)} kg` },
            { label:'Planowane szt', val:`${activePlans.reduce((s,p)=>s+p.totalUnits,0)} szt` },
          ].map(k=>(
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</div>
                <div className="text-xl font-bold">{k.val}</div>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="flex items-start">
          <Button onClick={()=>navigate('/office/planowanie-produkcji/nowy')} className="gap-1.5"><Plus size={14}/>Nowy plan</Button>
        </div>
      </div>

      <MeatStockOverview/>

      <Card>
        <div className="px-4 py-2.5 border-b">
          <span className="text-[13px] font-semibold">{(plans??[]).length} planów</span>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {[1,2,3].map(i=><Skeleton key={i} className="h-14 w-full"/>)}
          </div>
        ) : (plans??[]).length===0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Factory size={32}/>
            <div className="font-semibold">Brak planów</div>
            <div className="text-sm">Utwórz plan</div>
          </div>
        ) : (
          <div className="divide-y">
            {(plans??[]).map(plan=>{
              const isExp=expanded===plan.id
              return (
                <div key={plan.id}>
                  <div className="px-4 py-3 flex items-center gap-3 hover:bg-muted/50 cursor-pointer transition-colors"
                    onClick={()=>setExpanded(isExp?null:plan.id)}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-primary">{plan.planNo}</span>
                        {(() => {
                          // Dla planów 'done' liczymy procent ukończenia
                          // z qty_done na liniach planu — żeby biuro widziało
                          // czy plan zamknięty w 100% czy częściowo.
                          if (plan.status !== 'done') {
                            return (
                              <Badge variant="outline" className={STATUS_CLASS[plan.status]}>
                                {STATUS_LABELS[plan.status]}
                              </Badge>
                            )
                          }
                          const totalQty = plan.lines.reduce((s,l) => s + Number(l.qty || 0), 0)
                          const doneQty  = plan.lines.reduce((s,l) => s + Number((l as any).qtyDone || 0), 0)
                          const pct = totalQty > 0 ? Math.round((doneQty / totalQty) * 100) : 0
                          if (pct >= 100) {
                            return (
                              <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">
                                Ukończony 100%
                              </Badge>
                            )
                          }
                          if (pct === 0) {
                            return (
                              <Badge variant="outline" className="bg-gray-50 text-gray-600 border-gray-200">
                                Zamknięty (bez produkcji)
                              </Badge>
                            )
                          }
                          return (
                            <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                              Ukończony częściowo · {pct}%
                            </Badge>
                          )
                        })()}
                      </div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">
                        {fmtDatePl(plan.planDate)} · {plan.lines.length} poz. · {fmtKg(plan.totalKg,0)} kg · {plan.totalUnits} szt
                        {plan.status === 'done' && (() => {
                          const doneQty = plan.lines.reduce((s,l) => s + Number((l as any).qtyDone || 0), 0)
                          const doneKg  = plan.lines.reduce((s,l) => s + Number((l as any).qtyDone || 0) * Number(l.kgPerUnit || 0), 0)
                          if (doneQty === plan.totalUnits) return null
                          return <span className="text-green-700 font-semibold"> · wyprodukowano {doneQty} szt / {fmtKg(doneKg,0)} kg</span>
                        })()}
                      </div>
                    </div>
                    <div className="flex gap-1 items-center">
                      {/* Kartka dla kierownika produkcji — dopóki hala nie ma kiosku */}
                      <Button variant="ghost" size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-primary"
                        title="Drukuj kartę produkcji dla kierownika"
                        onClick={e=>{
                          e.stopPropagation()
                          otworz(`/office/plan-produkcji/druk?planId=${plan.id}`)
                        }}>
                        <Printer size={13}/>
                      </Button>
                      {(plan.status==='draft'||plan.status==='active')&&(
                        <Button variant="ghost" size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          title={plan.status==='active' ? 'Edytuj plan (aktywny — wyprodukowane pozycje są zablokowane)' : 'Edytuj plan'}
                          onClick={e=>{e.stopPropagation();navigate(`/office/planowanie-produkcji/${plan.id}/edytuj`)}}>
                          <Pencil size={13}/>
                        </Button>
                      )}
                      {plan.status==='draft'&&(
                        <Button variant="outline" size="sm"
                          className="h-7 text-[11px] text-amber-700 border-amber-200 hover:bg-amber-50"
                          onClick={async e=>{
                            e.stopPropagation()
                            try {
                              await productionPlansApi.updateStatus(plan.id,'active')
                              refetch()
                            } catch(err) {
                              alert(err instanceof Error ? err.message : 'Niewystarczająca ilość mięsa — dostosuj plan przed aktywacją')
                            }
                          }}>
                          Aktywuj
                        </Button>
                      )}
                      {plan.status==='active' && (plan as any).tabletFinishedAt && !(plan as any).officeConfirmedAt && (
                        <>
                          <Badge variant="warning" className="text-[10px] gap-1 mr-1">
                            <span className="inline-flex h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                            Do potwierdzenia
                          </Badge>
                          <Button variant="default" size="sm"
                            className="h-7 text-[11px] bg-green-600 hover:bg-green-700 text-white"
                            onClick={async e=>{
                              e.stopPropagation()
                              if (!confirm(`Potwierdzić zakończenie planu ${plan.planNo}? Kebab trafi do magazynu wyrobów gotowych.`)) return
                              try {
                                await productionPlansApi.officeConfirm(plan.id)
                                refetch()
                              } catch(err) {
                                alert(err instanceof Error ? err.message : 'Błąd potwierdzenia')
                              }
                            }}>
                            Potwierdź
                          </Button>
                        </>
                      )}
                      {/* Bez kiosku na hali produkcję zamyka biuro: wpisuje
                          wykonane sztuki w rozwinięciu i zatwierdza. Idzie tą
                          samą ścieżką co tablet (tablet-finish → office-confirm),
                          żeby wyroby, partie i rezerwacje liczyły się tak samo. */}
                      {plan.status==='active' && !(plan as any).tabletFinishedAt && (
                        <>
                          {/* Cały plan wykonany zgodnie z założeniem — bez
                              wpisywania sztuka po sztuce. Najczęstszy przypadek. */}
                          <Button variant="default" size="sm"
                            className="h-7 text-[11px] bg-green-600 hover:bg-green-700 text-white"
                            onClick={e=>{ e.stopPropagation(); finishPlan(plan, true) }}>
                            Zatwierdź wszystko
                          </Button>
                          {/* Produkcja odbiegła od planu — biuro wpisuje sztuki
                              w rozwinięciu i zatwierdza dokładnie tyle. */}
                          <Button variant="outline" size="sm"
                            className="h-7 text-[11px] text-green-700 border-green-200 hover:bg-green-50"
                            onClick={e=>{ e.stopPropagation(); finishPlan(plan, false) }}>
                            Zatwierdź wpisane
                          </Button>
                        </>
                      )}
                      {plan.status==='active' && !(plan as any).tabletFinishedAt && (
                        <Button variant="outline" size="sm"
                          className="h-7 text-[11px] text-muted-foreground border-surface-4 hover:bg-surface-2"
                          onClick={async e=>{
                            e.stopPropagation()
                            if (!confirm(`Anulować plan ${plan.planNo}? Rezerwacje mięsa zostaną zwolnione, a plan nie będzie liczony jako wykonany.`)) return
                            await productionPlansApi.updateStatus(plan.id,'cancelled')
                            refetch()
                          }}>
                          Anuluj
                        </Button>
                      )}
                      {isExp?<ChevronUp size={16} className="text-muted-foreground"/>:<ChevronDown size={16} className="text-muted-foreground"/>}
                    </div>
                  </div>
                  {isExp&&(
                    <div className="px-4 pb-3 bg-muted/30 border-t overflow-x-auto">
                      <Table className="text-[11px] mt-2">
                        <TableHeader>
                          <TableRow>
                            {['Szt','Wykonano','kg','Razem','Receptura','Tuleja','Partie mięsa','Klient',''].map(h=>(
                              <TableHead key={h} className="text-[9px] uppercase tracking-wider h-7 px-3">{h}</TableHead>
                            ))}
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {plan.lines.map(l=>{
                            const qtyDone = Number((l as any).qtyDone || 0)
                            const lineStatus = ((l as any).lineStatus || 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE'
                            const pct = l.qty > 0 ? Math.round((qtyDone / l.qty) * 100) : 0
                            return (
                            <TableRow key={l.id}>
                              <TableCell className="py-1.5 font-bold px-3">{l.qty}</TableCell>
                              <TableCell className="py-1.5 px-3">
                                {/* Biuro wpisuje wykonanie ręcznie — hala nie ma
                                    jeszcze kiosku. Po zatwierdzeniu planu pole
                                    znika (zostaje sam odczyt). */}
                                {plan.status === 'active' && !(plan as any).tabletFinishedAt ? (
                                  <DoneQtyInput
                                    planId={plan.id} lineId={l.id}
                                    qty={l.qty} qtyDone={qtyDone}
                                    onSaved={refetch}
                                  />
                                ) : qtyDone === 0 ? (
                                  <span className="text-muted-foreground">—</span>
                                ) : pct >= 100 ? (
                                  <span className="font-bold text-green-700">{qtyDone} / {l.qty} ✓</span>
                                ) : (
                                  <span className="font-bold text-amber-700">{qtyDone} / {l.qty} <span className="text-[10px] font-medium">({pct}%)</span></span>
                                )}
                                {lineStatus === 'IN_PROGRESS' && <Badge variant="outline" className="ml-1 text-[9px] h-4 px-1 bg-amber-50 text-amber-700 border-amber-200">w trakcie</Badge>}
                              </TableCell>
                              <TableCell className="py-1.5 px-3">{l.kgPerUnit} kg</TableCell>
                              <TableCell className="py-1.5 font-bold text-primary px-3">{fmtKg(l.totalKg,0)} kg</TableCell>
                              <TableCell className="py-1.5 px-3">{l.recipeName}</TableCell>
                              <TableCell className="py-1.5 text-muted-foreground px-3">{l.packagingName||'—'}</TableCell>
                              <TableCell className="py-1.5 px-3">
                                {(() => {
                                  // Rozbicie z batch_allocation: "349 ×19" + fioletowy
                                  // badge PM ze składem; fallback na same numery partii.
                                  const ba = ((l as any).batchAllocation ?? {}) as Record<string, any>
                                  const isMixedKey = (k:string) => k === '__MIXED__' || /^PM\d+$/.test(k)
                                  const entries = Object.entries(ba)
                                    .filter(([,a]) => (a?.pieces ?? 0) > 0)
                                    .sort(([k1],[k2]) => Number(isMixedKey(k1)) - Number(isMixedKey(k2)))
                                  if (entries.length > 0) {
                                    return (
                                      <div className="flex gap-1 flex-wrap">
                                        {entries.map(([k, a]) => {
                                          const mixed = isMixedKey(k)
                                          const label = k === '__MIXED__' ? 'PM' : k
                                          const title = mixed && a.parts
                                            ? Object.entries(a.parts as Record<string, any>)
                                                .map(([p, v]) => `${fmtKg(v?.kg ?? 0)} kg z ${p}`)
                                                .join(' + ')
                                            : undefined
                                          return (
                                            <Badge key={k} variant="outline" title={title}
                                              className={`font-mono text-[10px] h-5 ${mixed
                                                ? 'text-violet-700 bg-violet-50 border-violet-200'
                                                : 'text-green-700 bg-green-50 border-green-200'}`}>
                                              {label} ×{a.pieces}
                                            </Badge>
                                          )
                                        })}
                                      </div>
                                    )
                                  }
                                  return (l as any).seasonedBatchNos?.length>0
                                    ? <div className="flex gap-1 flex-wrap">
                                        {(l as any).seasonedBatchNos.map((n:string)=>(
                                          <Badge key={n} variant="outline" className="font-mono text-green-700 bg-green-50 border-green-200 text-[10px] h-5">{n}</Badge>
                                        ))}
                                      </div>
                                    : l.seasonedBatchNo
                                      ? <span className="font-mono text-green-700">{l.seasonedBatchNo}</span>
                                      : <span className="text-amber-600">Do przydzielenia</span>
                                })()}
                              </TableCell>
                              <TableCell className="py-1.5 text-muted-foreground text-[10px] px-3">{l.clientName ? clientDisplay(l.clientName) : '—'}</TableCell>
                              <TableCell className="py-1 px-2">
                                {(plan.status === 'active' || plan.status === 'done') && l.recipeId && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={generatingLine === l.id}
                                    className="h-6 text-[10px] px-2 text-violet-700 border-violet-200 hover:bg-violet-50 whitespace-nowrap"
                                    onClick={e => { e.stopPropagation(); handleGenerateLabels(plan.id, l as ProductionPlanLine) }}
                                  >
                                    {generatingLine === l.id
                                      ? <span className="w-3 h-3 border border-violet-300 border-t-violet-700 rounded-full animate-spin mr-1" />
                                      : null}
                                    Etykiety
                                  </Button>
                                )}
                                {(plan.status === 'active' || plan.status === 'done') && l.recipeId && (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    title="Dodruk pojedynczej etykiety (awaria druku)"
                                    className="h-6 text-[10px] px-2 ml-1 text-slate-600 hover:bg-slate-100 whitespace-nowrap"
                                    onClick={e => { e.stopPropagation(); setReprintLine({
                                      id: l.id, clientName: l.clientName, recipeId: l.recipeId,
                                      recipeName: l.recipeName, qty: l.qty,
                                    }) }}
                                  >
                                    Dodruk
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          )})}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </Card>

    </div>
  )
}
