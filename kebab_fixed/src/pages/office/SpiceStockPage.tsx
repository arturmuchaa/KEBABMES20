/**
 * SpiceStockPage — Magazyn Przypraw i Dodatków
 *
 * NIE tworzy nowego magazynu — używa istniejącego ingredientsApi + ingredientReceiptsApi.
 * Dane zasilane przez:
 *   1. Faktury kategorii PRZYPRAWY_I_DODATKI (PurchaseInvoicesPage)
 *   2. Ręczne przyjęcie WZ bezpośrednio tutaj
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { ingredientsApi, ingredientReceiptsApi } from '@/lib/apiClient'
import { Spinner, EmptyState, Modal, Toast } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtKg, fmtDatePl, todayIso } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { FlaskConical, AlertTriangle, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import type { IngredientCategory } from '@/features/ingredients/types'
import { useIngredients } from '@/features/ingredients/hooks'

const CAT_LABELS: Record<string, string> = {
  spice_mix: 'Mieszanka',
  functional: 'Dod. funkcjonalny',
  water: 'Woda',
  other: 'Inne',
}

interface ToastState { msg: string; type: 'success'|'error'; visible: boolean }
const HIDDEN: ToastState = { msg: '', type: 'success', visible: false }

function ExpiryCell({ date }: { date?: string }) {
  if (!date) return <span className="text-ink-4 text-[11px]">—</span>
  const { daysLeft } = getExpiryStatus(date)
  const cls = daysLeft < 0 ? 'text-red-700 bg-red-50'
    : daysLeft <= 30 ? 'text-amber-700 bg-amber-50'
    : 'text-green-700 bg-green-50'
  return (
    <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded ${cls}`}>
      {fmtDatePl(date)}
      {daysLeft < 0 ? ' !' : daysLeft <= 30 ? ` (${daysLeft}d)` : ''}
    </span>
  )
}

export function SpiceStockPage() {
  const { ingredients, stock, loading, createIngredient, addReceipt, createLoading, receiptLoading } = useIngredients()
  const { data: receipts, refetch: refetchReceipts } = useApi(() => ingredientReceiptsApi.list())

  const [expanded,         setExpanded]         = useState<string | null>(null)
  const [ingModal,         setIngModal]          = useState(false)
  const [receiptModal,     setReceiptModal]      = useState(false)
  const [selIngId,         setSelIngId]          = useState('')
  const [toast,            setToast]             = useState<ToastState>(HIDDEN)

  // Nowy składnik
  const [newName,     setNewName]     = useState('')
  const [newCat,      setNewCat]      = useState<IngredientCategory>('spice_mix')
  const [newUnit,     setNewUnit]     = useState('kg')

  // Przyjęcie WZ
  const [recQty,     setRecQty]     = useState('')
  const [recPrice,   setRecPrice]   = useState('')
  const [recInvoice, setRecInvoice] = useState('')
  const [recDate,    setRecDate]    = useState(todayIso())
  const [recExpiry,  setRecExpiry]  = useState('')
  const [recBatchNo, setRecBatchNo] = useState('')

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(HIDDEN), 3000)
  }

  // Tylko składniki nieograniczone nie są wodą — pomiń wodę w widoku magazynowym
  const displayIngredients = ingredients.filter(i => !i.isUnlimited)

  // Stan magazynowy + ostatnie przyjęcia
  const stockMap    = useMemo(() => new Map(stock.map(s => [s.ingredientId, s])), [stock])
  const receiptMap  = useMemo(() => {
    const m = new Map<string, typeof receipts>()
    ;(receipts ?? []).forEach(r => {
      const arr = m.get(r.ingredientId) ?? []
      m.set(r.ingredientId, [...arr, r])
    })
    return m
  }, [receipts])

  // Alerty — kończy się stan lub bliska data ważności
  const alerts = useMemo(() => {
    return displayIngredients.filter(ing => {
      const s = stockMap.get(ing.id)
      if (!s) return false
      if (s.qtyAvailable <= 0) return true
      // Sprawdź czy którekolwiek przyjęcie wygasa w ciągu 30 dni
      const recs = receiptMap.get(ing.id) ?? []
      return recs.some(r => r.expiryDate && getExpiryStatus(r.expiryDate).daysLeft <= 30)
    })
  }, [displayIngredients, stockMap, receiptMap])

  async function handleCreateIng() {
    const err = await createIngredient({ name: newName, category: newCat, unit: newUnit, isUnlimited: false })
    if (err) { showToast(err, 'error'); return }
    showToast(`"${newName}" dodany do magazynu`)
    setIngModal(false); setNewName(''); setNewCat('spice_mix'); setNewUnit('kg')
  }

  async function handleReceipt() {
    const err = await addReceipt({
      ingredientId: selIngId,
      qty:          parseFloat(recQty) || 0,
      pricePerUnit: parseFloat(recPrice) || 0,
      invoiceNo:    recInvoice || undefined,
      receivedDate: recDate,
      notes:        recExpiry ? `Ważność: ${recExpiry}` : undefined,
    })
    if (err) { showToast(err, 'error'); return }
    refetchReceipts()
    showToast('Przyjęcie WZ zapisane')
    setReceiptModal(false)
    setRecQty(''); setRecPrice(''); setRecInvoice(''); setRecExpiry(''); setRecBatchNo('')
  }

  if (loading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Alerty */}
      {alerts.length > 0 && (
        <div className="border border-amber-200 bg-amber-50">
          <div className="px-3 py-2 border-b border-amber-200 flex items-center gap-2">
            <AlertTriangle size={13} className="text-amber-600" />
            <span className="text-[12px] font-semibold text-amber-700">{alerts.length} alertów — niski stan lub bliska data ważności</span>
          </div>
          <div className="divide-y divide-amber-100">
            {alerts.map(ing => {
              const s = stockMap.get(ing.id)
              return (
                <div key={ing.id} className="px-3 py-1.5 flex items-center gap-3 text-[12px]">
                  <span className="font-semibold text-amber-700 w-40 truncate">{ing.name}</span>
                  <span className="text-amber-600">
                    {(s?.qtyAvailable ?? 0) <= 0 ? 'Brak stanu!' : `${(s?.qtyAvailable ?? 0).toFixed(2)} ${ing.unit}`}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-surface-4 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">Składniki</div>
          <div className="text-xl font-bold text-ink">{displayIngredients.length}</div>
        </div>
        <div className="bg-white border border-surface-4 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">Dostępne</div>
          <div className="text-xl font-bold text-green-700">
            {displayIngredients.filter(i => (stockMap.get(i.id)?.qtyAvailable ?? 0) > 0).length}
          </div>
        </div>
        <div className="bg-white border border-surface-4 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 mb-0.5">Alerty</div>
          <div className={`text-xl font-bold ${alerts.length > 0 ? 'text-amber-600' : 'text-ink-4'}`}>{alerts.length}</div>
        </div>
      </div>

      {/* Tabela stanów */}
      <div className="bg-white border border-surface-4 shadow-card">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FlaskConical size={13} className="text-ink-3" />
            <span className="text-[13px] font-semibold text-ink">Stany magazynowe</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setIngModal(true)}>
              Nowy składnik
            </Button>
            <Button size="sm" icon={<Plus size={13} />} onClick={() => { setSelIngId(''); setReceiptModal(true) }}>
              Przyjęcie WZ
            </Button>
          </div>
        </div>

        {displayIngredients.length === 0 ? (
          <EmptyState
            icon={<FlaskConical size={32} />}
            title="Brak składników w magazynie"
            message='Dodaj składniki ręcznie lub przez Faktury (kategoria "Przyprawy i dodatki")'
            action={<Button size="sm" icon={<Plus size={13} />} onClick={() => setIngModal(true)}>Dodaj składnik</Button>}
          />
        ) : (
          <div>
            {/* Nagłówek */}
            <div className="grid grid-cols-[1fr_100px_100px_110px_80px_40px] gap-2 px-4 py-2 bg-surface-2 border-b border-surface-4">
              {['Nazwa składnika','Stan','Jedn.','Ost. przyjęcie','Ważność',''].map(h => (
                <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</div>
              ))}
            </div>

            <div className="divide-y divide-surface-4">
              {displayIngredients.map(ing => {
                const s     = stockMap.get(ing.id)
                const recs  = (receiptMap.get(ing.id) ?? []).sort((a, b) => b.receivedDate > a.receivedDate ? 1 : -1)
                const last  = recs[0]
                const isExp = expanded === ing.id
                const qty   = s?.qtyAvailable ?? 0

                return (
                  <div key={ing.id}>
                    <div
                      className="grid grid-cols-[1fr_100px_100px_110px_80px_40px] gap-2 px-4 py-2.5 items-center hover:bg-surface-2 cursor-pointer text-[12px]"
                      onClick={() => setExpanded(isExp ? null : ing.id)}
                    >
                      <div className="font-semibold text-ink truncate">{ing.name}</div>
                      <div className={`font-bold ${qty > 0 ? 'text-green-700' : 'text-red-600'}`}>
                        {qty.toFixed(3)}
                      </div>
                      <div className="text-ink-3">{ing.unit}</div>
                      <div className="text-ink-3 text-[11px]">{last ? fmtDatePl(last.receivedDate) : '—'}</div>
                      <div>
                        {last?.notes?.includes('Ważność:') ? (
                          <ExpiryCell date={last.notes.replace('Ważność: ', '')} />
                        ) : <span className="text-ink-4 text-[11px]">—</span>}
                      </div>
                      <div className="flex justify-end gap-1">
                        <button
                          onClick={e => { e.stopPropagation(); setSelIngId(ing.id); setReceiptModal(true) }}
                          className="text-[10px] font-medium text-brand border border-brand/30 px-1.5 py-0.5 rounded hover:bg-blue-50"
                        >
                          +WZ
                        </button>
                        {isExp ? <ChevronUp size={14} className="text-ink-4" /> : <ChevronDown size={14} className="text-ink-4" />}
                      </div>
                    </div>

                    {/* Historia przyjęć */}
                    {isExp && recs.length > 0 && (
                      <div className="px-4 pb-3 bg-surface-2 border-t border-surface-4">
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-4 py-1.5">Historia przyjęć</div>
                        <table className="w-full text-[11px]">
                          <thead>
                            <tr className="text-[10px] text-ink-4">
                              <th className="text-left py-1">Data</th>
                              <th className="text-right py-1">Ilość</th>
                              <th className="text-right py-1">Cena/jedn.</th>
                              <th className="text-left py-1">FV / WZ</th>
                              <th className="text-left py-1">Ważność</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-surface-4">
                            {recs.slice(0, 10).map(r => (
                              <tr key={r.id}>
                                <td className="py-1">{fmtDatePl(r.receivedDate)}</td>
                                <td className="py-1 text-right font-bold">{r.qty} {r.unit}</td>
                                <td className="py-1 text-right text-ink-3">{r.pricePerUnit > 0 ? `${r.pricePerUnit.toFixed(2)} zł` : '—'}</td>
                                <td className="py-1 font-mono text-ink-3">{r.invoiceNo || '—'}</td>
                                <td className="py-1">
                                  {r.notes?.includes('Ważność:') ? (
                                    <ExpiryCell date={r.notes.replace('Ważność: ', '')} />
                                  ) : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {isExp && recs.length === 0 && (
                      <div className="px-4 pb-3 bg-surface-2 border-t border-surface-4 text-[12px] text-ink-3 py-2">
                        Brak przyjęć — dodaj przez WZ lub Faktury
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Modal: nowy składnik */}
      <Modal open={ingModal} onClose={() => setIngModal(false)} title="Nowy składnik" size="sm" preventClose>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Nazwa *</label>
            <input type="text" placeholder="np. Van Hess Hell, Chiken BKS"
              value={newName} onChange={e => setNewName(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Kategoria</label>
            <select value={newCat} onChange={e => setNewCat(e.target.value as IngredientCategory)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand">
              <option value="spice_mix">Mieszanka przyprawowa</option>
              <option value="functional">Dodatek funkcjonalny</option>
              <option value="other">Inne</option>
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Jednostka</label>
            <select value={newUnit} onChange={e => setNewUnit(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand">
              <option value="kg">kg</option>
              <option value="l">l</option>
              <option value="szt">szt</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setIngModal(false)}>Anuluj</Button>
            <Button fullWidth loading={createLoading} onClick={handleCreateIng} disabled={!newName.trim()}>Dodaj</Button>
          </div>
        </div>
      </Modal>

      {/* Modal: przyjęcie WZ */}
      <Modal open={receiptModal} onClose={() => setReceiptModal(false)} title="Przyjęcie WZ" subtitle="Ręczne przyjęcie bez faktury" size="sm" preventClose>
        <div className="space-y-3">
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Składnik *</label>
            <select value={selIngId} onChange={e => setSelIngId(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand">
              <option value="">Wybierz...</option>
              {displayIngredients.map(i => <option key={i.id} value={i.id}>{i.name} [{i.unit}]</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Ilość *</label>
              <input type="number" min="0" step="0.001" placeholder="0.000"
                value={recQty} onChange={e => setRecQty(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Cena / jedn.</label>
              <input type="number" min="0" step="0.01" placeholder="0.00"
                value={recPrice} onChange={e => setRecPrice(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Data ważności (zalecana)</label>
            <input type="date" value={recExpiry} onChange={e => setRecExpiry(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
            <p className="text-[10px] text-ink-4 mt-0.5">Zazwyczaj +12 miesięcy od daty produkcji</p>
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Nr WZ / FV</label>
            <input type="text" placeholder="np. WZ 001/2025"
              value={recInvoice} onChange={e => setRecInvoice(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Data przyjęcia</label>
            <input type="date" value={recDate} onChange={e => setRecDate(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
          </div>
          <div className="bg-surface-2 px-3 py-2 text-[11px] text-ink-3">
            💡 Faktura może zostać powiązana później w module Faktury i WZ
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setReceiptModal(false)}>Anuluj</Button>
            <Button fullWidth loading={receiptLoading} onClick={handleReceipt}
              disabled={!selIngId || !recQty || parseFloat(recQty) <= 0}>
              Zatwierdź przyjęcie
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
