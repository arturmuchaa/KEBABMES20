import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Trash2, Save, CheckCheck, X } from 'lucide-react'
import { useApp, CommandBar, type Cmd } from '../../shell/context'
import { useOrders } from '../../data/store'
import { CLIENTS } from '../../data/demo'
import { kg, num, TODAY, MEAT_PER_100, type Order } from '../../data/model'
import { FlagIcon } from '../../ui/Glyphs'

const PRODUCTS = ['Kebab udo 100%', 'Kebab mix 95/5', 'Kebab drobiowo-wołowy 70/30']
const RECIPES = ['KIRMIZI', 'BEYAZ', 'WROCŁAW', 'GOLD', 'BERLIN', 'YAPRAK']
const WEIGHTS = [10, 15, 20, 25, 30, 40]
const packFor = (k: number) => k <= 10 ? 'Tuleja 30 cm' : k >= 30 ? 'Tuleja metal 80 cm' : 'Tuleja metal 65 cm'
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

interface DraftLine { k: number; product: string; recipe: string; kgu: number; qty: string }
let seq = 426

/**
 * Formularz zamówienia: najpierw nagłówek (kto, kiedy), potem siatka pozycji
 * obsługiwana z klawiatury. Enter w polu ilości ostatniego wiersza dodaje nowy wiersz.
 */
export function NewOrder({ tabId, onDone, setCmds }: { tabId: string; onDone: (id?: string) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const { add } = useOrders()
  const [clientId, setClientId] = useState('')
  const [orderDate, setOrderDate] = useState(iso(TODAY))
  const [delivery, setDelivery] = useState('')
  const [time, setTime] = useState('07:00')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ k: 1, product: PRODUCTS[0], recipe: 'KIRMIZI', kgu: 15, qty: '' }])
  const [tried, setTried] = useState<null | 'draft' | 'confirm'>(null)
  const kseq = useRef(1)
  const client = CLIENTS.find(c => c.id === clientId)

  const addRef = useRef<() => void>(() => undefined)
  const set = (k: number, patch: Partial<DraftLine>) => setLines(ls => ls.map(l => l.k === k ? { ...l, ...patch } : l))
  const addLine = () => {
    kseq.current += 1
    const last = lines[lines.length - 1]
    setLines(ls => [...ls, { k: kseq.current, product: last?.product ?? PRODUCTS[0], recipe: last?.recipe ?? 'KIRMIZI', kgu: last?.kgu ?? 15, qty: '' }])
    requestAnimationFrame(() => document.getElementById(`${tabId}-qty-${kseq.current}`)?.focus())
  }

  addRef.current = addLine
  const valid = lines.map(l => ({ ...l, n: Number(l.qty) })).filter(l => l.qty.trim() !== '')
  const totalQty = valid.reduce((a, l) => a + (Number.isFinite(l.n) ? l.n : 0), 0)
  const totalKg = valid.reduce((a, l) => a + (Number.isFinite(l.n) ? l.n * l.kgu : 0), 0)
  const meat = useMemo(() => {
    const m = new Map<string, number>()
    valid.forEach(l => { if (Number.isFinite(l.n)) m.set(l.recipe, (m.get(l.recipe) ?? 0) + l.n * l.kgu) })
    return [...m.entries()].map(([r, k]) => ({ r, meat: Math.ceil(k * (MEAT_PER_100[r] ?? 88) / 100) }))
  }, [valid])

  const errors: Record<string, string> = {}
  if (tried) {
    if (!clientId) errors.client = 'Wybierz kontrahenta.'
    if (tried === 'confirm' && !delivery) errors.delivery = 'Termin dostawy jest wymagany do potwierdzenia.'
    if (delivery && delivery < orderDate) errors.delivery = 'Termin dostawy nie może być wcześniejszy niż data zamówienia.'
    lines.forEach(l => {
      if (l.qty.trim() === '' && lines.length > 1) return
      if (!/^\d+$/.test(l.qty.trim()) || Number(l.qty) <= 0) errors[`q${l.k}`] = 'Wpisz liczbę sztuk większą od zera.'
    })
    if (!valid.length && !errors[`q${lines[0]?.k}`]) errors.lines = 'Dodaj przynajmniej jedną pozycję.'
  }
  const errCount = Object.keys(errors).length

  const save = (mode: 'draft' | 'confirm') => {
    setTried(mode)
    const e: string[] = []
    if (!clientId) e.push('client')
    if (mode === 'confirm' && !delivery) e.push('delivery')
    if (delivery && delivery < orderDate) e.push('delivery')
    const good = lines.filter(l => /^\d+$/.test(l.qty.trim()) && Number(l.qty) > 0)
    if (!good.length || lines.some(l => l.qty.trim() !== '' && !(/^\d+$/.test(l.qty.trim()) && Number(l.qty) > 0))) e.push('lines')
    if (e.length) return
    seq += 1
    const id = `n${seq}`
    const [y, mo, d] = orderDate.split('-').map(Number)
    const dd = delivery ? delivery.split('-').map(Number) : null
    const o: Order = {
      id, no: `ZAM-2026-0${seq}`, client: client!, orderDate: new Date(y, mo - 1, d), delivery: dd ? new Date(dd[0], dd[1] - 1, dd[2]) : undefined, deliveryTime: delivery ? time : undefined,
      status: mode === 'confirm' ? 'confirmed' : 'draft', source: 'Ręcznie', createdBy: 'Anna Nowak', notes: notes || undefined,
      lines: good.map((l, i) => ({ id: `${id}-l${i}`, lp: i + 1, product: l.product, recipe: l.recipe, kgPerUnit: l.kgu, packaging: packFor(l.kgu), qty: Number(l.qty), planned: 0, produced: 0, stock: 0, delivered: 0 })),
      pallets: [], retiredPalletNos: [],
      history: [{ at: '29.10 10:42', who: 'Anna Nowak', text: `Utworzono${mode === 'confirm' ? ' i potwierdzono' : ' szkic'}: ${good.length} poz., ${num(totalKg)} kg`, kind: 'create' }],
      docs: [
        { kind: 'ZAM', state: 'available', note: 'Potwierdzenie dla klienta' },
        { kind: 'KOMP', state: mode === 'confirm' ? 'available' : 'blocked', note: mode === 'confirm' ? 'Wewnętrzna, z podziałem na palety' : 'Dostępna po potwierdzeniu zamówienia' },
        { kind: 'PAL', state: 'todo', note: 'Najpierw rozpisz palety' },
        { kind: 'WZ', state: 'blocked', note: `Brakuje ${num(totalKg)} kg wyrobu` },
        client!.country !== 'PL' ? { kind: 'CMR', state: 'blocked', note: `Wymagany — kraj odbiorcy: ${client!.country}` } : { kind: 'CMR', state: 'not_required', note: 'Dostawa krajowa' },
        { kind: 'HDI', state: mode === 'confirm' ? 'available' : 'blocked', note: mode === 'confirm' ? 'Nie wszystko wyprodukowano — HDI zostanie wystawione na stan faktyczny' : 'Dostępne po potwierdzeniu' },
      ],
    }
    add(o)
    app.toast({ title: `Zapisano ${o.no}`, detail: `${mode === 'confirm' ? 'Potwierdzone' : 'Szkic'} · ${num(totalKg)} kg · tylko w tej sesji demo.` })
    onDone(id)
  }

  const saveRef = useRef(save)
  saveRef.current = save
  const cmds = useMemo<Cmd[]>(() => [
    { id: 'confirm-save', group: 1, label: 'Zapisz i potwierdź', icon: <CheckCheck size={17} />, primary: true, run: () => saveRef.current('confirm') },
    { id: 'draft-save', group: 1, label: 'Zapisz szkic', icon: <Save size={17} />, run: () => saveRef.current('draft') },
    { id: 'add-line', group: 2, label: 'Dodaj pozycję', icon: <Plus size={17} />, run: () => addRef.current() },
    { id: 'discard', group: 3, label: 'Odrzuć', icon: <X size={17} />, run: () => onDone() },
  ], [onDone])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])

  return (
    <>
      <CommandBar title="Nowe zamówienie" count="niezapisane · numer nada system" cmds={cmds} />
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <div className="dock-pad" style={{ maxWidth: 1240 }}>
          {errCount > 0 && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Popraw {errCount} {errCount === 1 ? 'pole' : 'pola'}, aby zapisać.</b> Błędne pola są oznaczone na czerwono.</div></div>}
          <div className="ov-grid" style={{ gridTemplateColumns: 'minmax(0, 1.2fr) minmax(0, 1fr)' }}>
            <div className="box ov-card">
              <h4>Kontrahent i termin</h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 120px', gap: '10px 12px' }}>
                <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Kontrahent</span>
                  <select id={`${tabId}-client`} className={`field${errors.client ? ' invalid' : ''}`} value={clientId} onChange={e => setClientId(e.target.value)} autoFocus>
                    <option value="">Wybierz kontrahenta…</option>
                    {CLIENTS.map(c => <option key={c.id} value={c.id}>{c.name} — {c.city}, {c.country}</option>)}
                  </select>
                  {errors.client && <span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{errors.client}</span>}
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Data zamówienia</span>
                  <input id={`${tabId}-od`} type="date" className="field" value={orderDate} onChange={e => setOrderDate(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Termin dostawy</span>
                  <input id={`${tabId}-dd`} type="date" className={`field${errors.delivery ? ' invalid' : ''}`} value={delivery} min={orderDate} onChange={e => setDelivery(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Godzina</span>
                  <input id={`${tabId}-tm`} type="time" className="field" value={time} onChange={e => setTime(e.target.value)} />
                </label>
                {errors.delivery && <span className="crit-ink" style={{ gridColumn: '1 / -1', fontSize: 'var(--fs-sm)', marginTop: -4 }}>{errors.delivery}</span>}
                <label style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="label">Uwagi dla produkcji i magazynu</span>
                  <textarea id={`${tabId}-notes`} className="field" style={{ height: 60, padding: '7px 10px', resize: 'vertical' }} value={notes} onChange={e => setNotes(e.target.value)} placeholder="np. awizacja, etykiety w języku klienta" />
                </label>
              </div>
            </div>
            <div className="box ov-card">
              <h4>Podsumowanie</h4>
              {client ? (
                <dl className="kv">
                  <dt>Adres dostawy</dt><dd>{client.address}</dd>
                  <dt>NIP / VAT</dt><dd className="num">{client.nip}</dd>
                  <dt>Płatność</dt><dd>{client.terms}</dd>
                  <dt>Dokumenty</dt><dd>WZ{client.country !== 'PL' ? ', CMR (dostawa do ' + client.country + ')' : ''}, HDI</dd>
                </dl>
              ) : <p className="muted">Po wybraniu kontrahenta pojawią się adres dostawy, warunki płatności i wymagane dokumenty.</p>}
              <div className="req-sum" style={{ borderTop: '1px solid var(--line-soft)', paddingTop: 10 }}>
                <div className="f"><span className="k">Pozycje</span><span className="v">{valid.length}</span></div>
                <div className="f"><span className="k">Sztuki</span><span className="v">{num(totalQty)}</span></div>
                <div className="f"><span className="k">Masa</span><span className="v">{kg(totalKg)}</span></div>
                <div className="f"><span className="k">Palety (ok.)</span><span className="v">{totalKg ? Math.ceil(totalKg / 640) : 0}</span></div>
              </div>
              {meat.length > 0 && <p className="muted" style={{ fontSize: 'var(--fs-sm)' }}>Mięso do masowania: {meat.map(m => `${m.r} ${kg(m.meat)}`).join(' · ')}</p>}
            </div>
          </div>

          <div className="sect-h"><h3>Pozycje</h3><span className="sub">Tab przechodzi między polami · Enter w ilości ostatniego wiersza dodaje wiersz</span>
            <div className="tools"><button className="btn sm" onClick={addLine}><Plus size={15} />Dodaj pozycję</button></div></div>
          <div className="box">
            <table className="tbl">
              <thead><tr><th className="num" style={{ width: 44 }}>Lp.</th><th>Wyrób</th><th>Receptura</th><th>Gramatura</th><th className="hide-s">Opakowanie</th><th className="num">Ilość</th><th className="num">Masa</th><th style={{ width: 44 }} /></tr></thead>
              <tbody>
                {lines.map((l, i) => {
                  const err = errors[`q${l.k}`]
                  return (
                    <React.Fragment key={l.k}>
                      <tr className="row editing">
                        <td className="num muted">{i + 1}</td>
                        <td><select id={`${tabId}-p-${l.k}`} className="field" style={{ width: '100%' }} value={l.product} onChange={e => set(l.k, { product: e.target.value })} aria-label={`Wyrób, pozycja ${i + 1}`}>{PRODUCTS.map(p => <option key={p}>{p}</option>)}</select></td>
                        <td><select id={`${tabId}-r-${l.k}`} className="field" style={{ minWidth: 130 }} value={l.recipe} onChange={e => set(l.k, { recipe: e.target.value })} aria-label={`Receptura, pozycja ${i + 1}`}>{RECIPES.map(r => <option key={r}>{r}</option>)}</select></td>
                        <td><select id={`${tabId}-g-${l.k}`} className="field" value={l.kgu} onChange={e => set(l.k, { kgu: Number(e.target.value) })} aria-label={`Gramatura, pozycja ${i + 1}`}>{WEIGHTS.map(w => <option key={w} value={w}>{w} kg</option>)}</select></td>
                        <td className="hide-s muted">{packFor(l.kgu)}</td>
                        <td className="num"><input id={`${tabId}-qty-${l.k}`} className={`field num${err ? ' invalid' : ''}`} inputMode="numeric" placeholder="0" value={l.qty}
                          onChange={e => set(l.k, { qty: e.target.value })} aria-label={`Ilość sztuk, pozycja ${i + 1}`} aria-invalid={!!err}
                          onKeyDown={e => { if (e.key === 'Enter' && i === lines.length - 1) { e.preventDefault(); addLine() } }} /> <span className="sub">szt.</span></td>
                        <td className="num">{/^\d+$/.test(l.qty) ? kg(Number(l.qty) * l.kgu) : <span className="faint">—</span>}</td>
                        <td><button className="btn ghost icon sm" style={{ width: 28 }} disabled={lines.length === 1} onClick={() => setLines(ls => ls.filter(x => x.k !== l.k))} aria-label={`Usuń pozycję ${i + 1}`}><Trash2 size={15} /></button></td>
                      </tr>
                      {err && <tr className="err-row"><td /><td colSpan={7}><span className="crit-ink" style={{ fontSize: 'var(--fs-sm)' }}>{err}</span></td></tr>}
                    </React.Fragment>
                  )
                })}
              </tbody>
              <tfoot><tr><td /><td colSpan={3}>Razem</td><td className="hide-s" /><td className="num">{num(totalQty)} <span className="sub">szt.</span></td><td className="num">{kg(totalKg)}</td><td /></tr></tfoot>
            </table>
          </div>
          {errors.lines && <div className="note crit"><FlagIcon level="crit" size={15} /><div>{errors.lines}</div></div>}
          <div className="note"><FlagIcon level="info" size={15} /><div>Formularz demonstruje układ i walidację. Zapis tworzy zamówienie tylko w tej sesji przeglądarki — nie trafia do KEBABMES20.</div></div>
        </div>
      </div>
    </>
  )
}
