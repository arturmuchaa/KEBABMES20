/**
 * Statystyki zmiany — OSOBNY widok, jak na rozbiorze.
 *
 * Wyniki pracowników nie wchodzą na ekran główny: mają nie mieszać się
 * operatorowi w robocie. Tempo w KILOGRAMACH na godzinę — sztuka sztuce
 * nierówna, a tempo w sztukach karałoby za robienie dużych kebabów.
 * Kolejność liczb wszędzie ta sama: kilogramy → sztuki → tempo.
 */
import type { ShiftStats as Stats } from '../shiftStats'

const czas = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const g = Math.floor(m / 60)
  return g ? `${g} godz. ${m % 60} min` : `${m} min`
}

export function ShiftStats({ stats, date, onClose }: { stats: Stats; date: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col overflow-hidden" style={{
        width: 1040, maxWidth: '100%', maxHeight: '100%', borderRadius: 14,
        background: 'var(--panel)', border: '1px solid var(--line)',
        boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-3 px-4.5 py-3.5" style={{ borderBottom: '1px solid var(--line)', padding: '14px 18px' }}>
          <h3 className="m-0 text-[20px] font-extrabold">Statystyki zmiany · {date}</h3>
          <span className="hmi-v10-mono text-[15px]" style={{ color: 'var(--mut)' }}>
            czas pracy {czas(stats.total.workedMs)}
          </span>
          <button type="button" onClick={onClose} aria-label="Zamknij"
            className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        <div className="overflow-auto">
          <table className="w-full" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['Pracownik', 'Kilogramy', 'Sztuki', 'Kg / godz.', 'Co robił'].map((h, i) => (
                  <th key={h} className="text-[11px] font-bold uppercase whitespace-nowrap"
                    style={{ textAlign: i > 0 && i < 4 ? 'right' : 'left', letterSpacing: '.1em', color: 'var(--mut)',
                             padding: '10px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--line)' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stats.perWorker.map(w => (
                <tr key={w.worker}>
                  <td className="font-bold" style={{ padding: '13px 12px', borderBottom: '1px solid var(--line)' }}>{w.worker}</td>
                  <td className="hmi-v10-mono text-[19px] font-extrabold" style={{ padding: '13px 12px', textAlign: 'right', borderBottom: '1px solid var(--line)' }}>{w.kg}</td>
                  <td className="hmi-v10-mono" style={{ padding: '13px 12px', textAlign: 'right', color: 'var(--mut)', borderBottom: '1px solid var(--line)' }}>{w.pieces}</td>
                  <td className="hmi-v10-mono font-bold" style={{ padding: '13px 12px', textAlign: 'right', color: 'var(--accent)', borderBottom: '1px solid var(--line)' }}>{w.kgPerHour}</td>
                  <td style={{ padding: '13px 12px', borderBottom: '1px solid var(--line)' }}>
                    <div className="flex gap-1.5 flex-wrap">
                      {w.split.map(s => (
                        <span key={s.kgPerPiece} className="hmi-v10-mono text-[12px] font-bold"
                          style={{ background: 'var(--accentSoft)', color: 'var(--accent)', border: '1px solid #C7CCFB',
                                   borderRadius: 6, padding: '3px 9px' }}>
                          {s.pieces} × {s.kgPerPiece} kg
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
              {stats.perWorker.length === 0 && (
                <tr><td colSpan={5} className="text-center" style={{ padding: 28, color: 'var(--mut)' }}>
                  Jeszcze nikt nic nie zapisał na tej zmianie.
                </td></tr>
              )}
              {stats.perWorker.length > 0 && (
                <tr style={{ background: 'var(--bg)' }}>
                  <td className="font-extrabold" style={{ padding: '13px 12px' }}>Razem</td>
                  <td className="hmi-v10-mono text-[19px] font-extrabold" style={{ padding: '13px 12px', textAlign: 'right' }}>{stats.total.kg}</td>
                  <td className="hmi-v10-mono" style={{ padding: '13px 12px', textAlign: 'right', color: 'var(--mut)' }}>{stats.total.pieces}</td>
                  <td className="hmi-v10-mono font-extrabold" style={{ padding: '13px 12px', textAlign: 'right' }}>{stats.total.kgPerHour}</td>
                  <td style={{ padding: '13px 12px', color: 'var(--mut)' }}>{stats.total.workers} os.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
