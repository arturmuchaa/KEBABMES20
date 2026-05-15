import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Camera, CheckCircle2, AlertTriangle, Snowflake, RefreshCw,
} from 'lucide-react'
import { palletScanApi, type ColdStoragePallet, type PalletScanResult } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { fmtKg } from '@/lib/utils'

interface HistoryEntry {
  ts: number
  ok: boolean
  message: string
  pallet?: PalletScanResult
}

function fmtShort(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('pl-PL', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  } catch { return '' }
}

function fmtKgInt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

function partsLabel(parts: { qty: number; kgPerUnit: number }[]): string {
  const visible = parts.filter((p) => p.qty > 0)
  if (visible.length === 0) return ''
  return visible
    .map((p) => `${p.qty}szt × ${fmtKgInt(p.kgPerUnit)}kg`)
    .join(' + ')
}

export function MobileMrozniaPage() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<HistoryEntry | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const inColdRes = useApi(() => palletScanApi.inColdStorage(), [])
  const inCold = inColdRes.data ?? []

  const grouped = useMemo(() => {
    const map = new Map<string, {
      orderNo: string
      clientName: string
      deliveryDate: string | null
      pallets: ColdStoragePallet[]
      totalKg: number
      totalQty: number
    }>()
    for (const p of inCold) {
      const g = map.get(p.orderId) ?? {
        orderNo: p.orderNo,
        clientName: p.clientName,
        deliveryDate: p.deliveryDate,
        pallets: [],
        totalKg: 0,
        totalQty: 0,
      }
      g.pallets.push(p)
      g.totalKg  += p.totalKg
      g.totalQty += p.totalQty
      map.set(p.orderId, g)
    }
    return Array.from(map.entries()).map(([orderId, g]) => ({ orderId, ...g }))
      .sort((a, b) => a.clientName.localeCompare(b.clientName))
  }, [inCold])

  const totalKg  = useMemo(() => inCold.reduce((s, p) => s + p.totalKg, 0),  [inCold])
  const totalQty = useMemo(() => inCold.reduce((s, p) => s + p.totalQty, 0), [inCold])

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  useEffect(() => { focusInput() }, [focusInput])

  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const result = await palletScanApi.scan(trimmed, 'cold_storage')
      setLast({
        ts: Date.now(),
        ok: true,
        message: `P${result.palletNo} → mroźnia (${result.order.clientName})`,
        pallet: result,
      })
      try { navigator.vibrate?.(80) } catch {}
      inColdRes.refetch()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd skanowania'
      setLast({ ts: Date.now(), ok: false, message: msg })
      try { navigator.vibrate?.([60, 40, 60]) } catch {}
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-sky-200 bg-sky-500 px-4 py-3 text-white shadow-sm">
        <Link to="/mobile" className="flex items-center gap-1 text-sm font-semibold text-sky-50 hover:text-white">
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Snowflake size={18} /> Mroźnia
        </div>
        <button
          onClick={() => inColdRes.refetch()}
          aria-label="Odśwież"
          className="rounded p-1 text-sky-50 hover:bg-white/20"
        >
          <RefreshCw size={16} />
        </button>
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(value) }}
          className="flex items-stretch gap-2"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Zeskanuj QR lub wpisz PAL|..."
            autoFocus
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border-2 border-sky-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex items-center justify-center rounded-lg bg-sky-500 px-4 text-white hover:bg-sky-600"
            aria-label="Skanuj aparatem"
          >
            <Camera size={22} />
          </button>
        </form>

        {last && (
          <div
            className={`flex items-start gap-3 rounded-xl border-2 p-3 ${
              last.ok
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-red-300 bg-red-50'
            }`}
          >
            {last.ok
              ? <CheckCircle2 size={24} className="shrink-0 text-emerald-600" />
              : <AlertTriangle size={24} className="shrink-0 text-red-600" />}
            <div className="min-w-0 flex-1 text-sm">
              <div className={`font-semibold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                {last.ok ? 'PRZYJĘTE DO MROŹNI' : 'BŁĄD'}
              </div>
              <div className={`mt-0.5 ${last.ok ? 'text-emerald-700' : 'text-red-700'}`}>{last.message}</div>
            </div>
          </div>
        )}

        {/* Agregat */}
        <div className="grid grid-cols-3 gap-2 rounded-xl border border-slate-200 bg-white p-3 text-center shadow-sm">
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">{inCold.length}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">palet</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">{totalQty}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">sztuk</div>
          </div>
          <div>
            <div className="text-2xl font-bold tabular-nums text-slate-900">{fmtKg(totalKg, 0)}</div>
            <div className="text-[11px] uppercase tracking-wide text-slate-500">kg</div>
          </div>
        </div>

        {/* Lista palet w mroźni */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              Aktualnie w mroźni
            </div>
          </div>

          {inColdRes.loading && !inColdRes.data && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-sm">
              Ładowanie…
            </div>
          )}

          {!inColdRes.loading && inCold.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-center text-sm text-slate-500 shadow-sm">
              Brak palet w mroźni
            </div>
          )}

          <div className="flex flex-col gap-2">
            {grouped.map((g) => (
              <div key={g.orderId} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 px-3 py-2 bg-slate-50">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-slate-900">{g.clientName}</div>
                    <div className="text-xs text-slate-500">
                      Zam. {g.orderNo}{g.deliveryDate ? ` · dostawa ${g.deliveryDate}` : ''}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-xs tabular-nums">
                    <div className="font-semibold text-slate-900">{g.pallets.length} pal · {fmtKg(g.totalKg, 0)} kg</div>
                    <div className="text-slate-500">{g.totalQty} szt</div>
                  </div>
                </div>
                <ul className="divide-y divide-slate-100">
                  {g.pallets
                    .slice()
                    .sort((a, b) => a.palletNo - b.palletNo)
                    .map((p) => {
                      const label = partsLabel(p.parts)
                      return (
                        <li key={p.palletId} className="flex items-center gap-3 px-3 py-2">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sky-100 text-sky-600">
                            <Snowflake size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold text-slate-900">
                              P{p.palletNo}
                              {label && <span className="ml-2 text-slate-600 font-normal">· {label}</span>}
                            </div>
                            <div className="text-xs text-slate-500">{fmtShort(p.coldStorageAt)}</div>
                          </div>
                          <div className="text-right text-sm tabular-nums">
                            <div className="font-semibold text-slate-900">{fmtKg(p.totalKg, 1)} kg</div>
                            <div className="text-xs text-slate-500">{p.totalQty} szt</div>
                          </div>
                        </li>
                      )
                    })}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      {scannerOpen && (
        <QrScannerModal
          onScan={(text) => { setScannerOpen(false); handleSubmit(text); focusInput() }}
          onClose={() => { setScannerOpen(false); focusInput() }}
        />
      )}
    </div>
  )
}
