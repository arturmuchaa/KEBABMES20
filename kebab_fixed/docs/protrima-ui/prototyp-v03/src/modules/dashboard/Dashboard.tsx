import React, { useEffect, useMemo } from 'react'
import { ArrowRight, Printer, SlidersHorizontal, Clock3 } from 'lucide-react'
import { useApp, CommandBar, type Cmd, type DetailTab } from '../../shell/context'
import { useOrders } from '../../data/store'
import {
  computeMetrics, isClosed, kg, num, num1, pct, longDate, TODAY, relDay, BUCKET_LABEL, fmtDay, weekday, addDays,
  type Bucket, type Order, type Level,
} from '../../data/model'
import { getStages, PRODUCTION_TODAY, MATERIALS, SHIPMENTS, TASKS } from '../../data/demo'
import { FlagIcon, StageNode, LEVEL_WORD } from '../../ui/Glyphs'

export function Dashboard({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { orders } = useOrders()
  const open = useMemo(() => orders.filter(o => !isClosed(o)).map(o => ({ o, m: computeMetrics(o) })), [orders])

  const cmds = useMemo<Cmd[]>(() => [
    { id: 'print', group: 2, label: 'Raport zmiany', icon: <Printer size={17} />, kbd: 'Ctrl+P', menuOnly: true, run: () => app.toast({ kind: 'info', title: 'Raport zmiany', detail: 'Demo nie drukuje.' }) },
    { id: 'history', group: 2, label: 'Poprzednie zmiany', icon: <Clock3 size={17} />, opt: true, run: () => app.toast({ kind: 'info', title: 'Historia zmian', detail: 'W demo dostępna jest tylko bieżąca zmiana.' }) },
    { id: 'custom', group: 3, label: 'Dostosuj pulpit', icon: <SlidersHorizontal size={17} />, opt: true, run: () => app.toast({ kind: 'info', title: 'Układ pulpitu', detail: 'Każda rola (właściciel, kierownik, biuro) dostanie własny zestaw paneli.' }) },
  ], [app])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])

  useEffect(() => {
    if (!active) return
    const kgSum = open.reduce((a, x) => a + x.m.orderedKg, 0)
    const prob = open.filter(x => x.m.level === 'crit' || x.m.level === 'warn').length
    setCtx(<><span>Otwarte zamówienia: <b>{open.length}</b> · <b>{kg(kgSum)}</b></span><span>Z problemem: <b className="crit-ink">{prob}</b></span><span className="hide-m">Pulpit odświeża się co 30 s — w demo wyłączone</span></>)
  }, [active, open, setCtx])

  return (
    <>
      <CommandBar title="Pulpit zakładu" count={`${longDate(TODAY)} · stan na 10:42`} cmds={cmds} right={
        <div className="seg" role="group" aria-label="Zakres czasu">
          <button aria-pressed="true">Zmiana I</button>
          <button aria-pressed="false" onClick={() => app.toast({ kind: 'info', title: 'Zmiana II zaczyna się o 14:00', detail: 'W demo dostępny jest tylko widok bieżącej zmiany.' })}>Zmiana II</button>
          <button aria-pressed="false" onClick={() => app.toast({ kind: 'info', title: 'Widok doby', detail: 'W demo dostępny jest tylko widok bieżącej zmiany.' })}>Cała doba</button>
        </div>} />
      <div className="dash">
        <ProcessPanel />
        <AttentionPanel open={open} />
        <ProductionPanel />
        <DuePanel open={open} />
        <ShipmentsPanel orders={orders} />
        <MaterialsPanel />
      </div>
    </>
  )
}

// ─── Linia procesu ────────────────────────────────────────────────────────
function ProcessPanel() {
  const app = useApp()
  const stages = getStages()
  return (
    <section className="panel p-line" aria-label="Przebieg dnia">
      <div className="panel-h">
        <h2>Przebieg dnia</h2>
        <span className="sub">od przyjęcia surowca do wysyłki — kliknij etap, aby przejść do modułu</span>
        <span className="tools legend">
          <span><StageNode level="ok" size={11} /> w normie</span>
          <span><StageNode level="warn" size={11} /> wymaga uwagi</span>
          <span><StageNode level="crit" size={11} /> krytyczne</span>
        </span>
      </div>
      <div className="pline">
        {stages.map(s => (
          <button key={s.key} className={`pstage ${s.level}`} onClick={() => app.openModule(s.key)}
            aria-label={`${s.name}: ${s.value} ${s.unit ?? ''}, ${LEVEL_WORD[s.level]}. ${s.sub}`}>
            <span className="rail" />
            <span className="ph"><span className="node"><StageNode level={s.level} /></span><span className="pn">{s.name}</span></span>
            <span className="pv num">{s.value}<small>{s.unit}</small></span>
            <span className="ps" title={s.sub}>{s.sub}</span>
            {s.progress !== undefined && <span className="pb"><i style={{ width: `${Math.min(100, s.progress * 100)}%` }} /></span>}
          </button>
        ))}
      </div>
    </section>
  )
}

// ─── Wymaga uwagi ─────────────────────────────────────────────────────────
interface AttnItem { key: string; level: Level; title: React.ReactNode; detail: string; tags: React.ReactNode[]; action: string; run: () => void }

function AttentionPanel({ open }: { open: Array<{ o: Order; m: ReturnType<typeof computeMetrics> }> }) {
  const app = useApp()
  const items: AttnItem[] = []
  const rank: Record<Level, number> = { crit: 0, warn: 1, info: 2 }

  for (const { o, m } of open) {
    const serious = m.flags.filter(f => f.level !== 'info')
    if (!serious.length) continue
    const top = serious[0]
    const tab: DetailTab = top.code === 'pallets' ? 'pallets' : top.code === 'material' ? 'production' : 'coverage'
    items.push({
      key: o.id, level: serious.some(f => f.level === 'crit') ? 'crit' : 'warn',
      title: <><span className="num">{o.no}</span> · {o.client.name}</>,
      detail: serious.map(f => f.detail).join(' '),
      tags: serious.map(f => <span key={f.code} className={`tag ${f.level}`}>{f.label}</span>),
      action: tab === 'pallets' ? 'Rozpisz palety' : tab === 'production' ? 'Sprawdź produkcję' : 'Pokaż pokrycie',
      run: () => app.gotoOrders({ select: o.id, tab, view: 'active' }),
    })
  }
  const beyaz = MATERIALS[0]
  items.push({
    key: 'mat-beyaz', level: 'crit',
    title: <>Brak półproduktu: {beyaz.name}</>,
    detail: `Na 3 dni potrzeba ${kg(beyaz.need3d)}, w magazynie ${kg(beyaz.stock)} (w całości zarezerwowane). ${beyaz.note}.`,
    tags: [<span key="z" className="tag crit">Zasięg {num1(beyaz.stock / (beyaz.need3d / 3))} dnia</span>, <span key="o" className="tag outline">3 zamówienia</span>],
    action: 'Plan masowania', run: () => app.openModule('plan-masowania'),
  })
  for (const t of TASKS) {
    items.push({ key: t.id, level: t.level, title: t.title, detail: t.detail, tags: [], action: t.action, run: () => app.openModule(t.module) })
  }
  items.sort((a, b) => rank[a.level] - rank[b.level])
  const crit = items.filter(i => i.level === 'crit').length

  return (
    <section className="panel" aria-label="Wymaga uwagi">
      <div className="panel-h">
        <h2>Wymaga uwagi</h2>
        <span className="sub">{items.length} spraw · {crit} krytyczne</span>
      </div>
      <div className="panel-b">
        <ul className="attn">
          {items.map(it => (
            <li key={it.key} className={it.level}>
              <span className={`ai alert-ico ${it.level}`}><FlagIcon level={it.level} size={17} /></span>
              <span className="at">{it.title}</span>
              <span className="ad">{it.detail}</span>
              {it.tags.length > 0 && <span className="am">{it.tags}</span>}
              <button className="btn sm act" onClick={it.run}>{it.action}<ArrowRight size={14} /></button>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}

// ─── Produkcja dziś ───────────────────────────────────────────────────────
function ProductionPanel() {
  const plan = PRODUCTION_TODAY.reduce((a, r) => a + r.plannedKg, 0)
  const rep = PRODUCTION_TODAY.reduce((a, r) => a + r.reportedKg, 0)
  const max = Math.max(...PRODUCTION_TODAY.map(r => r.plannedKg))
  return (
    <section className="panel" aria-label="Produkcja dziś">
      <div className="panel-h">
        <h2>Produkcja dziś</h2>
        <span className="sub">zgłoszono / zaplanowano</span>
      </div>
      <div className="panel-b" style={{ display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '12px 14px 2px', display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
          <div className="hero-fig"><span className="v">{num(rep)}</span><span className="of">z {kg(plan)}</span></div>
          <span className="tag info">{pct((rep / plan) * 100)} planu</span>
          <span className="tag warn" data-tip="Zmiana II z 28.10 i zmiana I z dziś. Zgłoszenia mogą się jeszcze zmienić.">2 sesje do potwierdzenia</span>
          <span className="legend hide-m" style={{ marginLeft: 'auto' }}>
            <span><i className="f-prod" />zgłoszono</span>
            <span><i style={{ background: 'var(--m-track)', boxShadow: 'inset 0 0 0 1px var(--line)' }} />plan</span>
          </span>
        </div>
        <div className="bullets">
          {PRODUCTION_TODAY.map(r => (
            <div key={r.recipe} className={`bullet${r.reportedKg === 0 ? ' idle' : ''}`}>
              <span className="bn">{r.recipe}<small>{r.line}</small></span>
              <span className="bt" data-tip={`${r.recipe}: zgłoszono ${kg(r.reportedKg)} z ${kg(r.plannedKg)} (${pct(r.plannedKg ? r.reportedKg / r.plannedKg * 100 : 0)})`}>
                <i className="plan" style={{ width: `${(r.plannedKg / max) * 100}%` }} />
                {r.reportedKg > 0 && <i className="rep" style={{ width: `${(r.reportedKg / max) * 100}%` }} />}
              </span>
              <span className="bv">{r.reportedKg === 0 ? <span className="muted">nie rozpoczęto</span> : <><b>{num(r.reportedKg)}</b> / {num(r.plannedKg)} kg</>}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ─── Terminy ──────────────────────────────────────────────────────────────
function DuePanel({ open }: { open: Array<{ o: Order; m: ReturnType<typeof computeMetrics> }> }) {
  const app = useApp()
  const buckets: Bucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'nodate']
  const sub: Partial<Record<Bucket, string>> = {
    today: `${weekday(TODAY)} ${fmtDay(TODAY)}`, tomorrow: `${weekday(addDays(TODAY, 1))} ${fmtDay(addDays(TODAY, 1))}`,
    week: `do ${fmtDay(addDays(TODAY, 7))}`, later: `od ${fmtDay(addDays(TODAY, 8))}`, nodate: 'szkice', overdue: 'termin minął',
  }
  const rows = buckets.map(b => {
    const xs = open.filter(x => x.m.bucket === b)
    return { b, n: xs.length, ordered: xs.reduce((a, x) => a + x.m.orderedKg, 0), missing: xs.reduce((a, x) => a + x.m.missingKg, 0) }
  })
  const tot = rows.reduce((a, r) => ({ n: a.n + r.n, ordered: a.ordered + r.ordered, missing: a.missing + r.missing }), { n: 0, ordered: 0, missing: 0 })
  return (
    <section className="panel" aria-label="Terminy zamówień">
      <div className="panel-h"><h2>Terminy zamówień</h2><span className="sub">otwarte, wg terminu dostawy</span></div>
      <div className="panel-b">
        <table className="ladder">
          <thead><tr><th>Termin</th><th className="num" style={{ textAlign: 'right' }}>Zam.</th><th style={{ textAlign: 'right' }}>Zamówiono</th><th style={{ textAlign: 'right' }}>Brak wyrobu</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.b} className={`click ${r.b}`} tabIndex={0} onClick={() => app.gotoOrders({ view: 'active', bucket: r.b })}
                onKeyDown={e => { if (e.key === 'Enter') app.gotoOrders({ view: 'active', bucket: r.b }) }}
                data-tip={`Pokaż zamówienia: ${BUCKET_LABEL[r.b].toLowerCase()}`}>
                <td><span className="lb">{BUCKET_LABEL[r.b]}<small>{sub[r.b]}</small></span></td>
                <td className="num strong">{r.n}</td>
                <td className="num">{kg(r.ordered)}</td>
                <td className="num">{r.missing > 0
                  ? <span className={r.b === 'overdue' || r.b === 'today' ? 'crit-ink strong' : r.b === 'tomorrow' ? 'warn-ink strong' : ''}>{kg(r.missing)}</span>
                  : <span className="ok-ink">komplet</span>}</td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td className="strong" style={{ height: 34 }}>Razem</td><td className="num strong">{tot.n}</td><td className="num strong">{kg(tot.ordered)}</td><td className="num strong">{kg(tot.missing)}</td></tr></tfoot>
        </table>
      </div>
    </section>
  )
}

// ─── Wysyłki ──────────────────────────────────────────────────────────────
const SHIP_LABEL = { departed: 'Wyjechał', loading: 'Załadunek', picking: 'Kompletacja', planned: 'Zaplanowany' }

function ShipmentsPanel({ orders }: { orders: Order[] }) {
  const app = useApp()
  let lastDay = ''
  return (
    <section className="panel p-ship" aria-label="Najbliższe wysyłki">
      <div className="panel-h"><h2>Najbliższe wysyłki</h2><span className="sub">kursy na 3 dni</span>
        <span className="tools"><button className="btn sm ghost" onClick={() => app.openModule('wysylki')}>Wszystkie kursy<ArrowRight size={14} /></button></span>
      </div>
      <div className="panel-b">
        <table className="tbl">
          <thead><tr><th>Godz.</th><th>Kurs</th><th>Zamówienia</th><th className="r">Palety gotowe</th><th className="r">Masa</th><th className="hide-m">Pojazd</th><th>Dokumenty</th><th>Stan</th></tr></thead>
          <tbody>
            {SHIPMENTS.map(s => {
              const os = s.orderIds.map(id => orders.find(o => o.id === id)).filter(Boolean) as Order[]
              const ms = os.map(computeMetrics)
              const pallets = ms.reduce((a, m) => a + m.palletsTotal, 0)
              const ready = ms.reduce((a, m) => a + m.palletsReady, 0)
              const mass = ms.reduce((a, m) => a + m.orderedKg, 0)
              const missing = ms.reduce((a, m) => a + m.missingKg, 0)
              const unassigned = ms.reduce((a, m) => a + m.unassignedQty, 0)
              const dayKey = relDay(s.date)
              const head = dayKey !== lastDay ? <tr className="daysep"><td colSpan={8}>{dayKey === 'dziś' ? 'Dziś · ' : dayKey === 'jutro' ? 'Jutro · ' : ''}{weekday(s.date)} {fmtDay(s.date)}</td></tr> : null
              lastDay = dayKey
              const wz = os.flatMap(o => o.docs.filter(d => d.kind === 'WZ'))
              const cmr = os.flatMap(o => o.docs.filter(d => d.kind === 'CMR' && d.state !== 'not_required'))
              const docState = (ds: typeof wz) => ds.length === 0 ? 'na' : ds.every(d => d.state === 'issued') ? 'issued' : ds.some(d => d.state === 'issued' || d.state === 'partial') ? 'partial' : 'todo'
              return (
                <React.Fragment key={s.id}>
                  {head}
                  <tr className="row">
                    <td className="num strong">{s.time}</td>
                    <td className="num">{s.no}</td>
                    <td className="ell" style={{ maxWidth: 260 }}>
                      {os.map((o, i) => (
                        <React.Fragment key={o.id}>{i > 0 && ', '}
                          <button className="accent-ink" style={{ fontWeight: 500 }} onClick={() => app.gotoOrders({ select: o.id, tab: 'shipping', view: isClosed(o) ? 'closed' : 'active' })} data-tip={`${o.no} · ${o.client.name}`}>{o.client.name.split(' ')[0]} <span className="num faint">{o.no.slice(-4)}</span></button>
                        </React.Fragment>
                      ))}
                    </td>
                    <td className="num">
                      {pallets === 0 ? <span className="warn-ink strong">brak rozpisu</span> : <><b>{ready}</b> / {pallets}</>}
                      {unassigned > 0 && pallets > 0 && <span className="sub warn-ink">+{unassigned} szt.</span>}
                    </td>
                    <td className="num">{kg(mass)}{missing > 0 && <span className="sub crit-ink" data-tip="Brak wyrobu w zamówieniach tego kursu">−{num(missing)}</span>}</td>
                    <td className="hide-m"><span>{s.plate}</span><span className="sub">{s.carrier === 'Transport własny' ? s.driver : s.carrier}</span></td>
                    <td><span className="docs">
                      <span className={`doc ${docState(wz)}`} data-tip="WZ: pełny = wystawione, obrys = do wystawienia">WZ</span>
                      {cmr.length > 0 && <span className={`doc ${docState(cmr)}`} data-tip="CMR — transport zagraniczny">CMR</span>}
                      {s.printPending && <span className="tag warn" style={{ height: 20 }} data-tip="Dokumenty dla kierowcy nie zostały wydrukowane">wydruk</span>}
                    </span></td>
                    <td><span className={`shipst ${s.status}`}><i />{SHIP_LABEL[s.status]}</span></td>
                  </tr>
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ─── Surowce ──────────────────────────────────────────────────────────────
function MaterialsPanel() {
  const rows = MATERIALS.map(m => {
    const daily = m.need3d / 3
    const days = daily > 0 ? m.stock / daily : 99
    const level = days < 1 ? 'crit' : days < 2 ? 'warn' : 'ok'
    return { ...m, days, level }
  }).sort((a, b) => a.days - b.days)
  return (
    <section className="panel" aria-label="Zasięg surowców">
      <div className="panel-h"><h2>Zasięg surowców</h2><span className="sub">stan ÷ średnie zużycie dzienne z planu</span></div>
      <div className="panel-b">
        <table className="tbl">
          <thead><tr><th>Materiał</th><th className="r">Stan</th><th className="r hide-m" data-tip="Zapotrzebowanie z planów na najbliższe 3 dni">Na 3 dni</th><th>Zasięg</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.name} className="row" data-tip={`${r.name} (${r.group})\nStan ${num(r.stock)} ${r.unit}, zarezerwowane ${num(r.reserved)} ${r.unit}\nPotrzeba na 3 dni: ${num(r.need3d)} ${r.unit}${r.note ? `\n${r.note}` : ''}`}>
                <td className="ell" style={{ width: '100%' }}><span className={r.level === 'crit' ? 'strong' : ''}>{r.name}</span></td>
                <td className="num">{num(r.stock)} {r.unit}</td>
                <td className="num hide-m">{num(r.need3d)} {r.unit}</td>
                <td>
                  <span className={`reach ${r.level}`}>
                    <span className="rt" aria-hidden="true"><i style={{ width: `${Math.min(100, (r.days / 5) * 100)}%` }} /></span>
                    <span className="rv">{r.days >= 5 ? '5+ dni' : `${num1(r.days)} dnia`}</span>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="panel-f"><span>Kreska na pasku = 2 dni (próg uwagi).</span></div>
    </section>
  )
}
