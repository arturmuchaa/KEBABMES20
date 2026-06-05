import { useEffect, useState } from 'react'
import { carriersApi, cmrApi, type Carrier, type CmrGoodsLine } from '@/lib/api'

export function CmrFormModal({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const [carriers, setCarriers] = useState<Carrier[]>([])
  const [carrierId, setCarrierId] = useState('')
  const [plate, setPlate] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [instructions, setInstructions] = useState('TRANSPORT MROŻNICZY -22')
  const [franco, setFranco] = useState('')
  const [goods, setGoods] = useState<CmrGoodsLine[]>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => { carriersApi.list().then(setCarriers).catch(() => {}) }, [])
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
    setBusy(true)
    try {
      const r = await cmrApi.generate(orderId, {
        carrier_id: carrierId, plate, invoice_no: invoiceNo, instructions, franco,
        goods_manual: goods.filter(g => g.name.trim()),
      })
      const url = `/office/cmr/${r.id}/druk`
      const win = window.open(url, '_blank')
      if (!win) window.location.href = url
      onClose()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Błąd generowania CMR')
    } finally { setBusy(false) }
  }

  return (
    <div role="dialog" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.4)', zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: 8, padding: 18, width: 560, maxHeight: '90vh', overflow: 'auto' }}>
        <h2 style={{ fontWeight: 700, marginBottom: 10 }}>Wystaw CMR</h2>
        <label>Przewoźnik
          <select value={carrierId} onChange={e => setCarrierId(e.target.value)} style={{ width: '100%' }}>
            <option value="">— wybierz —</option>
            {carriers.map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>)}
          </select>
        </label>
        <label>Nr rejestracyjny <input value={plate} onChange={e => setPlate(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Nr faktury (pole 5) <input value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="FV 11/06/2026" style={{ width: '100%' }} /></label>
        <label>Instrukcje (pole 13) <input value={instructions} onChange={e => setInstructions(e.target.value)} style={{ width: '100%' }} /></label>
        <label>Franco (pole 14) <input value={franco} onChange={e => setFranco(e.target.value)} placeholder="Franco Rudawa" style={{ width: '100%' }} /></label>
        <div style={{ marginTop: 8 }}>
          <b>Dodatkowy towar (poza kebabem)</b>
          {goods.map((g, i) => (
            <div key={i} style={{ display: 'flex', gap: 4, marginTop: 4 }}>
              <input placeholder="nazwa" value={g.name} onChange={e => setGoodsAt(i, { name: e.target.value })} style={{ flex: 2 }} />
              <input placeholder="szt" type="number" value={g.qty || ''} onChange={e => setGoodsAt(i, { qty: parseInt(e.target.value) || 0 })} style={{ width: 70 }} />
              <input placeholder="kg" type="number" value={g.kg || ''} onChange={e => setGoodsAt(i, { kg: parseFloat(e.target.value) || 0 })} style={{ width: 80 }} />
              <button onClick={() => removeGoods(i)}>✕</button>
            </div>
          ))}
          <button onClick={addGoods} style={{ marginTop: 4 }}>+ dodaj pozycję</button>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 14 }}>
          <button onClick={onClose}>Anuluj</button>
          <button onClick={generate} disabled={busy} style={{ background: '#2563eb', color: '#fff', padding: '6px 14px', borderRadius: 4 }}>
            {busy ? 'Generuję…' : 'Generuj CMR'}
          </button>
        </div>
      </div>
    </div>
  )
}
