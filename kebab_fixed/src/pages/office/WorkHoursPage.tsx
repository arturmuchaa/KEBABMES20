/**
 * WorkHoursPage — ewidencja godzin pracowników ogólnych.
 *
 * Rytm biura: rano pracownik melduje się o 6:00, wpisujemy sam start i wpis
 * CZEKA jako otwarty; koniec dopisujemy po południu, a bywa że dopiero po
 * dwóch dniach. Stąd stemple zbiorcze (10 osób = jedno kliknięcie zamiast
 * dziesięciu pól) i licznik braków w nagłówku.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { usersApi, workHoursApi } from '@/lib/apiClient'
import {
  computeHours, isMissingEntry, mondayOf, parseTime, weekDays, weekGaps,
  STATUS_LABEL, type HourCell, type HourStatus,
} from '@/lib/workHours'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { ChevronLeft, ChevronRight, Clock, Eye, Lock, Plus, X } from 'lucide-react'

const todayIso = () => new Date().toISOString().slice(0, 10)
const nf = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MARKERS: HourStatus[] = ['off', 'vacation', 'sick', 'absent']

function dayHead(iso: string) {
  const d = new Date(iso + 'T12:00:00')
  return {
    dow: d.toLocaleDateString('pl-PL', { weekday: 'short' }),
    day: d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' }),
  }
}

export function WorkHoursPage() {
  const [monday, setMonday] = useState(() => mondayOf(todayIso()))
  // Pracownicy pytają o swoje godziny, a nie chcemy pokazywać im całej
  // załogi — podgląd wycina jedną osobę na osobne okno.
  const [peek, setPeek] = useState<{ id: string; name: string } | null>(null)

  const days = useMemo(() => weekDays(monday), [monday])
  const from = days[0], to = days[6]

  const { data: workers, loading: wLoading } = useApi(() => usersApi.list(), [])
  const { data: rows, loading: hLoading, refetch } = useApi(
    () => workHoursApi.list(from, to), [from, to])

  const general = (workers ?? []).filter(w => w.role === 'WORKER_GENERAL')
  const cells: HourCell[] = (rows ?? []) as HourCell[]
  // Dzień może mieć kilka zmian (6-15, potem powrót 18-20), więc pod kluczem
  // trzymamy LISTĘ, a nie pojedynczy wpis.
  const byKey = useMemo(() => {
    const m = new Map<string, HourCell[]>()
    for (const c of cells) {
      const k = `${c.workerId}|${c.workDate}`
      m.set(k, [...(m.get(k) ?? []), c].sort((a, b) => (a.seq ?? 1) - (b.seq ?? 1)))
    }
    return m
  }, [cells])
  const cellsOf = (wid: string, d: string) => byKey.get(`${wid}|${d}`) ?? []
  const dayHours = (wid: string, d: string) =>
    cellsOf(wid, d).reduce((sum, c) => sum + (c.hours ?? 0), 0)

  const gaps = weekGaps(cells, general.map(w => w.id), days, todayIso())

  async function save(workerId: string, workDate: string, seq: number, patch: Partial<HourCell>) {
    const cur = cellsOf(workerId, workDate).find(c => (c.seq ?? 1) === seq)
    const next = {
      status: (patch.status ?? cur?.status ?? 'work') as HourStatus,
      timeFrom: patch.timeFrom ?? cur?.timeFrom ?? '',
      timeTo:   patch.timeTo   ?? cur?.timeTo   ?? '',
    }
    try {
      if (next.status === 'work' && !next.timeFrom) {
        // Wyczyszczony start = wyczyszczona zmiana (brak wpisu ≠ wolne).
        if (cur) { await workHoursApi.clear(workerId, workDate, seq); refetch() }
        return
      }
      await workHoursApi.save({
        workerId, workDate, seq, status: next.status,
        timeFrom: next.status === 'work' ? next.timeFrom : null,
        timeTo:   next.status === 'work' ? (next.timeTo || null) : null,
      })
      refetch()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu godzin')
    }
  }

  function shiftWeek(delta: number) {
    const d = new Date(monday + 'T12:00:00')
    d.setDate(d.getDate() + delta * 7)
    setMonday(mondayOf(d.toISOString().slice(0, 10)))
  }

  const weekTotal = cells.reduce((s, c) => s + (c.hours ?? 0), 0)

  return (
    <div className="space-y-5 animate-fade-in">
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0 pb-3 gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => shiftWeek(-1)}><ChevronLeft size={15} /></Button>
            <div>
              <CardTitle className="text-base">
                {new Date(from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}
                {' – '}
                {new Date(to + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}
              </CardTitle>
              <CardDescription className="text-xs">
                {gaps.open > 0 && <span className="text-amber-700 font-semibold">{gaps.open} dni otwartych</span>}
                {gaps.open > 0 && gaps.missing > 0 && ' · '}
                {gaps.missing > 0 && <span className="text-muted-foreground">{gaps.missing} dni bez wpisu</span>}
                {gaps.open === 0 && gaps.missing === 0 && 'Tydzień kompletny'}
              </CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => shiftWeek(1)}><ChevronRight size={15} /></Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          {wLoading || hLoading ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 rounded-xl" />)}</div>
          ) : general.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 gap-2">
              <Clock size={36} className="text-muted-foreground opacity-20" />
              <CardTitle className="text-sm font-medium text-muted-foreground">Brak pracowników ogólnych</CardTitle>
              <CardDescription>Dodaj ich w zakładce Pracownicy i ustaw stawkę godzinową</CardDescription>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left px-3 py-2 text-xs uppercase tracking-wide font-semibold sticky left-0 bg-background">Pracownik</th>
                  {days.map(d => {
                    const h = dayHead(d)
                    return (
                      <th key={d} className={`px-2 py-2 text-xs font-semibold ${d === todayIso() ? 'bg-primary/5 text-primary' : ''}`}>
                        <div className="uppercase">{h.dow}</div>
                        <div className="text-muted-foreground font-normal">{h.day}</div>
                      </th>
                    )
                  })}
                  <th className="px-3 py-2 text-xs uppercase tracking-wide font-semibold text-right">Razem</th>
                </tr>
              </thead>
              <tbody>
                {general.map(w => {
                  const isDaily = ((w as any).payMode ?? (w as any).pay_mode) === 'daily'
                  // Myjący liczy się w dniach obecności, nie w godzinach.
                  const total = isDaily
                    ? days.filter(d => cellsOf(w.id, d)[0]?.status === 'work').length
                    : days.reduce((s, d) => s + dayHours(w.id, d), 0)
                  return (
                    <tr key={w.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-semibold whitespace-nowrap sticky left-0 bg-background">
                        <div className="flex items-center gap-1.5">
                          {w.name}
                          <button type="button" tabIndex={-1} title="Podgląd godzin pracownika"
                            onClick={() => setPeek({ id: w.id, name: w.name })}
                            className="text-muted-foreground hover:text-primary">
                            <Eye size={14} />
                          </button>
                        </div>
                      </td>
                      {days.map(d => (
                        <td key={d} className={`px-1.5 py-2 align-top ${d === todayIso() ? 'bg-primary/5' : ''}`}>
                          {((w as any).payMode ?? (w as any).pay_mode) === 'daily' ? (
                            <PresenceCell
                              cell={cellsOf(w.id, d)[0]}
                              missing={isMissingEntry(cellsOf(w.id, d), d, todayIso())}
                              onSave={p => save(w.id, d, 1, p)} />
                          ) : (
                            <HourDayCell
                              cells={cellsOf(w.id, d)}
                              missing={isMissingEntry(cellsOf(w.id, d), d, todayIso())}
                              onSave={(seq, p) => save(w.id, d, seq, p)} />
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">
                        {isDaily ? `${total} dni` : `${nf.format(total)} h`}
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-muted/40 font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-muted/40">Razem</td>
                  {days.map(d => {
                    const t = general.reduce((s, w) => s + dayHours(w.id, d), 0)
                    return <td key={d} className="px-2 py-2 text-center tabular-nums">{nf.format(t)}</td>
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">{nf.format(weekTotal)} h</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
      {peek && (
        <WorkerHoursPeek
          worker={peek} days={days} byKey={byKey}
          from={from} to={to} onClose={() => setPeek(null)} />
      )}
    </div>
  )
}

// ─── Podgląd jednej osoby (pokazywany pracownikowi) ───────────
function WorkerHoursPeek({ worker, days, byKey, from, to, onClose }: {
  worker: { id: string; name: string }
  days: string[]
  byKey: Map<string, HourCell[]>
  from: string
  to: string
  onClose: () => void
}) {
  const rows = days.map(d => {
    const list = (byKey.get(`${worker.id}|${d}`) ?? [])
    return { date: d, list, cell: list[0], hours: list.reduce((s, c) => s + (c.hours ?? 0), 0) }
  })
  const total = rows.reduce((s, r) => s + r.hours, 0)

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">{worker.name}</DialogTitle>
          <DialogDescription>
            {new Date(from + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long' })}
            {' – '}
            {new Date(to + 'T12:00:00').toLocaleDateString('pl-PL', { day: 'numeric', month: 'long', year: 'numeric' })}
          </DialogDescription>
        </DialogHeader>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-xs uppercase tracking-wide text-muted-foreground">
              <th className="text-left py-1.5">Dzień</th>
              <th className="text-left py-1.5">Od–do</th>
              <th className="text-right py-1.5">Godziny</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ date, cell, list, hours }) => {
              const d = new Date(date + 'T12:00:00')
              const marker = cell && cell.status !== 'work' ? STATUS_LABEL[cell.status] : null
              const open = cell?.status === 'work' && !cell.timeTo
              return (
                <tr key={date} className="border-b last:border-0">
                  <td className="py-1.5">
                    <span className="font-medium">{d.toLocaleDateString('pl-PL', { weekday: 'short' })}</span>
                    <span className="text-muted-foreground ml-1.5">
                      {d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })}
                    </span>
                  </td>
                  <td className="py-1.5 tabular-nums">
                    {marker
                      ? <span className="text-muted-foreground">{marker}</span>
                      : list.length
                        ? <div className="space-y-0.5">
                            {list.map(c => (
                              <div key={c.seq ?? 1}>{c.timeFrom}–{c.timeTo || '…'}</div>
                            ))}
                          </div>
                        : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">
                    {open
                      ? <span className="text-amber-700 text-xs font-normal">w toku</span>
                      : hours ? `${nf.format(hours)} h` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="font-black">
              <td className="py-2" colSpan={2}>Razem</td>
              <td className="py-2 text-right tabular-nums">{nf.format(total)} h</td>
            </tr>
          </tfoot>
        </table>
      </DialogContent>
    </Dialog>
  )
}

// ─── Komórka dnia: jedna zmiana, sporadycznie druga pod spodem ─
function HourDayCell({ cells, missing, onSave }: {
  cells: HourCell[]
  /** Dzień minął bez wpisu — do uzupełnienia (czerwona ramka). */
  missing?: boolean
  onSave: (seq: number, patch: Partial<HourCell>) => void
}) {
  // Druga zmiana zdarza się rzadko, więc nie zajmuje miejsca domyślnie —
  // pojawia się dopiero, gdy istnieje albo gdy biuro ją doda z menu.
  const [extra, setExtra] = useState(false)
  const first = cells.find(c => (c.seq ?? 1) === 1)
  const rest = cells.filter(c => (c.seq ?? 1) > 1)
  const showExtra = extra || rest.length > 0
  const nextSeq = Math.max(1, ...cells.map(c => c.seq ?? 1)) + 1
  const marker = first && first.status !== 'work'

  return (
    <div className="space-y-1">
      <HourShiftEditor
        cell={first} seq={1} missing={missing}
        onSave={p => onSave(1, p)}
        onAddShift={!marker && !showExtra ? () => setExtra(true) : undefined}
      />
      {showExtra && !marker && (
        <>
          {rest.map(c => (
            <HourShiftEditor key={c.seq} cell={c} seq={c.seq ?? 2}
              onSave={p => onSave(c.seq ?? 2, p)} extra />
          ))}
          {extra && rest.length === 0 && (
            <HourShiftEditor seq={nextSeq} onSave={p => onSave(nextSeq, p)}
              extra onCancel={() => setExtra(false)} />
          )}
        </>
      )}
    </div>
  )
}

// ─── Dniówka: tylko obecny / nieobecny ────────────────────────
// Myjący dostaje stawkę za dzień, więc godziny są dla niego bez znaczenia —
// wpisywanie ich byłoby udawaną precyzją.
function PresenceCell({ cell, missing, onSave }: {
  cell?: HourCell
  missing?: boolean
  onSave: (patch: Partial<HourCell>) => void
}) {
  const [menu, setMenu] = useState(false)
  const present = cell?.status === 'work'
  const marker = cell && cell.status !== 'work' ? STATUS_LABEL[cell.status] : null

  if (cell?.settled) {
    return (
      <div className="flex items-center justify-center gap-1 rounded-lg bg-muted px-1 py-2 text-[11px] text-muted-foreground">
        <Lock size={11} /> {present ? 'obecny' : marker}
      </div>
    )
  }

  return (
    <div className="space-y-1 min-w-[92px]">
      <button type="button"
        onClick={() => onSave(present ? { status: 'off' } : { status: 'work' })}
        className={`w-full rounded-lg border-2 px-1 py-2 text-[11px] font-bold uppercase transition-all ${
          present ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
          : marker ? 'border-border border-dashed text-muted-foreground'
          : missing ? 'border-red-500 bg-red-50 text-red-600'
          : 'border-border text-muted-foreground hover:border-primary/40'}`}>
        {present ? 'Obecny' : marker ?? (missing ? 'Brak wpisu' : '—')}
      </button>
      <div className="flex items-center justify-end">
        <button type="button" tabIndex={-1} onClick={() => setMenu(m => !m)}
          className="text-[10px] text-muted-foreground hover:text-primary px-1">•••</button>
      </div>
      {menu && (
        <div className="rounded-lg border border-border bg-background shadow-sm p-1 space-y-0.5">
          {MARKERS.map(m => (
            <button key={m} onClick={() => { setMenu(false); onSave({ status: m }) }}
              className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted">
              {STATUS_LABEL[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function HourShiftEditor({ cell, seq, missing, onSave, onAddShift, onCancel, extra }: {
  cell?: HourCell
  seq: number
  missing?: boolean
  onSave: (patch: Partial<HourCell>) => void
  onAddShift?: () => void
  onCancel?: () => void
  extra?: boolean
}) {
  const [from, setFrom] = useState(cell?.timeFrom ?? '')
  const [to, setTo]     = useState(cell?.timeTo ?? '')
  const [menu, setMenu] = useState(false)

  // Wpis przyjechał z serwera po zapisie — pola idą za nim.
  const key = `${cell?.timeFrom ?? ''}|${cell?.timeTo ?? ''}|${cell?.status ?? ''}`
  const [lastKey, setLastKey] = useState(key)
  if (key !== lastKey) {
    setLastKey(key)
    setFrom(cell?.timeFrom ?? '')
    setTo(cell?.timeTo ?? '')
  }

  // Dzień objęty rozliczeniem jest zamknięty — backend i tak odbiłby zapis,
  // ale edytowalne pole obiecywałoby coś, czego nie da się zrobić.
  if (cell?.settled) {
    return (
      <div className="flex items-center justify-center gap-1 rounded-lg bg-muted px-1 py-2 text-[11px] text-muted-foreground">
        <Lock size={11} />
        {cell.status === 'work' ? `${nf.format(cell.hours ?? 0)} h` : STATUS_LABEL[cell.status]}
      </div>
    )
  }

  if (cell && cell.status !== 'work') {
    return (
      <button onClick={() => onSave({ status: 'work', timeFrom: '', timeTo: '' })}
        className="w-full rounded-lg border-2 border-dashed border-border px-1 py-2 text-[11px] font-bold uppercase text-muted-foreground hover:border-primary/40">
        {STATUS_LABEL[cell.status]}
      </button>
    )
  }

  const hours = computeHours(from, to)
  const open = !!from && !to
  const bad = !!from && !!to && hours === null
  const miss = missing && !from ? 'border-red-500 bg-red-50' : ''

  return (
    <div className="space-y-1 min-w-[92px]">
      <div className="flex items-center gap-0.5">
        {/* Dzień minął, a nikt nic nie wpisał — ramka na czerwono, żeby
            zaległość rzucała się w oczy przy nadrabianiu. */}
        <Input className={`h-7 px-1 text-center text-xs ${miss}`} placeholder="—"
          value={from} onChange={e => setFrom(e.target.value)}
          onBlur={() => { if (from !== (cell?.timeFrom ?? '')) onSave({ timeFrom: from }) }} />
        <Input className={`h-7 px-1 text-center text-xs ${miss}`} placeholder="—"
          value={to} onChange={e => setTo(e.target.value)}
          onBlur={() => { if (to !== (cell?.timeTo ?? '')) onSave({ timeTo: to }) }} />
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-semibold ${
          bad ? 'text-red-600' : open ? 'text-amber-700' : 'text-muted-foreground'}`}>
          {bad ? 'błędna godzina'
            : open ? 'otwarty'
            : hours !== null ? `${nf.format(hours)} h`
            : missing ? <span className="text-red-600">brak wpisu</span> : ''}
        </span>
        {/* tabIndex=-1: Tab z pola „do" ma iść wprost na następny dzień,
            a nie zahaczać o menu znaczników (urlop itp.). */}
        {extra ? (
          <button type="button" tabIndex={-1} title="Usuń drugą zmianę"
            onClick={() => { if (cell) onSave({ timeFrom: '', timeTo: '' }); onCancel?.() }}
            className="text-muted-foreground hover:text-destructive px-0.5"><X size={11} /></button>
        ) : (
          <button type="button" tabIndex={-1} onClick={() => setMenu(m => !m)}
            className="text-[10px] text-muted-foreground hover:text-primary px-1">•••</button>
        )}
      </div>
      {menu && (
        <div className="rounded-lg border border-border bg-background shadow-sm p-1 space-y-0.5">
          {MARKERS.map(s => (
            <button key={s} onClick={() => { setMenu(false); onSave({ status: s }) }}
              className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted">
              {STATUS_LABEL[s]}
            </button>
          ))}
          {onAddShift && (
            <button onClick={() => { setMenu(false); onAddShift() }}
              className="flex items-center gap-1 w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted text-primary">
              <Plus size={10} /> Druga zmiana
            </button>
          )}
          <button onClick={() => { setMenu(false); setFrom(''); setTo(''); onSave({ status: 'work', timeFrom: '', timeTo: '' }) }}
            className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted text-muted-foreground">
            Wyczyść
          </button>
        </div>
      )}
    </div>
  )
}
