import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { X, ShieldAlert } from 'lucide-react'

/**
 * Pełnoekranowy podgląd kamery z dekoderem QR.
 * Wywołuje onScan z surowym tekstem (token PAL|... lub URL) i zamyka się sam.
 *
 * iOS Safari wymaga HTTPS dla getUserMedia — sprawdzamy isSecureContext
 * PRZED instancjowaniem Html5Qrcode (które inaczej leci hard-fail i triggeruje
 * ErrorBoundary).
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
  const [insecureContext, setInsecureContext] = useState<boolean>(false)

  // Pre-check: iOS Safari wymaga HTTPS dla getUserMedia. Bez tego
  // Html5Qrcode próbuje wywołać niedostępne API i może rzucić sync.
  useEffect(() => {
    const isSecure = window.isSecureContext
    const hasMediaApi = !!navigator.mediaDevices?.getUserMedia
    if (!isSecure || !hasMediaApi) {
      setInsecureContext(true)
    }
  }, [])

  useEffect(() => {
    if (insecureContext) return
    let cancelled = false
    let instance: Html5Qrcode | null = null
    try {
      instance = new Html5Qrcode(containerId, { verbose: false })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Nie udało się przygotować skanera')
      return
    }
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
          // .stop() może w pewnych warunkach nie zwrócić Promise — guard.
          const stopResult = instance!.stop()
          if (stopResult && typeof stopResult.then === 'function') {
            stopResult.catch(() => {}).then(() => onScan(decoded))
          } else {
            onScan(decoded)
          }
        },
        () => {/* per-frame decode errors are noise */},
      )
      .catch((err) => {
        // Zamapuj typowe błędy iOS na czytelny komunikat
        const name = err?.name || ''
        const msg = err?.message || ''
        if (name === 'NotAllowedError' || /Permission|denied/i.test(msg)) {
          setError('Nie udzielono dostępu do kamery. Sprawdź uprawnienia w Ustawieniach iPhone → Safari → Kamera.')
        } else if (name === 'NotFoundError' || /no camera|device/i.test(msg)) {
          setError('Nie znaleziono kamery na tym urządzeniu.')
        } else if (/secure|https/i.test(msg)) {
          setInsecureContext(true)
        } else {
          setError(msg || 'Nie udało się uruchomić kamery')
        }
      })

    return () => {
      cancelled = true
      const i = instanceRef.current
      if (i) {
        try {
          const r = i.stop()
          if (r && typeof r.then === 'function') {
            r.catch(() => {}).finally(() => { try { i.clear() } catch {} })
          } else {
            try { i.clear() } catch {}
          }
        } catch {/* ignore */}
      }
    }
  }, [onScan, insecureContext])

  // Wyznacz HTTPS URL z aktualnego origin (nginx słucha na :8443).
  const httpsUrl = (() => {
    try {
      const { protocol, hostname, pathname, search, hash } = window.location
      if (protocol === 'https:') return ''
      return `https://${hostname}:8443${pathname}${search}${hash}`
    } catch {
      return ''
    }
  })()

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
        {!insecureContext && <div id={containerId} className="absolute inset-0" />}

        {insecureContext && (
          <div className="absolute inset-x-4 top-6 rounded-2xl border-2 border-amber-400 bg-amber-50 p-5 text-slate-800 shadow-lg">
            <div className="mb-2 flex items-center gap-2 text-amber-700">
              <ShieldAlert size={22} />
              <div className="text-base font-bold">Kamera wymaga HTTPS</div>
            </div>
            <div className="text-sm leading-relaxed">
              iPhone Safari pozwala na dostęp do kamery <strong>tylko gdy strona jest pod HTTPS</strong>.
              Aktualnie używasz HTTP — przeglądarka blokuje skaner ze względów bezpieczeństwa.
            </div>
            <div className="mt-3 rounded-lg bg-white/70 p-3 text-xs text-slate-700">
              <div className="font-semibold text-slate-900">Jak włączyć (jednorazowo):</div>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                <li>Pobierz certyfikat z <span className="font-mono">http://204.168.166.34:8080/ca.crt</span></li>
                <li>Otwórz pobrany plik → Ustawienia → Profil → <em>Zainstaluj</em></li>
                <li>Ustawienia → Ogólne → Informacje → Zaufanie certyfikatów → włącz dla „kebab-mes-ca”</li>
                <li>Otwórz aplikację pod adresem HTTPS poniżej, dodaj ją ponownie do ekranu początkowego</li>
              </ol>
            </div>
            {httpsUrl && (
              <a
                href={httpsUrl}
                className="mt-3 block w-full rounded-xl bg-emerald-600 px-4 py-3 text-center text-sm font-bold uppercase tracking-wide text-white shadow hover:bg-emerald-500"
              >
                Otwórz pod HTTPS ↗
              </a>
            )}
          </div>
        )}

        {!insecureContext && error && (
          <div className="absolute inset-x-4 top-6 rounded-lg border border-red-200 bg-red-50 p-4 text-center text-sm font-semibold text-red-700">
            {error}
          </div>
        )}
        {!insecureContext && (
          <div className="pointer-events-none absolute inset-x-0 bottom-8 text-center text-sm font-semibold text-slate-700 drop-shadow-[0_1px_2px_rgba(255,255,255,0.85)]">
            Skieruj kamerę na kod QR palety
          </div>
        )}
      </div>
    </div>
  )
}
