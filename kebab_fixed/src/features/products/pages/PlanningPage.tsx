/**
 * PlanningPage — Planowanie masowania
 *
 * Masowanie = półprodukt. Wynik masowania (mixed batch) idzie do planowania produkcji.
 *
 * Workflow:
 *   1. Wybierz rodzaj produktu + recepturę
 *   2. Wybierz partie mięsa (FEFO sugestia, ale możliwość ręcznego wyboru)
 *   3. Podaj ilość kg mięsa
 *   4. System wylicza składniki + tworzy zlecenie MAS-xxx
 *   5. Zlecenie widoczne na tablecie masownicy
 */
import { useState, useMemo, useEffect, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Card } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { useProductTypes } from '../hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import { useApi, useMutation } from '@/hooks/useApi'
import { meatStockApi, mixingOrdersApi, machineLockApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import type { CreateMixingOrderDto } from '@/lib/mockApi'
import {
  Calculator, Package, BookOpen, Beef, AlertTriangle,
  CheckCircle, Plus, X, ChevronRight, ClipboardList, AlertTriangle as AlertIcon, Eye,
} from 'lucide-react'
import { DialogDescription } from '@/components/ui/dialog'
import { fmtKg as fmt } from '@/lib/utils'
import type { MixingOrder } from '@/lib/mockApi'

function TimerTile({ kg, lock }: { kg: number; lock: any }) {
  const [remaining, setRemaining] = useState(() =>
    lock ? Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000)) : 0
  )
  useEffect(() => {
    if (!lock) return
    const t = setInterval(() => {
      const s = Math.max(0, Math.floor((new Date(lock.unlocksAt).getTime() - Date.now()) / 1000))
      setRemaining(s)
      if (s === 0) clearInterval(t)
    }, 1000)
    return () => clearInterval(t)
  }, [lock])
  const mm = String(Math.floor(remaining / 60)).padStart(2, '0')
  const ss = String(remaining % 60).padStart(2, '0')
  return (
    <div className="border rounded-xl p-3 text-center bg-orange-50 text-orange-700 border-orange-200 col-span-2">
      <div className="text-[10px] font-bold uppercase tracking-wide mb-1">W trakcie</div>
      <div className="text-xl font-black tabular-nums">{fmt(kg)} kg</div>
      {lock && <div className="text-[13px] font-mono font-bold mt-1">{mm}:{ss}</div>}
      <div className="text-[10px] mt-0.5">{lock ? 'Masownica ' + lock.machineId : ''}</div>
    </div>
  )
}

export function PlanningPage() {
  const { productTypes, loading: ptLoading } = useProductTypes()
  const { recipes, loading: recLoading }     = useRecipes()
  const { data: meatData, refetch: refetchMeat }  = useApi(() => meatStockApi.list())
  const { data: orders, refetch: refetchOrders } = useApi(() => mixingOrdersApi.list())
  const { data: locks, refetch: refetchLocks }  = useApi(() => machineLockApi.list())

  const [cancelTarget,   setCancelTarget]   = useState<MixingOrder | null>(null)
  const [progressTarget, setProgressTarget] = useState<MixingOrder | null>(null)

  const createMut      = useMutation((dto: CreateMixingOrderDto) => mixingOrdersApi.create(dto))
  const cancelMut      = useMutation((id: string) => mixingOrdersApi.cancel(id))
  const confirmMut     = useMutation((id: string) => (mixingOrdersApi as any).confirm(id))
  const approveMut     = useMutation((id: string) => mixingOrdersApi.autoApprove(id))

  const [modalOpen,    setModalOpen]    = useState(false)
  const [step,         setStep]         = useState<1|2|3>(1)
  const [selProductId, setSelProductId] = useState('')
  const [selRecipeId,  setSelRecipeId]  = useState('')
  const [meatKg,       setMeatKg]       = useState('100')
  const [selLots,      setSelLots]      = useState<{ lotId: string; kg: string }[]>([])
  const [notes,        setNotes]        = useState('')

  const meatLots  = useMemo(() =>
    (meatData?.data ?? [])
      .filter(m => m.status !== 'DEPLETED' && m.status !== 'IN_PRODUCTION' && Number(m.kgAvailable) > 0)
      .sort((a, b) => a.expiryDate > b.expiryDate ? 1 : -1),
    [meatData]
  )
  const totalMeatAvail = meatLots.reduce((s, m) => s + Number(m.kgAvailable), 0)
  const selRecipe      = recipes.find(r => r.id === selRecipeId)
  const requestedKg    = parseFloat(meatKg) || 0
  const filteredRecipes= useMemo(() =>
    selProductId ? recipes.filter(r => !r.productTypeId || r.productTypeId === selProductId) : recipes,
    [recipes, selProductId]
  )

  const calcSteps = useMemo(() => {
    if (!selRecipe || requestedKg <= 0) return []
    return selRecipe.ingredients.map(ri => ({
      ingredientName: ri.ingredientName,
      unit:           ri.unit,
      qty:            Math.round(ri.qtyPer100kg * requestedKg / 100 * 1000) / 1000,
      isUnlimited:    ri.isUnlimited,
    }))
  }, [selRecipe, requestedKg])

  const plannedOutput = useMemo(() => {
    if (!selRecipe || requestedKg <= 0) return 0
    const ingredientsKg = (selRecipe.ingredients ?? [])
      .filter(ri => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
      .reduce((s, ri) => s + (ri.qtyPer100kg * requestedKg / 100), 0)
    return Math.round((requestedKg + ingredientsKg) * 100) / 100
  }, [selRecipe, requestedKg])

  function autoSelectLots() {
    let remaining = requestedKg
    const auto: { lotId: string; kg: string }[] = []
    for (const lot of meatLots) {
      if (remaining <= 0) break
      const take = Math.min(Number(lot.kgAvailable), remaining)
      auto.push({ lotId: lot.id, kg: take.toFixed(2) })
      remaining -= take
    }
    setSelLots(auto)
  }

  function resetModal() {
    setStep(1); setSelProductId(''); setSelRecipeId('')
    setMeatKg('100'); setSelLots([]); setNotes('')
  }

  async function handleCreate() {
    if (!selRecipeId) { toast.error('Wybierz recepturę'); return }
    if (requestedKg <= 0) { toast.error('Podaj ilość mięsa'); return }
    if (selLots.length === 0) { toast.error('Wybierz partie mięsa'); return }

    for (const l of selLots) {
      const lot = meatLots.find(m => m.id === l.lotId)
      const kg  = parseFloat(l.kg) || 0
      if (!lot) continue
      if (kg > Number(lot.kgAvailable)) {
        toast.error(`Lot ${lot.lotNo}: wpisano ${kg} kg, dostępne ${Number(lot.kgAvailable).toFixed(2)} kg`)
        return
      }
    }

    const totalLots = selLots.reduce((s, l) => s + (parseFloat(l.kg) || 0), 0)
    if (Math.abs(totalLots - requestedKg) > 0.5) {
      toast.error(`Suma lotów (${totalLots.toFixed(2)} kg) ≠ planowane mięso (${requestedKg} kg)`)
      return
    }

    const dto: CreateMixingOrderDto = {
      productTypeId: selProductId || undefined,
      recipeId:      selRecipeId,
      meatKg:        requestedKg,
      meatLots:      selLots.map(l => ({ meatLotId: l.lotId, kgPlanned: parseFloat(l.kg) || 0 })),
      notes:         notes || undefined,
    }
    try {
      const created = await createMut.mutate(dto)
      refetchOrders()
      refetchMeat()
      setModalOpen(false)
      resetModal()
      toast.success(`Zlecenie ${created.orderNo} utworzone`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd')
    }
  }

  async function handleCancelConfirmed() {
    if (!cancelTarget) return
    try {
      await cancelMut.mutate(cancelTarget.id)
      refetchOrders()
      refetchMeat()
      toast.success(`Zlecenie ${cancelTarget.orderNo} anulowane — mięso zwolnione`)
      setCancelTarget(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd')
    }
  }

  async function handleConfirm(id: string, orderNo: string) {
    try {
      await confirmMut.mutate(id)
      refetchOrders()
      toast.success(`Zlecenie ${orderNo} potwierdzone — zablokowane do masowania`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd')
    }
  }

  async function handleApprove(id: string, orderNo: string) {
    try {
      await approveMut.mutate(id)
      refetchOrders()
      toast.success(`Zlecenie ${orderNo} zakończone`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Błąd')
    }
  }

  const STATUS_LABELS: Record<string, string> = {
    planned:     'Zaplanowane',
    confirmed:   'Potwierdzone',
    in_progress: 'W trakcie',
    done:        'Zakończone',
    cancelled:   'Anulowane',
  }
  const STATUS_CLASS: Record<string, string> = {
    planned:     'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-50',
    confirmed:   'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-50',
    in_progress: 'bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-50',
    done:        'bg-green-50 text-green-700 border-green-200 hover:bg-green-50',
    cancelled:   'bg-muted text-muted-foreground hover:bg-muted',
  }

  const loading = ptLoading || recLoading

  if (loading) return (
    <div className="space-y-2 p-4">
      {[1,2,3].map(i=><Skeleton key={i} className="h-12 w-full"/>)}
    </div>
  )

  return (
    <div className="space-y-4 animate-fade-in">

      <div className="flex items-center justify-between">
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Masowanie = półprodukt. Wynik masowania idzie do planowania produkcji.
        </p>
        <Button onClick={() => { resetModal(); setModalOpen(true) }} className="gap-1.5">
          <Plus size={14}/> Nowe zlecenie masowania
        </Button>
      </div>

      <Card>
        <div className="px-4 py-2.5 border-b flex items-center justify-between">
          <span className="text-[13px] font-semibold">Zlecenia masowania</span>
          <span className="text-[11px] text-muted-foreground">{(orders ?? []).length} zleceń</span>
        </div>

        {(orders ?? []).length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <ClipboardList size={32}/>
            <div className="font-semibold">Brak zleceń</div>
            <div className="text-sm">Utwórz pierwsze zlecenie masowania</div>
            <Button size="sm" onClick={() => { resetModal(); setModalOpen(true) }} className="gap-1.5 mt-1">
              <Plus size={13}/> Nowe zlecenie
            </Button>
          </div>
        ) : (
          <Table className="text-[12px]">
            <TableHeader>
              <TableRow>
                {['Nr zlecenia','Receptura','Rodzaj produktu','Mięso kg','Półprodukt kg','Maszyna','Status',''].map(h => (
                  <TableHead key={h} className="px-3 py-2 text-[10px] uppercase tracking-wider">{h}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {(orders ?? []).map(o => (
                <TableRow key={o.id}>
                  <TableCell className="px-3 py-2 font-mono font-bold text-primary">{o.orderNo}</TableCell>
                  <TableCell className="px-3 py-2">{o.recipeName}</TableCell>
                  <TableCell className="px-3 py-2 text-muted-foreground">{o.productTypeName ?? '—'}</TableCell>
                  <TableCell className="px-3 py-2 font-semibold text-muted-foreground tabular-nums">{fmtKg(o.meatKg)} kg</TableCell>
                  <TableCell className="px-3 py-2">
                    <span className="text-green-700 font-bold tabular-nums">{fmtKg(o.plannedOutputKg)} kg</span>
                    {o.plannedOutputKg > o.meatKg + 0.5 && (
                      <div className="text-[10px] text-green-600 tabular-nums">+{fmtKg(o.plannedOutputKg - o.meatKg)} kg uzysk</div>
                    )}
                  </TableCell>
                  <TableCell className="px-3 py-2 text-muted-foreground">{o.machineId ? `Masownica ${o.machineId}` : '—'}</TableCell>
                  <TableCell className="px-3 py-2">
                    <Badge variant="outline" className={STATUS_CLASS[o.status]}>
                      {STATUS_LABELS[o.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="px-3 py-2">
                    <div className="flex gap-1">
                      <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground"
                        onClick={() => setProgressTarget(o as any)}>
                        <Eye size={13}/>
                      </Button>
                      {o.status === 'planned' && (
                        <Button variant="outline" size="sm" className="h-7 text-[11px] text-purple-700 border-purple-200 hover:bg-purple-50 px-2"
                          onClick={() => handleConfirm(o.id, o.orderNo)}
                          disabled={confirmMut.loading}>
                          Potwierdź
                        </Button>
                      )}
                      {o.status === 'in_progress' && (
                        <Button variant="outline" size="sm" className="h-7 text-[11px] text-green-700 border-green-200 hover:bg-green-50 px-2"
                          onClick={() => handleApprove(o.id, o.orderNo)}
                          disabled={approveMut.loading}>
                          Zakończ
                        </Button>
                      )}
                      {(o.status === 'planned' || o.status === 'confirmed') && (
                        <Button variant="ghost" size="sm" className="h-7 text-[11px] text-destructive hover:text-destructive px-2"
                          onClick={() => setCancelTarget(o as any)}
                          disabled={cancelMut.loading}>
                          Anuluj
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={modalOpen} onOpenChange={open => { if (!open) setModalOpen(false) }}>
        <DialogContent className="max-w-2xl max-h-[92vh] flex flex-col p-0">
          <DialogHeader className="px-6 pt-6 pb-2 flex-shrink-0">
            <DialogTitle>Nowe zlecenie masowania</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto flex-1 px-6 pb-2 space-y-4">

            {/* Krok 1 */}
            <div className="border rounded p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  step > 1 ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground'}`}>
                  {step > 1 ? '✓' : '1'}
                </span>
                <span className="text-[13px] font-semibold">Rodzaj produktu i receptura</span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Rodzaj produktu (opcjonalnie)</Label>
                  <Select value={selProductId||'__none'} onValueChange={v => { setSelProductId(v==='__none'?'':v); setSelRecipeId('') }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">— dowolny —</SelectItem>
                      {productTypes.map(p => <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Receptura *</Label>
                  <Select value={selRecipeId||'__none'} onValueChange={v => { const val=v==='__none'?'':v; setSelRecipeId(val); if (val) setStep(2) }}>
                    <SelectTrigger className="h-9 text-sm"><SelectValue placeholder="Wybierz recepturę..."/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none">Wybierz recepturę...</SelectItem>
                      {filteredRecipes.map(r => <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>

            {/* Krok 2 — ilość */}
            {step >= 2 && (
              <div className="border rounded p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                    step > 2 ? 'bg-green-600 text-white' : 'bg-primary text-primary-foreground'}`}>
                    {step > 2 ? '✓' : '2'}
                  </span>
                  <span className="text-[13px] font-semibold">Ilość mięsa + wybór lotów</span>
                </div>

                <div className="flex items-end gap-4 mb-3">
                  <div>
                    <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Mięso (kg) *</Label>
                    <Input type="number" min="1" step="0.1" value={meatKg}
                      onChange={e => { setMeatKg(e.target.value); setSelLots([]) }}
                      className="w-36 h-9 font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"/>
                    <div className="text-[10px] text-muted-foreground mt-0.5">dostępne: {fmtKg(totalMeatAvail)} kg</div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => { autoSelectLots(); setStep(3) }}>
                    Auto-wybór FEFO
                  </Button>
                </div>

                <div className="border rounded">
                  <div className="px-3 py-1.5 bg-muted/50 border-b flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Dostępne partie mięsa (FEFO)</span>
                    <span className="text-[10px] text-muted-foreground">Zaznacz → wpisz kg</span>
                  </div>
                  <div className="max-h-48 overflow-y-auto divide-y">
                    {meatLots.map(lot => {
                      const selIdx    = selLots.findIndex(l => l.lotId === lot.id)
                      const isSel     = selIdx >= 0
                      const fullyUsed = Number(lot.kgAvailable) <= 0
                      return (
                        <div key={lot.id} className={`flex items-center gap-2 px-3 py-2 text-[12px] transition-colors ${
                          isSel ? 'bg-blue-50' : fullyUsed ? 'bg-muted/40 opacity-60' : 'hover:bg-muted/50'
                        }`}>
                          <input type="checkbox" checked={isSel} disabled={fullyUsed && !isSel}
                            onChange={e => {
                              if (e.target.checked) {
                                setSelLots(p => [...p, { lotId: lot.id, kg: Math.min(Number(lot.kgAvailable), requestedKg).toFixed(2) }])
                              } else {
                                setSelLots(p => p.filter(l => l.lotId !== lot.id))
                              }
                            }}
                            className="w-4 h-4 flex-shrink-0 accent-primary"/>
                          <span className="font-mono font-bold flex-shrink-0 w-24">{lot.lotNo}</span>
                          {(lot as any).materialName && (lot as any).materialTypeId !== 'mat-cwiartka' && (
                            <span className="text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded flex-shrink-0">
                              {(lot as any).materialName}
                            </span>
                          )}
                          <span className="text-muted-foreground flex-shrink-0 w-16 truncate">{lot.rawBatchNo}</span>
                          <span className="font-semibold text-green-700 flex-shrink-0 w-20 tabular-nums">{fmtKg(lot.kgAvailable)} kg</span>
                          {fullyUsed && <span className="text-[10px] font-bold text-red-700 bg-red-100 px-1.5 py-0.5 rounded flex-shrink-0">wyczerpana</span>}
                          <span className="text-muted-foreground text-[11px] flex-1">do: {fmtDatePl(lot.expiryDate)}</span>
                          {isSel && (
                            <Input type="number" min="0.1" step="0.1"
                              max={Number(lot.kgAvailable)}
                              value={selLots[selIdx].kg}
                              onChange={e => {
                                const v = parseFloat(e.target.value) || 0
                                const clamped = Math.min(v, Number(lot.kgAvailable))
                                setSelLots(p => p.map((l, i) => i === selIdx ? { ...l, kg: String(clamped) } : l))
                              }}
                              className={cn(
                                'w-20 h-7 text-sm font-bold text-right flex-shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                                parseFloat(selLots[selIdx].kg) > Number(lot.kgAvailable)
                                  ? 'border-destructive text-destructive'
                                  : 'border-blue-300'
                              )}
                              placeholder="kg"/>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {selLots.length > 0 && (
                  <div className="mt-2 flex items-center gap-2 text-[12px]">
                    <CheckCircle size={13} className="text-green-600"/>
                    <span className="text-green-700 font-semibold">
                      Wybrano {selLots.length} partii · {fmtKg(selLots.reduce((s, l) => s + (parseFloat(l.kg) || 0), 0))} kg
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Krok 3 — podgląd + zatwierdź */}
            {step >= 3 && selRecipeId && requestedKg > 0 && (
              <div className="border rounded p-4">
                <div className="flex items-center gap-2 mb-3">
                  <span className="w-6 h-6 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-[11px] font-bold">3</span>
                  <span className="text-[13px] font-semibold">Podgląd zlecenia</span>
                </div>

                <div className="border rounded text-[12px] mb-3 overflow-hidden">
                  <div className="px-3 py-2 bg-muted/50 border-b grid grid-cols-[1fr_100px_60px] gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Składnik</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground text-right">Ilość</span>
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Jedn.</span>
                  </div>
                  <div className="px-3 py-2 bg-blue-50/50 border-b grid grid-cols-[1fr_100px_60px] gap-2">
                    <span className="font-semibold text-blue-700">Mięso (baza)</span>
                    <span className="font-bold text-blue-700 text-right">{fmtKg(requestedKg, 2)}</span>
                    <span className="text-muted-foreground">kg</span>
                  </div>
                  {calcSteps.map((s, i) => (
                    <div key={i} className="px-3 py-2 border-b last:border-0 grid grid-cols-[1fr_100px_60px] gap-2">
                      <span className="font-medium">
                        {s.ingredientName}
                        {s.isUnlimited && <span className="ml-1 text-[10px] text-blue-600">(woda)</span>}
                      </span>
                      <span className="font-bold text-right">{s.qty}</span>
                      <span className="text-muted-foreground">{s.unit}</span>
                    </div>
                  ))}
                  <div className="px-3 py-2 bg-green-50 border-t-2 border-green-200 grid grid-cols-[1fr_100px_60px] gap-2 font-bold text-green-700">
                    <span>PÓŁPRODUKT ŁĄCZNIE</span>
                    <span className="text-right">{fmtKg(plannedOutput, 2)}</span>
                    <span>kg</span>
                  </div>
                </div>

                <div>
                  <Label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1 block">Uwagi</Label>
                  <Input placeholder="Opcjonalne uwagi..."
                    value={notes} onChange={e => setNotes(e.target.value)} className="h-8 text-sm"/>
                </div>
              </div>
            )}

          </div>

          {/* Przyciski zawsze widoczne — poza obszarem scrollowania */}
          <div className="flex gap-2 px-6 py-4 border-t flex-shrink-0 bg-background">
            <Button variant="outline" className="flex-1" onClick={() => setModalOpen(false)}>Anuluj</Button>
            {step < 3 ? (
              <Button className="flex-1"
                disabled={step === 1 ? !selRecipeId : selLots.length === 0}
                onClick={() => { if (step === 1 && selRecipeId) setStep(2); else if (step === 2 && selLots.length > 0) setStep(3) }}>
                Dalej <ChevronRight size={14} className="ml-1"/>
              </Button>
            ) : (
              <Button className="flex-1" disabled={createMut.loading || !selRecipeId || requestedKg <= 0 || selLots.length === 0}
                onClick={handleCreate}>
                {createMut.loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"/>}
                Utwórz zlecenie masowania
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal podglądu postępu zlecenia */}
      {progressTarget && (() => {
        const o          = progressTarget as any
        const kgInMach   = o.kgInMachine ?? 0
        const kgDone     = Math.max(0, (o.kgDone ?? 0) - kgInMach)  // wymieszane + zatwierdzone
        const kgRemaining = Math.max(0, (o.kgRemaining ?? o.meatKg) - kgInMach)
        const activeLock = (locks ?? []).find((l: any) => l.orderId === o.id)
        const pct = o.meatKg > 0 ? Math.round((kgDone / o.meatKg) * 100) : 0
        return (
          <Dialog open onOpenChange={open => { if (!open) setProgressTarget(null) }}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Eye size={16}/> {o.orderNo} — Postęp masowania
                </DialogTitle>
                <DialogDescription>{o.recipeName}{o.productTypeName ? ` · ${o.productTypeName}` : ''}</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1">
                {/* Pasek postępu */}
                <div>
                  <div className="flex justify-between text-[11px] text-muted-foreground mb-1">
                    <span>Postęp (zatwierdzone)</span><span className="font-bold">{pct}%</span>
                  </div>
                  <div className="h-3 bg-muted rounded-full overflow-hidden">
                    <div className="h-full bg-brand rounded-full transition-all"
                      style={{ width: `${Math.min(100, pct)}%` }}/>
                  </div>
                </div>
                {/* Kafelki — 4 jeśli jest aktywna sesja, 3 jeśli nie */}
                <div className={`grid gap-2 ${kgInMach > 0 ? 'grid-cols-2' : 'grid-cols-3'}`}>
                  <div className="border rounded-xl p-3 text-center bg-blue-50 text-blue-700 border-blue-200">
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-1">Zaplanowane</div>
                    <div className="text-xl font-black tabular-nums">{fmt(o.meatKg)}</div>
                    <div className="text-[10px] mt-0.5">kg</div>
                  </div>
                  <div className="border rounded-xl p-3 text-center bg-green-50 text-green-700 border-green-200">
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-1">Wymieszano</div>
                    <div className="text-xl font-black tabular-nums">{fmt(kgDone)}</div>
                    <div className="text-[10px] mt-0.5">kg</div>
                  </div>
                  {kgInMach > 0 && (
                    <TimerTile kg={kgInMach} lock={activeLock} />
                  )}
                  <div className={`border rounded-xl p-3 text-center ${kgRemaining > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-muted text-muted-foreground border-border'}`}>
                    <div className="text-[10px] font-bold uppercase tracking-wide mb-1">Pozostało</div>
                    <div className="text-xl font-black tabular-nums">{fmt(kgRemaining)}</div>
                    <div className="text-[10px] mt-0.5">kg</div>
                  </div>
                </div>
                {/* Status */}
                <div className="bg-muted/30 rounded-xl px-3 py-2.5 flex items-center justify-between text-[12px]">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="outline" className={STATUS_CLASS[o.status]}>{STATUS_LABELS[o.status]}</Badge>
                </div>
                {/* Partie mięsa */}
                {(o.meatLots ?? []).length > 0 && (
                  <div className="border rounded-xl overflow-hidden">
                    <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground px-3 py-1.5 bg-muted/30 border-b">Partie mięsa</div>
                    {(o.meatLots ?? []).map((lot: any) => (
                      <div key={lot.meatLotId} className="flex justify-between px-3 py-1.5 border-b last:border-0 text-[12px]">
                        <span className="font-mono font-bold">{lot.meatLotNo}</span>
                        <span className="text-muted-foreground">{lot.rawBatchNo}</span>
                        <span className="font-semibold">{fmt(lot.kgPlanned)} kg</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <Button variant="outline" className="w-full" onClick={() => setProgressTarget(null)}>Zamknij</Button>
            </DialogContent>
          </Dialog>
        )
      })()}

      {/* Modal potwierdzenia anulowania */}
      {cancelTarget && (() => {
        const kgDone      = (cancelTarget as any).kgDone ?? 0
        const kgRemaining = (cancelTarget as any).kgRemaining ?? cancelTarget.meatKg
        const hasPartial  = kgDone > 0
        return (
          <Dialog open onOpenChange={open => { if (!open) setCancelTarget(null) }}>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2 text-destructive">
                  <AlertIcon size={18}/> Anulować zlecenie {cancelTarget.orderNo}?
                </DialogTitle>
                <DialogDescription>Ta operacja jest częściowo nieodwracalna</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-1">
                {hasPartial && (
                  <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                    <div className="text-[11px] font-bold text-red-600 uppercase mb-1 flex items-center gap-1">
                      <AlertIcon size={11}/> Mięso już przetworzone — nie można przywrócić
                    </div>
                    <div className="text-2xl font-black text-red-700">{fmt(kgDone)} kg</div>
                    <div className="text-[12px] text-red-500 mt-0.5">
                      Zostało wymieszane jako: {cancelTarget.recipeName}. Pozostaje w magazynie przyprawionym.
                    </div>
                  </div>
                )}
                <div className="bg-green-50 border border-green-200 rounded-xl px-4 py-3">
                  <div className="text-[11px] font-bold text-green-700 uppercase mb-1 flex items-center gap-1">
                    <CheckCircle size={11}/> Mięso do zwolnienia — wróci do magazynu
                  </div>
                  <div className="text-2xl font-black text-green-700">{fmt(kgRemaining)} kg</div>
                  <div className="text-[12px] text-green-600 mt-0.5">
                    Zarezerwowane partie wrócą do puli dostępnego mięsa.
                  </div>
                </div>
                {!hasPartial && (
                  <div className="text-[12px] text-muted-foreground bg-muted/30 rounded-xl px-4 py-3">
                    Zlecenie nie było jeszcze realizowane. Wszystkie {fmt(cancelTarget.meatKg)} kg mięsa zostanie zwolnione.
                  </div>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="outline" className="flex-1" onClick={() => setCancelTarget(null)}>
                  Wróć
                </Button>
                <Button variant="destructive" className="flex-1"
                  disabled={cancelMut.loading}
                  onClick={handleCancelConfirmed}>
                  {cancelMut.loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2"/>}
                  Anuluj zlecenie
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        )
      })()}
    </div>
  )
}
