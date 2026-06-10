import { Fragment, useEffect, useState } from 'react'
import { wzApi, WzDoc, WzLine } from '@/lib/api'

export function WzDocumentsPage() {
  const [docs, setDocs] = useState<WzDoc[]>([])
  const [editId, setEditId] = useState<string | null>(null)
  const [editLines, setEditLines] = useState<WzLine[]>([])
  const [editErr, setEditErr] = useState('')
  const [saving, setSaving] = useState(false)

  const reload = () => wzApi.list().then(setDocs)
  useEffect(() => { reload() }, [])

  const openEditor = async (id: string) => {
    setEditErr('')
    try {
      const doc = await wzApi.byId(id)
      setEditLines(doc.lines || [])
      setEditId(id)
    } catch (e: any) { alert(e?.message || 'Błąd pobierania WZ') }
  }
  const setPrice = (i: number, v: number) =>
    setEditLines(ls => ls.map((l, j) => j === i ? { ...l, price: v } : l))
  const editTotal = editLines.reduce((s, l) => s + l.qty * (l.price ?? 0), 0)

  const savePrices = async () => {
    if (!editId) return
    setEditErr(''); setSaving(true)
    try {
      const prices = editLines.map((l, index) => ({ index, price: l.price ?? 0 }))
      await wzApi.updatePrices(editId, prices)
      setEditId(null)
      await reload()
    } catch (e: any) { setEditErr(e?.message || 'Błąd zapisu cen') }
    finally { setSaving(false) }
  }

  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Dokumenty WZ</h1>
      <a href="/office/wz/nowy" style={{ display: 'inline-block', marginBottom: 12, padding: '6px 12px', background: '#111', color: '#fff', borderRadius: 4, textDecoration: 'none' }}>+ Nowy WZ</a>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['Numer', 'Data', 'Odbiorca', 'Wartość', 'Status', ''].map((h, i) => (
            <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {docs.map(d => (
            <Fragment key={d.id}>
              <tr>
                <td style={{ padding: 8 }}>{d.number}</td>
                <td style={{ padding: 8 }}>{d.issued_date}</td>
                <td style={{ padding: 8 }}>{d.buyer_name}</td>
                <td style={{ padding: 8, textAlign: 'right' }}>{d.valued ? (d.total_value ?? 0).toFixed(2) : '—'}</td>
                <td style={{ padding: 8 }}>{d.status}</td>
                <td style={{ padding: 8 }}>
                  <a href={`/office/wz/${d.id}/druk`} target="_blank" rel="noreferrer">Drukuj</a>
                  {' · '}
                  <a href={wzApi.pdfUrl(d.id)} target="_blank" rel="noreferrer">PDF</a>
                  {!d.valued && d.status === 'wstepny' && (
                    <>
                      {' · '}
                      <button onClick={() => editId === d.id ? setEditId(null) : openEditor(d.id)}
                              style={{ color: '#b45309', background: 'none', border: 'none', cursor: 'pointer', padding: 0, font: 'inherit', textDecoration: 'underline' }}>
                        {editId === d.id ? 'Zwiń' : 'Uzupełnij ceny'}
                      </button>
                    </>
                  )}
                </td>
              </tr>
              {editId === d.id && (
                <tr>
                  <td colSpan={6} style={{ padding: 8, background: '#fafafa', borderBottom: '1px solid #ddd' }}>
                    <table style={{ borderCollapse: 'collapse', minWidth: 560 }}>
                      <thead><tr>{['Towar', 'Partia', 'Ilość', 'j.m.', 'Cena', 'Wartość'].map((h, i) => (
                        <th key={i} style={{ textAlign: 'left', padding: 4, borderBottom: '1px solid #ddd' }}>{h}</th>))}</tr></thead>
                      <tbody>
                        {editLines.map((l, i) => (
                          <tr key={i}>
                            <td style={{ padding: 4 }}>{l.name}</td>
                            <td style={{ padding: 4 }}>{l.batch_no}</td>
                            <td style={{ padding: 4 }}>{l.qty}</td>
                            <td style={{ padding: 4 }}>{l.unit}</td>
                            <td style={{ padding: 4 }}>
                              <input type="number" min={0} step="0.01" value={l.price ?? ''} style={{ width: 90 }}
                                     onChange={e => setPrice(i, Number(e.target.value))} />
                            </td>
                            <td style={{ padding: 4, textAlign: 'right' }}>{(l.qty * (l.price ?? 0)).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr>
                        <td colSpan={5} style={{ textAlign: 'right', fontWeight: 700, padding: 4 }}>Razem</td>
                        <td style={{ textAlign: 'right', fontWeight: 700, padding: 4 }}>{editTotal.toFixed(2)}</td>
                      </tr></tfoot>
                    </table>
                    {editErr && <div style={{ color: '#b91c1c', marginTop: 6 }}>{editErr}</div>}
                    <button onClick={savePrices} disabled={saving}
                            style={{ marginTop: 8, padding: '6px 12px', fontWeight: 700 }}>
                      {saving ? 'Zapisywanie…' : 'Zapisz ceny'}
                    </button>
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
