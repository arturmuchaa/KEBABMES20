import React, { useEffect, useState } from 'react'
import { Pencil, Save, X, Plus } from 'lucide-react'
import { useApp } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { kg, num, type Order } from '../../../data/model'
import { FlagIcon } from '../../../ui/Glyphs'

/**
 * Pozycje: wiele wyrobów, receptur i gramatur w jednym zamówieniu.
 * Edycja w miejscu (F2). Walidacja pilnuje zasady z KEBABMES20: ilości nie
 * można zmniejszyć poniżej tego, co już spakowano na palety z wydrukowanymi kartonami.
 */
export function LinesTab({ order }: { order: Order }) {
  const app = useApp()
  const { update } = useOrders()
  const [edit, setEdit] = useState(false)
  const boxRef = React.useRef<HTMLDivElement>(null)
  const [draft, setDraft] = useState<Record<string, string>>({})
  const closed = order.status === 'done' || order.status === 'cancelled'

  useEffect(() => { setEdit(false); setDraft({}) }, [order.id])
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'F2' && !closed && !document.querySelector('.dialog-wrap') && boxRef.current?.offsetParent) { e.preventDefault(); setEdit(true) } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [closed])

  const packedOf = (lineId: string) => order.pallets.filter(p => p.status !== 'created')
    .reduce((a, p) => a + p.items.filter(it => it.lineId === lineId).reduce((b, it) => b + it.qty, 0), 0)
  const palletNos = (lineId: string) => order.pallets.filter(p => p.status !== 'created' && p.items.some(it => it.lineId === lineId)).map(p => p.no)

  const errors: Record<string, string> = {}
  for (const l of order.lines) {
    const v = draft[l.id]
    if (v === undefined) continue
    const n = Number(v)
    if (!/^\d+$/.test(v.trim())) errors[l.id] = 'Wpisz liczbę całkowitą sztuk.'
    else if (n === 0) errors[l.id] = 'Ilość musi być większa od zera. Aby usunąć pozycję, użyj menu wiersza.'
    else if (n < packedOf(l.id)) errors[l.id] = `Nie można zmniejszyć poniżej ${packedOf(l.id)} szt. — tyle jest już spakowane na paletach ${palletNos(l.id).join(', ')}. Najpierw zmień rozpis palet.`
    else if (n < l.delivered) errors[l.id] = `Wydano już ${l.delivered} szt. na WZ — ilość nie może być mniejsza.`
  }
  const hasErr = Object.keys(errors).length > 0
  const changed = order.lines.filter(l => draft[l.id] !== undefined && Number(draft[l.id]) !== l.qty)
  const qtyOf = (id: string, q: number) => draft[id] !== undefined && /^\d+$/.test(draft[id]) ? Number(draft[id]) : q
  const totalKg = order.lines.reduce((a, l) => a + qtyOf(l.id, l.qty) * l.kgPerUnit, 0)
  const totalQty = order.lines.reduce((a, l) => a + qtyOf(l.id, l.qty), 0)

  const save = () => {
    if (hasErr) return
    if (!changed.length) { setEdit(false); return }
    update(order.id, o => ({
      ...o,
      lines: o.lines.map(l => draft[l.id] !== undefined ? { ...l, qty: Number(draft[l.id]) } : l),
      history: [{ at: '29.10 10:42', who: 'Anna Nowak', text: changed.map(l => `Poz. ${l.lp}: ${l.qty} → ${draft[l.id]} szt.`).join('; '), kind: 'edit' }, ...o.history],
    }))
    app.toast({ title: 'Zapisano pozycje', detail: `${changed.length} ${changed.length === 1 ? 'zmiana' : 'zmiany'} · zapis tylko w tej sesji demo.` })
    setEdit(false); setDraft({})
  }

  return (
    <div className="dock-pad" ref={boxRef}>
      <div className="sect-h">
        <h3>Pozycje zamówienia</h3>
        <span className="sub">{order.lines.length} poz. · {num(totalQty)} szt. · {kg(totalKg)}</span>
        <div className="tools">
          {edit ? <>
            {changed.length > 0 && !hasErr && <span className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Zmienione: {changed.length}</span>}
            <button className="btn" onClick={() => { setEdit(false); setDraft({}) }}><X size={15} />Anuluj<span className="kbd">Esc</span></button>
            <button className="btn primary" onClick={save} disabled={hasErr}><Save size={15} />Zapisz zmiany</button>
          </> : <>
            <button className="btn" disabled={closed} onClick={() => app.toast({ kind: 'info', title: 'Dodawanie pozycji', detail: 'Pełny edytor pozycji jest w karcie „Nowe zamówienie" (Ctrl+N).' })}><Plus size={15} />Dodaj pozycję</button>
            <button className="btn" disabled={closed} onClick={() => setEdit(true)}><Pencil size={15} />Edytuj ilości<span className="kbd">F2</span></button>
          </>}
        </div>
      </div>
      <div className="box">
        <table className="tbl" onKeyDown={e => { if (e.key === 'Escape' && edit) { e.stopPropagation(); setEdit(false); setDraft({}) } if (e.key === 'Enter' && edit) save() }}>
          <thead><tr>
            <th className="num" style={{ width: 44 }}>Lp.</th><th>Wyrób</th><th>Receptura</th><th className="num">Gramatura</th><th className="hide-s">Opakowanie</th>
            <th className="num">Ilość</th><th className="num">Masa</th><th className="hide-m">Plan</th><th>Uwagi</th>
          </tr></thead>
          <tbody>
            {order.lines.map((l, i) => {
              const err = errors[l.id]
              return (
                <React.Fragment key={l.id}>
                  <tr className={`row${i % 2 ? ' zebra' : ''}${edit ? ' editing' : ''}`}>
                    <td className="num muted">{l.lp}</td>
                    <td>{l.product}</td>
                    <td className="strong">{l.recipe}</td>
                    <td className="num">{l.kgPerUnit} kg</td>
                    <td className="hide-s">{l.packaging}</td>
                    <td className="num">
                      {edit ? <input className={`field num${err ? ' invalid' : ''}`} id={`qty-${l.id}`} inputMode="numeric" aria-label={`Ilość, pozycja ${l.lp}`}
                        aria-invalid={!!err} aria-describedby={err ? `err-${l.id}` : undefined}
                        value={draft[l.id] ?? String(l.qty)} onChange={e => setDraft(d => ({ ...d, [l.id]: e.target.value }))}
                        autoFocus={i === 0} onFocus={e => e.target.select()} /> : <b>{num(l.qty)}</b>}
                      <span className="sub">szt.</span>
                    </td>
                    <td className="num">{kg(qtyOf(l.id, l.qty) * l.kgPerUnit)}</td>
                    <td className="hide-m muted">{l.planNo ?? '—'}</td>
                    <td className="ell muted" style={{ maxWidth: 260 }} title={l.note}>{l.note ?? ''}</td>
                  </tr>
                  {err && <tr className="err-row"><td /><td colSpan={8}><span id={`err-${l.id}`} className="crit-ink" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', fontSize: 'var(--fs-sm)' }}><FlagIcon level="crit" size={14} />{err}</span></td></tr>}
                </React.Fragment>
              )
            })}
          </tbody>
          <tfoot><tr><td /><td colSpan={4}>Razem</td><td className="num">{num(totalQty)} <span className="sub">szt.</span></td><td className="num">{kg(totalKg)}</td><td className="hide-m" /><td /></tr></tfoot>
        </table>
      </div>
      {edit && <div className="note info"><FlagIcon level="info" size={15} /><div>Enter zapisuje, Esc anuluje. Zmiana ilości przelicza masę od razu. Ilości nie można zmniejszyć poniżej sztuk już spakowanych na palety ani wydanych na WZ.</div></div>}
    </div>
  )
}
