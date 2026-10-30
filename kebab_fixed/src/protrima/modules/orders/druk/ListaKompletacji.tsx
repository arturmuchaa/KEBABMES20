import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { ClipboardList, Printer } from 'lucide-react'
import { Dialog } from '../../../shell/context'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, orderPalletsApi, settingsApi, type OrderPallet } from '@/lib/api'
import type { ClientOrder } from '@/lib/mockApi'
import { naMagazynie, wydaneWCalosci, zostaloDoZrobienia } from '@/features/orders/lineShipping'

const nf = (n: number, d = 0) => new Intl.NumberFormat('pl-PL', { minimumFractionDigits: d, maximumFractionDigits: d === 0 ? 3 : d }).format(n).replace(/^(-?\d)(\d{3})(?=,|$)/, '$1 $2')
const dataPl = (iso?: string) => { if (!iso) return '—'; const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}.${m}.${y}` : iso }

/** Wiersze listy — reguły jak stara kartka (OrderPickingPrintPage): zrobione = leży, zostało = do zrobienia, wydane w całości bez kratki. */
export function wierszeKompletacji(o: ClientOrder, pallets: OrderPallet[]) {
  const naPaletach: Record<string, Array<{ no: number; qty: number }>> = {}
  pallets.forEach(p => p.items.forEach(it => { (naPaletach[it.orderLineId] ??= []).push({ no: p.palletNo, qty: it.qty }) }))
  const rows = o.lines.map((l, i) => ({
    lp: i + 1, id: l.id, product: l.productTypeName || '—', recipe: l.recipeName || '', packaging: l.packagingName || '',
    qty: l.qty, kgPerUnit: l.kgPerUnit, kg: Number(l.totalKg) || l.qty * l.kgPerUnit,
    leży: naMagazynie(l), zostalo: zostaloDoZrobienia(l), wydane: wydaneWCalosci(l),
    palety: (naPaletach[l.id] ?? []).map(p => `P${p.no}${p.qty < l.qty ? `(${p.qty})` : ''}`),
  }))
  return { rows, szt: rows.reduce((a, r) => a + r.qty, 0), kg: rows.reduce((a, r) => a + r.kg, 0) }
}

/** Lista kompletacji — kartka wewnętrzna dla magazyniera (A4, kratki do odhaczenia). */
export function ListaKompletacjiDialog({ orderIds, onClose }: { orderIds: string[]; onClose: () => void }) {
  const klucz = orderIds.join(',')
  // Kilka zamówień naraz (zaznaczone na liście) — każde na osobnej stronie.
  const dane = useApi(() => Promise.all(orderIds.map(id => Promise.all([clientOrdersApi.byId(id), orderPalletsApi.list(id)]))), [klucz])
  const firmaRes = useApi(() => settingsApi.getCompany() as Promise<{ name?: string }>)
  const [druk, setDruk] = useState(false)
  const lista = (dane.data ?? []) as Array<[ClientOrder, OrderPallet[]]>
  const o = lista[0]?.[0] ?? null
  const gotowe = lista.length === orderIds.length && lista.length > 0 && !!firmaRes.data
  useEffect(() => {
    if (!druk || !o) return
    const prev = document.title
    document.title = lista.length > 1 ? `Kompletacja ${lista.length} zamówień` : `Kompletacja ${o.orderNo.replace(/\//g, '-')}`
    const done = () => { setDruk(false); document.title = prev }
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 60)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done); document.title = prev }
  }, [druk, o, lista.length])
  const doc = gotowe ? <>{lista.map(([zam, pal], i) => <div key={zam.id} className={i > 0 ? 'dk-page' : ''}><KartkaKompletacji o={zam} pallets={pal} firma={firmaRes.data!.name} /></div>)}</> : null
  const err = dane.error || firmaRes.error
  return (
    <>
      <Dialog wide title={lista.length > 1 ? `Lista kompletacji — ${lista.length} zamówień` : o ? `Lista kompletacji — ${o.orderNo}` : 'Lista kompletacji'} icon={<ClipboardList size={20} color="var(--accent)" />} onClose={onClose}
        footer={<><span className="left">Dokument wewnętrzny — nie dla klienta</span><button className="btn" onClick={onClose}>Zamknij</button>
          <button className="btn primary" disabled={!gotowe} onClick={() => setDruk(true)} data-autofocus><Printer size={15} />Drukuj</button></>}>
        {err && <div className="note crit">Nie udało się pobrać danych: {err}</div>}
        {!gotowe && !err && <div className="note">Przygotowywanie listy…</div>}
        {doc && <div className="doc-preview"><div className="doc-paper">{doc}</div></div>}
      </Dialog>
      {druk && doc && createPortal(<div className="print-sheet doc-print">{doc}</div>, document.body)}
    </>
  )
}

export function KartkaKompletacji({ o, pallets, firma }: { o: ClientOrder; pallets: OrderPallet[]; firma?: string }) {
  const k = useMemo(() => wierszeKompletacji(o, pallets), [o, pallets])
  const kgOf = (lineId: string) => o.lines.find(l => l.id === lineId)?.kgPerUnit ?? 0
  return (
    <article className="doc-zam doc-komp" aria-label="Lista kompletacji">
      <header className="dz-head">
        <div className="dz-firm"><div><strong>{o.clientName}</strong><span>{firma}</span></div></div>
        <div className="dz-title">
          <span className="dz-kind" style={{ fontSize: '15pt' }}>Lista kompletacji</span>
          <span className="dz-no">{o.orderNo}</span>
          <dl><dt>Data zamówienia</dt><dd>{dataPl(o.orderDate)}</dd><dt>Wyjazd</dt><dd>{o.deliveryDate ? dataPl(o.deliveryDate) : '—'}</dd></dl>
        </div>
      </header>
      <table className="dz-tbl" style={{ marginTop: 12 }}>
        <thead><tr><th className="c-lp">Lp.</th><th>Wyrób · receptura · tuleja [palety]</th><th className="r">Szt.</th><th className="r">kg/szt</th><th className="r">kg</th><th className="r">Na mag.</th><th className="r">Zostało</th><th style={{ width: 52, textAlign: 'center' }}>✓</th></tr></thead>
        <tbody>{k.rows.map(r => (
          <tr key={r.id} className={r.wydane ? 'dk-wydane' : ''}>
            <td className="c-lp">{r.lp}</td>
            <td><b>{r.product}</b>{r.recipe && <> · {r.recipe}</>}{r.packaging && <span className="dk-mut"> · {r.packaging}</span>}{r.palety.length > 0 && <span className="dk-pal"> [{r.palety.join(', ')}]</span>}</td>
            <td className="r"><b>{nf(r.qty)}</b></td>
            <td className="r">{nf(r.kgPerUnit)}</td>
            <td className="r"><b>{nf(r.kg)}</b></td>
            <td className="r">{r.leży > 0 ? nf(r.leży) : '—'}</td>
            <td className="r"><b>{r.zostalo > 0 ? nf(r.zostalo) : '—'}</b></td>
            <td style={{ textAlign: 'center' }}>{r.wydane ? <span className="dk-wyd">WYDANE</span> : <span className="dk-box" aria-label="kratka" />}</td>
          </tr>
        ))}</tbody>
        <tfoot><tr><td /><td style={{ textAlign: 'right' }}>RAZEM</td><td className="r">{nf(k.szt)}</td><td /><td className="r">{nf(k.kg)}</td><td colSpan={3} /></tr></tfoot>
      </table>
      {pallets.length > 0 && <>
        <h3 style={{ marginTop: 14 }}>Szczegół palet</h3>
        <div className="dk-pals">{[...pallets].sort((a, b) => a.palletNo - b.palletNo).map(p => {
          const kgP = p.items.reduce((s, it) => s + it.qty * kgOf(it.orderLineId), 0)
          return (
            <div key={p.id ?? p.palletNo} className="dk-pal-card">
              <div className="dk-pal-h"><b>PALETA P{p.palletNo}</b><span>{nf(kgP, 1)} kg · {nf(p.items.reduce((s, it) => s + it.qty, 0))} szt.</span></div>
              {p.items.map((it, i) => { const l = o.lines.find(x => x.id === it.orderLineId); return (
                <div key={i} className="dk-pal-l"><span><b>{it.qty}×</b> {l ? `${l.kgPerUnit} kg — ${l.recipeName || l.productTypeName}` : '—'}</span><span>{nf(it.qty * (l?.kgPerUnit ?? 0), 1)} kg</span></div>) })}
              {p.notes && <div className="dk-mut" style={{ fontStyle: 'italic' }}>{p.notes}</div>}
            </div>
          )
        })}</div>
      </>}
      <section className="dz-sum">
        <div className="dz-notes">{o.notes ? <><h3>Uwagi</h3><p>{o.notes}</p></> : null}</div>
        <dl className="dz-totals"><dt>Pozycji</dt><dd>{o.lines.length}</dd><dt>Sztuk</dt><dd>{nf(k.szt)}</dd><dt>Palet</dt><dd>{pallets.length}</dd><dt className="big">Masa</dt><dd className="big">{nf(k.kg, 1)} kg</dd></dl>
      </section>
      <footer className="dz-foot"><div className="dz-sign"><span> </span><small>skompletował(a)</small></div><div className="dz-sign"><span> </span><small>sprawdził(a)</small></div>
        <p>Lista kompletacji — dokument wewnętrzny · {o.orderNo} · wydruk {new Date().toLocaleString('pl-PL')}</p></footer>
    </article>
  )
}
