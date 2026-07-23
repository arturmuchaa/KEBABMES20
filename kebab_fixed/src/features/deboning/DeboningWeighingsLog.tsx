/**
 * DeboningWeighingsLog — dziennik ważeń: KAŻDA zważona porcja mięsa
 * (nie zsumowana po wpisie), z pełnym audytem wagi.
 *
 * Współdzielony przez DeboningReportsPage (Statystyki rozbioru, z zakresem
 * dat) i DeboningControlPage (Panel rozbioru — powód: biuro patrzy na "Panel
 * rozbioru" na co dzień, dziennik musi być widoczny i tam, nie tylko w
 * statystykach).
 */
import { useEffect, useState } from 'react'
import { deboningApi } from '@/lib/apiClient'
import { DataTable } from '@/components/DataTable'
import { cn } from '@/lib/utils'
import { ListChecks, ChevronUp, ChevronDown } from 'lucide-react'

const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

export interface TakeWeighing {
  id:             string
  entryId:        string
  kgMeat:         number
  kgGross:        number | null
  tareCartKg:     number | null
  tareE2Kg:       number | null
  e2Count:        number | null
  weighMode:      string | null
  weighedAtLocal: string   // naive local (Europe/Warsaw) datetime z backendu
  dayLocal:       string   // 'YYYY-MM-DD' lokalnie
  workerName:     string
  rawBatchNo:     string
  kgQuarter:      number
  entryStatus:    string
}

function fmtTimePl(iso: string): string {
  return iso.slice(11, 16) || '—'
}
function fmtDayShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
}

export function DeboningWeighingsLog({
  from, to, defaultOpen = true,
}: {
  from: string
  to: string
  defaultOpen?: boolean
}) {
  const [weighings, setWeighings] = useState<TakeWeighing[] | null>(null)
  const [show, setShow] = useState(defaultOpen)
  const sameDay = from === to

  useEffect(() => {
    let alive = true
    setWeighings(null)
    deboningApi.weighings(from, to)
      .then(r => { if (alive) setWeighings(r.data ?? []) })
      .catch(() => { if (alive) setWeighings(null) })
    return () => { alive = false }
  }, [from, to])

  // Auto-odświeżanie tylko gdy zakres kończy się dziś (łapie nowe ważenia na żywo).
  useEffect(() => {
    const isTodayEnd = to === new Date().toISOString().slice(0, 10)
    if (!isTodayEnd) return
    const id = setInterval(() => {
      deboningApi.weighings(from, to).then(r => setWeighings(r.data ?? [])).catch(() => {})
    }, 15000)
    return () => clearInterval(id)
  }, [from, to])

  return (
    <div>
      <button onClick={() => setShow(v => !v)} className="flex items-center gap-2 mb-2 w-full text-left">
        <ListChecks size={15} className="text-ink-3" />
        <h2 className="text-sm font-bold text-ink">Dziennik ważeń</h2>
        <span className="text-[11px] text-ink-4">
          ({weighings?.length ?? 0}) · każda porcja mięsa zważona — brutto / tara / netto
        </span>
        <span className="ml-auto text-ink-4">
          {show ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </span>
      </button>
      {show && (
        weighings == null ? (
          <div className="rounded-lg border border-surface-4 bg-white py-6 text-center text-xs text-ink-4">Ładowanie…</div>
        ) : (
          <DataTable
            rows={weighings} rowKey={w => w.id}
            searchText={w => `${w.rawBatchNo} ${w.workerName}`}
            searchPlaceholder="Szukaj partii lub pracownika…"
            initialSort={{ key: 'weighedAtLocal', dir: 'desc' }}
            empty={<div className="py-8 text-center text-xs text-ink-4">Brak ważeń w tym zakresie</div>}
            footer={rows => {
              const gross = rows.reduce((a, w) => a + (w.kgGross ?? 0), 0)
              const net = rows.reduce((a, w) => a + w.kgMeat, 0)
              const carts = rows.filter(w => (w.tareCartKg ?? 0) > 0).length
              return (
                <>
                  <span>Razem · {rows.length} ważeń</span>
                  <span>Wózków: <b>{carts}</b></span>
                  <span className="ml-auto">Brutto: <b>{nf1.format(gross)} kg</b></span>
                  <span>Netto mięsa: <b className="text-brand">{nf1.format(net)} kg</b></span>
                </>
              )
            }}
            columns={[
              { key: 'weighedAtLocal', header: sameDay ? 'Godzina' : 'Dzień / godzina',
                sortable: true, sortValue: w => w.weighedAtLocal, width: 110,
                cell: w => (
                  <span className="tabular-nums text-ink-2">
                    {sameDay ? fmtTimePl(w.weighedAtLocal) : `${fmtDayShort(w.dayLocal)} ${fmtTimePl(w.weighedAtLocal)}`}
                  </span>
                ) },
              { key: 'rawBatchNo', header: 'Partia', sortable: true, sortValue: w => w.rawBatchNo, width: 90,
                cell: w => <code className="font-mono font-bold text-brand">{w.rawBatchNo}</code> },
              { key: 'workerName', header: 'Pracownik', sortable: true, sortValue: w => w.workerName,
                cell: w => <span className="font-semibold text-ink">{w.workerName}</span> },
              { key: 'kgGross', header: 'Brutto [kg]', align: 'right', sortable: true, sortValue: w => w.kgGross ?? -1,
                cell: w => w.kgGross != null
                  ? <span className="tabular-nums text-ink-2">{nf1.format(w.kgGross)}</span>
                  : <span className="text-ink-4">—</span> },
              { key: 'tareCartKg', header: 'Tara wózka [kg]', align: 'right', sortable: true, sortValue: w => w.tareCartKg ?? -1,
                cell: w => w.tareCartKg != null
                  ? <span className="tabular-nums text-ink-3">{nf1.format(w.tareCartKg)}</span>
                  : <span className="text-ink-4">—</span> },
              { key: 'e2', header: 'Pojemniki E2', align: 'right', sortable: true, sortValue: w => w.e2Count ?? -1,
                cell: w => w.e2Count != null && w.e2Count > 0
                  ? (
                    <span className="tabular-nums text-ink-3">
                      {w.e2Count} szt<span className="text-ink-4 text-[11px]"> · {nf1.format(w.tareE2Kg ?? 0)} kg</span>
                    </span>
                  )
                  : <span className="text-ink-4">—</span> },
              { key: 'kgMeat', header: 'Netto mięsa [kg]', align: 'right', sortable: true, sortValue: w => w.kgMeat,
                cell: w => <span className="font-black tabular-nums text-brand">{nf1.format(w.kgMeat)}</span> },
              { key: 'weighMode', header: 'Tryb', width: 90,
                cell: w => (
                  <span className={cn(
                    'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                    w.weighMode === 'auto'
                      ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      : 'bg-surface-2 text-ink-3 border-surface-4',
                  )}>
                    {w.weighMode === 'auto' ? 'Waga' : 'Ręcznie'}
                  </span>
                ) },
              { key: 'entryStatus', header: 'Wpis', width: 90,
                cell: w => (
                  <span className={cn(
                    'text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border',
                    w.entryStatus === 'pending'
                      ? 'bg-amber-50 text-amber-700 border-amber-200'
                      : 'bg-surface-2 text-ink-3 border-surface-4',
                  )}>
                    {w.entryStatus === 'pending' ? 'Trwa' : 'Gotowe'}
                  </span>
                ) },
            ]}
          />
        )
      )}
    </div>
  )
}
