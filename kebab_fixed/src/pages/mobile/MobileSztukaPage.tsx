import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft, Camera, QrCode, AlertTriangle, Search,
} from 'lucide-react'
import { finishedUnitsApi, type FinishedUnitCard } from '@/lib/api'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { useClientNames } from '@/lib/clientNames'

// ─── helpers ────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  try {
    const d = new Date(iso)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const yyyy = d.getFullYear()
    return `${dd}.${mm}.${yyyy}`
  } catch {
    return '—'
  }
}

type UnitStatus = 'planned' | 'produced' | 'packed' | 'shipped' | string

interface StatusMeta {
  label: string
  bg: string
  text: string
}

function statusMeta(status: UnitStatus): StatusMeta {
  switch (status) {
    case 'planned':  return { label: 'Zaplanowana',    bg: 'bg-slate-200',   text: 'text-slate-700' }
    case 'produced': return { label: 'Wyprodukowana',  bg: 'bg-blue-100',    text: 'text-blue-700'  }
    case 'packed':   return { label: 'Spakowana',      bg: 'bg-emerald-100', text: 'text-emerald-700' }
    case 'shipped':  return { label: 'Wysłana',        bg: 'bg-violet-100',  text: 'text-violet-700' }
    default:         return { label: status,           bg: 'bg-slate-100',   text: 'text-slate-600' }
  }
}

function locationLabel(card: FinishedUnitCard): string {
  if (card.cartonId)  return 'W kartonie'
  if (card.trolleyId) return `Wózek ${card.trolleyId}`
  return '—'
}

// ─── Row helper ─────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-2 last:border-0">
      <span className="shrink-0 text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className="text-right text-sm font-semibold text-slate-900 break-all">{value}</span>
    </div>
  )
}

// ─── Main page ──────────────────────────────────────────────────

export function MobileSztukaPage() {
  const clientDisplay = useClientNames()
  const [value,       setValue]       = useState('')
  const [busy,        setBusy]        = useState(false)
  const [card,        setCard]        = useState<FinishedUnitCard | null>(null)
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null)
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
    setErrorMsg(null)
    setCard(null)
    try {
      const result = await finishedUnitsApi.lookup(trimmed)
      setCard(result)
    } catch (e: any) {
      const msg: string = e?.message ?? ''
      if (msg.toLowerCase().includes('not found') || msg.includes('404')) {
        setErrorMsg('Nie znaleziono sztuki')
      } else if (msg.toLowerCase().includes('invalid') || msg.toLowerCase().includes('nieprawidłowy')) {
        setErrorMsg('Nieprawidłowy kod')
      } else {
        setErrorMsg(msg || 'Nie znaleziono sztuki')
      }
    } finally {
      setBusy(false)
      setValue('')
      focusInput()
    }
  }

  const sm = card ? statusMeta(card.status) : null

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-orange-200 bg-orange-500 px-4 py-3 text-white shadow-sm">
        <Link
          to="/mobile"
          className="flex items-center gap-1 text-sm font-semibold text-orange-50 hover:text-white"
        >
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <QrCode size={18} /> Karta sztuki
        </div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {/* Scan input */}
        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit(value) }}
          className="flex items-stretch gap-2"
        >
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Zeskanuj QR sztuki…"
            autoFocus
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 rounded-lg border-2 border-orange-300 bg-white px-3 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-200"
          />
          <button
            type="submit"
            disabled={busy || !value.trim()}
            className="flex items-center justify-center rounded-lg bg-orange-500 px-4 text-white hover:bg-orange-600 disabled:opacity-50"
            aria-label="Szukaj"
          >
            <Search size={22} />
          </button>
          <button
            type="button"
            onClick={() => setScannerOpen(true)}
            className="flex items-center justify-center rounded-lg bg-orange-500 px-4 text-white hover:bg-orange-600"
            aria-label="Skanuj aparatem"
          >
            <Camera size={22} />
          </button>
        </form>

        {/* Error */}
        {errorMsg && (
          <div className="flex items-start gap-3 rounded-xl border-2 border-red-300 bg-red-50 p-3">
            <AlertTriangle size={24} className="shrink-0 text-red-600" />
            <div className="text-sm font-semibold text-red-800">{errorMsg}</div>
          </div>
        )}

        {/* Card */}
        {card && sm && (
          <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* Card header: batchNo + status */}
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
              <div className="min-w-0">
                <div className="text-xs uppercase tracking-wide text-slate-500">Nr partii</div>
                <div className="text-2xl font-black tabular-nums text-slate-900 leading-tight">
                  {card.batchNo || '—'}
                </div>
              </div>
              <span
                className={`shrink-0 rounded-full px-3 py-1 text-sm font-bold ${sm.bg} ${sm.text}`}
              >
                {sm.label}
              </span>
            </div>

            {/* Rows */}
            <div className="px-4 py-1">
              <Row label="Klient"          value={clientDisplay(card.clientName) || '—'} />
              <Row label="Waga"            value={card.weightKg != null ? `${card.weightKg} kg` : '—'} />
              <Row label="Produkt"         value={card.productTypeName || '—'} />
              <Row label="Receptura"       value={card.recipeName || card.recipeId || '—'} />
              <Row label="Tuleja"          value={card.tuleja || '—'} />
              <Row label="Data produkcji"  value={fmtDate(card.producedAt)} />
              <Row label="Lokalizacja"     value={locationLabel(card)} />
              <Row label="QR"              value={<span className="font-mono text-xs">{card.qrCode}</span>} />
            </div>

            {/* Traceability link */}
            <div className="border-t border-slate-100 px-4 py-3">
              <Link
                to={`/mobile/przeplyw?batch=${encodeURIComponent(card.batchNo || '')}`}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-100 active:scale-[0.99]"
              >
                <Search size={15} className="shrink-0 text-slate-500" />
                Pokaż przepływ partii
              </Link>
            </div>
          </div>
        )}

        {/* Empty state */}
        {!card && !errorMsg && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-slate-400">
            <QrCode size={56} className="opacity-30" />
            <div className="text-sm">Zeskanuj lub wpisz kod QR sztuki</div>
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
