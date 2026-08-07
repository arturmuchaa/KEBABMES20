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
  computeHours, isSunday, mondayOf, parseTime, weekDays, weekGaps,
  STATUS_LABEL, type HourCell, type HourStatus,
} from '@/lib/workHours'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, Clock, Lock, Sunrise, Sunset } from 'lucide-react'

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
  const [startTime, setStartTime] = useState('6:00')
  const [endTime, setEndTime]     = useState('15:00')
  const [busy, setBusy] = useState(false)

  const days = useMemo(() => weekDays(monday), [monday])
  const from = days[0], to = days[6]

  const { data: workers, loading: wLoading } = useApi(() => usersApi.list(), [])
  const { data: rows, loading: hLoading, refetch } = useApi(
    () => workHoursApi.list(from, to), [from, to])

  const general = (workers ?? []).filter(w => w.role === 'WORKER_GENERAL')
  const cells: HourCell[] = (rows ?? []) as HourCell[]
  const byKey = useMemo(
    () => new Map(cells.map(c => [`${c.workerId}|${c.workDate}`, c])),
    [cells])

  const gaps = weekGaps(cells, general.map(w => w.id), days, todayIso())

  async function save(workerId: string, workDate: string, patch: Partial<HourCell>) {
    const cur = byKey.get(`${workerId}|${workDate}`)
    const next = {
      status: (patch.status ?? cur?.status ?? 'work') as HourStatus,
      timeFrom: patch.timeFrom ?? cur?.timeFrom ?? '',
      timeTo:   patch.timeTo   ?? cur?.timeTo   ?? '',
    }
    try {
      if (next.status === 'work' && !next.timeFrom) {
        // Wyczyszczony start = wyczyszczona komórka (brak wpisu ≠ wolne).
        if (cur) { await workHoursApi.clear(workerId, workDate); refetch() }
        return
      }
      await workHoursApi.save({
        workerId, workDate, status: next.status,
        timeFrom: next.status === 'work' ? next.timeFrom : null,
        timeTo:   next.status === 'work' ? (next.timeTo || null) : null,
      })
      refetch()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd zapisu godzin')
    }
  }

  async function stamp(mode: 'start' | 'end') {
    const time = mode === 'start' ? startTime : endTime
    if (parseTime(time) === null) { toast.error('Zła godzina stempla'); return }
    setBusy(true)
    try {
      const res = await workHoursApi.stamp({ workDate: todayIso(), mode, time })
      toast.success(res.changed === 0
        ? 'Nic do ostemplowania — wszystko już wpisane'
        : `Ostemplowano ${res.changed} ${res.changed === 1 ? 'osobę' : 'osób'}`)
      refetch()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Błąd stempla')
    } finally {
      setBusy(false)
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
          <div className="flex items-center gap-2">
            <Input className="w-20 h-9" value={startTime} onChange={e => setStartTime(e.target.value)} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => stamp('start')}>
              <Sunrise size={14} className="mr-1.5" /> Start wszystkim
            </Button>
            <Input className="w-20 h-9" value={endTime} onChange={e => setEndTime(e.target.value)} />
            <Button variant="outline" size="sm" disabled={busy} onClick={() => stamp('end')}>
              <Sunset size={14} className="mr-1.5" /> Koniec otwartym
            </Button>
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
                        {isSunday(d) && <div className="text-[9px] text-amber-700 font-semibold">premia</div>}
                      </th>
                    )
                  })}
                  <th className="px-3 py-2 text-xs uppercase tracking-wide font-semibold text-right">Razem</th>
                </tr>
              </thead>
              <tbody>
                {general.map(w => {
                  const total = days.reduce((s, d) => s + (byKey.get(`${w.id}|${d}`)?.hours ?? 0), 0)
                  return (
                    <tr key={w.id} className="border-b last:border-0">
                      <td className="px-3 py-2 font-semibold whitespace-nowrap sticky left-0 bg-background">{w.name}</td>
                      {days.map(d => (
                        <td key={d} className={`px-1.5 py-2 align-top ${d === todayIso() ? 'bg-primary/5' : ''}`}>
                          <HourCellEditor cell={byKey.get(`${w.id}|${d}`)} onSave={p => save(w.id, d, p)} />
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-bold tabular-nums whitespace-nowrap">
                        {nf.format(total)} h
                      </td>
                    </tr>
                  )
                })}
                <tr className="bg-muted/40 font-bold">
                  <td className="px-3 py-2 sticky left-0 bg-muted/40">Razem</td>
                  {days.map(d => {
                    const t = general.reduce((s, w) => s + (byKey.get(`${w.id}|${d}`)?.hours ?? 0), 0)
                    return <td key={d} className="px-2 py-2 text-center tabular-nums">{nf.format(t)}</td>
                  })}
                  <td className="px-3 py-2 text-right tabular-nums">{nf.format(weekTotal)} h</td>
                </tr>
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Komórka: dwa pola czasu albo znacznik ────────────────────
function HourCellEditor({ cell, onSave }: {
  cell?: HourCell
  onSave: (patch: Partial<HourCell>) => void
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

  return (
    <div className="space-y-1 min-w-[92px]">
      <div className="flex items-center gap-0.5">
        <Input className="h-7 px-1 text-center text-xs" placeholder="—"
          value={from} onChange={e => setFrom(e.target.value)}
          onBlur={() => { if (from !== (cell?.timeFrom ?? '')) onSave({ timeFrom: from }) }} />
        <Input className="h-7 px-1 text-center text-xs" placeholder="—"
          value={to} onChange={e => setTo(e.target.value)}
          onBlur={() => { if (to !== (cell?.timeTo ?? '')) onSave({ timeTo: to }) }} />
      </div>
      <div className="flex items-center justify-between gap-1">
        <span className={`text-[10px] font-semibold ${
          bad ? 'text-red-600' : open ? 'text-amber-700' : 'text-muted-foreground'}`}>
          {bad ? 'błędna godzina' : open ? 'otwarty' : hours !== null ? `${nf.format(hours)} h` : ''}
        </span>
        <button onClick={() => setMenu(m => !m)}
          className="text-[10px] text-muted-foreground hover:text-primary px-1">•••</button>
      </div>
      {menu && (
        <div className="rounded-lg border border-border bg-background shadow-sm p-1 space-y-0.5">
          {MARKERS.map(s => (
            <button key={s} onClick={() => { setMenu(false); onSave({ status: s }) }}
              className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted">
              {STATUS_LABEL[s]}
            </button>
          ))}
          <button onClick={() => { setMenu(false); setFrom(''); setTo(''); onSave({ status: 'work', timeFrom: '', timeTo: '' }) }}
            className="block w-full text-left text-[11px] px-2 py-1 rounded hover:bg-muted text-muted-foreground">
            Wyczyść
          </button>
        </div>
      )}
    </div>
  )
}
