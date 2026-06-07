import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { wzApi, clientsApi } from '@/lib/api'

type Row = { stockType: 'fg' | 'raw'; stockId: string; name: string; unit: string; qty: number; price: number; batchNo?: string }

const isForeignNip = (nip: string) => {
  const s = (nip || '').trim().toUpperCase()
  return s.length >= 2 && /^[A-Z]{2}/.test(s) && s.slice(0, 2) !== 'PL'
}

export function WzNewPage() {
  const nav = useNavigate()
  const [clients, setClients] = useState<any[]>([])
  const [fg, setFg] = useState<any[]>([])
  const [raw, setRaw] = useState<any[]>([])
  const [buyer, setBuyer] = useState({ name: '', address: '', nip: '' })
  const [rows, setRows] = useState<Row[]>([])
  const [tab, setTab] = useState<'fg' | 'raw'>('fg')
  const [err, setErr] = useState('')

  useEffect(() => {
    clientsApi.list().then(setClients)
    wzApi.stockFg().then(setFg)
    wzApi.stockRaw().then(setRaw)
  }, [])

  const foreign = useMemo(() => isForeignNip(buyer.nip), [buyer.nip])
  const total = rows.reduce((s, r) => s + r.qty * r.price, 0)

  const pickClient = (id: string) => {
    const c = clients.find(x => x.id === id)
    if (c) setBuyer({ name: c.name || c.displayName || '', address: `${c.address || ''} ${c.city || ''}`.trim(), nip: c.nip || '' })
  }
  const addFg = (g: any) => setRows(r => [...r, { stockType: 'fg', stockId: g.id, name: g.recipe_name || g.product_type_name || 'Wyrób', unit: 'szt', qty: 1, price: 0, batchNo: g.batch_no }])
  const addRaw = (b: any) => setRows(r => [...r, { stockType: 'raw', stockId: b.id, name: `Surowiec ${b.internal_batch_no}`, unit: 'kg', qty: 1, price: 0, batchNo: b.internal_batch_no }])
  const upd = (i: number, k: 'qty' | 'price', v: number) => setRows(r => r.map((x, j) => j === i ? { ...x, [k]: v } : x))
  const del = (i: number) => setRows(r => r.filter((_, j) => j !== i))

  const submit = async () => {
    setErr('')
    if (!buyer.name) { setErr('Wybierz lub wpisz odbiorcę'); return }
    if (!rows.length) { setErr('Dodaj co najmniej jedną pozycję'); return }
    try {
      const doc = await wzApi.createManual({ buyer, items: rows, valued: true })
      nav(`/office/wz/${doc.id}/druk`)
    } catch (e: any) { setErr(e?.message || 'Błąd wystawiania WZ') }
  }

  return (
    <div style={{ padding: 24, maxWidth: 980 }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Nowy WZ (sprzedaż z magazynu)</h1>

      <section style={{ marginBottom: 16 }}>
        <b>Odbiorca</b>
        <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
          <select onChange={e => pickClient(e.target.value)} defaultValue="">
            <option value="">— wybierz klienta —</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name || c.displayName}</option>)}
          </select>
          <input placeholder="Nazwa" value={buyer.name} onChange={e => setBuyer({ ...buyer, name: e.target.value })} />
          <input placeholder="Adres" value={buyer.address} onChange={e => setBuyer({ ...buyer, address: e.target.value })} />
          <input placeholder="NIP" value={buyer.nip} onChange={e => setBuyer({ ...buyer, nip: e.target.value })} />
        </div>
        {foreign && <div style={{ marginTop: 6, color: '#b45309' }}>Klient zagraniczny — wymagany CMR (SP-2c) + HDI.</div>}
        {!foreign && buyer.nip && <div style={{ marginTop: 6, color: '#555' }}>Klient krajowy — wymagany WZ + HDI.</div>}
      </section>

      <section style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => setTab('fg')} style={{ fontWeight: tab === 'fg' ? 700 : 400 }}>Wyrób gotowy</button>
          <button onClick={() => setTab('raw')} style={{ fontWeight: tab === 'raw' ? 700 : 400 }}>Surowiec</button>
        </div>
        <div style={{ maxHeight: 180, overflowY: 'auto', border: '1px solid #ddd', marginTop: 6, padding: 6 }}>
          {tab === 'fg' && fg.map(g => (
            <div key={g.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 4 }}>
              <span>{g.recipe_name || g.product_type_name} · partia {g.batch_no} · {g.qty_available} szt</span>
              <button onClick={() => addFg(g)}>+ dodaj</button>
            </div>
          ))}
          {tab === 'raw' && raw.map(b => (
            <div key={b.id} style={{ display: 'flex', justifyContent: 'space-between', padding: 4 }}>
              <span>{b.internal_batch_no} · {b.supplier_name} · {b.kg_available} kg</span>
              <button onClick={() => addRaw(b)}>+ dodaj</button>
            </div>
          ))}
        </div>
      </section>

      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
        <thead><tr>{['Towar', 'Partia', 'Ilość', 'j.m.', 'Cena', 'Wartość', ''].map((h, i) => (
          <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 6 }}>{h}</th>))}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td style={{ padding: 6 }}>{r.name}</td>
              <td style={{ padding: 6 }}>{r.batchNo}</td>
              <td style={{ padding: 6 }}><input type="number" value={r.qty} min={0} style={{ width: 80 }} onChange={e => upd(i, 'qty', Number(e.target.value))} /></td>
              <td style={{ padding: 6 }}>{r.unit}</td>
              <td style={{ padding: 6 }}><input type="number" value={r.price} min={0} step="0.01" style={{ width: 90 }} onChange={e => upd(i, 'price', Number(e.target.value))} /></td>
              <td style={{ padding: 6, textAlign: 'right' }}>{(r.qty * r.price).toFixed(2)}</td>
              <td style={{ padding: 6 }}><button onClick={() => del(i)}>usuń</button></td>
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, padding: 6 }}>Razem</td><td style={{ textAlign: 'right', fontWeight: 700, padding: 6 }}>{total.toFixed(2)}</td><td /></tr></tfoot>
      </table>

      {err && <div style={{ color: '#b91c1c', marginBottom: 8 }}>{err}</div>}
      <button onClick={submit} style={{ padding: '8px 16px', fontWeight: 700 }}>Wystaw WZ (rozchód ze stanu)</button>
    </div>
  )
}
