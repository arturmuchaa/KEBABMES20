/**
 * Szczegóły pozycji planu — otwierane przytrzymaniem wiersza albo przyciskiem
 * „Szczegóły" w panelu (droga dla klawiatury i dla tych, którzy nie wiedzą
 * o geście).
 *
 * Tu trafiło wszystko, co dotąd zapychało listę planu: pełne nazwy, partie
 * i rozbicie na wsady (operator musi wiedzieć, z czego robi pozycję — bez
 * tego pyta biuro), tuleja ze zmianą rodzaju i rozliczenie „kto ile".
 *
 * Okno NIE zamyka się kliknięciem w tło: palec, który właśnie przytrzymał
 * wiersz, puszcza ekran już nad tym oknem — zamknęłoby się samo.
 */
import { useEffect, useRef } from 'react'
import { byWorker } from '../planProgress'
import { useModalFocus } from '../useModalFocus'
import { batchParts } from '../batchLabel'
import { lineScanState, scanOf, type LineScan } from '../scanProgress'
import { ETYKIETA_STANU, kgTxt, sztukiRazyWaga, type PlanLineView } from './PlanList'

export function LineDetails({ line, lp, scan, onClose, onChangePackaging, onMoveFrom, locked = false }: {
  line: PlanLineView
  lp: number
  scan?: LineScan
  onClose: () => void
  /** Zmiana tulei (np. METAL 65 → KARTON 65) — metalowe kończą się w trakcie dnia. */
  onChangePackaging?: (lineId: string) => void
  onMoveFrom?: (workerId: string) => void
  /** Zapis w locie albo przerwa — zmiany pozycji (tuleja, przepisanie) czekają. */
  locked?: boolean
}) {
  const zamknij = useRef<HTMLButtonElement | null>(null)
  const okno = useRef<HTMLDivElement | null>(null)
  useModalFocus(okno, zamknij)
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose])

  const s = scanOf(scan ? { [line.id]: scan } : {}, line.id)
  const stan = ETYKIETA_STANU[lineScanState(line, scan ? { [line.id]: scan } : {})]
  const partie = batchParts(line)
  const rozliczenie = byWorker(line)

  const etykieta = 'text-[11px] font-bold uppercase'
  const etStyl = { letterSpacing: '.1em', color: 'var(--mut)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(15,23,42,.38)' }}>
      <div ref={okno} role="dialog" aria-modal="true" aria-labelledby="szczegoly-tytul" data-testid="szczegoly-pozycji"
        className="flex flex-col gap-4 overflow-y-auto"
        style={{ width: 760, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, padding: 22,
                 background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)',
                 boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
        <div className="flex items-start gap-4">
          <span className="hmi-v10-mono text-[20px] font-extrabold flex-shrink-0"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: 8, padding: '4px 11px' }}>{lp}</span>
          <div className="min-w-0 flex-1">
            <h3 id="szczegoly-tytul" className="m-0 text-[26px] font-extrabold leading-tight">
              <span className="hmi-v10-mono">{sztukiRazyWaga(line)}</span> · {line.recipeName}
            </h3>
            <div className="text-[16px] font-semibold mt-1" style={{ color: 'var(--mut)' }}>
              {line.clientName || 'Produkcja na magazyn'} · razem {kgTxt(line.totalKg)}
            </div>
          </div>
          <button ref={zamknij} type="button" onClick={onClose} data-testid="zamknij-szczegoly"
            className="phmi-btn text-[16px] font-bold flex-shrink-0"
            style={{ height: 52, padding: '0 22px', borderRadius: 10, border: '1px solid var(--line)', background: 'var(--bg)' }}>
            Zamknij
          </button>
        </div>

        <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          {[
            { k: 'Zrobione', v: `${line.qtyDone} / ${line.qty} szt.`, sub: kgTxt(line.qtyDone * line.kgPerUnit) },
            { k: 'Zeskanowane', v: `${s.scanned} / ${line.qty} szt.`,
              sub: s.total === 0 ? 'brak wydrukowanych etykiet' : `etykiet: ${s.total}` },
            { k: 'Stan', v: stan.text, color: stan.fg },
          ].map(c => (
            <div key={c.k} style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', border: '1px solid var(--line)' }}>
              <div className={etykieta} style={etStyl}>{c.k}</div>
              <div className="hmi-v10-mono text-[20px] font-extrabold mt-1" style={{ color: c.color }}>{c.v}</div>
              {c.sub && <div className="text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>{c.sub}</div>}
            </div>
          ))}
        </div>

        <section>
          <div className={etykieta} style={etStyl}>Partie</div>
          {partie.length === 0 ? (
            <div className="text-[16px] mt-1" style={{ color: 'var(--mut)' }}>Biuro nie przypisało partii.</div>
          ) : (
            <ul data-testid="partie" className="flex flex-wrap gap-2 mt-1.5">
              {partie.map(p => (
                <li key={p.batchNo} className="hmi-v10-mono text-[17px] font-bold"
                  style={{ padding: '6px 12px', borderRadius: 8, background: 'var(--accentSoft)', border: '1px solid var(--accentLine)' }}>
                  {p.batchNo}{p.pieces != null ? <span style={{ color: 'var(--mut)' }}> · {p.pieces} szt.</span> : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className={etykieta} style={etStyl}>Tuleja</div>
            <div className="text-[18px] font-bold mt-0.5" data-testid="tuleja-nazwa">{line.packagingName || '—'}</div>
            {(line.packagingUsed ?? 0) > 0 && (
              <div className="text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>zeszło ze stanu: {line.packagingUsed} szt.</div>
            )}
          </div>
          {onChangePackaging && (
            <button type="button" data-testid="zmien-tuleje" onClick={() => onChangePackaging(line.id)} disabled={locked}
              className="phmi-btn text-[15px] font-bold flex-shrink-0"
              style={{ height: 52, padding: '0 20px', borderRadius: 10, border: '1.5px solid var(--accent)',
                       color: 'var(--accent)', background: 'var(--accentSoft)', opacity: locked ? .45 : 1 }}>
              Zmień tuleję
            </button>
          )}
        </section>

        <section>
          <div className={etykieta} style={etStyl}>
            Kto ile zrobił{onMoveFrom && rozliczenie.length ? ' · dotknij, żeby przepisać komu innemu' : ''}
          </div>
          <div className="flex gap-2 flex-wrap mt-1.5">
            {rozliczenie.length === 0
              ? <span className="text-[16px]" style={{ color: 'var(--mut)' }}>Jeszcze nikt</span>
              : rozliczenie.map(w => (
                  <button key={w.workerId} type="button" data-testid={`rozliczenie-${w.workerId}`}
                    disabled={!onMoveFrom || locked} onClick={() => onMoveFrom?.(w.workerId)}
                    className="phmi-btn hmi-v10-mono text-[16px] font-bold"
                    style={{ background: 'var(--bg)', borderRadius: 10, padding: '10px 14px', minHeight: 48,
                             opacity: locked ? .45 : 1,
                             border: `1px solid ${onMoveFrom ? 'var(--accent)' : 'var(--line)'}`,
                             color: onMoveFrom ? 'var(--accent)' : 'var(--ink)' }}>
                    {w.workerName} — {w.pieces} szt.
                  </button>
                ))}
          </div>
        </section>
      </div>
    </div>
  )
}
