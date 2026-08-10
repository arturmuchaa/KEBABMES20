/**
 * HaccpReportPage — Raport HACCP z pełną traceability
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { deboningApi, rawBatchesApi, suppliersApi, byproductsApi, type BatchByproducts } from '@/lib/apiClient'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { haccpReportNo } from '@/lib/haccpReportNo'
import { Printer, FileText, Calendar, CheckSquare, Square } from 'lucide-react'
import type { DeboningSession, RawBatch } from '@/types'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const printStyles = `
@media print {
  /* Wąskie marginesy (prośba właściciela 2026-07-16) — 5 mm zamiast 10 mm.
     Boki 7 mm jak w karcie temperatur: przy 5 mm drukarki biurowe ucinały
     skrajną ramkę tabeli. */
  @page { size: A4 portrait; margin: 5mm 7mm; }
  body * { visibility: hidden; }
  #haccp-report, #haccp-report * { visibility: visible; }
  #haccp-report { position: absolute; left: 0; top: 0; width: 100%; }
  .no-print { display: none !important; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 3px 6px; }
  th { background: #e5e5e5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

/**
 * Styl dokumentu = karta 5.1.1.1 (kontrola temperatury, TemperatureLogPrintPage).
 * Raport rozbioru trafia do tej samej księgi HACCP co karty wypełniane ręcznie,
 * więc musi mieć ten sam nagłówek z logo, tę samą belkę, te same trzy szarości
 * (belka sekcji #dcdcdc → nagłówek tabeli #ededed → ramka #8c8c8c) i tę samą
 * stopkę z numerem karty. Kolor wyłącznie w logo — reszta w skali szarości,
 * żeby dokument dobrze się kserował.
 *
 * Klasy są scope'owane pod `.rap`, bo ta strona renderuje się WEWNĄTRZ layoutu
 * biura (inaczej niż samodzielne strony druku) i nie może przemalować UI wokół.
 * Z tego samego powodu nie ma tu @page — rozmiar strony ustawia printStyles
 * dopinany dopiero na czas druku.
 */
const DOC_CSS = `
/* Pliki -latin-ext mają WYŁĄCZNIE glify latin-ext. Bez wariantu -latin (i bez
   unicode-range) ASCII spadłby na Arial i dokument zrobiłby się szerszy. */
@font-face { font-family:'RCRap'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCRap'; font-weight:400; font-display:swap;
  src:url('/fonts/robotocondensed-400-latin.woff2') format('woff2'); }
@font-face { font-family:'RCRap'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
  unicode-range:U+0100-024F,U+0259,U+1E00-1EFF,U+2020,U+20A0-20AB,U+20AD-20CF,U+2113,U+2C60-2C7F,U+A720-A7FF; }
@font-face { font-family:'RCRap'; font-weight:700; font-display:swap;
  src:url('/fonts/robotocondensed-700-latin.woff2') format('woff2'); }

.rap, .rap * { box-sizing:border-box; }
.rap { font-family:'RCRap',Arial,sans-serif; color:#111; font-size:8pt; line-height:1.2;
  background:#fff; width:196mm; margin:0 auto 6mm; padding:0;
  -webkit-print-color-adjust:exact; print-color-adjust:exact; }
@media print { .rap { width:auto; margin:0; } }

.rap .top { display:flex; align-items:flex-start; gap:6mm; }
.rap .top img { height:10mm; }
.rap .plant { flex:1; text-align:center; padding-top:.8mm; }
.rap .plant .nm { font-weight:700; font-size:9pt; letter-spacing:.02em; }
.rap .plant .ad { font-size:7pt; color:#333; }
.rap .rule { height:1.4mm; margin:2.6mm 0 0; background:#9a9a9a; }
.rap h1 { font-size:13pt; font-weight:700; text-align:center; letter-spacing:.04em;
  margin:1.6mm 0 .5mm; text-transform:uppercase; }
.rap .sub { text-align:center; font-size:7.2pt; color:#444; margin-bottom:2mm; }

.rap .meta { display:flex; gap:2mm; margin-bottom:2mm; }
.rap .fld { flex:1; border:.35mm solid #777; padding:.9mm 1.6mm; min-height:9mm; }
.rap .fld.w2 { flex:2; }
.rap .fld .lb { font-size:6.6pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }
.rap .fld .vl { font-size:11pt; font-weight:700; margin-top:.7mm;
  font-variant-numeric:tabular-nums; }

/* belka sekcji — nadrzędna, więc o ton ciemniejsza od nagłówka tabeli */
.rap .cap { font-size:7.2pt; font-weight:700; text-transform:uppercase; letter-spacing:.06em;
  background:#dcdcdc; border:.28mm solid #8c8c8c; border-bottom:0; padding:1mm 1.6mm; }
.rap .blk { margin-top:2.4mm; }
.rap table { width:100%; border-collapse:collapse; }
.rap th { background:#ededed; color:#1a1a1a; font-size:6.8pt; font-weight:700;
  text-transform:uppercase; letter-spacing:.03em; border:.28mm solid #8c8c8c;
  padding:1mm .8mm; text-align:center; vertical-align:middle; }
.rap td { border:.28mm solid #8c8c8c; padding:1mm .8mm; text-align:center;
  font-size:8pt; font-variant-numeric:tabular-nums; }
.rap td.l { text-align:left; }
.rap td.r { text-align:right; }
.rap td.lab { background:#f2f2f2; font-weight:700; text-align:left; }
.rap tr.tot td { background:#ededed; font-weight:700; }

/* pola podpisu — puste, czysto białe, jak kratki do wypełnienia w kartach */
.rap .sg { display:flex; gap:3mm; margin-top:2.4mm; }
.rap .sgbox { flex:1; border:.35mm solid #777; padding:1.2mm 2mm; min-height:14mm; background:#fff; }
.rap .sgbox.w2 { flex:2; }
.rap .sgbox .lb { font-size:6.6pt; font-weight:700; text-transform:uppercase;
  letter-spacing:.04em; color:#555; }

.rap .foot { display:flex; justify-content:space-between; margin-top:2.4mm;
  font-size:6.8pt; font-weight:700; color:#333; letter-spacing:.04em; }
.rap .foot .l { font-weight:400; color:#555; }
`

interface ReportData {
  date:     string
  sessions: DeboningSession[]
  batches:  RawBatch[]
  /** Zbiorcze ważenie ubocznych (batch_byproducts) — grzbiety/kości NA PARTIĘ. */
  zb:       BatchByproducts[]
  /** Wszystkie dni z produkcją — z nich liczony jest porządkowy numer karty. */
  productionDates: string[]
}

function SingleReport({ data }: { data: ReportData }) {
  const { date, sessions, batches, zb, productionDates } = data

  // Grupy per partia + doliczenie ZBIORCZYCH grzbietów/kości z batch_byproducts
  // (per-wpis kgBacks/kgBones są zerowe w tym flow — prod 2026-07-10, partia 407).
  // Partia rozbierana w kilka dni: zbiorcza kwota dzielona proporcjonalnie do
  // ćwiartki z TEGO dnia (jednodniowa partia = pełna kwota).
  const rows = useMemo(() => {
    const map = new Map<string, { batch: RawBatch | undefined; sessions: DeboningSession[] }>()
    sessions.forEach(s => {
      const key = s.rawBatchId || s.rawBatchNo || 'unknown'
      if (!map.has(key)) {
        const batch = batches.find(b => b.id === s.rawBatchId || b.internalBatchNo === s.rawBatchNo)
        map.set(key, { batch, sessions: [] })
      }
      map.get(key)!.sessions.push(s)
    })
    return Array.from(map.values()).map(({ batch, sessions: bs }) => {
      const taken = bs.reduce((s, x) => s + Number(x.kgTaken), 0)
      const meat  = bs.reduce((s, x) => s + Number(x.kgMeat), 0)
      let backs = bs.reduce((s, x) => s + Number(x.kgBacks || 0), 0)
      let bones = bs.reduce((s, x) => s + Number(x.kgBones || 0), 0)
      const first = bs[0] as any
      const rec = zb.find(z =>
        (batch && z.rawBatchId === batch.id) || z.rawBatchNo === (batch?.internalBatchNo || first?.rawBatchNo))
      if (rec) {
        const share = rec.quarterKg > 0 ? Math.min(1, taken / rec.quarterKg) : 1
        backs += (rec.backsKg ?? 0) * share
        bones += (rec.bonesKg ?? 0) * share
      }
      const bilans = taken - meat - bones - backs
      const kat3    = Math.max(0, bilans)
      // Nadwyżka rozbiorowa: suma frakcji > waga z dokumentu dostawcy
      // (woda z chłodzenia / niedoważenie dostawcy) — dokumentujemy, nie ukrywamy.
      const surplus = Math.max(0, -bilans)
      return { batch, sessions: bs, taken, meat, backs, bones, kat3, surplus }
    })
  }, [sessions, batches, zb])

  const summary = useMemo(() => {
    const totalTaken = rows.reduce((s, r) => s + r.taken, 0)
    const totalMeat  = rows.reduce((s, r) => s + r.meat, 0)
    const totalBacks = rows.reduce((s, r) => s + r.backs, 0)
    const totalBones = rows.reduce((s, r) => s + r.bones, 0)
    // Sumy per partia (bez nettowania: ubytek partii A nie znosi nadwyżki B).
    const uppzKat3   = rows.reduce((s, r) => s + r.kat3, 0)
    const surplus    = rows.reduce((s, r) => s + r.surplus, 0)
    return { totalTaken, totalMeat, totalBacks, totalBones, uppzKat3, surplus, loss: 0 }
  }, [rows])

  // Numer raportu: R/nr/MM/RR — JEDEN dzień produkcyjny = JEDEN numer, liczony
  // PORZĄDKOWO (dzień bez produkcji nie robi dziury), reset z nowym miesiącem.
  // Decyzja właściciela 2026-07-16, poprawka numeracji 2026-08-04.
  const reportNo = haccpReportNo(date, productionDates)

  return (
    <div className="rap" style={{ pageBreakAfter: 'always' }}>
      <style>{DOC_CSS}</style>

      {/* logo-ksiezyc-print.png, nie logo-ksiezyc.png: wariant do druku jest
          poziomy (2779×379) i przy 10 mm wysokości mieści się w pasku nagłówka
          — ten sam plik i ta sama wysokość co w karcie temperatur. */}
      <div className="top">
        <img src="/logo-ksiezyc-print.png" alt="Księżyc" />
        <div className="plant">
          <div className="nm">F.H.U.P. MAREK KSIĘŻYC — ZAKŁAD ROZBIORU DROBIU</div>
          <div className="ad">ul. Księdza Kardynała Albina Dunajewskiego 83, 32-064 Rudawa</div>
        </div>
      </div>
      <div className="rule" />

      <h1>Raport rozbioru</h1>
      <div className="sub">
        Zapis dnia produkcyjnego — masa surowca, uzysk i rozliczenie partii
      </div>

      <div className="meta">
        <div className="fld"><div className="lb">Nr raportu</div><div className="vl">{reportNo}</div></div>
        <div className="fld"><div className="lb">Data produkcji</div><div className="vl">{fmtDatePl(date)}</div></div>
        <div className="fld"><div className="lb">Edycja</div><div className="vl">2</div></div>
      </div>

      <div className="blk">
        <div className="cap">Podsumowanie dnia — {fmtDatePl(date)}</div>
      <table>
        <tbody>
          {[
            { label: 'Masa surowców do rozbioru', val: summary.totalTaken },
            { label: 'Mięso Z/S',                 val: summary.totalMeat  },
            { label: 'Grzbiety',                   val: summary.totalBacks },
            { label: 'Kości',                       val: summary.totalBones },
            { label: 'UPPZ kat. 3 lub/i Kat 2',    val: summary.uppzKat3   },
            { label: 'Nadwyżka rozbiorowa (ponad wagę z dok. dostawcy)', val: summary.surplus },
            { label: 'Strata produkcyjna',           val: summary.loss       },
          ].map(row => (
            <tr key={row.label}>
              <td className="lab" style={{ width: '55%' }}>{row.label}</td>
              <td className="r" style={{ fontWeight: 700, fontSize: '9pt' }}>{fmtKg(row.val, 2)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="blk">
        <div className="cap">Szczegóły rozbioru wg partii</div>
      <table>
        <thead>
          <tr>
            {/* „Numer porządkowy" (dawniej „Nr partii"): docelowo cały proces
                (przyjęcie→rozbiór) będzie miał numer porządkowy, a numer partii
                dostanie tylko wyrób gotowy i sprzedane uboczne/mięso. Na razie
                zmiana TYLKO opisu na dokumencie (decyzja 2026-07-16). */}
            {['Numer porządkowy','Nr partii dostawcy','Dostawca','Data uboju','Data ważności','Ćwiartka kg','Mięso Z/S kg','Grzbiety kg','Kości kg','UPPZ kat.3','Nadwyżka kg'].map(h => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ batch, sessions: bs, taken, meat, backs, bones, kat3, surplus }, idx) => {
            const firstSession  = bs[0] as any
            const internalBatchNo = batch?.internalBatchNo  || firstSession?.rawBatchNo  || '—'
            const supplierBatchNo = batch?.supplierBatchNo  || firstSession?.supplierBatchNo || '—'
            const supplierName    = batch?.supplierName     || firstSession?.supplierName    || '—'
            const slaughterDate   = batch?.slaughterDate    || firstSession?.slaughterDate   || ''
            const expiryDate      = batch?.expiryDate       || firstSession?.expiryDate      || ''
            return (
              <tr key={idx}>
                <td style={{ fontWeight: 700, fontSize: '9pt' }}>{internalBatchNo}</td>
                <td>{supplierBatchNo}</td>
                <td className="l">{supplierName}</td>
                <td>{slaughterDate ? fmtDatePl(slaughterDate) : '—'}</td>
                <td>{expiryDate ? fmtDatePl(expiryDate) : '—'}</td>
                <td className="r" style={{ fontWeight: 600 }}>{fmtKg(taken, 2)}</td>
                <td className="r" style={{ fontWeight: 700 }}>{fmtKg(meat, 2)}</td>
                <td className="r">{fmtKg(backs, 2)}</td>
                <td className="r">{fmtKg(bones, 2)}</td>
                <td className="r">{fmtKg(kat3, 2)}</td>
                <td className="r">{surplus > 0 ? `+${fmtKg(surplus, 2)}` : '—'}</td>
              </tr>
            )
          })}
          <tr className="tot">
            <td className="l" colSpan={5}>SUMA</td>
            <td className="r">{fmtKg(summary.totalTaken, 2)}</td>
            <td className="r">{fmtKg(summary.totalMeat, 2)}</td>
            <td className="r">{fmtKg(summary.totalBacks, 2)}</td>
            <td className="r">{fmtKg(summary.totalBones, 2)}</td>
            <td className="r">{fmtKg(summary.uppzKat3, 2)}</td>
            <td className="r">{summary.surplus > 0 ? `+${fmtKg(summary.surplus, 2)}` : '—'}</td>
          </tr>
        </tbody>
      </table>
      </div>

      <div className="sg">
        <div className="sgbox"><div className="lb">Wykonał — data i podpis</div></div>
        <div className="sgbox"><div className="lb">Sprawdził — data i podpis</div></div>
        <div className="sgbox w2"><div className="lb">Uwagi</div></div>
      </div>

      <div className="foot">
        <span className="l">Przechowywanie zapisu: min. 1 rok</span>
        <span>Karta 2.1.1 do instrukcji 2.1 — operacyjne programy warunków wstępnych (oPRP)</span>
      </div>
    </div>
  )
}

export function HaccpReportPage() {
  const { data: debData,   loading: debLoading  } = useApi(() => deboningApi.list())
  const { data: batchData, loading: batchLoading } = useApi<{ data: any[] }>(() => (rawBatchesApi as any).all())
  const { data: supplierData }                     = useApi(() => suppliersApi.list())
  // Zbiorcze grzbiety/kości NA PARTIĘ — raport musi je doliczać (per-wpis = 0).
  const { data: zbData }                           = useApi(() => byproductsApi.list())

  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [filterBatch,    setFilterBatch]    = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [selectedDates,  setSelectedDates]  = useState<Set<string>>(new Set())
  const [previewDate,    setPreviewDate]    = useState<string | null>(null)

  const allBatches  = (batchData?.data ?? []) as RawBatch[]
  const allSessions = (debData?.data ?? []) as DeboningSession[]
  const suppliers   = supplierData ?? []

  const sessionsByDate = useMemo(() => {
    const map = new Map<string, DeboningSession[]>()
    allSessions.forEach(s => {
      const date = s.createdAt.slice(0, 10)
      if (!map.has(date)) map.set(date, [])
      map.get(date)!.push(s)
    })
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]))
  }, [allSessions])

  // Numer karty liczymy z PEŁNEJ listy dni produkcyjnych — gdyby brać
  // filteredDates, ustawienie filtra partii zmieniałoby numery na wydruku.
  const productionDates = useMemo(() => sessionsByDate.map(([d]) => d), [sessionsByDate])

  const filteredDates = useMemo(() => {
    return sessionsByDate.filter(([date, daySessions]) => {
      if (dateFrom && date < dateFrom) return false
      if (dateTo   && date > dateTo)   return false
      if (filterBatch) {
        const ok = daySessions.some(s => s.rawBatchNo?.toLowerCase().includes(filterBatch.toLowerCase()))
        if (!ok) return false
      }
      if (filterSupplier) {
        const ok = daySessions.some(s => {
          const b = allBatches.find(x => x.id === s.rawBatchId)
          return b?.supplierId === filterSupplier || (s as any).supplierName === filterSupplier
        })
        if (!ok) return false
      }
      return true
    })
  }, [sessionsByDate, dateFrom, dateTo, filterBatch, filterSupplier, allBatches])

  const toggleDate  = (d: string) => setSelectedDates(p => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n })
  const selectAll   = () => setSelectedDates(new Set(filteredDates.map(([d]) => d)))
  const deselectAll = () => setSelectedDates(new Set())

  const handlePrint = () => {
    const s = document.createElement('style'); s.textContent = printStyles; document.head.appendChild(s)
    window.print()
    setTimeout(() => document.head.removeChild(s), 2000)
  }

  if (debLoading || batchLoading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Card><CardContent className="p-4 space-y-3">{[0,1,2,3].map(i => <Skeleton key={i} className="h-8 w-full" />)}</CardContent></Card>
        <Card><CardContent className="p-4 space-y-3">{[0,1,2,3,4].map(i => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
      </div>
    )
  }

  const selectedReports = filteredDates.filter(([d]) => selectedDates.has(d))
  const previewData     = previewDate ? filteredDates.find(([d]) => d === previewDate) : null

  return (
    <div className="space-y-5 animate-fade-in">
      <style>{printStyles}</style>

      {/* Filtry */}
      <Card className="no-print">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Filtry raportów</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="space-y-1.5">
              <Label>Data od</Label>
              <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Data do</Label>
              <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Nr partii</Label>
              <Input placeholder="np. R171" value={filterBatch} onChange={e => setFilterBatch(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Dostawca</Label>
              <Select value={filterSupplier || '__all'} onValueChange={v => setFilterSupplier(v === '__all' ? '' : v)}>
                <SelectTrigger><SelectValue placeholder="Wszyscy" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all">Wszyscy</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Lista dni */}
      <Card className="no-print">
        <div className="flex items-center justify-between px-5 py-3 border-b">
          <div className="flex items-center gap-4">
            <CardTitle className="text-sm font-semibold">{filteredDates.length} dni rozbioru</CardTitle>
            <Button variant="ghost" size="sm" onClick={selectAll} className="gap-1.5 text-xs text-primary h-7">
              <CheckSquare size={12} /> Zaznacz wszystkie
            </Button>
            <Button variant="ghost" size="sm" onClick={deselectAll} className="gap-1.5 text-xs h-7">
              <Square size={12} /> Odznacz
            </Button>
          </div>
          {selectedDates.size > 0 && (
            <Button size="sm" onClick={handlePrint} className="gap-1.5">
              <Printer size={13} /> Drukuj ({selectedDates.size})
            </Button>
          )}
        </div>
        <CardContent className="p-0">
          {filteredDates.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <FileText size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak raportów</CardTitle>
              <CardDescription>Brak danych rozbioru dla wybranych filtrów</CardDescription>
            </div>
          ) : (
            <div className="divide-y">
              {filteredDates.map(([date, daySessions]) => {
                const taken  = daySessions.reduce((s, x) => s + Number(x.kgTaken), 0)
                const meat   = daySessions.reduce((s, x) => s + Number(x.kgMeat), 0)
                const isSel  = selectedDates.has(date)

                const batchMap = new Map<string, { no: string; supplier: string; slaughter: string }>()
                daySessions.forEach(s => {
                  const key = s.rawBatchNo || s.rawBatchId || 'x'
                  if (batchMap.has(key)) return
                  const b  = allBatches.find(x => x.id === s.rawBatchId)
                  const ss = s as any
                  batchMap.set(key, {
                    no:        b?.internalBatchNo || ss.rawBatchNo     || '—',
                    supplier:  b?.supplierName    || ss.supplierName   || '—',
                    slaughter: b?.slaughterDate   || ss.slaughterDate  || '',
                  })
                })
                const batchList = Array.from(batchMap.values())

                return (
                  <div
                    key={date}
                    className={`flex items-start gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors ${isSel ? 'bg-primary/5' : ''}`}
                    onClick={() => toggleDate(date)}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {isSel
                        ? <CheckSquare size={16} className="text-primary" />
                        : <Square size={16} className="text-muted-foreground" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <CardTitle className="text-sm">{fmtDatePl(date)}</CardTitle>
                        <CardDescription className="text-xs">{daySessions.length} wpisów</CardDescription>
                        <Badge variant="info" className="text-xs">
                          {fmtKg(taken)} kg ćw. → {fmtKg(meat)} kg mięsa
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {batchList.map((b, i) => (
                          <span key={i} className="text-[10px] bg-muted px-2 py-0.5 rounded flex items-center gap-1">
                            <code className="font-mono font-bold text-primary">{b.no}</code>
                            {b.supplier !== '—' && <CardDescription className="text-[10px]">· {b.supplier}</CardDescription>}
                            {b.slaughter && <CardDescription className="text-[10px]">· ubój: {fmtDatePl(b.slaughter)}</CardDescription>}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs flex-shrink-0"
                      onClick={e => { e.stopPropagation(); setPreviewDate(previewDate === date ? null : date) }}
                    >
                      Podgląd
                    </Button>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Podgląd raportu */}
      {previewDate && previewData && (
        <div id="haccp-report">
          <Card className="no-print">
            <div className="flex items-center justify-between px-5 py-3 border-b">
              <CardTitle className="text-sm">Podgląd — {fmtDatePl(previewDate)}</CardTitle>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setPreviewDate(null)}>Zamknij</Button>
                <Button size="sm" onClick={handlePrint} className="gap-1.5">
                  <Printer size={13} /> Drukuj
                </Button>
              </div>
            </div>
          </Card>
          <SingleReport data={{ date: previewDate, sessions: previewData[1], batches: allBatches, zb: zbData ?? [], productionDates }} />
        </div>
      )}

      {/* Raporty do druku */}
      {selectedReports.length > 0 && (
        <div id="haccp-report" className="hidden print:block">
          {selectedReports.map(([date, daySessions]) => (
            <SingleReport key={date} data={{ date, sessions: daySessions, batches: allBatches, zb: zbData ?? [], productionDates }} />
          ))}
        </div>
      )}
    </div>
  )
}
