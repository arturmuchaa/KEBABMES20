/**
 * Liczenie sztuk z jednej pozycji planu.
 *
 * Rytm z TABLETU PRODUKCJI: minus, wielka liczba, plus, potem jeden zapis.
 * BEZ KLAWIATURY — w rękawicy trafia się w duży przycisk, nie w cyfry
 * (decyzja właściciela 24.08.2026, po odrzuceniu pola do wpisywania).
 *
 * Wybrany pracownik ZOSTAJE na czas serii, a jego nazwisko stoi na przyciskach
 * zapisu. To świadome odstępstwo od rozbioru, gdzie pracownik odznacza się po
 * każdym zapisie: tamta reguła powstała po wpisach lądujących na złej osobie
 * przy POJEDYNCZYCH ważeniach, a przy liczeniu co sztukę byłaby nie do zniesienia.
 *
 * Załoga liczy 10–15 osób układających naraz, więc pracownicy stoją KAFELKAMI
 * z dorobkiem na tej pozycji — osobę wybiera się wzrokiem z drugiego końca
 * stołu, a nie czytając pasek chipsów.
 *
 * Sztuki idą w OBIE strony: dopóki sztuka nie jest zeskanowana, jest tylko
 * liczbą na ekranie i wolno ją odjąć — także po zamknięciu pozycji, bo pomyłka
 * wychodzi zwykle na końcu. Po skanie sztuka leży na magazynie wyrobu gotowego
 * i zostaje wyłącznie przepisanie pracy komu innemu (`onMoveFrom`).
 */
import { useEffect, useState } from 'react'
import { byWorker } from '../planProgress'
import { removablePieces, scanOf, type LineScan } from '../scanProgress'
import type { PlanLineView } from './PlanList'

export interface LineCounterProps {
  line: PlanLineView
  workers: { id: string; name: string }[]
  selectedWorkerId: string
  onSelectWorker: (id: string) => void
  /** Dodatnio — dopisz sztuki, ujemnie — zdejmij je wybranemu pracownikowi. */
  onSave: (pieces: number) => void
  onBack: () => void
  /** `false` w trakcie przerwy — zapis jest wtedy odmawiany. */
  canSave: boolean
  /** Dotknięcie osoby w rozliczeniu — poprawka „nie ta osoba".
   *  Działa też na pozycji gotowej: pomyłka wychodzi zwykle na koniec. */
  onMoveFrom?: (workerId: string) => void
  /** Ile sztuk pozycji wygenerowano i zeskanowano — próg odejmowania. */
  scan?: LineScan
  /** Przejście do skanowania TEJ pozycji (drugie wejście obok paska dnia). */
  onScanLine?: (lineId: string) => void
}

export function LineCounter({
  line, workers, selectedWorkerId, onSelectWorker, onSave, onBack, canSave,
  onMoveFrom, scan, onScanLine,
}: LineCounterProps) {
  const zostalo = Math.max(0, line.qty - line.qtyDone)
  const [ile, setIle] = useState(1)

  // Po zapisie zostaje mniej do zrobienia — licznik nie może wisieć nad limitem.
  // Pozycja domknięta (`zostalo === 0`) zostawia licznik na 1: odejmowanie
  // wciąż z niego korzysta, więc zerowanie zablokowałoby poprawkę.
  useEffect(() => { setIle(n => Math.min(Math.max(1, n), Math.max(1, zostalo))) }, [zostalo])

  const wybrany = workers.find(w => w.id === selectedWorkerId)
  const imie = (wybrany?.name ?? '').split(' ')[0] || '—'
  const rozliczenie = byWorker(line)
  const dorobek = new Map(rozliczenie.map(w => [w.workerId, w.pieces]))
  const skan = scanOf(scan ? { [line.id]: scan } : {}, line.id)

  // Ile wolno odjąć: nie więcej niż osoba ma na pozycji I nie poniżej progu
  // skanu (zeskanowane sztuki leżą już na magazynie wyrobu gotowego).
  const moje = dorobek.get(selectedWorkerId) ?? 0
  const doOdjecia = Math.min(ile, moje, removablePieces(line, { [line.id]: skan }))

  const dodanieZablokowane = !canSave || zostalo === 0
  const odjecieZablokowane = !canSave || doOdjecia <= 0

  const dodaj = () => { if (!dodanieZablokowane) onSave(ile) }
  const odejmij = () => { if (!odjecieZablokowane) onSave(-doOdjecia) }

  const klawisz = { borderRadius: 10, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }

  return (
    <div className="flex-1 flex flex-col gap-3.5 p-5 overflow-hidden"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
      <div className="flex items-baseline gap-4 flex-wrap flex-shrink-0">
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

      {/* Pasek skanu — mówi, ile z pozycji jest już na magazynie wyrobu
          gotowego, czyli ile sztuk jest poza zasięgiem poprawki. */}
      <div className="flex items-center gap-3 flex-shrink-0 flex-wrap">
        <span data-testid="skan-pozycji" className="text-[13px] font-bold"
          style={{
            padding: '7px 13px', borderRadius: 8, letterSpacing: '.02em',
            background: skan.scanned >= line.qty && line.qty > 0 ? 'var(--successSoft)' : 'var(--bg)',
            border: `1px solid ${skan.scanned >= line.qty && line.qty > 0 ? 'var(--successLine)' : 'var(--line)'}`,
            color: skan.scanned >= line.qty && line.qty > 0 ? 'var(--success)' : 'var(--mut)',
          }}>
          Zeskanowane <b className="hmi-v10-mono">{skan.scanned} / {line.qty}</b>
          {skan.scanned >= line.qty && line.qty > 0 ? ' · potwierdzone' : ''}
        </span>
        {skan.scanned > 0 && skan.scanned < line.qtyDone && (
          <span className="text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>
            zeskanowanych już nie odejmiesz — zostaje przepisanie komu innemu
          </span>
        )}
        {onScanLine && (
          <button type="button" data-testid="skanuj-pozycje" onClick={() => onScanLine(line.id)}
            className="ml-auto text-[14px] font-bold"
            style={{ height: 42, padding: '0 18px', borderRadius: 9,
                     border: '1.5px solid var(--accent)', color: 'var(--accent)', background: 'var(--accentSoft)' }}>
            ▥ Skanuj tę pozycję
          </button>
        )}
      </div>

      {/* Kafelki załogi — 10–15 osób naraz, więc siatka, a nie pasek.
          Bierze resztę wysokości i przewija się sama; licznik i przyciski
          zapisu zostają przyklejone na dole, zawsze pod ręką. */}
      <div className="grid gap-2.5 overflow-auto flex-1" role="group" aria-label="Kto teraz liczy"
        style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(168px, 1fr))', alignContent: 'start', minHeight: 96 }}>
        {workers.map(w => {
          const aktywny = w.id === selectedWorkerId
          const ma = dorobek.get(w.id) ?? 0
          return (
            <button key={w.id} type="button" data-testid={`pracownik-${w.id}`} aria-pressed={aktywny}
              onClick={() => onSelectWorker(w.id)}
              className="flex flex-col items-start justify-center px-4 active:scale-[.98] transition-transform"
              style={{
                ...klawisz, height: 76, gap: 3,
                background: aktywny ? 'var(--accent)' : 'var(--panel)',
                borderColor: aktywny ? 'var(--accent)' : 'var(--line)',
                borderWidth: aktywny ? 2 : 1.5,
                color: aktywny ? '#fff' : 'var(--ink)',
              }}>
              <span className="text-[19px] font-extrabold leading-none truncate w-full text-left">
                {w.name.split(' ')[0]}
              </span>
              {ma > 0 && (
                <span className="hmi-v10-mono text-[13px] font-bold leading-none"
                  style={{ color: aktywny ? 'rgba(255,255,255,.82)' : 'var(--mut)' }}>
                  {ma} szt.
                </span>
              )}
            </button>
          )
        })}
      </div>

      <div className="text-[15px] font-semibold flex-shrink-0" style={{ color: 'var(--mut)' }}>
        Wykonano <b className="hmi-v10-mono">{line.qtyDone}</b> z {line.qty} · pozostało{' '}
        <b className="hmi-v10-mono" style={{ color: 'var(--amb)' }}>{zostalo}</b> szt.
      </div>

      <div className="flex items-center justify-center gap-7 flex-shrink-0">
        <button type="button" aria-label="mniej" disabled={ile <= 1}
          onClick={() => setIle(n => Math.max(1, n - 1))}
          className="text-[42px] font-extrabold leading-none"
          style={{ ...klawisz, width: 96, height: 96, borderRadius: 12, background: 'var(--bg)', opacity: ile <= 1 ? .35 : 1 }}>
          −
        </button>
        <div className="flex flex-col items-center" style={{ minWidth: 150 }}>
          <b data-testid="licznik" className="hmi-v10-mono text-[68px] font-extrabold leading-none">{ile}</b>
          <span className="hmi-v10-mono text-[15px] font-bold mt-1" style={{ color: 'var(--mut)' }}>
            = {ile * line.kgPerUnit} kg
          </span>
        </div>
        {/* Granicę trzyma `disabled`; Math.min zostaje jako druga warstwa —
            nieosiągalna z DOM-u, więc świadomie nieobjęta testem. */}
        <button type="button" aria-label="więcej" disabled={ile >= zostalo}
          onClick={() => setIle(n => Math.min(zostalo, n + 1))}
          className="text-[42px] font-extrabold leading-none"
          style={{ ...klawisz, width: 96, height: 96, borderRadius: 12,
                   background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff',
                   opacity: ile >= zostalo ? .35 : 1 }}>
          +
        </button>
      </div>

      {/* Dwa zapisy zamiast jednego. Odejmowanie z obwódką, nie wypełnione —
          jest poprawką, a nie codziennym ruchem, i nie może wpaść pod kciuk
          zamiast „Dodaj". */}
      <div className="flex gap-3 flex-shrink-0">
        <button type="button" data-testid="zapisz" onClick={dodaj} disabled={dodanieZablokowane}
          className="flex-1 text-[21px] font-bold"
          style={{ height: 64, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff',
                   opacity: dodanieZablokowane ? .4 : 1 }}>
          {zostalo === 0 ? 'Pozycja gotowa' : `Dodaj ${ile} szt. · ${imie}`}
        </button>
        <button type="button" data-testid="odejmij" onClick={odejmij} disabled={odjecieZablokowane}
          className="text-[19px] font-bold"
          style={{ height: 64, padding: '0 26px', borderRadius: 10, background: 'var(--panel)',
                   border: '1.5px solid var(--redLine)', color: 'var(--red)',
                   opacity: odjecieZablokowane ? .35 : 1 }}>
          Odejmij {Math.max(doOdjecia, 0) || ile} szt. · {imie}
        </button>
      </div>

      <div className="flex flex-col gap-2 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
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
