import React, { useEffect, useMemo, useState } from 'react'
import { Plus, Printer, Wand2, Boxes, Lock, ScanLine, Pencil, Trash2 } from 'lucide-react'
import { useApp, Dialog } from '../../../shell/context'
import { useOrders } from '../../../data/store'
import { computeMetrics, kg, num, palletKg, palletQty, PALLET_STATUS, type Order, type Pallet } from '../../../data/model'
import { PalletFlow, PalletStatusLabel, FlagIcon } from '../../../ui/Glyphs'
import { WazeniePalety } from './WazeniePalety'
import { orderPalletsApi, type OrderPallet } from '@/lib/api'
import { bezPalety, bledyPalety, rozpisz, sztukNaPalete, wykryjSztuki, zDodanymi, zZmieniona, MAX_KG_RESZTKI, STANDARD_SZTUK, WARIANTY_SZTUK, type ItemLite } from '../palety/model'

/**
 * Palety zamówienia. Zapis przez orderPalletsApi.save — zawsze ze świeżej listy
 * z serwera (palety/model.ts), numer i karton nowej palety nadaje serwer.
 * Kartki palet: KartkiPaletDialog (w próbie bez QR i bez druku — prawdziwe adresy palet).
 */
export function PalletsTab({ order }: { order: Order }) {
  const app = useApp()
  const { refresh } = useOrders()
  const m = computeMetrics(order)
  const [selNo, setSelNo] = useState<number | null>(order.pallets[0]?.no ?? null)
  const [marked, setMarked] = useState<number[]>([])
  const [dlg, setDlg] = useState<null | { t: 'new' } | { t: 'edit'; p: Pallet } | { t: 'del'; p: Pallet } | { t: 'auto' }>(null)
  const [busy, setBusy] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const closed = order.status === 'done' || order.status === 'cancelled'
  useEffect(() => { setSelNo(order.pallets[0]?.no ?? null); setMarked([]) }, [order.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const onPal = useMemo(() => {
    const r: Record<string, number> = {}
    order.pallets.forEach(p => p.items.forEach(it => { r[it.lineId] = (r[it.lineId] ?? 0) + it.qty }))
    return r
  }, [order.pallets])
  /** Wolne sztuki pozycji, opcjonalnie oddając zawartość edytowanej palety. */
  const wolne = (pomin?: Pallet) => Object.fromEntries(order.lines.map(l => [l.id,
    Math.max(0, l.qty - (onPal[l.id] ?? 0) + (pomin?.items.find(i => i.lineId === l.id)?.qty ?? 0))]))
  const sel = order.pallets.find(p => p.no === selNo) ?? null
  const lineOf = (id: string) => order.lines.find(l => l.id === id)

  /** Zapis: świeża lista z serwera → zmiana → PUT → odświeżenie widoku. Odmowa serwera jego słowami. */
  const zapisz = async (build: (fresh: OrderPallet[]) => OrderPallet[], ok: string, poZapisie?: (zapisane: OrderPallet[]) => void) => {
    setBusy(true); setBlad(null)
    try {
      const fresh = await orderPalletsApi.list(order.id)
      const zapisane = await orderPalletsApi.save(order.id, build(fresh))
      await refresh()
      app.toast({ kind: 'ok', title: ok })
      poZapisie?.(zapisane)
      setDlg(null)
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się zapisać palet')
    } finally { setBusy(false) }
  }

  return (
    <div className="dock-pad">
      {blad && !dlg && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      <div className="pal-layout">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, minWidth: 0 }}>
          <div className="sect-h">
            <h3>Palety zamówienia</h3>
            <span className="sub">{m.palletsTotal ? `${m.palletsReady} z ${m.palletsTotal} gotowych · ${m.palletsLoaded} załadowanych` : 'nierozpisane'}</span>
            <div className="tools">
              <button className="btn sm" disabled={!order.pallets.length} onClick={() => app.printPallets(order.id, marked.length ? marked : undefined)}>
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
                  <span key={l.id} className={`achip${on > l.qty ? ' over' : on < l.qty ? ' short' : ''}`} data-tip={`Poz. ${l.lp}: ${l.product}, ${l.recipe} ${l.kgPerUnit} kg${l.packaging ? `, tuleja ${l.packaging}` : ''}\nNa paletach ${on} z ${l.qty} szt.${on > l.qty ? `\nROZPIS PONAD ZAMÓWIENIE o ${on - l.qty} szt.` : ''}`}>
                    <span className="t"><span>{l.recipe} {l.kgPerUnit} kg<Tuleja n={l.packaging} /></span><span className="num"><b>{on}</b>/{l.qty}</span></span>
                    <span className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, on / l.qty * 100)}%` }} /></span>
                  </span>
                )
              })}
              <span className="grow" />
              {m.unassignedQty > 0 && !closed
                ? <button className="btn sm primary" disabled={busy} onClick={() => setDlg({ t: 'auto' })}><Wand2 size={14} />Rozpisz pozostałe ({num(m.unassignedQty)} szt.)</button>
                : <span className="tag ok">wszystko rozpisane</span>}
            </div>
          )}
          {order.pallets.length === 0 && !closed ? (
            <div className="box empty-state">
              <Boxes size={28} color="var(--ink-3)" />
              <div className="es-text">
                <div className="strong">Palety nie są rozpisane</div>
                <div className="muted" style={{ fontSize: 'var(--fs-sm)' }}>{num(m.unassignedQty)} szt. ({kg(m.orderedKg)}) czeka na przypisanie. Rozpis automatyczny układa pełne palety wg standardu sztuk (np. 40 kg × 20), resztki łączy po recepturze — przed zapisem zobaczysz podgląd.</div>
              </div>
              <button className="btn" disabled={busy} onClick={() => setDlg({ t: 'new' })}><Plus size={15} />Nowa paleta</button>
              <button className="btn primary" disabled={busy} onClick={() => setDlg({ t: 'auto' })}><Wand2 size={15} />Rozpisz automatycznie</button>
            </div>
          ) : (
            <div className="pal-grid">
              {[...order.pallets].sort((a, b) => a.no - b.no).map(p => (
                <PalletCard key={p.id} order={order} p={p} sel={p.no === selNo} marked={marked.includes(p.no)}
                  onSelect={() => setSelNo(p.no)} onMark={() => setMarked(ms => ms.includes(p.no) ? ms.filter(n => n !== p.no) : [...ms, p.no])} />
              ))}
              {!closed && (
                <button className="pal add" onClick={() => setDlg({ t: 'new' })} disabled={m.unassignedQty === 0 || busy} data-tip={m.unassignedQty === 0 ? 'Wszystkie sztuki są już rozpisane' : 'Numer i karton nada serwer'}>
                  <Plus size={18} />Nowa paleta<span className="muted" style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}>{m.unassignedQty ? `${num(m.unassignedQty)} szt. do rozpisania` : 'wszystko rozpisane'}</span>
                </button>
              )}
            </div>
          )}
        </div>

        <aside className="side">
          {!sel && <div className="box" style={{ padding: 14 }}><span className="muted">Wybierz paletę, aby zobaczyć jej etapy i zmienić zawartość.</span></div>}
          {sel && (
            <div className="box">
              <div className="panel-h"><h2 style={{ fontSize: 'var(--fs-md)' }}>Paleta {sel.no}</h2><span className="code muted">karton {sel.carton}</span>
                <span className="tools"><PalletStatusLabel status={sel.status} /></span></div>
              <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                <PalletFlow status={sel.status} />
                <dl className="kv">
                  <dt>Zawartość</dt><dd className="num">{palletQty(sel)} szt. · {kg(palletKg(order, sel))}</dd>
                  <dt>Spakowana</dt><dd>{sel.status === 'created' ? 'nie — rozpisana' : sel.status === 'packing' ? 'w pakowaniu' : 'tak'}</dd>
                  <dt>Mroźnia</dt><dd className="num">{sel.coldAt ?? '—'}</dd>
                  <dt>Załadowano</dt><dd className="num">{sel.loadedAt ?? '—'}</dd>
                  <dt>Rejestracja</dt><dd>{sel.by ? <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><ScanLine size={14} />{sel.by}</span> : '—'}</dd>
                </dl>
                <WazeniePalety p={sel} />
                {!closed && (sel.status === 'created'
                  ? <div className="row-wrap">
                      <button className="btn sm" disabled={busy} onClick={() => setDlg({ t: 'edit', p: sel })}><Pencil size={14} />Zmień zawartość</button>
                      <button className="btn sm danger" disabled={busy} onClick={() => setDlg({ t: 'del', p: sel })}><Trash2 size={14} />Usuń paletę</button>
                    </div>
                  : <div className="note"><Lock size={15} /><div>Paleta jest w obiegu ({PALLET_STATUS[sel.status].toLowerCase()}) — jej zawartości nie można zmienić ani jej usunąć.</div></div>)}
              </div>
            </div>
          )}
          <div className="note"><Lock size={15} /><div>Numery palet i kartonów są stałe. Usunięcie palety nie zwalnia numeru — numer nowej palety nadaje serwer.</div></div>
        </aside>
      </div>

      {dlg?.t === 'new' && <PaletaDialog title="Nowa paleta" order={order} wolne={wolne()} busy={busy} blad={blad} onClose={() => { setDlg(null); setBlad(null) }}
        onSave={items => zapisz(fresh => zDodanymi(fresh, [{ items }]), 'Dodano paletę', z => setSelNo(Math.max(...z.map(p => p.palletNo))))} />}
      {dlg?.t === 'edit' && <PaletaDialog title={`Paleta ${dlg.p.no} — zawartość`} order={order} wolne={wolne(dlg.p)} start={dlg.p.items} busy={busy} blad={blad} onClose={() => { setDlg(null); setBlad(null) }}
        onSave={items => zapisz(fresh => zZmieniona(fresh, dlg.p.id, items), `Zapisano paletę ${dlg.p.no}`)} />}
      {dlg?.t === 'del' && <Dialog title={`Usunąć paletę ${dlg.p.no}?`} icon={<Trash2 size={20} color="var(--crit)" />} onClose={() => { if (!busy) { setDlg(null); setBlad(null) } }}
        footer={<><button className="btn" onClick={() => { setDlg(null); setBlad(null) }} data-autofocus disabled={busy}>Wróć</button>
          <button className="btn primary" style={{ background: 'var(--crit)', borderColor: 'var(--crit)' }} disabled={busy}
            onClick={() => zapisz(fresh => bezPalety(fresh, dlg.p.id), `Usunięto paletę ${dlg.p.no}`, () => setSelNo(null))}>{busy ? 'Zapisywanie…' : 'Usuń paletę'}</button></>}>
        <p>Karton <span className="code">{dlg.p.carton}</span> · {palletQty(dlg.p)} szt. · {kg(palletKg(order, dlg.p))}. Sztuki wrócą do puli „do rozpisania”.</p>
        <div className="note warn"><FlagIcon level="warn" size={15} /><div>Numer {dlg.p.no} i karton zostają zablokowane — nie zostaną nadane innej palecie (wydrukowana kartka nie wskaże innego towaru).</div></div>
        {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
      </Dialog>}
      {dlg?.t === 'auto' && <RozpisDialog order={order} wolne={wolne()} busy={busy} blad={blad} onClose={() => { setDlg(null); setBlad(null) }}
        onSave={plan => zapisz(fresh => zDodanymi(fresh, plan.map(p => ({ items: p.items }))), `Utworzono ${plan.length} ${plan.length === 1 ? 'paletę' : plan.length < 5 ? 'palety' : 'palet'}`)} lineOf={lineOf} />}
    </div>
  )
}

/** Tuleja przy pozycji — ten sam kebab z inną tuleją to inna pozycja na palecie (właściciel 31.10.2026). */
function Tuleja({ n }: { n?: string }) {
  return n ? <span className="tul" data-tip="Tuleja / opakowanie">{n}</span> : null
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
        {p.items.map(it => { const l = order.lines.find(x => x.id === it.lineId); return (
          <li key={it.lineId}><span>{l ? <>{l.recipe} {l.kgPerUnit} kg<Tuleja n={l.packaging} /></> : 'pozycja usunięta'} × {it.qty}</span><span>{l ? kg(it.qty * l.kgPerUnit) : '—'}</span></li>) })}
      </ul>
      <div className="pf">
        <PalletStatusLabel status={p.status} />
        <PalletFlow status={p.status} />
        <span className="tot">{kg(palletKg(order, p))}</span>
      </div>
    </div>
  )
}

/** Okno nowej palety / zmiany zawartości: ile sztuk z każdej pozycji, limit = to, co zostało do rozpisania. */
export function PaletaDialog({ title, order, wolne, start, busy, blad, onClose, onSave }: {
  title: string; order: Order; wolne: Record<string, number>; start?: ItemLite[]; busy: boolean; blad: string | null
  onClose: () => void; onSave: (items: ItemLite[]) => void
}) {
  const pozycje = order.lines.filter(l => (wolne[l.id] ?? 0) > 0 || start?.some(s => s.lineId === l.id))
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries((start ?? []).map(s => [s.lineId, String(s.qty)])))
  const [tried, setTried] = useState(false)
  const items = Object.entries(qty).filter(([, v]) => v.trim() !== '').map(([id, v]) => ({ lineId: id, qty: Number(v.replace(',', '.')) }))
  const niezerowe = items.filter(i => i.qty !== 0)
  const errs = bledyPalety(niezerowe, wolne)
  const total = niezerowe.reduce((a, it) => a + (Number.isFinite(it.qty) ? it.qty * (order.lines.find(l => l.id === it.lineId)?.kgPerUnit ?? 0) : 0), 0)
  const empty = niezerowe.length === 0
  const go = () => { setTried(true); if (!empty && !Object.keys(errs).length && !busy) onSave(niezerowe) }
  return (
    <Dialog title={title} icon={<Boxes size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={<><span className="left">Masa palety: <b className="num">{kg(total)}</b>{total > 1000 && <span className="warn-ink"> · ponad 1000 kg</span>}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Anuluj</button>
        <button className="btn primary" onClick={go} disabled={busy}>{busy ? 'Zapisywanie…' : start ? 'Zapisz paletę' : 'Dodaj paletę'}</button></>}>
      <p className="muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>Wpisz, ile sztuk z każdej pozycji leży na palecie. {start ? 'Numer palety i karton się nie zmieniają.' : 'Numer i karton nada serwer — nie zmieniają się później.'}</p>
      <div className="box">
        <table className="tbl">
          <thead><tr><th>Pozycja</th><th className="num">Do rozpisania</th><th className="num" style={{ width: 130 }}>Na palecie</th></tr></thead>
          <tbody>{pozycje.map((l, i) => (
            <React.Fragment key={l.id}>
              <tr className="row editing"><td><b>{l.recipe}</b> {l.kgPerUnit} kg <span className="sub">poz. {l.lp} · {l.packaging || l.product}</span></td>
                <td className="num">{wolne[l.id] ?? 0} szt.</td>
                <td className="num"><input className={`field num${tried && errs[l.id] ? ' invalid' : ''}`} inputMode="numeric" value={qty[l.id] ?? ''} placeholder="0" autoFocus={i === 0}
                  onChange={e => setQty(q => ({ ...q, [l.id]: e.target.value }))} onKeyDown={e => { if (e.key === 'Enter') go() }} aria-label={`Sztuk z pozycji ${l.lp}`} /></td></tr>
              {tried && errs[l.id] && <tr className="err-row"><td colSpan={3}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errs[l.id]}</span></td></tr>}
            </React.Fragment>))}</tbody>
        </table>
      </div>
      {tried && empty && <div className="note crit"><FlagIcon level="crit" size={15} /><div>Wpisz ilość przynajmniej dla jednej pozycji.</div></div>}
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}

/** Rozpis automatyczny pozostałych sztuk — standard pakowania biura, podgląd palet przed zapisem. */
export function RozpisDialog({ order, wolne, busy, blad, onClose, onSave, lineOf }: {
  order: Order; wolne: Record<string, number>; busy: boolean; blad: string | null
  onClose: () => void; onSave: (plan: ReturnType<typeof rozpisz>) => void; lineOf: (id: string) => Order['lines'][number] | undefined
}) {
  const wagi = useMemo(() => [...new Set(order.lines.filter(l => (wolne[l.id] ?? 0) > 0).map(l => l.kgPerUnit))].sort((a, b) => b - a), [order.lines, wolne])
  // 25 kg / 35 kg: wariant wykryty z palet już rozpisanych w zamówieniu albo z ilości (wykryjSztuki).
  const wykryte = useMemo(() => wykryjSztuki(order.lines, order.pallets), [order.lines, order.pallets])
  const [sztuk, setSztuk] = useState<Record<string, string>>(() => Object.fromEntries(wagi.map(w => [String(w), String(sztukNaPalete(w, wykryte))])))
  const [maxKg, setMaxKg] = useState(String(MAX_KG_RESZTKI))
  const [mieszane, setMieszane] = useState(true)
  const nadpisz = Object.fromEntries(Object.entries(sztuk).map(([w, v]) => [w, Math.floor(Number(v))]).filter(([, v]) => Number(v) > 0))
  const lim = Number(maxKg.replace(',', '.'))
  const ok = Number.isFinite(lim) && lim >= 100 && lim <= 1500 && wagi.every(w => Number(sztuk[String(w)]) >= 1)
  const plan = useMemo(() => ok ? rozpisz(order.lines, wolne, { nadpisz, maxKg: lim, mieszane }) : [], [order.lines, wolne, ok, lim, mieszane, JSON.stringify(nadpisz)]) // eslint-disable-line react-hooks/exhaustive-deps
  const pelnych = plan.filter(p => p.items.length === 1 && p.szt === sztukNaPalete(lineOf(p.items[0].lineId)?.kgPerUnit ?? 0, nadpisz)).length
  return (
    <Dialog wide title="Rozpis automatyczny palet" icon={<Wand2 size={20} color="var(--accent)" />} onClose={() => { if (!busy) onClose() }}
      footer={<><span className="left">{plan.length} {plan.length === 1 ? 'paleta' : plan.length < 5 ? 'palety' : 'palet'} ({pelnych} pełnych) · {num(plan.reduce((a, p) => a + p.szt, 0))} szt. · {kg(plan.reduce((a, p) => a + p.kg, 0))}</span>
        <button className="btn" onClick={onClose} disabled={busy}>Anuluj</button>
        <button className="btn primary" disabled={busy || !plan.length} onClick={() => onSave(plan)}>{busy ? 'Zapisywanie…' : `Utwórz ${plan.length} ${plan.length === 1 ? 'paletę' : plan.length < 5 ? 'palety' : 'palet'}`}</button></>}>
      <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label">Sztuk na pełną paletę</span>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{wagi.map(w => {
            const war = WARIANTY_SZTUK[w]
            return (
              <label key={w} className="chip" style={{ gap: 6, cursor: 'default' }}>
                <b>{num(w)} kg ×</b>
                {war
                  ? <select className="field" style={{ height: 26, width: 'auto', padding: '0 4px' }} value={sztuk[String(w)]} onChange={e => setSztuk(x => ({ ...x, [String(w)]: e.target.value }))} aria-label={`Sztuk na paletę, ${w} kg`}>
                      {war.map(n => <option key={n} value={n}>{n} ({num(n * w)} kg)</option>)}</select>
                  : <input className="field num" style={{ height: 26, width: 56 }} inputMode="numeric" value={sztuk[String(w)] ?? ''} onChange={e => setSztuk(x => ({ ...x, [String(w)]: e.target.value }))} aria-label={`Sztuk na paletę, ${w} kg`} />}
                {!war && <span className="muted" data-tip={STANDARD_SZTUK[w] ? 'Standard biura' : 'Waga spoza standardu — ok. 900 kg na paletę'}>{num((Number(sztuk[String(w)]) || 0) * w)} kg</span>}
                {war && <span className="muted" data-tip={order.pallets.some(p => p.items.length === 1 && order.lines.find(l => l.id === p.items[0].lineId)?.kgPerUnit === w) ? 'Wykryte z palet już rozpisanych w tym zamówieniu' : 'Wykryte z ilości w zamówieniu (wariant bez reszty)'}>auto</span>}
              </label>
            )
          })}</div>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="label">Paleta z resztek — maks.</span>
          <span><input className={`field num w-num${Number.isFinite(lim) && lim >= 100 && lim <= 1500 ? '' : ' invalid'}`} inputMode="numeric" value={maxKg} onChange={e => setMaxKg(e.target.value)} aria-label="Maksymalna masa palety z resztek w kg" /> <span className="sub">kg</span></span>
        </label>
        <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center', alignSelf: 'flex-end', height: 32 }}>
          <input type="checkbox" className="cbx" checked={mieszane} onChange={e => setMieszane(e.target.checked)} />Resztki różnych receptur razem, gdy inaczej się nie da
        </label>
      </div>
      {!ok && <div className="note crit">Sztuk na paletę: co najmniej 1; masa palety z resztek: 100–1500 kg.</div>}
      <div className="box" style={{ maxHeight: 320, overflow: 'auto' }}>
        <table className="tbl">
          <thead><tr><th>Nowa paleta</th><th>Zawartość</th><th className="num">Sztuk</th><th className="num">Masa</th><th /></tr></thead>
          <tbody>{plan.map((p, i) => {
            const pelna = p.items.length === 1 && p.szt === sztukNaPalete(lineOf(p.items[0].lineId)?.kgPerUnit ?? 0, nadpisz)
            return (
              <tr key={i} className="row"><td className="strong">{i + 1}.</td>
                <td style={{ whiteSpace: 'normal' }}>{p.items.map(it => { const l = lineOf(it.lineId); return <div key={it.lineId}><b>{l?.recipe ?? ''} {l?.kgPerUnit ?? ''} kg</b> × {it.qty}{l?.packaging ? <span className="sub" style={{ display: 'inline', marginLeft: 6 }}>{l.packaging}</span> : null}</div> })}</td>
                <td className="num">{p.szt}</td><td className="num">{kg(p.kg)}</td>
                <td>{pelna ? <span className="tag ok">pełna</span> : p.mieszana ? <span className="tag warn">mieszana</span> : <span className="tag outline">z resztek</span>}</td></tr>
            )
          })}</tbody>
        </table>
      </div>
      <div className="note info"><FlagIcon level="info" size={15} /><div>Kolejność jak w biurze: pełne palety jednej pozycji, potem resztki tej samej receptury, rodzaju i tulei, potem tej samej receptury, na końcu mieszane. Sztuka nie jest dzielona. Numery i kartony nada serwer; paletę można zmienić lub usunąć, dopóki nie zacznie się pakowanie.</div></div>
      {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Serwer odmówił:</b> {blad}</div></div>}
    </Dialog>
  )
}
