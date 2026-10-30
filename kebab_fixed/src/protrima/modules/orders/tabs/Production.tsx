import React from 'react'
import { useApp } from '../../../shell/context'
import { computeMetrics, kg, num, lineUnposted, mixingByRecipe, type Order } from '../../../data/model'
import { ProdMeter } from '../../../ui/Meters'
import { FlagIcon } from '../../../ui/Glyphs'

export function ProductionTab({ order }: { order: Order }) {
  const app = useApp()
  const m = computeMetrics(order)
  // Masowanie liczy backend z POKRYCIA (magazyn + wydano), nie ze zgłoszeń produkcji.
  const meat = order.status === 'done' || order.status === 'cancelled' ? [] : mixingByRecipe(order.lines.map(line => ({ line, orderNo: order.no })))
  const unposted = order.lines.reduce((a, l) => a + lineUnposted(l), 0)

  return (
    <div className="dock-pad">
      <div className="note info"><FlagIcon level="info" size={15} /><div>
        <b>Produkcja to zgłoszenia z tabletów</b> — pokazują, ile wyprodukowano, ale nie zwiększają pokrycia zamówienia. Pokrycie liczy się z magazynu wyrobu gotowego (zakładka Pokrycie).
      </div></div>
      {order.materialIssue && <div className="note warn"><FlagIcon level="warn" size={15} /><div><b>Brak surowca.</b> {order.materialIssue}</div></div>}

      <div className="sect-h"><h3>Realizacja pozycji</h3><span className="sub">zgłoszono {kg(m.producedKg)} z {kg(m.orderedKg)}</span>
        <div className="tools"><button className="btn sm" onClick={() => app.openModule('plan-produkcji')}>Otwórz plan produkcji</button></div>
      </div>
      <div className="box">
        <table className="tbl">
          <thead><tr>
            <th className="num" style={{ width: 44 }}>Lp.</th><th>Pozycja</th><th className="num">Zamówiono</th><th>Plan</th>
            <th className="num">Zgłoszono</th><th className="num">Pozostało</th><th className="num hide-s" data-tip="Zgłoszone z produkcji, jeszcze nieprzyjęte na magazyn">Nieprzyjęte</th><th>Postęp</th>
          </tr></thead>
          <tbody>
            {order.lines.map((l, i) => {
              const left = Math.max(0, l.qty - l.produced)
              const up = lineUnposted(l)
              return (
                <tr key={l.id} className={`row${i % 2 ? ' zebra' : ''}`}>
                  <td className="num muted">{l.lp}</td>
                  <td><b>{l.recipe}</b> {l.kgPerUnit} kg<span className="sub hide-m">{l.product}</span></td>
                  <td className="num">{num(l.qty)} <span className="sub">szt.</span></td>
                  <td>{l.planNo ? l.planNo : <span className="warn-ink">poza planem</span>}</td>
                  <td className="num strong">{num(Math.min(l.produced, l.qty))}</td>
                  <td className="num">{left > 0 ? <>{num(left)} <span className="sub">{kg(left * l.kgPerUnit)}</span></> : <span className="ok-ink">0</span>}</td>
                  <td className="num hide-s">{up > 0 ? <span className="accent-ink strong" data-tip="Czeka na przyjęcie na magazyn — nie liczy się do pokrycia">{up} szt.</span> : <span className="faint">—</span>}</td>
                  <td><ProdMeter value={l.qty ? Math.min(100, l.produced / l.qty * 100) : 0} w={110} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {unposted > 0 && <div className="note"><FlagIcon level="info" size={15} /><div>{unposted} szt. zgłoszono z produkcji, ale nie trafiły jeszcze na magazyn. Pokrycie wzrośnie po przyjęciu.</div></div>}

      {meat.length > 0 && <>
        <div className="sect-h"><h3>Do zmasowania na pozostałą ilość</h3><span className="sub">z pokrycia, zaokrąglone w górę po recepturze</span></div>
        <div className="box">
          <table className="tbl">
            <thead><tr><th>Receptura</th><th className="num">Wyrób do zmasowania</th><th className="num">Mięso do masowania</th></tr></thead>
            <tbody>{meat.map((x, i) => <tr key={x.recipe} className={`row${i % 2 ? ' zebra' : ''}`}><td className="strong">{x.recipe}</td><td className="num">{x.known ? kg(x.remainingKg) : '—'}</td><td className="num strong">{x.meatKg === null ? <span className="warn-ink">nieznane</span> : kg(x.meatKg)}</td></tr>)}</tbody>
          </table>
        </div>
      </>}
    </div>
  )
}
