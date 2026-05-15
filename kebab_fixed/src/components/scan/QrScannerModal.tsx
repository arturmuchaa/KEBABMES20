import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X } from 'lucide-react'

/**
 * Pełnoekranowy podgląd kamery z dekoderem QR.
 * Wywołuje onScan z surowym tekstem (token PAL|... lub URL) i zamyka się sam.
 */
export function QrScannerModal({
  onScan,
  onClose,
}: {
  onScan: (text: string) => void
  onClose: () => void
}) {
  const containerId = 'qr-scanner-stream'
  const instanceRef = useRef<Html5Qrcode | null>(null)
  const [error, setError] = useState<string>('')

  useEffect(() => {
    let cancelled = false
    const instance = new Html5Qrcode(containerId, { verbose: false })
    instanceRef.current = instance

    instance
      .start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        (decoded) => {
          if (cancelled) return
          cancelled = true
          // navigator.vibrate may not exist on iOS Safari
          try { navigator.vibrate?.(60) } catch {}
          instance.stop().catch(() => {}).then(() => onScan(decoded))
        },
        () => {/* per-frame decode errors are noise */},
      )
      .catch((err) => {
        setError(err?.message || 'Nie udało się uruchomić kamery')
      })

    return () => {
      cancelled = true
      const i = instanceRef.current
      if (i) {
        i.stop().catch(() => {}).finally(() => { i.clear(); })
      }
    }
  }, [onScan])

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-slate-50 text-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-700">Skanowanie QR</div>
        <button
          onClick={onClose}
          aria-label="Zamknij skaner"
          className="rounded-full bg-slate-100 p-2 text-slate-700 hover:bg-slate-200"
        >
          <X size={20} />
        </button>
      </div>
      <div className="relative flex-1 overflow-hidden bg-slate-100">
        <div id={containerId} className="absolute inset-0" />
        {error && (
          <div className="absolute inset-x-4 top-6 rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-sm font-semibold text-slate-700 drop-shadow-[0_1px_2px_rgba(255,255,255,0.85)]">
          Skieruj kamerę na kod QR palety
        </div>
      </div>
    </div>
  )
}
