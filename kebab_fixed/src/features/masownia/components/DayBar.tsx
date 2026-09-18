/**
 * Pasek dnia — liczby, na które operator patrzy bez przerywania roboty.
 *
 * Stoi na dole, przez całą szerokość, jak w prototypie: plan, zrobione,
 * postęp, co stoi w maszynach, co czeka w pojemnikach, ile mięsa leży
 * i kiedy to się skończy. Bez niego ekran odpowiada na pytanie „co teraz
 * zrobić", ale nie na „jak nam idzie" — a to drugie pada na hali cały dzień.
 *
 * Kilogramy, nie palety: „mięso na magazynie" to słownictwo hali.
 */
import { MACHINES, minutyWsadu } from '../machines'

const kg = (n: number) => `${Math.round(n)} kg`

const hhmm = (ms: number) => {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Kiedy skończy się to, co zostało — po ile wsadów naraz biorą trzy maszyny.
 *
 * `minutyCyklu` bierze się z receptur dnia (YAPRAK 30 min zamiast 50), bo
 * prognoza liczona zawsze pięćdziesiątką potrafiła dodać halom godzinę czy dwie
 * nieistniejącej roboty. Zero i śmieci wracają do standardu.
 */
export function etaDnia(zostaloKg: number, now: number, minutyCyklu?: number): string {
  if (zostaloKg <= 0) return 'Zrobione'
  const naRaz = MACHINES.reduce((s, m) => s + m.cap, 0)
  const rund = Math.ceil(zostaloKg / naRaz)
  const minuty = minutyWsadu({ mix_minutes: minutyCyklu })
  return hhmm(now + rund * minuty * 60_000)
}

export function DayBar({ planKg, doneKg, inMachineKg, preparedKg, meatKg, now, minutyCyklu }: {
  planKg: number
  doneKg: number
  inMachineKg: number
  preparedKg: number
  meatKg: number
  now: number
  /** Średni cykl receptur, które zostały do zrobienia (ważony kilogramami). */
  minutyCyklu?: number
}) {
  const postep = planKg > 0 ? Math.round((doneKg / planKg) * 100) : 0
  const zostalo = Math.max(0, planKg - doneKg - inMachineKg - preparedKg)

  const komorki: { label: string; value: string; color?: string }[] = [
    { label: 'Zaplanowane',        value: kg(planKg) },
    { label: 'Wymieszane',         value: kg(doneKg) },
    { label: 'Postęp',             value: `${postep}%`, color: 'var(--accent)' },
    { label: 'W maszynach',        value: kg(inMachineKg), color: inMachineKg > 0 ? 'var(--amb)' : undefined },
    { label: 'Przyprawy gotowe',   value: preparedKg > 0 ? kg(preparedKg) : '—',
      color: preparedKg > 0 ? 'var(--accent)' : undefined },
    { label: 'Mięso na magazynie', value: kg(meatKg) },
    { label: 'Zostało',            value: kg(zostalo) },
    { label: 'Koniec ok.',         value: etaDnia(zostalo + preparedKg, now, minutyCyklu) },
  ]

  return (
    <footer data-testid="pasek-dnia"
      className="shrink-0 h-[76px] grid grid-cols-8"
      style={{ background: 'var(--barBg)', borderTop: '1px solid var(--line)' }}>
      {komorki.map((k, i) => (
        <div key={k.label}
          className="flex flex-col items-center justify-center gap-1.5 text-center px-1"
          style={{ borderRight: i < komorki.length - 1 ? '1px solid var(--lineSoft)' : undefined }}>
          <span className="hmi-v10-mono text-[21px] font-bold leading-none"
            style={k.color ? { color: k.color } : undefined}>
            {k.value}
          </span>
          <span className="text-[10px] font-extrabold uppercase tracking-wider leading-tight"
            style={{ color: 'var(--mut)' }}>
            {k.label}
          </span>
        </div>
      ))}
    </footer>
  )
}
