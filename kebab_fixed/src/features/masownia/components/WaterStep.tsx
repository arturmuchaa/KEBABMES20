/**
 * Woda do wsadu — ostatni krok przed startem masownicy.
 *
 * Woda nie idzie przez wagę: dawkę zadaje dozownik DW-1C, który sam zamyka
 * elektrozawór. Dopóki nie ma modułu RS-485, operator przepisuje litry
 * z urządzenia; okno ±3% jest dokładnością dozownika, nie naszym wyborem.
 */
import { useEffect, useState } from 'react'
import { waterWindow } from '../machines'
import { useDoser } from '../useDoser'
import { NumPad, numpadValue } from './NumPad'

const L = (n: number) => `${Math.round(n * 10) / 10}`.replace('.', ',')

export function WaterStep({ targetL, onDone, onBack }: {
  targetL: number
  onDone: (liters: number) => void
  onBack: () => void
}) {
  const doser = useDoser()
  const [wpis, setWpis] = useState('')
  const okno = waterWindow(targetL)
  const podane = doser.connected ? doser.dosedL : numpadValue(wpis)
  const wOknie = !Number.isNaN(podane) && podane >= okno.min && podane <= okno.max

  // Dozownik podłączony i dawka nalana — panel idzie dalej sam, operator ma
  // ręce przy wężu, nie na szybie.
  useEffect(() => {
    if (doser.connected && !doser.running && wOknie) onDone(doser.dosedL)
  }, [doser.connected, doser.running, doser.dosedL, wOknie, onDone])

  if (targetL <= 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 p-5 text-center">
        <span className="text-[23px] font-extrabold">Ta receptura nie bierze wody</span>
        <span className="text-[15px]" style={{ color: 'var(--mut)' }}>Zostaje zamknąć pokrywę i uruchomić masownicę.</span>
        <button type="button" onClick={() => onDone(0)}
          className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold mt-3"
          style={{ background: 'var(--accent)', color: '#fff' }}>
          Dalej
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="shrink-0 flex items-center gap-4 p-3 px-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <button type="button" onClick={onBack} className="text-sm font-extrabold" style={{ color: 'var(--accent)' }}>
          ← Wróć
        </button>
        <span className="text-[22px] font-extrabold tracking-tight">Woda</span>
      </div>

      <div className="flex-1 min-h-0 flex items-center justify-center gap-8 p-6">
        <div className="text-center">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.16em]" style={{ color: 'var(--mut)' }}>
            Zadaj dawkę
          </div>
          <div className="hmi-v10-mono text-[88px] font-bold leading-none tracking-tighter my-2">
            {L(targetL)}<i className="not-italic text-[30px] font-bold ml-2" style={{ color: 'var(--mut)' }}>L</i>
          </div>
          <div className="hmi-v10-mono text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
            dopuszczalne {L(okno.min)} – {L(okno.max)} L
          </div>

          {doser.connected ? (
            <div className="mt-6">
              <div className="hmi-v10-mono text-[60px] font-bold leading-none"
                style={{ color: wOknie ? 'var(--success)' : 'var(--amb)' }}>
                {L(doser.dosedL)}<i className="not-italic text-[26px] ml-2" style={{ color: 'var(--mut)' }}>L</i>
              </div>
              <div className="text-[21px] font-extrabold mt-2"
                style={{ color: wOknie ? 'var(--success)' : 'var(--amb)' }}>
                {doser.running ? 'Dozowanie…' : wOknie ? 'Dawka zgadza się' : 'Dolej do dawki'}
              </div>
              <button type="button" onClick={() => doser.start(targetL)}
                className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold mt-4"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                Dozuj {L(targetL)} L
              </button>
            </div>
          ) : (
            <div className="rounded-xl p-4 px-5 mt-6 text-right" style={{ border: '2px solid var(--line)', background: 'var(--bg)' }}>
              <div className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-left"
                style={{ color: 'var(--mut)' }}>
                Ile nalano
              </div>
              <span className="hmi-v10-mono text-[60px] font-bold leading-tight">
                {wpis || '0'}<i className="not-italic text-[26px] ml-2" style={{ color: 'var(--mut)' }}>L</i>
              </span>
            </div>
          )}
        </div>

        {doser.connected ? null : <NumPad value={wpis} onChange={setWpis} />}
      </div>

      <div className="shrink-0 flex items-center gap-4 p-3 px-4"
        style={{ borderTop: '1px solid var(--line)', background: 'var(--bg)' }}>
        <span className="text-[15px] font-bold" style={{ color: 'var(--mut)' }}>
          Po zatwierdzeniu masownica rusza na 50 minut.
        </span>
        <button type="button" disabled={!wOknie} onClick={() => onDone(podane)}
          className="h-[60px] px-7 rounded-[10px] text-lg font-extrabold ml-auto"
          style={{
            background: 'var(--accent)', color: '#fff',
            opacity: wOknie ? 1 : 0.35, cursor: wOknie ? 'pointer' : 'not-allowed',
          }}>
          Zatwierdź i uruchom
        </button>
      </div>
    </>
  )
}
