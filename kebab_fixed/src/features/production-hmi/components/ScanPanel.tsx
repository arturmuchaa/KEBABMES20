/**
 * Skanowanie gotowych kebabów — sztuka wchodzi na magazyn wyrobu gotowego.
 *
 * Skaner na hali zachowuje się jak klawiatura: wystukuje kod i wciska Enter.
 * Dlatego całe wejście to jedno pole, które samo trzyma kursor i samo się
 * czyści — operator ma zajęte ręce i nie będzie klikał w ekran między
 * sztukami. Dźwięk po każdym skanie jest ważniejszy niż komunikat: kebab
 * zwykle patrzy w wózek, nie w monitor.
 */
import { useEffect, useRef, useState } from 'react'
import { beepErr, beepOk } from '@/features/pwa/beep'

export interface ScanResult {
  clientName?: string
  batchNo?: string
  weightKg?: number
  done?: number
  total?: number
  onStock?: boolean
}

export interface ScanPanelProps {
  onScan: (code: string) => Promise<ScanResult>
  onClose: () => void
}

const czyDubel = (e: any): boolean => {
  const t = String(e?.message ?? '').toLowerCase()
  return e?.status === 409 || t.includes('409') || t.includes('duplikat') || t.includes('already')
}

export function ScanPanel({ onScan, onClose }: ScanPanelProps) {
  const [kod, setKod] = useState('')
  const [zajety, setZajety] = useState(false)
  const [ostatni, setOstatni] = useState<{ ok: boolean; tekst: string; wynik?: ScanResult } | null>(null)
  const [ile, setIle] = useState(0)
  const pole = useRef<HTMLInputElement | null>(null)

  const wroc = () => setTimeout(() => pole.current?.focus(), 30)
  useEffect(() => { wroc() }, [])

  const wyslij = async (surowy: string) => {
    const code = surowy.trim()
    if (!code || zajety) return
    setZajety(true)
    try {
      const wynik = await onScan(code)
      setOstatni({
        ok: true,
        tekst: [wynik.clientName, wynik.batchNo, wynik.weightKg != null ? `${wynik.weightKg} kg` : '']
          .filter(Boolean).join(' · '),
        wynik,
      })
      setIle(n => n + 1)
      beepOk()
    } catch (e: any) {
      setOstatni({
        ok: false,
        tekst: czyDubel(e) ? 'Ta sztuka jest już zeskanowana' : (e?.message || 'Nie udało się zeskanować'),
      })
      beepErr()
    } finally {
      setZajety(false)
      setKod('')
      wroc()
    }
  }

  const ramka = ostatni
    ? (ostatni.ok
        ? { background: 'var(--successSoft)', border: '1px solid var(--successLine)', color: 'var(--success)' }
        : { background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' })
    : { background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--mut)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-5 p-6" style={{
        width: 820, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center flex-shrink-0 text-[26px]" style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--accentSoft)', border: '1px solid #C7CCFB', color: 'var(--accent)',
          }}>▥</div>
          <div>
            <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Skanowanie kebabów</h3>
            <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
              Zeskanowana sztuka od razu wchodzi na magazyn wyrobu gotowego
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        <form onSubmit={e => { e.preventDefault(); wyslij(kod) }}>
          <input ref={pole} data-testid="pole-skanu" value={kod} onChange={e => setKod(e.target.value)}
            placeholder="Zeskanuj kod QR sztuki" autoFocus autoComplete="off" spellCheck={false}
            className="w-full hmi-v10-mono text-[22px] font-bold"
            style={{ padding: '18px 20px', borderRadius: 10, background: 'var(--panel)',
                     border: '2px solid var(--accent)', color: 'var(--ink)' }} />
        </form>

        <div data-testid="ostatni-skan" className="flex items-center gap-4" style={{ ...ramka, borderRadius: 12, padding: '18px 20px', minHeight: 92 }}>
          <span className="text-[30px] leading-none">{ostatni ? (ostatni.ok ? '✓' : '✕') : '·'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[19px] font-extrabold">
              {ostatni ? (ostatni.ok ? (ostatni.wynik?.onStock === false ? 'Zeskanowano' : 'Na magazynie') : 'Nie weszła') : 'Czekam na skan'}
            </div>
            <div className="text-[15px] font-semibold mt-0.5">{ostatni?.tekst || 'Przyłóż czytnik do etykiety'}</div>
          </div>
          {ostatni?.ok && ostatni.wynik?.total != null && (
            <div className="text-right flex-shrink-0">
              <div data-testid="postep-pozycji" className="hmi-v10-mono text-[26px] font-extrabold">
                {ostatni.wynik.done} / {ostatni.wynik.total}
              </div>
              <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: '.1em' }}>na pozycji</div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--mut)' }}>Zeskanowano teraz</span>
          <b data-testid="zeskanowano-teraz" className="hmi-v10-mono text-[24px] font-extrabold" style={{ color: 'var(--accent)' }}>{ile}</b>
          <button type="button" onClick={onClose} className="ml-auto text-base font-bold"
            style={{ height: 56, padding: '0 28px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  )
}
