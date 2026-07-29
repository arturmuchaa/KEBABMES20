/**
 * ContainerStatementPrintPage — potwierdzenie salda nośników za okres.
 *
 * A4 PIONOWO (nie poziomo jak dokument wydania): to zestawienie ruchów,
 * a pion mieści dwa razy więcej wierszy. Układ: saldo otwarcia → ruchy
 * z saldem narastająco → saldo zamknięcia → miejsce na podpisy obu stron.
 *
 * /office/pojemniki/raport/druk?partnerId=&from=&to= — auto-print (?pdf=1 wyłącza).
 */
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { containersApi, type ContainerStatement } from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES } from '@/lib/containers'

function fmtD(iso: string): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

const S = {
  page: {
    padding: '10mm 12mm', background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 10.5,
  },
  h1: { fontSize: 15, fontWeight: 800, margin: 0 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 10 },
  th: {
    border: '1px solid #999', background: '#efefef', padding: '2px 5px',
    fontWeight: 700, fontSize: 9.5,
  },
  td: { border: '1px solid #bbb', padding: '2px 5px' },
  num: {
    border: '1px solid #bbb', padding: '2px 5px', textAlign: 'right' as const,
    fontVariantNumeric: 'tabular-nums' as const,
  },
  sum: { border: '1px solid #999', padding: '3px 5px', fontWeight: 800, background: '#f6f6f6' },
}

export function ContainerStatementPrintPage() {
  const [params] = useSearchParams()
  const partnerId = params.get('partnerId') || ''
  const from = params.get('from') || ''
  const to = params.get('to') || ''
  const [st, setSt] = useState<ContainerStatement | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!partnerId) { setErr('Brak wskazanego kontrahenta'); return }
    containersApi.statement(partnerId, from, to)
      .then(setSt).catch(e => setErr(String(e?.message || e)))
  }, [partnerId, from, to])

  useEffect(() => {
    if (st && params.get('pdf') !== '1') setTimeout(() => window.print(), 300)
  }, [st, params])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!st) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  return (
    <div style={S.page}>
      <style>{`
        @page { size: A4 portrait; margin: 0; }
        html, body { margin: 0; padding: 0; background: #fff; }
        tr { break-inside: avoid; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <img src="/logo-ksiezyc-print.png" alt="" style={{ height: '10mm' }} />
        <div style={{ flex: 1 }}>
          <h1 style={S.h1}>Potwierdzenie salda pojemników i palet</h1>
          <div style={{ fontSize: 10 }}>
            Okres: <b>{fmtD(st.from)} – {fmtD(st.to)}</b>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10 }}>
          <div style={{ fontWeight: 700, fontSize: 11 }}>{st.partner.name}</div>
          <div>{st.partner.address}</div>
          <div>{st.partner.nip ? `NIP ${st.partner.nip}` : ''}</div>
        </div>
      </div>

      <table style={{ ...S.table, marginTop: 8 }}>
        <thead>
          <tr>
            <th style={{ ...S.th, width: '18mm' }}>Data</th>
            <th style={S.th}>Źródło</th>
            <th style={{ ...S.th, width: '24mm' }}>Dokument</th>
            <th style={{ ...S.th, width: '22mm' }}>Nośnik</th>
            <th style={{ ...S.th, width: '16mm' }}>Zmiana</th>
            <th style={{ ...S.th, width: '18mm' }}>Saldo</th>
          </tr>
        </thead>
        <tbody>
          {ASSET_TYPES.map(a => (
            <tr key={`open-${a}`}>
              <td style={S.sum} colSpan={4}>Saldo otwarcia — {ASSET_SHORT[a]}</td>
              <td style={S.sum} />
              <td style={{ ...S.sum, textAlign: 'right' }}>{st.opening[a]}</td>
            </tr>
          ))}
          {st.movements.map(m => (
            <tr key={m.id}>
              <td style={S.td}>{fmtD(m.movementDate)}</td>
              <td style={S.td}>{m.sourceLabel}{m.note ? ` — ${m.note}` : ''}</td>
              <td style={S.td}>{m.docNumber || '—'}</td>
              <td style={S.td}>{ASSET_SHORT[m.assetType]}</td>
              <td style={S.num}>{m.qty > 0 ? `+${m.qty}` : m.qty}</td>
              <td style={S.num}>{m.balanceAfter[m.assetType]}</td>
            </tr>
          ))}
          {st.movements.length === 0 && (
            <tr><td style={S.td} colSpan={6}>Brak ruchów w wybranym okresie.</td></tr>
          )}
          {ASSET_TYPES.map(a => (
            <tr key={`close-${a}`}>
              <td style={S.sum} colSpan={4}>Saldo zamknięcia — {ASSET_SHORT[a]}</td>
              <td style={S.sum} />
              <td style={{ ...S.sum, textAlign: 'right' }}>{st.closing[a]}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ fontSize: 9, marginTop: 6, color: '#555' }}>
        Saldo dodatnie — nośniki kontrahenta znajdują się u wystawcy.
        Saldo ujemne — nośniki wystawcy znajdują się u kontrahenta.
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: '18mm' }}>
        {['Podpis wystawcy', 'Podpis kontrahenta'].map(t => (
          <div key={t} style={{ flex: 1, borderTop: '1px solid #111', paddingTop: 3, fontSize: 9 }}>
            {t}
          </div>
        ))}
      </div>
    </div>
  )
}
