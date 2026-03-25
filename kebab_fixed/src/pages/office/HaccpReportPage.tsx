/**
 * HaccpReportPage — Raport HACCP z pełną traceability
 * Dane: deboningApi.list() → entriesAsSessions (zawiera supplierName, supplierBatchNo, slaughterDate)
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { deboningApi, rawBatchesApi, suppliersApi } from '@/lib/apiClient'
import { Spinner, EmptyState } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { Printer, FileText, Calendar, CheckSquare, Square } from 'lucide-react'
import type { DeboningSession, RawBatch } from '@/types'

const printStyles = `
@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body * { visibility: hidden; }
  #haccp-report, #haccp-report * { visibility: visible; }
  #haccp-report { position: absolute; left: 0; top: 0; width: 100%; font-size: 10px; }
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
}

function SingleReport({ data }: { data: ReportData }) {
  const { date, sessions, batches } = data

  // Grupuj sesje po rawBatchId
  const sessionsByBatch = useMemo(() => {
    const map = new Map<string, { batch: RawBatch | undefined; sessions: DeboningSession[] }>()
    sessions.forEach(s => {
      const key = s.rawBatchId || s.rawBatchNo || 'unknown'
      if (!map.has(key)) {
        // Szukaj batcha zarówno po id jak po internalBatchNo (dla entriesAsSessions)
        const batch = batches.find(b => b.id === s.rawBatchId || b.internalBatchNo === s.rawBatchNo)
        map.set(key, { batch, sessions: [] })
      }
      map.get(key)!.sessions.push(s)
    })
    return Array.from(map.values())
  }, [sessions, batches])

  const summary = useMemo(() => {
    const totalTaken = sessions.reduce((s, x) => s + Number(x.kgTaken), 0)
    const totalMeat  = sessions.reduce((s, x) => s + Number(x.kgMeat), 0)
    const totalBacks = sessions.reduce((s, x) => s + Number(x.kgBacks || 0), 0)
    const totalBones = sessions.reduce((s, x) => s + Number(x.kgBones || 0), 0)
    const uppzKat3   = Math.max(0, totalTaken - totalMeat - totalBones - totalBacks)
    return { totalTaken, totalMeat, totalBacks, totalBones, uppzKat3, loss: 0 }
  }, [sessions])

  const reportNo = sessions.length > 0
    ? sessions[0].sessionNo?.split('-')[2] || '001'
    : '001'

  return (
    <div className="bg-white p-6 mb-4" style={{ pageBreakAfter: 'always' }}>
      {/* NAGŁÓWEK */}
      <table className="w-full text-xs mb-4" style={{ borderCollapse: 'collapse' }}>
        <tbody>
          <tr>
            <td className="border border-black p-2" rowSpan={2} style={{ width: '40%' }}>
              <div className="font-bold text-sm">FHUP Marek Księżyc</div>
              <div className="text-[10px]">ul. Dunajewskiego 83, 32-064 Rudawa</div>
            </td>
            <td className="border border-black p-2 text-center font-bold" rowSpan={2}>
              Raport rozbioru
            </td>
            <td className="border border-black p-1 text-center" style={{ width: '15%' }}>
              <div className="text-[9px] text-gray-600">Numer</div>
              <div className="font-bold">R/{reportNo}</div>
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

      {/* PODSUMOWANIE DNIA */}
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
            { label: 'Strata produkcyjna',           val: summary.loss       },
          ].map(row => (
            <tr key={row.label}>
              <td className="border border-black p-1 bg-gray-100 font-semibold" style={{ width: '50%' }}>{row.label}</td>
              <td className="border border-black p-1 text-right font-bold">{fmtKg(row.val, 2)} kg</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* SZCZEGÓŁY WG PARTII — z pełną traceability */}
      <div className="font-bold text-[10px] mb-1 bg-gray-200 p-1 border border-black">
        SZCZEGÓŁY ROZBIORU WG PARTII
      </div>
      <table className="w-full text-[9px] mb-4" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr className="bg-gray-200">
            <th className="border border-black p-1 text-left">Nr partii</th>
            <th className="border border-black p-1 text-left">Nr partii dostawcy</th>
            <th className="border border-black p-1 text-left">Dostawca</th>
            <th className="border border-black p-1 text-left">Data uboju</th>
            <th className="border border-black p-1 text-left">Data ważności</th>
            <th className="border border-black p-1 text-right">Ćwiartka kg</th>
            <th className="border border-black p-1 text-right">Mięso Z/S kg</th>
            <th className="border border-black p-1 text-right">Grzbiety kg</th>
            <th className="border border-black p-1 text-right">Kości kg</th>
            <th className="border border-black p-1 text-right">UPPZ kat.3</th>
          </tr>
        </thead>
        <tbody>
          {sessionsByBatch.map(({ batch, sessions: bs }, idx) => {
            const taken = bs.reduce((s, x) => s + Number(x.kgTaken), 0)
            const meat  = bs.reduce((s, x) => s + Number(x.kgMeat), 0)
            const backs = bs.reduce((s, x) => s + Number(x.kgBacks || 0), 0)
            const bones = bs.reduce((s, x) => s + Number(x.kgBones || 0), 0)
            const kat3  = Math.max(0, taken - meat - bones - backs)

            // Pobierz dane traceability:
            // 1. Z batch (RawBatch) jeśli znaleziony
            // 2. Fallback z session (entriesAsSessions ma supplierName, supplierBatchNo, slaughterDate)
            const firstSession  = bs[0] as any
            const internalBatchNo  = batch?.internalBatchNo  || firstSession?.rawBatchNo  || '—'
            const supplierBatchNo  = batch?.supplierBatchNo  || firstSession?.supplierBatchNo || '—'
            const supplierName     = batch?.supplierName     || firstSession?.supplierName    || '—'
            const slaughterDate    = batch?.slaughterDate    || firstSession?.slaughterDate   || ''
            const expiryDate       = batch?.expiryDate       || firstSession?.expiryDate      || ''

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
          </tr>
        </tbody>
      </table>

      {/* PRACOWNICY */}
      {(() => {
        const workers = [...new Set(sessions.map(s => s.workerName).filter(Boolean))]
        return workers.length > 0 ? (
          <div className="mb-3">
            <div className="font-bold text-[10px] mb-1 bg-gray-200 p-1 border border-black">PRACOWNICY</div>
            <div className="border border-black p-1 text-[10px]">{workers.join(', ')}</div>
          </div>
        ) : null
      })()}

      {/* PODPISY */}
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

      <div className="mt-2 flex justify-between text-[8px] text-gray-500 border-t pt-1">
        <span>2.1.1 Raport z rozbioru</span>
        <span>Edycja 2 · {new Date().toLocaleDateString('pl-PL')}</span>
      </div>
    </div>
  )
}

export function HaccpReportPage() {
  const { data: debData,      loading: debLoading  } = useApi(() => deboningApi.list())
  const { data: batchData,    loading: batchLoading } = useApi(() => (rawBatchesApi as any).all())
  const { data: supplierData }                        = useApi(() => suppliersApi.list())

  const [dateFrom,       setDateFrom]       = useState('')
  const [dateTo,         setDateTo]         = useState('')
  const [filterBatch,    setFilterBatch]    = useState('')
  const [filterSupplier, setFilterSupplier] = useState('')
  const [selectedDates,  setSelectedDates]  = useState<Set<string>>(new Set())
  const [previewDate,    setPreviewDate]    = useState<string | null>(null)

  // Mięso nieprzetworzone (active batches) — do listy w filtrze
  const allBatches  = (batchData?.data ?? []) as RawBatch[]
  // Wszystkie sesje rozbioru (stare + nowe z tabletu — zmapowane przez deboningApi.list())
  const allSessions = (debData?.data ?? []) as DeboningSession[]
  const suppliers   = supplierData ?? []

  // Grupuj sesje po dacie
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

  const toggleDate   = (d: string) => setSelectedDates(p => { const n = new Set(p); n.has(d) ? n.delete(d) : n.add(d); return n })
  const selectAll    = () => setSelectedDates(new Set(filteredDates.map(([d]) => d)))
  const deselectAll  = () => setSelectedDates(new Set())

  const handlePrint = () => {
    const s = document.createElement('style'); s.textContent = printStyles; document.head.appendChild(s)
    window.print()
    setTimeout(() => document.head.removeChild(s), 2000)
  }

  if (debLoading || batchLoading) return <div className="flex justify-center py-16"><Spinner size={24} /></div>

  const selectedReports = filteredDates.filter(([d]) => selectedDates.has(d))
  const previewData     = previewDate
    ? filteredDates.find(([d]) => d === previewDate)
    : null

  return (
    <div className="space-y-4 animate-fade-in">
      <style>{printStyles}</style>

      {/* Filtry */}
      <div className="bg-white border border-surface-4 shadow-card p-4 no-print">
        <div className="text-[13px] font-semibold text-ink mb-3">Filtry raportów</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Data od</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Data do</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Nr partii</label>
            <input type="text" placeholder="np. R171" value={filterBatch}
              onChange={e => setFilterBatch(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Dostawca</label>
            <select value={filterSupplier} onChange={e => setFilterSupplier(e.target.value)}
              className="w-full h-8 px-2 text-sm border border-surface-4 focus:outline-none focus:border-brand">
              <option value="">Wszyscy</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      {/* Lista dni */}
      <div className="bg-white border border-surface-4 shadow-card no-print">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-semibold text-ink">
              {filteredDates.length} dni rozbioru
            </span>
            <button onClick={selectAll}
              className="text-[11px] font-medium text-brand hover:underline flex items-center gap-1">
              <CheckSquare size={12} /> Zaznacz wszystkie
            </button>
            <button onClick={deselectAll}
              className="text-[11px] font-medium text-ink-3 hover:underline flex items-center gap-1">
              <Square size={12} /> Odznacz
            </button>
          </div>
          <div className="flex gap-2">
            {selectedDates.size > 0 && (
              <Button size="sm" icon={<Printer size={13} />} onClick={handlePrint}>
                Drukuj ({selectedDates.size})
              </Button>
            )}
          </div>
        </div>

        {filteredDates.length === 0 ? (
          <EmptyState icon={<FileText size={32} />} title="Brak raportów"
            message="Brak danych rozbioru dla wybranych filtrów" />
        ) : (
          <div className="divide-y divide-surface-4">
            {filteredDates.map(([date, daySessions]) => {
              const taken    = daySessions.reduce((s, x) => s + Number(x.kgTaken), 0)
              const meat     = daySessions.reduce((s, x) => s + Number(x.kgMeat), 0)
              const isSel    = selectedDates.has(date)
              // Zbierz unikalne partie z pełnymi danymi
              const batchMap = new Map<string, { no: string; supplier: string; slaughter: string }>()
              daySessions.forEach(s => {
                const key  = s.rawBatchNo || s.rawBatchId || 'x'
                if (batchMap.has(key)) return
                const b    = allBatches.find(x => x.id === s.rawBatchId)
                const ss   = s as any
                batchMap.set(key, {
                  no:        b?.internalBatchNo   || ss.rawBatchNo        || '—',
                  supplier:  b?.supplierName      || ss.supplierName      || '—',
                  slaughter: b?.slaughterDate     || ss.slaughterDate     || '',
                })
              })
              const batchList = Array.from(batchMap.values())

              return (
                <div key={date}
                  className={`flex items-start gap-3 px-4 py-3 hover:bg-surface-2 cursor-pointer ${isSel ? 'bg-blue-50' : ''}`}
                  onClick={() => toggleDate(date)}
                >
                  <div className="mt-0.5 flex-shrink-0">
                    {isSel
                      ? <CheckSquare size={16} className="text-brand" />
                      : <Square size={16} className="text-ink-4" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] font-semibold text-ink">{fmtDatePl(date)}</span>
                      <span className="text-[11px] text-ink-3">{daySessions.length} wpisów</span>
                      <span className="text-[11px] font-semibold text-blue-700">{fmtKg(taken)} kg ćw. → {fmtKg(meat)} kg mięsa</span>
                    </div>
                    {/* Partie z traceability */}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {batchList.map((b, i) => (
                        <span key={i} className="text-[10px] bg-surface-3 px-2 py-0.5 rounded flex items-center gap-1">
                          <span className="font-mono font-bold text-brand">{b.no}</span>
                          {b.supplier !== '—' && <span className="text-ink-3">· {b.supplier}</span>}
                          {b.slaughter && <span className="text-ink-4">· ubój: {fmtDatePl(b.slaughter)}</span>}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={e => { e.stopPropagation(); setPreviewDate(previewDate === date ? null : date) }}
                      className="text-[11px] font-medium text-brand border border-brand/30 px-2 py-1 rounded hover:bg-blue-50"
                    >
                      Podgląd
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Podgląd raportu */}
      {previewDate && previewData && (
        <div id="haccp-report">
          <div className="no-print flex items-center justify-between mb-3">
            <span className="text-[13px] font-semibold text-ink">Podgląd — {fmtDatePl(previewDate)}</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setPreviewDate(null)}>Zamknij</Button>
              <Button size="sm" icon={<Printer size={13} />} onClick={handlePrint}>Drukuj</Button>
            </div>
          </div>
          <SingleReport data={{ date: previewDate, sessions: previewData[1], batches: allBatches }} />
        </div>
      )}

      {/* Raporty do druku (niewidoczne poza print) */}
      {selectedReports.length > 0 && (
        <div id="haccp-report" className="hidden print:block">
          {selectedReports.map(([date, daySessions]) => (
            <SingleReport key={date} data={{ date, sessions: daySessions, batches: allBatches }} />
          ))}
        </div>
      )}
    </div>
  )
}
