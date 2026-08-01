/**
 * YieldOverridesLog — wpisy zapisane MIMO przekroczenia pasma wydajności,
 * przepuszczone kodem serwisowym 0099.
 *
 * Twardy próg bez furtki zawsze zostaje w końcu usunięty (pułap 95% padł
 * 2026-07-24, bo zakleszczał pobrania) albo obchodzony zmyśloną ćwiartką.
 * Skoro więc obejście musi istnieć, biuro musi je WIDZIEĆ — bez tej listy
 * kod serwisowy po cichu zastąpiłby strażnika.
 *
 * Czego tu szukać: powtórzeń na jednym pracowniku (uczy się obchodzić),
 * serii tego samego dnia (waga rozstrojona) i wydajności blisko 100%
 * (klasyczna tara wózka wliczona w mięso — 431, 442, 443, 444).
 */
import { useEffect, useState } from 'react'
import { deboningApi, type YieldOverride } from '@/lib/apiClient'
import { DataTable } from '@/components/DataTable'
import { cn } from '@/lib/utils'
import { ShieldAlert, ChevronUp, ChevronDown } from 'lucide-react'

const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

function fmtTimePl(iso: string): string {
  return iso.slice(11, 16) || '—'
}
function fmtDayShort(iso: string): string {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`
}

export function YieldOverridesLog({ from, to, defaultOpen = false }: {
  from: string
  to: string
  defaultOpen?: boolean
}) {
  const [rows, setRows] = useState<YieldOverride[] | null>(null)
  const [show, setShow] = useState(defaultOpen)
  const sameDay = from === to

  useEffect(() => {
    let alive = true
    setRows(null)
    deboningApi.yieldOverrides(from, to)
      .then(r => { if (alive) setRows(r.data ?? []) })
      .catch(() => { if (alive) setRows(null) })
    return () => { alive = false }
  }, [from, to])

  const count = rows?.length ?? null

  return (
    <div>
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <button onClick={() => setShow(v => !v)} className="flex items-center gap-2 flex-1 min-w-0 text-left">
          <ShieldAlert size={15} className={count ? 'text-amber-600' : 'text-ink-3'} />
          <h2 className="text-sm font-bold text-ink">Odchylenia</h2>
          <span className="text-[11px] text-ink-4 truncate">
            · zapisy przepuszczone kodem serwisowym mimo przekroczenia pasma wydajności
          </span>
          <span className={cn(
            'ml-auto flex items-center gap-2 tabular-nums text-xs font-bold',
            count ? 'text-amber-600' : 'text-ink-4',
          )}>
            {count ?? '…'}
            {show ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </span>
        </button>
      </div>
      {show && (rows == null ? (
        <div className="py-8 text-center text-xs text-ink-4">Ładowanie…</div>
      ) : (
        <DataTable
          rows={rows} rowKey={r => `${r.entryId}-${r.atLocal}`}
          searchText={r => `${r.batchNo ?? ''} ${r.workerName ?? ''} ${r.bySubject ?? ''}`}
          searchPlaceholder="Szukaj partii, pracownika lub kto ominął…"
          initialSort={{ key: 'atLocal', dir: 'desc' }}
          empty={<div className="py-8 text-center text-xs text-ink-4">
            Brak ominięć w tym zakresie — każdy wpis zmieścił się w paśmie wydajności.
          </div>}
          columns={[
            { key: 'atLocal', header: sameDay ? 'Godzina' : 'Data', sortable: true, sortValue: r => r.atLocal, width: 90,
              cell: r => <span className="tabular-nums text-ink-2">
                {sameDay ? fmtTimePl(r.atLocal) : `${fmtDayShort(r.dayLocal)} ${fmtTimePl(r.atLocal)}`}
              </span> },
            { key: 'batchNo', header: 'Partia', sortable: true, sortValue: r => r.batchNo ?? '', width: 90,
              cell: r => r.batchNo
                ? <code className="font-mono font-bold text-brand">{r.batchNo}</code>
                : <span className="text-ink-4">—</span> },
            { key: 'workerName', header: 'Pracownik', sortable: true, sortValue: r => r.workerName ?? '',
              cell: r => r.workerName ?? <span className="text-ink-4">—</span> },
            { key: 'kgQuarter', header: 'Ćwiartka [kg]', align: 'right', sortable: true, sortValue: r => r.kgQuarter ?? 0,
              cell: r => <span className="tabular-nums text-ink-2">{nf1.format(r.kgQuarter ?? 0)}</span> },
            { key: 'kgMeat', header: 'Mięso [kg]', align: 'right', sortable: true, sortValue: r => r.kgMeat ?? 0,
              cell: r => <span className="font-bold tabular-nums text-brand">{nf1.format(r.kgMeat ?? 0)}</span> },
            { key: 'yieldPct', header: 'Wydajność', align: 'right', sortable: true, sortValue: r => r.yieldPct ?? 0,
              cell: r => <span className="font-black tabular-nums text-amber-600">
                {nf1.format(r.yieldPct ?? 0)}%
              </span> },
            { key: 'meatType', header: 'Rodzaj', width: 70,
              cell: r => <span className="text-[11px] font-bold uppercase text-ink-3">
                {r.meatType === 'bs' ? 'b/s' : 'z/s'}
              </span> },
            { key: 'bySubject', header: 'Kto ominął', sortable: true, sortValue: r => r.bySubject ?? '',
              cell: r => <span className="text-ink-2">{r.bySubject || 'kiosk'}</span> },
          ]}
        />
      ))}
    </div>
  )
}
