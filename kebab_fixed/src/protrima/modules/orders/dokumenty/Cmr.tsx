import React, { useEffect, useState } from 'react'
import { FileText, Plus, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { FlagIcon } from '../../../ui/Glyphs'
import { carriersApi, cmrApi, downloadDocPdf, hdiApi, type Carrier, type CmrGoodsLine } from '@/lib/api'

/** Domyślne pole 13 — jak w starym oknie CMR. */
export const INSTRUKCJE_DOMYSLNE = 'TRANSPORT MROŻNICZY -22'

/** Ciało cmrApi.generate. Bez przewoźnika nie ma numeru rejestracyjnego (poprawka 30.10.2026, „CMR bez przewoźnika bez nr rej.”). */
export function formularzCmr(f: { carrierId: string; plate: string; invoiceNo: string; instructions: string; goods: CmrGoodsLine[] }) {
  return {
    carrier_id: f.carrierId,
    plate: f.carrierId ? f.plate.trim() : '',
    invoice_no: f.invoiceNo.trim(),
    instructions: f.instructions.trim(),
    goods_manual: f.goods.filter(g => g.name.trim()).map(g => ({ name: g.name.trim(), qty: g.qty, kg: g.kg })),
  }
}

/** Okno CMR z zamówienia: te same pola co stary CmrFormModal, po wystawieniu PDF. */
export function CmrDialog({ orderId, orderNo, onClose }: { orderId: string; orderNo: string; onClose: () => void }) {
  const app = useApp()
  const { refresh } = useOrders()
  const [carriers, setCarriers] = useState<Carrier[] | null>(null)
  const [carrierErr, setCarrierErr] = useState(false)
  const [carrierId, setCarrierId] = useState('')
  const [plate, setPlate] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [instructions, setInstructions] = useState(INSTRUKCJE_DOMYSLNE)
  const [goods, setGoods] = useState<CmrGoodsLine[]>([])
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const wczytaj = () => { setCarrierErr(false); carriersApi.list().then(setCarriers).catch(() => setCarrierErr(true)) }
  useEffect(wczytaj, [])
  const wybierz = (id: string) => {
    setCarrierId(id)
    // Numer rej. tylko z przewoźnikiem: zmiana przewoźnika podpowiada jego domyślny, brak przewoźnika czyści pole.
    setPlate(id ? (carriers?.find(c => c.id === id)?.defaultPlate ?? '') : '')
  }
  const wystaw = async () => {
    if (busy) return
    setBusy(true); setBlad(null)
    try {
      const r = await cmrApi.generate(orderId, formularzCmr({ carrierId, plate, invoiceNo, instructions, goods }))
      app.toast({ kind: 'ok', title: `Wystawiono CMR ${r.number}`, detail: 'Otwieram PDF.' })
      await refresh().catch(() => undefined)
      onClose()
      await downloadDocPdf(cmrApi.pdfUrl(r.id), `CMR-${r.number.replace(/\//g, '-')}.pdf`).catch(e => app.toast({ kind: 'warn', title: 'Nie udało się pobrać PDF', detail: e instanceof Error ? e.message : '' }))
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Błąd generowania CMR')
    } finally { setBusy(false) }
  }
  const setG = (i: number, p: Partial<CmrGoodsLine>) => setGoods(g => g.map((x, j) => j === i ? { ...x, ...p } : x))
  return (
    <Dialog title={`CMR — ${orderNo}`} icon={<FileText size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={<><button className="btn" onClick={onClose} disabled={busy}>Anuluj</button><button className="btn primary" onClick={() => void wystaw()} disabled={busy}>{busy ? 'Wystawianie…' : 'Wystaw CMR'}</button></>}>
      {carrierErr && <div className="note warn">Nie udało się pobrać przewoźników. <button className="btn sm" onClick={wczytaj}>Ponów</button></div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 160px', gap: '10px 12px' }}>
        <label className="fld" style={{ gridColumn: '1 / -1' }}><span className="label">Przewoźnik (pole 16)</span>
          <select className="field" value={carrierId} onChange={e => wybierz(e.target.value)} aria-label="Przewoźnik">
            <option value="">— bez przewoźnika —</option>
            {(carriers ?? []).map(c => <option key={c.id} value={c.id}>{c.name}{c.city ? `, ${c.city}` : ''}</option>)}
          </select></label>
        <label className="fld"><span className="label">Nr faktury (pole 5)</span><input className="field" value={invoiceNo} onChange={e => setInvoiceNo(e.target.value)} placeholder="FV 11/10/2026" /></label>
        <label className="fld"><span className="label">Nr rejestracyjny</span><input className="field" value={plate} disabled={!carrierId} onChange={e => setPlate(e.target.value)} aria-label="Numer rejestracyjny" data-tip={carrierId ? undefined : 'Bez przewoźnika CMR nie ma numeru rejestracyjnego'} /></label>
        <label className="fld" style={{ gridColumn: '1 / -1' }}><span className="label">Instrukcje (pole 13)</span><input className="field" value={instructions} onChange={e => setInstructions(e.target.value)} /></label>
      </div>
      <div className="sect-h"><h3 style={{ fontSize: 'var(--fs-md)' }}>Dodatkowy towar (poza kebabem)</h3><div className="tools"><button className="btn sm" onClick={() => setGoods(g => [...g, { name: '', qty: 0, kg: 0 }])}><Plus size={14} />Dodaj</button></div></div>
      {goods.map((g, i) => (
        <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 90px 110px 32px', gap: 8, alignItems: 'end' }}>
          <label className="fld"><span className="label">Nazwa</span><input className="field" value={g.name} onChange={e => setG(i, { name: e.target.value })} aria-label={`Nazwa towaru ${i + 1}`} /></label>
          <label className="fld"><span className="label">Sztuki</span><input className="field num" inputMode="numeric" value={g.qty || ''} onChange={e => setG(i, { qty: parseInt(e.target.value) || 0 })} /></label>
          <label className="fld"><span className="label">Masa kg</span><input className="field num" inputMode="decimal" value={g.kg || ''} onChange={e => setG(i, { kg: parseFloat(e.target.value.replace(',', '.')) || 0 })} /></label>
          <button className="btn ghost icon sm" onClick={() => setGoods(x => x.filter((_, j) => j !== i))} aria-label={`Usuń towar ${i + 1}`}><Trash2 size={15} /></button>
        </div>
      ))}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie wystawiono:</b> {blad}</div></div>}
    </Dialog>
  )
}

/** HDI z zamówienia: serwer generuje (albo pokazuje zamrożone dla zamkniętego), potem PDF. */
export async function generujHdi(orderId: string, toast: (t: { kind?: 'ok' | 'info' | 'warn'; title: string; detail?: string }) => void): Promise<void> {
  try {
    const r = await hdiApi.generate(orderId)
    toast(r.incomplete
      ? { kind: 'warn', title: `HDI ${r.number} — na stan faktyczny`, detail: `Nie wszystko wyprodukowano: ${r.totals?.qty ?? 0} szt. / ${Math.round(r.totals?.kg ?? 0)} kg.` }
      : { kind: 'ok', title: `HDI ${r.number}`, detail: 'Otwieram PDF.' })
    await downloadDocPdf(hdiApi.pdfUrl(r.id), `HDI-${r.number.replace(/\//g, '-')}.pdf`)
  } catch (e) {
    toast({ kind: 'warn', title: 'Nie udało się wygenerować HDI', detail: e instanceof Error ? e.message : '' })
  }
}
