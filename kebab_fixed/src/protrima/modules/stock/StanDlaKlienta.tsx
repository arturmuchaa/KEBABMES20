import React, { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Printer } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { fmtDate, kg, num } from '../../data/model'
import { posKg, type StockPos } from '../../data/stock'
import type { Firma } from '../../zaklad/zaklad'
import { useFirma } from '../../zaklad/firma'
import { useApi } from '@/hooks/useApi'
import { clientsApi, type CompanySettings } from '@/lib/api'
import { DRUK, LICZBOWA, NaglowekDruku, StopkaDruku } from '@/features/rozliczenia/NaglowekDruku'
// Krój dokumentów dla klienta (ten sam co zestawienie należności) — PROTRIMA sama go nie ładuje.
import '@fontsource/fira-sans/400.css'
import '@fontsource/fira-sans/500.css'
import '@fontsource/fira-sans/600.css'
import '@fontsource/fira-sans/700.css'
import { Dw, NAZWA_JEZYKA, jezykKlienta, type Jezyk } from '@/features/rozliczenia/jezykDruku'

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

const T = {
  th: { padding: '.35em .55em .4em', fontWeight: 600, fontSize: '.8em', color: DRUK.szary, textAlign: 'left',
        borderBottom: `0.75pt solid ${DRUK.liniaMocna}`, verticalAlign: 'bottom' } as CSSProperties,
  td: { padding: '.42em .55em', borderBottom: `0.5pt solid ${DRUK.linia}`, verticalAlign: 'baseline' } as CSSProperties,
}
const wierszPanelu: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '1.5em' }

/**
 * Dokument dla odbiorcy — TEN SAM szablon co „Zestawienie należności” i „Historia
 * rozliczeń” (NaglowekDruku: logo zakładu, firma, tytuł, odbiorca w ramce; jasna
 * tabela z cienkimi liniami; panel sumy; stopka). Właściciel 13.11.2026: dokumenty
 * wysyłane klientowi mają być spójne.
 */
export function ArkuszStanu({ odbiorca, rows, partie, jezyk, firma, teraz = new Date() }: {
  odbiorca: OdbiorcaStanu; rows: Wiersz[]; partie: boolean; jezyk: Jezyk; firma: Firma | null; teraz?: Date
}) {
  const f = firma as CompanySettings | null
  const tot = rows.reduce((a, r) => ({ qty: a.qty + r.qty, kg: a.kg + r.kg }), { qty: 0, kg: 0 })
  const dzien = teraz.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const godz = teraz.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
  const j = jezyk
  const adres = [odbiorca.adres, odbiorca.miasto].filter(Boolean).join(', ')
  const r: CSSProperties = { ...LICZBOWA }
  return (
    <article className="doc-stan" aria-label="Stan magazynowy dla klienta">
      <div className="ds-tresc">
        <NaglowekDruku firma={f} klient={{ nazwa: odbiorca.nazwa, adres, nip: odbiorca.nip ?? '' }} tytul="t_stan" jezyk={j} strona="odbiorca"
          dane={[['stan_na', `${dzien}, ${godz}`]]} />
        <h3 style={{ fontSize: '1em', fontWeight: 600, margin: '0 0 .35em' }}><Dw k="stan_podtytul" j={j} /></h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={{ ...T.th, width: '8mm' }}><Dw k="s_lp" j={j} pod /></th><th style={T.th}><Dw k="s_wyrob" j={j} pod /></th><th style={T.th}><Dw k="s_opakowanie" j={j} pod /></th>
            <th style={{ ...T.th, textAlign: 'right' }}><Dw k="s_gramatura" j={j} pod /></th><th style={{ ...T.th, textAlign: 'right' }}><Dw k="s_sztuk" j={j} pod /></th>
            <th style={{ ...T.th, textAlign: 'right' }}><Dw k="s_masa" j={j} pod /></th>
            {partie && <th style={T.th}><Dw k="s_partie" j={j} pod /></th>}
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td style={{ ...T.td, color: DRUK.szary }} colSpan={partie ? 7 : 6}><Dw k="s_brak" j={j} pod /></td></tr>}
            {rows.map((w, i) => (
              <tr key={i}>
                <td style={{ ...T.td, color: DRUK.szary }}>{i + 1}</td>
                <td style={T.td}><span style={{ fontWeight: 600 }}>{w.recipe}</span>{w.product && <span style={{ display: 'block', fontSize: '.86em', color: DRUK.szary }}>{w.product}</span>}</td>
                <td style={T.td}>{w.packaging || '—'}</td>
                <td style={{ ...T.td, ...r }}>{nf(w.kgPerUnit)} kg</td>
                <td style={{ ...T.td, ...r, fontWeight: 600 }}>{nf(w.qty)}</td>
                <td style={{ ...T.td, ...r }}>{nf(w.kg)} kg</td>
                {partie && <td style={{ ...T.td, fontSize: '.86em', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                  {w.batches.map((b, n) => <span key={n} style={{ display: 'block' }}>{b.batch}{b.date ? ` · ${fmtDate(b.date)}` : ''} · {nf(b.qty)}</span>)}</td>}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length > 0 && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.1em' }}>
          <div data-testid="panel-sumy" className="druk-panel" style={{ minWidth: '48%', border: `0.75pt solid ${DRUK.linia}`, borderTop: `1.5pt solid ${DRUK.liniaMocna}`,
            background: DRUK.tlo, padding: '.65em .9em .7em', display: 'grid', rowGap: '.3em' }}>
            <div style={wierszPanelu}><span><Dw k="s_pozycji" j={j} /></span><b style={{ ...LICZBOWA, fontWeight: 600 }}>{rows.length}</b></div>
            <div style={wierszPanelu}><span><Dw k="s_razem_szt" j={j} /></span><b style={{ ...LICZBOWA, fontWeight: 600 }}>{nf(tot.qty)}</b></div>
            <div style={{ ...wierszPanelu, fontSize: '1.22em' }}><span style={{ fontWeight: 600 }}><Dw k="s_razem_kg" j={j} /></span><b style={{ ...LICZBOWA, fontWeight: 700 }}>{nf(tot.kg)} kg</b></div>
          </div>
        </div>}

        <div style={{ marginTop: '.9em', fontSize: '.86em', color: DRUK.szary }}><Dw k="s_stopka" j={j} pod /></div>
      </div>
      <StopkaDruku firma={f} jezyk={j} />
    </article>
  )
}
