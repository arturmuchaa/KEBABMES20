/**
 * DeboningReportPrintPage — raport rozbioru za okres, jednym klikiem do druku/PDF.
 *
 * Samodzielna strona (bez sidebara, jak WzPrintPage): /office/rozbior-raport/druk?from=&to=
 * Auto-print po załadowaniu (?pdf=1 wyłącza).
 *
 * Dwa poziomy, świadomie:
 * * STRONA 1 — dla zarządu: podsumowanie słowne, bilans masy domknięty do
 *   100%, z czego składa się koszt 1 kg mięsa, ile warty jest uzysk w
 *   złotówkach, które partie kosztowały pieniądze, trend miesięczny i JAWNA
 *   lista tego, czego raport nie obejmuje. Cała arytmetyka i cały tekst
 *   pochodzą z features/reports/executiveSummary — raport zarządczy musi być
 *   powtarzalny co do słowa.
 * * STRONY DALSZE — operacyjne: pełne tabele partii, pracowników, dostawców
 *   i trendu dziennego (to, co było tu od początku).
 */
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { analyticsApi, deboningApi, settingsApi, type DeboningStats, type CompanySettings, type EurRate, type KpiMonth } from '@/lib/api'
import {
  batchDeviations, costWaterfall, execNarrative, massBalance, reportGaps, yieldValue,
} from '@/features/reports/executiveSummary'
import { batchBiasNotes, potentialPln, workerScorecard } from '@/features/reports/workerScorecard'
import { executiveBrief, type BriefKind } from '@/features/reports/executiveBrief'
import { TrendChart } from '@/features/reports/TrendChart'

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
  lead: { fontSize: 12, lineHeight: 1.55, margin: '0 0 4px' } as const,
  note: { fontSize: 10.5, lineHeight: 1.5, color: '#444', margin: '2px 0 0 14px' } as const,
}

// Wariant zwarty dla tabel długich (28 partii): niższy wiersz i mniejszy
// font, żeby cała lista weszła na JEDNĄ stronę — przewracanie kartki w
// połowie zestawienia psuje porównywanie partii między sobą.
const C = {
  // breakInside: tabela ma zostać w całości — rozdzielona w połowie traci
  // sens, bo partie porównuje się między sobą wzrokiem.
  table: { ...S.table, fontSize: 9.5, tableLayout: 'fixed' as const,
    breakInside: 'avoid' as const },
  th: { ...S.th, padding: '2px 3px', fontSize: 8 },
  td: { ...S.td, padding: '1px 3px', lineHeight: 1.25 },
  tdL: { ...S.tdL, padding: '1px 4px', lineHeight: 1.25,
    whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
}

// Szarości słupka bilansu — dokument jest czarno-biały (drukarka biurowa),
// więc frakcje rozróżnia jasność, nie kolor.
const TONE: Record<string, string> = {
  meat: '#2b2b2b', backs: '#7a7a7a', bones: '#b4b4b4', gap: '#e2e2e2',
}

// Lewa krawędź pozycji podsumowania: szarości zamiast 🟢🟡🔴 — na czarno-
// białej drukarce kolory i tak schodzą do jednej plamki, a grubość i jasność
// krawędzi przeżywa druk.
const BRIEF_TONE: Record<BriefKind, string> = {
  good: '#b4b4b4', watch: '#7a7a7a', risk: '#111', decision: '#2b2b2b',
}

// Co realnie kryje się pod składnikiem ceny — bez tego „robocizna 65 420 zł"
// jest liczbą, o którą nie da się zapytać.
const COST_HINT: Record<string, string> = {
  'Zakup ćwiartki': 'faktury dostawców za ćwiartkę w rozebranych partiach',
  'Robocizna rozbioru': 'akord pracowników za kg pobranej ćwiartki',
  'Sprzedaż ubocznych': 'wystawione WZ na grzbiety i kości (pomniejszają koszt)',
}

const nfPln = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const signedPln = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${nfPln.format(Math.abs(v))} zł`

function signedKg(v: number | null | undefined): string {
  if (v == null) return '—'
  return v < 0 ? `+${nf1.format(-v)}` : nf1.format(v)
}

/** Sekcja raportu, która NIE pęka między stronami: gdy nie mieści się na
 *  resztce kartki, przechodzi na następną w całości. Rozdzielony wodospad
 *  kosztu albo bilans masy ucięty w połowie jest gorszy niż pusty dół
 *  strony — czytelnik traci wątek dokładnie tam, gdzie ma wyciągnąć wniosek. */
function Blok({ title, newPage, children }: {
  title: string; newPage?: boolean; children: React.ReactNode
}) {
  return (
    <section style={{ breakInside: 'avoid', ...(newPage ? { breakBefore: 'page' as const } : null) }}>
      <div style={S.section}>{title}</div>
      {children}
    </section>
  )
}

export function DeboningReportPrintPage() {
  const [sp] = useSearchParams()
  const from = sp.get('from') ?? ''
  const to = sp.get('to') ?? ''
  const isPdf = sp.get('pdf') === '1'
  const [data, setData] = useState<DeboningStats | null>(null)
  const [company, setCompany] = useState<CompanySettings | null>(null)
  // Trend miesięczny z migawek. Nie blokuje wydruku: gdy padnie, strona 1
  // po prostu napisze, że porównania nie ma — lepsze niż pusty raport.
  const [months, setMonths] = useState<KpiMonth[] | null>(null)
  // Kurs EUR z NBP na dzień końca okresu. `null` = nie udało się pobrać →
  // raport drukuje same złotówki, zamiast zaszytego w kodzie kursu.
  const [eur, setEur] = useState<EurRate | null | undefined>(undefined)

  useEffect(() => {
    if (!from || !to) return
    deboningApi.stats(from, to).then(setData).catch(() => setData(null))
    settingsApi.getCompany().then(setCompany).catch(() => setCompany(null))
    analyticsApi.kpiMonths(12).then(setMonths).catch(() => setMonths([]))
    analyticsApi.eurRate(to).then(setEur).catch(() => setEur(null))
  }, [from, to])

  useEffect(() => {
    if (data && months && eur !== undefined && !isPdf) setTimeout(() => window.print(), 400)
  }, [data, months, eur, isPdf])

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
  const trend = months ?? []
  const exec = { ...s, quarters: s.quarters, workers: s.workers }
  const bal = massBalance(exec)
  const cost = costWaterfall(exec)
  const yv = yieldValue(exec)
  const dev = batchDeviations(data.byBatch, s.avgYield, s.meatCostPerKg)
  const narrative = execNarrative(exec, data.byBatch, trend)
  const gaps = reportGaps(exec, data.byBatch, trend)
  // Zmiana uzysku m/m — null, gdy nie ma SĄSIEDNIEGO poprzednika. Kafelek
  // pisze wtedy „pierwszy miesiąc", zamiast zmyślić strzałkę.
  const trendDelta = trend[trend.length - 1]?.deltaYieldPp ?? null
  const days = data.byDay ?? []
  const prodDays = s.prodDays || days.length || 1
  const scorecard = workerScorecard(data.workers, s.meatCostPerKg, s.avgYield)
  const biasNotes = batchBiasNotes(scorecard)
  const potential = potentialPln(scorecard, s.kgQuarter, s.meatCostPerKg)
  // Dni odstające — wykres pokazuje kształt, ta lista nazywa konkretne dni,
  // żeby dało się je sprawdzić bez czytania wykresu przez lupę.
  const offDays = days.filter(d => Math.abs(d.avgYield - s.avgYield) > 1)
  // Udziały składników kosztu (tylko dodatnie — uboczne pomniejszają cenę,
  // więc nie mają udziału w „z czego się składa").
  const costPlus = (cost?.steps ?? []).filter(x => x.sign === '+')
  const costPlusTotal = costPlus.reduce((a, x) => a + x.pln, 0) || 1
  const costShares = costPlus.map(st => ({ ...st, share: st.pln / costPlusTotal * 100 }))
  const brief = executiveBrief({
    avgYield: s.avgYield, meatCostPerKg: s.meatCostPerKg, kgQuarter: s.kgQuarter,
    missingKg: s.missingKg, batches: data.byBatch, workers: scorecard,
    offDays, monthsInSystem: trend.length,
  })
  const batches = [...data.byBatch].sort((a, b) => a.batchNo.localeCompare(b.batchNo, 'pl', { numeric: true }))

  return (
    <div style={S.page}>
      <style>{`@media print { @page { size: A4 portrait; margin: 10mm } }`}</style>

      {/* ── Nagłówek ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #111', paddingBottom: 10, marginBottom: 14 }}>
        <div>
          {/* Plik poziomy ze sloganem (2779×379) — 44 px wysokości daje
              ~320 px szerokości, czytelne w druku i nie zabiera miejsca
              nagłówkowi. Ten sam zasób co na WZ i arkuszu HACCP. */}
          <img src="/logo-ksiezyc-print.png" alt="Księżyc"
            style={{ height: 44, width: 'auto', display: 'block', marginBottom: 8 }} />
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
          // Grzbiety i kości zeszły z kafelków do „Bilansu masy" — tam mają
          // kontekst (domknięcie do 100%), tutaj były tylko dwiema liczbami.
          { l: 'Ćwiartka pobrana', v: `${nf0.format(s.kgQuarter)} kg`, sub: `${nf0.format(s.quarters)} wpisów` },
          { l: 'Mięso', v: `${nf0.format(s.kgMeat)} kg`, sub: `${nf0.format(batches.length)} partii · ${days.length || 1} dni` },
          { l: 'Średni uzysk', v: `${nf1.format(s.avgYield)}%`,
            sub: trendDelta == null
              ? 'pierwszy miesiąc — brak porównania'
              : `${trendDelta > 0 ? '↑ +' : trendDelta < 0 ? '↓ −' : '→ '}${nf1.format(Math.abs(trendDelta))} p.p. vs poprzedni mies.` },
          { l: 'Wartość 0,1 p.p. uzysku', v: yv ? `${nfPln.format(yv.pointPln)} zł` : '—',
            sub: yv ? `${nf0.format(yv.pointKg)} kg mięsa` : 'brak cen zakupu' },
          { l: 'Tempo', v: `${nf0.format(s.kgPerHour)} kg/h`, sub: `${nf0.format(s.workers)} pracowników` },
          { l: surplus ? 'Nadwyżka rozbiorowa' : 'Bilans masy (ubytek)', v: `${signedKg(s.missingKg)} kg`,
            sub: surplus ? `+${nf1.format(-s.missingPct)}% nad deklarację dostawcy` : `${nf1.format(s.missingPct)}% ćwiartki` },
          { l: 'Koszt mięsa (z robocizną)', v: s.meatCostPerKg != null ? `${nf2.format(s.meatCostPerKg)} zł/kg` : '—',
            sub: s.quarterCost != null
              ? `ćwiartka ${nf0.format(s.quarterCost)} zł + robocizna ${nf0.format(s.laborCost ?? 0)} zł − uboczne ${nf0.format(s.byproductRevenue ?? 0)} zł`
              : 'brak cen zakupu' },
          { l: 'Dni z rozbiorem', v: String(days.length || 1), sub: `${nf0.format(batches.length)} partii surowca` },
        ].map((k, i) => (
          <div key={i} style={{ ...S.kpiBox, borderWidth: 0, borderRight: (i % 4) < 3 ? '1px solid #bfbfbf' : 0, borderBottom: i < 4 ? '1px solid #bfbfbf' : 0, borderStyle: 'solid', borderColor: '#bfbfbf' }}>
            <div style={S.kpiLabel}>{k.l}</div>
            <div style={S.kpiValue}>{k.v}</div>
            <div style={{ fontSize: 10, color: '#555' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* ══ STRONA 1 — dla zarządu ═══════════════════════════════════════ */}

      {/* Cztery zdania na wejście. Bez kolorowych kropek — dokument idzie na
          czarno-białą drukarkę, gdzie 🟢🟡🔴 drukują się identycznie; rolę
          rozróżnienia niesie podpis pozycji i grubość lewej krawędzi. */}
      <Blok title="Podsumowanie dla zarządu">
      <div style={{ border: '1px solid #bfbfbf', borderTop: '2px solid #111' }}>
        {brief.map((b, i) => (
          <div key={b.kind} style={{
            display: 'flex', gap: 12, padding: '7px 10px',
            borderTop: i > 0 ? '1px solid #dcdcdc' : undefined,
            borderLeft: `4px solid ${BRIEF_TONE[b.kind]}`,
          }}>
            <div style={{ width: 118, flexShrink: 0, fontSize: 9.5, fontWeight: 800,
              textTransform: 'uppercase', letterSpacing: 0.5, color: '#333', paddingTop: 1 }}>
              {b.label}
            </div>
            <div style={{ fontSize: 11.5, lineHeight: 1.5 }}>{b.text}</div>
          </div>
        ))}
      </div>
      </Blok>

      <Blok title="Podsumowanie okresu">
      {narrative.map((p, i) => <p key={i} style={S.lead}>{p}</p>)}
      </Blok>

      {/* ── Bilans masy: wejście = wyjście, domknięte do 100% ── */}
      <Blok title="Bilans masy">
      <div style={{ display: 'flex', height: 26, border: '1px solid #111', marginBottom: 6 }}>
        {bal.parts.map((p, i) => (
          <div key={i} style={{ width: `${p.barPct}%`, background: TONE[p.tone],
            color: p.tone === 'meat' || p.tone === 'backs' ? '#fff' : '#111',
            fontSize: 9.5, fontWeight: 800, display: 'flex', alignItems: 'center',
            justifyContent: 'center', borderRight: i < bal.parts.length - 1 ? '1px solid #fff' : 0 }}>
            {p.pct >= 6 ? `${nf1.format(p.pct)}%` : ''}
          </div>
        ))}
      </div>
      <table style={S.table}>
        <tbody>
          <tr>
            <td style={{ ...S.tdL, fontWeight: 700, width: '32%' }}>Ćwiartka pobrana (wejście)</td>
            <td style={{ ...S.td, fontWeight: 800 }}>{nf0.format(s.kgQuarter)} kg</td>
            <td style={S.td}>100,0%</td>
            <td style={{ ...S.tdL, width: '36%' }}>{s.quarters} pobrań · {batches.length} partii</td>
          </tr>
          {bal.parts.map((p, i) => (
            <tr key={i}>
              <td style={S.tdL}>{p.label}</td>
              <td style={S.td}>{nf0.format(p.kg)} kg</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(p.pct)}%</td>
              <td style={S.tdL}>
                {p.tone === 'gap' ? 'towar nieujęty w ważeniu — do wyjaśnienia' : ''}
              </td>
            </tr>
          ))}
          {bal.gap.surplus && (
            <tr style={{ fontWeight: 700, background: '#efefef' }}>
              <td style={S.tdL}>Razem zważono (wyjście)</td>
              <td style={S.td}>{nf0.format(bal.outputKg)} kg</td>
              <td style={S.td}>{nf1.format(bal.outputPct)}%</td>
              <td style={S.tdL}>
                nadwyżka {nf0.format(bal.gap.kg)} kg ({nf1.format(bal.gap.pct)}%) —
                towaru było więcej, niż deklarował dostawca
              </td>
            </tr>
          )}
        </tbody>
      </table>

      </Blok>
      {/* ── Z czego składa się koszt 1 kg mięsa ── */}
      {cost && (
        <>
          <Blok title="Z czego składa się koszt 1 kg mięsa">
          {/* Pasek udziałów: od razu widać, że o cenie decyduje zakup
              ćwiartki (94%), a nie robicizna — bez tego rozmowa o kosztach
              schodzi na płace, gdzie stawki są i tak jednolite. */}
          <div style={{ display: 'flex', height: 22, border: '1px solid #111', marginBottom: 4 }}>
            {costShares.map((st, i, arr) => (
              <div key={st.label} style={{
                width: `${st.share}%`, background: i === 0 ? '#2b2b2b' : '#8a8a8a', color: '#fff',
                fontSize: 9, fontWeight: 800, display: 'flex', alignItems: 'center',
                justifyContent: 'center', borderRight: i < arr.length - 1 ? '1px solid #fff' : 0,
                overflow: 'hidden', whiteSpace: 'nowrap',
              }}>
                {st.share >= 6 ? `${nf1.format(st.share)}%` : ''}
              </div>
            ))}
          </div>
          {/* Legenda pod paskiem, nie w segmentach: „Robocizna rozbioru" nie
              mieści się w 6,4% szerokości i wylewała się poza słupek. */}
          <div style={{ display: 'flex', gap: 16, marginBottom: 6, fontSize: 10, color: '#333' }}>
            {costShares.map((st, i) => (
              <span key={st.label} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <span style={{ width: 10, height: 10, background: i === 0 ? '#2b2b2b' : '#8a8a8a',
                  display: 'inline-block' }} />
                {st.label} — {nf1.format(st.share)}% ceny
              </span>
            ))}
          </div>
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: 'left' }}>Składnik</th>
                <th style={{ ...S.th, textAlign: 'left' }}>Co to jest</th>
                <th style={S.th}>Kwota [zł]</th>
                <th style={S.th}>Na 1 kg [zł]</th>
                <th style={S.th}>Na 1 kg [EUR]</th>
              </tr>
            </thead>
            <tbody>
              {cost.steps.map((st, i) => (
                <tr key={i}>
                  <td style={{ ...S.tdL, fontWeight: 600 }}>{st.sign} {st.label}</td>
                  <td style={{ ...S.tdL, fontSize: 10, color: '#555' }}>{COST_HINT[st.label] ?? ''}</td>
                  <td style={S.td}>{st.sign === '−' ? '−' : ''}{nfPln.format(st.pln)}</td>
                  <td style={S.td}>{st.sign === '−' ? '−' : ''}{nf2.format(st.perKgMeat)}</td>
                  <td style={S.td}>
                    {eur ? `${st.sign === '−' ? '−' : ''}${nf2.format(st.perKgMeat / eur.rate)}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, background: '#efefef' }}>
                <td style={S.tdL} colSpan={2}>Koszt netto · {nf0.format(s.kgMeat)} kg mięsa</td>
                <td style={S.td}>{nfPln.format(cost.netPln)}</td>
                <td style={{ ...S.td, fontSize: 13 }}>{nf2.format(cost.netPerKg)}</td>
                <td style={{ ...S.td, fontSize: 13 }}>
                  {eur ? nf2.format(cost.netPerKg / eur.rate) : '—'}
                </td>
              </tr>
            </tfoot>
          </table>
          <p style={S.note}>
            {eur
              ? <>Przeliczenie na EUR po kursie średnim NBP (tab. {eur.table}) z dnia {fmtD(eur.date)}: 1 EUR = {nf2.format(eur.rate)} zł.</>
              : <>Kurs EUR niedostępny (brak odpowiedzi NBP) — kwoty wyłącznie w złotych.</>}
          </p>
          </Blok>
        </>
      )}

      {/* ── Uzysk przeliczony na pieniądze ── */}
      {yv && (
        <>
          <Blok title="Ile jest wart uzysk">
          <table style={S.table}>
            <tbody>
              <tr>
                <td style={{ ...S.tdL, fontWeight: 700, width: '32%' }}>Wartość 0,1 p.p. uzysku</td>
                <td style={{ ...S.td, fontWeight: 800, fontSize: 13 }}>{nfPln.format(yv.pointPln)} zł</td>
                <td style={S.tdL}>= {nf0.format(yv.pointKg)} kg mięsa więcej z tej samej ćwiartki</td>
              </tr>
              {yv.scenarios.map(sc => (
                <tr key={sc.yieldPct}>
                  <td style={S.tdL}>Gdyby uzysk wyniósł {nf1.format(sc.yieldPct)}%</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{signedPln(sc.deltaPln)}</td>
                  <td style={S.tdL}>{sc.deltaKg > 0 ? '+' : '−'}{nf0.format(Math.abs(sc.deltaKg))} kg mięsa</td>
                </tr>
              ))}
            </tbody>
          </table>
          </Blok>
        </>
      )}

      {/* ── Gdzie uciekają pieniądze: odchylenia partii w złotówkach ── */}
      {dev && dev.all.length > 1 && (
        <>
          <Blok title="Gdzie uciekają pieniądze — partie względem średniej">
          <table style={S.table}>
            <thead>
              <tr>
                <th style={{ ...S.th, textAlign: 'left' }}>Partia</th>
                <th style={S.th}>% mięsa</th>
                <th style={S.th}>Ćwiartka [kg]</th>
                <th style={S.th}>± p.p.</th>
                <th style={S.th}>Skutek [zł]</th>
                <th style={{ ...S.th, textAlign: 'left' }}>Dostawca</th>
              </tr>
            </thead>
            <tbody>
              {[...dev.worst, ...dev.best.slice().reverse()].map((b, i) => (
                <tr key={b.batchNo} style={i === dev.worst.length ? { borderTop: '2px solid #111' } : undefined}>
                  <td style={{ ...S.tdL, fontWeight: 700 }}>{b.batchNo}</td>
                  <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(b.yieldPct)}</td>
                  <td style={S.td}>{nf0.format(b.kgQuarter)}</td>
                  <td style={S.td}>{b.deltaPp > 0 ? '+' : '−'}{nf1.format(Math.abs(b.deltaPp))}</td>
                  <td style={{ ...S.td, fontWeight: 800 }}>{signedPln(b.deltaPln)}</td>
                  <td style={S.tdL}>{b.supplierName || '—'}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ fontWeight: 800, background: '#efefef' }}>
                <td style={S.tdL} colSpan={4}>
                  Razem partie poniżej średniej ({dev.all.filter(b => b.deltaPln < 0).length} z {dev.all.length})
                </td>
                <td style={S.td}>{signedPln(dev.lossPln)}</td>
                <td style={S.tdL}></td>
              </tr>
            </tfoot>
          </table>
          {suppliers.length > 1 && (
            <p style={S.note}>Porównanie dostawców — patrz tabela „Dostawcy" na dalszych stronach.</p>
          )}
          {suppliers.length === 1 && (
            <p style={S.note}>
              Cały surowiec rozebrany w okresie pochodzi od jednego dostawcy
              ({suppliers[0].name}) — porównanie dostawców niemożliwe.
            </p>
          )}
          </Blok>
        </>
      )}

      {/* ── Trend miesięczny z migawek (rośnie z każdym zamkniętym miesiącem) ── */}
      <Blok title="Trend miesięczny">
      {trend.length > 1 ? (
        <table style={S.table}>
          <thead>
            <tr>
              <th style={{ ...S.th, textAlign: 'left' }}>Miesiąc</th>
              <th style={S.th}>Ćwiartka [kg]</th>
              <th style={S.th}>Mięso [kg]</th>
              <th style={S.th}>Uzysk [%]</th>
              <th style={S.th}>± p.p.</th>
              <th style={S.th}>Koszt [zł/kg]</th>
              <th style={S.th}>Tempo [kg/h]</th>
            </tr>
          </thead>
          <tbody>
            {trend.map(m => (
              <tr key={m.yearMonth}>
                <td style={{ ...S.tdL, fontWeight: 700 }}>
                  {m.yearMonth}{!m.closed && ' (w toku)'}
                </td>
                <td style={S.td}>{nf0.format(m.kgQuarter)}</td>
                <td style={S.td}>{nf0.format(m.kgMeat)}</td>
                <td style={{ ...S.td, fontWeight: 700 }}>{m.avgYield != null ? nf1.format(m.avgYield) : '—'}</td>
                <td style={S.td}>
                  {m.deltaYieldPp == null ? '—'
                    : `${m.deltaYieldPp > 0 ? '+' : m.deltaYieldPp < 0 ? '−' : ''}${nf1.format(Math.abs(m.deltaYieldPp))}`}
                </td>
                <td style={S.td}>{m.meatCostPerKg != null ? nf2.format(m.meatCostPerKg) : '—'}</td>
                <td style={S.td}>{m.kgPerHour != null ? nf0.format(m.kgPerHour) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p style={S.lead}>
          Brak danych porównawczych — rozbiór jest rejestrowany w systemie
          {trend.length === 1 ? ` od ${trend[0].yearMonth}` : ''} i nie ma jeszcze
          zamkniętego pełnego miesiąca. Trend uzysku, kosztu i tempa pojawi się
          automatycznie po zamknięciu kolejnych okresów.
        </p>
      )}
      </Blok>

      {/* ── Jawna lista dziur: raport, który je zakleja, traci wiarygodność ── */}
      <Blok title="Czego raport nie obejmuje">
      {gaps.map((g, i) => <p key={i} style={S.note}>• {g}</p>)}
      </Blok>

      {/* ══ STRONY DALSZE — operacyjne ════════════════════════════════════ */}

      {/* ── Partie ── */}
      <Blok title="Partie surowca" newPage>
      <table style={C.table}>
        <colgroup>
          <col style={{ width: '7%' }} /><col style={{ width: '16%' }} />
          <col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '9%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} /><col style={{ width: '11%' }} />
          <col style={{ width: '13%' }} />
        </colgroup>
        <thead>
          <tr>
            <th style={{ ...C.th, textAlign: 'left' }}>Partia</th>
            <th style={{ ...C.th, textAlign: 'left' }}>Dostawca</th>
            <th style={C.th}>Ćwiartka [kg]</th>
            <th style={C.th}>Mięso [kg]</th>
            <th style={C.th}>% mięsa</th>
            <th style={C.th}>Grzbiety [kg]</th>
            <th style={C.th}>Kości [kg]</th>
            <th style={C.th}>Bilans ± [kg]</th>
            <th style={C.th}>Koszt mięsa [zł/kg]</th>
          </tr>
        </thead>
        <tbody>
          {batches.map(b => (
            <tr key={b.batchNo}>
              <td style={{ ...C.tdL, fontWeight: 700 }}>{b.batchNo}</td>
              <td style={C.tdL} title={b.supplierName || ''}>{b.supplierName || '—'}</td>
              <td style={C.td}>{nf0.format(b.kgQuarter)}</td>
              <td style={{ ...C.td, fontWeight: 700 }}>{nf0.format(b.kgMeat)}</td>
              <td style={{ ...C.td, fontWeight: 700 }}>{b.yieldPct != null ? nf1.format(b.yieldPct) : '—'}</td>
              <td style={C.td}>{nf0.format(b.kgBacks)}</td>
              <td style={C.td}>{nf0.format(b.kgBones)}</td>
              <td style={C.td}>{signedKg(b.missingKg)}</td>
              <td style={C.td}>{b.meatCostPerKg != null ? nf2.format(b.meatCostPerKg) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ fontWeight: 800, background: '#efefef' }}>
            <td style={C.tdL} colSpan={2}>Razem · {batches.length} part.</td>
            <td style={C.td}>{nf0.format(s.kgQuarter)}</td>
            <td style={C.td}>{nf0.format(s.kgMeat)}</td>
            <td style={C.td}>{nf1.format(s.avgYield)}</td>
            <td style={C.td}>{nf0.format(s.kgBacks)}</td>
            <td style={C.td}>{nf0.format(s.kgBones)}</td>
            <td style={C.td}>{signedKg(s.missingKg)}</td>
            <td style={C.td}>{s.meatCostPerKg != null ? nf2.format(s.meatCostPerKg) : '—'}</td>
          </tr>
        </tfoot>
      </table>
      </Blok>

      {/* ── Pracownicy ── */}
      <Blok title="Pracownicy">
      <table style={S.table}>
        <thead>
          <tr>
            <th style={{ ...S.th, textAlign: 'left' }}>Pracownik</th>
            <th style={S.th}>Obecność</th>
            <th style={S.th}>Ćwiartka [kg]</th>
            <th style={S.th}>Udział [%]</th>
            <th style={S.th}>Śr. %</th>
            <th style={S.th}>± zakład [p.p.]</th>
            <th style={S.th}>Skutek [zł]</th>
            <th style={S.th}>Dni od–do [%]</th>
            <th style={S.th}>Kg/h</th>
          </tr>
        </thead>
        <tbody>
          {scorecard.map(w => (
            <tr key={w.workerId} style={w.smallSample ? { color: '#777' } : undefined}>
              <td style={{ ...S.tdL, fontWeight: 600 }}>
                {w.workerName}{w.smallSample && <span style={{ fontWeight: 400 }}> · próba za mała</span>}
              </td>
              <td style={S.td}>{w.days}/{prodDays} · {nf0.format(w.attendancePct)}%</td>
              <td style={S.td}>{nf0.format(w.kgQuarter)}</td>
              <td style={S.td}>{nf1.format(w.volumeSharePct)}</td>
              <td style={{ ...S.td, fontWeight: 700 }}>{nf1.format(w.avgYield)}</td>
              <td style={S.td}>
                {`${w.deltaPp > 0 ? '+' : w.deltaPp < 0 ? '−' : ''}${nf2.format(Math.abs(w.deltaPp))}`}
              </td>
              <td style={{ ...S.td, fontWeight: 800 }}>
                {w.deltaPln == null || w.smallSample ? '—' : signedPln(w.deltaPln)}
              </td>
              <td style={S.td}>
                {w.yieldMinDay == null ? '—'
                  : w.yieldRangePp == null ? nf1.format(w.yieldMinDay)
                  : `${nf1.format(w.yieldMinDay)}–${nf1.format(w.yieldMaxDay as number)}`}
              </td>
              <td style={S.td}>{nf1.format(w.kgPerHour)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {potential && (
        <p style={{ ...S.lead, marginTop: 6 }}>
          <b>Stawka:</b> suma kolumny „Skutek" jest bliska zeru, bo to porównanie pracowników
          między sobą — nie dodatkowy zysk. Realna kwota to poziom najlepszego rozciągnięty na
          cały zakład: gdyby wszyscy pracowali jak {potential.workerName}{' '}
          (+{nf2.format(potential.pp)} p.p. ponad średnią zakładu), miesiąc dałby{' '}
          <b>{nfPln.format(potential.pln)} zł</b> więcej.
        </p>
      )}
      <p style={S.note}>
        <b>± zakład</b> — o ile uzysk pracownika różni się od średniej zakładu
        ({nf1.format(s.avgYield)}%); <b>Skutek</b> to ta różnica przeliczona na złotówki
        (koszt {s.meatCostPerKg != null ? nf2.format(s.meatCostPerKg) : '—'} zł/kg mięsa).
      </p>
      <p style={S.note}>
        <b>Dni od–do</b> — uzysk w najsłabszym i najlepszym dniu pracownika. Im węższy
        przedział, tym równiejsza praca: 65,2–66,8% to człowiek, który codziennie robi tak
        samo, a 63,6–67,3% to ktoś, u kogo wynik zależy od dnia. Każdą z tych liczb da się
        sprawdzić w dzienniku ważeń.
      </p>
      {biasNotes.length > 0 && (
        <p style={S.note}>
          <b>Jakość surowca</b> — po odjęciu wpływu partii (porównanie do średniej WŁASNYCH
          partii, a nie całego zakładu) ocena zmienia się istotnie u:{' '}
          {biasNotes.map(b =>
            `${b.workerName} ${(b.batchBiasPp as number) > 0 ? 'lepiej' : 'gorzej'} o ${nf2.format(Math.abs(b.batchBiasPp as number))} p.p.`
          ).join(', ')}. Partii nikt sobie nie wybiera — tę różnicę warto wziąć pod uwagę.
        </p>
      )}
      <p style={S.note}>
        <b>Obecność</b> liczona z dni, w których pracownik miał pobranie —
        system nie zna grafiku, więc nie odróżnia urlopu i zwolnienia od nieobecności.
      </p>
      </Blok>

      {/* ── Dostawcy (gdy więcej niż jeden) ── */}
      {suppliers.length > 1 && (
        <>
          <Blok title="Dostawcy — jakość surowca">
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
          </Blok>
        </>
      )}

      {/* ── Trend dzienny ── */}
      {/* Wykres zamiast tabeli: 17 wierszy liczb nikt nie czyta, kształt
          widać w sekundę. Dni odstające i tak wypisujemy pod spodem. */}
      {days.length > 1 && (
        <>
          <Blok title="Trend dzienny">
          <TrendChart points={days} avgYield={s.avgYield} />
          {offDays.length > 0 && (
            <p style={S.note}>
              Dni odstające od średniej o ponad 1 p.p.:{' '}
              {offDays.map(d =>
                `${fmtD(d.date)} — ${nf1.format(d.avgYield)}% (${d.avgYield > s.avgYield ? '+' : '−'}${nf1.format(Math.abs(d.avgYield - s.avgYield))} p.p., ${nf0.format(d.kgMeat)} kg)`
              ).join('; ')}.
            </p>
          )}
          </Blok>
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
