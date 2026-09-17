/**
 * Tor 1 — przyprawy odważone do ponumerowanego pojemnika.
 *
 * Bramka wagi stoi TUTAJ i puszcza dalej sama: gdy odczyt trafi w okno
 * ±0,05 kg i ustoi się przez chwilę, pozycja zapisuje się bez dotykania
 * ekranu. Operator ma ręce w przyprawach, nie na szybie.
 *
 * Waga odłączona → ręczne potwierdzenie ze śladem „ręcznie" na pozycji.
 * Przy sprawnej wadze tego przycisku NIE MA: inaczej bramka byłaby ozdobą.
 */
import { useEffect, useRef, useState } from 'react'
import { useScale } from '@/features/deboning/useScale'
import { spiceVerdict, type SpiceItem } from '../spiceCheck'
import { TOL_SPICE_KG } from '../machines'
import { NumPad, numpadValue } from './NumPad'

/** Ile odczyt musi ustać w oknie, zanim panel zapisze pozycję sam. */
const DWELL_MS = 800

const qty = (n: number) => n.toLocaleString('pl-PL', { maximumFractionDigits: 3 })

export function SpiceWeighing({ items, weighed, cartNo, przyMaszynie, onWeigh, onDone, onBack }: {
  items: SpiceItem[]
  /** Co już odważone: seq → kg. Żyje w panelu do czasu zatwierdzenia całości. */
  weighed: Record<number, { weighed: number; manual: boolean }>
  cartNo: number
  /** Ważenie PRZY MASZYNIE (brak gotowego pojemnika) — przyprawy idą wprost
   *  do masownicy, więc nie ma numeru pojemnika ani „odstaw przy maszynie". */
  przyMaszynie?: boolean
  onWeigh: (item: SpiceItem, kg: number, manual: boolean) => void
  onDone: () => void
  onBack: () => void
}) {
  const waga = useScale()
  const [reczne, setReczne] = useState('')
  const dwellRef = useRef<number | null>(null)

  const biezacy = items.find(i => weighed[i.seq] === undefined) ?? null
  const komplet = biezacy === null && items.length > 0
  const werdykt = biezacy ? spiceVerdict(biezacy.qty, waga.gross) : 'low'

  // Auto-zapis: odczyt w oknie i stabilny przez DWELL_MS zamyka pozycję.
  useEffect(() => {
    if (!biezacy || !waga.connected) { dwellRef.current = null; return }
    if (werdykt !== 'ok' || !waga.stable) { dwellRef.current = null; return }
    if (dwellRef.current === null) dwellRef.current = Date.now()
    const t = setTimeout(() => {
      if (dwellRef.current !== null && Date.now() - dwellRef.current >= DWELL_MS) {
        onWeigh(biezacy, waga.gross, false)
        dwellRef.current = null
      }
    }, DWELL_MS)
    return () => clearTimeout(t)
  }, [biezacy, werdykt, waga.stable, waga.gross, waga.connected, onWeigh])

  const zapiszRecznie = () => {
    const kg = numpadValue(reczne)
    if (!biezacy || Number.isNaN(kg) || kg <= 0) return
    onWeigh(biezacy, kg, true)
    setReczne('')
  }

  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
<span className="text-[22px] font-extrabold tracking-tight">{przyMaszynie ? 'Przyprawy do masownicy' : `Przyprawy do pojemnika ${cartNo}`}</span>
        <div className="flex-1" />
        <span className="hmi-v10-mono text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          {Object.keys(weighed).length} / {items.length}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex gap-4 p-4 overflow-hidden">
        <div className="w-[400px] shrink-0 overflow-y-auto flex flex-col gap-1.5">
          {items.map(i => {
            const w = weighed[i.seq]
            const teraz = biezacy?.seq === i.seq
            return (
              <div key={i.seq} className="flex items-center gap-3 w-full p-2.5 px-3 rounded-[9px]"
                style={{
                  background: w ? 'var(--successSoft)' : teraz ? 'var(--accentSoft)' : 'var(--panel)',
                  border: `${teraz ? 2 : 1.5}px solid ${
                    w ? 'var(--successLine)' : teraz ? 'var(--accent)' : 'var(--line)'}`,
                }}>
                <span className="hmi-v10-mono text-xs font-bold w-4 shrink-0" style={{ color: 'var(--mut)' }}>
                  {i.seq + 1}
                </span>
                <span className="flex-1 min-w-0 text-[15px] font-extrabold truncate"
                  style={{ color: w ? 'var(--success)' : teraz ? 'var(--accent)' : undefined }}>
                  {i.name}
                </span>
                {w?.manual ? (
                  <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 rounded"
                    style={{ color: 'var(--amb)', border: '1px solid var(--ambLine)' }}>ręcznie</span>
                ) : null}
                <span className="hmi-v10-mono text-[17px] font-bold shrink-0"
                  style={{ color: w ? 'var(--success)' : teraz ? 'var(--accent)' : undefined }}>
                  {qty(i.qty)}
                </span>
                <span className="text-[11px] font-bold w-5 shrink-0" style={{ color: 'var(--mut)' }}>{i.unit}</span>
                <span className="w-5 shrink-0 text-center text-base font-extrabold" style={{ color: 'var(--success)' }}>
                  {w ? '✓' : ''}
                </span>
              </div>
            )
          })}
        </div>

        <div className="flex-1 min-w-0 rounded-xl flex flex-col items-center justify-center gap-1.5 p-5 text-center"
          style={{
            background: komplet ? 'var(--successSoft)'
              : werdykt === 'ok' && waga.connected ? 'var(--successSoft)'
              : werdykt === 'over' && waga.connected ? 'var(--redSoft)' : 'var(--bg)',
            border: `1.5px solid ${komplet ? 'var(--success)'
              : werdykt === 'ok' && waga.connected ? 'var(--success)'
              : werdykt === 'over' && waga.connected ? 'var(--red)' : 'var(--line)'}`,
          }}>
          {komplet ? (
            <>
              {przyMaszynie ? null : (
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl font-extrabold"
                  style={{ background: 'var(--success)', color: '#fff' }}>{cartNo}</div>
              )}
              <span className="text-3xl font-extrabold" style={{ color: 'var(--success)' }}>
                {przyMaszynie ? 'Przyprawy odważone' : 'Pojemnik gotowy'}
              </span>
              <span className="text-[15px]" style={{ color: 'var(--mut)' }}>
                {przyMaszynie
                  ? 'Wsyp je do masownicy i przejdź do wody.'
                  : 'Odstaw go przy masownicy — przy maszynie wskażesz jego numer.'}
              </span>
              <button type="button" onClick={onDone}
                className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold mt-3"
                style={{ background: 'var(--success)', color: '#fff' }}>
                {przyMaszynie ? 'Dalej — woda' : 'Zatwierdź pojemnik'}
              </button>
            </>
          ) : !biezacy ? (
            <span className="text-xl font-bold" style={{ color: 'var(--mut)' }}>Receptura nie ma przypraw do odważenia.</span>
          ) : (
            <>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.16em]" style={{ color: 'var(--mut)' }}>
                Odważ teraz
              </span>
              <span className="text-[28px] font-extrabold leading-tight">{biezacy.name}</span>
              <span className="hmi-v10-mono text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
                potrzeba {qty(biezacy.qty)} {biezacy.unit} (±{TOL_SPICE_KG.toString().replace('.', ',')})
              </span>

              {waga.connected ? (
                <>
                  <span className="hmi-v10-mono text-[88px] font-bold leading-none tracking-tighter my-1"
                    style={{
                      color: werdykt === 'ok' ? 'var(--success)' : werdykt === 'over' ? 'var(--red)' : undefined,
                    }}>
                    {qty(Math.round(waga.gross * 1000) / 1000)}
                    <i className="not-italic text-[30px] font-bold ml-2" style={{ color: 'var(--mut)' }}>{biezacy.unit}</i>
                  </span>
                  <span className="text-[21px] font-extrabold"
                    style={{
                      color: werdykt === 'ok' ? 'var(--success)' : werdykt === 'over' ? 'var(--red)' : 'var(--amb)',
                    }}>
                    {!waga.stable ? 'Ważenie…'
                      : werdykt === 'ok' ? 'Zgadza się'
                      : werdykt === 'over' ? 'Za dużo — zdejmij'
                      : 'Dosyp'}
                  </span>
                </>
              ) : (
                <div className="flex items-center gap-6 mt-2">
                  <div className="text-right">
                    <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-left"
                      style={{ color: 'var(--mut)' }}>
                      Waga nie odpowiada — wpisz odczyt
                    </div>
                    <div className="rounded-xl p-4 px-5 mt-2" style={{ border: '2px solid var(--ambLine)', background: '#fff' }}>
                      <span className="hmi-v10-mono text-[60px] font-bold leading-tight">
                        {reczne || '0'}
                        <i className="not-italic text-[26px] ml-2" style={{ color: 'var(--mut)' }}>{biezacy.unit}</i>
                      </span>
                    </div>
                    <button type="button" onClick={zapiszRecznie}
                      className="h-[60px] w-full mt-3 rounded-[10px] text-lg font-extrabold"
                      style={{ background: 'var(--amb)', color: '#fff' }}>
                      Zatwierdź ręcznie
                    </button>
                  </div>
                  <NumPad value={reczne} onChange={setReczne} />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}
