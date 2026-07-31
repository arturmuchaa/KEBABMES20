/**
 * YieldGuardModal — zapis zatrzymany przez pasmo wydajności.
 *
 * Pokazuje się, gdy uzysk mięsa z pobrania wypada poza pasmo (z/s 60–71%,
 * b/s 45–60%). Domyślne wyjście to POPRAWA wpisu — najczęstsza przyczyna to
 * tara wózka wliczona w mięso (partie 431, 442, 443, 444: różnice 87–110 kg).
 *
 * Furtka kodem serwisowym jest częścią projektu, nie luką. Pułap 95% usunięto
 * 2026-07-24 właśnie dlatego, że bez furtki zakleszczał pobranie w „czeka na
 * zważenie" — próg bez wyjścia albo zostanie usunięty, albo nauczy operatora
 * wpisywania zmyślonej ćwiartki, i wtedy błąd zniknie z widoku. Ominięcie
 * zostawia ślad w deboning_entry_corrections.
 */
import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { AlertTriangle, Delete, Wrench } from 'lucide-react'
import { SERVICE_CODE } from './ServiceMenu'

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

export function YieldGuardModal({ message, vars, onFix, onOverride }: {
  /** Komunikat z yieldBandError albo z backendu (400). */
  message: string
  /** Zmienne motywu HMI (VARS strony) — modal stoi poza drzewem panelu. */
  vars?: CSSProperties
  /** „Popraw wpis" — nic nie zapisujemy, operator wraca do edycji. */
  onFix: () => void
  /** Kod poprawny — zapisz mimo przekroczenia pasma. */
  onOverride: () => void
}) {
  const [asking, setAsking] = useState(false)
  const [code, setCode] = useState('')
  const [err, setErr] = useState(false)

  const pressKey = useCallback((k: string) => {
    setErr(false)
    setCode(prev => k === '⌫' ? prev.slice(0, -1) : (prev + k).slice(0, 4))
  }, [])

  // Walidacja w efekcie, nie w updaterze setState — side-effect w updaterze
  // był przyczyną zawodności starego wykrywania 0099 w polu wagi.
  useEffect(() => {
    if (code.length < 4) return
    if (code === SERVICE_CODE) { setCode(''); onOverride() }
    else { setErr(true); setCode('') }
  }, [code, onOverride])

  return (
    <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/40" style={vars}>
      <div className="w-[480px] p-8 flex flex-col gap-6"
        style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 flex items-center justify-center flex-shrink-0"
            style={{ borderRadius: 12, background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)' }}>
            <AlertTriangle size={26} />
          </div>
          <div>
            <h3 className="font-extrabold text-xl leading-tight">Zapis zatrzymany</h3>
            <p className="text-sm mt-1" style={{ color: 'var(--mut)' }}>{message}</p>
          </div>
        </div>

        {!asking ? (
          <div className="flex flex-col gap-3">
            <button type="button" onClick={onFix}
              className="h-14 text-base font-bold flex items-center justify-center gap-3"
              style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff' }}>
              POPRAW WPIS
            </button>
            <button type="button" onClick={() => setAsking(true)}
              className="h-12 text-base font-bold flex items-center justify-center gap-2"
              style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              <Wrench size={18} /> Zapisz mimo to (kod serwisowy)
            </button>
          </div>
        ) : (
          <>
            <div className="flex justify-center gap-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="w-12 h-14 flex items-center justify-center text-2xl font-bold"
                  style={{ fontFamily: MONO, borderRadius: 10, background: 'var(--bg)', border: `1px solid ${err ? 'var(--redLine)' : 'var(--line)'}` }}>
                  {code[i] ? '•' : ''}
                </div>
              ))}
            </div>
            {err && <p className="text-sm font-bold text-center" style={{ color: 'var(--red)' }}>Błędny kod</p>}
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === ''
                ? <div key={i} />
                : <button key={i} type="button" onClick={() => pressKey(k)}
                    className="h-14 flex items-center justify-center text-2xl font-bold select-none"
                    style={{ fontFamily: MONO, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                    {k === '⌫' ? <Delete size={22} /> : k}
                  </button>)}
            </div>
            <button type="button" onClick={onFix}
              className="h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              Wróć i popraw wpis
            </button>
          </>
        )}
      </div>
    </div>
  )
}
