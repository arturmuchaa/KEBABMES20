import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { fmtDate, kg, num } from '../../data/model'
import { posKg, type StockPos } from '../../data/stock'
import { logoDokumentu, type Firma } from '../../zaklad/zaklad'
import { useFirma } from '../../zaklad/firma'
import { useApi } from '@/hooks/useApi'
import { clientsApi } from '@/lib/api'
import { Dw, NAZWA_JEZYKA, jezykKlienta, obcy, pl, type Jezyk } from '@/features/rozliczenia/jezykDruku'

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

/** Dane odbiorcy na dokumencie — z kartoteki klientów (po nazwie z wiersza magazynu). */
export interface OdbiorcaStanu { nazwa: string; adres?: string; miasto?: string; nip?: string; jezyk?: string | null }

const JEZYKI: Jezyk[] = ['pl', 'de', 'en', 'sk', 'cs', 'sl', 'fr']

/**
 * Okno „Stan magazynowy dla klienta” → dokument A4 dla odbiorcy (window.print).
 * Liczby to wiersze magazynu wyrobu gotowego z numerem zamówienia tego klienta.
 * Dokument jest w dwóch językach — polskim i języku klienta (kartoteka, a gdy
 * pusta, prefiks NIP; jak HDI); biuro może drugi język zmienić przed drukiem.
 * W oknie widać kartkę dokładnie taką, jaka wyjdzie z drukarki.
 */
export function StanDlaKlientaDialog({ stock, start, onClose }: { stock: StockPos[]; start?: string; onClose: () => void }) {
  const klienci = useMemo(() => [...new Set(stock.map(klientPozycji))].filter(k => k !== WOLNE).sort((a, b) => a.localeCompare(b, 'pl')), [stock])
  const [klient, setKlient] = useState(start && start !== WOLNE ? start : klienci[0] ?? '')
  const [partie, setPartie] = useState(true)
  const [druk, setDruk] = useState(false)
  const klienciRes = useApi(() => clientsApi.list() as Promise<Array<{ name: string; displayName?: string; nip?: string; address?: string; postalCode?: string; city?: string; language?: string }>>)
  const clients = klienciRes.data
  const firma = useFirma()
  const rows = useMemo(() => zestawienie(stock, klient), [stock, klient])
  const tot = rows.reduce((a, r) => ({ qty: a.qty + r.qty, kg: a.kg + r.kg }), { qty: 0, kg: 0 })
  const odbiorca = useMemo<OdbiorcaStanu>(() => {
    const k = (clients ?? []).find(c => c.name === klient || c.displayName === klient)
    return k ? { nazwa: k.name || klient, adres: k.address, miasto: [k.postalCode, k.city].filter(Boolean).join(' '), nip: k.nip, jezyk: k.language } : { nazwa: klient }
  }, [clients, klient])
  const zKartoteki = jezykKlienta(odbiorca.jezyk, odbiorca.nip)
  // Ręczny wybór trzyma się klienta, dla którego go zrobiono — po zmianie klienta wraca język z kartoteki.
  const [reczny, setReczny] = useState<{ klient: string; j: Jezyk } | null>(null)
  const jezyk = reczny?.klient === klient ? reczny.j : zKartoteki

  useEffect(() => {
    if (!druk) return
    const done = () => setDruk(false)
    window.addEventListener('afterprint', done)
    const t = window.setTimeout(() => window.print(), 50)
    return () => { window.clearTimeout(t); window.removeEventListener('afterprint', done) }
  }, [druk])

  const doc = <ArkuszStanu odbiorca={odbiorca} rows={rows} partie={partie} jezyk={jezyk} firma={firma} />
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 220 }}>
            <label className="label" htmlFor="sdk-jezyk">Drugi język dokumentu</label>
            <select id="sdk-jezyk" className="field" value={jezyk} onChange={e => setReczny({ klient, j: e.target.value as Jezyk })}>
              {JEZYKI.map(j => <option key={j} value={j}>{j === 'pl' ? 'tylko polski' : `polski + ${NAZWA_JEZYKA[j]}`}{j === zKartoteki ? ' (wg klienta)' : ''}</option>)}
            </select>
          </div>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', height: 32 }}>
            <input type="checkbox" className="cbx" checked={partie} onChange={e => setPartie(e.target.checked)} />Pokaż partie i daty produkcji
          </label>
        </div>
        <div className="doc-preview"><div className="doc-paper">{doc}</div></div>
      </Dialog>
      {druk && createPortal(<div className="print-sheet doc-print">{doc}</div>, document.body)}
    </>
  )
}

const nf = (v: number) => num(v)

/** Dokument dla odbiorcy — ten sam krój co „Zamówienie dla klienta” (style `doc-zam` w print.css). */
export function ArkuszStanu({ odbiorca, rows, partie, jezyk, firma, teraz = new Date() }: {
  odbiorca: OdbiorcaStanu; rows: Wiersz[]; partie: boolean; jezyk: Jezyk; firma: Firma | null; teraz?: Date
}) {
  const logo = logoDokumentu(firma)
  const f = firma ?? {}
  const tot = rows.reduce((a, r) => ({ qty: a.qty + r.qty, kg: a.kg + r.kg }), { qty: 0, kg: 0 })
  const dzien = teraz.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const godz = teraz.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
  const j = jezyk
  return (
    <article className="doc-zam doc-stan" aria-label="Stan magazynowy dla klienta">
      <header className="dz-head">
        <div className="dz-firm">
          {logo && <img src={logo} alt="" />}
          <div>
            <strong>{f.name || 'Dane firmy nie zostały skonfigurowane'}</strong>
            {f.address && <span>{f.address}</span>}
            <span>{[f.postalCode, f.city].filter(Boolean).join(' ')}</span>
            <span>{[f.nip && `NIP ${f.nip}`, f.vetNumber && `Wet. ${f.vetNumber}`].filter(Boolean).join(' · ')}</span>
            <span>{[f.phone, f.email].filter(Boolean).join(' · ')}</span>
          </div>
        </div>
        <div className="dz-title">
          <span className="dz-kind">{pl('t_stan')}</span>
          {j !== 'pl' && <span className="ds-kind2" data-drugi-jezyk={j}>{obcy('t_stan', j)}</span>}
          <dl>
            <dt><Dw k="stan_na" j={j} /></dt><dd>{dzien}, {godz}</dd>
          </dl>
        </div>
      </header>

      <section className="dz-parties">
        <div><h3><Dw k="odbiorca" j={j} /></h3>
          <strong>{odbiorca.nazwa}</strong>
          {odbiorca.adres && <span>{odbiorca.adres}</span>}
          {odbiorca.miasto && <span>{odbiorca.miasto}</span>}
          {odbiorca.nip && <span><Dw k="nip" j={j} />: {odbiorca.nip}</span>}
        </div>
        <div className="ds-opis">
          <strong>{pl('stan_podtytul')}</strong>
          {j !== 'pl' && <span data-drugi-jezyk={j}>{obcy('stan_podtytul', j)}</span>}
        </div>
      </section>

      <table className="dz-tbl">
        <thead><tr>
          <th className="c-lp"><Dw k="s_lp" j={j} pod /></th><th><Dw k="s_wyrob" j={j} pod /></th><th><Dw k="s_opakowanie" j={j} pod /></th>
          <th className="r"><Dw k="s_gramatura" j={j} pod /></th><th className="r"><Dw k="s_sztuk" j={j} pod /></th><th className="r"><Dw k="s_masa" j={j} pod /></th>
          {partie && <th><Dw k="s_partie" j={j} pod /></th>}
        </tr></thead>
        <tbody>
          {rows.length === 0 && <tr><td colSpan={partie ? 7 : 6}><Dw k="s_brak" j={j} pod /></td></tr>}
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="c-lp">{i + 1}</td>
              <td><b>{r.recipe}</b>{r.product && <small>{r.product}</small>}</td>
              <td>{r.packaging || '—'}</td>
              <td className="r">{nf(r.kgPerUnit)} kg</td>
              <td className="r"><b>{nf(r.qty)}</b></td>
              <td className="r">{nf(r.kg)} kg</td>
              {partie && <td className="ds-partie">{r.batches.map((b, n) => <span key={n}>{b.batch}{b.date ? ` · ${fmtDate(b.date)}` : ''} · {nf(b.qty)}</span>)}</td>}
            </tr>
          ))}
        </tbody>
      </table>

      {rows.length > 0 && <section className="dz-sum">
        <div className="dz-notes" />
        <dl className="dz-totals">
          <dt><Dw k="s_pozycji" j={j} /></dt><dd>{rows.length}</dd>
          <dt><Dw k="s_razem_szt" j={j} /></dt><dd>{nf(tot.qty)}</dd>
          <dt className="big"><Dw k="s_razem_kg" j={j} /></dt><dd className="big">{nf(tot.kg)} kg</dd>
        </dl>
      </section>}

      <footer className="dz-foot ds-foot">
        <p><Dw k="s_stopka" j={j} pod /></p>
        <p>{[f.name, `${pl('wydrukowano')}${j !== 'pl' ? ` / ${obcy('wydrukowano', j)}` : ''} ${dzien}, ${godz}`].filter(Boolean).join(' · ')}</p>
      </footer>
    </article>
  )
}
