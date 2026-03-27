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
import { useState, useMemo } from 'react'
import { Spinner, EmptyState, Modal, Toast } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useProductTypes } from '../hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import { useApi, useMutation } from '@/hooks/useApi'
import { meatStockApi, mixingOrdersApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import type { CreateMixingOrderDto, MixingOrder, MixingOrderMeatLot } from '@/lib/mockApi'
import {
  Calculator, Package, BookOpen, Beef, AlertTriangle,
  CheckCircle, Plus, X, ChevronRight, ClipboardList,
} from 'lucide-react'

interface ToastState { msg: string; type: 'success'|'error'; visible: boolean }
const HIDDEN: ToastState = { msg: '', type: 'success', visible: false }

export function PlanningPage() {
  const { productTypes, loading: ptLoading } = useProductTypes()
  const { recipes, loading: recLoading }     = useRecipes()
  const { data: meatData }                   = useApi(() => meatStockApi.list())
  const { data: orders, refetch: refetchOrders } = useApi(() => mixingOrdersApi.list())

  const createMut = useMutation((dto: CreateMixingOrderDto) => mixingOrdersApi.create(dto))
  const cancelMut = useMutation((id: string) => mixingOrdersApi.cancel(id))

  const [modalOpen,    setModalOpen]    = useState(false)
  const [step,         setStep]         = useState<1|2|3>(1)
  const [selProductId, setSelProductId] = useState('')
  const [selRecipeId,  setSelRecipeId]  = useState('')
  const [meatKg,       setMeatKg]       = useState('100')
  const [selLots,      setSelLots]      = useState<{ lotId: string; kg: string }[]>([])
  const [notes,        setNotes]        = useState('')
  const [toast,        setToast]        = useState<ToastState>(HIDDEN)

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(HIDDEN), 3000)
  }

  const meatLots  = useMemo(() =>
    (meatData?.data ?? [])
      // Pokazuj loty AVAILABLE — z kgAvailable > 0 (nie wliczaj RESERVED/IN_PROCESS)
      .filter(m => m.status !== 'DEPLETED' && m.status !== 'IN_PRODUCTION' && Number(m.kgAvailable) > 0)
      .sort((a, b) => a.expiryDate > b.expiryDate ? 1 : -1),  // FEFO
    [meatData]
  )
  const totalMeatAvail = meatLots.reduce((s, m) => s + Number(m.kgAvailable), 0)
  const selProduct     = productTypes.find(p => p.id === selProductId)
  const selRecipe      = recipes.find(r => r.id === selRecipeId)
  const requestedKg    = parseFloat(meatKg) || 0
  const filteredRecipes= useMemo(() =>
    selProductId ? recipes.filter(r => !r.productTypeId || r.productTypeId === selProductId) : recipes,
    [recipes, selProductId]
  )

  // Kalkulacja składników
  const calcSteps = useMemo(() => {
    if (!selRecipe || requestedKg <= 0) return []
    return selRecipe.ingredients.map(ri => ({
      ingredientName: ri.ingredientName,
      unit:           ri.unit,
      qty:            Math.round(ri.qtyPer100kg * requestedKg / 100 * 1000) / 1000,
      isUnlimited:    ri.isUnlimited,
    }))
  }, [selRecipe, requestedKg])

  // BUGFIX: Suma = mięso (baza) + wszystkie składniki w kg/l
  const plannedOutput = useMemo(() => {
    if (!selRecipe || requestedKg <= 0) return 0
    const ingredientsKg = (selRecipe.ingredients ?? [])
      .filter(ri => ri.unit === 'kg' || ri.unit === 'l')
      .reduce((s, ri) => s + (ri.qtyPer100kg * requestedKg / 100), 0)
    return Math.round((requestedKg + ingredientsKg) * 100) / 100
  }, [selRecipe, requestedKg])

  // Auto-podpowiedź lotów FEFO
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
    if (!selRecipeId) { showToast('Wybierz recepturę', 'error'); return }
    if (requestedKg <= 0) { showToast('Podaj ilość mięsa', 'error'); return }
    if (selLots.length === 0) { showToast('Wybierz partie mięsa', 'error'); return }

    // Walidacja: każdy lot nie może przekroczyć dostępnego
    for (const l of selLots) {
      const lot = meatLots.find(m => m.id === l.lotId)
      const kg  = parseFloat(l.kg) || 0
      if (!lot) continue
      if (kg > Number(lot.kgAvailable)) {
        showToast(`Lot ${lot.lotNo}: wpisano ${kg} kg, dostępne ${Number(lot.kgAvailable).toFixed(2)} kg`, 'error')
        return
      }
    }

    const totalLots = selLots.reduce((s, l) => s + (parseFloat(l.kg) || 0), 0)
    if (Math.abs(totalLots - requestedKg) > 0.5) {
      showToast(`Suma lotów (${totalLots.toFixed(2)} kg) ≠ planowane mięso (${requestedKg} kg)`, 'error')
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
      setModalOpen(false)
      resetModal()
      showToast(`Zlecenie ${created.orderNo} utworzone`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Błąd', 'error')
    }
  }

  async function handleCancel(id: string, orderNo: string) {
    try {
      await cancelMut.mutate(id)
      refetchOrders()
      showToast(`Zlecenie ${orderNo} anulowane`)
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Błąd', 'error')
    }
  }

  const STATUS_LABELS: Record<string, string> = {
    planned:     'Zaplanowane',
    in_progress: 'W trakcie',
    done:        'Zakończone',
    cancelled:   'Anulowane',
  }
  const STATUS_CLS: Record<string, string> = {
    planned:     'bg-blue-50 text-blue-700',
    in_progress: 'bg-amber-500/15 text-amber-400',
    done:        'bg-green-500/15 text-green-400',
    cancelled:   'bg-gray-100 text-gray-500',
  }

  const loading = ptLoading || recLoading

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Nagłówek + nowe zlecenie */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-ink-3 mt-0.5">
            Masowanie = półprodukt. Wynik masowania idzie do planowania produkcji.
          </p>
        </div>
        <Button icon={<Plus size={14} />} onClick={() => { resetModal(); setModalOpen(true) }}>
          Nowe zlecenie masowania
        </Button>
      </div>

      {/* Lista zleceń */}
      <div className="bg-surface border border-surface-4 rounded-xl">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">Zlecenia masowania</span>
          <span className="text-[11px] text-ink-4">{(orders ?? []).length} zleceń</span>
        </div>

        {(orders ?? []).length === 0 ? (
          <EmptyState
            icon={<ClipboardList size={32} />}
            title="Brak zleceń"
            message="Utwórz pierwsze zlecenie masowania"
            action={<Button size="sm" icon={<Plus size={13} />} onClick={() => { resetModal(); setModalOpen(true) }}>Nowe zlecenie</Button>}
          />
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 bg-surface-2">
                {['Nr zlecenia','Receptura','Rodzaj produktu','Mięso kg','Półprodukt kg','Maszyna','Status',''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {(orders ?? []).map(o => (
                <tr key={o.id} className="hover:bg-surface-3/60">
                  <td className="px-3 py-2 font-mono font-bold text-brand">{o.orderNo}</td>
                  <td className="px-3 py-2 text-ink">{o.recipeName}</td>
                  <td className="px-3 py-2 text-ink-3">{o.productTypeName ?? '—'}</td>
                  <td className="px-3 py-2 font-semibold">{fmtKg(o.meatKg)} kg</td>
                  <td className="px-3 py-2 text-green-700 font-semibold">{fmtKg(o.plannedOutputKg)} kg</td>
                  <td className="px-3 py-2 text-ink-3">{o.machineId ? `Masownica ${o.machineId}` : '—'}</td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${STATUS_CLS[o.status]}`}>
                      {STATUS_LABELS[o.status]}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {o.status === 'planned' && (
                      <button onClick={() => handleCancel(o.id, o.orderNo)}
                        className="text-[11px] text-red-600 hover:underline">Anuluj</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal tworzenia zlecenia */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title="Nowe zlecenie masowania" size="lg" preventClose>
        <div className="space-y-4">

          {/* Krok 1 */}
          <div className="border border-surface-4 p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                step > 1 ? 'bg-green-600 text-white' : 'bg-brand text-white'}`}>
                {step > 1 ? '✓' : '1'}
              </span>
              <span className="text-[13px] font-semibold">Rodzaj produktu i receptura</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Rodzaj produktu (opcjonalnie)</label>
                <select value={selProductId} onChange={e => { setSelProductId(e.target.value); setSelRecipeId('') }}
                  className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand">
                  <option value="">— dowolny —</option>
                  {productTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Receptura *</label>
                <select value={selRecipeId} onChange={e => { setSelRecipeId(e.target.value); if (e.target.value) setStep(2) }}
                  className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand">
                  <option value="">Wybierz recepturę...</option>
                  {filteredRecipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Krok 2 — ilość */}
          {step >= 2 && (
            <div className="border border-surface-4 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold flex-shrink-0 ${
                  step > 2 ? 'bg-green-600 text-white' : 'bg-brand text-white'}`}>
                  {step > 2 ? '✓' : '2'}
                </span>
                <span className="text-[13px] font-semibold">Ilość mięsa + wybór lotów</span>
              </div>

              <div className="flex items-end gap-4 mb-3">
                <div>
                  <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Mięso (kg) *</label>
                  <input type="number" min="1" step="0.1" value={meatKg}
                    onChange={e => { setMeatKg(e.target.value); setSelLots([]) }}
                    className="w-36 h-9 px-3 text-sm font-bold border border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  <div className="text-[10px] text-ink-3 mt-0.5">dostępne: {fmtKg(totalMeatAvail)} kg</div>
                </div>
                <Button size="sm" variant="secondary" onClick={() => { autoSelectLots(); setStep(3) }}>
                  Auto-wybór FEFO
                </Button>
              </div>

              {/* Loty mięsa */}
              <div className="border border-surface-4">
                <div className="px-3 py-1.5 bg-surface-3 border-b border-surface-4 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Dostępne partie mięsa (FEFO)</span>
                  <span className="text-[10px] text-ink-4">Zaznacz → wpisz kg</span>
                </div>
                <div className="max-h-48 overflow-y-auto divide-y divide-surface-4">
                  {meatLots.map(lot => {
                    const selIdx = selLots.findIndex(l => l.lotId === lot.id)
                    const isSel  = selIdx >= 0
                    return (
                      <div key={lot.id} className={`flex items-center gap-3 px-3 py-2 text-[12px] ${isSel ? 'bg-blue-50' : 'hover:bg-surface-3/60'}`}>
                        <input type="checkbox" checked={isSel}
                          onChange={e => {
                            if (e.target.checked) {
                              setSelLots(p => [...p, { lotId: lot.id, kg: Math.min(Number(lot.kgAvailable), requestedKg).toFixed(2) }])
                            } else {
                              setSelLots(p => p.filter(l => l.lotId !== lot.id))
                            }
                          }}
                          className="w-4 h-4 flex-shrink-0" />
                        <span className="font-mono font-bold w-28">{lot.lotNo}</span>
                        <span className="text-ink-3 w-20">{lot.rawBatchNo}</span>
                        <div className="w-28">
                          <div className="font-semibold text-green-700">{fmtKg(lot.kgAvailable)} kg</div>
                          {Number((lot as any).kgReserved ?? 0) > 0 && (
                            <div className="text-[10px] text-amber-600">+{fmtKg((lot as any).kgReserved, 1)} zarezerwowane</div>
                          )}
                        </div>
                        <span className="text-ink-4 text-[11px] w-24">ważne: {fmtDatePl(lot.expiryDate)}</span>
                        {isSel && (
                          <input type="number" min="0.1" step="0.1"
                            max={Number(lot.kgAvailable)}
                            value={selLots[selIdx].kg}
                            onChange={e => {
                              const v = parseFloat(e.target.value) || 0
                              // Nie pozwól wpisać więcej niż dostępne
                              const clamped = Math.min(v, Number(lot.kgAvailable))
                              setSelLots(p => p.map((l, i) => i === selIdx ? { ...l, kg: String(clamped) } : l))
                            }}
                            className={cn(
                              'w-20 h-7 px-2 text-sm font-bold text-right border bg-white focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none',
                              parseFloat(selLots[selIdx].kg) > Number(lot.kgAvailable)
                                ? 'border-red-400 text-red-600'
                                : 'border-blue-300'
                            )}
                            placeholder="kg" />
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {selLots.length > 0 && (
                <div className="mt-2 flex items-center gap-2 text-[12px]">
                  <CheckCircle size={13} className="text-green-600" />
                  <span className="text-green-700 font-semibold">
                    Wybrano {selLots.length} partii · {fmtKg(selLots.reduce((s, l) => s + (parseFloat(l.kg) || 0), 0))} kg
                  </span>
                  {step < 3 && selLots.length > 0 && (
                    <button onClick={() => setStep(3)} className="ml-2 text-brand font-semibold text-[11px] hover:underline flex items-center gap-1">
                      Dalej <ChevronRight size={12} />
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Krok 3 — podgląd + zatwierdź */}
          {step >= 3 && selRecipeId && requestedKg > 0 && (
            <div className="border border-surface-4 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="w-6 h-6 rounded-full bg-brand text-white flex items-center justify-center text-[11px] font-bold">3</span>
                <span className="text-[13px] font-semibold">Podgląd zlecenia</span>
              </div>

              <div className="border border-surface-4 text-[12px] mb-3">
                <div className="px-3 py-2 bg-surface-3 border-b border-surface-4 grid grid-cols-[1fr_100px_60px] gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Składnik</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 text-right">Ilość</span>
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">Jedn.</span>
                </div>
                <div className="px-3 py-2 bg-blue-50/50 border-b border-surface-4 grid grid-cols-[1fr_100px_60px] gap-2">
                  <span className="font-semibold text-blue-700">Mięso (baza)</span>
                  <span className="font-bold text-blue-700 text-right">{fmtKg(requestedKg, 2)}</span>
                  <span className="text-ink-3">kg</span>
                </div>
                {calcSteps.map((s, i) => (
                  <div key={i} className="px-3 py-2 border-b border-surface-4 last:border-0 grid grid-cols-[1fr_100px_60px] gap-2">
                    <span className="font-medium text-ink">
                      {s.ingredientName}
                      {s.isUnlimited && <span className="ml-1 text-[10px] text-blue-600">(woda)</span>}
                    </span>
                    <span className="font-bold text-right">{s.qty}</span>
                    <span className="text-ink-3">{s.unit}</span>
                  </div>
                ))}
                <div className="px-3 py-2 bg-green-50 border-t-2 border-green-200 grid grid-cols-[1fr_100px_60px] gap-2 font-bold text-green-700">
                  <span>PÓŁPRODUKT ŁĄCZNIE</span>
                  <span className="text-right">{fmtKg(plannedOutput, 2)}</span>
                  <span>kg</span>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Uwagi</label>
                <input type="text" placeholder="Opcjonalne uwagi..."
                  value={notes} onChange={e => setNotes(e.target.value)}
                  className="w-full h-8 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setModalOpen(false)}>Anuluj</Button>
            <Button fullWidth loading={createMut.loading}
              onClick={handleCreate}
              disabled={!selRecipeId || requestedKg <= 0 || selLots.length === 0}>
              Utwórz zlecenie masowania
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
