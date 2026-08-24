/**
 * Foliowanie — kto ile kilogramów zafoliował.
 *
 * Tu klawiatura JEST właściwa, inaczej niż przy liczniku sztuk: to wpis raz na
 * dzień (albo gdy foliowczyk kończy wcześniej), a nie ruch wykonywany co chwilę
 * w rękawicy. Najczęstszy przypadek — dwóch ludzi, po połowie — załatwia jeden
 * przycisk, więc klawiatura jest dla wyjątków, nie dla reguły.
 */
import { useMemo, useState } from 'react'
import { splitEvenly, wrappingIssues, wrappedTotal, type WrapperShare } from '../wrapping'

export interface WrappingModalProps {
  /** Operatorzy działu — z nich wybiera się foliowczyków. */
  workers: { id: string; name: string }[]
  /** Zapisane już kilogramy (wpis w ciągu dnia można poprawić). */
  saved: { workerId: string; workerName: string; kg: number }[]
  /** Kilogramy zrobione dziś na linii — podstawa podziału po równo. */
  kgToday: number
  onSave: (shares: { workerId: string; workerName: string; kg: number }[]) => void
  onClose: () => void
  busy?: boolean
}

const KLAWISZE = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', '⌫']

export function WrappingModal({ workers, saved, kgToday, onSave, onClose, busy }: WrappingModalProps) {
  const [kg, setKg] = useState<Record<string, number>>(
    () => Object.fromEntries(saved.map(s => [s.workerId, s.kg])),
  )
  // Kogo dotyczy klawiatura. Bez tego nie wiadomo, komu przypisać cyfry.
  const [edytowany, setEdytowany] = useState<string>('')

  const zaznaczeni = useMemo(
    () => workers.filter(w => kg[w.id] !== undefined),
    [workers, kg],
  )
  const shares: WrapperShare[] = workers
    .filter(w => kg[w.id] !== undefined)
    .map(w => ({ workerId: w.id, workerName: w.name, kg: kg[w.id] ?? 0 }))
  const bledy = wrappingIssues(shares, kgToday)
  const suma = wrappedTotal(shares)

  const przelacz = (id: string) => {
    setKg(prev => {
      const next = { ...prev }
      if (next[id] === undefined) { next[id] = 0; setEdytowany(id) }
      else { delete next[id]; if (edytowany === id) setEdytowany('') }
      return next
    })
  }

  const podzielPoRowno = () => {
    const ids = zaznaczeni.map(w => w.id)
    const czesci = splitEvenly(kgToday, ids.length)
    setKg(prev => {
      const next = { ...prev }
      ids.forEach((id, i) => { next[id] = czesci[i] })
      return next
    })
  }

  const klawisz = (k: string) => {
    if (!edytowany) return
    setKg(prev => {
      const teraz = String(Math.round(prev[edytowany] ?? 0))
      let nowy: string
      if (k === '⌫') nowy = teraz.slice(0, -1)
      else nowy = (teraz === '0' ? '' : teraz) + k
      return { ...prev, [edytowany]: Number(nowy || 0) }
    })
  }

  const kafel = { borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--panel)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-5 p-6" style={{
        width: 860, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center flex-shrink-0 text-[26px]" style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--accentSoft)', border: '1px solid #C7CCFB', color: 'var(--accent)',
          }}>🎞</div>
          <div>
            <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Foliowanie</h3>
            <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
              Kto ile kilogramów zafoliował · dziś zrobiono <span className="hmi-v10-mono">{kgToday}</span> kg
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        <div className="flex gap-5" style={{ minHeight: 300 }}>
          <div className="flex-1 flex flex-col gap-3 overflow-auto">
            <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
              Kto foliował
            </div>
            <div className="flex flex-col gap-2">
              {workers.map(w => {
                const wybrany = kg[w.id] !== undefined
                const aktywny = edytowany === w.id
                return (
                  <div key={w.id} className="flex items-center gap-3">
                    <button type="button" onClick={() => przelacz(w.id)}
                      className="flex-1 text-left text-[17px] font-bold"
                      style={{ ...kafel, padding: '12px 16px',
                               background: wybrany ? 'var(--accent)' : 'var(--panel)',
                               borderColor: wybrany ? 'var(--accent)' : 'var(--line)',
                               color: wybrany ? '#fff' : 'var(--ink)' }}>
                      {w.name}
                    </button>
                    {wybrany && (
                      <button type="button" onClick={() => setEdytowany(w.id)}
                        data-testid={`kg-${w.id}`}
                        className="hmi-v10-mono text-[22px] font-extrabold text-right"
                        style={{ ...kafel, width: 150, padding: '12px 16px',
                                 borderColor: aktywny ? 'var(--accent)' : 'var(--line)',
                                 borderWidth: aktywny ? 2 : 1.5,
                                 background: aktywny ? 'var(--accentSoft)' : 'var(--panel)' }}>
                        {kg[w.id] ?? 0} kg
                      </button>
                    )}
                  </div>
                )
              })}
              {workers.length === 0 && (
                <div className="text-[15px]" style={{ color: 'var(--mut)' }}>
                  Brak operatorów działu produkcja.
                </div>
              )}
            </div>

            <button type="button" onClick={podzielPoRowno} disabled={zaznaczeni.length === 0}
              className="text-[16px] font-bold mt-1"
              style={{ height: 56, borderRadius: 10, border: '1.5px solid var(--accent)',
                       background: 'var(--accentSoft)', color: 'var(--accent)',
                       opacity: zaznaczeni.length === 0 ? .4 : 1 }}>
              Podziel po równo{zaznaczeni.length > 1 ? ` (${zaznaczeni.length} os. · po ${splitEvenly(kgToday, zaznaczeni.length)[1] ?? 0} kg)` : ''}
            </button>
          </div>

          <div className="flex flex-col gap-2" style={{ width: 260 }}>
            <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
              {edytowany ? `Wpisz kilogramy — ${workers.find(w => w.id === edytowany)?.name ?? ''}` : 'Dotknij kilogramów, żeby wpisać'}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {KLAWISZE.map(k => (
                <button key={k} type="button" disabled={!edytowany} onClick={() => klawisz(k)}
                  aria-label={k === '⌫' ? 'skasuj' : k}
                  className="hmi-v10-mono text-[24px] font-bold"
                  style={{ ...kafel, height: 64, opacity: edytowany ? 1 : .35,
                           color: k === '⌫' ? 'var(--red)' : 'var(--ink)' }}>
                  {k}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-baseline gap-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--mut)' }}>Razem zafoliowane</span>
          <b data-testid="suma-foliowania" className="hmi-v10-mono text-[22px] font-extrabold" style={{ color: 'var(--accent)' }}>{suma} kg</b>
        </div>

        {bledy.length > 0 && (
          <div className="text-[15px] font-semibold" style={{ color: 'var(--red)' }}>{bledy[0]}</div>
        )}

        <div className="flex gap-3">
          <button type="button" data-testid="zapisz-foliowanie" disabled={bledy.length > 0 || !!busy}
            onClick={() => onSave(shares)} className="flex-1 text-base font-bold"
            style={{ height: 56, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff',
                     opacity: bledy.length > 0 || busy ? .4 : 1 }}>
            {busy ? 'Zapisuję…' : 'Zapisz foliowanie'}
          </button>
          <button type="button" onClick={onClose} className="text-base font-bold"
            style={{ height: 56, padding: '0 24px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  )
}
