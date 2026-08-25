/**
 * Przeniesienie sztuk z jednej osoby na drugą — pomyłka „nie ta osoba".
 *
 * Operator liczy w rękawicy i na jednym ekranie; pomyłka wychodzi zwykle pod
 * koniec pozycji, czasem po jej zamknięciu. Kilogramy idą prosto do wypłaty,
 * więc poprawka musi być na hali, a nie przez telefon do biura.
 *
 * Rytm ten sam co przy liczeniu sztuk: minus, wielka liczba, plus. Bez
 * klawiatury — tu też stoi się w rękawicy.
 */
import { useState } from 'react'
import { byWorker } from '../planProgress'
import type { PlanLineView } from './PlanList'

export interface MovePiecesModalProps {
  line: PlanLineView
  /** Osoba, której sztuki przenosimy. */
  fromWorkerId: string
  workers: { id: string; name: string }[]
  onMove: (ruch: { toWorkerId: string; toWorkerName: string; pieces: number }) => void
  onClose: () => void
  busy?: boolean
}

export function MovePiecesModal({ line, fromWorkerId, workers, onMove, onClose, busy }: MovePiecesModalProps) {
  const rozliczenie = byWorker(line)
  const zrodlo = rozliczenie.find(w => w.workerId === fromWorkerId)
  const ma = zrodlo?.pieces ?? 0

  const [ile, setIle] = useState(1)
  const [naKogo, setNaKogo] = useState('')

  const cel = workers.find(w => w.id === naKogo)
  const zablokowane = !cel || ile < 1 || ile > ma || !!busy

  const przenies = () => {
    if (zablokowane || !cel) return
    onMove({ toWorkerId: cel.id, toWorkerName: cel.name, pieces: ile })
  }

  const klawisz = { borderRadius: 10, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div data-testid="okno-przeniesienia" className="flex flex-col gap-5 p-6" style={{
        width: 760, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center flex-shrink-0 text-[26px]" style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--accentSoft)', border: '1px solid #C7CCFB', color: 'var(--accent)',
          }}>⇄</div>
          <div>
            <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Przenieś sztuki</h3>
            <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
              {zrodlo?.workerName || '—'} ma na tej pozycji <span className="hmi-v10-mono">{ma} szt.</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        <div className="flex items-center justify-center gap-7 py-1">
          <button type="button" aria-label="mniej" disabled={ile <= 1}
            onClick={() => setIle(n => Math.max(1, n - 1))}
            className="text-[46px] font-extrabold leading-none"
            style={{ ...klawisz, width: 96, height: 96, borderRadius: 12, background: 'var(--bg)', opacity: ile <= 1 ? .35 : 1 }}>
            −
          </button>
          <div className="flex flex-col items-center" style={{ minWidth: 140 }}>
            <b data-testid="ile-sztuk" className="hmi-v10-mono text-[70px] font-extrabold leading-none">{ile}</b>
            <span className="hmi-v10-mono text-[15px] font-bold mt-1" style={{ color: 'var(--mut)' }}>
              = {Math.round(ile * line.kgPerUnit * 100) / 100} kg
            </span>
          </div>
          <button type="button" aria-label="więcej" disabled={ile >= ma}
            onClick={() => setIle(n => Math.min(ma, n + 1))}
            className="text-[46px] font-extrabold leading-none"
            style={{ ...klawisz, width: 96, height: 96, borderRadius: 12,
                     background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff',
                     opacity: ile >= ma ? .35 : 1 }}>
            +
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
            Komu je zapisać
          </div>
          <div className="flex gap-3 flex-wrap">
            {workers.filter(w => w.id !== fromWorkerId).map(w => {
              const wybrany = w.id === naKogo
              return (
                <button key={w.id} type="button" data-testid={`na-${w.id}`} onClick={() => setNaKogo(w.id)}
                  className="text-[17px] font-bold" style={{
                    ...klawisz, padding: '14px 22px',
                    background: wybrany ? 'var(--accent)' : 'var(--panel)',
                    borderColor: wybrany ? 'var(--accent)' : 'var(--line)',
                    color: wybrany ? '#fff' : 'var(--ink)',
                  }}>
                  {w.name.split(' ')[0]}
                </button>
              )
            })}
            {workers.filter(w => w.id !== fromWorkerId).length === 0 && (
              <span className="text-[15px]" style={{ color: 'var(--mut)' }}>Nie ma komu przepisać — brak innych operatorów.</span>
            )}
          </div>
        </div>

        <div className="flex gap-3">
          <button type="button" data-testid="przenies" onClick={przenies} disabled={zablokowane}
            className="flex-1 text-[19px] font-bold"
            style={{ height: 60, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff',
                     opacity: zablokowane ? .4 : 1 }}>
            {busy ? 'Przenoszę…' : `Przenieś ${ile} szt.${cel ? ` → ${cel.name.split(' ')[0]}` : ''}`}
          </button>
          <button type="button" onClick={onClose} className="text-base font-bold"
            style={{ height: 60, padding: '0 24px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Anuluj
          </button>
        </div>
      </div>
    </div>
  )
}
