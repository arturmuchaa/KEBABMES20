import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import { wzApi } from '@/lib/api'
import { STAWKI_VAT } from '@/features/wz/wzVat'
import { FlagIcon } from '../../../ui/Glyphs'
import { bladDodatkowej, wartoscDodatkowej, type WierszDodatkowy } from './model'

/** Wiersz `/wz/stock/raw` — partia na magazynie surowca. */
export interface PartiaSurowca {
  id: string; stock_type: 'raw' | 'meat' | 'byproduct'; internal_batch_no?: string | null; name: string
  supplier_name?: string | null; kg_available: number; kg_reserved?: number; expiry_date?: string | null
}

export const nowyLineId = () => (globalThis.crypto?.randomUUID?.() ?? `l-${Date.now()}-${Math.random().toString(36).slice(2)}`)
const dataPl = (iso?: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('.') : '—')
const kgPl = (n: number) => `${new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)} kg`
const zl = (n: number, cur: string) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${cur === 'EUR' ? '€' : 'zł'}`
/** Wolne kg partii: mięso z rezerwacją masowni pokazujemy bez niej (serwer i tak pilnuje). */
export const wolneKg = (p: PartiaSurowca) => Math.max(0, Number(p.kg_available) - Number(p.kg_reserved ?? 0))

/**
 * Formularz jednej pozycji dodatkowej — w edytorze WZ i w oknie „Dopisz pozycję”.
 * „Z ręki”: towar spoza stanów (jogurt) — nazwa, ilość, j.m., cena, VAT; nie rusza magazynu.
 * „Z magazynu surowca”: partia (najkrótszy termin na górze), kg, cena za kg, VAT; zdejmie stan.
 * Cena w walucie dokumentu — PLN albo EUR (kurs NBP z dokumentu, tu tylko pokazany).
 */
export function PozycjaDodatkowaForm({ start = 'reczna', waluta, kurs, vatDomyslny, wartosciowy, bezRecznej, zajeteKg = {}, podpowiedzi = [], zapisuje, odswiez = 0, className, onDodaj }: {
  start?: 'reczna' | 'surowiec'
  waluta: 'PLN' | 'EUR'
  kurs?: number | null
  vatDomyslny: number
  wartosciowy: boolean
  /** Powód, dla którego pozycji z ręki nie można dodać (np. kurs w całości na fakturę). */
  bezRecznej?: string
  /** Kg partii już wpisane w tym formularzu (edytor przed wystawieniem). */
  zajeteKg?: Record<string, number>
  podpowiedzi?: string[]
  zapisuje?: boolean
  /** Zmiana wartości = stan magazynu surowca wczytuje się od nowa (po dopisaniu do wystawionego dokumentu). */
  odswiez?: number
  className?: string
  onDodaj: (w: WierszDodatkowy) => void
}) {
  const [rodzaj, setRodzaj] = useState<'reczna' | 'surowiec'>(bezRecznej ? 'surowiec' : start)
  const [w, setW] = useState<WierszDodatkowy>(() => ({ lineId: nowyLineId(), rodzaj, name: '', qtyStr: '', unit: rodzaj === 'surowiec' ? 'kg' : 'szt', priceStr: '', vatRate: vatDomyslny }))
  const [partie, setPartie] = useState<PartiaSurowca[] | null>(null)
  const [bladPartii, setBladPartii] = useState<string | null>(null)
  const [szukaj, setSzukaj] = useState('')
  const [pokazBlad, setPokazBlad] = useState(false)
  const pierwsze = useRef<HTMLInputElement>(null)
  const sym = waluta === 'EUR' ? '€' : 'zł'

  useEffect(() => {
    if (rodzaj !== 'surowiec' || partie) return
    wzApi.stockRaw().then(r => setPartie(r as PartiaSurowca[])).catch(e => setBladPartii(e instanceof Error ? e.message : 'Nie udało się wczytać magazynu surowca'))
  }, [rodzaj, partie])
  useEffect(() => { if (odswiez) setPartie(null) }, [odswiez])
  useEffect(() => { pierwsze.current?.focus() }, [rodzaj])

  const zmienRodzaj = (r: 'reczna' | 'surowiec') => {
    setRodzaj(r); setPokazBlad(false)
    setW(x => ({ ...x, rodzaj: r, unit: r === 'surowiec' ? 'kg' : x.unit === 'kg' ? 'kg' : 'szt', stockId: undefined, stockType: undefined, batchNo: undefined, wolneKg: undefined, name: r === 'surowiec' ? '' : x.name }))
  }
  const lista = useMemo(() => {
    const q = szukaj.trim().toLowerCase()
    return (partie ?? [])
      .map(p => ({ p, wolne: Math.max(0, wolneKg(p) - (zajeteKg[p.id] ?? 0)) }))
      .filter(({ p, wolne }) => wolne > 0.0005 && (!q || `${p.name} ${p.internal_batch_no ?? ''} ${p.supplier_name ?? ''}`.toLowerCase().includes(q)))
      .sort((a, b) => String(a.p.expiry_date ?? '9999').localeCompare(String(b.p.expiry_date ?? '9999')) || a.p.name.localeCompare(b.p.name, 'pl'))
  }, [partie, szukaj, zajeteKg])
  const wybierz = (p: PartiaSurowca, wolne: number) => setW(x => ({ ...x, stockId: p.id, stockType: p.stock_type, batchNo: p.internal_batch_no ?? undefined, wolneKg: wolne, name: p.name }))

  const blad = bladDodatkowej(w, wartosciowy) || (rodzaj === 'surowiec' && !w.stockId ? 'Wybierz partię z listy.' : '')
  const dodaj = () => {
    if (blad) { setPokazBlad(true); return }
    onDodaj({ ...w, name: w.name.trim() })
    setW({ lineId: nowyLineId(), rodzaj, name: '', qtyStr: '', unit: rodzaj === 'surowiec' ? 'kg' : w.unit, priceStr: '', vatRate: w.vatRate })
    setPokazBlad(false)
  }
  const naEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); dodaj() } }

  return (
    <div className={`pd-form${className ? ` ${className}` : ''}`}>
      <div className="seg" role="tablist" aria-label="Rodzaj pozycji">
        <button type="button" role="tab" aria-selected={rodzaj === 'reczna'} aria-pressed={rodzaj === 'reczna'} disabled={!!bezRecznej} data-tip={bezRecznej} onClick={() => zmienRodzaj('reczna')}>Z ręki</button>
        <button type="button" role="tab" aria-selected={rodzaj === 'surowiec'} aria-pressed={rodzaj === 'surowiec'} onClick={() => zmienRodzaj('surowiec')}>Z magazynu surowca</button>
      </div>
      {bezRecznej && <div className="note info"><FlagIcon level="info" size={15} /><div><b>Pozycji z ręki tu nie dopiszesz.</b> {bezRecznej}</div></div>}

      {rodzaj === 'reczna' ? <>
        <p className="sub" style={{ margin: 0 }}>Towar spoza naszej produkcji i magazynu — np. jogurt. Nie zmienia stanów, tylko wartość dokumentu.</p>
        <div className="pd-grid">
          <label className="fld pd-nazwa"><span className="label">Nazwa</span>
            <input ref={pierwsze} className={`field${pokazBlad && !w.name.trim() ? ' invalid' : ''}`} list="pd-podpowiedzi" value={w.name} onChange={e => setW({ ...w, name: e.target.value })} onKeyDown={naEnter} placeholder="np. Jogurt naturalny 1 kg" aria-label="Nazwa pozycji" />
            <datalist id="pd-podpowiedzi">{podpowiedzi.map(n => <option key={n} value={n} />)}</datalist></label>
          <label className="fld"><span className="label">Ilość</span>
            <input className={`field num${pokazBlad && bladDodatkowej(w, false) && w.name.trim() ? ' invalid' : ''}`} inputMode="decimal" value={w.qtyStr} onChange={e => setW({ ...w, qtyStr: e.target.value })} onKeyDown={naEnter} aria-label="Ilość" /></label>
          <div className="fld"><span className="label">Jednostka</span>
            <div className="seg" role="group" aria-label="Jednostka">
              {(['szt', 'kg', 'opak.'] as const).map(u => <button key={u} type="button" aria-pressed={w.unit === u} onClick={() => setW({ ...w, unit: u })}>{u}</button>)}
            </div></div>
          {wartosciowy && <PoleCeny w={w} setW={setW} sym={sym} jedn={w.unit} naEnter={naEnter} bladny={pokazBlad} />}
        </div>
      </> : <>
        <div className="pd-szukaj"><Search size={15} /><input ref={pierwsze} className="field" value={szukaj} onChange={e => setSzukaj(e.target.value)} placeholder="Szukaj: łój, numer partii, dostawca…" aria-label="Szukaj partii surowca" /></div>
        {bladPartii && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{bladPartii}</div></div>}
        <div className="box pd-partie">
          <table className="tbl" aria-label="Partie na magazynie surowca">
            <thead><tr><th>Surowiec</th><th>Partia</th><th>Ważne do</th><th className="num">Wolne</th></tr></thead>
            <tbody>
              {!partie && !bladPartii && <tr><td colSpan={4}><div className="empty">Wczytywanie magazynu surowca…</div></td></tr>}
              {partie && lista.length === 0 && <tr><td colSpan={4}><div className="empty">{szukaj ? 'Nic nie pasuje do wyszukiwania.' : 'Magazyn surowca jest pusty.'}</div></td></tr>}
              {lista.map(({ p, wolne }) => (
                <tr key={p.id} className={`row${w.stockId === p.id ? ' sel' : ''}`} aria-selected={w.stockId === p.id} tabIndex={0}
                  onClick={() => wybierz(p, wolne)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); wybierz(p, wolne) } }}>
                  <td className="strong">{p.name}{p.supplier_name ? <span className="sub"> · {p.supplier_name}</span> : null}</td>
                  <td className="code">{p.internal_batch_no ?? '—'}</td>
                  <td>{dataPl(p.expiry_date)}</td>
                  <td className="num">{kgPl(wolne)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pd-grid s">
          <label className="fld pd-nazwa"><span className="label">Nazwa na dokumencie</span>
            <input className="field" value={w.name} onChange={e => setW({ ...w, name: e.target.value })} disabled={!w.stockId} placeholder="wybierz partię" aria-label="Nazwa na dokumencie" /></label>
          <label className="fld"><span className="label">Ilość{w.wolneKg != null ? <span className="sub"> · wolne {kgPl(w.wolneKg)}</span> : null}</span>
            <span className="pd-in"><input className={`field num${pokazBlad && w.stockId && bladDodatkowej(w, false) ? ' invalid' : ''}`} inputMode="decimal" value={w.qtyStr} onChange={e => setW({ ...w, qtyStr: e.target.value })} onKeyDown={naEnter} disabled={!w.stockId} aria-label="Ilość w kg" /><span>kg</span></span></label>
          {wartosciowy && <PoleCeny w={w} setW={setW} sym={sym} jedn="kg" naEnter={naEnter} bladny={pokazBlad} disabled={!w.stockId} />}
        </div>
      </>}

      <div className="pd-stopka">
        {waluta === 'EUR' && <span className="sub">Ceny w euro{kurs ? ` · kurs NBP ${String(kurs).replace('.', ',')}` : ''}</span>}
        {wartosciowy && w.qtyStr && w.priceStr && !bladDodatkowej(w, true) && <span className="sub">Wartość netto: <b>{zl(wartoscDodatkowej(w), waluta)}</b></span>}
        <span className="grow" />
        {pokazBlad && blad && <span className="crit-ink" role="alert">{blad}</span>}
        <button type="button" className="btn primary" disabled={zapisuje} onClick={dodaj}>Dodaj pozycję</button>
      </div>
    </div>
  )
}

function PoleCeny({ w, setW, sym, jedn, naEnter, bladny, disabled }: {
  w: WierszDodatkowy; setW: (w: WierszDodatkowy) => void; sym: string; jedn: string; naEnter: (e: React.KeyboardEvent) => void; bladny: boolean; disabled?: boolean
}) {
  return <>
    <label className="fld"><span className="label">Cena za {jedn}</span>
      <span className="pd-in"><input className={`field num${bladny && !w.priceStr.trim() ? ' invalid' : ''}`} inputMode="decimal" value={w.priceStr} onChange={e => setW({ ...w, priceStr: e.target.value })} onKeyDown={naEnter} disabled={disabled} placeholder="0,00" aria-label={`Cena za ${jedn}`} /><span>{sym}</span></span></label>
    <label className="fld"><span className="label">VAT</span>
      <select className="field" value={w.vatRate} onChange={e => setW({ ...w, vatRate: Number(e.target.value) })} disabled={disabled} aria-label="Stawka VAT">{STAWKI_VAT.map(v => <option key={v} value={v}>{v}%</option>)}</select></label>
  </>
}
