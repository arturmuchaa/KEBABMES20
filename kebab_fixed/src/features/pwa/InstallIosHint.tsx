/**
 * InstallIosHint — pokazuje instrukcję "Dodaj do ekranu początkowego"
 * tylko gdy:
 *   - jesteśmy w Safari na iOS (nie WKWebView, nie Chrome iOS — tylko Safari
 *     pozwala dodać do home screen)
 *   - apka NIE działa w trybie standalone (jeszcze nie zainstalowana)
 *   - user nie zamknął wcześniej (localStorage 'kebab.pwaHintDismissed.<appKey>')
 */
import { useEffect, useState } from 'react'
import { Share, Plus, X } from 'lucide-react'

interface InstallIosHintProps {
  /** Klucz do localStorage żeby zamknięcie dla jednej apki nie wycisza innych */
  appKey: string
  /** Etykieta pod ikoną na iOS — pokazana w tekście instrukcji */
  appName: string
}

function isIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  const isIos = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  const isSafari = /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)
  return isIos && isSafari
}

function isStandalone(): boolean {
  if (typeof window === 'undefined') return false
  // iOS Safari: navigator.standalone
  if ((window.navigator as any).standalone === true) return true
  // Inne: matchMedia
  return window.matchMedia?.('(display-mode: standalone)').matches ?? false
}

export function InstallIosHint({ appKey, appName }: InstallIosHintProps) {
  const [show, setShow] = useState(false)
  const storageKey = `kebab.pwaHintDismissed.${appKey}`

  useEffect(() => {
    if (localStorage.getItem(storageKey) === '1') return
    if (!isIosSafari()) return
    if (isStandalone()) return
    setShow(true)
  }, [storageKey])

  if (!show) return null

  function dismiss() {
    localStorage.setItem(storageKey, '1')
    setShow(false)
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-[60] p-3 pb-[calc(12px+env(safe-area-inset-bottom))] pointer-events-none">
      <div className="mx-auto max-w-md bg-white border-2 border-brand rounded-2xl shadow-2xl p-4 pointer-events-auto">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center flex-shrink-0">
            <Plus size={20} className="text-brand" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-ink text-sm leading-tight">
              Dodaj {appName} do ekranu początkowego
            </div>
            <div className="text-xs text-ink-3 mt-1 leading-relaxed">
              Aby używać jak aplikacji: kliknij <Share size={11} className="inline align-text-bottom mx-0.5" /> <strong>Udostępnij</strong> w pasku Safari, potem <strong>„Do ekranu początkowego"</strong>.
            </div>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="w-7 h-7 rounded-full flex items-center justify-center text-ink-3 hover:bg-surface-2 flex-shrink-0"
            aria-label="Zamknij"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
