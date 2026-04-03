/**
 * RawStockPage — Magazyn surowca
 */
import { useState, useMemo } from 'react'
import { useApi } from '@/hooks/useApi'
import { meatStockApi, deboningApi, rawBatchesApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Eye, ArrowRight, Beef, Layers, Package, ChevronDown, ChevronUp, ChevronsUpDown, Search } from 'lucide-react'
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import {
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@/components/ui/tabs'

function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  if (daysLeft < 0)   return <Badge variant="danger">Wygasło</Badge>
  if (daysLeft === 0) return <Badge variant="danger">Dziś!</Badge>
  if (daysLeft <= 2)  return <Badge variant="warning">{daysLeft}d</Badge>
  return <Badge variant="success">{daysLeft} dni</Badge>
}

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
          {/* Nasza partia */}
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="p-4">
              <CardDescription className="text-[10px] font-bold text-primary uppercase mb-1">Nasza partia</CardDescription>
              <CardTitle className="text-3xl font-black font-mono text-primary">
                {batch?.internalBatchNo || item?.rawBatchNo || '—'}
              </CardTitle>
            </CardContent>
          </Card>

          {/* Breadcrumb */}
          <div className="flex items-center gap-2 text-muted-foreground">
            {['DOSTAWCA','PRZYJĘCIE','ROZBIÓR','MAGAZYN'].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-2">
                <CardDescription className="text-xs font-semibold">{s}</CardDescription>
                {i < arr.length - 1 && <ArrowRight size={12} />}
              </span>
            ))}
          </div>

          <Separator />

          {/* Details table */}
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
                  { label: 'Ilość dostępna',    value: <span className="font-bold text-green-600">{fmtKg(item.kgAvailable, 1)} kg</span> },
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

export function RawStockPage() {
  const { data: meatData, loading: meatLoading } = useApi(() => meatStockApi.list())
  const { data: debData,  loading: debLoading  } = useApi(() => deboningApi.list())
  const { data: batchData } = useApi(() => (rawBatchesApi as any).all())

  const [activeTab, setActiveTab] = useState<'meat'|'backs'|'bones'>('meat')
  const [traceItem, setTraceItem] = useState<{
    type: 'meat' | 'backs' | 'bones'; item?: MeatStock; session?: DeboningSession; batch?: RawBatch
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
      : <ChevronsUpDown size={11} className="opacity-30"/>

  const meatList = meatData?.data ?? []
  const sessions = debData?.data  ?? []
  const batches  = batchData?.data ?? []

  const totalMeatAvailable = meatList.reduce((sum, m) => sum + Number(m.kgAvailable), 0)
  const totalBacks = sessions.reduce((sum, s) => sum + Number(s.kgBacks || 0), 0)
  const totalBones = sessions.reduce((sum, s) => sum + Number(s.kgBones || 0), 0)

  const backsItems = sessions.filter(s => Number(s.kgBacks || 0) > 0)
  const bonesItems = sessions.filter(s => Number(s.kgBones || 0) > 0)

  // Filtered + sorted lists
  const filteredMeat = useMemo(() => {
    const q = filter.toLowerCase()
    const getBatch = (m: MeatStock) => batches.find(b => b.id === m.rawBatchId || b.internalBatchNo === m.rawBatchNo)
    const filtered = q
      ? meatList.filter(m => {
          const b = getBatch(m)
          return (m.lotNo||'').toLowerCase().includes(q) ||
                 (m.rawBatchNo||'').toLowerCase().includes(q) ||
                 (b?.supplierName||'').toLowerCase().includes(q)
        })
      : meatList
    return [...filtered].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'expiryDate')   cmp = (a.expiryDate||'').localeCompare(b.expiryDate||'')
      if (sortCol === 'kgAvailable')  cmp = Number(a.kgAvailable) - Number(b.kgAvailable)
      if (sortCol === 'lotNo')        cmp = (a.lotNo||'').localeCompare(b.lotNo||'')
      if (sortCol === 'rawBatchNo')   cmp = (a.rawBatchNo||'').localeCompare(b.rawBatchNo||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [meatList, batches, filter, sortCol, sortDir])

  const filteredBacks = useMemo(() => {
    const q = filter.toLowerCase()
    const getBatch = (s: DeboningSession) => batches.find(b => b.id === s.rawBatchId)
    const filtered = q
      ? backsItems.filter(s => {
          const b = getBatch(s)
          return (b?.internalBatchNo||'').toLowerCase().includes(q) ||
                 (b?.supplierName||'').toLowerCase().includes(q) ||
                 (s.rawBatchNo||'').toLowerCase().includes(q)
        })
      : backsItems
    return [...filtered].sort((a, b) => {
      let cmp = 0
      const ba = batches.find(x => x.id === a.rawBatchId)
      const bb = batches.find(x => x.id === b.rawBatchId)
      if (sortCol === 'supplierName') cmp = (ba?.supplierName||'').localeCompare(bb?.supplierName||'')
      if (sortCol === 'kgAvailable')  cmp = Number(a.kgBacks||0) - Number(b.kgBacks||0)
      if (sortCol === 'rawBatchNo')   cmp = (ba?.internalBatchNo||'').localeCompare(bb?.internalBatchNo||'')
      if (sortCol === 'expiryDate')   cmp = (a.createdAt||'').localeCompare(b.createdAt||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [backsItems, batches, filter, sortCol, sortDir])

  const filteredBones = useMemo(() => {
    const q = filter.toLowerCase()
    const getBatch = (s: DeboningSession) => batches.find(b => b.id === s.rawBatchId)
    const filtered = q
      ? bonesItems.filter(s => {
          const b = getBatch(s)
          return (b?.internalBatchNo||'').toLowerCase().includes(q) ||
                 (b?.supplierName||'').toLowerCase().includes(q) ||
                 (s.rawBatchNo||'').toLowerCase().includes(q)
        })
      : bonesItems
    return [...filtered].sort((a, b) => {
      let cmp = 0
      const ba = batches.find(x => x.id === a.rawBatchId)
      const bb = batches.find(x => x.id === b.rawBatchId)
      if (sortCol === 'supplierName') cmp = (ba?.supplierName||'').localeCompare(bb?.supplierName||'')
      if (sortCol === 'kgAvailable')  cmp = Number(a.kgBones||0) - Number(b.kgBones||0)
      if (sortCol === 'rawBatchNo')   cmp = (ba?.internalBatchNo||'').localeCompare(bb?.internalBatchNo||'')
      if (sortCol === 'expiryDate')   cmp = (a.createdAt||'').localeCompare(b.createdAt||'')
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [bonesItems, batches, filter, sortCol, sortDir])

  const loading = meatLoading || debLoading

  const openTrace = (type: 'meat' | 'backs' | 'bones', item?: MeatStock, session?: DeboningSession) => {
    const s = session || (item ? sessions.find(x => x.id === item.deboningSessionId) : undefined)
    const b = s
      ? batches.find(x => x.id === s.rawBatchId)
      : item
        ? batches.find(x => x.id === item.rawBatchId || x.internalBatchNo === item.rawBatchNo)
        : undefined
    setTraceItem({ type, item, session: s, batch: b })
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* KPI tabs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { key: 'meat',  label: 'Mięso Z/S', val: `${fmtKg(totalMeatAvailable, 0)} kg`, icon: <Beef size={18} />,   accent: 'text-primary' },
          { key: 'backs', label: 'Grzbiety',  val: `${fmtKg(totalBacks, 0)} kg`,         icon: <Layers size={18} />, accent: 'text-amber-600' },
          { key: 'bones', label: 'Kości',     val: `${fmtKg(totalBones, 0)} kg`,         icon: <Package size={18} />,accent: 'text-gray-500' },
        ].map(tab => (
          <Card
            key={tab.key}
            onClick={() => setActiveTab(tab.key as typeof activeTab)}
            className={cn(
              'cursor-pointer border-2 transition-all',
              activeTab === tab.key ? 'border-primary shadow-md' : 'border-border hover:border-primary/40',
            )}
          >
            <CardContent className="p-4 text-center">
              <div className={cn('flex justify-center mb-2', activeTab === tab.key ? tab.accent : 'text-muted-foreground')}>
                {tab.icon}
              </div>
              <CardTitle className={cn('text-xl font-black tabular-nums', activeTab === tab.key ? tab.accent : '')}>
                {tab.val}
              </CardTitle>
              <CardDescription className="text-[10px] font-semibold uppercase mt-1">{tab.label}</CardDescription>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Content */}
      <Card>
        <div className="px-4 py-2.5 border-b flex items-center gap-3">
          <CardTitle className="text-sm font-semibold flex-1">
            {activeTab === 'meat' ? 'Mięso Z/S' : activeTab === 'backs' ? 'Grzbiety' : 'Kości'}
          </CardTitle>
          <div className="relative w-52">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Filtruj partię, dostawcę…"
              value={filter}
              onChange={e => { setFilter(e.target.value); setSortCol('expiryDate'); setSortDir('asc') }}
            />
          </div>
        </div>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-3">
              {[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : activeTab === 'meat' ? (
            meatList.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Beef size={36} className="text-muted-foreground opacity-20" />
                <CardTitle className="text-sm font-medium text-muted-foreground">Brak mięsa</CardTitle>
                <CardDescription>Mięso pojawi się po rozbiorze</CardDescription>
              </div>
            ) : filteredMeat.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Search size={28} className="text-muted-foreground opacity-20" />
                <CardDescription>Brak wyników dla &ldquo;{filter}&rdquo;</CardDescription>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('rawBatchNo')}>
                      <div className="flex items-center gap-1">Nr partii mięsa / Partia <SortIcon col="rawBatchNo"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('kgAvailable')}>
                      <div className="flex items-center gap-1">Dostępne <SortIcon col="kgAvailable"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('expiryDate')}>
                      <div className="flex items-center gap-1">Daty <SortIcon col="expiryDate"/></div>
                    </TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredMeat.map(m => {
                    const batch = batches.find(b => b.id === m.rawBatchId || b.internalBatchNo === m.rawBatchNo)
                    return (
                      <TableRow key={m.id}>
                        <TableCell>
                          <code className="font-mono text-xs text-muted-foreground">{m.lotNo}</code>
                          <div>
                            <code className="font-mono font-bold text-primary text-sm">{batch?.internalBatchNo || m.rawBatchNo}</code>
                          </div>
                          {batch?.supplierName && (
                            <CardDescription className="text-xs">{batch.supplierName}</CardDescription>
                          )}
                          {batch?.supplierBatchNo && (
                            <CardDescription className="text-[10px]">nr: {batch.supplierBatchNo}</CardDescription>
                          )}
                          {batch?.slaughterDate && (
                            <CardDescription className="text-[10px]">ubój: {fmtDatePl(batch.slaughterDate)}</CardDescription>
                          )}
                        </TableCell>
                        <TableCell>
                          <CardTitle className="text-base font-bold text-green-600 tabular-nums">{fmtKg(m.kgAvailable, 2)} kg</CardTitle>
                          <CardDescription className="text-xs">z {fmtKg(m.kgInitial, 2)} kg</CardDescription>
                        </TableCell>
                        <TableCell>
                          <CardDescription className="text-xs">Prod: {fmtDatePl(m.productionDate)}</CardDescription>
                          <div className="flex items-center gap-1 mt-0.5">
                            <CardDescription className="text-xs">Ważn:</CardDescription>
                            <ExpiryBadge date={m.expiryDate} />
                          </div>
                        </TableCell>
                        <TableCell>
                          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openTrace('meat', m)}>
                            <Eye size={13} />
                          </Button>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
          ) : activeTab === 'backs' ? (
            backsItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Layers size={36} className="text-muted-foreground opacity-20" />
                <CardTitle className="text-sm font-medium text-muted-foreground">Brak grzbietów</CardTitle>
                <CardDescription>Grzbiety pojawią się po rozbiorze</CardDescription>
              </div>
            ) : filteredBacks.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Search size={28} className="text-muted-foreground opacity-20" />
                <CardDescription>Brak wyników dla &ldquo;{filter}&rdquo;</CardDescription>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('rawBatchNo')}>
                      <div className="flex items-center gap-1">Partia <SortIcon col="rawBatchNo"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('supplierName')}>
                      <div className="flex items-center gap-1">Dostawca <SortIcon col="supplierName"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('kgAvailable')}>
                      <div className="flex items-center gap-1">Grzbiety kg <SortIcon col="kgAvailable"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('expiryDate')}>
                      <div className="flex items-center gap-1">Data <SortIcon col="expiryDate"/></div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBacks.map((s, i) => {
                    const batch = batches.find(b => b.id === s.rawBatchId)
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <code className="font-mono font-bold text-primary text-sm">{batch?.internalBatchNo || s.rawBatchNo}</code>
                        </TableCell>
                        <TableCell><CardDescription>{batch?.supplierName || '—'}</CardDescription></TableCell>
                        <TableCell>
                          <CardTitle className="text-sm tabular-nums">{fmtKg(s.kgBacks, 2)} kg</CardTitle>
                        </TableCell>
                        <TableCell>
                          <CardDescription className="text-xs">{fmtDatePl(s.createdAt?.slice(0, 10) || '')}</CardDescription>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
          ) : (
            bonesItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2">
                <Package size={36} className="text-muted-foreground opacity-20" />
                <CardTitle className="text-sm font-medium text-muted-foreground">Brak kości</CardTitle>
                <CardDescription>Kości pojawią się po rozbiorze</CardDescription>
              </div>
            ) : filteredBones.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 gap-2">
                <Search size={28} className="text-muted-foreground opacity-20" />
                <CardDescription>Brak wyników dla &ldquo;{filter}&rdquo;</CardDescription>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('rawBatchNo')}>
                      <div className="flex items-center gap-1">Partia <SortIcon col="rawBatchNo"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('supplierName')}>
                      <div className="flex items-center gap-1">Dostawca <SortIcon col="supplierName"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('kgAvailable')}>
                      <div className="flex items-center gap-1">Kości kg <SortIcon col="kgAvailable"/></div>
                    </TableHead>
                    <TableHead className="text-xs uppercase tracking-wide cursor-pointer select-none" onClick={() => toggleSort('expiryDate')}>
                      <div className="flex items-center gap-1">Data <SortIcon col="expiryDate"/></div>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredBones.map((s, i) => {
                    const batch = batches.find(b => b.id === s.rawBatchId)
                    return (
                      <TableRow key={i}>
                        <TableCell>
                          <code className="font-mono font-bold text-primary text-sm">{batch?.internalBatchNo || s.rawBatchNo}</code>
                        </TableCell>
                        <TableCell><CardDescription>{batch?.supplierName || '—'}</CardDescription></TableCell>
                        <TableCell>
                          <CardTitle className="text-sm tabular-nums">{fmtKg(s.kgBones, 2)} kg</CardTitle>
                        </TableCell>
                        <TableCell>
                          <CardDescription className="text-xs">{fmtDatePl(s.createdAt?.slice(0, 10) || '')}</CardDescription>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )
          )}
        </CardContent>
      </Card>

      {/* Traceability modal */}
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
