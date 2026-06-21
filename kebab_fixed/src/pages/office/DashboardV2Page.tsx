import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useClientNames } from '@/lib/clientNames'
import { useDashboardData, ORDER_STATUS_LABEL } from '@/features/dashboard/useDashboardData'
import { ExpiryBadge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtKg, fmtDatePl, getExpiryStatus, cn } from '@/lib/utils'
import {
  AlertTriangle, Beef, Package, Boxes, CheckCircle2, Clock,
  Scissors, Soup, Factory, Truck, ArrowRight, Activity,
} from 'lucide-react'

// ════════════════════════════════════════════════════════════════
// Dashboard v2 — pulpit biura (czytelny, desk-first)
//   Reużywa useDashboardData (te same API + live-polling).
//   Stary DashboardPage pozostaje nietknięty.
// ════════════════════════════════════════════════════════════════

function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t) }, [])
  const time = now.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return <span className="font-mono tabular-nums text-ink font-semibold leading-none">{time}</span>
}

// ── Context bar (data + status live + zegar) ─────────────────────
// Tytuł strony renderuje OfficeLayout — tutaj NIE powtarzamy go.
function ContextBar({ live, dateLong }: { live: boolean; dateLong: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-[13px] font-medium text-ink-3 first-letter:uppercase">{dateLong}</p>
      <div className="flex items-center gap-2.5 rounded-xl border border-surface-4 bg-white px-4 py-2 shadow-sm">
        <span className="relative flex h-2 w-2" aria-hidden>
          {live && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />}
          <span className={cn('relative inline-flex h-2 w-2 rounded-full', live ? 'bg-emerald-500' : 'bg-slate-300')} />
        </span>
        <span className={cn('text-[10px] font-bold uppercase tracking-[0.16em] leading-none', live ? 'text-emerald-700' : 'text-ink-4')}>
          {live ? 'Na żywo' : 'Oczekuje'}
        </span>
        <span className="h-4 w-px bg-surface-4" />
        <LiveClock />
      </div>
    </div>
  )
}

// ── KPI tile (jeden spójny styl; kolor TYLKO dla statusu) ───────
function KpiTile({ label, value, unit, sub, icon, tone = 'neutral', delay = 0 }: {
  label: string; value: React.ReactNode; unit?: string; sub?: string
  icon: React.ReactNode; tone?: 'neutral' | 'green' | 'amber' | 'red'; delay?: number
}) {
  const toneRing: Record<string, string> = {
    neutral: 'bg-brand-light text-brand-dark',
    green:   'bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100',
    amber:   'bg-amber-50 text-amber-600 ring-1 ring-amber-100',
    red:     'bg-red-50 text-red-600 ring-1 ring-red-100',
  }
  const valueCls = tone === 'red' ? 'text-red-600' : tone === 'amber' ? 'text-amber-700' : 'text-ink'
  return (
    <Card
      className="group animate-fade-in transition-shadow duration-200 hover:shadow-card-hover"
      style={{ animationDelay: `${delay}ms`, animationFillMode: 'backwards' }}
    >
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-ink-3 leading-tight">{label}</span>
          <span className={cn('flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg', toneRing[tone])}>{icon}</span>
        </div>
        <div className="flex items-baseline gap-1.5">
          <span className={cn('font-mono text-[28px] font-semibold leading-none tracking-tight tabular-nums', valueCls)}>{value}</span>
          {unit && <span className="text-xs font-medium text-ink-3">{unit}</span>}
        </div>
        {sub && <p className="mt-2 text-[11px] text-ink-3 leading-snug">{sub}</p>}
      </CardContent>
    </Card>
  )
}

// ── Live process card ───────────────────────────────────────────
function ProcessCard({ icon, title, sub, live, done, planned, unit, pct, tone }: {
  icon: React.ReactNode; title: string; sub: string; live: boolean
  done: number; planned: number; unit: string; pct: number
  tone: 'amber' | 'purple' | 'blue'
}) {
  const bar: Record<string, string> = { amber: 'bg-amber-500', purple: 'bg-purple-500', blue: 'bg-blue-500' }
  const txt: Record<string, string> = { amber: 'text-amber-600', purple: 'text-purple-600', blue: 'text-blue-600' }
  return (
    <Card className="flex flex-col">
      <CardContent className="flex flex-1 flex-col p-5">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={cn('flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg', live ? 'bg-surface-2' : 'bg-surface-2 opacity-60')}>{icon}</span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-ink leading-tight">{title}</div>
              <div className="text-[11px] text-ink-3 truncate">{sub}</div>
            </div>
          </div>
          <span className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
            live ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500',
          )}>
            <span className={cn('h-1.5 w-1.5 rounded-full', live ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300')} />
            {live ? 'Live' : 'Stop'}
          </span>
        </div>

        <div className="mt-auto">
          <div className="mb-1.5 flex items-baseline justify-between">
            <span className="text-xs tabular-nums text-ink-2">
              <span className="font-bold text-ink">{fmtKg(done, 0)}</span>
              <span className="text-ink-4"> / {fmtKg(planned, 0)} {unit}</span>
            </span>
            <span className={cn('text-sm font-bold tabular-nums', txt[tone])}>{pct.toFixed(0)}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3">
            <div className={cn('h-full rounded-full transition-all duration-500', bar[tone])} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// ── Card shell with header + "see all" link ─────────────────────
function PanelCard({ title, icon, meta, action, children }: {
  title: string; icon: React.ReactNode; meta?: string
  action?: { to: string; label: string }; children: React.ReactNode
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-surface-4 px-5 py-3.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-ink-3">{icon}</span>
          <span className="text-sm font-bold text-ink">{title}</span>
          {meta && <span className="text-[11px] text-ink-4 truncate">· {meta}</span>}
        </div>
        {action && (
          <Button variant="outline" size="sm" asChild>
            <Link to={action.to} className="gap-1.5">{action.label}<ArrowRight size={13} /></Link>
          </Button>
        )}
      </div>
      {children}
    </Card>
  )
}

function EmptyState({ icon, title, description }: { icon: React.ReactNode; title: string; description?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1.5 px-6 py-12 text-center">
      <div className="mb-1 text-ink-5 opacity-50">{icon}</div>
      <div className="text-sm font-semibold text-ink-2">{title}</div>
      {description && <div className="max-w-xs text-xs text-ink-4">{description}</div>}
    </div>
  )
}

// ════════════════════════════════════════════════════════════════
export function DashboardV2Page() {
  const d = useDashboardData()
  const clientDisplay = useClientNames()

  const dateLong = new Date().toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })

  if (d.initialLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-9 w-64" />
        <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
          {[0, 1, 2, 3].map(i => <Skeleton key={i} className="h-32 rounded-xl" />)}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {[0, 1, 2].map(i => <Skeleton key={i} className="h-40 rounded-xl" />)}
        </div>
      </div>
    )
  }

  const shortTone: 'green' | 'amber' | 'red' =
    d.expired.length > 0 ? 'red' : (d.critical.length + d.warnings.length) > 0 ? 'amber' : 'green'
  const pendingCount = d.pendingSessions.length + d.plansToConfirm.length
  const alertBatches = [...d.expired, ...d.critical, ...d.warnings]

  return (
    <div className="space-y-6">
      <ContextBar live={d.live} dateLong={dateLong} />

      {/* ── Skrzynka akcji biura: potwierdzenia + krótki termin ── */}
      {(pendingCount > 0 || alertBatches.length > 0) && (
        <div className={cn('grid gap-4', pendingCount > 0 && alertBatches.length > 0 ? 'lg:grid-cols-2' : 'grid-cols-1')}>
          {pendingCount > 0 && (
            <Card className="border-amber-300 bg-amber-50/50">
              <CardContent className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <AlertTriangle size={15} className="text-amber-600" />
                  <span className="text-sm font-bold text-amber-800">Do potwierdzenia przez biuro · {pendingCount}</span>
                </div>
                <div className="space-y-2">
                  {d.pendingSessions.map((s: any) => {
                    const stale = (s.sessionDate ?? '') < d.today
                    return (
                      <div key={s.id} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
                        <Badge variant="outline" className="flex-shrink-0 font-semibold">{({ deboning: 'Rozbiór', mixing: 'Masowanie', production: 'Produkcja' } as any)[s.processType] ?? s.processType}</Badge>
                        <span className="text-xs font-semibold">{fmtDatePl(s.sessionDate)}</span>
                        {stale && <Badge variant="outline" className="border-red-200 bg-red-50 text-[10px] text-red-600">zaległa</Badge>}
                        <Button size="sm" disabled={d.confirmBusy === s.id} onClick={() => d.approvePendingSession(s)}
                          className="ml-auto h-7 gap-1 bg-emerald-600 text-[11px] hover:bg-emerald-700">
                          <CheckCircle2 size={12} />{d.confirmBusy === s.id ? '…' : 'Potwierdź'}
                        </Button>
                      </div>
                    )
                  })}
                  {d.plansToConfirm.map((p: any) => (
                    <div key={p.id} className="flex items-center gap-3 rounded-lg border border-amber-200 bg-white px-3 py-2">
                      <Badge variant="outline" className="flex-shrink-0 font-semibold">Produkcja</Badge>
                      <span className="font-mono text-xs font-bold text-primary">{p.planNo}</span>
                      <span className="text-[11px] text-ink-3">{fmtKg(Number(p.totalKg), 0)} kg</span>
                      <Button size="sm" disabled={d.confirmBusy === p.id} onClick={() => d.confirmPlanFinish(p)}
                        className="ml-auto h-7 gap-1 bg-emerald-600 text-[11px] hover:bg-emerald-700">
                        <CheckCircle2 size={12} />{d.confirmBusy === p.id ? '…' : 'Potwierdź'}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {alertBatches.length > 0 && (
            <Card className={cn('overflow-hidden', shortTone === 'red' ? 'border-red-200' : 'border-amber-200')}>
              <div className={cn('flex items-center gap-2 border-b px-4 py-3', shortTone === 'red' ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50')}>
                <Clock size={14} className={shortTone === 'red' ? 'text-red-600' : 'text-amber-600'} />
                <span className={cn('flex-1 text-sm font-bold', shortTone === 'red' ? 'text-red-800' : 'text-amber-800')}>Krótki termin — wymaga uwagi</span>
                <Badge variant={shortTone === 'red' ? 'danger' : 'warning'}>{alertBatches.length} {alertBatches.length === 1 ? 'partia' : 'partii'}</Badge>
              </div>
              <div className="max-h-44 divide-y divide-surface-3 overflow-y-auto">
                {alertBatches.map((b: any) => {
                  const { daysLeft } = getExpiryStatus(b.expiryDate)
                  const red = daysLeft <= 1
                  return (
                    <div key={b.id} className="flex items-center justify-between gap-3 px-4 py-2 text-xs">
                      <code className={cn('rounded px-1.5 py-0.5 font-mono font-bold', red ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700')}>{b.internalBatchNo}</code>
                      <span className={cn('flex-1 truncate', red ? 'text-red-700' : 'text-amber-700')}>
                        {daysLeft < 0 ? 'Przeterminowana' : daysLeft === 0 ? 'Wygasa dziś' : daysLeft === 1 ? 'Wygasa jutro' : `Za ${daysLeft} dni`} · {fmtDatePl(b.expiryDate)}
                      </span>
                      <span className={cn('flex-shrink-0 font-bold tabular-nums', red ? 'text-red-800' : 'text-amber-800')}>{fmtKg(b.kgAvailable, 0)} kg</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ── KPI ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-4 xl:grid-cols-4">
        <KpiTile label="Ćwiartka dostępna" value={fmtKg(d.totalKgRaw, 0)} unit="kg"
          sub={`${d.totalContainers} poj. · ${d.activeBatchesCount} partii`} icon={<Beef size={16} />} delay={0} />
        <KpiTile label="Mięso z/s po rozbiorze" value={fmtKg(d.totalKgMeat, 0)} unit="kg"
          sub={`${d.meatPartiesCount} partii`} icon={<Package size={16} />} delay={40} />
        <KpiTile label="Mięso przyprawione" value={fmtKg(d.totalKgSeasoned, 0)} unit="kg"
          sub={`${d.seasonedRecipesCount} receptur`} icon={<Boxes size={16} />} delay={80} />
        <KpiTile label="Krótki termin" value={d.shortTermCount} unit="partii" tone={shortTone}
          sub={d.expired.length > 0 ? `${d.expired.length} po terminie · ${d.critical.length + d.warnings.length} krótkich`
            : (d.critical.length + d.warnings.length) > 0 ? `${d.critical.length + d.warnings.length} kończy się ≤3 dni` : 'Brak — wszystko OK'}
          icon={shortTone === 'green' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />} delay={120} />
      </div>

      {/* ── Procesy na żywo ─────────────────────────────────────── */}
      <section>
        <div className="mb-3 flex items-center gap-2">
          <Activity size={14} className="text-ink-3" />
          <h2 className="text-[11px] font-bold uppercase tracking-[0.14em] text-ink-3">Procesy na żywo</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ProcessCard icon={<Scissors size={16} className={d.debLive ? 'text-amber-500' : 'text-ink-4'} />}
            title="Rozbiór" sub={`Dziś · ${d.todayDeb.length} ${d.todayDeb.length === 1 ? 'sesja' : 'sesji'}`}
            live={d.debLive} done={d.debKgMeat} planned={d.debKgQuarter || d.debKgMeat} unit="kg z/s" pct={d.debYield} tone="amber" />
          <ProcessCard icon={<Soup size={16} className={d.mixLive ? 'text-purple-500' : 'text-ink-4'} />}
            title="Masowanie" sub={`Aktywne zlecenia · ${d.activeMixingCount}`}
            live={d.mixLive} done={d.mixDone} planned={d.mixPlanned} unit="kg" pct={d.mixPct} tone="purple" />
          <ProcessCard icon={<Factory size={16} className={d.prodLive ? 'text-blue-500' : 'text-ink-4'} />}
            title="Produkcja" sub={`Aktywne plany · ${d.activePlansCount}`}
            live={d.prodLive} done={d.prodProduced} planned={d.prodPlanned} unit="kg" pct={d.prodPct} tone="blue" />
        </div>
      </section>

      {/* ── Zamówienia (priorytet biura) ────────────────────────── */}
      <PanelCard title="Zamówienia od klientów" icon={<Truck size={15} />}
        meta={`${d.visibleOrders.length} aktywnych · wg daty wyjazdu`} action={{ to: '/office/zamowienia', label: 'Wszystkie' }}>
        {d.visibleOrders.length === 0 ? (
          <EmptyState icon={<Truck size={34} />} title="Brak aktywnych zamówień" description="Utwórz zamówienie w sekcji „Zamówienia od klientów”." />
        ) : (
          <div className="max-h-[52vh] overflow-auto">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 border-b-2 border-surface-4 bg-surface-2/95 backdrop-blur-sm">
                <tr>
                  {['Nr zam.', 'Klient', 'Dostawa', 'Status', 'Szt', 'Razem kg', 'Postęp'].map((h, i) => (
                    <th key={h} className={cn('px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2', i >= 4 ? 'text-right' : 'text-left', h === 'Postęp' && 'min-w-[150px] text-left')}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.visibleOrders.map((o: any, idx: number) => {
                  const finished = d.finishedQtyByOrderNo.get(o.orderNo) ?? 0
                  const inProgress = d.inProgressQtyByOrderId.get(o.id) ?? 0
                  const qtyDone = finished + inProgress
                  const qtyTotal = Number(o.totalUnits ?? 0)
                  const pct = qtyTotal > 0 ? Math.round((qtyDone / qtyTotal) * 100) : 0
                  const isDue = o.deliveryDate ? new Date(o.deliveryDate).getTime() - Date.now() < 1000 * 60 * 60 * 48 : false
                  return (
                    <tr key={o.id} className={cn('border-b border-surface-3 transition-colors hover:bg-brand-light/40', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40')}>
                      <td className="whitespace-nowrap px-3 py-2"><code className="font-mono text-[12px] font-bold text-primary">{o.orderNo}</code></td>
                      <td className="max-w-[220px] truncate px-3 py-2 font-medium text-ink" title={o.clientName}>{clientDisplay(o.clientName)}</td>
                      <td className="whitespace-nowrap px-3 py-2">
                        {o.deliveryDate
                          ? <span className={isDue ? 'font-semibold text-red-600' : 'text-ink-2'}>{fmtDatePl(o.deliveryDate)}</span>
                          : <span className="text-ink-4">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2">
                        <Badge variant={o.status === 'in_production' ? 'warning' : o.status === 'confirmed' ? 'info' : o.status === 'done' ? 'success' : 'outline'} className="text-[10px]">
                          {ORDER_STATUS_LABEL[o.status] ?? o.status}
                        </Badge>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right">
                        {qtyDone > 0
                          ? <><span className={pct >= 100 ? 'font-bold text-emerald-700' : 'font-bold text-amber-700'}>{qtyDone}</span><span className="text-ink-4">/{qtyTotal}</span></>
                          : <span className="font-bold">{qtyTotal}</span>}
                        <span className="text-[11px] font-normal text-ink-4"> szt</span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-emerald-700">{fmtKg(o.totalKg, 0)}<span className="text-[11px] font-normal text-ink-4"> kg</span></td>
                      <td className="px-3 py-2">
                        {qtyTotal > 0 && (
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 max-w-[120px] flex-1 overflow-hidden rounded-full bg-surface-3">
                              <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : pct > 0 ? 'bg-orange-400' : 'bg-slate-300')} style={{ width: `${Math.max(pct, 2)}%` }} />
                            </div>
                            <span className={cn('text-[11px] font-semibold tabular-nums', pct >= 100 ? 'text-emerald-700' : pct > 0 ? 'text-amber-700' : 'text-ink-4')}>{pct}%</span>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </PanelCard>

      {/* ── Magazyny ────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <PanelCard title="Mięso z/s — po rozbiorze" icon={<Package size={15} />}
          meta={`${d.meatByBatch.length} partii`} action={{ to: '/office/magazyn/surowiec', label: 'Magazyn' }}>
          {d.meatByBatch.length === 0 ? (
            <EmptyState icon={<Package size={34} />} title="Brak mięsa w magazynie" description="Wykonaj rozbiór, aby zasilić magazyn." />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 border-b-2 border-surface-4 bg-surface-2/95 backdrop-blur-sm">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-2">Partia surowca</th>
                    <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-ink-2">Lotów</th>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-2">Ważność</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-ink-2">Razem</th>
                  </tr>
                </thead>
                <tbody>
                  {d.meatByBatch.map((g, idx) => (
                    <tr key={g.rawBatchNo} className={cn('border-b border-surface-3 hover:bg-brand-light/40', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40')}>
                      <td className="whitespace-nowrap px-3 py-2"><code className="rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[12px] font-bold text-ink">{g.rawBatchNo}</code></td>
                      <td className="px-3 py-2 text-center text-ink-2">{g.lots}</td>
                      <td className="whitespace-nowrap px-3 py-2">{g.earliestExpiry ? <ExpiryBadge dateStr={g.earliestExpiry} /> : <span className="text-ink-4">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-emerald-700">{fmtKg(g.kg, 1)}<span className="text-[11px] font-normal"> kg</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>

        <PanelCard title="Mięso przyprawione — magazyn" icon={<Boxes size={15} />}
          meta={`${d.seasonedByRecipe.length} receptur`} action={{ to: '/office/magazyn/mieso-przyp', label: 'Magazyn' }}>
          {d.seasonedByRecipe.length === 0 ? (
            <EmptyState icon={<Boxes size={34} />} title="Brak mięsa przyprawionego" description="Zakończ zlecenie masowania, aby zasilić magazyn." />
          ) : (
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs tabular-nums">
                <thead className="sticky top-0 z-10 border-b-2 border-surface-4 bg-surface-2/95 backdrop-blur-sm">
                  <tr>
                    <th className="px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-2">Receptura</th>
                    <th className="px-3 py-2 text-center text-[11px] font-bold uppercase tracking-wider text-ink-2">Szarż</th>
                    <th className="px-3 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-ink-2">Razem</th>
                  </tr>
                </thead>
                <tbody>
                  {d.seasonedByRecipe.map((g, idx) => (
                    <tr key={g.recipeName} className={cn('border-b border-surface-3 hover:bg-brand-light/40', idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40')}>
                      <td className="px-3 py-2 font-semibold text-ink">{g.recipeName}</td>
                      <td className="px-3 py-2 text-center text-ink-2">{g.batches}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-bold text-emerald-700">{fmtKg(g.kg, 1)}<span className="text-[11px] font-normal"> kg</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </PanelCard>
      </div>
    </div>
  )
}
