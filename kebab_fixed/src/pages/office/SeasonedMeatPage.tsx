/**
 * SeasonedMeatPage — Magazyn mięsa przyprawionego
 * FEFO, pełna traceability RAW→CUTTING→SEASONED
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { seasonedMeatApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Beef, AlertTriangle, ChevronRight, Eye, ChevronDown, ChevronUp } from 'lucide-react'
import type { SeasonedMeatBatch } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

function ExpiryBadge({ date }: { date: string }) {
  const { daysLeft } = getExpiryStatus(date)
  if (daysLeft < 0)   return <Badge variant="danger">Wygasło</Badge>
  if (daysLeft === 0) return <Badge variant="danger">Dziś!</Badge>
  if (daysLeft <= 1)  return <Badge variant="warning">Jutro</Badge>
  return <Badge variant="success">{daysLeft}d</Badge>
}

function TracePanel({ batchId, onClose }: { batchId: string; onClose: () => void }) {
  const { data, loading } = useApi(
    () => (seasonedMeatApi as any).getFullTrace(batchId),
    [batchId]
  )

  return (
    <Dialog open onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data ? `Traceability — ${data.seasoned.batchNo}` : 'Traceability'}
          </DialogTitle>
          <DialogDescription>
            Pełny łańcuch: Dostawca → Ćwiartka → Rozbiór → Masowanie → Mięso przyprawione
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="space-y-3 py-4">
            {[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}
          </div>
        ) : !data ? null : (
          <div className="space-y-4">
            {/* Podsumowanie */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Surowiec (ćwiartka)', val: `${fmtKg(data.summary.totalRawKg)} kg`,    accent: '' },
                { label: 'Mięso Z/S',           val: `${fmtKg(data.summary.totalMeatKg)} kg`,   accent: 'text-blue-700' },
                { label: 'Produkt gotowy',       val: `${fmtKg(data.summary.totalOutputKg)} kg`, accent: 'text-green-700' },
              ].map(k => (
                <Card key={k.label} className="bg-muted/40 border-transparent text-center">
                  <CardContent className="p-3">
                    <CardDescription className="text-[10px] font-bold uppercase mb-0.5">{k.label}</CardDescription>
                    <CardTitle className={`text-base ${k.accent}`}>{k.val}</CardTitle>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Łańcuch */}
            <Card className="bg-muted/40 border-transparent">
              <CardContent className="p-3">
                <CardDescription className="text-[10px] font-bold uppercase tracking-wide mb-2">Łańcuch partii</CardDescription>
                <div className="flex items-center gap-1 flex-wrap">
                  {data.summary.rawBatchNos.map((n: string) => (
                    <code key={n} className="font-mono font-black text-blue-700 bg-blue-50 px-2 py-1 rounded text-xs">{n}</code>
                  ))}
                  <ChevronRight size={12} className="text-muted-foreground" />
                  {data.seasoned.meatLots.map((l: any) => (
                    <code key={l.meatLotId} className="font-mono font-bold text-green-700 bg-green-50 px-2 py-1 rounded text-xs">{l.meatLotNo}</code>
                  ))}
                  <ChevronRight size={12} className="text-muted-foreground" />
                  <code className="font-mono font-black text-primary bg-primary/10 px-2 py-1 rounded text-xs">{data.seasoned.batchNo}</code>
                </div>
              </CardContent>
            </Card>

            <Separator />

            {/* Szczegóły */}
            <div className="space-y-3">
              <CardTitle className="text-sm">Szczegóły partii mięsa</CardTitle>
              {data.meatLots.map((t: any, i: number) => (
                <Card key={i}>
                  <div className="flex items-center justify-between px-3 py-2 bg-muted/40 border-b">
                    <code className="font-mono font-bold text-green-700 text-sm">{t.meatStock?.lotNo ?? '—'}</code>
                    <div className="flex items-center gap-2">
                      <CardDescription className="text-xs">{fmtKg(data.seasoned.meatLots[i]?.kgPlanned ?? 0)} kg</CardDescription>
                      <Badge variant={t.meatStock ? 'success' : 'danger'}>
                        {t.meatStock ? 'Znaleziono' : '⚠ Brak danych'}
                      </Badge>
                    </div>
                  </div>
                  <CardContent className="p-0 divide-y">
                    <div className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2.5">
                      <CardDescription className="text-xs font-semibold">Wpis rozbioru</CardDescription>
                      {t.deboningEntry ? (
                        <div className="text-xs">
                          <code className="font-mono text-primary">{t.deboningEntry.sessionNo}</code>
                          <CardDescription className="text-xs ml-2 inline">
                            {fmtKg(t.deboningEntry.kgTaken)} kg ćwiartki → {fmtKg(t.deboningEntry.kgMeat)} kg mięsa
                          </CardDescription>
                          <CardDescription className="text-xs ml-2 inline">· {t.deboningEntry.workerName}</CardDescription>
                        </div>
                      ) : <CardDescription className="text-xs text-destructive">⚠ Brak wpisu rozbioru</CardDescription>}
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2.5">
                      <CardDescription className="text-xs font-semibold">Ćwiartka</CardDescription>
                      {t.rawBatch ? (
                        <div className="flex items-center gap-3 text-xs flex-wrap">
                          <code className="font-mono font-bold text-blue-700">{t.rawBatch.internalBatchNo}</code>
                          <CardDescription className="text-xs">{fmtKg(t.rawBatch.kgReceived)} kg przyjęte</CardDescription>
                          <CardDescription className="text-xs">ubój: {fmtDatePl(t.rawBatch.slaughterDate)}</CardDescription>
                          <CardDescription className="text-xs">ważność: {fmtDatePl(t.rawBatch.expiryDate)}</CardDescription>
                        </div>
                      ) : <CardDescription className="text-xs text-destructive">⚠ Brak danych ćwiartki</CardDescription>}
                    </div>
                    <div className="grid grid-cols-[120px_1fr] gap-2 px-3 py-2.5">
                      <CardDescription className="text-xs font-semibold">Dostawca</CardDescription>
                      {t.supplier ? (
                        <div className="flex items-center gap-3 text-xs flex-wrap">
                          <CardTitle className="text-xs">{t.supplier.name}</CardTitle>
                          {t.supplier.vetNumber && <CardDescription className="text-xs">wet.: {t.supplier.vetNumber}</CardDescription>}
                          {t.rawBatch?.supplierBatchNo && <CardDescription className="text-xs">nr: {t.rawBatch.supplierBatchNo}</CardDescription>}
                        </div>
                      ) : <CardDescription className="text-xs text-destructive">⚠ Brak danych dostawcy</CardDescription>}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Masowanie */}
            <Card className="bg-muted/40 border-transparent">
              <CardContent className="p-3">
                <CardDescription className="text-[10px] font-bold uppercase tracking-wide mb-2">Masowanie</CardDescription>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div><CardDescription className="text-xs">Zlecenie: </CardDescription><code className="font-mono font-bold text-primary">{data.seasoned.mixingOrderNo}</code></div>
                  <div><CardDescription className="text-xs">Receptura: </CardDescription><CardTitle className="text-xs inline">{data.seasoned.recipeName}</CardTitle></div>
                  <div><CardDescription className="text-xs">Masownica: </CardDescription><CardTitle className="text-xs inline">{data.seasoned.machineId}</CardTitle></div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export function SeasonedMeatPage() {
  const { data,      loading }  = useApi(() => seasonedMeatApi.list())
  const { data: all }           = useApi(() => seasonedMeatApi.all())
  const [traceId,   setTraceId] = useState<string | null>(null)
  const [expanded,  setExpanded] = useState<string | null>(null)

  const batches    = data ?? []
  const allBatches = all  ?? []
  const totalAvail = batches.reduce((s, b) => s + b.kgAvailable, 0)
  const critical   = batches.filter(b => getExpiryStatus(b.expiryDate).daysLeft <= 1)

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <div className="grid grid-cols-3 gap-4">
          {[0,1,2].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-10 w-full" /></CardContent></Card>)}
        </div>
        <Card><CardContent className="p-4 space-y-3">{[0,1,2].map(i => <Skeleton key={i} className="h-12 w-full" />)}</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Alerty krytyczne */}
      {critical.length > 0 && (
        <Card className="border-red-200 bg-red-50">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-red-600" />
              <CardTitle className="text-sm text-red-700">{critical.length} partii wygasa dziś lub jutro</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="pt-0 space-y-1">
            {critical.map(b => (
              <CardDescription key={b.id} className="text-xs text-red-600">
                {b.batchNo} · {b.recipeName} · {fmtKg(b.kgAvailable)} kg · do: {fmtDatePl(b.expiryDate)}
              </CardDescription>
            ))}
          </CardContent>
        </Card>
      )}

      {/* KPI */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Partie dostępne', val: batches.length,          accent: '' },
          { label: 'Łącznie kg',      val: `${fmtKg(totalAvail)} kg`, accent: 'text-green-700' },
          { label: 'Alerty',          val: critical.length,         accent: critical.length > 0 ? 'text-destructive' : 'text-muted-foreground' },
        ].map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <CardDescription className="text-xs font-semibold uppercase tracking-wide mb-1">{k.label}</CardDescription>
              <CardTitle className={`text-2xl font-black tabular-nums ${k.accent}`}>{k.val}</CardTitle>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* FEFO table */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center gap-2 space-y-0">
          <Beef size={14} className="text-muted-foreground" />
          <CardTitle className="text-base">Dostępne partie (FEFO)</CardTitle>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {batches.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Beef size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak mięsa przyprawionego</CardTitle>
              <CardDescription>Zrealizuj zlecenia masowania</CardDescription>
            </div>
          ) : (
            <div className="divide-y">
              {batches.map(b => {
                const isExp = expanded === b.id
                return (
                  <div key={b.id}>
                    <div
                      className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 cursor-pointer transition-colors"
                      onClick={() => setExpanded(isExp ? null : b.id)}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <code className="font-mono font-bold text-primary text-sm">{b.batchNo}</code>
                          <CardDescription className="text-sm">{b.recipeName}</CardDescription>
                          {b.productTypeName && (
                            <Badge variant="info" className="text-[10px]">{b.productTypeName}</Badge>
                          )}
                        </div>
                        {/* Mini traceability */}
                        <div className="flex items-center gap-1 flex-wrap">
                          {b.rawBatchNos.map(n => (
                            <code key={n} className="text-[10px] font-mono bg-muted text-muted-foreground px-1.5 py-0.5 rounded">{n}</code>
                          ))}
                          {b.rawBatchNos.length > 0 && <ChevronRight size={10} className="text-muted-foreground" />}
                          {b.meatLots.map(l => (
                            <code key={l.meatLotId} className="text-[10px] font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded">{l.meatLotNo}</code>
                          ))}
                          {b.meatLots.length > 0 && <ChevronRight size={10} className="text-muted-foreground" />}
                          <code className="text-[10px] font-mono font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded">{b.batchNo}</code>
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="text-right">
                          <CardTitle className="text-sm text-green-600 tabular-nums">{fmtKg(b.kgAvailable)} kg</CardTitle>
                          <ExpiryBadge date={b.expiryDate} />
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs gap-1"
                          onClick={e => { e.stopPropagation(); setTraceId(b.id) }}
                        >
                          <Eye size={11} /> Trace
                        </Button>
                        {isExp
                          ? <ChevronUp size={14} className="text-muted-foreground" />
                          : <ChevronDown size={14} className="text-muted-foreground" />
                        }
                      </div>
                    </div>

                    {/* Expanded */}
                    {isExp && (
                      <div className="px-4 pb-4 bg-muted/20 border-t">
                        <div className="grid grid-cols-2 gap-4 mt-3 text-xs">
                          <div className="space-y-1">
                            <CardDescription className="text-[10px] font-bold uppercase tracking-wide mb-1">Masowanie</CardDescription>
                            <div>Zlecenie: <code className="font-mono font-bold text-primary">{b.mixingOrderNo}</code></div>
                            <div>Masownica: <span className="font-medium">{b.machineId}</span></div>
                            <div>Wyprodukowano: <span className="font-medium">{fmtKg(b.kgProduced)} kg</span></div>
                            <div>Ukończono: <span className="font-medium">{fmtDatePl(b.completedAt.slice(0, 10))}</span></div>
                          </div>
                          <div className="space-y-1">
                            <CardDescription className="text-[10px] font-bold uppercase tracking-wide mb-1">Ćwiartki (surowiec)</CardDescription>
                            {(b.rawBatchNos?.length > 0
                              ? b.rawBatchNos
                              : [...new Set(b.meatLots.map((l: any) => l.rawBatchNo).filter(Boolean))]
                            ).map((n: string) => (
                              <code key={n} className="block font-mono font-bold text-blue-700">{n}</code>
                            ))}
                            {b.slaughterDates.length > 0 && (
                              <CardDescription className="text-[10px] mt-1">
                                Data uboju: {b.slaughterDates.map(d => fmtDatePl(d)).join(', ')}
                              </CardDescription>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Historia */}
      {allBatches.filter(b => b.status === 'depleted').length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Historia — wykorzystane partie</CardTitle>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            <Table>
              <TableBody>
                {allBatches.filter(b => b.status === 'depleted').map(b => (
                  <TableRow key={b.id} className="opacity-60">
                    <TableCell><code className="font-mono text-muted-foreground text-xs">{b.batchNo}</code></TableCell>
                    <TableCell><CardDescription>{b.recipeName}</CardDescription></TableCell>
                    <TableCell>
                      <code className="font-mono text-xs text-muted-foreground">{b.rawBatchNos.join(', ') || '—'}</code>
                    </TableCell>
                    <TableCell><CardDescription className="tabular-nums">{fmtKg(b.kgProduced)} kg</CardDescription></TableCell>
                    <TableCell>
                      <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs" onClick={() => setTraceId(b.id)}>
                        <Eye size={11} /> Trace
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {traceId && <TracePanel batchId={traceId} onClose={() => setTraceId(null)} />}
    </div>
  )
}
