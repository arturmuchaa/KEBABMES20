import React, { useEffect, useRef, useState } from 'react'
import { Ban, Coins, Pencil, AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { SzkieletBloku } from '../../ui/Szkielet'
import { carriersApi, cmrApi, fxApi, hdiApi, wzApi, type QuantityChain } from '@/lib/api'
import type { Dok, Dzialanie } from './model'

export type Okno = { co: Exclude<Dzialanie, 'dopisz'>; dok: Dok }
type Props = { okno: Okno; onClose: () => void; onZmiana: () => void }

const liczba = (s: string) => { const v = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) ? v : NaN }
const cena2 = (n: unknown) => (n == null || n === '' ? '' : Number(n).toFixed(2).replace('.', ','))
const zl = (n: number, cur: string) => `${new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} ${cur === 'EUR' ? '€' : 'zł'}`
const blad = (e: unknown, d: string) => (e instanceof Error ? e.message : d)

/** Jedno wejście: moduł mówi „co” i „z którym dokumentem”, tu wybieramy okno. */
export function OknoDzialania({ okno, onClose, onZmiana }: Props) {
  if (okno.co === 'ceny') return <CenyWzDialog d={okno.dok} onClose={onClose} onZmiana={onZmiana} />
  if (okno.co === 'anuluj' || okno.co === 'anulujHdi') return <AnulujDialog d={okno.dok} onClose={onClose} onZmiana={onZmiana} />
  if (okno.co === 'edytujCmr') return <EdycjaCmrDialog d={okno.dok} onClose={onClose} onZmiana={onZmiana} />
  return <RozjazdDialog d={okno.dok} onClose={onClose} />
}

type Linia = { name: string; qty: number; unit: string; total_kg?: number; price?: number | null; value?: number | null }

/** Ceny pozycji i waluta (PLN / EUR z kursem NBP) — zapis `wzApi.updatePrices`. */
function CenyWzDialog({ d, onClose, onZmiana }: { d: Dok; onClose: () => void; onZmiana: () => void }) {
  const app = useApp()
  const [linie, setLinie] = useState<Linia[] | null>(null)
  const [ceny, setCeny] = useState<string[]>([])
  const [waluta, setWaluta] = useState<'PLN' | 'EUR'>('PLN')
  const [kurs, setKurs] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [zapis, setZapis] = useState(false)
  useEffect(() => {
    wzApi.byId(d.id).then(doc => {
      const l = (doc.lines ?? []) as unknown as Linia[]
      setLinie(l); setCeny(l.map(x => cena2(x.price)))
      setWaluta(doc.currency === 'EUR' ? 'EUR' : 'PLN'); setKurs(doc.eur_rate ? String(doc.eur_rate).replace('.', ',') : '')
    }).catch(e => setErr(blad(e, 'Nie udało się wczytać dokumentu')))
  }, [d.id])
  const baza = (l: Linia) => Number(l.total_kg) > 0 ? Number(l.total_kg) : Number(l.qty)
  const suma = (linie ?? []).reduce((a, l, i) => a + (Number.isFinite(liczba(ceny[i])) ? baza(l) * liczba(ceny[i]) : 0), 0)
  const pobierzKurs = async () => {
    try { const r = await fxApi.eurRate(d.data || undefined); if (r.rate) setKurs(String(r.rate).replace('.', ',')) }
    catch (e) { app.toast({ kind: 'warn', title: 'Nie udało się pobrać kursu NBP', detail: blad(e, '') }) }
  }
  const zapisz = async () => {
    if (!linie) return
    const zle = ceny.findIndex(c => c.trim() !== '' && !(liczba(c) >= 0))
    if (zle >= 0) { setErr(`Popraw cenę: ${linie[zle].name}`); return }
    if (waluta === 'EUR' && !(liczba(kurs) > 0)) { setErr('Dokument w EUR potrzebuje kursu — pobierz z NBP albo wpisz.'); return }
    setZapis(true); setErr(null)
    try {
      await wzApi.updatePrices(d.id, linie.map((_, i) => ({ index: i, price: ceny[i].trim() === '' ? 0 : liczba(ceny[i]) })), waluta, waluta === 'EUR' ? liczba(kurs) : null)
      app.toast({ kind: 'ok', title: `Zapisano ceny ${d.numer}`, detail: `wartość ${zl(suma, waluta)}` })
      onZmiana(); onClose()
    } catch (e) { setErr(blad(e, 'Nie udało się zapisać cen')) } finally { setZapis(false) }
  }
  return (
    <Dialog title={`Ceny i waluta — ${d.numer}`} icon={<Coins size={20} />} wide onClose={onClose}
      footer={<><span className="left">Wartość netto: <b>{zl(suma, waluta)}</b></span><button className="btn" onClick={onClose}>Zamknij</button>
        <button className="btn primary" disabled={!linie || zapis} onClick={() => void zapisz()}>Zapisz ceny</button></>}>
      {err && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{err}</div></div>}
      {!linie && !err && <SzkieletBloku linie={4} opis="Wczytywanie pozycji…" />}
      {linie && <>
        <div className="dk-waluta">
          <div className="seg" role="group" aria-label="Waluta">{(['PLN', 'EUR'] as const).map(w => <button key={w} type="button" aria-pressed={waluta === w} onClick={() => setWaluta(w)}>{w}</button>)}</div>
          {waluta === 'EUR' && <span className="dk-kurs"><input className="field num w-num" value={kurs} onChange={e => setKurs(e.target.value)} placeholder="4,25" aria-label="Kurs EUR" />
            <button className="btn sm" type="button" onClick={() => void pobierzKurs()}>Kurs NBP</button></span>}
          <span className="sub">Cena za kg, gdy pozycja ma wagę; inaczej za jednostkę.</span>
        </div>
        <div className="box"><table className="tbl">
          <thead><tr><th>Pozycja</th><th className="num">Ilość</th><th className="num">Cena</th><th className="num">Wartość</th></tr></thead>
          <tbody>{linie.map((l, i) => (
            <tr key={i} className="row">
              <td className="strong">{l.name}</td>
              <td className="num">{Number(l.total_kg) > 0 ? `${l.total_kg} kg` : `${l.qty} ${l.unit}`}</td>
              <td className="num"><input className={`field num w-num${ceny[i].trim() && !(liczba(ceny[i]) >= 0) ? ' invalid' : ''}`} inputMode="decimal" value={ceny[i]}
                onChange={e => setCeny(c => c.map((x, j) => (j === i ? e.target.value : x)))} aria-label={`Cena, ${l.name}`} /> <span className="sub">{waluta === 'EUR' ? '€' : 'zł'}</span></td>
              <td className="num tnum">{Number.isFinite(liczba(ceny[i])) ? zl(baza(l) * liczba(ceny[i]), waluta) : '—'}</td>
            </tr>))}</tbody>
        </table></div>
      </>}
    </Dialog>
  )
}

function AnulujDialog({ d, onClose, onZmiana }: { d: Dok; onClose: () => void; onZmiana: () => void }) {
  const app = useApp()
  const [err, setErr] = useState<string | null>(null)
  const [zapis, setZapis] = useState(false)
  const lock = useRef(false)
  const potwierdz = async () => {
    if (lock.current) return
    lock.current = true; setZapis(true); setErr(null)
    try {
      const wynik = (d.rodzaj === 'hdi' ? await hdiApi.anuluj(d.id) : await wzApi.cancel(d.id)) as { deductionWarning?: string } | undefined
      app.toast({ kind: 'ok', title: `Anulowano ${d.numer}`, detail: d.rodzaj === 'wz' ? 'towar wrócił na stan, numer wrócił do puli' : undefined })
      // Potrącenie pracownika już rozliczone na pasku — serwer go nie cofnie, biuro musi wiedzieć.
      if (wynik?.deductionWarning) app.toast({ kind: 'warn', title: 'Sprawdź potrącenie pracownika', detail: wynik.deductionWarning })
      onZmiana(); onClose()
    } catch (e) { setErr(blad(e, 'Nie udało się anulować')) } finally { lock.current = false; setZapis(false) }
  }
  return (
    <Dialog title={`Anulować ${d.numer}?`} icon={<Ban size={20} />} onClose={onClose}
      footer={<><button className="btn" onClick={onClose} data-autofocus>Wróć</button><button className="btn danger" disabled={zapis} onClick={() => void potwierdz()}>Anuluj dokument</button></>}>
      <p style={{ margin: 0 }}><b>{d.klient || '—'}</b>{d.orderNo ? <> · zam. <span className="code">{d.orderNo}</span></> : null}</p>
      {d.rodzaj === 'wz'
        ? <div className="note warn"><FlagIcon level="warn" size={15} /><div>Cały towar z dokumentu wróci na stan magazynu, a numer wróci do puli. Dokument zostaje w rejestrze jako anulowany.</div></div>
        : <div className="note warn"><FlagIcon level="warn" size={15} /><div>HDI zostanie oznaczone jako anulowane. Numer nie wraca do puli.</div></div>}
      {err && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{err}</div></div>}
    </Dialog>
  )
}

type Towar = { name: string; qty: number; kg: number }
function EdycjaCmrDialog({ d, onClose, onZmiana }: { d: Dok; onClose: () => void; onZmiana: () => void }) {
  const app = useApp()
  const [ok, setOk] = useState(false)
  const [przewoznicy, setPrzewoznicy] = useState<Array<{ id: string; name: string }>>([])
  const [f, setF] = useState({ carrier_id: '', plate: '', invoice_no: '', instructions: '' })
  const [towary, setTowary] = useState<Towar[]>([])
  // CMR z zamówienia: serwer nie pozwala zmienić dodatkowego towaru (409) — pokazujemy go tylko do odczytu
  // i odsyłamy dokładnie tak, jak był zapisany.
  const [zapisane, setZapisane] = useState<Towar[] | null>(null)
  const zZamowienia = !!d.zrodlo.order_id
  const [err, setErr] = useState<string | null>(null)
  const [zapis, setZapis] = useState(false)
  useEffect(() => {
    Promise.all([carriersApi.list(), cmrApi.get(d.id)]).then(([cs, doc]) => {
      const list = (cs ?? []) as Array<{ id: string; name: string }>
      setPrzewoznicy(list)
      const p = (doc as { payload?: Record<string, any> }).payload ?? {}
      const c = p.carrier ?? {}
      setF({ carrier_id: list.find(x => x.name === c.name)?.id ?? '', plate: c.plate ?? '', invoice_no: p.attachments?.invoice_no ?? '', instructions: p.instructions ?? 'TRANSPORT MROŻNICZY -22' })
      const reczne = ((p.goods ?? []) as Array<Record<string, any>>).filter(g => !g.auto).map(g => ({ name: g.name ?? '', qty: Number(g.qty) || 0, kg: Number(g.kg) || 0 }))
      setTowary(reczne); setZapisane(reczne)
      setOk(true)
    }).catch(e => setErr(blad(e, 'Nie udało się wczytać CMR')))
  }, [d.id])
  const zapisz = async () => {
    setZapis(true); setErr(null)
    try {
      await cmrApi.update(d.id, { ...f, goods_manual: zZamowienia ? (zapisane ?? []) : towary.filter(t => t.name.trim()) })
      app.toast({ kind: 'ok', title: `Zapisano ${d.numer}` }); onZmiana(); onClose()
    } catch (e) { setErr(blad(e, 'Nie udało się zapisać CMR')) } finally { setZapis(false) }
  }
  const pole = (k: keyof typeof f, label: string, ph?: string) => <label className="fld"><span className="label">{label}</span>
    <input className="field" value={f[k]} placeholder={ph} onChange={e => setF({ ...f, [k]: e.target.value })} aria-label={label} /></label>
  return (
    <Dialog title={`Edytuj CMR ${d.numer}`} icon={<Pencil size={20} />} wide onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Zamknij</button><button className="btn primary" disabled={!ok || zapis} onClick={() => void zapisz()}>Zapisz CMR</button></>}>
      {err && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{err}</div></div>}
      {!ok && !err && <SzkieletBloku linie={4} opis="Wczytywanie CMR…" />}
      {ok && <>
        <div className="dk-cmr-grid">
          <label className="fld"><span className="label">Przewoźnik</span>
            <select className="field" value={f.carrier_id} onChange={e => setF({ ...f, carrier_id: e.target.value })} aria-label="Przewoźnik">
              <option value="">— bez przewoźnika —</option>{przewoznicy.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          {pole('plate', 'Nr rejestracyjny')}
          {pole('invoice_no', 'Nr faktury (pole 5)', 'FV 11/06/2026')}
          {pole('instructions', 'Instrukcje (pole 13)')}
        </div>
        {zZamowienia ? <>
          <div className="sect-h"><h3>Dodatkowy towar</h3><span className="sub">CMR z zamówienia — towar wynika z zamówienia i nie zmienia się tutaj</span></div>
          {towary.filter(t => t.name.trim()).length ? <ul className="dk-towary-ro">{towary.filter(t => t.name.trim()).map((t, i) => <li key={i}>{t.name} · {t.qty} szt · {t.kg} kg</li>)}</ul>
            : <p className="muted" style={{ margin: 0 }}>brak dodatkowego towaru</p>}
        </> : <>
        <div className="sect-h"><h3>Dodatkowy towar</h3><span className="sub">poza wyrobem (np. jogurt na tym samym aucie)</span>
          <div className="tools"><button className="btn sm" type="button" onClick={() => setTowary(t => [...t, { name: '', qty: 0, kg: 0 }])}><Plus size={14} />Dodaj</button></div></div>
        {towary.map((t, i) => (
          <div key={i} className="dk-towar">
            <input className="field" value={t.name} placeholder="nazwa" onChange={e => setTowary(x => x.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} aria-label={`Towar ${i + 1}, nazwa`} />
            <input className="field num" value={t.qty || ''} placeholder="szt" inputMode="numeric" onChange={e => setTowary(x => x.map((y, j) => (j === i ? { ...y, qty: parseInt(e.target.value) || 0 } : y)))} aria-label={`Towar ${i + 1}, sztuki`} />
            <input className="field num" value={t.kg || ''} placeholder="kg" inputMode="decimal" onChange={e => setTowary(x => x.map((y, j) => (j === i ? { ...y, kg: liczba(e.target.value) || 0 } : y)))} aria-label={`Towar ${i + 1}, kg`} />
            <button className="btn ghost icon sm" onClick={() => setTowary(x => x.filter((_, j) => j !== i))} aria-label={`Usuń towar ${i + 1}`}><Trash2 size={15} /></button>
          </div>))}
        </>}
      </>}
    </Dialog>
  )
}

const ETAPY: Array<{ k: keyof QuantityChain['lines'][number]; label: string }> = [
  { k: 'ordered', label: 'Zamówiono' }, { k: 'planned', label: 'Plan' }, { k: 'reported', label: 'Produkcja' }, { k: 'scanned', label: 'Skan' },
  { k: 'packed', label: 'Kartony' }, { k: 'shipped', label: 'Wyjechało' }, { k: 'documented', label: 'Na dokumencie' },
]
function RozjazdDialog({ d, onClose }: { d: Dok; onClose: () => void }) {
  const [q, setQ] = useState<QuantityChain | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const orderId = String(d.orderId ?? d.zrodlo.source_id ?? '')
  useEffect(() => { wzApi.quantityChain(orderId).then(setQ).catch(e => setErr(blad(e, 'Nie udało się pobrać raportu'))) }, [orderId])
  return (
    <Dialog title={`Rozjazd załadunku — ${d.numer}`} icon={<AlertTriangle size={20} />} xl onClose={onClose} footer={<button className="btn" onClick={onClose}>Zamknij</button>}>
      {err && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{err}</div></div>}
      {!q && !err && <SzkieletBloku linie={4} opis="Liczenie łańcucha ilości…" />}
      {q && <>
        <p className="muted" style={{ margin: 0 }}>Zamówienie <b className="code">{q.order_no}</b> — sztuki na każdym etapie. Czerwone pole: tu ubyło w stosunku do poprzedniego etapu.</p>
        <div className="box"><table className="tbl">
          <thead><tr><th>Pozycja</th>{ETAPY.map(e => <th key={e.k} className="num">{e.label}</th>)}</tr></thead>
          <tbody>{q.lines.map((l, i) => (
            <tr key={i} className="row"><td className="strong">{l.name}</td>
              {ETAPY.map((e, j) => { const v = Number(l[e.k]) || 0; const prev = j ? Number(l[ETAPY[j - 1].k]) || 0 : v
                return <td key={e.k} className={`num tnum${j && v !== prev ? ' dk-rozjazd' : ''}`}>{v}</td> })}
            </tr>))}</tbody>
        </table></div>
      </>}
    </Dialog>
  )
}
