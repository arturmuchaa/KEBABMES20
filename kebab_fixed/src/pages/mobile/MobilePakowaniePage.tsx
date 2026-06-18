import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Package, PackageOpen, X, ScanLine } from 'lucide-react'
import { palletsApi, stockCartonsApi, type PalletPackResult, type PalletBatchRow } from '@/lib/api'
import { useApi } from '@/hooks/useApi'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'
import { useClientNames } from '@/lib/clientNames'
import { formatCartonNo } from '@/lib/unitLocation'

// Pakowanie obejmuje DWA rodzaje pojemników: paleta zamówienia ('order') oraz
// karton magazynowy bez zamówienia ('stock'). Ta sama operacja skanu sztuk.
interface ActivePallet {
  kind: 'order' | 'stock'
  id: string
  orderNo: string
  clientName: string
  cartonNo: string
  productName?: string
  targetQty: number
  packedQty: number
}

function parseStockCarton(code: string): string | null {
  const m = code.trim().match(/^SCARTON\|(.+)$/i)
  return m ? m[1] : null
}

interface ScanFeedback {
  ok: boolean
  message: string
  result?: PalletPackResult
}

export function MobilePakowaniePage() {
  const clientDisplay = useClientNames()
  // Aktywna paleta
  const [pallet, setPallet] = useState<ActivePallet | null>(null)
  const [batch, setBatch] = useState<PalletBatchRow[]>([])

  // Skan sztuki
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<ScanFeedback | null>(null)

  // Modale skanera kamery
  const [unitScanOpen, setUnitScanOpen] = useState(false)
  const [palletScanOpen, setPalletScanOpen] = useState(false)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const toPackRes = useApi(() => palletsApi.toPack(), [])
  const stockRes = useApi(() => stockCartonsApi.listOpen(), [])
  function refetchLists() { toPackRes.refetch?.(); stockRes.refetch?.() }

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  useEffect(() => {
    if (pallet) focusInput()
  }, [pallet, focusInput])

  // ─── Otwieranie palety zamówienia ───
  async function openPalletById(id: string) {
    try {
      const d = await palletsApi.detail(id)
      setPallet({
        kind: 'order',
        id: d.id,
        orderNo: d.order?.order_no ?? '',
        clientName: d.order?.client_name ?? '',
        cartonNo: formatCartonNo(d.carton_no ?? d.cartonNo),
        targetQty: Number(d.total_qty ?? 0),
        packedQty: Number(d.packed_qty ?? 0),
      })
      setBatch(d.batch_breakdown ?? [])
      setLast(null)
    } catch (e) {
      beepErr()
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Nie udało się otworzyć palety' })
    }
  }

  // ─── Otwieranie kartonu magazynowego (bez zamówienia) ───
  async function openStockCartonById(id: string) {
    try {
      const c = await stockCartonsApi.get(id)
      setPallet({
        kind: 'stock',
        id: c.id,
        orderNo: '',
        clientName: c.clientName,
        cartonNo: formatCartonNo(c.cartonNo),
        productName: c.productTypeName || c.recipeName,
        targetQty: c.targetQty,
        packedQty: c.packedQty,
      })
      setBatch([])
      setLast(null)
    } catch (e) {
      beepErr()
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Nie znaleziono kartonu' })
    }
  }

  // Skan QR pojemnika: SCARTON| → karton magazynowy; inaczej → paleta zamówienia.
  async function openByCode(code: string) {
    const stockId = parseStockCarton(code)
    if (stockId) return openStockCartonById(stockId)
    try {
      const p = await palletsApi.lookup(code)
      await openPalletById(p.id)
    } catch (e) {
      beepErr()
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Nie znaleziono palety' })
    }
  }

  // ─── Pakowanie sztuki (gałąź wg rodzaju pojemnika) ───
  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy || !pallet) return
    // Skan QR pojemnika w trakcie pakowania → przełącz pojemnik.
    if (parseStockCarton(trimmed) || /^PAL\|/i.test(trimmed)) {
      setValue(''); return openByCode(trimmed)
    }
    setBusy(true)
    try {
      if (pallet.kind === 'stock') {
        const r = await stockCartonsApi.scan(pallet.id, trimmed)
        beepOk()
        try { navigator.vibrate?.(80) } catch {}
        if (r.full) {
          setLast({ ok: true, message: 'Karton zapakowany' })
          setPallet(null); refetchLists()
        } else {
          setPallet(prev => prev ? { ...prev, packedQty: r.packedQty } : null)
          setLast({ ok: true, message: `Sztuka spakowana — ${r.packedQty}/${r.targetQty}` })
        }
      } else {
        const result = await palletsApi.packUnit(pallet.id, trimmed)
        if (result.ok) {
          beepOk()
          try { navigator.vibrate?.(80) } catch {}
          setBatch(await palletsApi.batchBreakdown(pallet.id))
          if (result.palletStatus === 'packed') {
            setLast({ ok: true, message: 'Paleta zapakowana', result })
            setPallet(null); refetchLists()
          } else {
            setPallet(prev => prev ? { ...prev, packedQty: result.packedQty } : null)
            setLast({ ok: true, message: 'Sztuka spakowana', result })
          }
        } else {
          beepErr()
          try { navigator.vibrate?.([60, 40, 60]) } catch {}
          setLast({ ok: false, message: result.reason || 'Nieprawidłowy kod', result })
        }
      }
    } catch (e) {
      beepErr()
      try { navigator.vibrate?.([60, 40, 60]) } catch {}
      setLast({ ok: false, message: e instanceof Error ? e.message : 'Błąd skanowania' })
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  function closePallet() {
    setPallet(null)
    setLast(null)
    setBatch([])
    refetchLists()
  }

  const palletsToPack = toPackRes.data ?? []
  const stockToPack = stockRes.data ?? []

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-violet-200 bg-violet-600 px-4 py-3 text-white shadow-sm">
        <Link
          to="/mobile"
          className="flex items-center gap-1 text-sm font-semibold text-violet-50 hover:text-white"
        >
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Package size={18} /> Pakowanie
        </div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {pallet ? (
          <>
            {/* Nagłówek aktywnego kartonu — spójny dla zamówienia i magazynu */}
            <div className="flex items-center justify-between gap-2 rounded-xl border border-violet-300 bg-violet-50 px-3 py-3 shadow-sm">
              <div className="flex items-center gap-2">
                <PackageOpen size={22} className="shrink-0 text-violet-600" />
                <div>
                  {/* Numer kartonu — wspólna numeracja (zamówienie i magazyn) */}
                  <div className="font-mono text-base font-black leading-none text-violet-900">
                    Karton {pallet.cartonNo || '—'}
                  </div>
                  <div className="mt-0.5 text-sm font-bold text-slate-900">
                    {pallet.kind === 'stock'
                      ? 'Magazyn (bez zamówienia)'
                      : `Zamówienie ${pallet.orderNo || '—'}`}
                  </div>
                  <div className="text-xs text-slate-500">{clientDisplay(pallet.clientName)}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="text-right">
                  <div className="text-2xl font-bold tabular-nums text-violet-700">
                    {pallet.packedQty}
                    <span className="text-violet-400">/{pallet.targetQty}</span>
                  </div>
                  <div className="text-[11px] uppercase tracking-wide text-slate-500">szt</div>
                </div>
                <button
                  type="button"
                  onClick={closePallet}
                  aria-label="Zamknij paletę"
                  className="rounded p-1 text-slate-500 hover:bg-violet-100 hover:text-red-600"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Skan sztuki */}
            <form
              onSubmit={(e) => { e.preventDefault(); handleSubmit(value) }}
              className="flex items-stretch gap-2"
            >
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Zeskanuj QR sztuki"
                autoFocus
                inputMode="text"
                autoComplete="off"
                spellCheck={false}
                className="flex-1 rounded-lg border-2 border-violet-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-200"
              />
              <button
                type="button"
                onClick={() => setUnitScanOpen(true)}
                className="flex items-center justify-center rounded-lg bg-violet-600 px-4 text-white hover:bg-violet-700"
                aria-label="Skanuj sztukę aparatem"
              >
                <Camera size={22} />
              </button>
            </form>

            {/* Feedback */}
            {last && (
              <div
                className={`flex items-start gap-3 rounded-xl border-2 p-4 ${
                  last.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'
                }`}
              >
                {last.ok
                  ? <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-emerald-600" />
                  : <AlertTriangle size={28} className="mt-0.5 shrink-0 text-red-600" />}
                <div className="min-w-0 flex-1">
                  <div className={`text-lg font-bold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                    {last.ok ? 'OK' : 'BŁĄD'}
                  </div>
                  <div className={`mt-0.5 text-sm ${last.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                    {last.message}
                  </div>
                </div>
              </div>
            )}

            {/* Skład partii (dane do HDI) */}
            {batch.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                <div className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Partie w palecie</div>
                {batch.map(b => (
                  <div key={b.batchNo || '—'} className="flex justify-between border-b border-slate-100 py-1 text-sm tabular-nums last:border-0">
                    <span className="text-slate-700">Partia {b.batchNo || '—'}</span>
                    <span className="font-semibold text-slate-900">{b.qty} szt · {b.weightKg.toFixed(0)} kg</span>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <>
            {/* Feedback po zamknięciu palety */}
            {last && last.message.includes('zapakowana') && (
              <div className="flex items-start gap-3 rounded-xl border-2 border-emerald-300 bg-emerald-50 p-4">
                <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-emerald-600" />
                <div>
                  <div className="text-lg font-bold text-emerald-800">Paleta zapakowana</div>
                  <div className="text-sm text-emerald-700">Wybierz kolejną paletę poniżej</div>
                </div>
              </div>
            )}

            {/* Skan QR pojemnika (paleta lub karton magazynowy) */}
            <button
              type="button"
              onClick={() => setPalletScanOpen(true)}
              className="flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 py-3 text-base font-bold text-white hover:bg-violet-700"
            >
              <ScanLine size={20} /> Skanuj QR palety / kartonu
            </button>

            {/* Lista pojemników do spakowania: palety zamówień + kartony magazynowe */}
            <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
                <PackageOpen size={16} className="text-violet-600" /> Do spakowania
              </div>
              {toPackRes.loading || stockRes.loading ? (
                <div className="py-4 text-center text-sm text-slate-500">Ładowanie…</div>
              ) : palletsToPack.length === 0 && stockToPack.length === 0 ? (
                <div className="py-4 text-center text-sm text-slate-500">Brak pojemników do spakowania</div>
              ) : (
                <ul className="flex flex-col gap-2">
                  {/* Palety zamówień i kartony magazynowe — JEDEN spójny wygląd.
                      Różni je tylko wiersz: numer zamówienia vs „magazyn". */}
                  {palletsToPack.map(p => (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => openPalletById(p.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:border-violet-300 hover:bg-violet-50"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-sm font-black text-violet-900">Karton {p.cartonNo || '—'}</div>
                          <div className="truncate text-sm font-semibold text-slate-900">{p.clientName ? clientDisplay(p.clientName) : '—'}</div>
                          <div className="text-xs text-slate-500">
                            Zamówienie {p.orderNo || '—'}
                            {p.status === 'packing' && <span className="ml-1 text-violet-600">· w toku</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-sm font-bold tabular-nums text-violet-700">
                          {p.packedQty}<span className="text-violet-400">/{p.targetQty}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                  {stockToPack.map(c => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openStockCartonById(c.id)}
                        className="flex w-full items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-left hover:border-violet-300 hover:bg-violet-50"
                      >
                        <div className="min-w-0">
                          <div className="font-mono text-sm font-black text-violet-900">Karton {formatCartonNo(c.cartonNo)}</div>
                          <div className="truncate text-sm font-semibold text-slate-900">{c.clientName ? clientDisplay(c.clientName) : '—'}</div>
                          <div className="text-xs text-slate-500">Magazyn (bez zamówienia)</div>
                        </div>
                        <div className="shrink-0 text-right text-sm font-bold tabular-nums text-violet-700">
                          {c.packedQty}<span className="text-violet-400">/{c.targetQty}</span>
                        </div>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </main>

      {/* Skaner sztuki */}
      {unitScanOpen && (
        <QrScannerModal
          onScan={(text) => { setUnitScanOpen(false); handleSubmit(text); focusInput() }}
          onClose={() => { setUnitScanOpen(false); focusInput() }}
        />
      )}

      {/* Skaner pojemnika (paleta lub karton magazynowy) */}
      {palletScanOpen && (
        <QrScannerModal
          onScan={(text) => { setPalletScanOpen(false); openByCode(text) }}
          onClose={() => { setPalletScanOpen(false) }}
        />
      )}
    </div>
  )
}
