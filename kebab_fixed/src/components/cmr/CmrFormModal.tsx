import { useEffect, useState } from 'react'
import { carriersApi, cmrApi, type Carrier, type CmrGoodsLine } from '@/lib/api'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2 } from 'lucide-react'
import '@/features/orders/order-planning.css'

export function CmrFormModal({ orderId, dispatchId, onClose }: {
  orderId?: string
  /** Wydanie pojedynczych sztuk z kiosku — CMR z jego sztuk zamiast z zamówienia. */
  dispatchId?: string
  onClose: () => void
}) {
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [carrierId, setCarrierId] = useState('')
  const [plate, setPlate] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [instructions, setInstructions] = useState('TRANSPORT MROŻNICZY -22')
  const [goods, setGoods] = useState<CmrGoodsLine[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [carrierError, setCarrierError] = useState(false)

  const loadCarriers = () => {
    setCarrierError(false)
    void carriersApi.list().then(setCarriers).catch(() => setCarrierError(true))
  }
  useEffect(loadCarriers, [])
  // Po wyborze przewoźnika podpowiedz domyślny nr rej.
  useEffect(() => {
    const c = carriers.find(c => c.id === carrierId)
    if (c && !plate) setPlate(c.defaultPlate)
  }, [carrierId, carriers]) // eslint-disable-line

  const addGoods = () => setGoods(g => [...g, { name: '', qty: 0, kg: 0 }])
  const setGoodsAt = (i: number, patch: Partial<CmrGoodsLine>) =>
    setGoods(g => g.map((x, j) => j === i ? { ...x, ...patch } : x))
  const removeGoods = (i: number) => setGoods(g => g.filter((_, j) => j !== i))

  async function generate() {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const form = {
        carrier_id: carrierId, plate, invoice_no: invoiceNo, instructions,
        goods_manual: goods.filter(g => g.name.trim()),
      }
      const r = dispatchId ? await cmrApi.generateDispatch(dispatchId, form) : await cmrApi.generate(orderId ?? '', form)
      const url = `/office/cmr/${r.id}/druk`
      const win = window.open(url, '_blank')
      if (!win) window.location.href = url
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Błąd generowania CMR')
    } finally { setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="orders-dialog w-[calc(100%-2rem)] max-w-2xl max-h-[90vh] overflow-y-auto p-0 gap-0" onInteractOutside={e => { if (busy) e.preventDefault() }}>
        <header className="order-section-head bg-slate-50 pr-12"><div>
          <DialogTitle>Wystaw CMR</DialogTitle>
          <DialogDescription className="mt-1">Dane przewoźnika i transportu do listu przewozowego.</DialogDescription>
        </div></header>
        <fieldset disabled={busy} className="grid min-w-0 gap-4 p-5 text-sm">
        {carrierError && <p role="alert" className="text-amber-800">Nie udało się pobrać przewoźników. <button className="underline" onClick={loadCarriers}>Ponów pobieranie</button></p>}
        <label className="grid gap-1.5 font-medium">Przewoźnik
          <select value={carrierId} onChange={e => setCarrierId(e.target.value)} className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm font-normal">
            <option value="">— wybierz —</option>
            {carriers.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>)}
          </select>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1.5 font-medium">Nr rejestracyjny <Input value={plate} onChange={e => setPlate(e.target.value)} /></label>
          <label className="grid gap-1.5 font-medium">Nr faktury (pole 5) <Input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="FV 11/06/2026" /></label>
        </div>
        <label className="grid gap-1.5 font-medium">Instrukcje (pole 13) <Input value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
        <div className="space-y-3 border-t border-slate-200 pt-4">
          <h3 className="font-semibold">Dodatkowy towar (poza kebabem)</h3>
          {goods.map((g, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[2fr_1fr_1fr_auto]">
              <label className="col-span-3 grid gap-1 text-xs sm:col-span-1">Nazwa towaru {i + 1}<Input value={g.name} onChange={e => setGoodsAt(i, { name: e.target.value })} /></label>
              <label className="grid gap-1 text-xs">Sztuki {i + 1}<Input type="number" min={0} value={g.qty || ''} onChange={e => setGoodsAt(i, { qty: parseInt(e.target.value) || 0 })} /></label>
              <label className="grid gap-1 text-xs">Masa kg {i + 1}<Input type="number" min={0} step="0.001" value={g.kg || ''} onChange={e => setGoodsAt(i, { kg: parseFloat(e.target.value) || 0 })} /></label>
              <Button variant="ghost" size="icon" aria-label={`Usuń dodatkowy towar ${i + 1}`} onClick={() => removeGoods(i)}><Trash2 size={16} aria-hidden="true" /></Button>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={addGoods}><Plus size={14} aria-hidden="true" className="mr-1" />Dodaj pozycję</Button>
        </div>
        </fieldset>
        {error && <p role="alert" className="mx-5 mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <footer className="flex flex-wrap justify-end gap-3 border-t border-slate-200 px-5 py-4">
          <Button variant="outline" disabled={busy} onClick={onClose}>Anuluj</Button>
          <Button onClick={generate} disabled={busy} className="bg-blue-700 hover:bg-blue-800">
            {busy ? 'Generuję…' : 'Generuj CMR'}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  )
}
