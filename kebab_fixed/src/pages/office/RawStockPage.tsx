/**
 * RawStockPage — Magazyn surowca (Mięso Z/S, Grzbiety, Kości).
 *
 * Trzy zakładki — każda dense table w stylu Subiekt GT:
 * sticky header/footer, zebra rows, sortowanie, filtr, CSV, klik → traceability.
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { meatStockApi, deboningApi, rawBatchesApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import {
  Eye, ArrowRight, Beef, Layers, Package, ChevronDown, ChevronUp,
  ChevronsUpDown, Search, X, Download,
} from 'lucide-react'
import type { MeatStock, DeboningSession, RawBatch } from '@/types'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'

// ─── ExpiryBadge ─────────────────────────────────────────────
function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  const cls =
    daysLeft < 0    ? 'bg-red-50 text-red-700 border-red-200' :
    daysLeft <= 1   ? 'bg-red-50 text-red-700 border-red-200' :
    daysLeft <= 3   ? 'bg-amber-50 text-amber-700 border-amber-200' :
                      'bg-emerald-50 text-emerald-700 border-emerald-200'
  const label =
    daysLeft < 0    ? 'wygasło' :
    daysLeft === 0  ? 'dziś' :
                      `${daysLeft}d`
  return <Badge variant="outline" className={cn('text-[10px] font-medium', cls)}>{label}</Badge>
}

// ─── TraceabilityModal (bez zmian funkcjonalnych) ────────────
interface TraceabilityModalProps {
  type: 'meat' | 'backs' | 'bones'
  item?: MeatStock
  session?: DeboningSession
  batch?: RawBatch
  onClose: () => void
}

function TraceabilityModal({ type, item, session, batch, onClose }: TraceabilityModalProps) {
  const title = type === 'meat' ? 'Śledzenie mięsa Z/S' : type === 'backs' ? 'Śledzenie grzbietów' : 'Śledzenie kości'
  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Pełna traceability partii od dostawcy do magazynu</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <CardDescription className="text-[10px] font-bold text-primary uppercase mb-1">Nasza partia</CardDescription>
              <CardTitle className="text-3xl font-black font-mono text-primary">
                {batch?.internalBatchNo || item?.rawBatchNo || '—'}
              </CardTitle>
            </CardContent>
          </Card>

          <div className="flex items-center gap-2 text-muted-foreground">
            {['DOSTAWCA','PRZYJĘCIE','ROZBIÓR','MAGAZYN'].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-2">
                <CardDescription className="text-xs font-semibold">{s}</CardDescription>
                {i < arr.length - 1 && <ArrowRight size={12} />}
              </span>
            ))}
          </div>

          <Separator />

          <div className="divide-y border rounded-xl overflow-hidden">
            {[
              { label: 'Dostawca',            value: batch?.supplierName || '—' },
              { label: 'Nr partii dostawcy',  value: <code className="font-mono font-bold">{batch?.supplierBatchNo || '—'}</code> },
              { label: 'Data uboju',          value: batch?.slaughterDate ? fmtDatePl(batch.slaughterDate) : '—' },
              { label: 'Data przyjęcia',      value: batch?.receivedDate  ? fmtDatePl(batch.receivedDate)  : '—' },
              { label: 'Data ważności',       value: batch?.expiryDate ? (
                <span className="flex items-center gap-2">{fmtDatePl(batch.expiryDate)}<ExpiryBadge date={batch.expiryDate} /></span>
              ) : '—' },
            ].map(row => (
              <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                <CardDescription className="text-sm font-medium">{row.label}</CardDescription>
                <div className="text-sm font-semibold">{row.value}</div>
              </div>
            ))}

            {session && (
              <>
                <div className="px-4 py-2 bg-muted/40">
                  <CardDescription className="text-[10px] font-bold uppercase tracking-wide">Sesja rozbioru</CardDescription>
                </div>
                {[
                  { label: 'Nr sesji',       value: <code className="font-mono">{session.sessionNo}</code> },
                  { label: 'Pracownik',      value: session.workerName },
                  { label: 'Data rozbioru',  value: fmtDatePl(session.createdAt?.slice(0, 10) || '') },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                    <CardDescription className="text-sm font-medium">{row.label}</CardDescription>
                    <div className="text-sm font-semibold">{row.value}</div>
                  </div>
                ))}
              </>
            )}

            {item && (
              <>
                <div className="px-4 py-2 bg-muted/40">
                  <CardDescription className="text-[10px] font-bold uppercase tracking-wide">Stan magazynowy</CardDescription>
                </div>
                {[
                  { label: 'Nr partii mięsa',   value: <code className="font-mono font-bold text-primary">{item.lotNo}</code> },
                  { label: 'Ilość początkowa',  value: <span className="font-bold">{fmtKg(item.kgInitial, 1)} kg</span> },
                  { label: 'Ilość dostępna',    value: <span className="font-bold text-emerald-700">{fmtKg(item.kgAvailable, 1)} kg</span> },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between px-4 py-2.5">
                    <CardDescription className="text-sm font-medium">{row.label}</CardDescription>
                    <div className="text-sm">{row.value}</div>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── CSV export ──────────────────────────────────────────────
function exportCsv(rows: any[], tab: 'meat' | 'backs' | 'bones', batches: RawBatch[]) {
  const getBatch = (it: any) => batches.find(b => b.id === (it.rawBatchId ?? '') || b.internalBatchNo === (it.rawBatchNo ?? ''))
  let headers: string[] = []
  let lines: string[][] = []
  if (tab === 'meat') {
    headers = ['Nr partii mięsa','Partia ćwiartki','Dostawca','Dostępne kg','Początkowe kg','Data produkcji','Data ważności']
    lines = rows.map((m: MeatStock) => {
      const b = getBatch(m)
      return [
        m.lotNo || '',
        b?.internalBatchNo || m.rawBatchNo || '',
        b?.supplierName || '',
        String(m.kgAvailable).replace('.', ','),
        String(m.kgInitial).replace('.', ','),
        m.productionDate || '',
        m.expiryDate || '',
      ]
    })
  } else {
    const fieldName = tab === 'backs' ? 'kgBacks' : 'kgBones'
    const label    = tab === 'backs' ? 'Grzbiety kg' : 'Kości kg'
    headers = ['Partia ćwiartki','Dostawca', label,'Data rozbioru']
    lines = rows.map((s: DeboningSession) => {
      const b = batches.find(x => x.id === s.rawBatchId)
      return [
        b?.internalBatchNo || s.rawBatchNo || '',
        b?.supplierName || '',
        String((s as any)[fieldName] || 0).replace('.', ','),
        (s.createdAt || '').slice(0, 10),
      ]
    })
  }
  const csv = [headers.join(';')].concat(lines.map(r =>
    r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(';')
  )).join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const name = tab === 'meat' ? 'mieso-zs' : tab === 'backs' ? 'grzbiety' : 'kosci'
  a.href = url; a.download = `${name}-${new Date().toISOString().slice(0,10)}.csv`; a.click()
  URL.revokeObjectURL(url)
}

// ─── Strona ─────────────────────────────────────────────────
type Tab = 'meat' | 'backs' | 'bones'

export function RawStockPage() {
  const { data: meatData, loading: meatLoading } = useApi(() => meatStockApi.list())
  const { data: debData,  loading: debLoading  } = useApi(() => deboningApi.list())
  const { data: batchData } = useApi<{ data: any[] }>(() => (rawBatchesApi as any).all())

  const [activeTab, setActiveTab] = useState<Tab>('meat')
  const [traceItem, setTraceItem] = useState<{
    type: Tab; item?: MeatStock; session?: DeboningSession; batch?: RawBatch
  } | null>(null)
  const [filter,   setFilter]   = useState('')
  const [sortCol,  setSortCol]  = useState<string>('expiryDate')
  const [sortDir,  setSortDir]  = useState<'asc'|'desc'>('asc')

  const toggleSort = (col: string) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: string }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  const meatList = meatData?.data ?? []
  const sessions = debData?.data  ?? []
  const batches  = batchData?.data ?? []

  const totalMeatAvailable = meatList.reduce((sum, m) => sum + Number(m.kgAvailable), 0)
  const totalBacks = sessions.reduce((sum, s) => sum + Number(s.kgBacks || 0), 0)
  const totalBones = sessions.reduce((sum, s) => sum + Number(s.kgBones || 0), 0)

  const backsItems = sessions.filter(s => Number(s.kgBacks || 0) > 0)
  const bonesItems = sessions.filter(s => Number(s.kgBones || 0) > 0)

  // ── Filtered + sorted lists ──
  const filteredMeat = useMemo(() => {
    const q = filter.toLowerCase().trim()
    const getBatch = (m: MeatStock) => batches.find(b => b.id === m.rawBatchId || b.internalBatchNo === m.rawBatchNo)
    let result = meatList
    if (q) {
      result = meatList.filter(m => {
        const b = getBatch(m)
        return (m.lotNo||'').toLowerCase().includes(q) ||
               (m.rawBatchNo||'').toLowerCase().includes(q) ||
               (b?.supplierName||'').toLowerCase().includes(q)
      })
    }
    return [...result].sort((a, b) => {
      const ba = getBatch(a), bb = getBatch(b)
      let cmp = 0
      if (sortCol === 'expiryDate')    cmp = (a.expiryDate||'').localeCompare(b.expiryDate||'')
      if (sortCol === 'kgAvailable')   cmp = Number(a.kgAvailable) - Number(b.kgAvailable)
      if (sortCol === 'kgInitial')     cmp = Number(a.kgInitial)   - Number(b.kgInitial)
      if (sortCol === 'lotNo')         cmp = (a.lotNo||'').localeCompare(b.lotNo||'')
      if (sortCol === 'rawBatchNo')    cmp = (a.rawBatchNo||'').localeCompare(b.rawBatchNo||'')
      if (sortCol === 'supplierName')  cmp = (ba?.supplierName||'').localeCompare(bb?.supplierName||'')
      if (sortCol === 'productionDate')cmp = (a.productionDate||'').localeCompare(b.productionDate||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [meatList, batches, filter, sortCol, sortDir])

  const filteredBacks = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = backsItems
    if (q) {
      result = backsItems.filter(s => {
        const b = batches.find(x => x.id === s.rawBatchId)
        return (b?.internalBatchNo||'').toLowerCase().includes(q) ||
               (b?.supplierName||'').toLowerCase().includes(q) ||
               (s.rawBatchNo||'').toLowerCase().includes(q)
      })
    }
    return [...result].sort((a, b) => {
      const ba = batches.find(x => x.id === a.rawBatchId)
      const bb = batches.find(x => x.id === b.rawBatchId)
      let cmp = 0
      if (sortCol === 'supplierName') cmp = (ba?.supplierName||'').localeCompare(bb?.supplierName||'')
      if (sortCol === 'kgAvailable')  cmp = Number(a.kgBacks||0) - Number(b.kgBacks||0)
      if (sortCol === 'rawBatchNo')   cmp = (ba?.internalBatchNo||'').localeCompare(bb?.internalBatchNo||'')
      if (sortCol === 'expiryDate' || sortCol === 'createdAt') cmp = (a.createdAt||'').localeCompare(b.createdAt||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [backsItems, batches, filter, sortCol, sortDir])

  const filteredBones = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = bonesItems
    if (q) {
      result = bonesItems.filter(s => {
        const b = batches.find(x => x.id === s.rawBatchId)
        return (b?.internalBatchNo||'').toLowerCase().includes(q) ||
               (b?.supplierName||'').toLowerCase().includes(q) ||
               (s.rawBatchNo||'').toLowerCase().includes(q)
      })
    }
    return [...result].sort((a, b) => {
      const ba = batches.find(x => x.id === a.rawBatchId)
      const bb = batches.find(x => x.id === b.rawBatchId)
      let cmp = 0
      if (sortCol === 'supplierName') cmp = (ba?.supplierName||'').localeCompare(bb?.supplierName||'')
      if (sortCol === 'kgAvailable')  cmp = Number(a.kgBones||0) - Number(b.kgBones||0)
      if (sortCol === 'rawBatchNo')   cmp = (ba?.internalBatchNo||'').localeCompare(bb?.internalBatchNo||'')
      if (sortCol === 'expiryDate' || sortCol === 'createdAt') cmp = (a.createdAt||'').localeCompare(b.createdAt||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [bonesItems, batches, filter, sortCol, sortDir])

  const loading = meatLoading || debLoading

  const openTrace = (type: Tab, item?: MeatStock, session?: DeboningSession) => {
    const s = session || (item ? sessions.find(x => x.id === item.deboningSessionId) : undefined)
    const b = s
      ? batches.find(x => x.id === s.rawBatchId)
      : item
        ? batches.find(x => x.id === item.rawBatchId || x.internalBatchNo === item.rawBatchNo)
        : undefined
    setTraceItem({ type, item, session: s, batch: b })
  }

  const currentRows = activeTab === 'meat' ? filteredMeat : activeTab === 'backs' ? filteredBacks : filteredBones
  const currentCount = currentRows.length
  const currentTotal = activeTab === 'meat'
    ? filteredMeat.reduce((s, m) => s + Number(m.kgAvailable), 0)
    : activeTab === 'backs'
      ? filteredBacks.reduce((s, x) => s + Number(x.kgBacks || 0), 0)
      : filteredBones.reduce((s, x) => s + Number(x.kgBones || 0), 0)

  return (
    <div className="space-y-3 animate-fade-in">

      {/* ── Toolbar: tabs + filtr + KPI inline + CSV ──────── */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            {[
              { key: 'meat'  as Tab, label: 'Mięso Z/S', total: totalMeatAvailable, icon: <Beef size={13}/>,    color: 'text-emerald-700' },
              { key: 'backs' as Tab, label: 'Grzbiety',  total: totalBacks,         icon: <Layers size={13}/>,  color: 'text-amber-700' },
              { key: 'bones' as Tab, label: 'Kości',     total: totalBones,         icon: <Package size={13}/>, color: 'text-gray-700' },
            ].map(t => (
              <button
                key={t.key}
                onClick={() => { setActiveTab(t.key); setSortCol('expiryDate'); setSortDir('asc') }}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors',
                  activeTab === t.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white text-ink-2 border-surface-4 hover:bg-surface-2',
                )}
              >
                {t.icon}
                {t.label}
                <span className={cn(
                  'ml-1 text-[10px] tabular-nums',
                  activeTab === t.key ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}>
                  {fmtKg(t.total, 0)} kg
                </span>
              </button>
            ))}
          </div>

          {/* Filtr */}
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9 pr-8 text-sm"
              placeholder="Filtruj: nr partii, dostawca…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
            {filter && (
              <button onClick={() => setFilter('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                <X size={14}/>
              </button>
            )}
          </div>

          {/* Inline KPI + CSV */}
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Pozycji:</CardDescription>
              <span className="font-bold">{currentCount}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Razem:</CardDescription>
              <span className="font-bold text-emerald-700">{fmtKg(currentTotal, 0)} kg</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
          </div>
        </div>
      </Card>

      {/* ── Tabela ──────────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4,5].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : activeTab === 'meat' ? (
          meatList.length === 0 ? (
            <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
              <Beef size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak mięsa</CardTitle>
              <CardDescription>Mięso pojawi się po rozbiorze</CardDescription>
            </CardContent>
          ) : filteredMeat.length === 0 ? (
            <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
              <Search size={28} className="text-muted-foreground opacity-20" />
              <CardDescription>Brak wyników dla „{filter}"</CardDescription>
            </CardContent>
          ) : (
            <div className="overflow-auto max-h-[calc(100vh-12rem)]">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                  <tr>
                    {[
                      { col: 'lotNo',          label: 'Nr partii mięsa', align: 'left'  },
                      { col: 'rawBatchNo',     label: 'Partia ćwiartki', align: 'left'  },
                      { col: 'supplierName',   label: 'Dostawca',        align: 'left'  },
                      { col: 'kgAvailable',    label: 'Dostępne',        align: 'right' },
                      { col: 'kgInitial',      label: 'Początkowe',      align: 'right' },
                      { col: 'productionDate', label: 'Produkcja',       align: 'left'  },
                      { col: 'expiryDate',     label: 'Ważność',         align: 'left'  },
                    ].map(h => (
                      <th
                        key={h.col}
                        onClick={() => toggleSort(h.col)}
                        className={cn(
                          'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                          h.align === 'right' && 'text-right',
                        )}
                      >
                        <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                          {h.label}
                          <SortIcon col={h.col} />
                        </span>
                      </th>
                    ))}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {filteredMeat.map((m, idx) => {
                    const batch = batches.find(b => b.id === m.rawBatchId || b.internalBatchNo === m.rawBatchNo)
                    return (
                      <tr
                        key={m.id}
                        onClick={() => openTrace('meat', m)}
                        className={cn(
                          'cursor-pointer border-b border-surface-3 transition-colors',
                          idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                          'hover:bg-blue-50/60',
                        )}
                      >
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <code className="font-mono font-bold text-primary text-[12px]">{m.lotNo || '—'}</code>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <code className="font-mono font-bold text-foreground text-[12px] bg-muted px-1.5 py-0.5 rounded">
                            {batch?.internalBatchNo || m.rawBatchNo}
                          </code>
                          {batch?.supplierBatchNo && (
                            <span className="ml-1 text-[10px] text-muted-foreground">({batch.supplierBatchNo})</span>
                          )}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[220px] truncate" title={batch?.supplierName || ''}>
                          {batch?.supplierName || <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold text-emerald-700">
                          {fmtKg(m.kgAvailable, 2)}<span className="font-normal text-[11px]"> kg</span>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-right text-ink-2">
                          {fmtKg(m.kgInitial, 2)}<span className="text-[11px]"> kg</span>
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                          {m.productionDate ? fmtDatePl(m.productionDate) : <span className="text-muted-foreground">—</span>}
                        </td>
                        <td className="px-2.5 py-2 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <span className="text-ink-2">{fmtDatePl(m.expiryDate)}</span>
                            {m.expiryDate && <ExpiryBadge date={m.expiryDate} />}
                          </div>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); openTrace('meat', m) }}
                            className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                            title="Śledzenie partii"
                          >
                            <Eye size={13}/>
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                  <tr>
                    <td colSpan={3} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2">
                      Suma · {filteredMeat.length} {filteredMeat.length === 1 ? 'partia' : 'partii'}
                    </td>
                    <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                      {fmtKg(filteredMeat.reduce((s, m) => s + Number(m.kgAvailable), 0), 1)} kg
                    </td>
                    <td colSpan={4} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        ) : (
          // Grzbiety lub Kości
          (() => {
            const items = activeTab === 'backs' ? backsItems : bonesItems
            const filtered = activeTab === 'backs' ? filteredBacks : filteredBones
            const kgField  = activeTab === 'backs' ? 'kgBacks' : 'kgBones'
            const colLabel = activeTab === 'backs' ? 'Grzbiety' : 'Kości'
            const empty    = activeTab === 'backs' ? 'grzbietów' : 'kości'
            const emptyIcon = activeTab === 'backs'
              ? <Layers size={36} className="text-muted-foreground opacity-20"/>
              : <Package size={36} className="text-muted-foreground opacity-20"/>

            if (items.length === 0) {
              return (
                <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
                  {emptyIcon}
                  <CardTitle className="text-sm font-medium text-muted-foreground">Brak {empty}</CardTitle>
                  <CardDescription>{colLabel} pojawią się po zakończeniu partii rozbioru</CardDescription>
                </CardContent>
              )
            }
            if (filtered.length === 0) {
              return (
                <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
                  <Search size={28} className="text-muted-foreground opacity-20" />
                  <CardDescription>Brak wyników dla „{filter}"</CardDescription>
                </CardContent>
              )
            }
            const totalKg = filtered.reduce((s, x) => s + Number((x as any)[kgField] || 0), 0)

            return (
              <div className="overflow-auto max-h-[calc(100vh-12rem)]">
                <table className="w-full text-xs tabular-nums">
                  <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                    <tr>
                      {[
                        { col: 'rawBatchNo',   label: 'Partia ćwiartki', align: 'left'  },
                        { col: 'supplierName', label: 'Dostawca',        align: 'left'  },
                        { col: 'kgAvailable',  label: colLabel + ' kg',  align: 'right' },
                        { col: 'createdAt',    label: 'Data rozbioru',   align: 'left'  },
                      ].map(h => (
                        <th
                          key={h.col}
                          onClick={() => toggleSort(h.col)}
                          className={cn(
                            'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                            h.align === 'right' && 'text-right',
                          )}
                        >
                          <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                            {h.label}
                            <SortIcon col={h.col} />
                          </span>
                        </th>
                      ))}
                      <th className="w-8" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((s, idx) => {
                      const batch = batches.find(b => b.id === s.rawBatchId)
                      return (
                        <tr
                          key={s.id ?? idx}
                          onClick={() => openTrace(activeTab, undefined, s)}
                          className={cn(
                            'cursor-pointer border-b border-surface-3 transition-colors',
                            idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                            'hover:bg-blue-50/60',
                          )}
                        >
                          <td className="px-2.5 py-2 whitespace-nowrap">
                            <code className="font-mono font-bold text-foreground text-[12px] bg-muted px-1.5 py-0.5 rounded">
                              {batch?.internalBatchNo || s.rawBatchNo}
                            </code>
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[260px] truncate" title={batch?.supplierName || ''}>
                            {batch?.supplierName || <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold text-emerald-700">
                            {fmtKg((s as any)[kgField], 2)}<span className="font-normal text-[11px]"> kg</span>
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                            {s.createdAt ? fmtDatePl(s.createdAt.slice(0, 10)) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2 py-2 text-right">
                            <button
                              onClick={(e) => { e.stopPropagation(); openTrace(activeTab, undefined, s) }}
                              className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                              title="Śledzenie partii"
                            >
                              <Eye size={13}/>
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                    <tr>
                      <td colSpan={2} className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2">
                        Suma · {filtered.length} {filtered.length === 1 ? 'partia' : 'partii'}
                      </td>
                      <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                        {fmtKg(totalKg, 1)} kg
                      </td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )
          })()
        )}
      </Card>

      {traceItem && (
        <TraceabilityModal
          type={traceItem.type}
          item={traceItem.item}
          session={traceItem.session}
          batch={traceItem.batch}
          onClose={() => setTraceItem(null)}
        />
      )}
    </div>
  )
}
