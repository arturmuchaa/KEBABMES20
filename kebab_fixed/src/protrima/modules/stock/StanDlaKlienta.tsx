import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { fmtDate, kg, num } from '../../data/model'
import { posKg, type StockPos } from '../../data/stock'
import { logoDokumentu } from '../../zaklad/zaklad'
import { useFirma } from '../../zaklad/firma'

/** Klucz klienta na wierszu magazynu; wiersz bez zamówienia = wolny wyrób. */
export const WOLNE = '— wolny wyrób —'
export const klientPozycji = (p: StockPos) => p.orderNo ? (p.clientName || 'Bez nazwy') : WOLNE

interface Wiersz { product: string; recipe: string; kgPerUnit: number; packaging: string; qty: number; kg: number; batches: Array<{ batch: string; date?: Date; qty: number }> }

/** Pozycje klienta zebrane po wyrobie (rodzaj × receptura × gramatura × opakowanie). */
export function zestawienie(stock: StockPos[], klient: string): Wiersz[] {
  const m = new Map<string, Wiersz>()
  for (const p of stock) {
    if (klientPozycji(p) !== klient) continue
    const k = `${p.product}|${p.recipeId}|${p.kgPerUnit}|${p.packaging}`
    const w = m.get(k) ?? { product: p.product, recipe: p.recipe, kgPerUnit: p.kgPerUnit, packaging: p.packaging, qty: 0, kg: 0, batches: [] }
    w.qty += p.qty; w.kg += posKg(p)
    w.batches.push({ batch: p.batch, date: p.prodDate, qty: p.qty })
    m.set(k, w)
  }
  return [...m.values()].sort((a, b) => a.recipe.localeCompare(b.recipe, 'pl') || a.kgPerUnit - b.kgPerUnit || a.product.localeCompare(b.product, 'pl'))
}

/**
 * Okno „Stan magazynowy dla klienta” → wydruk A4 (window.print, jak wydruki starego MES).
 * Liczby to wiersze magazynu wyrobu gotowego z numerem zamówienia tego klienta.
 */
export function StanDlaKlientaDialog({ stock, start, onClose }: { stock: StockPos[]; start?: string; onClose: () => void }) {
  const klienci = useMemo(() => [...new Set(stock.map(klientPozycji))].filter(k => k !== WOLNE).sort((a, b) => a.localeCompare(b, 'pl')), [stock])
  const [klient, setKlient] = useState(start && start !== WOLNE ? start : klienci[0] ?? '')
  const [partie, setPartie] = useState(true)
  const [druk, setDruk] = useState(false)
  const rows = useMemo(() => zestawienie(stock, klient), [stock, klient])
  const tot = rows.reduce((a, r) => ({ qty: a.qty + r.qty, kg: a.kg + r.kg }), { qty: 0, kg: 0 })

  useEffect(() => {
    if (!druk) return
    const done = () => setDruk(false)
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [druk])

  return (
    <>
      <Dialog wide title="Stan magazynowy dla klienta" icon={<Printer size={20} color="var(--accent)" />} onClose={onClose}
        footer={<><span className="left">{rows.length} wyrobów · {num(tot.qty)} szt. · {kg(tot.kg)}</span>
          <button className="btn" onClick={onClose}>Zamknij</button>
          <button className="btn primary" disabled={!rows.length} onClick={() => setDruk(true)} data-autofocus><Printer size={15} />Drukuj</button></>}>
        <div style={{ display: 'flex', gap: 16, alignItems: 'end', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 280 }}>
            <label className="label" htmlFor="sdk-klient">Klient</label>
            <select id="sdk-klient" className="field" value={klient} onChange={e => setKlient(e.target.value)}>
              {klienci.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          </div>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', height: 32 }}>
            <input type="checkbox" className="cbx" checked={partie} onChange={e => setPartie(e.target.checked)} />Pokaż partie i daty produkcji
          </label>
        </div>
        <div className="box" style={{ maxHeight: 360, overflow: 'auto' }}>
          <TabelaStanu rows={rows} partie={partie} />
        </div>
        <div className="note info">Na wydruku: wyrób gotowy leżący na magazynie i przypisany do zamówień tego klienta, stan na chwilę wydruku.</div>
      </Dialog>
      {druk && createPortal(<ArkuszStanu klient={klient} rows={rows} partie={partie} />, document.body)}
    </>
  )
}

function TabelaStanu({ rows, partie }: { rows: Wiersz[]; partie: boolean }) {
  const tot = rows.reduce((a, r) => ({ qty: a.qty + r.qty, kg: a.kg + r.kg }), { qty: 0, kg: 0 })
  return (
    <table className="tbl stan-tbl">
      <thead><tr><th>Wyrób</th><th>Receptura</th><th className="num">Gramatura</th><th>Opakowanie</th><th className="num">Sztuk</th><th className="num">Masa</th>{partie && <th>Partie</th>}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={partie ? 7 : 6}><div className="empty">Brak wyrobu na magazynie dla tego klienta.</div></td></tr>}
        {rows.map((r, i) => (
          <tr key={i} className="row">
            <td>{r.product}</td><td className="strong">{r.recipe}</td><td className="num">{num(r.kgPerUnit)} kg</td><td>{r.packaging || '—'}</td>
            <td className="num strong">{num(r.qty)}</td><td className="num">{kg(r.kg)}</td>
            {partie && <td className="code" style={{ whiteSpace: 'normal' }}>{r.batches.map(b => `${b.batch}${b.date ? ` (${fmtDate(b.date)})` : ''} × ${b.qty}`).join(', ')}</td>}
          </tr>
        ))}
      </tbody>
      {rows.length > 0 && <tfoot><tr><td colSpan={4}>Razem</td><td className="num">{num(tot.qty)}</td><td className="num">{kg(tot.kg)}</td>{partie && <td />}</tr></tfoot>}
    </table>
  )
}

/** Arkusz A4 widoczny tylko przy drukowaniu (style w print.css). */
function ArkuszStanu({ klient, rows, partie }: { klient: string; rows: Wiersz[]; partie: boolean }) {
  const teraz = new Date()
  const firma = useFirma()
  const logo = logoDokumentu(firma)
  return (
    <div className="print-sheet">
      <div className="ps-head">
        {logo && <img src={logo} alt="" />}
        <div>
          <h1>Stan magazynowy wyrobu gotowego</h1>
          {firma?.name && <div className="ps-sub">{firma.name}{firma.city ? `, ${firma.city}` : ''}</div>}
          <div className="ps-sub">Klient: <b>{klient}</b></div>
          <div className="ps-sub">Stan na {teraz.toLocaleDateString('pl-PL')} godz. {teraz.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
      </div>
      <TabelaStanu rows={rows} partie={partie} />
      <p className="ps-foot">Zestawienie informacyjne — nie jest dokumentem wydania.</p>
    </div>
  )
}
