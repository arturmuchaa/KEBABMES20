import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft, Camera, CheckCircle2, AlertTriangle, Truck, RefreshCw,
  CircleDashed, CircleDot, CheckCircle, ChevronDown, ChevronUp, Plus, X,
  ArrowUp, ArrowDown, ListChecks,
} from 'lucide-react'
import {
  palletScanApi,
  vehiclesApi,
  type ActiveLoadingOrder,
  type LoadingStatus,
  type OrderPallet,
  type Vehicle,
} from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { fmtKg } from '@/lib/utils'
import { useClientNames } from '@/lib/clientNames'

type Toast = { ok: boolean; message: string; ts: number }
const storageKeyFor = (vehicleId: string) =>
  `kebab.mobile.zaladunek.${vehicleId}.selectedOrderIds`

function escapeHtml(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function fmtKgClean(n: number): string {
  const num = Number(n) || 0
  const rounded = Math.round(num * 10) / 10
  const s = rounded.toFixed(1)
  return (s.endsWith('.0') ? s.slice(0, -2) : s).replace('.', ',')
}

function renderLoadingDocument(doc: any, plateOverride?: string) {
  const v = doc?.vehicle ?? {}
  const orders: any[] = doc?.orders ?? []
  const today = new Date().toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' })
  const plate = plateOverride || v.plate || ''
  const ordersHtml = orders.map((o: any) => {
    const items = (o.items ?? []).map((l: any) => `
      <tr>
        <td>${escapeHtml(l.recipe_name || l.product_type_name || '')}</td>
        <td class="r">${l.qty}</td>
        <td class="r">${fmtKgClean(l.total_kg)} kg</td>
      </tr>`).join('')
    const pallets = (o.pallets ?? []).map((p: any) =>
      `<span class="pill">P${p.pallet_no}</span>`).join(' ')
    return `
      <section class="order">
        <div class="order-head">
          <h3>${escapeHtml(o.order_no)} — ${escapeHtml(o.client_name)}</h3>
          <div class="sub">
            ${o.delivery_date ? 'Dostawa: ' + escapeHtml(o.delivery_date) + ' · ' : ''}
            ${o.pallets?.length ?? 0} palet · ${fmtKgClean(o.total_kg)} kg · ${o.total_units} szt
          </div>
        </div>
        <div class="pallets">${pallets}</div>
        <table>
          <thead><tr><th>Produkt</th><th class="r">Szt</th><th class="r">Razem kg</th></tr></thead>
          <tbody>${items}</tbody>
        </table>
      </section>`
  }).join('')

  const html = `<!DOCTYPE html><html lang="pl"><head><meta charset="utf-8"/>
<title>Wydanie ${escapeHtml(v.name || '')}</title>
<style>
  @page { size: A4 portrait; margin: 12mm }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #111 }
  h1 { font-size: 18px; margin-bottom: 4px }
  h3 { font-size: 13px; margin-bottom: 2px }
  .meta { color: #555; font-size: 10px; margin-bottom: 10px }
  table { width: 100%; border-collapse: collapse; margin-top: 4px }
  th, td { border: 1px solid #ccc; padding: 3px 6px }
  th { background: #f3f4f6; text-align: left; font-size: 10px }
  .r { text-align: right }
  .order { margin-top: 14px; page-break-inside: avoid }
  .order-head { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 2px solid #111; padding-bottom: 3px }
  .order-head .sub { font-size: 10px; color: #555 }
  .pallets { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px }
  .pill { display: inline-block; padding: 2px 7px; border-radius: 9999px; background: #fef3c7; color: #92400e; font-weight: 700; font-size: 10px }
  .sigs { margin-top: 24px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px }
  .sig { border-top: 1px solid #333; padding-top: 4px; font-size: 9px; color: #555 }
  .actions { position: fixed; top: 8px; right: 8px }
  @media print { .actions { display: none } }
  button { font: inherit; padding: 6px 12px; border: 1px solid #888; background: #fff; cursor: pointer; border-radius: 6px }
</style></head><body>
<div class="actions"><button onclick="window.print()">Drukuj</button></div>
<h1>Dokument wydania (WZ)</h1>
<div class="meta">
  Pojazd: <b>${escapeHtml(v.name || '')}</b>${plate ? ' · ' + escapeHtml(plate) : ''}${v.kind === 'own' ? ' · firmowy' : ' · spedycja'}<br/>
  Wygenerowano: ${escapeHtml(today)} · Zamówień: ${orders.length}
</div>
${ordersHtml}
<div class="sigs">
  <div class="sig">Wydał (osoba magazynowa)</div>
  <div class="sig">Odebrał (kierowca)</div>
</div>
<script>window.addEventListener('load', () => setTimeout(() => window.print(), 350))</script>
</body></html>`

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const win = window.open(url, '_blank')
  if (!win || win.closed || typeof win.closed === 'undefined') {
    window.location.href = url
  }
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

function StatusBadge({ status }: { status?: string }) {
  if (status === 'loaded')       return <CheckCircle size={20} className="text-emerald-600" />
  if (status === 'cold_storage') return <CircleDot   size={20} className="text-sky-600" />
  return <CircleDashed size={20} className="text-slate-400" />
}

function fmtKgInt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function partsLabelFromItems(items: OrderPallet['items']): string {
  const byKg = new Map<number, number>()
  for (const it of items) {
    const kg  = Number(it.kgPerUnit ?? 0)
    const qty = Number(it.qty ?? 0)
    if (qty <= 0) continue
    byKg.set(kg, (byKg.get(kg) ?? 0) + qty)
  }
  return Array.from(byKg.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([kg, qty]) => `${qty}szt × ${fmtKgInt(kg)}kg`)
    .join(' + ')
}

function PalletRow({ p }: { p: OrderPallet }) {
  const label = partsLabelFromItems(p.items)
  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <StatusBadge status={p.status} />
      <div className="min-w-0 flex-1">
        <div className="text-base font-semibold text-slate-900">
          P{p.palletNo}
          {label && <span className="ml-2 text-slate-600 font-normal">· {label}</span>}
        </div>
      </div>
      <div className="text-right text-sm">
        <div className="font-semibold text-slate-900">{fmtKg(p.totalKg ?? 0, 1)} kg</div>
        <div className="text-xs text-slate-500">{p.totalQty ?? 0} szt</div>
      </div>
    </li>
  )
}

export function MobileZaladunekPage() {
  const clientDisplay = useClientNames()
  const { vehicleId = '' } = useParams<{ vehicleId: string }>()
  const storageKey = storageKeyFor(vehicleId)

  const [selectedIds, setSelectedIds] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]') } catch { return [] }
  })
  const [statuses, setStatuses] = useState<Record<string, LoadingStatus>>({})
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const activeRes = useApi(() => palletScanApi.activeLoading(), [])
  const orders = activeRes.data ?? []

  const vehiclesRes = useApi(() => vehiclesApi.list(true), [])
  const vehicle: Vehicle | undefined = useMemo(
    () => (vehiclesRes.data ?? []).find((v) => v.id === vehicleId),
    [vehiclesRes.data, vehicleId],
  )

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(selectedIds))
  }, [selectedIds, storageKey])

  // Przy zmianie samochodu — przeładuj listę z localStorage dla tego pojazdu
  useEffect(() => {
    try { setSelectedIds(JSON.parse(localStorage.getItem(storageKey) || '[]')) }
    catch { setSelectedIds([]) }
  }, [storageKey])

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  const refreshAll = useCallback(async (ids: string[]) => {
    const next: Record<string, LoadingStatus> = {}
    for (const id of ids) {
      try { next[id] = await palletScanApi.loadingStatus(id) } catch {}
    }
    setStatuses(next)
  }, [])

  useEffect(() => {
    if (selectedIds.length === 0) { setStatuses({}); return }
    refreshAll(selectedIds)
  }, [selectedIds, refreshAll])

  useEffect(() => {
    if (selectedIds.length === 0) setPickerOpen(true)
  }, [selectedIds.length])

  function toggleOrder(id: string) {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  function moveOrder(id: string, dir: -1 | 1) {
    setSelectedIds((prev) => {
      const i = prev.indexOf(id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }

  function clearAll() {
    if (!confirm('Wyczyścić listę zamówień na ten samochód?')) return
    setSelectedIds([])
  }

  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy) return
    if (selectedIds.length === 0) {
      setToast({ ok: false, message: 'Najpierw wybierz zamówienia', ts: Date.now() })
      setPickerOpen(true)
      return
    }
    setBusy(true)
    try {
      const looked = await palletScanApi.lookup(trimmed)
      if (!selectedIds.includes(looked.order.id)) {
        throw new Error(
          `Paleta P${looked.palletNo} należy do zam. ${looked.order.orderNo} (${looked.order.clientName}) — nie jest na tym samochodzie`,
        )
      }
      const result = await palletScanApi.scan(trimmed, 'loaded', '', vehicleId)
      setToast({
        ok: true,
        message: `${result.order.orderNo} · P${result.palletNo} załadowana · ${fmtKg(result.totalKg, 1)} kg`,
        ts: Date.now(),
      })
      try { navigator.vibrate?.(80) } catch {}
      await refreshAll(selectedIds)
    } catch (e) {
      setToast({ ok: false, message: e instanceof Error ? e.message : 'Błąd skanowania', ts: Date.now() })
      try { navigator.vibrate?.([60, 40, 60]) } catch {}
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  const totals = useMemo(() => {
    let total = 0, loaded = 0, totalKg = 0, loadedKg = 0
    for (const s of Object.values(statuses)) {
      total    += s.totals.totalPallets
      loaded   += s.totals.loadedPallets
      totalKg  += s.totals.totalKg
      loadedKg += s.totals.loadedKg
    }
    return { total, loaded, totalKg, loadedKg }
  }, [statuses])

  const pct = totals.total > 0 ? Math.round((totals.loaded / totals.total) * 100) : 0
  const allLoaded = totals.total > 0 && totals.loaded === totals.total
  const isForwarder = vehicle?.kind && vehicle.kind !== 'own'
  const [finalizing, setFinalizing] = useState(false)
  const [confirmFinalize, setConfirmFinalize] = useState(false)
  const [plateInput, setPlateInput] = useState('')

  function openConfirm() {
    setPlateInput(vehicle?.plate || '')
    setConfirmFinalize(true)
  }

  async function handleFinalize() {
    if (selectedIds.length === 0) return
    const plate = plateInput.trim().toUpperCase()
    if (isForwarder && !plate) {
      setToast({ ok: false, message: 'Podaj numer rejestracyjny pojazdu spedycyjnego', ts: Date.now() })
      return
    }
    setFinalizing(true)
    try {
      await palletScanApi.finalizeLoading(vehicleId, selectedIds)
      const doc = await palletScanApi.loadingDocument(vehicleId, selectedIds)
      renderLoadingDocument(doc, plate)
      setToast({ ok: true, message: 'Załadunek zakończony · dokument wydania otwarty', ts: Date.now() })
      try { localStorage.removeItem(storageKey) } catch {}
      setSelectedIds([])
      setStatuses({})
      setConfirmFinalize(false)
      setPlateInput('')
      activeRes.refetch()
    } catch (e) {
      setToast({ ok: false, message: e instanceof Error ? e.message : 'Nie udało się zakończyć', ts: Date.now() })
    } finally {
      setFinalizing(false)
    }
  }

  // Zachowuje kolejność z selectedIds (priorytet załadunku)
  const selectedStatuses = selectedIds
    .map((id) => statuses[id])
    .filter((s): s is LoadingStatus => Boolean(s))

  // Słownik order_no → istniejące zamówienie z aktywnej listy (dla danych w pickerze)
  const ordersById = useMemo(() => {
    const m = new Map<string, ActiveLoadingOrder>()
    for (const o of orders) m.set(o.id, o)
    return m
  }, [orders])

  const availableOrders = orders.filter((o) => !selectedIds.includes(o.id))

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between gap-2 border-b border-amber-200 bg-amber-500 px-3 py-2 text-white shadow-sm">
        <Link to="/mobile/zaladunek" className="flex shrink-0 items-center gap-1 text-sm font-semibold text-amber-50 hover:text-white">
          <ArrowLeft size={16} /> Auta
        </Link>
        <div className="min-w-0 text-center">
          <div className="flex items-center justify-center gap-1.5 text-[11px] uppercase tracking-wider text-amber-50">
            <Truck size={13} /> Załadunek
          </div>
          <div className="truncate text-sm font-bold">
            {vehicle
              ? `${vehicle.name}${vehicle.plate ? ` · ${vehicle.plate}` : ''}`
              : 'Samochód…'}
          </div>
        </div>
        <button
          onClick={() => { activeRes.refetch(); refreshAll(selectedIds) }}
          aria-label="Odśwież"
          className="shrink-0 rounded p-1 text-amber-50 hover:bg-white/20"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {/* Karta wyboru zamówień + ustawienia kolejności */}
        <section className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            className="flex w-full items-center justify-between gap-2 px-3 py-3 text-left"
          >
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wide text-slate-500">Zamówienia na samochód</div>
              <div className="text-base font-semibold text-slate-900">
                {selectedIds.length === 0
                  ? 'Wybierz zamówienia →'
                  : `${selectedIds.length} ${selectedIds.length === 1 ? 'zamówienie' : 'zamówienia'} · ${totals.loaded}/${totals.total} palet`}
              </div>
            </div>
            {pickerOpen ? <ChevronUp size={20} className="text-slate-500" /> : <ChevronDown size={20} className="text-slate-500" />}
          </button>

          {pickerOpen && (
            <div className="border-t border-slate-200 p-3">
              {/* Sekcja: wybrane (z kolejnością) */}
              {selectedIds.length > 0 && (
                <div className="mb-4">
                  <div className="mb-2 flex items-center gap-1.5 text-xs uppercase tracking-wide text-slate-500">
                    <ListChecks size={12} /> Kolejność na samochód
                  </div>
                  <ul className="space-y-2">
                    {selectedIds.map((id, idx) => {
                      const o = ordersById.get(id)
                      const status = statuses[id]
                      const headline = o
                        ? `${o.orderNo} · ${clientDisplay(o.clientName)}`
                        : status
                          ? `${status.order.orderNo} · ${clientDisplay(status.order.clientName)}`
                          : id
                      const meta = o
                        ? `${o.loadedPallets}/${o.totalPallets} palet${o.deliveryDate ? ` · ${o.deliveryDate}` : ''}`
                        : status
                          ? `${status.totals.loadedPallets}/${status.totals.totalPallets} palet`
                          : ''
                      return (
                        <li
                          key={id}
                          className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-2 py-2"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-sm font-bold text-white">
                            {idx + 1}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-900">{headline}</div>
                            <div className="text-xs text-slate-500">{meta}</div>
                          </div>
                          <div className="flex shrink-0 flex-col gap-1">
                            <button
                              type="button"
                              onClick={() => moveOrder(id, -1)}
                              disabled={idx === 0}
                              aria-label="W górę"
                              className="rounded bg-slate-200 p-1 text-slate-700 hover:bg-slate-300 disabled:opacity-30"
                            >
                              <ArrowUp size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => moveOrder(id, 1)}
                              disabled={idx === selectedIds.length - 1}
                              aria-label="W dół"
                              className="rounded bg-slate-200 p-1 text-slate-700 hover:bg-slate-300 disabled:opacity-30"
                            >
                              <ArrowDown size={14} />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => toggleOrder(id)}
                            aria-label="Usuń z samochodu"
                            className="ml-1 rounded p-1 text-red-600 hover:bg-red-50"
                          >
                            <X size={16} />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {/* Sekcja: dostępne */}
              <div>
                <div className="mb-2 text-xs uppercase tracking-wide text-slate-500">
                  Dostępne zamówienia
                </div>
                {activeRes.loading && !activeRes.data && (
                  <div className="text-center text-sm text-slate-500">Ładowanie…</div>
                )}
                {!activeRes.loading && availableOrders.length === 0 && (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-center text-sm text-slate-500">
                    {orders.length === 0
                      ? 'Brak zamówień gotowych do załadunku'
                      : 'Wszystkie aktywne zamówienia są już na samochodzie'}
                  </div>
                )}
                <ul className="divide-y divide-slate-100">
                  {availableOrders.map((o) => {
                    const dd = o.deliveryDate ? `· ${o.deliveryDate}` : ''
                    return (
                      <li key={o.id}>
                        <button
                          type="button"
                          onClick={() => toggleOrder(o.id)}
                          className="flex w-full items-center gap-3 py-2 text-left hover:bg-slate-50"
                        >
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-full border border-slate-300 text-slate-400">
                            <Plus size={14} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-semibold text-slate-900">
                              {o.orderNo} · {clientDisplay(o.clientName)}
                            </div>
                            <div className="text-xs text-slate-500">
                              {o.loadedPallets}/{o.totalPallets} palet {dd}
                            </div>
                          </div>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>

              {selectedIds.length > 0 && (
                <button
                  type="button"
                  onClick={clearAll}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 hover:bg-red-100"
                >
                  <X size={14} /> Wyczyść samochód
                </button>
              )}
            </div>
          )}
        </section>

        {selectedIds.length > 0 && (
          <>
            {/* Agregat */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex justify-between">
                <div>
                  <div className="text-xs uppercase tracking-wide text-slate-500">Łącznie</div>
                  <div className="text-2xl font-bold tabular-nums text-slate-900">
                    {totals.loaded}<span className="text-slate-400">/{totals.total}</span>
                  </div>
                  <div className="text-xs text-slate-500">palet</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wide text-slate-500">Waga</div>
                  <div className="text-2xl font-bold tabular-nums text-slate-900">
                    {fmtKg(totals.loadedKg, 0)}<span className="text-slate-400">/{fmtKg(totals.totalKg, 0)}</span>
                  </div>
                  <div className="text-xs text-slate-500">kg</div>
                </div>
              </div>
              <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
              </div>
              <div className="mt-1 text-right text-xs text-slate-500">{pct}%</div>
            </div>

            {/* Skan */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSubmit(value) }}
              className="flex items-stretch gap-2"
            >
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Skanuj QR palety"
                autoFocus
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-lg border-2 border-amber-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
              />
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="flex items-center justify-center rounded-lg bg-amber-500 px-4 text-white hover:bg-amber-600"
                aria-label="Skanuj aparatem"
              >
                <Camera size={22} />
              </button>
            </form>

            {toast && (
              <div
                className={`flex items-start gap-3 rounded-xl border-2 p-3 ${
                  toast.ok
                    ? 'border-emerald-300 bg-emerald-50'
                    : 'border-red-300 bg-red-50'
                }`}
              >
                {toast.ok
                  ? <CheckCircle2 size={24} className="shrink-0 text-emerald-600" />
                  : <AlertTriangle size={24} className="shrink-0 text-red-600" />}
                <div className={`min-w-0 text-sm ${toast.ok ? 'text-emerald-800' : 'text-red-800'}`}>{toast.message}</div>
              </div>
            )}

            {/* Lista palet w kolejności załadunku */}
            <div className="flex flex-col gap-3">
              {selectedStatuses.map((s, idx) => {
                const orderPct = s.totals.totalPallets > 0
                  ? Math.round((s.totals.loadedPallets / s.totals.totalPallets) * 100)
                  : 0
                const sorted = [...s.pallets].sort(
                  (a, b) =>
                    (a.status === 'loaded' ? 1 : 0) - (b.status === 'loaded' ? 1 : 0) ||
                    a.palletNo - b.palletNo,
                )
                return (
                  <section
                    key={s.order.id}
                    className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
                  >
                    <div className="border-b border-slate-200 bg-slate-50 px-3 py-2">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-amber-500 text-xs font-bold text-white">
                            {idx + 1}
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-bold text-slate-900">{clientDisplay(s.order.clientName)}</div>
                            <div className="text-xs text-slate-500">Zam. {s.order.orderNo}</div>
                          </div>
                        </div>
                        <div className="text-right text-sm tabular-nums">
                          <div className="font-semibold text-slate-900">
                            {s.totals.loadedPallets}/{s.totals.totalPallets}
                          </div>
                          <div className="text-xs text-slate-500">{orderPct}%</div>
                        </div>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${orderPct}%` }} />
                      </div>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {sorted.map((p) => <PalletRow key={p.palletNo} p={p} />)}
                    </ul>
                  </section>
                )
              })}
            </div>

            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="flex items-center justify-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-700 hover:bg-amber-100"
            >
              <Plus size={14} /> Dodaj / zmień kolejność
            </button>

            {/* Zakończ załadunek */}
            <button
              type="button"
              onClick={openConfirm}
              disabled={totals.loaded === 0 || finalizing}
              className={`flex items-center justify-center gap-2 rounded-lg px-3 py-3 text-base font-bold shadow ${
                totals.loaded === 0
                  ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                  : allLoaded
                    ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                    : 'bg-amber-500 text-white hover:bg-amber-600'
              }`}
            >
              <CheckCircle2 size={18} />
              {totals.loaded === 0
                ? 'Brak załadowanych palet'
                : allLoaded
                  ? 'Zakończ załadunek pojazdu'
                  : `Zakończ częściowo (${totals.loaded}/${totals.total} palet)`}
            </button>
          </>
        )}
      </main>

      {/* Dialog: potwierdzenie zakończenia */}
      {confirmFinalize && (
        <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/40 px-3 py-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-4 shadow-xl">
            <div className="text-base font-bold text-slate-900 mb-2">Zakończyć załadunek?</div>
            {allLoaded ? (
              <div className="text-sm text-slate-600 mb-4">
                Zamknie się {selectedIds.length} {selectedIds.length === 1 ? 'zamówienie' : 'zamówienia'} ({totals.loaded} palet · {fmtKg(totals.loadedKg, 0)} kg). Otworzy się dokument wydania do druku.
              </div>
            ) : (
              <div className="rounded-lg border-2 border-amber-400 bg-amber-50 p-3 mb-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle size={20} className="shrink-0 text-amber-600 mt-0.5" />
                  <div className="text-sm">
                    <div className="font-bold text-amber-900 mb-1">
                      Częściowy załadunek — {totals.loaded} z {totals.total} palet
                    </div>
                    <div className="text-amber-800">
                      Pozostałe <b>{totals.total - totals.loaded}</b> palet NIE pojedzie tym pojazdem. WZ zawiera tylko załadowane palety.
                      Zamówienia z niezaładowanymi paletami pozostaną na liście aktywnych załadunków.
                    </div>
                  </div>
                </div>
              </div>
            )}
            {isForwarder && (
              <div className="mb-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-700 block mb-1">
                  Nr rejestracyjny pojazdu spedycyjnego *
                </label>
                <input
                  type="text"
                  value={plateInput}
                  onChange={e => setPlateInput(e.target.value.toUpperCase())}
                  placeholder="np. KR1234A"
                  autoFocus
                  className="w-full rounded-lg border-2 border-amber-300 bg-white px-3 py-2 text-base font-mono font-bold tracking-wider text-slate-900 focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-200"
                />
                <div className="text-[11px] text-slate-500 mt-1">Wpisany numer pojawi się na dokumencie wydania.</div>
              </div>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setConfirmFinalize(false)}
                disabled={finalizing}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Anuluj
              </button>
              <button
                type="button"
                onClick={handleFinalize}
                disabled={finalizing}
                className="flex-1 rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-60"
              >
                {finalizing ? 'Zamykam…' : 'Tak, zakończ'}
              </button>
            </div>
          </div>
        </div>
      )}

      {scannerOpen && (
        <QrScannerModal
          onScan={(text) => { setScannerOpen(false); handleSubmit(text); focusInput() }}
          onClose={() => { setScannerOpen(false); focusInput() }}
        />
      )}
    </div>
  )
}
