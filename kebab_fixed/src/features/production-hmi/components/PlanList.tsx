/**
 * Plan dnia LISTĄ, nie kaflami.
 *
 * Kolumny i ich kolejność są 1:1 z KARTĄ PRODUKCJI, którą hala zna z wydruku:
 * ILOŚĆ SZT. · WAGA · RODZAJ · TULEJE · KLIENT · RAZEM. Numer partii nie wchodzi
 * na listę — bywa długi („2x472, 6xPP13") i zjadłby czytelność wiersza;
 * operator widzi go po dotknięciu pozycji.
 */
import { lineState, linePct, type WorkerEntry } from '../planProgress'

export interface PlanLineView {
  id: string
  qty: number
  kgPerUnit: number
  totalKg: number
  recipeName: string
  packagingName: string
  clientName: string
  qtyDone: number
  workerEntries?: WorkerEntry[]
  /** Kartoteka tulei pozycji — potrzebna przy zmianie rodzaju z hali. */
  packagingId?: string
  /** Ile tulei zeszło już ze stanu na tej pozycji. */
  packagingUsed?: number
}

const NAGLOWKI = ['Lp', 'Ilość szt.', 'Waga', 'Rodzaj', 'Tuleje', 'Klient', 'Razem', 'Postęp', 'Stan'] as const

const ETYKIETA_STANU = {
  PLANNED:     { text: 'Zaplanowane', bg: 'var(--bg)',          fg: 'var(--mut)',     line: 'var(--line)' },
  IN_PROGRESS: { text: 'W trakcie',   bg: 'var(--accentSoft)',  fg: 'var(--accent)',  line: '#C7CCFB' },
  DONE:        { text: 'Gotowe',      bg: 'var(--successSoft)', fg: 'var(--success)', line: 'var(--successLine)' },
} as const

const kg = (n: number) => `${Math.round(n * 100) / 100} kg`

export function PlanList({ lines, onPick, onPickPackaging }: {
  lines: PlanLineView[]
  onPick: (lineId: string) => void
  /** Dotknięcie kolumny TULEJE — zmiana rodzaju (np. METAL 65 → KARTON 65).
   *  Bez tej obsługi komórka zachowuje się jak reszta wiersza. */
  onPickPackaging?: (lineId: string) => void
}) {
  if (!lines.length) {
    return (
      <div className="flex-1 flex items-center justify-center"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12, minHeight: 240 }}>
        <div className="text-center">
          <div className="text-xl font-extrabold">Biuro nie zaplanowało dziś produkcji</div>
          <div className="text-base mt-2" style={{ color: 'var(--mut)' }}>
            Plan pojawi się tu sam, gdy tylko biuro go zapisze.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-auto"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
      <table className="w-full" style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            {NAGLOWKI.map((h, i) => (
              <th key={h} className="text-[11px] font-bold uppercase whitespace-nowrap"
                style={{
                  textAlign: h === 'Razem' ? 'right' : 'left', letterSpacing: '.1em', color: 'var(--mut)',
                  padding: '10px 12px', background: 'var(--bg)', borderBottom: '1px solid var(--line)',
                  position: 'sticky', top: 0, width: i === 0 ? 48 : undefined,
                }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const stan = lineState(l)
            const pct = linePct(l)
            const s = ETYKIETA_STANU[stan]
            return (
              <tr key={l.id} onClick={() => onPick(l.id)} style={{
                cursor: 'pointer',
                background: stan === 'DONE' ? 'var(--successSoft)' : stan === 'IN_PROGRESS' ? 'var(--accentSoft)' : undefined,
              }}>
                <Td muted>{i + 1}</Td>
                <Td bold>{l.qty} szt.</Td>
                <Td>{kg(l.kgPerUnit)}</Td>
                <Td bold plain>{l.recipeName}</Td>
                <Td plain testId={`tuleja-${l.id}`}
                  onTap={onPickPackaging ? (e) => { e.stopPropagation(); onPickPackaging(l.id) } : undefined}>
                  <span style={onPickPackaging ? {
                    borderBottom: '1.5px dashed var(--accent)', color: 'var(--accent)', fontWeight: 700,
                  } : undefined}>
                    {l.packagingName || '—'}
                  </span>
                </Td>
                <Td plain muted={!l.clientName}>{l.clientName || '— na magazyn —'}</Td>
                <Td right>{kg(l.totalKg)}</Td>
                <td style={{ padding: '13px 12px', borderBottom: '1px solid var(--line)' }}>
                  <div className="flex items-center gap-3" style={{ minWidth: 190 }}>
                    <div className="flex-1 overflow-hidden" style={{ height: 10, borderRadius: 8, background: 'var(--lineSoft)' }}>
                      <div style={{
                        width: `${pct}%`, height: '100%',
                        background: stan === 'DONE' ? 'var(--successSoft)' : 'var(--barBg)',
                        borderRight: `2px solid ${stan === 'DONE' ? 'var(--success)' : 'var(--accent)'}`,
                      }} />
                    </div>
                    <span className="hmi-v10-mono font-bold text-[15px] whitespace-nowrap">{l.qtyDone} / {l.qty}</span>
                    <span className="hmi-v10-mono font-bold text-[13px]" style={{ color: 'var(--mut)', minWidth: 42, textAlign: 'right' }}>{pct}%</span>
                  </div>
                </td>
                <td style={{ padding: '13px 12px', borderBottom: '1px solid var(--line)' }}>
                  <span className="text-[10px] font-bold uppercase whitespace-nowrap"
                    style={{ padding: '3px 9px', borderRadius: 6, letterSpacing: '.06em',
                             background: s.bg, color: s.fg, border: `1px solid ${s.line}` }}>
                    {s.text}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Td({ children, bold, right, muted, plain, testId, onTap }: {
  children: React.ReactNode; bold?: boolean; right?: boolean; muted?: boolean; plain?: boolean
  testId?: string; onTap?: (e: React.MouseEvent) => void
}) {
  return (
    <td className={plain ? '' : 'hmi-v10-mono'} data-testid={testId} onClick={onTap}
      style={{
        padding: '13px 12px', borderBottom: '1px solid var(--line)', fontSize: 16,
        whiteSpace: 'nowrap', textAlign: right ? 'right' : 'left',
        fontWeight: bold ? 700 : undefined, color: muted ? 'var(--mut)' : undefined,
      }}>
      {children}
    </td>
  )
}
