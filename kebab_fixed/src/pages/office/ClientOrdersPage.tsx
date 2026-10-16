/**
 * ClientOrdersPage — zamówienia i zapotrzebowanie planisty.
 *
 * Sama LISTA. Wprowadzanie i edycja zamówienia mieszkają od 2026-08-23 na
 * osobnej stronie (features/orders/order-entry) — modal był za ciasny na
 * ekran, na którym operator wbija kilkanaście pozycji z klawiatury.
 */
import { Fragment, useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { clientOrdersApi } from '@/lib/apiClient'
import { CmrFormModal } from '@/components/cmr/CmrFormModal'
import { SplitDialog } from '@/features/orders/split/SplitDialog'
import { useClientNames } from '@/lib/clientNames'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { OrderPlanningSummary, CoverageBar } from '@/features/orders/OrderPlanningSummary'
import { OrderLinesTable } from '@/features/orders/OrderLinesTable'
import { OrderDocumentsMenu } from '@/features/orders/OrderDocumentsMenu'
import { totalLines, summarizeOrders, kgText, coveragePercent, productionState, productionTotals, mixingTotals } from '@/features/orders/orderPlanning'
import { OrderMetric } from '@/features/orders/OrderUI'
import '@/features/orders/order-planning.css'
import { podzielZamowienia } from '@/features/orders/orderBuckets'
import {
  Check, ChevronDown, ChevronUp, ChevronsUpDown,
  Pencil, Plus, RotateCcw, ShoppingCart, Trash2, X, Search,
} from 'lucide-react'
import { PalletsEditor } from '@/components/orders/PalletsEditor'
import { StockCartonSuggestions } from '@/features/finished-goods/components/StockCartonSuggestions'
import { OrphanPalletsPanel } from '@/features/orders/OrphanPalletsPanel'
import type { ClientOrder } from '@/lib/mockApi'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { StatusBadge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { MaterialSummaryCard } from '@/features/orders/MaterialSummaryCard'
import { OrderMaterialShortfall } from '@/features/orders/OrderMaterialShortfall'
import { usePageHeaderActions } from '@/components/PageHeader'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog'

const STATUS_LABELS: Record<ClientOrder['status'], string> = {
  draft: 'Szkic', confirmed: 'Potwierdzone', in_production: 'W produkcji', done: 'Zrealizowane', cancelled: 'Anulowane',
}
const ORDER_TONE: Record<ClientOrder['status'], 'gray' | 'blue' | 'amber' | 'green' | 'red'> = {
  draft: 'gray', confirmed: 'blue', in_production: 'amber', done: 'green', cancelled: 'red',
}

type SortCol = 'orderNo' | 'clientName' | 'orderDate' | 'deliveryDate' | 'status' | 'totalUnits' | 'totalKg' | 'progress' | 'remaining'
const EMPTY_ORDERS: ClientOrder[] = []
const PAGE_SIZE = 50

export function ClientOrdersPage() {
  const navigate      = useNavigate()
  const clientDisplay = useClientNames()
  const { data: orders, loading, error, refetch } = useApi(() => clientOrdersApi.list(undefined, true))
  const [cmrOrderId,   setCmrOrderId]   = useState<string | null>(null)
  const [splitOrder,   setSplitOrder]   = useState<ClientOrder | null>(null)
  const [doUsuniecia,  setDoUsuniecia]  = useState<ClientOrder | null>(null)
  const [expanded,     setExpanded]     = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState('')
  // Start z ?q= — globalne szukanie (Ctrl+K) kieruje tu z numerem zamówienia.
  const [archiwum,     setArchiwum]     = useState(false)
  const [search,       setSearch]       = useState(() => new URLSearchParams(window.location.search).get('q') ?? '')
  const [sortCol,      setSortCol]      = useState<SortCol>('orderDate')
  const [sortDir,      setSortDir]      = useState<'asc'|'desc'>('desc')
  const [filterProgress, setFilterProgress] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [page, setPage] = useState(0)
  const [archivePage, setArchivePage] = useState(0)
  const [showMaterials, setShowMaterials] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const refreshingRef = useRef(false)
  const refresh = useCallback(async () => {
    if (refreshingRef.current) return
    refreshingRef.current = true; setRefreshing(true)
    try { await refetch() } finally { refreshingRef.current = false; setRefreshing(false) }
  }, [refetch])
  useLiveRefresh({ orders: { refetch: () => { if (!document.hidden && !loading) void refresh() } } }, 30_000)

  const rawList = orders ?? EMPTY_ORDERS
  const metrics = useMemo(() => new Map(rawList.map(o => [o.id, totalLines(o.lines)])), [rawList])
  useEffect(() => {
    if (!orders || error) return
    const ids = new Set(orders.map(o => o.id))
    setSelected(prev => {
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [orders, error])
  useEffect(() => { setPage(0); setArchivePage(0) }, [search, filterStatus, filterProgress, sortCol, sortDir])
  // Refresh after returning from another MES screen/window; retain the list and selection.
  useEffect(() => {
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    let result = rawList
    if (filterStatus) result = result.filter(o => o.status === filterStatus)
    if (filterProgress !== 'all') result = result.filter(o => o.status !== 'cancelled' && productionState(metrics.get(o.id)!) === filterProgress)
    if (q) {
      result = result.filter(o =>
        (o.orderNo || '').toLowerCase().includes(q)
        || (o.clientName || '').toLowerCase().includes(q)
        || (o.notes || '').toLowerCase().includes(q)
        || (o.lines || []).some(l =>
          (l.recipeName || '').toLowerCase().includes(q)
          || (l.productTypeName || '').toLowerCase().includes(q)
          || (l.packagingName || '').toLowerCase().includes(q)
        )
      )
    }
    return [...result].sort((a, b) => {
      let cmp = 0
      if (sortCol === 'orderNo')      cmp = a.orderNo.localeCompare(b.orderNo)
      if (sortCol === 'clientName')   cmp = a.clientName.localeCompare(b.clientName)
      if (sortCol === 'orderDate')    cmp = (a.orderDate    || '').localeCompare(b.orderDate    || '')
      if (sortCol === 'deliveryDate') cmp = (a.deliveryDate || '').localeCompare(b.deliveryDate || '')
      if (sortCol === 'status')       cmp = a.status.localeCompare(b.status)
      if (sortCol === 'totalUnits')   cmp = a.totalUnits - b.totalUnits
      if (sortCol === 'totalKg')      cmp = metrics.get(a.id)!.orderedKg - metrics.get(b.id)!.orderedKg
      if (sortCol === 'progress')     cmp = (coveragePercent(metrics.get(a.id)!) ?? -1) - (coveragePercent(metrics.get(b.id)!) ?? -1)
      if (sortCol === 'remaining')    cmp = (metrics.get(a.id)!.remainingKg ?? -1) - (metrics.get(b.id)!.remainingKg ?? -1)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rawList, filterStatus, filterProgress, metrics, search, sortCol, sortDir])

  const { biezace, zamkniete } = useMemo(() => podzielZamowienia(filtered), [filtered])
  const activeLines = useMemo(() => rawList.filter(o => o.status !== 'done' && o.status !== 'cancelled').flatMap(o => o.lines), [rawList])
  const activeProduction = useMemo(() => productionTotals(activeLines), [activeLines])
  const activeMixing = useMemo(() => mixingTotals(activeLines), [activeLines])
  const currentPage = Math.min(page, Math.max(0, Math.ceil(biezace.length / PAGE_SIZE) - 1))
  const closedPage = Math.min(archivePage, Math.max(0, Math.ceil(zamkniete.length / PAGE_SIZE) - 1))
  const archiveVisible = archiwum || filterStatus === 'done' || filterStatus === 'cancelled'
  const currentRows = biezace.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const closedRows = archiveVisible ? zamkniete.slice(closedPage * PAGE_SIZE, (closedPage + 1) * PAGE_SIZE) : []
  const visibleRows = [...currentRows, ...closedRows]
  const selectedOrders = useMemo(() => rawList.filter(o => selected.has(o.id)), [rawList, selected])
  const summary = useMemo(() => summarizeOrders(selectedOrders), [selectedOrders])
  const selectedVisible = visibleRows.filter(o => selected.has(o.id)).length
  const toggleSelection = (id: string) => setSelected(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const toggleVisible = () => setSelected(prev => {
    const next = new Set(prev)
    const all = visibleRows.every(o => prev.has(o.id))
    visibleRows.forEach(o => all ? next.delete(o.id) : next.add(o.id))
    return next
  })

  const tabela = (rows: ClientOrder[]) => {
    const totals = totalLines(rows.filter(o => o.status !== 'cancelled').flatMap(o => o.lines))
    if (rows.length === 0) return null
    return (
            <div className="orders-scroll overflow-x-auto" tabIndex={0} role="region" aria-label="Lista zamówień">
              <table className="order-register w-full min-w-[960px] text-sm tabular-nums">
                <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                  <tr>
                    <th scope="col" className="w-10"><span className="sr-only">Zaznaczenie</span></th>
                    <th className="w-8"><span className="sr-only">Szczegóły</span></th>
                    {[
                      { col: 'orderNo'      as SortCol, label: 'Zamówienie / klient', align: 'left' },
                      { col: 'deliveryDate' as SortCol, label: 'Dostawa',   align: 'left'  },
                      { col: 'status'       as SortCol, label: 'Status',    align: 'left'  },
                      { col: 'totalKg'      as SortCol, label: 'Zamówiono', align: 'right' },
                      { col: 'remaining'    as SortCol, label: 'Pozostało', align: 'right' },
                      { col: 'progress'     as SortCol, label: 'Pokryte wyrobem', align: 'right' },
                    ].map(h => (
                      <th
                        key={h.col}
                        scope="col"
                        aria-sort={sortCol === h.col ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}
                        className={cn(
                          'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                           h.align === 'right' ? 'text-right' : 'text-left',
                        )}
                      >
                        <button type="button" onClick={() => toggleSort(h.col)} className={cn('inline-flex items-center gap-1 py-2', h.align === 'right' && 'flex-row-reverse')}>
                          {h.label}
                          <SortIcon col={h.col} />
                        </button>
                      </th>
                    ))}
                    <th className="px-2.5 py-2 text-xs font-medium text-ink-3 text-right">Dokumenty / akcje</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((o, idx) => {
                    const isExp = expanded === o.id
                    const metric = metrics.get(o.id)!
                    const state = productionState(metric)
                    const isDue   = o.deliveryDate
                      ? new Date(o.deliveryDate).getTime() - Date.now() < 1000 * 60 * 60 * 48
                      : false

                    return (
                      <Fragment key={o.id}>
                        <tr
                          onClick={() => setExpanded(isExp ? null : o.id)}
                          className={cn(
                            'order-master cursor-pointer border-b border-surface-4 transition-colors',
                            idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                            isExp ? 'bg-surface-3/50' : 'hover:bg-surface-3/60',
                            selected.has(o.id) && 'order-selected',
                          )}
                        >
                          <td className="px-3 py-3 text-center" onClick={e => e.stopPropagation()}>
                            <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSelection(o.id)} aria-label={`Zaznacz ${o.orderNo}`} />
                          </td>
                          <td className="px-1 py-3 text-center text-muted-foreground">
                            <button type="button" className="flex h-8 w-8 items-center justify-center rounded hover:bg-surface-4" aria-label={`Szczegóły ${o.orderNo}`} aria-expanded={isExp}
                              aria-controls={`order-${o.id}`} onClick={e => { e.stopPropagation(); setExpanded(isExp ? null : o.id) }}>
                              {isExp ? <ChevronUp size={16} aria-hidden="true"/> : <ChevronDown size={16} aria-hidden="true"/>}
                            </button>
                          </td>
                          <td className="max-w-[280px] px-2.5 py-3" title={o.clientName}>
                            <span className="order-client-name block break-words font-semibold text-slate-900">{clientDisplay(o.clientName)}</span>
                            <span className="order-master-subline block break-words text-slate-600">{o.orderNo}</span>
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap">
                            {o.deliveryDate ? (
                              <span className={isDue && o.status !== 'done' && o.status !== 'cancelled' ? 'text-red-600 font-semibold' : 'text-ink-2'}>
                                {fmtDatePl(o.deliveryDate)}
                              </span>
                            ) : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="px-2.5 py-2 whitespace-nowrap">
                            <StatusBadge tone={ORDER_TONE[o.status]} label={STATUS_LABELS[o.status]} />
                          </td>
                          <td className="px-2.5 py-3 whitespace-nowrap text-right">
                            <span className="order-mobile-label">Zamówiono</span>
                            {kgText(metric.orderedKg)}
                            <span className="order-master-subline block text-ink-3">{o.totalUnits} szt.</span>
                          </td>
                          <td className="px-2.5 py-3 whitespace-nowrap text-right font-semibold">
                            <span className="order-mobile-label">Pozostało</span>
                            {o.status === 'cancelled' ? <span className="text-xs font-normal text-ink-3">Nie planuj</span> : kgText(metric.remainingKg)}
                            {o.status !== 'cancelled' && <span className={cn('order-master-subline block font-normal', state === 'complete' ? 'text-emerald-700' : 'text-ink-3')}>
                              {{ partial: 'Częściowo pokryte', complete: 'Pełne pokrycie', none: 'Bez pokrycia', unknown: 'Brak danych MES' }[state]}
                            </span>}
                          </td>
                          <td className="min-w-[130px] px-2.5 py-3">
                            <span className="order-mobile-label">Pokryte wyrobem</span>
                            <span className="order-master-subline mb-1 block text-right">{kgText(metric.coveredKg)}</span>
                            <CoverageBar totals={metric} />
                          </td>
                          <td className="px-2 py-2 whitespace-nowrap text-right" onClick={e => e.stopPropagation()}>
                            <div className="inline-flex items-center gap-0.5">
                              <OrderDocumentsMenu order={o} onCmr={() => setCmrOrderId(o.id)} onSplit={() => setSplitOrder(o)} />
                              {o.status === 'draft' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleStatus(o.id, 'confirmed') }}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                                  title="Potwierdź"
                                >
                                  <Check size={13}/>
                                </button>
                              )}
                              {o.status === 'done' && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); void handleCofnijRealizacje(o) }}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-amber-700 hover:bg-amber-50"
                                  title="Cofnij realizację — zamówienie wraca do potwierdzonych"
                                >
                                  <RotateCcw size={13}/>
                                </button>
                              )}
                              {(o.status === 'draft' || o.status === 'confirmed') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); navigate(`/office/zamowienia/${o.id}/edycja`) }}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                                  title="Edytuj"
                                >
                                  <Pencil size={13}/>
                                </button>
                              )}
                              {(o.status === 'draft' || o.status === 'confirmed') && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setDoUsuniecia(o) }}
                                  className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                                  title="Usuń"
                                >
                                  <Trash2 size={13}/>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Domyślnie tylko pasek zamówienia; pozycje i logistyka na żądanie. */}
                        {isExp && (
                          <tr id={`order-${o.id}`} className="order-detail">
                            <td colSpan={9} className="border-b border-surface-4">
                              <OrderLinesTable order={o} />
                              <div className="order-logistics">
                              <p className="mb-3 text-xs text-ink-3">Data zamówienia: {fmtDatePl(o.orderDate)} · Logistyka zamówienia {o.orderNo} · {clientDisplay(o.clientName)}
                                {o.status === 'done' && ' Zamknięte zamówienie: wydanie przyjęte jako pełne.'}</p>
                              {o.notes && (
                                <div className="mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded text-xs">
                                  <span className="font-bold text-amber-700">Uwagi: </span>
                                  <span className="text-amber-900">{o.notes}</span>
                                </div>
                              )}

                              {/* Brakujący surowiec na niewykonaną część zamówienia */}
                              {o.status !== 'cancelled' && <OrderMaterialShortfall order={o} />}

                              {/* Pasujące kartony z magazynu (powiązanie „na magazyn" → zamówienie) */}
                              <StockCartonSuggestions key={o.id} orderId={o.id} orderStatus={o.status} onAssigned={refetch}
                                renderPallets={assigned => <PalletsEditor orderId={o.id} lines={o.lines} assignedCartons={assigned} orderNo={o.orderNo} clientName={clientDisplay(o.clientName)} />} />
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                  <tr>
                    <td className="px-3 py-3 text-xs text-ink-2" colSpan={5}>
                      Ta strona · {rows.length} zamówień · bez anulowanych
                    </td>
                    <td className="px-2.5 py-3 text-right font-semibold whitespace-nowrap">
                      {kgText(totals.orderedKg)}
                    </td>
                    <td className="px-2.5 py-3 text-right font-semibold whitespace-nowrap">
                      {kgText(totals.remainingKg)}
                    </td>
                    <td className="px-2.5 py-3 text-right whitespace-nowrap">{kgText(totals.coveredKg)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
    )
  }

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  async function handleStatus(id: string, status: ClientOrder['status']) {
    try { await clientOrdersApi.updateStatus(id, status); await refetch() }
    catch (e) { alert(e instanceof Error ? e.message : 'Nie udało się zmienić statusu') }
  }
  // 25.09.2026, SAS ISSA: po anulowanym WZ zamówienie zostało zrealizowane,
  // a HDI zamkniętego zamówienia wychodzi zamrożone. Odmowę serwera (aktywny
  // WZ/WM) pokazujemy w całości — są w niej numery dokumentów do anulowania.
  async function handleCofnijRealizacje(o: ClientOrder) {
    if (!confirm(`Cofnąć realizację zamówienia ${o.orderNo}?\n\nWróci do potwierdzonych — HDI będzie się znowu liczyć od stanu faktycznego.`)) return
    try {
      await clientOrdersApi.cofnijRealizacje(o.id)
      refetch()
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Nie udało się cofnąć realizacji')
    }
  }

  // Główna akcja w nagłówku strony (wspólny PageHeader).
  usePageHeaderActions(
    <div className="flex items-center gap-2 text-xs">
      <Button size="sm" className="gap-1.5 bg-blue-700 hover:bg-blue-800" onClick={() => navigate('/office/zamowienia/nowe')}>
        <Plus size={14}/> Nowe zamówienie
      </Button>
    </div>,
    [navigate]
  )

  return (
    <div className="orders-workspace min-w-0 space-y-4">
      <div className="order-workspace-heading"><div><div className="order-eyebrow">Biuro / planowanie produkcji</div><h2>Zamówienia i realizacja</h2><p>Co zamówiono → ile zrobiono → ile zostało → ile mięsa przygotować.</p></div></div>
      {!loading && orders && <div className="order-metrics" aria-label="Wszystkie otwarte zamówienia">
        <OrderMetric label="Otwarte zamówienia" value={rawList.filter(o => o.status !== 'done' && o.status !== 'cancelled').length} hint={`${activeProduction.orderedQty} szt. zamówionych · wraz ze szkicami`} />
        <OrderMetric label="Gotowe · raporty MES" tone="green" value={activeProduction.reportedQty == null ? '—' : `${activeProduction.reportedQty} szt.`} hint={kgText(activeProduction.reportedKg)} />
        <OrderMetric label="Pozostało wg raportów" tone="amber" value={kgText(activeProduction.remainingKg)} hint={activeProduction.remainingQty == null ? 'Brak kompletu danych MES' : `${activeProduction.remainingQty} szt. · przed pokryciem zapasem`} />
        <OrderMetric label="Mięso bazowe · otwarte zamówienia" tone="violet" value={kgText(activeMixing.meatKg)} hint={activeMixing.meatKg == null ? 'Zaznacz zamówienia, aby zobaczyć przyczynę' : 'Potrzeba technologiczna, nie zakup'} />
      </div>}
      {/* Palety z usuniętych/zmienionych zamówień czekające na zgodne zamówienie */}
      <OrphanPalletsPanel refreshKey={orders} />

      {/* Filtry i operacje na widocznej liście; zaznaczenia są od nich niezależne. */}
      <Card className="order-panel">
        <div className="px-4 py-2.5 flex items-center gap-3 flex-wrap">
          <div className="relative min-w-0 basis-full flex-1 md:basis-64">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="h-9 pl-9 pr-8 text-sm"
              placeholder="Filtruj: nr zam., klient, receptura, tuleja, uwagi…"
              aria-label="Szukaj zamówień"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button aria-label="Wyczyść wyszukiwanie" onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink">
                <X size={14}/>
              </button>
            )}
          </div>
          <Select value={filterStatus || '__all'} onValueChange={v => setFilterStatus(v === '__all' ? '' : v)}>
            <SelectTrigger aria-label="Status zamówienia" className="h-9 w-48 text-sm">
              <SelectValue placeholder="Wszystkie statusy" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all">Wszystkie statusy</SelectItem>
              {(['draft','confirmed','in_production','done','cancelled'] as ClientOrder['status'][]).map(s => (
                <SelectItem key={s} value={s}>{STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterProgress} onValueChange={setFilterProgress}>
            <SelectTrigger aria-label="Pokrycie zamówienia" className="h-9 w-48 text-sm"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Każde pokrycie</SelectItem>
              <SelectItem value="none">Bez pokrycia</SelectItem>
              <SelectItem value="partial">Częściowo pokryte</SelectItem>
              <SelectItem value="complete">Pełne pokrycie</SelectItem>
              <SelectItem value="unknown">Brak danych MES</SelectItem>
            </SelectContent>
          </Select>
          <label className="flex items-center gap-2 text-xs text-ink-3">Sortuj
            <select aria-label="Sortowanie zamówień" className="h-9 rounded border border-input bg-white px-2 text-sm text-ink" value={sortCol} onChange={e => setSortCol(e.target.value as SortCol)}>
              <option value="orderDate">Data zamówienia</option><option value="deliveryDate">Termin dostawy</option>
              <option value="clientName">Klient</option><option value="orderNo">Numer zamówienia</option>
              <option value="status">Status zamówienia</option><option value="totalUnits">Liczba sztuk</option>
              <option value="remaining">Pozostałe kg</option><option value="totalKg">Zamówione kg</option><option value="progress">Pokrycie %</option>
            </select>
          </label>
          <Button variant="ghost" size="sm" onClick={() => setSortDir(v => v === 'asc' ? 'desc' : 'asc')} aria-label={sortDir === 'asc' ? 'Sortowanie rosnące — zmień' : 'Sortowanie malejące — zmień'}>
            {sortDir === 'asc' ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </Button>
          <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading || refreshing}>
            <RotateCcw size={14} aria-hidden="true" className="mr-1.5" />{refreshing ? 'Odświeżanie…' : 'Odśwież'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-4 border-t border-surface-3 px-4 py-3 text-xs">
          <label className="flex items-center gap-2 font-medium">
            <SelectVisibleCheckbox checked={visibleRows.length > 0 && selectedVisible === visibleRows.length} mixed={selectedVisible > 0 && selectedVisible < visibleRows.length}
              disabled={!visibleRows.length} onChange={toggleVisible} />Zaznacz wszystkie widoczne
          </label>
          <span className="text-ink-3">Wyniki: {filtered.length} · widoczne: {visibleRows.length} · zaznaczone: {selectedOrders.length}</span>
          <span className="text-ink-3">Dane odświeżane co 30 s</span>
          {(search || filterStatus || filterProgress !== 'all') && <button type="button" className="ml-auto font-medium underline underline-offset-4"
            onClick={() => { setSearch(''); setFilterStatus(''); setFilterProgress('all') }}>Wyczyść filtry</button>}
        </div>
      </Card>

      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        Nie udało się pobrać zamówień: {error}. {orders ? 'Widoczne dane mogą być nieaktualne.' : 'Spróbuj ponownie.'}
        <Button variant="outline" size="sm" className="ml-3" onClick={() => void refresh()}>Ponów pobieranie</Button>
      </div>}

      {selectedOrders.length > 0 ? <OrderPlanningSummary summary={summary} count={selectedOrders.length}
        hiddenCount={selectedOrders.length - selectedVisible} onClear={() => setSelected(new Set())} /> :
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 text-sm text-blue-900">Kliknij pasek zamówienia, aby rozwinąć lub zwinąć pozycje i logistykę. Zaznaczenie służy do wspólnego obliczania mieszania.</div>}

      {/* Tabela */}
      <Card className="order-panel overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : !orders && error ? null : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <ShoppingCart size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak zamówień</CardTitle>
            <CardDescription>Dodaj pierwsze zamówienie od klienta</CardDescription>
          </CardContent>
        ) : filtered.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>Brak wyników</CardDescription>
          </CardContent>
        ) : (
          <>
            {tabela(currentRows)}
            <OrderPagination count={biezace.length} page={currentPage} onChange={setPage} label="Bieżące zamówienia" />
            {biezace.length === 0 && (
              <CardContent className="flex flex-col items-center justify-center py-8 gap-1">
                <CardDescription>Brak bieżących zamówień</CardDescription>
              </CardContent>
            )}
            {zamkniete.length > 0 && (
              <div className="mt-4 border-t-2 border-surface-4">
                {/* Zrealizowane i anulowane osobno — mieszały się z tym, nad
                    czym biuro pracuje. Domyślnie zwinięte, bo zagląda się tam
                    tylko wtedy, gdy ktoś czegoś szuka. */}
                <button
                  type="button"
                  onClick={() => { if (filterStatus === 'done' || filterStatus === 'cancelled') setFilterStatus(''); setArchiwum(!archiveVisible) }}
                  aria-expanded={archiveVisible}
                  className="flex w-full items-center gap-2 bg-surface-2/60 px-3 py-2 text-left text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:bg-surface-3/60"
                >
                  {archiveVisible ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  Zrealizowane i anulowane
                  <span className="font-normal text-muted-foreground">· {zamkniete.length}</span>
                </button>
                {archiveVisible && <>{tabela(closedRows)}<OrderPagination count={zamkniete.length} page={closedPage} onChange={setArchivePage} label="Zamknięte zamówienia" /></>}
              </div>
            )}
          </>
        )}
      </Card>

      <details className="order-panel p-4" onToggle={e => setShowMaterials(e.currentTarget.open)}>
        <summary className="cursor-pointer text-sm font-medium">Surowiec dla wszystkich otwartych zamówień <span className="font-normal text-ink-3">· niezależnie od zaznaczenia</span></summary>
        {showMaterials && <div className="mt-4"><MaterialSummaryCard refreshKey={orders} /></div>}
      </details>

      {cmrOrderId && <CmrFormModal orderId={cmrOrderId} onClose={() => setCmrOrderId(null)} />}
      {doUsuniecia && (
        <UsunZamowienieDialog
          order={doUsuniecia}
          onClose={() => setDoUsuniecia(null)}
          onDeleted={() => { setDoUsuniecia(null); refetch() }}
        />
      )}
      {splitOrder && (
        <SplitDialog
          orderId={splitOrder.id}
          orderNo={splitOrder.orderNo}
          clientName={splitOrder.clientName}
          kgCalosc={splitOrder.totalKg}
          onClose={() => setSplitOrder(null)}
        />
      )}

    </div>
  )
}

function SelectVisibleCheckbox({ checked, mixed, disabled, onChange }: { checked: boolean; mixed: boolean; disabled: boolean; onChange: () => void }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return <input ref={ref} type="checkbox" checked={checked} disabled={disabled} onChange={onChange} />
}

function OrderPagination({ count, page, onChange, label }: { count: number; page: number; onChange: (page: number) => void; label: string }) {
  if (count <= PAGE_SIZE) return null
  const pages = Math.ceil(count / PAGE_SIZE)
  return <nav aria-label={label} className="flex items-center justify-between gap-3 border-t border-surface-4 px-4 py-3 text-xs">
    <span>{page * PAGE_SIZE + 1}–{Math.min(count, (page + 1) * PAGE_SIZE)} z {count} · strona {page + 1}/{pages}</span>
    <div className="flex gap-2"><Button size="sm" variant="outline" disabled={page === 0} onClick={() => onChange(page - 1)}>Poprzednia</Button>
      <Button size="sm" variant="outline" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>Następna</Button></div>
  </nav>
}

// Usunięcie zamówienia jest NIEODWRACALNE (DELETE z kaskadą pozycji). Rozpisane
// palety NIE giną — czekają w poczekalni i same wracają do zgodnego zamówienia.
// Zwykłe confirm() nie wystarczyło — 30.09.2026 biuro skasowało przypadkiem
// zamówienie YALCIN. Kosz stoi tuż obok ołówka edycji, więc okno pokazuje,
// CO się usuwa, i wymaga wpisania słowa USUŃ; Enter bez tego nic nie robi.
function UsunZamowienieDialog({ order, onClose, onDeleted }: {
  order: ClientOrder
  onClose: () => void
  onDeleted: () => void
}) {
  const [slowo, setSlowo] = useState('')
  const [trwa, setTrwa] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const znorm = slowo.trim().toUpperCase().replace('Ń', 'N')
  const wolno = znorm === 'USUN' && !trwa

  async function usun() {
    if (!wolno) return
    setTrwa(true); setBlad(null)
    try {
      await clientOrdersApi.delete(order.id)
      onDeleted()
    } catch (e) {
      setBlad(e instanceof Error ? e.message : 'Nie udało się usunąć zamówienia')
      setTrwa(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => { if (!v && !trwa) onClose() }}>
      <DialogContent className="orders-dialog max-w-md">
        <DialogTitle>Usunąć zamówienie?</DialogTitle>
        <DialogDescription>
          Tej operacji nie da się cofnąć — zamówienie zniknie razem z pozycjami. Rozpisane palety
          nie przepadają: czekają na nowe zamówienie tego odbiorcy i przypną się do niego same,
          a ich stare kartki dalej będą działać na skanerze.
        </DialogDescription>
        <div className="rounded border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm space-y-0.5">
          <div><span className="text-muted-foreground">Numer:</span> <b>{order.orderNo}</b></div>
          <div><span className="text-muted-foreground">Klient:</span> <b>{order.clientName}</b></div>
          <div><span className="text-muted-foreground">Ilość:</span> <b>{fmtKg(order.totalKg)}</b></div>
          {order.deliveryDate && (
            <div><span className="text-muted-foreground">Dostawa:</span> <b>{fmtDatePl(order.deliveryDate)}</b></div>
          )}
        </div>
        <form onSubmit={(e) => { e.preventDefault(); usun() }} className="space-y-3">
          <label className="block text-sm">
            Aby potwierdzić, wpisz <b>USUŃ</b>:
            <Input autoFocus value={slowo} onChange={(e) => setSlowo(e.target.value)} className="mt-1" />
          </label>
          {blad && <div className="text-sm text-destructive">{blad}</div>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={trwa}>Anuluj</Button>
            <Button type="submit" variant="destructive" disabled={!wolno}>
              {trwa ? 'Usuwanie…' : 'Usuń zamówienie'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
