import { CSSProperties, useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { wzApi, WzDoc } from '@/lib/api'

const td: CSSProperties = { border: '1px solid #9a9a9a', padding: 6 }

export function WzPrintPage() {
  const { id = '' } = useParams()
  const [sp] = useSearchParams()
  const isPdf = sp.get('pdf') === '1'
  const [doc, setDoc] = useState<WzDoc | null>(null)

  useEffect(() => { wzApi.byId(id).then(setDoc) }, [id])
  useEffect(() => { if (doc && !isPdf) setTimeout(() => window.print(), 300) }, [doc, isPdf])

  if (!doc) return <div style={{ padding: 24 }}>Ładowanie…</div>
  const fmt = (n: number | null | undefined) => (n ?? 0).toFixed(2)
  const head = ['Lp', 'Nazwa towaru', 'Ilość', 'j.m.', ...(doc.valued ? ['Cena jedn.', 'Wartość'] : [])]

  return (
    <div className="wz" style={{ width: 794, margin: '0 auto', padding: 32, fontFamily: 'Arial, sans-serif', color: '#111', fontSize: 13 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>WZ — Wydanie zewnętrzne</h1>
        <div style={{ textAlign: 'right' }}>
          <div><b>Nr:</b> {doc.number}</div>
          <div>{doc.place}{doc.place ? ', ' : ''}{doc.issued_date}</div>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
        <div style={{ flex: 1, border: '1px solid #9a9a9a', padding: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Sprzedający / Wystawca</div>
          <div>{doc.seller?.name}</div>
          <div>{doc.seller?.address}</div>
          {doc.seller?.nip && <div>NIP: {doc.seller.nip}</div>}
        </div>
        <div style={{ flex: 1, border: '1px solid #9a9a9a', padding: 8 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Odbiorca / Nabywca</div>
          <div>{doc.buyer_name}</div>
          <div>{doc.buyer_address}</div>
          {doc.buyer_nip && <div>NIP: {doc.buyer_nip}</div>}
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16 }}>
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} style={{ border: '1px solid #9a9a9a', padding: 6, background: '#f0f0f0', fontSize: 12 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {doc.lines.map((l, i) => (
            <tr key={i}>
              <td style={td}>{i + 1}</td>
              <td style={td}>{l.name}{l.batch_no ? ` (partia ${l.batch_no})` : ''}</td>
              <td style={{ ...td, textAlign: 'right' }}>{l.qty}</td>
              <td style={td}>{l.unit}</td>
              {doc.valued && <td style={{ ...td, textAlign: 'right' }}>{fmt(l.price)}</td>}
              {doc.valued && <td style={{ ...td, textAlign: 'right' }}>{fmt(l.value)}</td>}
            </tr>
          ))}
        </tbody>
        {doc.valued && (
          <tfoot>
            <tr>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }} colSpan={5}>Razem</td>
              <td style={{ ...td, textAlign: 'right', fontWeight: 700 }}>{fmt(doc.total_value)}</td>
            </tr>
          </tfoot>
        )}
      </table>
      <div style={{ marginTop: 24 }}>Data wydania: {doc.release_date}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 56 }}>
        <div style={{ borderTop: '1px solid #111', width: 220, textAlign: 'center', paddingTop: 4 }}>Wydał</div>
        <div style={{ borderTop: '1px solid #111', width: 220, textAlign: 'center', paddingTop: 4 }}>Odebrał</div>
      </div>
    </div>
  )
}
