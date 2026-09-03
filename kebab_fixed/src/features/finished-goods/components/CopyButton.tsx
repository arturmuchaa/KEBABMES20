/**
 * CopyButton — kopiowanie tekstu (np. nr partii) jednym klikiem.
 * Bez globalnych zależności (bez toastów): po skopiowaniu ikonka
 * na chwilę zmienia się w ptaszek.
 */
import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CopyButton({ text, title, className }: {
  text: string; title?: string; className?: string
}) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      title={ok ? 'Skopiowano' : (title ?? 'Kopiuj')}
      aria-label={ok ? 'Skopiowano' : (title ?? 'Kopiuj')}
      onClick={async e => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
        } catch {
          const ta = document.createElement('textarea')
          ta.value = text
          document.body.appendChild(ta)
          ta.select()
          try { document.execCommand('copy') } catch { /* schowek niedostępny */ }
          document.body.removeChild(ta)
        }
        setOk(true)
        window.setTimeout(() => setOk(false), 1200)
      }}
      className={cn(
        'inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-slate-200/70 transition-colors',
        className,
      )}
    >
      {ok ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}
