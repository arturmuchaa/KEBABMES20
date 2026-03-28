/**
 * ClientOrdersPage — Zamówienia od kontrahentów
 * Pozycje: ilość szt × kg/szt × rodzaj produktu × receptura × tuleja × klient
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, clientsApi, packagingApi } from '@/lib/apiClient'
import { Spinner, EmptyState, Modal , PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtKg, fmtDatePl, todayIso } from '@/lib/utils'
import {
  Check,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  X,
} from 'lucide-react'
import { useProductTypes } from '@/features/products/hooks'
import { useRecipes } from '@/features/ingredients/hooks'
import type { ClientOrder, CreateClientOrderDto, CreateOrderLineDto } from '@/lib/mockApi'

interface LineForm {
  qty:           string
  kgPerUnit:     string
  productTypeId: string
  recipeId:      string
  packagingId:   string
  notes:         string
}

const emptyLine = (): LineForm => ({ qty:'', kgPerUnit:'', productTypeId:'', recipeId:'', packagingId:'', notes:'' })

const STATUS_LABELS: Record<ClientOrder['status'], string> = {
  draft:'Szkic', confirmed:'Potwierdzone', in_production:'W produkcji', done:'Zrealizowane', cancelled:'Anulowane',
}
const STATUS_COLORS: Record<ClientOrder['status'], string> = {
  draft:'bg-slate-50 text-slate-900-3', confirmed:'bg-blue-50 text-blue-700',
  in_production:'bg-amber-500/15 text-amber-400', done:'bg-green-500/15 text-green-400', cancelled:'bg-red-500/15 text-red-400',
}

function OrderForm({ onSave, onClose }: { onSave: (dto: CreateClientOrderDto) => Promise<void>; onClose: () => void }) {
  const { data: clientList } = useApi(() => clientsApi.list())
  const { data: pkgList }    = useApi(() => packagingApi.list())
  const { productTypes }     = useProductTypes()
  const { recipes }          = useRecipes()

  const [clientId,    setClientId]    = useState('')
  const [orderDate,   setOrderDate]   = useState(todayIso())
  const [deliveryDate,setDeliveryDate]= useState('')
  const [notes,       setNotes]       = useState('')
  const [lines,       setLines]       = useState<LineForm[]>([emptyLine()])
  const [saving,      setSaving]      = useState(false)
  const [error,       setError]       = useState('')

  const clients    = clientList ?? []
  const packaging  = pkgList   ?? []

  function setLine(i: number, k: keyof LineForm, v: string) {
    setLines(p => p.map((l,j) => j===i ? { ...l, [k]: v } : l))
  }

  function addLine() { setLines(p => [...p, emptyLine()]) }
  function removeLine(i: number) { setLines(p => p.filter((_,j) => j!==i)) }

  // Sumy
  const totals = useMemo(() => {
    const totalUnits = lines.reduce((s,l) => s+(parseFloat(l.qty)||0), 0)
    const totalKg    = lines.reduce((s,l) => s+(parseFloat(l.qty)||0)*(parseFloat(l.kgPerUnit)||0), 0)
    return { totalUnits, totalKg }
  }, [lines])

  async function handleSave() {
    if (!clientId) { setError('Wybierz klienta'); return }
    const missing = lines.map((l, i) => {
      const errs: string[] = []
      if (!l.productTypeId)             errs.push('rodzaj produktu')
      if (!l.recipeId)                  errs.push('receptura')
      if (!(parseFloat(l.qty) > 0))     errs.push('ilość')
      if (!(parseFloat(l.kgPerUnit) > 0)) errs.push('kg/szt')
      return errs.length ? `Pozycja ${i+1}: uzupełnij ${errs.join(', ')}` : null
    }).filter(Boolean)
    if (missing.length > 0) { setError(missing.join(' · ')); return }
    const validLines = lines.filter(l => l.productTypeId && l.recipeId && parseFloat(l.qty)>0 && parseFloat(l.kgPerUnit)>0)
    setSaving(true)
    try {
      await onSave({
        clientId, orderDate, deliveryDate: deliveryDate || undefined, notes: notes || undefined,
        lines: validLines.map(l => ({
          qty: parseFloat(l.qty), kgPerUnit: parseFloat(l.kgPerUnit),
          productTypeId: l.productTypeId, recipeId: l.recipeId,
          packagingId: l.packagingId || undefined,
        })),
      })
      onClose()
    } catch(e) { setError(e instanceof Error ? e.message : 'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
      {/* Nagłówek zamówienia */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Klient *</label>
          <select value={clientId} onChange={e => setClientId(e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
            <option value="">Wybierz klienta...</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Data zamówienia</label>
          <input type="date" value={orderDate} onChange={e => setOrderDate(e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Termin dostawy</label>
          <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
            className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
      </div>

      {/* Pozycje */}
      <div>
        <div className="text-[11px] font-bold text-slate-900-3 uppercase tracking-wide mb-2">Pozycje zamówienia</div>
        <div className="space-y-3">
          {lines.map((line, i) => {
            const totalKg = (parseFloat(line.qty)||0) * (parseFloat(line.kgPerUnit)||0)
            // Pokazuj receptury: pasujące do wybranego rodzaju LUB bez przypisanego rodzaju
            const filteredRecipes = recipes.filter(r =>
              !line.productTypeId || !r.productTypeId || r.productTypeId === line.productTypeId
            )
            return (
              <div key={i} className="border border-slate-200 rounded-xl p-3 bg-slate-50/30">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold text-slate-900-3">Pozycja {i+1}</span>
                  {lines.length > 1 && (
                    <button onClick={() => removeLine(i)} className="text-slate-900-4 hover:text-danger">
                      <X size={14} />
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-6 gap-2">
                  <div>
                    <label className="block text-[9px] font-bold text-slate-900-4 uppercase mb-1">Ilość (szt)</label>
                    <input type="number" min="1" step="1" value={line.qty} onChange={e => setLine(i,'qty',e.target.value)}
                      placeholder="20" className="w-full h-8 px-2 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-900-4 uppercase mb-1">kg/szt</label>
                    <input type="number" min="0.1" step="0.1" value={line.kgPerUnit} onChange={e => setLine(i,'kgPerUnit',e.target.value)}
                      placeholder="40" className="w-full h-8 px-2 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50" />
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-900-4 uppercase mb-1">Rodzaj produktu</label>
                    <select value={line.productTypeId} onChange={e => { setLine(i,'productTypeId',e.target.value); setLine(i,'recipeId','') }}
                      className="w-full h-8 px-2 text-[11px] border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
                      <option value="">Wybierz...</option>
                      {(productTypes??[]).map(pt => <option key={pt.id} value={pt.id}>{pt.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-900-4 uppercase mb-1">Receptura</label>
                    <select value={line.recipeId} onChange={e => setLine(i,'recipeId',e.target.value)}
                      className="w-full h-8 px-2 text-[11px] border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
                      <option value="">Wybierz...</option>
                      {filteredRecipes.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[9px] font-bold text-slate-900-4 uppercase mb-1">Tuleja / opak.</label>
                    <select value={line.packagingId} onChange={e => setLine(i,'packagingId',e.target.value)}
                      className="w-full h-8 px-2 text-[11px] border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
                      <option value="">— brak —</option>
                      {packaging.map(p => <option key={p.id} value={p.id}>{p.name} ({p.kgAvailable} {p.unit})</option>)}
                    </select>
                  </div>
                  <div className="flex flex-col justify-end">
                    <div className="h-8 flex items-center px-2 bg-blue-50 border border-blue-200 rounded text-[12px] font-bold text-blue-700">
                      = {fmtKg(totalKg, 0)} kg
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
        <button onClick={addLine} className="mt-2 flex items-center gap-1.5 text-[12px] font-semibold text-blue-600 hover:text-blue-600/80">
          <Plus size={14} /> Dodaj pozycję
        </button>
      </div>

      {/* Suma */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 flex items-center justify-between">
        <span className="text-[12px] font-bold text-slate-900-3">SUMA ZAMÓWIENIA:</span>
        <div className="text-right">
          <div className="text-xl font-black text-blue-600">{fmtKg(totals.totalKg, 0)} kg</div>
          <div className="text-[11px] text-slate-900-3">{totals.totalUnits} szt</div>
        </div>
      </div>

      <div>
        <label className="block text-[10px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Uwagi</label>
        <textarea rows={2} value={notes} onChange={e => setNotes(e.target.value)}
          className="w-full px-3 py-2 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50 resize-none" />
      </div>

      {error && <div className="text-[12px] text-danger bg-danger-light border border-danger-border px-3 py-2">{error}</div>}

      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Zapisz zamówienie</Button>
      </div>
    </div>
  )
}

export function ClientOrdersPage() {
  const { data: orders, loading, refetch } = useApi(() => clientOrdersApi.list())
  const [modal,    setModal]    = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')

  const filtered = (orders ?? []).filter(o => !filterStatus || o.status === filterStatus)

  async function handleCreate(dto: CreateClientOrderDto) {
    await clientOrdersApi.create(dto)
    refetch()
  }

  async function handleStatus(id: string, status: ClientOrder['status']) {
    await clientOrdersApi.updateStatus(id, status)
    refetch()
  }

  async function handleDelete(id: string) {
    await clientOrdersApi.delete(id)
    refetch()
  }

  return (
    <div className="space-y-5 animate-fade-in">

      <PageHeader title="Zamówienia" subtitle="Zamówienia klientów" />
      <div className="flex gap-3">
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          className="h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand bg-slate-50">
          <option value="">Wszystkie statusy</option>
          {(['draft','confirmed','in_production','done','cancelled'] as ClientOrder['status'][]).map(s => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <div className="ml-auto">
          <Button icon={<Plus size={14} />} onClick={() => setModal(true)}>Nowe zamówienie</Button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl">
        <div className="px-4 py-2.5 border-b border-slate-200">
          <span className="text-[13px] font-semibold text-slate-900">{filtered.length} zamówień</span>
          <span className="text-[12px] text-slate-900-3 ml-2">
            · łącznie {fmtKg(filtered.reduce((s,o)=>s+o.totalKg,0),0)} kg
          </span>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={20} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<ShoppingCart size={32} />} title="Brak zamówień" message="Dodaj zamówienie od klienta" />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map(o => {
              const isExp = expanded === o.id
              return (
                <div key={o.id}>
                  <div className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50/60 cursor-pointer"
                    onClick={() => setExpanded(isExp ? null : o.id)}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-blue-600">{o.orderNo}</span>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${STATUS_COLORS[o.status]}`}>
                          {STATUS_LABELS[o.status]}
                        </span>
                      </div>
                      <div className="text-[12px] text-slate-900 font-semibold mt-0.5">{o.clientName}</div>
                      <div className="text-[11px] text-slate-900-3">
                        {fmtDatePl(o.orderDate)} · {o.lines.length} poz. · {fmtKg(o.totalKg,0)} kg · {o.totalUnits} szt
                        {o.deliveryDate && ` · dostawa: ${fmtDatePl(o.deliveryDate)}`}
                      </div>
                    </div>
                    <div className="flex gap-1">
                      {o.status === 'draft' && (
                        <button onClick={e => { e.stopPropagation(); handleStatus(o.id,'confirmed') }}
                          className="text-[11px] font-semibold text-green-700 border border-green-200 px-2 py-1 rounded hover:bg-green-50">
                          <Check size={12} className="inline mr-1" />Potwierdź
                        </button>
                      )}
                      {o.status === 'draft' && (
                        <button onClick={e => { e.stopPropagation(); handleDelete(o.id) }}
                          className="p-1.5 rounded border border-slate-200 text-slate-900-4 hover:border-danger hover:text-danger">
                          <Trash2 size={13} />
                        </button>
                      )}
                      {isExp ? <ChevronUp size={16} className="text-slate-900-4" /> : <ChevronDown size={16} className="text-slate-900-4" />}
                    </div>
                  </div>
                  {isExp && (
                    <div className="px-4 pb-3 bg-slate-50/50 border-t border-slate-200">
                      <table className="w-full text-[11px] mt-2">
                        <thead>
                          <tr className="text-slate-900-4 uppercase text-[9px] font-semibold tracking-wider">
                            <th className="text-left pb-1">Szt</th>
                            <th className="text-left pb-1">kg/szt</th>
                            <th className="text-left pb-1">Razem kg</th>
                            <th className="text-left pb-1">Rodzaj</th>
                            <th className="text-left pb-1">Receptura</th>
                            <th className="text-left pb-1">Tuleja</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {o.lines.map(l => (
                            <tr key={l.id}>
                              <td className="py-1.5 font-bold">{l.qty}</td>
                              <td className="py-1.5">{l.kgPerUnit} kg</td>
                              <td className="py-1.5 font-bold text-blue-600">{fmtKg(l.totalKg,0)} kg</td>
                              <td className="py-1.5">{l.productTypeName}</td>
                              <td className="py-1.5">{l.recipeName}</td>
                              <td className="py-1.5 text-slate-900-3">{l.packagingName || '—'}</td>
                            </tr>
                          ))}
                          <tr className="font-bold border-t border-slate-200">
                            <td className="py-1.5">{o.totalUnits} szt</td>
                            <td></td>
                            <td className="text-blue-600">{fmtKg(o.totalKg,0)} kg</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {modal && (
        <Modal open title="Nowe zamówienie od klienta" onClose={() => setModal(false)} size="xl">
          <OrderForm onSave={handleCreate} onClose={() => setModal(false)} />
        </Modal>
      )}
    </div>
  )
}
