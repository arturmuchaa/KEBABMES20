/**
 * Liczenie sztuk z jednej pozycji planu.
 *
 * Rytm z TABLETU PRODUKCJI: minus, wielka liczba, plus, potem jeden zapis.
 * BEZ KLAWIATURY — w rękawicy trafia się w duży przycisk, nie w cyfry
 * (decyzja właściciela 24.08.2026, po odrzuceniu pola do wpisywania).
 *
 * Wybrany pracownik ZOSTAJE na czas serii, a jego nazwisko stoi na przycisku
 * zapisu. To świadome odstępstwo od rozbioru, gdzie pracownik odznacza się po
 * każdym zapisie: tamta reguła powstała po wpisach lądujących na złej osobie
 * przy POJEDYNCZYCH ważeniach, a przy liczeniu co sztukę byłaby nie do zniesienia.
 */
import { useEffect, useState } from 'react'
import { byWorker } from '../planProgress'
import type { PlanLineView } from './PlanList'

export interface LineCounterProps {
  line: PlanLineView
  workers: { id: string; name: string }[]
  selectedWorkerId: string
  onSelectWorker: (id: string) => void
  onSave: (pieces: number) => void
  onBack: () => void
  /** `false` w trakcie przerwy — zapis jest wtedy odmawiany. */
  canSave: boolean
  /** Dotknięcie osoby w rozliczeniu — poprawka „nie ta osoba".
   *  Działa też na pozycji gotowej: pomyłka wychodzi zwykle na koniec. */
  onMoveFrom?: (workerId: string) => void
}

export function LineCounter({ line, workers, selectedWorkerId, onSelectWorker, onSave, onBack, canSave, onMoveFrom }: LineCounterProps) {
  const zostalo = Math.max(0, line.qty - line.qtyDone)
  const [ile, setIle] = useState(1)

  // Po zapisie zostaje mniej do zrobienia — licznik nie może wisieć nad limitem.
  useEffect(() => { setIle(n => Math.min(Math.max(1, n), Math.max(1, zostalo))) }, [zostalo])

  const wybrany = workers.find(w => w.id === selectedWorkerId)
  const imie = (wybrany?.name ?? '').split(' ')[0] || '—'
  const rozliczenie = byWorker(line)
  const zablokowane = !canSave || zostalo === 0

  const zapisz = () => { if (!zablokowane) onSave(ile) }

  const klawisz = { borderRadius: 10, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }

  return (
    <div className="flex-1 flex flex-col gap-4 p-5"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
      <div className="flex items-baseline gap-4 flex-wrap">
        <button type="button" onClick={onBack} className="text-[15px] font-bold" style={{ color: 'var(--accent)' }}>
          ← Plan dnia
        </button>
        <span className="text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>
          {line.qty} szt. × {line.kgPerUnit} kg · {line.recipeName}
          {line.packagingName ? ` · ${line.packagingName}` : ''}
          {line.clientName ? ` · ${line.clientName}` : ' · na magazyn'}
        </span>
        <span className="hmi-v10-mono text-[26px] font-extrabold ml-auto">{line.qtyDone} / {line.qty}</span>
      </div>

      <div className="flex gap-3 flex-wrap" role="group" aria-label="Kto teraz liczy">
        {workers.map(w => {
          const aktywny = w.id === selectedWorkerId
          return (
            <button key={w.id} type="button" aria-pressed={aktywny} onClick={() => onSelectWorker(w.id)}
              className="text-[17px] font-bold" style={{
                ...klawisz, padding: '12px 22px',
                background: aktywny ? 'var(--accent)' : 'var(--panel)',
                borderColor: aktywny ? 'var(--accent)' : 'var(--line)',
                color: aktywny ? '#fff' : 'var(--ink)',
              }}>
              {w.name.split(' ')[0]}
            </button>
          )
        })}
      </div>

      <div className="text-[15px] font-semibold" style={{ color: 'var(--mut)' }}>
        Wykonano <b className="hmi-v10-mono">{line.qtyDone}</b> z {line.qty} · pozostało{' '}
        <b className="hmi-v10-mono" style={{ color: 'var(--amb)' }}>{zostalo}</b> szt.
      </div>

      <div className="flex items-center justify-center gap-7 py-1">
        <button type="button" aria-label="mniej" disabled={ile <= 1}
          onClick={() => setIle(n => Math.max(1, n - 1))}
          className="text-[46px] font-extrabold leading-none"
          style={{ ...klawisz, width: 104, height: 104, borderRadius: 12, background: 'var(--bg)', opacity: ile <= 1 ? .35 : 1 }}>
          −
        </button>
        <div className="flex flex-col items-center" style={{ minWidth: 150 }}>
          <b data-testid="licznik" className="hmi-v10-mono text-[76px] font-extrabold leading-none">{ile}</b>
          <span className="hmi-v10-mono text-[15px] font-bold mt-1" style={{ color: 'var(--mut)' }}>
            = {ile * line.kgPerUnit} kg
          </span>
        </div>
        {/* Granicę trzyma `disabled`; Math.min zostaje jako druga warstwa —
            nieosiągalna z DOM-u, więc świadomie nieobjęta testem. */}
        <button type="button" aria-label="więcej" disabled={ile >= zostalo}
          onClick={() => setIle(n => Math.min(zostalo, n + 1))}
          className="text-[46px] font-extrabold leading-none"
          style={{ ...klawisz, width: 104, height: 104, borderRadius: 12,
                   background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff',
                   opacity: ile >= zostalo ? .35 : 1 }}>
          +
        </button>
      </div>

      <button type="button" data-testid="zapisz" onClick={zapisz} disabled={zablokowane}
        className="text-[22px] font-bold"
        style={{ height: 64, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff',
                 opacity: zablokowane ? .4 : 1 }}>
        {zostalo === 0 ? 'Pozycja gotowa' : `Zapisz ${ile} szt. · ${imie}`}
      </button>

      <div className="flex flex-col gap-2 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
        <div className="text-[11px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
          Kto ile zrobił{onMoveFrom ? ' · dotknij, żeby przepisać komu innemu' : ''}
        </div>
        <div className="flex gap-3 flex-wrap">
          {rozliczenie.length === 0
            ? <span className="text-[15px]" style={{ color: 'var(--mut)' }}>Jeszcze nikt</span>
            : rozliczenie.map(w => (
                <button key={w.workerId} type="button" data-testid={`rozliczenie-${w.workerId}`}
                  onClick={() => onMoveFrom?.(w.workerId)}
                  className="hmi-v10-mono text-[16px] font-bold"
                  style={{ background: 'var(--bg)', borderRadius: 10, padding: '8px 14px',
                           border: `1px solid ${onMoveFrom ? 'var(--accent)' : 'var(--line)'}`,
                           color: onMoveFrom ? 'var(--accent)' : 'var(--ink)',
                           cursor: onMoveFrom ? 'pointer' : 'default' }}>
                  {w.workerName} — {w.pieces} szt.
                </button>
              ))}
        </div>
      </div>
    </div>
  )
}
