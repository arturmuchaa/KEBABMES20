/**
 * HaccpReportPage — Raport HACCP z pełną traceability
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { deboningApi, rawBatchesApi, suppliersApi, byproductsApi, type BatchByproducts } from '@/lib/apiClient'
import { fmtKg, fmtDatePl } from '@/lib/utils'
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
  /* Wąskie marginesy (prośba właściciela 2026-07-16) — 5 mm zamiast 10 mm;
     ekranowy padding p-6 dokumentu zerowany w druku, żeby nie dublował ramki. */
  @page { size: A4 portrait; margin: 5mm; }
  body * { visibility: hidden; }
  #haccp-report, #haccp-report * { visibility: visible; }
  #haccp-report { position: absolute; left: 0; top: 0; width: 100%; font-size: 10px; }
  #haccp-report .p-6 { padding: 0 !important; }
  .no-print { display: none !important; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #000; padding: 3px 6px; }
  th { background: #e5e5e5 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}
`

interface ReportData {
  date:     string
  sessions: DeboningSession[]
  batches:  RawBatch[]
  /** Zbiorcze ważenie ubocznych (batch_byproducts) — grzbiety/kości NA PARTIĘ. */
  zb:       BatchByproducts[]
}

function SingleReport({ data }: { data: ReportData }) {
  const { date, sessions, batches, zb } = data

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

  // Numer raportu: R/dzień/MM/RR — JEDEN dzień = JEDEN numer (numer = dzień
  // miesiąca: 16.07.2026 → R/16/07/26), kolejny dzień = kolejny numer, reset
  // z nowym miesiącem. Decyzja właściciela 2026-07-16 (wcześniej licznik
  // sesji dnia, mylony z liczbą wpisów).
  const reportNo = `R/${parseInt(date.slice(8, 10), 10)}/${date.slice(5, 7)}/${date.slice(2, 4)}`

  return (
    <div className="bg-white p-6 mb-4" style={{ pageBreakAfter: 'always' }}>
      {/* Logo Księżyc NAD ramkami nagłówka (poza tabelą) — tabela zostaje
          w pełnej szerokości jak pierwotnie. Plik 3667×1267 px (poziome ze
          sloganem) — 52 px wysokości = ~150 px szerokości, czytelne w druku. */}
      <img src="/logo-ksiezyc.png" alt="Księżyc" className="mb-2"
        style={{ height: 52, width: 'auto' }} />
      <table className="w-full text-xs mb-4" style={{ borderCollapse: 'collapse' }}>
          <tbody>
            <tr>
              <td className="border border-black p-2" rowSpan={2} style={{ width: '40%' }}>
                <div className="font-bold text-sm">FHUP Marek Księżyc</div>
                <div className="text-[10px]">ul. Dunajewskiego 83, 32-064 Rudawa</div>
              </td>
              <td className="border border-black p-2 text-center font-bold" rowSpan={2}>Raport rozbioru</td>
              <td className="border border-black p-1 text-center" style={{ width: '15%' }}>
                <div className="text-[9px] text-gray-600">Numer</div>
                <div className="font-bold">{reportNo}</div>
              </td>
              <td className="border border-black p-1 text-center" style={{ width: '15%' }}>
                <div className="text-[9px] text-gray-600">Data</div>
                <div className="font-bold">{fmtDatePl(date)}</div>
              </td>
            </tr>
            <tr>
              <td className="border border-black p-1 text-center" colSpan={2}>
                <span className="text-[9px] text-gray-600">Edycja 2</span>
              </td>
            </tr>
          </tbody>
      </table>

      <div className="font-bold text-[10px] mb-1 bg-gray-200 p-1 border border-black">
        PODSUMOWANIE DNIA — {fmtDatePl(date)}
      </div>
      <table className="w-full text-[10px] mb-4" style={{ borderCollapse: 'collapse' }}>
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
              <td className="border border-black p-1 bg-gray-100 font-semibold" style={{ width: '50%' }}>{row.label}</td>
              <td className="border border-black p-1 text-right font-bold">{fmtKg(row.val, 2)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="font-bold text-[10px] mb-1 bg-gray-200 p-1 border border-black">
        SZCZEGÓŁY ROZBIORU WG PARTII
      </div>
      <table className="w-full text-[9px] mb-4" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="bg-gray-200">
            {/* „Numer porządkowy" (dawniej „Nr partii"): docelowo cały proces
                (przyjęcie→rozbiór) będzie miał numer porządkowy, a numer partii
                dostanie tylko wyrób gotowy i sprzedane uboczne/mięso. Na razie
                zmiana TYLKO opisu na dokumencie (decyzja 2026-07-16). */}
            {['Numer porządkowy','Nr partii dostawcy','Dostawca','Data uboju','Data ważności','Ćwiartka kg','Mięso Z/S kg','Grzbiety kg','Kości kg','UPPZ kat.3','Nadwyżka kg'].map(h => (
              <th key={h} className="border border-black p-1 text-left">{h}</th>
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
              <tr key={idx} className={idx % 2 === 0 ? '' : 'bg-gray-50'}>
                <td className="border border-black p-1 font-bold text-[10px]">{internalBatchNo}</td>
                <td className="border border-black p-1 font-mono">{supplierBatchNo}</td>
                <td className="border border-black p-1">{supplierName}</td>
                <td className="border border-black p-1">{slaughterDate ? fmtDatePl(slaughterDate) : '—'}</td>
                <td className="border border-black p-1">{expiryDate ? fmtDatePl(expiryDate) : '—'}</td>
                <td className="border border-black p-1 text-right font-semibold">{fmtKg(taken, 2)}</td>
                <td className="border border-black p-1 text-right font-bold">{fmtKg(meat, 2)}</td>
                <td className="border border-black p-1 text-right">{fmtKg(backs, 2)}</td>
                <td className="border border-black p-1 text-right">{fmtKg(bones, 2)}</td>
                <td className="border border-black p-1 text-right">{fmtKg(kat3, 2)}</td>
                <td className="border border-black p-1 text-right">{surplus > 0 ? `+${fmtKg(surplus, 2)}` : '—'}</td>
              </tr>
            )
          })}
          <tr className="bg-gray-100 font-bold">
            <td className="border border-black p-1" colSpan={5}>SUMA</td>
            <td className="border border-black p-1 text-right">{fmtKg(summary.totalTaken, 2)}</td>
            <td className="border border-black p-1 text-right">{fmtKg(summary.totalMeat, 2)}</td>
            <td className="border border-black p-1 text-right">{fmtKg(summary.totalBacks, 2)}</td>
            <td className="border border-black p-1 text-right">{fmtKg(summary.totalBones, 2)}</td>
            <td className="border border-black p-1 text-right">{fmtKg(summary.uppzKat3, 2)}</td>
            <td className="border border-black p-1 text-right">{summary.surplus > 0 ? `+${fmtKg(summary.surplus, 2)}` : '—'}</td>
          </tr>
        </tbody>
      </table>

      <table className="w-full text-[10px]" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td className="border border-black p-1 bg-gray-100 font-semibold" style={{ width: '12%' }}>Wykonał:</td>
            <td className="border border-black p-1 h-8" style={{ width: '38%' }}></td>
            <td className="border border-black p-1 bg-gray-100 font-semibold" style={{ width: '12%' }}>Sprawdził:</td>
            <td className="border border-black p-1 h-8" style={{ width: '38%' }}></td>
          </tr>
          <tr>
            <td className="border border-black p-1 bg-gray-100 font-semibold">Uwagi:</td>
            <td className="border border-black p-1 h-10" colSpan={3}></td>
          </tr>
        </tbody>
      </table>

      <div className="mt-2 text-[8px] text-gray-500 border-t pt-1">
        <span>2.1.1 Raport z rozbioru</span>
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
          <SingleReport data={{ date: previewDate, sessions: previewData[1], batches: allBatches, zb: zbData ?? [] }} />
        </div>
      )}

      {/* Raporty do druku */}
      {selectedReports.length > 0 && (
        <div id="haccp-report" className="hidden print:block">
          {selectedReports.map(([date, daySessions]) => (
            <SingleReport key={date} data={{ date, sessions: daySessions, batches: allBatches, zb: zbData ?? [] }} />
          ))}
        </div>
      )}
    </div>
  )
}
