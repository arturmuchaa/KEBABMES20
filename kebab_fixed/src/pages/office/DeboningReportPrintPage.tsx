/**
 * DeboningReportPrintPage — raport rozbioru za okres, jednym klikiem do druku/PDF.
 *
 * Samodzielna strona (bez sidebara, jak WzPrintPage): /office/rozbior-raport/druk?from=&to=
 * Renderuje A4 z danymi z /deboning/stats: KPI + ekonomia, partie, pracownicy,
 * dostawcy, trend dzienny. Auto-print po załadowaniu (?pdf=1 wyłącza).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { deboningApi, settingsApi, type DeboningStats, type CompanySettings } from '@/lib/api'

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function fmtD(iso: string): string {
  if (!iso) return '—'
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

// Styl dokumentu spójny z WZ/HDI: czarne cienkie ramki, nagłówki szare.
const S = {
  page: { maxWidth: 800, margin: '0 auto', padding: 24, background: '#fff', color: '#111',
    fontFamily: "'Segoe UI', Arial, sans-serif", fontSize: 12 } as const,
  h1: { fontSize: 20, fontWeight: 800, letterSpacing: 0.5, margin: 0 } as const,
  section: { fontSize: 12.5, fontWeight: 700, textTransform: 'uppercase' as const,
    letterSpacing: 0.6, margin: '18px 0 6px', borderBottom: '2px solid #111', paddingBottom: 3 },
  table: { width: '100%', borderCollapse: 'collapse' as const, fontSize: 11.5 },
  th: { border: '1px solid #bfbfbf', background: '#efefef', padding: '4px 6px',
    fontSize: 10, textTransform: 'uppercase' as const, fontWeight: 700, textAlign: 'center' as const },
  td: { border: '1px solid #bfbfbf', padding: '3.5px 6px', textAlign: 'center' as const },
  tdL: { border: '1px solid #bfbfbf', padding: '3.5px 6px', textAlign: 'left' as const },
  kpiBox: { border: '1px solid #bfbfbf', padding: '6px 10px' } as const,
  kpiLabel: { fontSize: 9.5, textTransform: 'uppercase' as const, fontWeight: 700, color: '#555', letterSpacing: 0.4 },
  kpiValue: { fontSize: 17, fontWeight: 800, fontVariantNumeric: 'tabular-nums' as const },
}

function signedKg(v: number | null | undefined): string {
  if (v == null) return '—'
  return v < 0 ? `+${nf1.format(-v)}` : nf1.format(v)
}

export function DeboningReportPrintPage() {
  const [sp] = useSearchParams()
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const isPdf = sp.get('pdf') === '1'
  const [data, setData] = useState<DeboningStats | null>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)

  useEffect(() => {
    if (!from || !to) return
    deboningApi.stats(from, to).then(setData).catch(() => setData(null))
    settingsApi.getCompany().then(setCompany).catch(() => setCompany(null))
  }, [from, to])

  useEffect(() => {
    if (data && !isPdf) setTimeout(() => window.print(), 400)
  }, [data, isPdf])

  const suppliers = useMemo(() => {
    const sup = new Map<string, { kgQuarter: number; kgMeat: number; batches: number }>()
    for (const b of data?.byBatch ?? []) {
      if (!b.supplierName || b.yieldPct == null) continue
      const cur = sup.get(b.supplierName) ?? { kgQuarter: 0, kgMeat: 0, batches: 0 }
      cur.kgQuarter += b.kgQuarter; cur.kgMeat += b.kgMeat; cur.batches += 1
      sup.set(b.supplierName, cur)
    }
    return Array.from(sup.entries())
      .map(([name, v]) => ({ name, ...v, avgYield: v.kgQuarter > 0 ? v.kgMeat / v.kgQuarter * 100 : 0 }))
      .sort((a, b) => b.kgQuarter - a.kgQuarter)
  }, [data])

  if (!from || !to) return <div style={{ padding: 24 }}>Brak zakresu dat (parametry from/to).</div>
  if (!data) return <div style={{ padding: 24 }}>Ładowanie…</div>

  const s = data.summary
  const surplus = s.missingKg < 0
  const days = data.byDay ?? []
  const workers = [...data.workers].sort((a, b) => b.kgMeat - a.kgMeat)
  const batches = [...data.byBatch].sort((a, b) => a.batchNo.localeCompare(b.batchNo, 'pl', { numeric: true }))

  return (
    <div style={S.page}>
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm } }`}</style>

      {/* ── Nagłówek ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #111', paddingBottom: 10, marginBottom: 14 }}>
        <div>
          <h1 style={S.h1}>RAPORT ROZBIORU</h1>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 3 }}>
            Okres: {fmtD(from)}{from !== to ? ` – ${fmtD(to)}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11, lineHeight: 1.45 }}>
          <div style={{ fontWeight: 700, fontSize: 12.5 }}>{company?.name || ''}</div>
          {company?.address && <div>{company.address}</div>}
          {(company?.postalCode || company?.city) && <div>{company?.postalCode} {company?.city}</div>}
          {company?.vetNumber && <div>Nr wet.: {company.vetNumber}</div>}
          {company?.nip && <div>NIP: {company.nip}</div>}
        </div>
      </div>

      {/* ── KPI ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 0, border: '1px solid #bfbfbf' }}>
        {[
          { l: 'Ćwiartka pobrana', v: `${nf0.format(s.kgQuarter)} kg`, sub: `${nf0.format(s.quarters)} wpisów` },
          { l: 'Mięso', v: `${nf0.format(s.kgMeat)} kg`, sub: `śr. rozbiór ${nf1.format(s.avgYield)}%` },
          { l: 'Grzbiety', v: `${nf0.format(s.kgBacks)} kg`, sub: `${nf1.format(s.backsPct)}% ćwiartki` },
          { l: 'Kości', v: `${nf0.format(s.kgBones)} kg`, sub: `${nf1.format(s.bonesPct)}% ćwiartki` },
          { l: 'Tempo', v: `${nf0.format(s.kgPerHour)} kg/h`, sub: `${nf0.format(s.workers)} pracowników` },
          { l: surplus ? 'Nadwyżka rozbiorowa' : 'Bilans masy (ubytek)', v: `${signedKg(s.missingKg)} kg`,
            sub: surplus ? `+${nf1.format(-s.missingPct)}% nad deklarację dostawcy` : `${nf1.format(s.missingPct)}% ćwiartki` },
          { l: 'Koszt mięsa', v: s.meatCostPerKg != null ? `${nf2.format(s.meatCostPerKg)} zł/kg` : '—',
            sub: s.quarterCost != null ? `ćwiartka ${nf0.format(s.quarterCost)} zł − uboczne ${nf0.format(s.byproductRevenue ?? 0)} zł` : 'brak cen zakupu' },
          { l: 'Dni z rozbiorem', v: String(days.length || 1), sub: `${nf0.format(batches.length)} partii surowca` },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiBox, borderWidth: 0, borderRight: (i % 4) < 3 ? '1px solid #bfbfbf' : 0, borderBottom: i < 4 ? '1px solid #bfbfbf' : 0, borderStyle: 'solid', borderColor: '#bfbfbf' }}>
            <div style={S.kpiLabel}>{k.l}</div>
            <div style={S.kpiValue}>{k.v}</div>
            <div style={{ fontSize: 10, color: '#555' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ── Partie ── */}
      <div style={S.section}>Partie surowca</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, textAlign: 'left' }}>Partia</th>
            <th style={{ ...S.th, textAlign: 'left' }}>Dostawca</th>
            <th style={S.th}>Ćwiartka [kg]</th>
            <th style={S.th}>Mięso [kg]</th>
            <th style={S.th}>% mięsa</th>
            <th style={S.th}>Grzbiety [kg]</th>
            <th style={S.th}>Kości [kg]</th>
            <th style={S.th}>Bilans ± [kg]</th>
            <th style={S.th}>Koszt mięsa [zł/kg]</th>
          </tr>
        </thead>
        <tbody>
          {batches.map(b => (
            <tr key={b.batchNo}>
              <td style={{ ...S.tdL, fontWeight: 700 }}>{b.batchNo}</td>
              <td style={S.tdL}>{b.supplierName || '—'}</td>
              <td style={S.td}>{nf1.format(b.kgQuarter)}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(b.kgMeat)}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{b.yieldPct != null ? nf1.format(b.yieldPct) : '—'}</td>
              <td style={S.td}>{nf1.format(b.kgBacks)}</td>
              <td style={S.td}>{nf1.format(b.kgBones)}</td>
              <td style={S.td}>{signedKg(b.missingKg)}</td>
              <td style={S.td}>{b.meatCostPerKg != null ? nf2.format(b.meatCostPerKg) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 800, background: '#efefef' }}>
            <td style={S.tdL} colSpan={2}>Razem · {batches.length} part.</td>
            <td style={S.td}>{nf1.format(s.kgQuarter)}</td>
            <td style={S.td}>{nf1.format(s.kgMeat)}</td>
            <td style={S.td}>{nf1.format(s.avgYield)}</td>
            <td style={S.td}>{nf1.format(s.kgBacks)}</td>
            <td style={S.td}>{nf1.format(s.kgBones)}</td>
            <td style={S.td}>{signedKg(s.missingKg)}</td>
            <td style={S.td}>{s.meatCostPerKg != null ? nf2.format(s.meatCostPerKg) : '—'}</td>
          </tr>
        </tfoot>
      </table>

      {/* ── Pracownicy ── */}
      <div style={S.section}>Pracownicy</div>
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, textAlign: 'left' }}>Pracownik</th>
            <th style={S.th}>Ćwiartka [kg]</th>
            <th style={S.th}>Mięso [kg]</th>
            <th style={S.th}>Śr. %</th>
            <th style={S.th}>± zakład [p.p.]</th>
            <th style={S.th}>Kg/h</th>
            <th style={S.th}>Wpisy</th>
          </tr>
        </thead>
        <tbody>
          {workers.map(w => {
            const d = w.avgYield - s.avgYield
            return (
              <tr key={w.workerId}>
                <td style={{ ...S.tdL, fontWeight: 600 }}>{w.workerName}</td>
                <td style={S.td}>{nf1.format(w.kgQuarter)}</td>
                <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(w.kgMeat)}</td>
                <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(w.avgYield)}</td>
                <td style={S.td}>{Math.abs(d) < 0.05 ? '0,0' : `${d > 0 ? '+' : '−'}${nf1.format(Math.abs(d))}`}</td>
                <td style={S.td}>{nf1.format(w.kgPerHour)}</td>
                <td style={S.td}>{w.quarters}</td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ── Dostawcy (gdy więcej niż jeden) ── */}
      {suppliers.length > 1 && (
        <>
          <div style={S.section}>Dostawcy — jakość surowca</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: 'left' }}>Dostawca</th>
                <th style={S.th}>Partie</th>
                <th style={S.th}>Ćwiartka [kg]</th>
                <th style={S.th}>Mięso [kg]</th>
                <th style={S.th}>Śr. % mięsa</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map(x => (
                <tr key={x.name}>
                  <td style={{ ...S.tdL, fontWeight: 600 }}>{x.name}</td>
                  <td style={S.td}>{x.batches}</td>
                  <td style={S.td}>{nf0.format(x.kgQuarter)}</td>
                  <td style={S.td}>{nf0.format(x.kgMeat)}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(x.avgYield)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── Trend dzienny (zakresy wielodniowe) ── */}
      {days.length > 1 && (
        <>
          <div style={S.section}>Trend dzienny</div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: 'left' }}>Dzień</th>
                <th style={S.th}>Wpisy</th>
                <th style={S.th}>Mięso [kg]</th>
                <th style={S.th}>Śr. % mięsa</th>
              </tr>
            </thead>
            <tbody>
              {days.map(d => (
                <tr key={d.date}>
                  <td style={S.tdL}>{fmtD(d.date)}</td>
                  <td style={S.td}>{d.quarters}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(d.kgMeat)}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(d.avgYield)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* ── Stopka ── */}
      <div style={{ marginTop: 22, paddingTop: 8, borderTop: '1px solid #bfbfbf', display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555' }}>
        <div>Wygenerowano: {new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })}</div>
        <div>Podpis: ______________________</div>
      </div>
    </div>
  )
}
