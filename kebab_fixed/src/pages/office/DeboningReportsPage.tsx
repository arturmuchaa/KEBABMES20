/**
 * DeboningReportsPage — shadcn/ui
 */
import { useCallback } from 'react'
import { fmtKg, fmtPct, fmtDatePl } from '@/lib/utils'
import { CheckCircle, Scissors, Clock, Lock, BarChart2, Activity } from 'lucide-react'
import { useProductionSession, useDeboningEntries, useSessionSummary } from '@/features/deboning'
import type { SessionStatus } from '@/features/deboning'
import { toast } from 'sonner'

// ── shadcn/ui ──────────────────────────────────────────────────
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'

const STATUS_BADGE: Record<SessionStatus, 'success' | 'warning' | 'secondary'> = {
  open:     'success',
  closed:   'warning',
  approved: 'secondary',
}
const STATUS_LABEL: Record<SessionStatus, string> = {
  open: 'Otwarta', closed: 'Zamknięta', approved: 'Zatwierdzona',
}

export function DeboningReportsPage() {
  const { session, todaySessions, timeWindow, loading, approveDay, approveLoading } = useProductionSession()
  const activeId = session?.id ?? null
  const { entries, loading: entriesLoading } = useDeboningEntries(activeId)
  const { summary } = useSessionSummary(activeId)

  const handleApprove = useCallback(async () => {
    const err = await approveDay('office')
    if (err) toast.error(err)
    else toast.success('Sesja zatwierdzona')
  }, [approveDay])

  if (loading) {
    return (
      <div className="space-y-5 animate-fade-in">
        <Card><CardContent className="p-5"><Skeleton className="h-12 w-full" /></CardContent></Card>
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-4">
          {[0,1,2,3,4,5].map(i => <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
        </div>
        <Card><CardContent className="p-5"><Skeleton className="h-48 w-full" /></CardContent></Card>
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">

      {/* Status sesji */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-base mb-1.5">
                Sesja rozbioru — {timeWindow.productionDate}
              </CardTitle>
              <div className="flex items-center gap-2">
                {session ? (
                  <Badge variant={STATUS_BADGE[session.status]}>
                    {session.status === 'open' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse mr-1.5 inline-block" />
                    )}
                    {STATUS_LABEL[session.status]}
                  </Badge>
                ) : (
                  <CardDescription>Brak aktywnej sesji — uruchom z tabletu rozbioru</CardDescription>
                )}
                <CardDescription>{timeWindow.currentTimeHHMM}</CardDescription>
              </div>
            </div>
            <div className="flex gap-2 flex-shrink-0">
              {session && (session.status === 'closed' || session.status === 'open') && (
                <Button size="sm" disabled={approveLoading} onClick={handleApprove} className="gap-1.5">
                  {approveLoading
                    ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <CheckCircle size={13} />
                  }
                  Zatwierdź sesję
                </Button>
              )}
              {session?.status === 'approved' && (
                <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Lock size={13} />
                  Zatwierdził: {session.approvedBy ?? '—'}
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* KPI */}
      {summary && (
        <div className="grid grid-cols-3 xl:grid-cols-6 gap-4">
          {[
            { label: 'Ćwiartka',   val: fmtKg(summary.totalKgTaken), unit: 'kg', accent: 'bg-blue-50 text-blue-600'   },
            { label: 'Mięso Z/S',  val: fmtKg(summary.totalKgMeat),  unit: 'kg', accent: 'bg-green-50 text-green-600' },
            { label: 'Kości',      val: fmtKg(summary.totalKgBones), unit: 'kg', accent: 'bg-gray-50 text-gray-500'   },
            { label: 'Grzbiety',   val: fmtKg(summary.totalKgBacks), unit: 'kg', accent: 'bg-gray-50 text-gray-500'   },
            { label: 'Wydajność',  val: fmtPct(summary.avgYieldPct), unit: '',   accent: 'bg-amber-50 text-amber-600' },
            { label: 'Wpisów',     val: summary.entryCount,          unit: '',   accent: 'bg-purple-50 text-purple-600' },
          ].map(k => (
            <Card key={k.label}>
              <CardContent className="p-4">
                <CardDescription className="text-xs font-semibold uppercase tracking-wide mb-1">
                  {k.label}
                </CardDescription>
                <div className="flex items-baseline gap-1">
                  <CardTitle className="text-xl font-black tabular-nums">{k.val}</CardTitle>
                  {k.unit && <CardDescription className="text-xs">{k.unit}</CardDescription>}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Tabela wpisów LIVE */}
      <Card>
        <CardHeader className="pb-3 flex-row items-center justify-between space-y-0">
          <div className="flex items-center gap-2">
            <Scissors size={14} className="text-muted-foreground" />
            <CardTitle className="text-base">Wpisy rozbioru</CardTitle>
            {session?.status === 'open' && (
              <Badge variant="success" className="gap-1">
                <Activity size={10} className="animate-pulse" /> LIVE
              </Badge>
            )}
          </div>
          <CardDescription>{entries.length} wpisów</CardDescription>
        </CardHeader>
        <Separator />
        <CardContent className="p-0">
          {entriesLoading ? (
            <div className="p-4 space-y-3">
              {[0,1,2].map(i => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <BarChart2 size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak wpisów</CardTitle>
              <CardDescription>
                {session ? 'Oczekiwanie na wpisy z tabletu...' : 'Brak aktywnej sesji'}
              </CardDescription>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Nr sesji','Partia','Pracownik','Lot mięsa','Ćwiartka kg','Mięso kg','Kości kg','Grzbiety kg','Wydajność'].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide whitespace-nowrap">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map(e => (
                  <TableRow key={e.id}>
                    <TableCell>
                      <code className="font-mono text-primary text-xs font-semibold">{e.sessionNo}</code>
                    </TableCell>
                    <TableCell>
                      <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">
                        {e.rawBatchNo}
                      </code>
                    </TableCell>
                    <TableCell><CardDescription>{e.workerName}</CardDescription></TableCell>
                    <TableCell>
                      <code className="font-mono text-xs text-muted-foreground">{e.meatLotNo ?? '—'}</code>
                    </TableCell>
                    <TableCell className="text-right">
                      <CardTitle className="text-sm font-semibold tabular-nums">{fmtKg(e.kgTaken, 2)}</CardTitle>
                    </TableCell>
                    <TableCell className="text-right">
                      <CardTitle className="text-sm font-bold tabular-nums">{fmtKg(e.kgMeat, 2)}</CardTitle>
                    </TableCell>
                    <TableCell className="text-right">
                      <CardDescription className="tabular-nums">{fmtKg(e.kgBones, 2)}</CardDescription>
                    </TableCell>
                    <TableCell className="text-right">
                      <CardDescription className="tabular-nums">{fmtKg(e.kgBacks, 2)}</CardDescription>
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge variant={
                        Number(e.yieldPct) >= 70 ? 'success' :
                        Number(e.yieldPct) >= 60 ? 'warning' : 'danger'
                      }>
                        {fmtPct(e.yieldPct)}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Historia sesji dnia */}
      {todaySessions.length > 1 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-muted-foreground" />
              <CardTitle className="text-base">Sesje dnia {timeWindow.productionDate}</CardTitle>
            </div>
          </CardHeader>
          <Separator />
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {['Status','Start','Koniec','Zatwierdził'].map(h => (
                    <TableHead key={h} className="text-xs uppercase tracking-wide">{h}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {todaySessions.map(s => (
                  <TableRow key={s.id}>
                    <TableCell>
                      <Badge variant={STATUS_BADGE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                    </TableCell>
                    <TableCell>
                      <CardDescription>{s.startedAt.slice(11, 16)}</CardDescription>
                    </TableCell>
                    <TableCell>
                      <CardDescription>{s.endedAt ? s.endedAt.slice(11, 16) : '—'}</CardDescription>
                    </TableCell>
                    <TableCell>
                      <CardDescription>{s.approvedBy ?? '—'}</CardDescription>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

    </div>
  )
}
