/**
 * Szyna masownic — stan trzech maszyn zawsze na wierzchu ekranu.
 *
 * Masownica chodzi 50 minut, więc operator musi widzieć JEDNYM spojrzeniem,
 * która pracuje, ile jej zostało i którą wolno załadować. Panel maszyn jest
 * widoczny także wtedy, gdy nic nie stoi — pusta szyna to też informacja.
 *
 * Wielkość wsadu pokazujemy NOMINALNĄ (200 / 600 kg). Cichy zapas, który
 * system przepuszcza, nie pojawia się na ekranie: wypisany stałby się normą.
 */
import { MACHINES, minutyWsadu, batchNoFromLots } from '../machines'
import type { Charge } from '../useMasowniaData'

const STANY = {
  free:   { label: 'Wolna',            bg: 'transparent',       fg: 'var(--mut)',     line: 'var(--line)' },
  mixing: { label: 'Masuje',           bg: 'var(--accentSoft)', fg: 'var(--accent)',  line: 'var(--accent)' },
  ready:  { label: 'Gotowe — odbierz', bg: 'var(--success)',    fg: '#fff',           line: 'var(--success)' },
} as const

export type MachineState = keyof typeof STANY

/** Ile minut zostało do końca masowania; 0 = maszyna woła o odbiór.
 *
 *  Cykl bierze się z WSADU (`mix_minutes` skopiowane z receptury przy
 *  załadunku), bo YAPRAK masuje się 30 minut, a standard 50. */
export function minutesLeft(startedAt: string, now: number, minuty = minutyWsadu()): number {
  const start = new Date(startedAt).getTime()
  if (Number.isNaN(start)) return 0
  return Math.max(0, minuty - (now - start) / 60_000)
}

export function machineState(charge: Charge | undefined, now: number): MachineState {
  if (!charge) return 'free'
  return minutesLeft(charge.started_at, now, minutyWsadu(charge)) > 0 ? 'mixing' : 'ready'
}

/**
 * Bęben masownicy — jedyna rzecz na ekranie, która się rusza.
 *
 * Hala patrzy na panel z kilku metrów i z tej odległości odliczanie sekund
 * zlewa się w jedną plamę: obracający się bęben mówi „maszyna PRACUJE" bez
 * czytania. Pełny obrót w 3 s, czyli mniej więcej tempo prawdziwej masownicy;
 * szybciej wygląda jak alarm. Systemowe „ogranicz ruch" wyłącza obrót —
 * kafelek nadal czytelny, bo cały stan niesie napis i pasek.
 */
function Beben() {
  return (
    <>
      <style>{`
        @keyframes masownica-obrot { to { transform: rotate(360deg) } }
        @media (prefers-reduced-motion: reduce) {
          [data-testid="beben-masownicy"] { animation: none !important }
        }
      `}</style>
      <svg data-testid="beben-masownicy" width="34" height="34" viewBox="0 0 34 34"
        aria-hidden="true"
        style={{ animation: 'masownica-obrot 3s linear infinite', flexShrink: 0, marginBottom: 2 }}>
        <circle cx="17" cy="17" r="14.5" fill="none" stroke="var(--accent)" strokeWidth="2.5" opacity="0.35" />
        {/* Łopatki — bez nich obracające się koło wygląda na nieruchome. */}
        <path d="M17 4.5 L17 12 M29.5 17 L22 17 M17 29.5 L17 22 M4.5 17 L12 17"
          stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
        <circle cx="17" cy="17" r="3.2" fill="var(--accent)" />
      </svg>
    </>
  )
}

const mmss = (min: number) => {
  const s = Math.max(0, Math.ceil(min * 60))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function MachineRail({ charges, now, pickedMachine, wyjscieKg, onPick }: {
  charges: Charge[]
  now: number
  pickedMachine?: number | null
  /** Ile mięsa wyjdzie z tego wsadu wg receptury — liczy strona, bo tylko ona
   *  ma receptury. Bez tego operator poznaje wynik dopiero przy odbiorze. */
  wyjscieKg?: (charge: Charge) => number
  onPick: (machineId: number, charge: Charge | undefined) => void
}) {
  return (
    <section className="grid grid-cols-3 gap-3 px-6 pt-3 shrink-0">
      {MACHINES.map(m => {
        const charge = charges.find(c => c.machine_id === m.id)
        const stan = machineState(charge, now)
        const st = STANY[stan]
        const minuty = minutyWsadu(charge)
        const left = charge ? minutesLeft(charge.started_at, now, minuty) : 0
        const pct = charge ? Math.min(100, (1 - left / minuty) * 100) : 0
        const wybrana = pickedMachine === m.id
        return (
          <button key={m.id} type="button" onClick={() => onPick(m.id, charge)}
            className="rounded-xl p-3 px-4 flex flex-col gap-2 text-left"
            style={{
              background: stan === 'free' ? 'transparent' : 'var(--panel)',
              border: `${wybrana ? 3 : stan === 'free' ? 1.5 : 2}px ${stan === 'free' ? 'dashed' : 'solid'} ${wybrana ? 'var(--accent)' : st.line}`,
              minHeight: 144,
            }}>
            <div className="flex items-baseline gap-3">
              <span className="text-[15px] font-extrabold uppercase tracking-wide">Masownica {m.id}</span>
              <span className="hmi-v10-mono text-[11px] font-semibold" style={{ color: 'var(--mut)' }}>
                wsad {m.cap} kg
              </span>
              <span className="ml-auto text-[11px] font-extrabold uppercase tracking-wider px-2.5 py-1 rounded-md"
                style={{ background: st.bg, color: st.fg, border: `1px solid ${st.line}` }}>
                {st.label}
              </span>
            </div>
            <div className="text-[19px] font-extrabold leading-tight truncate">
              {charge ? (charge.recipe_name || 'Masowanie') : wybrana ? 'Wybrana do wsadu' : 'Wolna — czeka na wsad'}
              {/* Numer partii na wyjściu. Wsad z kilku partii numeru jeszcze NIE
                  MA — PP{n} nadaje backend przy odbiorze — więc piszemy
                  „mieszana" i wymieniamy wsady, zamiast zmyślać numer. */}
              {charge ? (() => {
                const p = batchNoFromLots((charge.meat ?? []).map(m => m.lot_no))
                const numer = charge.batch_no || p.no
                if (numer) return (
                  <span className="hmi-v10-mono text-[11px] font-bold ml-2 px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--bg)', border: '1px solid var(--line)' }}>
                    partia {numer}
                  </span>
                )
                if (p.mixed) return (
                  <span className="hmi-v10-mono text-[11px] font-bold ml-2 px-1.5 py-0.5 rounded"
                    style={{ background: 'var(--ambSoft)', color: 'var(--amb)', border: '1px solid var(--ambLine)' }}>
                    partia mieszana · {p.lots.join(' + ')}
                  </span>
                )
                return null
              })() : null}
            </div>
            <div className="hmi-v10-mono text-[12px] font-semibold" style={{ color: 'var(--mut)' }}>
              {charge
                ? `${charge.order_no ?? ''} · ${Math.round(charge.kg_meat)} kg`
                  + (wyjscieKg ? ` → wyjdzie ok. ${Math.round(wyjscieKg(charge))} kg` : '')
                : 'dotknij, żeby załadować'}
            </div>
            {stan === 'mixing' ? (
              <div className="flex items-end gap-3 mt-auto">
                <Beben />
                <span className="hmi-v10-mono text-[30px] font-bold leading-none">{mmss(left)}</span>
                <span className="text-[10px] font-bold uppercase tracking-widest pb-1" style={{ color: 'var(--mut)' }}>
                  {minuty !== 50 ? `do końca (cykl ${Math.round(minuty)} min)` : 'do końca masowania'}
                </span>
                <div className="flex-1 h-2.5 rounded-lg overflow-hidden mb-1.5" style={{ background: 'var(--lineSoft)' }}>
                  <div className="h-full rounded-lg" style={{ width: `${pct}%`, background: 'var(--accent)' }} />
                </div>
              </div>
            ) : stan === 'ready' ? (
              <div className="flex items-end gap-3 mt-auto">
                <span className="text-[24px] font-extrabold leading-none" style={{ color: 'var(--success)' }}>Odbierz</span>
                <span className="text-[10px] font-bold uppercase tracking-widest pb-1" style={{ color: 'var(--mut)' }}>
                  zważ paleciakiem i wpisz
                </span>
              </div>
            ) : null}
          </button>
        )
      })}
    </section>
  )
}
