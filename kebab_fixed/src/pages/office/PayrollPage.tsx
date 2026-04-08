import { useState, useMemo } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { usersApi, payrollApi } from '@/lib/apiClient'
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
import { Scissors, Factory, Users, Plus, Trash2, Printer, ChevronRight, CheckCircle } from 'lucide-react'

const ROLE_LABEL: Record<string, string> = {
  WORKER_DEBONING: 'Rozbiór', WORKER_PRODUCTION: 'Produkcja', WORKER_GENERAL: 'Ogólny',
}
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
  const { data: workers, loading: wLoading } = useApi(() => usersApi.list())
  const [selWorker, setSelWorker]   = useState<any>(null)
  const [range, setRange]           = useState(() => getDefaultRange())
  const [selectedDays, setSelectedDays] = useState<Set<string>>(new Set())
  const [kgOverride, setKgOverride] = useState<Record<string, string>>({})
  const [deductions, setDeductions] = useState<{ id: string; description: string; amount: string }[]>([])
  const [showSettlement, setShowSettlement] = useState<any>(null)

  const { data: workerDays, loading: daysLoading, refetch: refetchDays } = useApi(
    () => selWorker ? payrollApi.getWorkerDays(selWorker.id, range.from, range.to) : Promise.resolve([]),
    [selWorker?.id, range.from, range.to]
  )
  const { data: settlements, loading: settLoading, refetch: refetchSettlements } = useApi(
    () => selWorker ? payrollApi.listSettlements(selWorker.id) : Promise.resolve([]),
    [selWorker?.id]
  )

  const createMut = useMutation((dto: any) => payrollApi.createSettlement(dto))

  const hallWorkers = (workers ?? []).filter(w => w.role?.startsWith('WORKER'))

  function selectWorker(w: any) {
    setSelWorker(w)
    setSelectedDays(new Set())
    setKgOverride({})
    setDeductions([])
  }

  function toggleDay(date: string) {
    setSelectedDays(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date); else next.add(date)
      return next
    })
  }

  const kgPerDay = useMemo(() => {
    const map: Record<string, number> = {}
    for (const d of workerDays ?? []) {
      map[d.workDate] = parseFloat(kgOverride[d.workDate] ?? '') || d.kgTotal || 0
    }
    return map
  }, [workerDays, kgOverride])

  const totalKg      = Array.from(selectedDays).reduce((s, d) => s + (kgPerDay[d] ?? 0), 0)
  const rate         = parseFloat(String((selWorker as any)?.ratePerKg ?? (selWorker as any)?.rate_per_kg ?? 0)) || 0
  const gross        = totalKg * rate
  const deductTotal  = deductions.reduce((s, d) => s + (parseFloat(d.amount) || 0), 0)
  const net          = gross - deductTotal
  const employerPct  = parseFloat(String((selWorker as any)?.employerCostPct ?? (selWorker as any)?.employer_cost_pct ?? 0)) || 0
  const employerCost = gross * employerPct / 100

  async function handleSettle() {
    if (!selWorker || selectedDays.size === 0) return
    try {
      const dto = {
        workerId: selWorker.id,
        dateFrom: range.from,
        dateTo: range.to,
        workDates: Array.from(selectedDays),
        kgPerDate: Object.fromEntries(Array.from(selectedDays).map(d => [d, kgPerDay[d] ?? 0])),
        ratePerKg: rate,
        deductions: deductions.map(d => ({ description: d.description, amount: parseFloat(d.amount) || 0 })),
        notes: '',
      }
      const result = await createMut.mutate(dto)
      setShowSettlement(result)
      setSelectedDays(new Set())
      setDeductions([])
      refetchDays()
      refetchSettlements()
      toast.success('Rozliczenie zapisane!')
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd rozliczenia')
    }
  }

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

        {/* Lewa kolumna — lista pracowników */}
        <div className="space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Pracownicy hali</CardTitle>
              <CardDescription>Wybierz pracownika do rozliczenia</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {wLoading ? (
                <div className="p-4 space-y-2">
                  {[0,1,2].map(i => <Skeleton key={i} className="h-14 rounded-xl" />)}
                </div>
              ) : (
                <div className="p-3 space-y-1.5">
                  {hallWorkers.map(w => {
                    const rate = parseFloat(String((w as any).ratePerKg ?? (w as any).rate_per_kg ?? 0))
                    const ct   = (w as any).contractType ?? (w as any).contract_type ?? 'zlecenie'
                    return (
                      <button key={w.id} onClick={() => selectWorker(w)}
                        className={`w-full text-left rounded-xl border-2 px-3 py-2.5 transition-all ${selWorker?.id === w.id ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'}`}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground">{ROLE_ICON[w.role]}</span>
                            <span className="font-semibold text-sm">{w.name}</span>
                          </div>
                          <ChevronRight size={14} className="text-muted-foreground" />
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5 ml-5">
                          {ROLE_LABEL[w.role]} · {rate.toFixed(2)} zł/kg · {ct === 'praca' ? 'UoP' : 'Zlecenie'}
                        </div>
                      </button>
                    )
                  })}
                  {hallWorkers.length === 0 && (
                    <div className="text-center text-sm text-muted-foreground py-6">Brak pracowników hali</div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
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
                    {ROLE_LABEL[selWorker.role]} · Stawka: <strong>{rate.toFixed(2)} zł/kg</strong>
                    {employerPct > 0 && <> · Narzut: <strong>{employerPct.toFixed(1)}%</strong></>}
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

            {/* Dni pracy */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">Dni pracy</CardTitle>
                  {(workerDays ?? []).filter(d => !d.settled).length > 0 && (
                    <button className="text-xs text-primary underline"
                      onClick={() => setSelectedDays(new Set((workerDays ?? []).filter(d => !d.settled).map(d => d.workDate)))}>
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
                      const kg = parseFloat(kgOverride[d.workDate] ?? '') || d.kgTotal || 0
                      const earn = kg * rate
                      const sel = selectedDays.has(d.workDate)
                      return (
                        <div key={d.workDate}
                          className={`flex items-center gap-3 rounded-xl border-2 px-3 py-2.5 transition-all ${
                            d.settled ? 'bg-muted border-muted opacity-60' :
                            sel ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/30'
                          }`}>
                          {!d.settled && (
                            <input type="checkbox" checked={sel} onChange={() => toggleDay(d.workDate)}
                              className="w-4 h-4 rounded cursor-pointer" />
                          )}
                          {d.settled && <CheckCircle size={16} className="text-green-600 flex-shrink-0" />}
                          <div className="flex-1">
                            <div className="text-sm font-semibold">
                              {new Date(d.workDate + 'T12:00:00').toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {d.entriesCount ? `${d.entriesCount} wpisów` : d.sessionCount ? `${d.sessionCount} sesji` : ''}
                              {d.settled && ' · Rozliczone'}
                            </div>
                          </div>
                          {!d.settled ? (
                            <div className="flex items-center gap-2">
                              <div className="text-right">
                                <div className="text-xs text-muted-foreground mb-0.5">kg</div>
                                <Input
                                  type="number" step="0.01" min="0"
                                  className="w-20 h-7 text-xs text-right"
                                  value={kgOverride[d.workDate] ?? String(d.kgTotal ?? 0)}
                                  onChange={e => setKgOverride(o => ({ ...o, [d.workDate]: e.target.value }))}
                                  onClick={e => e.stopPropagation()}
                                />
                              </div>
                              <div className="text-right min-w-[60px]">
                                <div className="text-xs text-muted-foreground mb-0.5">zarobek</div>
                                <div className="text-sm font-bold text-green-700">{fmtPln(earn)} zł</div>
                              </div>
                            </div>
                          ) : (
                            <div className="text-sm font-semibold text-muted-foreground">{fmtKg(d.kgTotal)} kg</div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Potrącenia */}
            {selectedDays.size > 0 && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Potrącenia</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {deductions.map(d => (
                      <div key={d.id} className="flex gap-2 items-center">
                        <Input placeholder="Opis (np. zaliczka, czynsz)" value={d.description}
                          onChange={e => setDeductions(prev => prev.map(x => x.id === d.id ? { ...x, description: e.target.value } : x))} />
                        <Input type="number" step="0.01" placeholder="0.00" className="w-28"
                          value={d.amount}
                          onChange={e => setDeductions(prev => prev.map(x => x.id === d.id ? { ...x, amount: e.target.value } : x))} />
                        <span className="text-muted-foreground text-sm">zł</span>
                        <button onClick={() => setDeductions(prev => prev.filter(x => x.id !== d.id))}
                          className="text-destructive hover:text-destructive/70">
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    <button onClick={() => setDeductions(prev => [...prev, { id: Math.random().toString(), description: '', amount: '' }])}
                      className="flex items-center gap-1.5 text-sm text-primary hover:underline">
                      <Plus size={13} /> Dodaj potrącenie
                    </button>
                  </div>
                </CardContent>
              </Card>
            )}

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
                      <span className="text-muted-foreground">Łącznie kg</span>
                      <span className="font-semibold">{fmtKg(totalKg)} kg</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Wynagrodzenie brutto ({rate.toFixed(2)} zł/kg)</span>
                      <span className="font-semibold">{fmtPln(gross)} zł</span>
                    </div>
                    {employerPct > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Koszt pracodawcy ({employerPct.toFixed(1)}%)</span>
                        <span className="font-semibold text-orange-700">{fmtPln(employerCost)} zł</span>
                      </div>
                    )}
                    {deductTotal > 0 && (
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Potrącenia</span>
                        <span className="font-semibold text-red-600">- {fmtPln(deductTotal)} zł</span>
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
                <CardTitle className="text-sm">Historia rozliczeń</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                {settLoading ? (
                  <div className="p-4 space-y-2">{[0,1].map(i => <Skeleton key={i} className="h-12 rounded-xl" />)}</div>
                ) : (settlements ?? []).length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6">Brak rozliczeń</div>
                ) : (
                  <div className="divide-y">
                    {(settlements ?? []).map((s: any) => (
                      <div key={s.id} className="flex items-center justify-between px-4 py-3 hover:bg-muted/30">
                        <div>
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
                          <button onClick={async () => {
                            const full = await payrollApi.getSettlement(s.id)
                            setShowSettlement(full)
                          }} className="text-xs text-primary hover:underline flex items-center gap-1 ml-auto">
                            <Printer size={11} /> Drukuj
                          </button>
                        </div>
                      </div>
                    ))}
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
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Pasek wypłaty</DialogTitle>
              <DialogDescription>{showSettlement.worker_name}</DialogDescription>
            </DialogHeader>
            <PaySlip settlement={showSettlement} />
            <div className="flex justify-end gap-2 mt-2">
              <Button variant="outline" onClick={() => setShowSettlement(null)}>Zamknij</Button>
              <Button onClick={() => window.print()}>
                <Printer size={14} className="mr-2" /> Drukuj
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}

// ─── Pasek wypłaty ────────────────────────────────────────────
function PaySlip({ settlement: s }: { settlement: any }) {
  const dateFrom = new Date(s.date_from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
  const dateTo   = new Date(s.date_to   + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
  const printDate = new Date(s.created_at).toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })
  return (
    <div className="border-2 border-border rounded-xl p-5 space-y-4 print:border-black" id="pay-slip">
      <div className="flex justify-between items-start">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Pasek wypłaty</div>
          <div className="text-xl font-black">{s.worker_name}</div>
          <div className="text-sm text-muted-foreground">
            {ROLE_LABEL[s.worker_role] ?? s.worker_role} · {s.contract_type === 'praca' ? 'Umowa o pracę' : 'Umowa zlecenie'}
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>Okres: {dateFrom}</div>
          <div>— {dateTo}</div>
          <div className="mt-1">Wygenerowano: {printDate}</div>
        </div>
      </div>
      <Separator />
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Przepracowane kg</span>
          <span className="font-semibold">{Number(s.kg_total).toFixed(2)} kg</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Stawka akordowa</span>
          <span className="font-semibold">{Number(s.rate_per_kg).toFixed(4)} zł/kg</span>
        </div>
        <div className="flex justify-between text-sm font-bold">
          <span>Wynagrodzenie brutto</span>
          <span>{Number(s.gross_amount).toFixed(2)} zł</span>
        </div>
        {Number(s.employer_cost_pct) > 0 && (
          <div className="flex justify-between text-sm text-orange-700">
            <span>Koszt pracodawcy ({Number(s.employer_cost_pct).toFixed(1)}%)</span>
            <span>{Number(s.employer_cost_amount).toFixed(2)} zł</span>
          </div>
        )}
      </div>
      {(s.deductions ?? []).length > 0 && (
        <>
          <Separator />
          <div className="space-y-1.5">
            <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Potrącenia</div>
            {(s.deductions ?? []).map((d: any) => (
              <div key={d.id} className="flex justify-between text-sm">
                <span className="text-muted-foreground">{d.description}</span>
                <span className="font-semibold text-red-600">- {Number(d.amount).toFixed(2)} zł</span>
              </div>
            ))}
          </div>
        </>
      )}
      <Separator />
      <div className="flex justify-between text-lg font-black">
        <span>DO WYPŁATY (netto)</span>
        <span className="text-green-700">{Number(s.net_amount).toFixed(2)} zł</span>
      </div>
      <div className="mt-6 pt-4 border-t border-dashed grid grid-cols-2 gap-8 text-xs text-muted-foreground">
        <div>
          <div className="mb-8">Podpis pracodawcy:</div>
          <div className="border-t border-gray-400 pt-1">................................</div>
        </div>
        <div>
          <div className="mb-8">Podpis pracownika:</div>
          <div className="border-t border-gray-400 pt-1">................................</div>
        </div>
      </div>
    </div>
  )
}
