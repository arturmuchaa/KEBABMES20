import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Calculator, TrendingDown } from 'lucide-react'
import { Dialog } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { productionPlansApi, type BalanceRange, type BalanceRow } from '@/lib/api'
import { dzisIso, przesunDzien } from '../plan-masowania/model'

/** Liczba po polsku z odstępem tysięcy także dla 4 cyfr („1 198”). */
const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)
  .replace(/ /g, ' ').replace(/^(-?\d)(\d{3})(?=,|$)/, '$1 $2')
const pct = (loss: number, kgIn: number) => (kgIn > 0 ? Math.round((loss / kgIn) * 1000) / 10 : 0)
const dataPl = (iso: string) => { const [y, m, d] = iso.slice(0, 10).split('-'); return d && m && y ? `${d}.${m}.${y}` : iso }

/**
 * Bilans partii zakończonego planu (spec §6.6): teoria z masowania (mięso +
 * woda + przyprawy wsadu) → ważone po masowaniu → na wyroby → końcówka →
 * strata. Gdy bilans przy potwierdzeniu się nie udał (np. inne plany mają
 * rezerwację na partię), biuro liczy go tu ponownie.
 */
export function BilansPlanu({ planId }: { planId: string }) {
  const [wiersze, setWiersze] = useState<BalanceRow[] | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  const [liczy, setLiczy] = useState(false)
  const wczytaj = useCallback(async () => {
    try { setWiersze(await productionPlansApi.balance(planId) as BalanceRow[]) } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) }
  }, [planId])
  useEffect(() => { void wczytaj() }, [wczytaj])
  const policz = async () => {
    setLiczy(true); setBlad(null)
    try { await productionPlansApi.settleBalance(planId); await wczytaj() } catch (e) { setBlad(e instanceof Error ? e.message : String(e)) } finally { setLiczy(false) }
  }
  const suma = useMemo(() => (wiersze ?? []).reduce((a, w) => ({
    teoria: a.teoria + (w.kgTheory ?? 0), kgIn: a.kgIn + w.kgIn, goods: a.goods + w.kgGoods, ret: a.ret + w.kgReturned, loss: a.loss + w.kgLoss,
  }), { teoria: 0, kgIn: 0, goods: 0, ret: 0, loss: 0 }), [wiersze])

  return (
    <div className="pp-panel">
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Bilans nie został policzony:</b> {blad}</div></div>}
      {!wiersze && !blad && <p className="muted pp-pad">Wczytuję bilans…</p>}
      {wiersze && !wiersze.length && <div className="note warn"><FlagIcon level="warn" size={15} /><div>
        Ten plan nie ma jeszcze bilansu palet. <button className="btn sm" disabled={liczy} onClick={() => void policz()}>Policz bilans</button></div></div>}
      {wiersze && wiersze.length > 0 && (
        <table className="tbl pp-bilans" aria-label="Bilans partii planu">
          <thead><tr><th>Partia</th><th className="num" data-tip="Mięso + woda + przyprawy wsadu masownicy">Teoria</th><th className="num">Ważone</th><th className="num">Wyroby</th><th className="num">Końcówka</th><th className="num">Strata</th></tr></thead>
          <tbody>{wiersze.map(w => (
            <tr key={`${w.batchNo}|${w.recipeId}`} className="row">
              <td><b className="code">{w.batchNo}</b><span className="sub">{w.recipeName}</span></td>
              <td className="num">{w.kgTheory != null ? `${fmt(w.kgTheory)} kg` : '—'}</td>
              <td className="num">{fmt(w.kgIn)} kg</td><td className="num">{fmt(w.kgGoods)} kg</td><td className="num">{fmt(w.kgReturned)} kg</td>
              <td className={`num${w.lossPct > 3 ? ' crit-ink' : ''}`}><b>{fmt(w.kgLoss)} kg</b><span className="sub">{fmt(w.lossPct)}%</span></td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td>Razem</td><td className="num">{suma.teoria ? `${fmt(suma.teoria)} kg` : '—'}</td><td className="num">{fmt(suma.kgIn)} kg</td><td className="num">{fmt(suma.goods)} kg</td>
            <td className="num">{fmt(suma.ret)} kg</td><td className="num"><b>{fmt(suma.loss)} kg</b> <span className="sub">{fmt(pct(suma.loss, suma.kgIn))}%</span></td></tr></tfoot>
        </table>
      )}
    </div>
  )
}

/** Straty mięsa za zakres dat — trend dni i receptur (spec §6.6). */
export function StratyOkno({ onClose }: { onClose: () => void }) {
  const dzis = dzisIso()
  const [od, setOd] = useState(przesunDzien(dzis, -13))
  const [doDnia, setDoDnia] = useState(dzis)
  const [dane, setDane] = useState<BalanceRange | null>(null)
  const [blad, setBlad] = useState<string | null>(null)
  useEffect(() => {
    let stop = false
    setBlad(null)
    productionPlansApi.balanceRange(od, doDnia).then(d => { if (!stop) setDane(d) }, e => { if (!stop) setBlad(e instanceof Error ? e.message : String(e)) })
    return () => { stop = true }
  }, [od, doDnia])
  const maxDzien = useMemo(() => (dane?.days ?? []).reduce<string | null>((m, d) => (!m || d.lossPct > (dane!.days.find(x => x.date === m)?.lossPct ?? 0) ? d.date : m), null), [dane])
  return (
    <Dialog wide title="Straty mięsa — zakres dat" icon={<TrendingDown size={20} />} onClose={onClose}
      footer={<><span className="left muted">Ważone po masowaniu − wyroby − końcówki, z bilansu palet potwierdzonych planów</span><button className="btn" onClick={onClose}>Zamknij</button></>}>
      <div className="row-wrap" style={{ gap: 10, marginBottom: 10 }}>
        <label className="label">Od <input type="date" className="field" value={od} onChange={e => e.target.value && setOd(e.target.value)} /></label>
        <label className="label">Do <input type="date" className="field" value={doDnia} onChange={e => e.target.value && setDoDnia(e.target.value)} /></label>
      </div>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{blad}</div></div>}
      {dane && !dane.days.length && <div className="note"><Calculator size={15} /> W tym zakresie nie ma planów z bilansem palet.</div>}
      {dane && dane.days.length > 0 && <div className="pp-straty">
        <table className="tbl" aria-label="Straty wg receptury">
          <thead><tr><th>Receptura</th><th className="num">Ważone</th><th className="num">Strata</th><th className="num">%</th></tr></thead>
          <tbody>{dane.recipes.map(r => <tr key={r.recipeId} className="row"><td><b>{r.recipeName || r.recipeId}</b></td><td className="num">{fmt(r.kgIn)} kg</td><td className="num">{fmt(r.kgLoss)} kg</td><td className="num">{fmt(r.lossPct)}%</td></tr>)}</tbody>
        </table>
        <table className="tbl" aria-label="Straty wg dnia">
          <thead><tr><th>Dzień</th><th className="num">Ważone</th><th className="num">Strata</th><th className="num">%</th></tr></thead>
          <tbody>{dane.days.map(d => <tr key={d.date} className={`row${d.date === maxDzien ? ' pp-max' : ''}`} data-tip={d.date === maxDzien ? 'Największa strata w zakresie' : undefined}>
            <td>{dataPl(d.date)}</td><td className="num">{fmt(d.kgIn)} kg</td><td className="num">{fmt(d.kgLoss)} kg</td><td className="num"><b>{fmt(d.lossPct)}%</b></td></tr>)}</tbody>
        </table>
      </div>}
    </Dialog>
  )
}
