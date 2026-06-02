import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Factory } from 'lucide-react'
import { finishedUnitsApi, type ScanProducedResult } from '@/lib/api'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'

interface ScanEntry {
  ts: number
  ok: boolean
  message: string
  result?: ScanProducedResult
}

export function MobileProdukcjaPage() {
  const [value, setValue] = useState('')
  const [trolleyId, setTrolleyId] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<ScanEntry | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const focusInput = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 30)
  }, [])

  useEffect(() => { focusInput() }, [focusInput])

  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy) return
    setBusy(true)
    try {
      const result = await finishedUnitsApi.scanProduced(trimmed, trolleyId.trim() || undefined)
      setLast({
        ts: Date.now(),
        ok: true,
        message: `${result.clientName} · partia ${result.batchNo} · ${result.weightKg} kg`,
        result,
      })
      beepOk()
      try { navigator.vibrate?.(80) } catch {}
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Błąd skanowania'
      const isDuplicate = msg.toLowerCase().includes('duplikat') || msg.toLowerCase().includes('already') || (e as any)?.status === 409 || msg.includes('409')
      setLast({
        ts: Date.now(),
        ok: false,
        message: isDuplicate ? 'Sztuka już zeskanowana' : msg,
      })
      beepErr()
      try { navigator.vibrate?.([60, 40, 60]) } catch {}
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-emerald-200 bg-emerald-600 px-4 py-3 text-white shadow-sm">
        <Link
          to="/mobile"
          className="flex items-center gap-1 text-sm font-semibold text-emerald-50 hover:text-white"
        >
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Factory size={18} /> Produkcja
        </div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {/* Wózek / trolley */}
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Wózek (ID)
          </label>
          <input
            type="text"
            value={trolleyId}
            onChange={(e) => setTrolleyId(e.target.value)}
            placeholder="np. W1"
            autoComplete="off"
            spellCheck={false}
            className="w-full rounded-lg border-2 border-emerald-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
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
            placeholder="Zeskanuj QR sztuki"
            autoFocus
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border-2 border-emerald-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200"
          />
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex items-center justify-center rounded-lg bg-emerald-600 px-4 text-white hover:bg-emerald-700"
            aria-label="Skanuj aparatem"
          >
            <Camera size={22} />
          </button>
        </form>

        {/* Feedback */}
        {last && (
          <div
            className={`flex items-start gap-3 rounded-xl border-2 p-4 ${
              last.ok
                ? 'border-emerald-300 bg-emerald-50'
                : 'border-red-300 bg-red-50'
            }`}
          >
            {last.ok
              ? <CheckCircle2 size={28} className="mt-0.5 shrink-0 text-emerald-600" />
              : <AlertTriangle size={28} className="mt-0.5 shrink-0 text-red-600" />}
            <div className="min-w-0 flex-1">
              <div className={`text-lg font-bold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>
                {last.ok ? 'OK — ZESKANOWANO' : 'BŁĄD'}
              </div>
              <div className={`mt-0.5 text-sm ${last.ok ? 'text-emerald-700' : 'text-red-700'}`}>
                {last.message}
              </div>
              {last.ok && last.result && (
                <div className="mt-2 text-2xl font-bold tabular-nums text-emerald-800">
                  {last.result.done}
                  <span className="text-emerald-500">/{last.result.total}</span>
                  <span className="ml-2 text-sm font-normal text-emerald-600">szt</span>
                </div>
              )}
            </div>
          </div>
        )}

        {trolleyId.trim() && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Wózek: <span className="font-bold">{trolleyId.trim()}</span>
          </div>
        )}
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
