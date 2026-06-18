/**
 * Pakowanie kartonu magazynowego (bez zamówienia).
 * Magazynier skanuje QR kartonu (SCARTON|<id>), potem skanuje WYPRODUKOWANE
 * sztuki do kartonu. Sztuki muszą zgadzać się ze specyfikacją kartonu.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Camera, CheckCircle2, AlertTriangle, Package, X } from 'lucide-react'
import { stockCartonsApi, type StockCarton } from '@/lib/api'
import { QrScannerModal } from '@/components/scan/QrScannerModal'
import { beepOk, beepErr } from '@/features/pwa/beep'
import { useClientNames } from '@/lib/clientNames'
import { formatCartonNo } from '@/lib/unitLocation'

function parseCarton(code: string): string {
  const s = code.trim()
  const m = s.match(/^SCARTON\|(.+)$/i)
  return m ? m[1] : s
}

export function MobileKartonMagazynowyPage() {
  const clientDisplay = useClientNames()
  const [carton, setCarton] = useState<StockCarton | null>(null)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [last, setLast] = useState<{ ok: boolean; message: string } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const focus = useCallback(() => { setTimeout(() => inputRef.current?.focus(), 30) }, [])
  useEffect(() => { focus() }, [focus, carton])

  async function openCarton(code: string) {
    try {
      const c = await stockCartonsApi.get(parseCarton(code))
      setCarton(c); setLast(null)
    } catch (e: any) {
      beepErr(); setLast({ ok: false, message: e?.message || 'Nie znaleziono kartonu' })
    }
  }

  async function handleSubmit(code: string) {
    const trimmed = code.trim()
    if (!trimmed || busy) return
    // Jeśli nie mamy otwartego kartonu — pierwszy skan to karton.
    if (!carton || /^SCARTON\|/i.test(trimmed)) { setValue(''); return openCarton(trimmed) }
    setBusy(true)
    try {
      const r = await stockCartonsApi.scan(carton.id, trimmed)
      beepOk()
      setLast({ ok: true, message: `Spakowano ${r.batchNo} — ${r.packedQty}/${r.targetQty}` })
      setCarton({ ...carton, packedQty: r.packedQty, status: r.full ? 'packed' : 'open' })
    } catch (e: any) {
      beepErr(); setLast({ ok: false, message: e?.message || 'Błąd skanu sztuki' })
    } finally {
      setBusy(false); setValue(''); focus()
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-emerald-200 bg-emerald-600 px-4 py-3 text-white">
        <Link to="/mobile" className="flex items-center gap-1 text-sm font-semibold text-emerald-50"><ArrowLeft size={16} /> Wstecz</Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider"><Package size={18} /> Karton magazynowy</div>
        <div className="w-16" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {carton && (
          <div className="flex items-center justify-between rounded-xl border border-emerald-300 bg-emerald-50 px-3 py-3">
            <div>
              <div className="font-mono text-lg font-black text-emerald-900">Karton {formatCartonNo(carton.cartonNo)}</div>
              <div className="text-sm font-bold">{clientDisplay(carton.clientName)}</div>
              <div className="text-xs text-slate-600">{carton.productTypeName || carton.recipeName} · {carton.kgPerUnit} kg{carton.packagingName ? ` · ${carton.packagingName}` : ''}</div>
            </div>
            <div className="text-right">
              <div className="text-2xl font-black tabular-nums text-emerald-700">{carton.packedQty}<span className="text-emerald-400">/{carton.targetQty}</span></div>
              {carton.status === 'packed' && <div className="text-[11px] font-bold text-emerald-700">PEŁNY ✓</div>}
              <button onClick={() => { setCarton(null); setLast(null) }} className="mt-1 text-[11px] text-slate-500 underline">zmień</button>
            </div>
          </div>
        )}

        <form onSubmit={e => { e.preventDefault(); handleSubmit(value) }} className="flex items-stretch gap-2">
          <input
            ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
            placeholder={carton ? 'Skanuj sztukę…' : 'Skanuj QR kartonu…'}
            autoFocus autoComplete="off" spellCheck={false}
            className="flex-1 rounded-lg border-2 border-emerald-300 bg-white px-3 py-3 text-base focus:border-emerald-500 focus:outline-none"
          />
          <button type="button" onClick={() => setScanOpen(true)} className="flex items-center justify-center rounded-lg bg-emerald-600 px-4 text-white"><Camera size={22} /></button>
        </form>

        {last && (
          <div className={`flex items-start gap-3 rounded-xl border-2 p-3 ${last.ok ? 'border-emerald-300 bg-emerald-50' : 'border-red-300 bg-red-50'}`}>
            {last.ok ? <CheckCircle2 size={24} className="shrink-0 text-emerald-600" /> : <AlertTriangle size={24} className="shrink-0 text-red-600" />}
            <div className={`text-sm font-semibold ${last.ok ? 'text-emerald-800' : 'text-red-800'}`}>{last.message}</div>
          </div>
        )}

        {!carton && !last && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 py-16 text-slate-400">
            <Package size={56} className="opacity-30" />
            <div className="text-sm">Zeskanuj etykietę kartonu, aby zacząć pakowanie</div>
          </div>
        )}
      </main>

      {scanOpen && (
        <QrScannerModal
          onScan={text => { setScanOpen(false); handleSubmit(text); focus() }}
          onClose={() => { setScanOpen(false); focus() }}
        />
      )}
    </div>
  )
}
