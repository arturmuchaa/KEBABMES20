import React from 'react'
import { PackageCheck } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { FAZA_ZAPISU } from '../../../proba'
import { computeMetrics, kg, num, pct, lineMissing, type Order } from '../../../data/model'
import { posKg } from '../../../data/stock'
import { MeasureLegend, poziomPokrycia } from '../../../ui/Meters'
import { FlagIcon } from '../../../ui/Glyphs'

/**
 * Pokrycie: co leży na magazynie (przydzielone), co wydano, czego brakuje.
 * Jeden pasek na pozycję rozkłada ZAMÓWIONĄ ilość na trzy części —
 * każda podpisana liczbą, żadna nie jest sumą innych miar.
 */
export function CoverageTab({ order }: { order: Order }) {
  const app = useApp()
  const { stock } = useOrders()
  const m = computeMetrics(order)
  const closed = order.status === 'done' || order.status === 'cancelled'

  // Wolny wyrób z magazynu (ten sam stan co moduł Wyrób gotowy), od najkrótszej daty — FEFO
  const suggestions = closed || order.status === 'draft' ? [] : order.lines.flatMap(l => {
    const miss = lineMissing(l)
    if (!miss) return []
    return stock.filter(p => !p.orderNo && p.status !== 'blocked' && p.recipeId === l.recipeId && p.kgPerUnit === l.kgPerUnit)
      .sort((a, b) => (a.prodDate?.getTime() ?? 0) - (b.prodDate?.getTime() ?? 0))
      .slice(0, 1).map(fs => ({ l, fs, take: Math.min(miss, fs.qty) }))
  })

  return (
    <div className="dock-pad">
      <div className="sect-h">
        <h3>Pokrycie pozycji</h3>
        <span className="sub">{pct(m.coverPct)} · w magazynie {kg(m.stockKg)} · wydano {kg(m.deliveredKg)}</span>
        <div className="tools"><MeasureLegend withProd={false} /></div>
      </div>
      <div className="box">
        <table className="tbl">
          <thead><tr>
            <th className="num" style={{ width: 44 }}>Lp.</th><th>Pozycja</th><th className="num">Zamówiono</th><th className="num">Wydano</th>
            <th className="num">W magazynie</th><th className="num">Brak</th><th className="num">Brak kg</th><th style={{ width: '24%' }}>Rozkład ilości</th><th className="num">Pokrycie</th>
          </tr></thead>
          <tbody>
            {order.lines.map((l, i) => {
              const miss = lineMissing(l)
              const w = (n: number) => `${(n / l.qty) * 100}%`
              return (
                <tr key={l.id} className={`row${i % 2 ? ' zebra' : ''}`}>
                  <td className="num muted">{l.lp}</td>
                  <td><b>{l.recipe}</b> {l.kgPerUnit} kg<span className="sub hide-m">{l.packaging}</span></td>
                  <td className="num">{num(l.qty)}</td>
                  <td className="num">{l.delivered ? num(l.delivered) : <span className="faint">0</span>}</td>
                  <td className="num">{l.stock ? num(l.stock) : <span className="faint">0</span>}</td>
                  <td className="num">{miss ? <b className="crit-ink">{num(miss)}</b> : <span className="ok-ink">0</span>}</td>
                  <td className="num">{miss ? <span className="crit-ink">{kg(miss * l.kgPerUnit)}</span> : <span className="faint">—</span>}</td>
                  <td>
                    <span className={`cov-bar cov-${poziomPokrycia(((l.qty - miss) / l.qty) * 100)}`} data-tip={`Wydano ${l.delivered} · w magazynie ${l.stock} · brak ${miss} szt.`}>
                      {l.delivered > 0 && <i className="f-ship" style={{ width: w(l.delivered) }} />}
                      {l.stock > 0 && <i className="f-stock" style={{ width: w(Math.min(l.stock, l.qty - l.delivered)) }} />}
                      {miss > 0 && <i className="f-short" style={{ flex: 1 }} />}
                    </span>
                  </td>
                  <td className={`num strong cov-txt-${poziomPokrycia(((l.qty - miss) / l.qty) * 100)}`}>{pct(((l.qty - miss) / l.qty) * 100)}</td>
                </tr>
              )
            })}
          </tbody>
          <tfoot><tr>
            <td /><td>Razem</td><td className="num">{num(m.orderedQty)}</td>
            <td className="num">{num(order.lines.reduce((a, l) => a + l.delivered, 0))}</td>
            <td className="num">{num(order.lines.reduce((a, l) => a + l.stock, 0))}</td>
            <td className="num crit-ink">{m.missingQty ? num(m.missingQty) : '0'}</td>
            <td className="num crit-ink">{m.missingKg ? kg(m.missingKg) : '—'}</td><td /><td className="num">{pct(m.coverPct)}</td>
          </tr></tfoot>
        </table>
      </div>

      {suggestions.length > 0 && <>
        <div className="sect-h"><h3>Wolny wyrób pasujący do braków</h3><span className="sub">bez zamówienia na wierszu magazynu · najstarsza produkcja pierwsza</span></div>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Wyrób w magazynie</th><th>Partia</th><th>Produkcja</th><th className="num">Wolne</th><th className="num">Brakuje w poz.</th><th /></tr></thead>
            <tbody>
              {suggestions.map(({ l, fs, take }) => (
                <tr key={l.id} className="row">
                  <td><b>{fs.recipe}</b> {fs.kgPerUnit} kg <span className="sub">→ poz. {l.lp}</span></td>
                  <td className="code">{fs.batch}</td>
                  <td className="num">{fs.prodDate ? fs.prodDate.toLocaleDateString('pl-PL') : '—'}</td>
                  <td className="num">{fs.qty} szt. <span className="sub">{kg(posKg(fs))}</span></td>
                  <td className="num">{lineMissing(l)} szt.</td>
                  <td className="r"><button className="btn sm" onClick={() => app.toast({ kind: 'info', title: `Przydział ${take} szt. do poz. ${l.lp}`, detail: FAZA_ZAPISU })}
                    data-tip="Przydział — faza 3"><PackageCheck size={15} />Przydziel {take} szt.</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}
      <div className="note"><FlagIcon level="info" size={15} /><div>Do wysłania = zamówiono − wydano ({kg(m.orderedKg - m.deliveredKg)}). Brak wyrobu = zamówiono − wydano − magazyn ({kg(m.missingKg)}). Wyrób sprzedany innemu klientowi nie pokrywa tego zamówienia.</div></div>
    </div>
  )
}
