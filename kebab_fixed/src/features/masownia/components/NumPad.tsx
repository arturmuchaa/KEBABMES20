/**
 * Klawiatura numeryczna hali — jedna na cały panel.
 *
 * Wszędzie, gdzie operator PRZEPISUJE liczbę z urządzenia, którego system nie
 * czyta (paleciak z wagą, dozownik bez modułu RS-485), wpisuje ją tutaj.
 * Klawisze są duże, bo hala pracuje w rękawicach.
 */
const KLAWISZE = ['1', '2', '3', '4', '5', '6', '7', '8', '9', ',', '0', '⌫'] as const

export function NumPad({ value, onChange }: {
  value: string
  onChange: (next: string) => void
}) {
  const wcisnij = (k: string) => {
    if (k === '⌫') return onChange(value.slice(0, -1))
    if (k === ',') return onChange(value.includes(',') ? value : (value || '0') + ',')
    onChange((value === '0' ? '' : value) + k)
  }
  return (
    <div className="grid gap-2.5 shrink-0" style={{ gridTemplateColumns: 'repeat(3, 94px)', gridAutoRows: '70px' }}>
      {KLAWISZE.map(k => (
        <button key={k} type="button" onClick={() => wcisnij(k)}
          aria-label={k === '⌫' ? 'Skasuj' : k}
          className="rounded-[10px] hmi-v10-mono text-[29px] font-bold"
          style={{ background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
          {k}
        </button>
      ))}
    </div>
  )
}

/** Liczba z tego, co wpisano; pusty ciąg i sam przecinek dają NaN. */
export function numpadValue(text: string): number {
  const n = Number(text.replace(',', '.'))
  return text.trim() === '' || Number.isNaN(n) ? NaN : n
}
