/**
 * RawBatchesTable — tabela dostaw surowca (strona „Przyjęcie surowca").
 *
 * Jeden komponent, dwa warianty:
 *   variant='live'    — sekcja „W obiegu": dostawy, w których został surowiec.
 *                       Znacznik ważności jest tu prawdziwym alarmem, więc go
 *                       pokazujemy; są też akcje edycji/usunięcia.
 *   variant='history' — „Historia dostaw": rozliczone i anulowane. Zero
 *                       alarmów (termin partii zużytej nic już nie znaczy),
 *                       za to pasek filtrów: szukaj / okres / anulowane.
 *
 * Dwóch osobnych komponentów świadomie NIE robimy — rozjechałyby się przy
 * pierwszej zmianie kolumn.
 */
import { useState, useMemo } from 'react'
import { ExpiryBadge, StatusBadge } from '@/components/ui/badge'
import { fmtKg, fmtDatePl, fmtPln } from '@/lib/utils'
import { batchDisplayNo } from '../batchDisplayNo'
import {
  sortDeliveries, filterHistory, deliveryStatusBadgeKey, resolveDelivery,
  type DeliverySortCol, type SortDir, type HistoryPeriod, type MeatStockMap,
} from '../deliveryView'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { CardDescription, CardTitle } from '@/components/ui/card'
import type { RawBatch } from '@/types'
import { Package, ChevronDown, ChevronUp, ChevronsUpDown, Search, Pencil, Trash2 } from 'lucide-react'

interface RawBatchesTableProps {
  batches:           RawBatch[]
  loading:           boolean
  /** 'live' = W obiegu (alarmy + akcje), 'history' = Historia (filtry, bez alarmów) */
  variant?:          'live' | 'history'
  /** Ćwiartka idzie na rozbiór; filet i mięso z/s prosto na magazyn — inne etykiety statusów */
  requiresDeboning?: boolean
  /** Żywy stan lotów mięsa — dla surowca bez rozbioru to JEDYNE źródło „ile zostało" */
  meatStock?:        MeatStockMap
  emptyTitle?:       string
  emptyHint?:        string
  onEdit?:           (batch: RawBatch) => void
  onCancel?:         (batch: RawBatch) => void
}

const PERIODS: { value: HistoryPeriod; label: string }[] = [
  { value: 30, label: '30 dni' },
  { value: 90, label: '90 dni' },
  { value: 0,  label: 'Wszystko' },
]

export function RawBatchesTable({
  batches, loading,
  variant = 'live',
  requiresDeboning = true,
  meatStock,
  emptyTitle, emptyHint,
  onEdit, onCancel,
}: RawBatchesTableProps) {
  const isLive = variant === 'live'
  const resolveOpts = { requiresDeboning, meatStock }

  const [filter,  setFilter]  = useState('')
  const [period,  setPeriod]  = useState<HistoryPeriod>(30)
  const [showCancelled, setShowCancelled] = useState(false)
  // Domyślnie od najnowszej dostawy — pytanie „co ostatnio przyszło" jest
  // częstsze niż „co najszybciej wygasa" (od tego jest Magazyn surowca).
  const [sortCol, setSortCol] = useState<DeliverySortCol>('receivedDate')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  const toggleSort = (col: DeliverySortCol) => {
    if (sortCol === col) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortCol(col); setSortDir('desc') }
  }

  const SortIcon = ({ col }: { col: DeliverySortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11} /> : <ChevronDown size={11} />)
      : <ChevronsUpDown size={11} className="opacity-30" />

  const displayed = useMemo(() => {
    const base = isLive
      ? batches
      : filterHistory(batches, { query: filter, period, showCancelled })
    return sortDeliveries(base, sortCol, sortDir, resolveOpts)
    // resolveOpts to nowy obiekt co render — rozkładamy go na pola, żeby memo
    // faktycznie memoizowało.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, isLive, filter, period, showCancelled, sortCol, sortDir, requiresDeboning, meatStock])

  const HEADERS: { col: DeliverySortCol | null; label: string; right?: boolean }[] = [
    // „Nr porządkowy", nie „Nr partii": numerem partii staje się dopiero przy
    // sprzedaży ubocznych albo na wyrobie gotowym (ddmmrr + numer porządkowy).
    { col: 'internalBatchNo', label: 'Nr porządkowy' },
    { col: null,              label: 'Przyjęcie' },
    { col: 'supplierName',    label: 'Dostawca' },
    { col: null,              label: 'Nr dostawcy' },
    { col: 'receivedDate',    label: 'Przyjęto' },
    { col: 'slaughterDate',   label: 'Ubój' },
    { col: 'expiryDate',      label: 'Ważność' },
    { col: 'kgReceived',      label: 'Przyjęto kg', right: true },
    { col: 'kgAvailable',     label: 'Zostało kg',  right: true },
    { col: null,              label: 'Cena/kg',     right: true },
    { col: null,              label: 'Status' },
    ...(isLive ? [{ col: null, label: '' }] : []),
  ]

  if (loading) {
    return (
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            {HEADERS.map(h => (
              <TableHead key={h.label} className="text-xs uppercase tracking-wide whitespace-nowrap">
                {h.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {[0, 1, 2].map(i => (
            <TableRow key={i} className="hover:bg-transparent">
              {HEADERS.map(h => (
                <TableCell key={h.label}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    )
  }

  if (batches.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <div className="text-muted-foreground opacity-20 mb-1"><Package size={36} /></div>
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {emptyTitle ?? 'Brak dostaw'}
        </CardTitle>
        {emptyHint && (
          <CardDescription className="text-xs text-center max-w-sm">{emptyHint}</CardDescription>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Pasek filtrów — tylko historia. W obiegu bywa 1–3 wiersze, filtr byłby ozdobą. */}
      {!isLive && (
        <div className="px-4 py-2 border-b bg-muted/20 flex items-center gap-3 flex-wrap">
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-8 pl-8 text-xs"
              placeholder="Filtruj partię, dostawcę…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            />
          </div>

          <div className="flex gap-1">
            {PERIODS.map(p => (
              <button
                key={p.label}
                onClick={() => setPeriod(p.value)}
                className={`px-2.5 py-1 rounded text-[11px] font-semibold border transition-colors ${
                  period === p.value
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-ink-2 border-surface-4 hover:border-primary/50'
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-[11px] font-semibold text-ink-2 cursor-pointer">
            <input
              type="checkbox"
              className="h-3.5 w-3.5 cursor-pointer accent-[var(--brand,#171717)]"
              checked={showCancelled}
              onChange={e => setShowCancelled(e.target.checked)}
            />
            Pokaż anulowane
          </label>

          <CardDescription className="text-xs ml-auto">
            {displayed.length} z {batches.length}
          </CardDescription>
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-10 gap-2">
          <Search size={28} className="text-muted-foreground opacity-20" />
          <CardDescription>Brak dostaw dla wybranych filtrów</CardDescription>
        </div>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {HEADERS.map(h => (
                h.col ? (
                  <TableHead
                    key={h.label}
                    className="text-xs uppercase tracking-wide whitespace-nowrap cursor-pointer select-none"
                    onClick={() => toggleSort(h.col as DeliverySortCol)}
                  >
                    <div className={`flex items-center gap-1 ${h.right ? 'justify-end' : ''}`}>
                      {h.label}
                      <SortIcon col={h.col as DeliverySortCol} />
                    </div>
                  </TableHead>
                ) : (
                  <TableHead
                    key={h.label}
                    className={`text-xs uppercase tracking-wide whitespace-nowrap ${h.right ? 'text-right' : ''}`}
                  >
                    {h.label}
                  </TableHead>
                )
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {displayed.map(b => {
              // Gdzie leży stan, zależy od rodzaju surowca — ćwiartka trzyma go
              // w dostawie, filet i mięso z/s w lotach magazynu mięsa.
              const { status, kgLeft, kgReserved, untouched } = resolveDelivery(b, resolveOpts)
              // Alarm terminu ma sens tylko dla surowca, który jeszcze leży.
              // Data ważności zostaje widoczna zawsze — audyt HACCP jej potrzebuje.
              const showExpiryAlarm = kgLeft > 0 && status !== 'cancelled'
              // Backend odrzuca edycję każdej ruszonej partii (409), a partia
              // bez rozbioru jest „ruszona" od chwili przyjęcia — ma wpis
              // w meat_stock. untouched już to uwzględnia.
              const canEdit = untouched && b.status !== 'cancelled' && !b.isInUse

              return (
                <TableRow key={b.id} className={status === 'cancelled' ? 'opacity-60' : undefined}>
                  <TableCell>
                    <code className="font-mono font-bold text-foreground text-xs bg-muted px-1.5 py-0.5 rounded">
                      {batchDisplayNo(b)}
                    </code>
                  </TableCell>
                  <TableCell>
                    {/* Dostawy sprzed wprowadzenia dokumentu odtworzyła migracja
                        (dzień + dostawca); gdyby czegoś nie dało się dopasować,
                        pokazujemy myślnik zamiast udawać numer. */}
                    <code className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {b.receptionNo || '—'}
                    </code>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="max-w-[140px] truncate">{b.supplierName ?? '—'}</CardDescription>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-xs text-muted-foreground">{b.supplierBatchNo}</code>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="whitespace-nowrap font-medium text-foreground">
                      {fmtDatePl(b.receivedDate)}
                    </CardDescription>
                  </TableCell>
                  <TableCell>
                    <CardDescription className="whitespace-nowrap">{fmtDatePl(b.slaughterDate)}</CardDescription>
                  </TableCell>
                  <TableCell>
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <CardDescription>{fmtDatePl(b.expiryDate)}</CardDescription>
                      {showExpiryAlarm && <ExpiryBadge dateStr={b.expiryDate} />}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <CardDescription className="font-semibold tabular-nums text-foreground">
                      {fmtKg(b.kgReceived)} kg
                    </CardDescription>
                  </TableCell>
                  <TableCell className="text-right">
                    {kgLeft > 0 ? (
                      <div className="flex flex-col items-end leading-tight">
                        <span className={`font-bold tabular-nums text-sm ${
                          status === 'cancelled' ? 'text-muted-foreground' : 'text-foreground'
                        }`}>
                          {fmtKg(kgLeft)} kg
                        </span>
                        {/* Rezerwacja planu masowania nie jest odjęta od stanu —
                            bez tej informacji operator planuje z kg, które już
                            ktoś zaklepał na dziś. */}
                        {kgReserved > 0 && (
                          <span className="text-[10px] font-semibold tabular-nums text-amber-700"
                            title="Zarezerwowane przez plan masowania">
                            {fmtKg(kgReserved)} zarez.
                          </span>
                        )}
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <code className="font-mono text-xs text-muted-foreground">{fmtPln(b.pricePerKg)}</code>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={deliveryStatusBadgeKey(status, requiresDeboning)} />
                  </TableCell>
                  {isLive && (
                    <TableCell>
                      {canEdit && (
                        <div className="flex items-center gap-1">
                          {onEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-primary hover:bg-primary/10"
                              onClick={() => onEdit(b)}
                              title="Edytuj"
                            >
                              <Pencil size={13} />
                            </Button>
                          )}
                          {onCancel && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                              onClick={() => onCancel(b)}
                              title="Usuń przyjęcie"
                            >
                              <Trash2 size={13} />
                            </Button>
                          )}
                        </div>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </div>
  )
}
