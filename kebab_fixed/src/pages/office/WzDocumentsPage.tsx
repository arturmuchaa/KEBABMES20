import { useEffect, useState } from 'react'
import { wzApi, WzDoc } from '@/lib/api'

export function WzDocumentsPage() {
  const [docs, setDocs] = useState<WzDoc[]>([])
  useEffect(() => { wzApi.list().then(setDocs) }, [])
  return (
    <div style={{ padding: 24 }}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Dokumenty WZ</h1>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>{['Numer', 'Data', 'Odbiorca', 'Wartość', 'Status', ''].map((h, i) => (
            <th key={i} style={{ textAlign: 'left', borderBottom: '1px solid #ddd', padding: 8 }}>{h}</th>))}
          </tr>
        </thead>
        <tbody>
          {docs.map(d => (
            <tr key={d.id}>
              <td style={{ padding: 8 }}>{d.number}</td>
              <td style={{ padding: 8 }}>{d.issued_date}</td>
              <td style={{ padding: 8 }}>{d.buyer_name}</td>
              <td style={{ padding: 8, textAlign: 'right' }}>{d.valued ? (d.total_value ?? 0).toFixed(2) : '—'}</td>
              <td style={{ padding: 8 }}>{d.status}</td>
              <td style={{ padding: 8 }}>
                <a href={`/office/wz/${d.id}/druk`} target="_blank" rel="noreferrer">Drukuj</a>
                {' · '}
                <a href={wzApi.pdfUrl(d.id)} target="_blank" rel="noreferrer">PDF</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
