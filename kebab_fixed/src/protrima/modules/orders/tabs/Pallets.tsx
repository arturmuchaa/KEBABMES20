import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Printer, Wand2, Boxes, Lock, ScanLine } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { BEZ_DRUKU_ETYKIET, FAZA_ZAPISU } from '../../../proba'
import { computeMetrics, kg, num, palletKg, palletQty, PALLET_STATUS, type Order, type Pallet } from '../../../data/model'
import { PalletFlow, PalletStatusLabel, FlagIcon } from '../../../ui/Glyphs'

/** Orientacyjna masa palety przy rozpisie — tylko podpowiedź w oknie dodawania. */
const CAP_KG = 640

export function PalletsTab({ order }: { order: Order }) {
  const app = useApp()
  const m = computeMetrics(order)
  const [selNo, setSelNo] = useState<number | null>(order.pallets[0]?.no ?? null)
  const [marked, setMarked] = useState<number[]>([])
  const [adding, setAdding] = useState(false)
  const closed = order.status === 'done' || order.status === 'cancelled'
  useEffect(() => { setSelNo(order.pallets[0]?.no ?? null); setMarked([]) }, [order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPal = useMemo(() => {
    const r: Record<string, number> = {}
    order.pallets.forEach(p => p.items.forEach(it => { r[it.lineId] = (r[it.lineId] ?? 0) + it.qty }))
    return r
  }, [order.pallets])
  const nextNo = Math.max(0, ...order.pallets.map(p => p.no), ...order.retiredPalletNos) + 1
  const sel = order.pallets.find(p => p.no === selNo) ?? null
  const lineOf = (id: string) => order.lines.find(l => l.id === id)!

  // Rozpis i dodawanie palet: orderPalletsApi.save — faza 3. Numery nadaje backend.
  const autoAssign = () => app.toast({ kind: 'info', title: 'Automatyczny rozpis palet', detail: FAZA_ZAPISU })

  return (
    <div className="dock-pad">
      <div className="pal-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="sect-h">
            <h3>Palety zamówienia</h3>
            <span className="sub">{m.palletsTotal ? `${m.palletsReady} z ${m.palletsTotal} gotowych · ${m.palletsLoaded} załadowanych` : 'nierozpisane'}</span>
            <div className="tools">
              <button className="btn sm" disabled={!order.pallets.length} onClick={() => app.toast({ kind: 'warn', title: `Kartki palet: ${marked.length || order.pallets.length}`, detail: BEZ_DRUKU_ETYKIET })} data-tip="W próbie wyłączone">
                <Printer size={15} />{marked.length ? `Drukuj kartki (${marked.length})` : 'Drukuj wszystkie kartki'}
              </button>
            </div>
          </div>
          {order.lines.length > 0 && (order.pallets.length > 0 || closed) && (
            <div className="box astrip" aria-label="Rozpisanie pozycji na palety">
              <span className="ah">Rozpisanie</span>
              {order.lines.map(l => {
                const on = onPal[l.id] ?? 0
                return (
                  <span key={l.id} className={`achip${on < l.qty ? ' short' : ''}`} data-tip={`Poz. ${l.lp}: ${l.product}, ${l.recipe} ${l.kgPerUnit} kg\nNa paletach ${on} z ${l.qty} szt.`}>
                    <span className="t"><span>{l.recipe} {l.kgPerUnit} kg</span><span className="num"><b>{on}</b>/{l.qty}</span></span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, on / l.qty * 100)}%` }} /></span>
                  </span>
                )
              })}
              <span className="grow" />
              {m.unassignedQty > 0 && !closed
                ? <button className="btn sm primary" onClick={autoAssign}><Wand2 size={14} />Rozpisz pozostałe ({num(m.unassignedQty)} szt.)</button>
                : <span className="tag ok">wszystko rozpisane</span>}
            </div>
          )}
          {order.pallets.length === 0 && !closed ? (
            <div className="box" style={{ padding: 20, display: 'flex', gap: 16, alignItems: 'center' }}>
              <Boxes size={28} color="var(--ink-3)" />
              <div style={{ flex: 1 }}>
                <div className="strong">Palety nie są rozpisane</div>
                <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{num(m.unassignedQty)} szt. ({kg(m.orderedKg)}) czeka na przypisanie. Rozpis automatyczny łączy pozycje do ok. {CAP_KG} kg na paletę.</div>
              </div>
              <button className="btn" onClick={() => setAdding(true)}><Plus size={15} />Nowa paleta</button>
              <button className="btn primary" onClick={autoAssign}><Wand2 size={15} />Rozpisz automatycznie</button>
            </div>
          ) : (
            <div className="pal-grid">
              {[...order.pallets.map(p => ({ t: 'p' as const, no: p.no, p })), ...order.retiredPalletNos.map(no => ({ t: 'r' as const, no, p: null }))]
                .sort((a, b) => a.no - b.no).map(x => x.t === 'r' ? (
                  <div key={`r${x.no}`} className="pal retired" data-tip="Numer palety i kartonu jest stały. Usunięta paleta nie zwalnia numeru — ponowne użycie pomieszałoby skany QR.">
                    <Lock size={16} /><span className="pno">Paleta {x.no}</span><span>usunięta 28.10 · numer zablokowany</span>
                  </div>
                ) : (
                  <PalletCard key={x.p!.id} order={order} p={x.p!} sel={x.p!.no === selNo} marked={marked.includes(x.p!.no)}
                    onSelect={() => setSelNo(x.p!.no)} onMark={() => setMarked(ms => ms.includes(x.p!.no) ? ms.filter(n => n !== x.p!.no) : [...ms, x.p!.no])} />
                ))}
              {!closed && (
                <button className="pal add" onClick={() => setAdding(true)} disabled={m.unassignedQty === 0} data-tip={m.unassignedQty === 0 ? 'Wszystkie sztuki są już rozpisane' : `Następny numer: ${nextNo}`}>
                  <Plus size={18} />Nowa paleta<span className="muted" style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}>{m.unassignedQty ? `nr ${nextNo} · ${num(m.unassignedQty)} szt. do rozpisania` : 'wszystko rozpisane'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="side">
          {!sel && <div className="box" style={{ padding: 14 }}><span className="muted">Wybierz paletę, aby zobaczyć jej etapy i partie.</span></div>}
          {sel && (
            <div className="box">
              <div className="panel-h"><h2 style={{ fontSize: 'var(--fs-md)' }}>Paleta {sel.no}</h2><span className="code muted">karton {sel.carton}</span>
                <span className="tools"><PalletStatusLabel status={sel.status} /></span></div>
              <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <PalletFlow status={sel.status} />
                <dl className="kv">
                  <dt>Zawartość</dt><dd className="num">{palletQty(sel)} szt. · {kg(palletKg(order, sel))}</dd>
                  <dt>Spakowano</dt><dd className="num">{sel.packedAt ? `${sel.packedAt}${sel.status === 'packing' ? ` · ${sel.readyQty}/${palletQty(sel)} szt.` : ''}` : '—'}</dd>
                  <dt>Mroźnia</dt><dd className="num">{sel.coldAt ?? '—'}</dd>
                  <dt>Załadowano</dt><dd className="num">{sel.loadedAt ?? '—'}</dd>
                  <dt>Rejestracja</dt><dd>{sel.by ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><ScanLine size={14} />{sel.by}</span> : '—'}</dd>
                </dl>
              </div>
              <div className="panel-h" style={{ borderTop: '1px solid var(--line-soft)', minHeight: 34 }}><h2 style={{ fontSize: 'var(--fs-sm)', color: 'var(--ink-2)' }}>Śledzenie partii</h2></div>
              <div className="trace">
                {sel.batches.length === 0 && <span className="muted">Partie pojawią się po zeskanowaniu pakowania.</span>}
                {sel.batches.map(b => (
                  <div key={b} className="tr"><span className="code">{b}</span></div>))}
              </div>
            </div>
          )}
          <div className="note"><Lock size={15} /><div>Numery palet i kartonów są stałe. Usunięcie palety nie zwalnia numeru — następny numer nadaje serwer.</div></div>
        </aside>
      </div>
      {adding && <NewPalletDialog order={order} onPal={onPal} nextNo={nextNo} onClose={() => setAdding(false)} onSave={() => {
        setAdding(false)
        app.toast({ kind: 'info', title: 'Nowa paleta', detail: FAZA_ZAPISU })
      }} lineOf={lineOf} />}
    </div>
  )
}

function PalletCard({ order, p, sel, marked, onSelect, onMark }: { order: Order; p: Pallet; sel: boolean; marked: boolean; onSelect: () => void; onMark: () => void }) {
  return (
    <div className={`pal${sel ? ' sel' : ''}`} role="button" tabIndex={0} aria-pressed={sel} onClick={onSelect}
      onKeyDown={e => { if (e.key === 'Enter') onSelect(); if (e.key === ' ') { e.preventDefault(); onMark() } }}
      aria-label={`Paleta ${p.no}, karton ${p.carton}, ${PALLET_STATUS[p.status]}`}>
      <div className="ph">
        <span className="pno">Paleta {p.no}</span><span className="pc code">{p.carton}</span>
        <input type="checkbox" className="cbx" checked={marked} onChange={onMark} onClick={e => e.stopPropagation()} aria-label={`Zaznacz paletę ${p.no} do wydruku`} />
      </div>
      <ul>
        {p.items.map(it => { const l = order.lines.find(x => x.id === it.lineId)!; return (
          <li key={it.lineId}><span>{l.recipe} {l.kgPerUnit} kg × {it.qty}</span><span>{kg(it.qty * l.kgPerUnit)}</span></li>) })}
      </ul>
      <div className="pf">
        <PalletStatusLabel status={p.status} />
        <PalletFlow status={p.status} />
        <span className="tot">{kg(palletKg(order, p))}</span>
      </div>
    </div>
  )
}

function NewPalletDialog({ order, onPal, nextNo, onClose, onSave, lineOf }: {
  order: Order; onPal: Record<string, number>; nextNo: number; onClose: () => void
  onSave: (items: Array<{ lineId: string; qty: number }>) => void; lineOf: (id: string) => Order['lines'][number]
}) {
  const free = order.lines.filter(l => l.qty - (onPal[l.id] ?? 0) > 0)
  const [qty, setQty] = useState<Record<string, string>>({})
  const [tried, setTried] = useState(false)
  const items = Object.entries(qty).filter(([, v]) => v.trim() !== '').map(([id, v]) => ({ lineId: id, qty: Number(v) }))
  const errs: Record<string, string> = {}
  items.forEach(it => {
    const max = lineOf(it.lineId).qty - (onPal[it.lineId] ?? 0)
    if (!Number.isInteger(it.qty) || it.qty <= 0) errs[it.lineId] = 'Wpisz liczbę sztuk większą od zera.'
    else if (it.qty > max) errs[it.lineId] = `Do rozpisania zostało ${max} szt.`
  })
  const total = items.reduce((a, it) => a + (Number.isFinite(it.qty) ? it.qty * lineOf(it.lineId).kgPerUnit : 0), 0)
  const empty = items.length === 0
  return (
    <Dialog title={`Nowa paleta ${nextNo}`} icon={<Boxes size={20} color="var(--accent)" />} onClose={onClose}
      footer={<><span className="left">Masa palety: <b className="num">{kg(total)}</b>{total > CAP_KG && <span className="warn-ink"> · ponad {CAP_KG} kg</span>}</span>
        <button className="btn" onClick={onClose}>Anuluj</button>
        <button className="btn primary" onClick={() => { setTried(true); if (!empty && !Object.keys(errs).length) onSave(items) }}>Dodaj paletę</button></>}>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Wpisz, ile sztuk z każdej pozycji trafi na paletę. Numer {nextNo} i karton nadaje system — nie zmieniają się później.</p>
      <div className="box">
        <table className="tbl">
          <thead><tr><th>Pozycja</th><th className="num">Do rozpisania</th><th className="num" style={{ width: 130 }}>Na paletę</th></tr></thead>
          <tbody>{free.map((l, i) => (
            <React.Fragment key={l.id}>
              <tr className="row editing"><td><b>{l.recipe}</b> {l.kgPerUnit} kg <span className="sub">poz. {l.lp}</span></td>
                <td className="num">{l.qty - (onPal[l.id] ?? 0)} szt.</td>
                <td className="num"><input id={`np-${l.id}`} className={`field num${errs[l.id] ? ' invalid' : ''}`} inputMode="numeric" value={qty[l.id] ?? ''} placeholder="0" autoFocus={i === 0}
                  onChange={e => setQty(q => ({ ...q, [l.id]: e.target.value }))} aria-label={`Sztuk z pozycji ${l.lp}`} /></td></tr>
              {errs[l.id] && <tr className="err-row"><td colSpan={3}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errs[l.id]}</span></td></tr>}
            </React.Fragment>))}</tbody>
        </table>
      </div>
      {tried && empty && <div className="note crit"><FlagIcon level="crit" size={15} /><div>Wpisz ilość przynajmniej dla jednej pozycji.</div></div>}
    </Dialog>
  )
}
