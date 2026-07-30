/**
 * ContainerStatementPrintPage — potwierdzenie salda nośników za okres.
 *
 * Dokument idzie DO KONTRAHENTA, więc czyta się go jak wyciąg bankowy:
 * jeden wiersz = jeden dzień, a nie jeden ruch. Dostawa rozbita na dwie
 * partie (jedna ciężarówka Koko → partie 444 i 445) scala się w jedną
 * linię: 667 poj. przyjęto, 667 wydano, saldo 0.
 *
 * Kolumny pokazujemy TYLKO dla nośników, które faktycznie się ruszały —
 * puste rubryki „palet innych" zaśmiecały zestawienie.
 *
 * Kierunek jest neutralny i działa w obie strony: „Przyjęto" to nośniki,
 * które przyjechały do nas (dostawa od dostawcy albo zwrot od odbiorcy),
 * „Wydano" to te, które od nas wyjechały.
 *
 * /office/pojemniki/raport/druk?partnerId=&from=&to= — auto-print (?pdf=1 wyłącza).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { containersApi, type ContainerAsset, type ContainerStatement } from '@/lib/api'
import { ASSET_SHORT, ASSET_TYPES } from '@/lib/containers'

function fmtD(iso: string): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

const S = {
  page: {
    padding: '10mm 12mm', background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 11,
  } as const,
  h1: { fontSize: 16, fontWeight: 800, margin: 0 } as const,
  table: {
    width: '100%', borderCollapse: 'collapse' as const, fontSize: 10.5,
    tableLayout: 'fixed' as const,
  } as const,
  th: {
    border: '1px solid #bfbfbf', background: '#efefef', padding: '3px 5px',
    fontSize: 9, textTransform: 'uppercase' as const, fontWeight: 700,
    textAlign: 'center' as const,
  } as const,
  td: { border: '1px solid #bfbfbf', padding: '3px 5px', textAlign: 'center' as const,
        fontVariantNumeric: 'tabular-nums' as const } as const,
  tdL: { border: '1px solid #bfbfbf', padding: '3px 6px', textAlign: 'left' as const,
         lineHeight: 1.3 } as const,
  sum: {
    border: '1px solid #999', padding: '4px 6px', fontWeight: 800,
    background: '#f4f4f4', textAlign: 'center' as const,
    fontVariantNumeric: 'tabular-nums' as const,
  } as const,
  sumL: {
    border: '1px solid #999', padding: '4px 6px', fontWeight: 800,
    background: '#f4f4f4', textAlign: 'left' as const,
  } as const,
}

/** Jeden wiersz zestawienia = jeden dzień. */
interface DayRow {
  date: string
  labels: string[]
  refs: string[]
  in: Record<ContainerAsset, number>
  out: Record<ContainerAsset, number>
  balance: Record<ContainerAsset, number>
}

/** „Przyjęcie 444, Przyjęcie 445" → „Przyjęcie 444, 445".
 *  Dwie partie tej samej dostawy nie mają powtarzać słowa w kółko —
 *  kolumna łamała się wtedy na cztery linie. */
function collapseLabels(labels: string[]): string {
  if (labels.length < 2) return labels.join(', ') || '—'
  const firstWord = (t: string) => t.split(' ')[0]
  const head = firstWord(labels[0])
  if (!labels.every(l => firstWord(l) === head)) return labels.join(', ')
  const rest = labels.map(l => l.slice(head.length).trim()).filter(Boolean)
  return rest.length ? `${head} ${rest.join(', ')}` : head
}

const zero = () =>
  Object.fromEntries(ASSET_TYPES.map(a => [a, 0])) as Record<ContainerAsset, number>

/** Grupuje ruchy po dacie i liczy saldo narastająco. */
function buildRows(st: ContainerStatement): DayRow[] {
  const byDate = new Map<string, DayRow>()
  for (const m of st.movements) {
    let row = byDate.get(m.movementDate)
    if (!row) {
      row = { date: m.movementDate, labels: [], refs: [], in: zero(), out: zero(), balance: zero() }
      byDate.set(m.movementDate, row)
    }
    if (m.qty > 0) row.in[m.assetType] += m.qty
    else row.out[m.assetType] += -m.qty
    // Opis: nazwa dokumentu jeśli jest, inaczej typ źródła. Bez powtórek —
    // dwie partie tej samej dostawy dają jeden wpis, nie dwa.
    const label = m.docNumber || m.note || m.sourceLabel
    if (label && !row.labels.includes(label)) row.labels.push(label)
    if (m.partnerRef && !row.refs.includes(m.partnerRef)) row.refs.push(m.partnerRef)
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
  const running = { ...st.opening }
  for (const r of rows) {
    for (const a of ASSET_TYPES) running[a] += r.in[a] - r.out[a]
    r.balance = { ...running }
  }
  return rows
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

  const rows = useMemo(() => (st ? buildRows(st) : []), [st])

  // Nośnik trafia do tabeli tylko wtedy, gdy się ruszał albo wisiał na
  // saldzie otwarcia — puste rubryki utrudniały czytanie kontrahentowi.
  const assets = useMemo(() => ASSET_TYPES.filter(a =>
    (st?.opening[a] ?? 0) !== 0 || (st?.closing[a] ?? 0) !== 0 ||
    rows.some(r => r.in[a] || r.out[a])), [st, rows])

  if (err) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Błąd: {err}</div>
  if (!st) return <div style={{ padding: 24, fontFamily: 'Arial' }}>Ładowanie…</div>

  const cols = assets.length
  const colW = cols <= 2 ? '17mm' : cols === 3 ? '13mm' : '11mm'
  const num = (v: number) => (v ? String(v) : '—')

  return (
    <div style={S.page}>
      <style>{`
        @page { size: A4 portrait; margin: 8mm; }
        html, body { margin: 0; padding: 0; background: #fff; }
        tr { break-inside: avoid; }
      `}</style>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
        <img src="/logo-ksiezyc-znak.png" alt="" style={{ height: '9mm' }} />
        <div style={{ flex: 1 }}>
          <h1 style={S.h1}>Potwierdzenie salda pojemników i palet</h1>
          <div style={{ fontSize: 10.5 }}>
            Okres: <b>{fmtD(st.from)} – {fmtD(st.to)}</b>
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 10.5 }}>
          <div style={{ fontWeight: 700, fontSize: 12 }}>{st.partner.name}</div>
          <div>{st.partner.address}</div>
          <div>{st.partner.nip ? `NIP ${st.partner.nip}` : ''}</div>
        </div>
      </div>

      {assets.length === 0 ? (
        <div style={{ marginTop: 14, fontSize: 11.5 }}>
          W tym okresie nie było żadnego ruchu nośników, a saldo pozostaje zerowe.
        </div>
      ) : (
        <table style={{ ...S.table, marginTop: 10 }}>
          <colgroup>
            <col style={{ width: '18mm' }} />
            <col />
            <col style={{ width: '34mm' }} />
            {/* Rodzajów bywa więcej niż dwa (siatka E1, europaleta…), więc
                kolumny zwężają się, gdy zestawienie ich potrzebuje. */}
            {assets.map(a => <col key={`i${a}`} style={{ width: colW }} />)}
            {assets.map(a => <col key={`o${a}`} style={{ width: colW }} />)}
            {assets.map(a => <col key={`b${a}`} style={{ width: colW }} />)}
          </colgroup>
          <thead>
            <tr>
              <th style={S.th} rowSpan={2}>Data</th>
              <th style={S.th} rowSpan={2}>Nasz dokument</th>
              <th style={S.th} rowSpan={2}>Dokument kontrahenta</th>
              <th style={S.th} colSpan={cols}>Przyjęto od kontrahenta</th>
              <th style={S.th} colSpan={cols}>Wydano kontrahentowi</th>
              <th style={S.th} colSpan={cols}>Saldo</th>
            </tr>
            <tr>
              {[...assets, ...assets, ...assets].map((a, i) => (
                <th key={i} style={{ ...S.th, fontSize: 8 }}>{ASSET_SHORT[a]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={S.sumL} colSpan={3 + cols * 2}>Saldo otwarcia</td>
              {assets.map(a => <td key={a} style={S.sum}>{st.opening[a]}</td>)}
            </tr>
            {rows.map(r => (
              <tr key={r.date}>
                <td style={S.td}>{fmtD(r.date)}</td>
                <td style={S.tdL}>{collapseLabels(r.labels)}</td>
                <td style={S.tdL}>{r.refs.join(', ') || '—'}</td>
                {assets.map(a => <td key={`i${a}`} style={S.td}>{num(r.in[a])}</td>)}
                {assets.map(a => <td key={`o${a}`} style={S.td}>{num(r.out[a])}</td>)}
                {assets.map(a => (
                  <td key={`b${a}`} style={{ ...S.td, fontWeight: 700 }}>{r.balance[a]}</td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td style={S.tdL} colSpan={3 + cols * 3}>Brak ruchów w wybranym okresie.</td></tr>
            )}
            <tr>
              <td style={S.sumL} colSpan={3 + cols * 2}>Saldo zamknięcia</td>
              {assets.map(a => (
                <td key={a} style={{ ...S.sum, fontSize: 12 }}>{st.closing[a]}</td>
              ))}
            </tr>
          </tbody>
        </table>
      )}

      {/* Kto komu zalega — wprost, bez czytania znaków w tabeli. */}
      {assets.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11 }}>
          {assets.every(a => st.closing[a] === 0) ? (
            <b>Saldo rozliczone — żadna ze stron nie zalega.</b>
          ) : (
            <>
              {assets.some(a => st.closing[a] > 0) && (
                <div>
                  <b>Nośniki kontrahenta u wystawcy:</b>{' '}
                  {assets.filter(a => st.closing[a] > 0)
                    .map(a => `${st.closing[a]} × ${ASSET_SHORT[a]}`).join(', ')}
                </div>
              )}
              {assets.some(a => st.closing[a] < 0) && (
                <div>
                  <b>Nośniki wystawcy u kontrahenta:</b>{' '}
                  {assets.filter(a => st.closing[a] < 0)
                    .map(a => `${Math.abs(st.closing[a])} × ${ASSET_SHORT[a]}`).join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 20, marginTop: '20mm' }}>
        {['Podpis wystawcy', 'Podpis kontrahenta'].map(t => (
          <div key={t} style={{ flex: 1, borderTop: '1px solid #111', paddingTop: 3, fontSize: 9.5 }}>
            {t}
          </div>
        ))}
      </div>
    </div>
  )
}
