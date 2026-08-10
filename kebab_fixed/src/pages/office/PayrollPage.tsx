import { useEffect, useState } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { usersApi, payrollApi } from '@/lib/apiClient'
import {
  ROLE_LABEL, buildPaySlipsDocument, basisLabel, basisTotal, basisUnit,
  dayAmount, dayEarning, pageCount, settlementOverlapsRange, sundayBonusTotal,
} from '@/lib/paySlipPrint'
import { splitDeductions, sumDeductions } from '@/lib/payrollDeductions'
import { isSaturday, isSunday } from '@/lib/workHours'
import { toast } from 'sonner'
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Scissors, Factory, Users, Plus, Trash2, Printer, ChevronRight, CheckCircle, Lock, Archive, Undo2, Wallet } from 'lucide-react'

const ROLE_ICON: Record<string, React.ReactNode> = {
  WORKER_DEBONING: <Scissors size={14} />,
  WORKER_PRODUCTION: <Factory size={14} />,
  WORKER_GENERAL: <Users size={14} />,
}

function fmtPln(n: number) {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtKg(n: number) {
  return n.toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Default: current week Mon–Sun
function getDefaultRange() {
  const today = new Date()
  const day = today.getDay()
  const mon = new Date(today)
  mon.setDate(today.getDate() - (day === 0 ? 6 : day - 1))
  const sun = new Date(mon)
  sun.setDate(mon.getDate() + 6)
  return {
    from: mon.toISOString().slice(0, 10),
    to:   sun.toISOString().slice(0, 10),
  }
}

export function PayrollPage() {
  const { data: workers, loading: wLoading } = useApi(() => usersApi.list(true))
  const [selWorker, setSelWorker]   = useState<any>(null)
  const [range, setRange]           = useState(() => getDefaultRange())
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set())
  const [deductions, setDeductions] = useState<{ id: string; description: string; amount: string }[]>([])
  const [showSettlement, setShowSettlement] = useState<any>(null)
  const [selectedSlips, setSelectedSlips] = useState<Set<string>>(new Set())
  const [showBatchPrint, setShowBatchPrint] = useState(false)
  const [bulkRole, setBulkRole] = useState<string | null>(null)
  const [printRole, setPrintRole] = useState<string | null>(null)

  const { data: workerDays, loading: daysLoading, refetch: refetchDays } = useApi(
    () => selWorker ? payrollApi.getWorkerDays(selWorker.id, range.from, range.to) : Promise.resolve([]),
    [selWorker?.id, range.from, range.to]
  )
  const { data: settlements, loading: settLoading, refetch: refetchSettlements } = useApi(
    () => selWorker ? payrollApi.listSettlements(selWorker.id) : Promise.resolve([]),
    [selWorker?.id]
  )

  const { data: pendingDeductions, refetch: refetchDeductions } = useApi(
    () => selWorker ? payrollApi.listDeductions(selWorker.id) : Promise.resolve([]),
    [selWorker?.id]
  )
  const [pickedDeductions, setPickedDeductions] = useState<Set<string>>(new Set())
  const [newDed, setNewDed] = useState({
    open: false, date: '', description: '', amount: '',
    kind: 'deduction' as 'deduction' | 'credit',
  })
  // Cofnięcie rozliczenia — bez tego pomyłkę trzeba było prostować w bazie.
  const [undoTarget, setUndoTarget] = useState<any>(null)
  const [undoBusy, setUndoBusy] = useState(false)

  const createMut = useMutation((dto: any) => payrollApi.createSettlement(dto))
  const adjustMut = useMutation((dto: any) => payrollApi.createKgAdjustment(dto))

  // Korekta kg doliczana wyłącznie do płacy — nie rusza wpisów rozbioru.
  const [adjustDay, setAdjustDay] = useState<any>(null)
  const [adjustKg, setAdjustKg]   = useState('')
  const [adjustReason, setAdjustReason] = useState('')

  async function handleAdjust() {
    const delta = parseFloat(adjustKg.replace(',', '.'))
    if (!selWorker || !adjustDay || !delta) return
    if (!adjustReason.trim()) { toast.error('Podaj powód korekty'); return }
    try {
      await adjustMut.mutate({
        workerId: selWorker.id,
        workDate: adjustDay.workDate,
        kgDelta: delta,
        reason: adjustReason.trim(),
      })
      setAdjustDay(null); setAdjustKg(''); setAdjustReason('')
      refetchDays()
      toast.success('Korekta dopisana do rozliczenia')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd korekty')
    }
  }

  const hallWorkers = (workers ?? []).filter(w => w.role?.startsWith('WORKER') && w.active)
  // Zarchiwizowani zostają na liście — inaczej po zwolnieniu kogoś nie dałoby
  // się domknąć jego ostatniego tygodnia.
  const archivedWorkers = (workers ?? []).filter(w => w.role?.startsWith('WORKER') && !w.active)

  function selectWorker(w: any) {
    setSelWorker(w)
    setSelectedDays(new Set())
    setDeductions([])
  }

  function toggleDay(date: string) {
    setSelectedDays(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date); else next.add(date)
      return next
    })
  }

  // Podstawa idzie za rolą, a u ogólnych dodatkowo za trybem: myjący ma
  // stawkę ZA DZIEŃ obecności, nie za godziny.
  const isDaily   = selWorker?.role === 'WORKER_GENERAL'
    && ((selWorker as any)?.payMode ?? (selWorker as any)?.pay_mode) === 'daily'
  const isHourly  = selWorker?.role === 'WORKER_GENERAL' && !isDaily
  const rateDay   = parseFloat(String((selWorker as any)?.ratePerDay ?? (selWorker as any)?.rate_per_day ?? 0)) || 0
  const rate      = parseFloat(String((selWorker as any)?.ratePerKg ?? (selWorker as any)?.rate_per_kg ?? 0)) || 0
  const rateHour  = parseFloat(String((selWorker as any)?.ratePerHour ?? (selWorker as any)?.rate_per_hour ?? 0)) || 0
  const effRate   = isDaily ? rateDay : isHourly ? rateHour : rate
  const sundayOn  = !!((selWorker as any)?.sundayBonusEnabled ?? (selWorker as any)?.sunday_bonus_enabled)
  const sundayAdd = sundayOn
    ? parseFloat(String((selWorker as any)?.sundayBonusPerHour ?? (selWorker as any)?.sunday_bonus_per_hour ?? 0)) || 0
    : 0

  const unitPerDay: Record<string, number> = Object.fromEntries(
    (workerDays ?? []).map((d: any) => [
      d.workDate,
      isDaily ? (d.present ? 1 : 0) : ((isHourly ? d.hours : d.kgTotal) ?? 0),
    ])
  )
  const totalUnits = Array.from(selectedDays).reduce((s, d) => s + (unitPerDay[d] ?? 0), 0)
  // Premia niedzielna dolicza się WYŁĄCZNIE do godzin z niedzieli.
  const saturdayOn  = !!((selWorker as any)?.saturdayBonusEnabled ?? (selWorker as any)?.saturday_bonus_enabled)
  const saturdayAdd = saturdayOn
    ? parseFloat(String((selWorker as any)?.saturdayBonusPerHour ?? (selWorker as any)?.saturday_bonus_per_hour ?? 0)) || 0
    : 0
  const sundayUnits = isHourly
    ? Array.from(selectedDays).filter(isSunday).reduce((s, d) => s + (unitPerDay[d] ?? 0), 0)
    : 0
  const saturdayUnits = isHourly
    ? Array.from(selectedDays).filter(isSaturday).reduce((s, d) => s + (unitPerDay[d] ?? 0), 0)
    : 0
  const gross = totalUnits * effRate + sundayUnits * sundayAdd + saturdayUnits * saturdayAdd

  const dedSplit = splitDeductions(((pendingDeductions ?? []) as any[]), range.from, range.to)
  const pickedTotal = sumDeductions(dedSplit.inRange.filter(d => pickedDeductions.has(d.id)))
  const deductTotal = deductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0) + pickedTotal
  const net = gross - deductTotal
  const employerCost = parseFloat(String((selWorker as any)?.employerCostAmount ?? (selWorker as any)?.employer_cost_amount ?? 0)) || 0

  // Pracownik przeniesiony na godziny mógł zostawić nierozliczone kilogramy
  // (prod: ADRIAN przestawiony na rolę ogólną tylko po to, żeby zniknąć z HMI).
  const { data: pendingKg } = useApi(
    () => (selWorker && isHourly)
      ? payrollApi.pendingKgDays(selWorker.id, range.from, range.to)
      : Promise.resolve({ days: 0, kg: 0 }),
    [selWorker?.id, isHourly, range.from, range.to]
  )

  // Oczekujące z zakresu wchodzą domyślnie zaznaczone.
  const inRangeKey = dedSplit.inRange.map(d => d.id).join(',')
  useEffect(() => {
    setPickedDeductions(new Set(dedSplit.inRange.map(d => d.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRangeKey])

  async function handleSettle() {
    if (!selWorker || selectedDays.size === 0) return
    try {
      const perDate = Object.fromEntries(Array.from(selectedDays).map(d => [d, unitPerDay[d] ?? 0]))
      const dto = {
        workerId: selWorker.id,
        dateFrom: range.from,
        dateTo: range.to,
        workDates: Array.from(selectedDays),
        kgPerDate: (isHourly || isDaily) ? {} : perDate,
        hoursPerDate: isHourly ? perDate : {},
        daysPerDate: isDaily ? perDate : {},
        ratePerKg: (isHourly || isDaily) ? 0 : rate,
        ratePerHour: isHourly ? rateHour : 0,
        ratePerDay: isDaily ? rateDay : 0,
        deductions: deductions.map(d => ({ description: d.description, amount: parseFloat(d.amount) || 0 })),
        deductionIds: Array.from(pickedDeductions),
        notes: '',
      }
      const result = await createMut.mutate(dto)
      setShowSettlement(result)
      setSelectedDays(new Set())
      setDeductions([])
      setPickedDeductions(new Set())
      refetchDays()
      refetchSettlements()
      refetchDeductions()
      toast.success('Rozliczenie zapisane!')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd rozliczenia')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setShowBatchPrint(true)}>
          <Printer size={14} className="mr-2" /> Drukuj paski (wszyscy)
        </Button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Lewa kolumna — lista pracowników (dwie grupy) */}
        <div className="space-y-3">
          {wLoading ? (
            <Card><CardContent className="p-4 space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}</CardContent></Card>
          ) : (
            <>
              {(['WORKER_DEBONING', 'WORKER_PRODUCTION', 'WORKER_GENERAL'] as const).map(roleKey => {
                const group = hallWorkers.filter(w => w.role === roleKey)
                if (group.length === 0) return null
                const hourlyGroup = roleKey === 'WORKER_GENERAL'
                return (
                  <Card key={roleKey}>
                    <CardHeader className="pb-2 space-y-2">
                      <CardTitle className="text-sm flex items-center gap-1.5">
                        {ROLE_ICON[roleKey]} {ROLE_LABEL[roleKey]}
                      </CardTitle>
                      {/* Akcje przy SWOJEJ tabeli — rozliczenie i paski dotyczą
                          tej grupy, nie całej hali. */}
                      <div className="flex gap-1.5">
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs flex-1"
                          onClick={() => setBulkRole(roleKey)}>
                          <Wallet size={12} className="mr-1" /> Rozlicz
                        </Button>
                        <Button variant="outline" size="sm" className="h-7 px-2 text-xs flex-1"
                          onClick={() => setPrintRole(roleKey)}>
                          <Printer size={12} className="mr-1" /> Paski
                        </Button>
                      </div>
                    </CardHeader>
                    <CardContent className="p-0 pb-2">
                      <div className="px-3 space-y-1.5">
                        {group.map(w => {
                          // Ogólni rozliczają się z godzin — pokazanie im zł/kg
                          // sugerowałoby akord, którego nie mają.
                          const wRate = hourlyGroup
                            ? parseFloat(String((w as any).ratePerHour ?? (w as any).rate_per_hour ?? 0))
                            : parseFloat(String((w as any).ratePerKg ?? (w as any).rate_per_kg ?? 0))
                          const ct = (w as any).contractType ?? (w as any).contract_type ?? 'zlecenie'
                          return (
                            <button key={w.id} onClick={() => selectWorker(w)}
                              className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all ${selWorker?.id === w.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
                              <div className="flex items-center justify-between">
                                <span className="font-semibold text-sm">{w.name}</span>
                                <ChevronRight size={14} className="text-muted-foreground" />
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                {wRate.toFixed(2)} {hourlyGroup ? 'zł/h' : 'zł/kg'} · {ct === 'praca' ? 'UoP' : 'Zlecenie'}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )
              })}
              {archivedWorkers.length > 0 && (
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-1.5 text-muted-foreground">
                      <Archive size={14} /> Archiwum
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Zwolnieni — zostają tu, żeby domknąć ostatnie rozliczenie
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="p-0 pb-2">
                    <div className="px-3 space-y-1.5">
                      {archivedWorkers.map(w => (
                        <button key={w.id} onClick={() => selectWorker(w)}
                          className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all ${selWorker?.id === w.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-sm">{w.name}</span>
                            <ChevronRight size={14} className="text-muted-foreground" />
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {ROLE_LABEL[w.role] ?? w.role} · zarchiwizowany
                          </div>
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
              {hallWorkers.length === 0 && archivedWorkers.length === 0 && (
                <Card><CardContent className="p-6 text-center text-sm text-muted-foreground">Brak pracowników hali</CardContent></Card>
              )}
            </>
          )}
        </div>

        {/* Środkowa + prawa — rozliczenie */}
        {selWorker ? (
          <div className="lg:col-span-2 space-y-4">

            {/* Nagłówek pracownika */}
            <Card>
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-lg font-black">{selWorker.name}</div>
                  <div className="text-sm text-muted-foreground">
                    {ROLE_LABEL[selWorker.role]} · Stawka:{' '}
                    <strong>{effRate.toFixed(2)} {isDaily ? 'zł/dzień' : isHourly ? 'zł/h' : 'zł/kg'}</strong>
                    {isHourly && sundayAdd > 0 && <> · Niedziela: <strong className="text-amber-700">+{sundayAdd.toFixed(2)} zł/h</strong></>}
                    {employerCost > 0 && <> · Koszty: <strong>{fmtPln(employerCost)} zł/mies.</strong></>}
                    {' · '}{(selWorker.contractType ?? selWorker.contract_type ?? 'zlecenie') === 'praca' ? 'Umowa o pracę' : 'Umowa zlecenie'}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Zakres dat */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Zakres rozliczenia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex gap-3 items-end">
                  <div className="space-y-1 flex-1">
                    <Label className="text-xs">Od</Label>
                    <Input type="date" value={range.from}
                      onChange={e => { setRange(r => ({ ...r, from: e.target.value })); setSelectedDays(new Set()) }} />
                  </div>
                  <div className="space-y-1 flex-1">
                    <Label className="text-xs">Do</Label>
                    <Input type="date" value={range.to}
                      onChange={e => { setRange(r => ({ ...r, to: e.target.value })); setSelectedDays(new Set()) }} />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Osierocony akord: rola sie zmienila, kilogramy zostaly */}
            {isHourly && (pendingKg?.days ?? 0) > 0 && (
              <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900">
                <strong>{selWorker.name}</strong> ma {pendingKg!.days} nierozliczonych dni
                rozbioru ({fmtKg(pendingKg!.kg)} kg) w tym zakresie. Rozliczenie idzie za
                bieżącą rolą — żeby je zapłacić, przestaw rolę na „Pracownik rozbioru"
                w zakładce Pracownicy.
              </div>
            )}

            {/* Dni pracy */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Dni pracy</CardTitle>
                  {(workerDays ?? []).filter(d => !d.settled && !d.open && !(isDaily && !d.present)).length > 0 && (
                    <button className="text-xs text-primary underline"
                      onClick={() => setSelectedDays(new Set((workerDays ?? [])
                        .filter(d => !d.settled && !d.open && !(isDaily && !d.present))
                        .map(d => d.workDate)))}>
                      Zaznacz wszystkie
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent>
                {daysLoading ? (
                  <div className="space-y-2">{[0,1,2].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                ) : (workerDays ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-4">
                    Brak wpisów w wybranym zakresie dat
                  </div>
                ) : (
                  <div className="space-y-2">
                    {(workerDays ?? []).map((d: any) => {
                      // JEDNO źródło podstawy — wcześniej wiersz czytał kgTotal
                      // także dla dniówki i godzin, więc pokazywał zero przy
                      // poprawnej sumie na dole.
                      const unit = unitPerDay[d.workDate] ?? 0
                      const sunday   = isHourly && isSunday(d.workDate)
                      const saturday = isHourly && isSaturday(d.workDate)
                      const earn = unit * (effRate
                        + (sunday ? sundayAdd : saturday ? saturdayAdd : 0))
                      const sel  = selectedDays.has(d.workDate)
                      // Dzień otwarty (bez godziny końca) wpadłby jako 0 h —
                      // pracownik dostałby za mało, więc go nie zaznaczamy.
                      // Dniówka: dzień nieobecności nie ma czego rozliczać —
                      // zaznaczenie go tylko zamknęłoby dzień na zero.
                      const blocked = d.settled || d.open || (isDaily && !d.present)
                      return (
                        <div key={d.workDate}
                          className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-all ${
                            blocked ? 'bg-muted border-muted opacity-60' :
                            sel ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}>
                          {!blocked && (
                            <input type="checkbox" checked={sel} onChange={() => toggleDay(d.workDate)}
                              className="w-4 h-4 rounded cursor-pointer" />
                          )}
                          {d.settled && <CheckCircle size={16} className="text-green-600 flex-shrink-0" />}
                          <div className="flex-1">
                            <div className="text-sm font-semibold">
                              {new Date(d.workDate + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}
                              {isHourly && isSaturday(d.workDate) && saturdayAdd > 0 && (
                                <span className="ml-2 text-[10px] font-bold uppercase text-amber-700">premia</span>
                              )}
                              {sunday && sundayAdd > 0 && (
                                <span className="ml-2 text-[10px] font-bold uppercase text-amber-700">premia</span>
                              )}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {isDaily
                                ? (d.present ? 'obecny' : ({ off: 'Wolne', vacation: 'Urlop', sick: 'Chorobowe', absent: 'Nieobecność' } as Record<string, string>)[d.status] ?? 'brak wpisu')
                                : isHourly
                                ? (d.status && d.status !== 'work'
                                    ? ({ off: 'Wolne', vacation: 'Urlop', sick: 'Chorobowe', absent: 'Nieobecność' } as Record<string, string>)[d.status]
                                    : `${d.timeFrom || '—'}–${d.timeTo || '…'}`)
                                : (d.entriesCount ? `${d.entriesCount} wpisów` : d.sessionCount ? `${d.sessionCount} sesji` : '')}
                              {d.open && ' · brak godziny końca'}
                              {d.settled && ' · Rozliczone'}
                            </div>
                            {d.kgAdjustment ? (
                              <div className="text-xs text-amber-700 font-medium mt-0.5">
                                zważone {fmtKg(d.kgMeasured ?? 0)} kg
                                {' '}· korekta {d.kgAdjustment > 0 ? '+' : ''}{fmtKg(d.kgAdjustment)} kg
                              </div>
                            ) : null}
                          </div>
                          {!blocked && !isHourly && (
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs"
                              onClick={() => { setAdjustDay(d); setAdjustKg(''); setAdjustReason('') }}>
                              Korekta
                            </Button>
                          )}
                          <div className="text-right">
                            <div className="text-sm font-bold tabular-nums">
                              {isDaily ? (unit ? 'obecny' : '—') : `${fmtKg(unit)} ${isHourly ? 'h' : 'kg'}`}
                            </div>
                            {!blocked && sel && (
                              <div className="text-xs text-green-700 font-semibold">{fmtPln(earn)} zł</div>
                            )}
                            {d.settled && <Lock size={11} className="text-muted-foreground ml-auto mt-0.5" />}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Potrącenia — karta widoczna ZAWSZE: potrącenie dopisuje się
                w poniedziałek, a rozlicza w piątek. */}
            <Card>
              <CardHeader className="pb-2 flex-row items-center justify-between space-y-0">
                <CardTitle className="text-sm">Potrącenia i uznania</CardTitle>
                <button className="text-xs text-primary hover:underline flex items-center gap-1"
                  onClick={() => setNewDed({ open: true, date: new Date().toISOString().slice(0, 10), description: '', amount: '', kind: 'deduction' })}>
                  <Plus size={12} /> Dodaj pozycję
                </button>
              </CardHeader>
              <CardContent className="space-y-3">
                {dedSplit.overdue.length > 0 && (
                  <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    <strong>Zaległe pozycje:</strong>{' '}
                    {dedSplit.overdue.length} poz. · {fmtPln(Math.abs(sumDeductions(dedSplit.overdue)))} zł
                    {' — '}cofnij datę „Od", żeby weszły do tego rozliczenia.
                  </div>
                )}
                {dedSplit.inRange.length > 0 && (
                  <div className="space-y-1.5">
                    {dedSplit.inRange.map(d => (
                      <label key={d.id} className="flex items-center gap-2 rounded-xl border-2 border-border px-3 py-2 cursor-pointer">
                        <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                          checked={pickedDeductions.has(d.id)}
                          onChange={() => setPickedDeductions(prev => {
                            const next = new Set(prev)
                            if (next.has(d.id)) next.delete(d.id); else next.add(d.id)
                            return next
                          })} />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold truncate">{d.description}</div>
                          <div className="text-xs text-muted-foreground">
                            {new Date(d.deductionDate + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                            {d.kind === 'credit' && ' · uznanie'}
                            {d.sourceType === 'wz' && ' · z WZ'}
                          </div>
                        </div>
                        <span className={`text-sm font-bold tabular-nums ${d.kind === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
                          {d.kind === 'credit' ? '+' : '−'} {fmtPln(Number(d.amount))} zł
                        </span>
                        <button onClick={async e => {
                          e.preventDefault()
                          try {
                            await payrollApi.cancelDeduction(d.id)
                            refetchDeductions()
                          } catch (err: unknown) {
                            toast.error(err instanceof Error ? err.message : 'Błąd usuwania')
                          }
                        }} className="text-destructive hover:text-destructive/70"><Trash2 size={14} /></button>
                      </label>
                    ))}
                  </div>
                )}
                {deductions.map(d => (
                  <div key={d.id} className="flex gap-2 items-center">
                    <Input placeholder="Opis (np. zaliczka, czynsz)" value={d.description}
                      onChange={e => setDeductions(prev => prev.map(x => x.id === d.id ? { ...x, description: e.target.value } : x))} />
                    <Input type="number" step="0.01" placeholder="0.00" className="w-28" value={d.amount}
                      onChange={e => setDeductions(prev => prev.map(x => x.id === d.id ? { ...x, amount: e.target.value } : x))} />
                    <span className="text-muted-foreground text-sm">zł</span>
                    <button onClick={() => setDeductions(prev => prev.filter(x => x.id !== d.id))}
                      className="text-destructive hover:text-destructive/70"><Trash2 size={15} /></button>
                  </div>
                ))}
                {dedSplit.inRange.length === 0 && dedSplit.overdue.length === 0 && deductions.length === 0 && (
                  <div className="text-xs text-muted-foreground">Brak potrąceń w tym okresie</div>
                )}
                <button onClick={() => setDeductions(prev => [...prev, { id: Math.random().toString(), description: '', amount: '' }])}
                  className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                  <Plus size={13} /> Pozycja doraźna (tylko to rozliczenie)
                </button>
              </CardContent>
            </Card>

            {/* Podsumowanie + rozlicz */}
            {selectedDays.size > 0 && (
              <Card className="border-primary/30 bg-primary/5">
                <CardContent className="p-4 space-y-3">
                  <div className="text-sm font-bold text-primary">Podsumowanie rozliczenia</div>
                  <div className="space-y-1.5">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Dni pracy</span>
                      <span className="font-semibold">{selectedDays.size}</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">{isHourly ? 'Łącznie godzin' : 'Łącznie kg'}</span>
                      <span className="font-semibold">{fmtKg(totalUnits)} {isHourly ? 'h' : 'kg'}</span>
                    </div>
                    {isHourly && saturdayUnits > 0 && saturdayAdd > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          w tym sobota ({fmtKg(saturdayUnits)} h × +{saturdayAdd.toFixed(2)} zł/h)
                        </span>
                        <span className="font-semibold text-amber-700">+ {fmtPln(saturdayUnits * saturdayAdd)} zł</span>
                      </div>
                    )}
                    {isHourly && sundayUnits > 0 && sundayAdd > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          w tym niedziela ({fmtKg(sundayUnits)} h × +{sundayAdd.toFixed(2)} zł/h)
                        </span>
                        <span className="font-semibold text-amber-700">+ {fmtPln(sundayUnits * sundayAdd)} zł</span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">
                        Wynagrodzenie brutto ({effRate.toFixed(2)} {isDaily ? 'zł/dzień' : isHourly ? 'zł/h' : 'zł/kg'})
                      </span>
                      <span className="font-semibold">{fmtPln(gross)} zł</span>
                    </div>
                    {employerCost > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Koszt pracodawcy (ZUS itp.)</span>
                        <span className="font-semibold text-orange-700">{fmtPln(employerCost)} zł</span>
                      </div>
                    )}
                    {deductTotal !== 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">
                          {deductTotal > 0 ? 'Potrącenia' : 'Uznania'}
                        </span>
                        <span className={`font-semibold ${deductTotal > 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {deductTotal > 0 ? '−' : '+'} {fmtPln(Math.abs(deductTotal))} zł
                        </span>
                      </div>
                    )}
                    <Separator />
                    <div className="flex justify-between text-base font-black">
                      <span>Do wypłaty (netto)</span>
                      <span className="text-green-700">{fmtPln(net)} zł</span>
                    </div>
                  </div>
                  <Button className="w-full" onClick={handleSettle} disabled={createMut.loading}>
                    {createMut.loading
                      ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                      : <CheckCircle size={16} className="mr-2" />
                    }
                    Rozlicz i generuj pasek
                  </Button>
                </CardContent>
              </Card>
            )}

            {/* Historia rozliczeń */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Historia rozliczeń</CardTitle>
                  {selectedSlips.size > 0 && (
                    <button
                      onClick={async () => {
                        const ids = Array.from(selectedSlips)
                        const full = await Promise.all(ids.map(id => payrollApi.getSettlement(id)))
                        printPaySlips(full)
                        setSelectedSlips(new Set())
                      }}
                      className="flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                    >
                      <Printer size={12} /> Drukuj zaznaczone ({selectedSlips.size})
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {settLoading ? (
                  <div className="p-4 space-y-2">{[0,1].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                ) : (settlements ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">Brak rozliczeń</div>
                ) : (
                  <div className="divide-y">
                    {(settlements ?? []).map((s: any) => {
                      const checked = selectedSlips.has(s.id)
                      return (
                        <div key={s.id} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              setSelectedSlips(prev => {
                                const next = new Set(prev)
                                if (next.has(s.id)) next.delete(s.id)
                                else next.add(s.id)
                                return next
                              })
                            }}
                            className="w-4 h-4 rounded cursor-pointer"
                          />
                          <div className="flex-1">
                            <div className="text-sm font-semibold">
                              {new Date(s.date_from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} –{' '}
                              {new Date(s.date_to + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {fmtKg(s.kg_total)} kg · {fmtPln(s.gross_amount)} zł brutto
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-base font-black text-green-700">{fmtPln(s.net_amount)} zł</div>
                            <div className="flex items-center gap-2 justify-end">
                              <button onClick={async () => {
                                const full = await payrollApi.getSettlement(s.id)
                                printPaySlips([full])
                              }} className="text-xs text-primary hover:underline flex items-center gap-1">
                                <Printer size={11} /> Drukuj
                              </button>
                              <button onClick={() => setUndoTarget(s)}
                                className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1">
                                <Undo2 size={11} /> Cofnij
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

          </div>
        ) : (
          <div className="lg:col-span-2 flex items-center justify-center min-h-[300px]">
            <div className="text-center text-muted-foreground">
              <Users size={40} className="mx-auto mb-3 opacity-20" />
              <div className="text-sm">Wybierz pracownika z listy po lewej</div>
            </div>
          </div>
        )}
      </div>

      {/* Modal paska wypłaty */}
      {showSettlement && (
        <Dialog open onOpenChange={() => setShowSettlement(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Pasek wypłaty</DialogTitle>
              <DialogDescription>{showSettlement.worker_name}</DialogDescription>
            </DialogHeader>
            <PaySlipPreview settlement={showSettlement} />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => setShowSettlement(null)}>Zamknij</Button>
              <Button onClick={() => printPaySlips([showSettlement])}>
                <Printer size={14} className="mr-2" /> Drukuj (A4 poziomo — 4 paski)
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Dialog druku zbiorczego */}
      {showBatchPrint && <BatchPrintDialog onClose={() => setShowBatchPrint(false)} />}
      {printRole && <BatchPrintDialog role={printRole} onClose={() => setPrintRole(null)} />}

      {/* Rozliczenie całej grupy jednym kliknięciem */}
      {bulkRole && (
        <BulkSettleDialog
          role={bulkRole}
          onClose={() => setBulkRole(null)}
          onDone={() => { refetchDays(); refetchSettlements(); refetchDeductions() }}
        />
      )}

      {/* Cofnięcie rozliczenia — stan jak przed nim */}
      {undoTarget && (
        <Dialog open onOpenChange={() => setUndoTarget(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Cofnąć rozliczenie?</DialogTitle>
              <DialogDescription>
                {undoTarget.worker_name} ·{' '}
                {new Date(undoTarget.date_from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}
                {' – '}
                {new Date(undoTarget.date_to + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
                {' · '}{fmtPln(Number(undoTarget.net_amount))} zł netto
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>Dni wrócą do rozliczenia, a pasek zniknie z historii.</p>
              <p>
                Potrącenia z tego paska wrócą do kolejki jako <strong>oczekujące</strong> —
                to realny dług pracownika, więc nie znikają razem z rozliczeniem.
              </p>
              <p className="text-amber-800">
                Jeśli pasek został już wydrukowany i wypłacony, cofnięcie tego nie odwróci.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setUndoTarget(null)} disabled={undoBusy}>Anuluj</Button>
              <Button variant="destructive" disabled={undoBusy} onClick={async () => {
                setUndoBusy(true)
                try {
                  const r = await payrollApi.undoSettlement(undoTarget.id)
                  setUndoTarget(null)
                  refetchDays(); refetchSettlements(); refetchDeductions()
                  toast.success(
                    `Cofnięto rozliczenie — ${r.unlockedDays} dni wróciło` +
                    (r.restoredDeductions ? `, ${r.restoredDeductions} potrąceń do kolejki` : ''))
                } catch (e: unknown) {
                  toast.error(e instanceof Error ? e.message : 'Błąd cofania')
                } finally {
                  setUndoBusy(false)
                }
              }}>
                <Undo2 size={14} className="mr-1.5" /> Cofnij rozliczenie
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Potrącenie dopisywane z wyprzedzeniem — czeka na rozliczenie */}
      {newDed.open && (
        <Dialog open onOpenChange={() => setNewDed(d => ({ ...d, open: false }))}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Dodaj pozycję</DialogTitle>
              <DialogDescription>
                {selWorker?.name} — czeka do rozliczenia obejmującego tę datę
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              {/* Uznanie to odwrotność potrącenia — dodatek, zwrot, premia
                  uznaniowa. Ta sama kolejka, przeciwny znak. */}
              <div className="flex gap-2">
                {([
                  { v: 'deduction' as const, l: 'Potrącenie', d: 'zabiera z wypłaty' },
                  { v: 'credit'    as const, l: 'Uznanie',    d: 'dokłada do wypłaty' },
                ]).map(o => (
                  <button key={o.v} type="button"
                    onClick={() => setNewDed(d => ({ ...d, kind: o.v }))}
                    className={`flex-1 py-2 rounded-xl border-2 text-sm font-semibold transition-all ${
                      newDed.kind === o.v
                        ? (o.v === 'credit' ? 'border-green-600 bg-green-50 text-green-800'
                                            : 'border-primary bg-primary text-white')
                        : 'border-border text-muted-foreground hover:border-primary/40'}`}>
                    {o.l}
                    <div className="text-[10px] font-normal opacity-80">{o.d}</div>
                  </button>
                ))}
              </div>
              <div className="space-y-1.5">
                <Label>Data</Label>
                <Input type="date" value={newDed.date}
                  onChange={e => setNewDed(d => ({ ...d, date: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Opis</Label>
                <Input placeholder="np. zaliczka, zakup mięsa" value={newDed.description}
                  onChange={e => setNewDed(d => ({ ...d, description: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label>Kwota (zł)</Label>
                <Input type="number" step="0.01" min="0" value={newDed.amount}
                  onChange={e => setNewDed(d => ({ ...d, amount: e.target.value }))} />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setNewDed(d => ({ ...d, open: false }))}>Anuluj</Button>
                <Button onClick={async () => {
                  try {
                    await payrollApi.createDeduction({
                      workerId: selWorker.id, deductionDate: newDed.date,
                      description: newDed.description, amount: parseFloat(newDed.amount) || 0,
                      kind: newDed.kind,
                    })
                    setNewDed({ open: false, date: '', description: '', amount: '', kind: 'deduction' })
                    refetchDeductions()
                    toast.success(newDed.kind === 'credit'
                      ? 'Uznanie zapisane — wejdzie do rozliczenia'
                      : 'Potrącenie zapisane — wejdzie do rozliczenia')
                  } catch (e: unknown) {
                    toast.error(e instanceof Error ? e.message : 'Błąd zapisu')
                  }
                }}>Zapisz</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Korekta kg — liczona wyłącznie do płacy */}
      {adjustDay && (
        <Dialog open onOpenChange={() => setAdjustDay(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Korekta kilogramów</DialogTitle>
              <DialogDescription>
                {selWorker?.name} ·{' '}
                {new Date(adjustDay.workDate + 'T12:00:00').toLocaleDateString('pl-PL', {
                  weekday: 'long', day: 'numeric', month: 'long',
                })}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm">
                Zważone w rozbiorze:{' '}
                <span className="font-semibold tabular-nums">
                  {fmtKg(adjustDay.kgMeasured ?? adjustDay.kgTotal ?? 0)} kg
                </span>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-kg">Korekta (kg)</Label>
                <Input id="adj-kg" inputMode="decimal" placeholder="np. 150 lub -20"
                  value={adjustKg} onChange={e => setAdjustKg(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="adj-reason">Powód</Label>
                <Input id="adj-reason" placeholder="np. praca nieujęta w ważeniu"
                  value={adjustReason} onChange={e => setAdjustReason(e.target.value)} />
              </div>
              <p className="text-xs text-muted-foreground">
                Korekta wchodzi tylko do rozliczenia pracownika. Nie zmienia wpisów
                rozbioru, partii ani stanów magazynowych.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setAdjustDay(null)}>Anuluj</Button>
                <Button onClick={handleAdjust} disabled={adjustMut.loading}>
                  Dopisz do rozliczenia
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ─── Rozliczenie całej grupy ──────────────────────────────────
// Biuro rozlicza całą brygadę naraz, ale NIE w ciemno: najpierw plan
// (kto, ile dni, ile netto), dopiero po nim zapis.
function BulkSettleDialog({ role, onClose, onDone }: {
  role: string
  onClose: () => void
  onDone: () => void
}) {
  const [range, setRange] = useState(() => getDefaultRange())
  const [busy, setBusy] = useState(false)
  const { data: plan, loading } = useApi(
    () => payrollApi.bulkSettle({ role, dateFrom: range.from, dateTo: range.to, dryRun: true }),
    [role, range.from, range.to])

  const rows = plan?.workers ?? []
  // Domyślnie wszyscy, ale biuro musi móc kogoś pominąć (np. czeka na
  // domknięcie dnia albo dostanie wypłatę osobno).
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const rowsKey = rows.map(r => r.workerId).join(',')
  useEffect(() => { setSkip(new Set()) }, [rowsKey])

  const picked = rows.filter(r => !skip.has(r.workerId))
  const pickedNet = picked.reduce((s, r) => s + r.net, 0)

  async function run() {
    setBusy(true)
    try {
      const res = await payrollApi.bulkSettle({
        role, dateFrom: range.from, dateTo: range.to, dryRun: false,
        skipWorkerIds: Array.from(skip),
      })
      onDone(); onClose()
      if (res.failed.length) {
        toast.warning(
          `Rozliczono ${res.settled}, nie udało się ${res.failed.length}: ` +
          res.failed.map(f => f.workerName).join(', '))
      } else {
        toast.success(`Rozliczono ${res.settled} — razem ${fmtPln(res.totalNet)} zł netto`)
      }
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd rozliczenia zbiorczego')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Rozlicz: {ROLE_LABEL[role] ?? role}</DialogTitle>
          <DialogDescription>
            Powstanie jeden pasek na pracownika. Dni niedomknięte i już rozliczone są pomijane.
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 items-end">
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Od</Label>
            <Input type="date" value={range.from}
              onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Do</Label>
            <Input type="date" value={range.to}
              onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">
            Nikt z tej grupy nie ma w tym okresie dni do rozliczenia
          </div>
        ) : (
          <>
          <button type="button"
            onClick={() => setSkip(skip.size === 0 ? new Set(rows.map(r => r.workerId)) : new Set())}
            className="text-xs font-semibold text-primary hover:underline self-start">
            {skip.size === 0 ? 'Odznacz wszystkich' : 'Zaznacz wszystkich'}
          </button>
          <div className="max-h-72 overflow-y-auto divide-y border rounded-xl">
            {rows.map(r => (
              <label key={r.workerId}
                className={`flex items-center gap-3 px-3 py-2 cursor-pointer ${skip.has(r.workerId) ? 'opacity-45' : ''}`}>
                <input type="checkbox" className="w-4 h-4 rounded cursor-pointer"
                  checked={!skip.has(r.workerId)}
                  onChange={() => setSkip(prev => {
                    const next = new Set(prev)
                    if (next.has(r.workerId)) next.delete(r.workerId)
                    else next.add(r.workerId)
                    return next
                  })} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{r.workerName}</div>
                  <div className="text-xs text-muted-foreground">
                    {r.days} dni · {fmtKg(r.units)} {r.unit} · {fmtPln(r.gross)} zł brutto
                    {r.deductions > 0 && <span className="text-red-600"> − {fmtPln(r.deductions)} zł</span>}
                  </div>
                </div>
                <div className="text-sm font-black text-green-700 tabular-nums">{fmtPln(r.net)} zł</div>
              </label>
            ))}
          </div>
          </>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="text-sm text-muted-foreground">
            Razem do wypłaty:{' '}
            <strong className="text-foreground">{fmtPln(pickedNet)} zł</strong>
            {skip.size > 0 && (
              <span className="ml-2 text-xs">({skip.size} pominiętych)</span>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={busy}>Anuluj</Button>
            <Button onClick={run} disabled={busy || picked.length === 0}>
              {busy
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                : <CheckCircle size={14} className="mr-2" />}
              Rozlicz {picked.length}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Dialog druku zbiorczego (paski wielu pracowników naraz) ──
function plural(n: number, one: string, few: string, many: string) {
  if (n === 1) return one
  const d = n % 10, h = n % 100
  return d >= 2 && d <= 4 && !(h >= 12 && h <= 14) ? few : many
}

function BatchPrintDialog({ onClose, role }: { onClose: () => void; role?: string }) {
  const [range, setRange] = useState(() => getDefaultRange())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const { data: all, loading } = useApi(() => payrollApi.listSettlements(), [])

  const filtered = (all ?? [])
    .filter((s: any) => settlementOverlapsRange(s, range.from, range.to))
    .filter((s: any) => !role || s.worker_role === role)
    .sort((a: any, b: any) =>
      (a.worker_name ?? '').localeCompare(b.worker_name ?? '', 'pl') ||
      String(a.date_from).localeCompare(String(b.date_from)))

  // Zmiana zakresu / dociągnięcie danych → domyślnie wszystko zaznaczone
  const filteredKey = filtered.map((s: any) => s.id).join(',')
  useEffect(() => {
    setSelected(new Set(filtered.map((s: any) => s.id)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredKey])

  const allChecked = filtered.length > 0 && selected.size === filtered.length
  const nSel = selected.size
  const nPages = nSel === 0 ? 0 : pageCount(nSel)

  async function handlePrint() {
    const ids = filtered.filter((s: any) => selected.has(s.id)).map((s: any) => s.id)
    if (ids.length === 0) return
    setPrinting(true)
    try {
      const full = await Promise.all(ids.map((id: string) => payrollApi.getSettlement(id)))
      printPaySlips(full)
      onClose()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd pobierania pasków')
    } finally {
      setPrinting(false)
    }
  }

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Druk zbiorczy pasków</DialogTitle>
          <DialogDescription>
            {role ? `${ROLE_LABEL[role] ?? role} — ` : ''}wybierz rozliczenia do wydruku, 4 paski na kartkę A4
          </DialogDescription>
        </DialogHeader>

        <div className="flex gap-3 items-end">
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Od</Label>
            <Input type="date" value={range.from}
              onChange={e => setRange(r => ({ ...r, from: e.target.value }))} />
          </div>
          <div className="space-y-1 flex-1">
            <Label className="text-xs">Do</Label>
            <Input type="date" value={range.to}
              onChange={e => setRange(r => ({ ...r, to: e.target.value }))} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-10 rounded-xl" />)}</div>
        ) : filtered.length === 0 ? (
          <div className="text-sm text-muted-foreground text-center py-6">Brak rozliczeń w wybranym okresie</div>
        ) : (
          <>
            <button
              onClick={() => setSelected(allChecked ? new Set() : new Set(filtered.map((s: any) => s.id)))}
              className="text-xs font-semibold text-primary hover:underline self-start">
              {allChecked ? 'Odznacz wszystkich' : 'Zaznacz wszystkich'}
            </button>
            <div className="max-h-72 overflow-y-auto divide-y border rounded-xl">
              {filtered.map((s: any) => (
                <label key={s.id} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(s.id)}
                    onChange={() => {
                      setSelected(prev => {
                        const next = new Set(prev)
                        if (next.has(s.id)) next.delete(s.id)
                        else next.add(s.id)
                        return next
                      })
                    }}
                    className="w-4 h-4 rounded cursor-pointer"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{s.worker_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(s.date_from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })} –{' '}
                      {new Date(s.date_to + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {' · '}{fmtKg(s.kg_total)} kg
                    </div>
                  </div>
                  <div className="text-sm font-black text-green-700 tabular-nums">{fmtPln(s.net_amount)} zł</div>
                </label>
              ))}
            </div>
          </>
        )}

        <div className="flex items-center justify-between pt-1">
          <div className="text-sm text-muted-foreground">
            <strong className="text-foreground">{nSel}</strong> {plural(nSel, 'pasek', 'paski', 'pasków')}
            {' → '}
            <strong className="text-foreground">{nPages}</strong> {plural(nPages, 'kartka', 'kartki', 'kartek')} A4
          </div>
          <Button onClick={handlePrint} disabled={printing || nSel === 0}>
            {printing
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
              : <Printer size={14} className="mr-2" />
            }
            Drukuj
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Podgląd paska (w modalu) ─────────────────────────────────
function PaySlipPreview({ settlement: s }: { settlement: any }) {
  const dateFrom = new Date(s.date_from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
  const dateTo   = new Date(s.date_to   + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
  const days: any[] = s.work_dates_detail ?? []
  return (
    <div className="border-2 border-border rounded-xl p-4 space-y-3 text-sm">
      <div className="flex justify-between items-start">
        <div>
          <div className="font-black text-base">{s.worker_name}</div>
          <div className="text-xs text-muted-foreground">
            {ROLE_LABEL[s.worker_role] ?? s.worker_role}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{dateFrom}</div><div>— {dateTo}</div>
        </div>
      </div>
      <Separator />
      {days.length > 0 && (
        <div className="space-y-1">
          {days.map((d: any) => (
            <div key={d.work_date} className="flex justify-between text-xs">
              <span className="text-muted-foreground">
                {new Date(d.work_date + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'short', day: 'numeric', month: 'short' })}
                {/* Dzień z powrotem po południu ma dwie zmiany — obie widoczne. */}
                {((d.shifts ?? (d.time_from ? [`${d.time_from}–${d.time_to || '…'}`] : [])) as string[])
                  .map((r: string) => (
                    <span key={r} className="ml-1.5 tabular-nums">{r}</span>
                  ))}
              </span>
              {/* Dniówka: jedynka przy każdym dniu to szum — zostaje sama data. */}
              {basisUnit(s) !== 'dni' && (
                <span className="font-semibold tabular-nums">
                  {dayAmount(d, s).toFixed(2)} {basisUnit(s)}
                </span>
              )}
            </div>
          ))}
          <Separator className="my-1" />
        </div>
      )}
      <div className="space-y-1">
        <div className="flex justify-between"><span className="text-muted-foreground">{basisLabel(s)}</span><span className="font-semibold">{basisTotal(s).toFixed(2)} {basisUnit(s)}</span></div>
        {sundayBonusTotal(s) > 0 && (
          <div className="flex justify-between text-amber-700">
            <span className="text-xs">w tym niedziela {Number(s.sunday_hours).toFixed(2)} h × {Number(s.sunday_bonus_per_hour).toFixed(2)} zł</span>
            <span>+ {sundayBonusTotal(s).toFixed(2)} zł</span>
          </div>
        )}
        <div className="flex justify-between font-bold"><span>Wynagrodzenie</span><span>{Number(s.gross_amount).toFixed(2)} zł</span></div>
        {(s.deductions ?? []).map((d: any) => (
          <div key={d.id} className={`flex justify-between ${d.kind === 'credit' ? 'text-green-700' : 'text-red-600'}`}>
            <span className="text-xs">{d.description}</span>
            <span>{d.kind === 'credit' ? '+' : '−'} {Number(d.amount).toFixed(2)} zł</span>
          </div>
        ))}
      </div>
      <Separator />
      <div className="flex justify-between font-black text-base">
        <span>DO WYPŁATY</span>
        <span className="text-green-700">{Number(s.net_amount).toFixed(2)} zł</span>
      </div>
    </div>
  )
}

// ─── Druk pasków: A4 poziomo, 4 paski w siatce 2×2 ────────────
function printPaySlips(items: any[]) {
  const html = buildPaySlipsDocument(items)
  // Blob URL działa zarówno w przeglądarce (window.open _blank) jak i w Tauri
  // (window.open zwraca null → fallback do window.location).
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
