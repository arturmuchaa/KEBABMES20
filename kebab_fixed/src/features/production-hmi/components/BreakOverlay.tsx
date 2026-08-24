/**
 * Przerwa — zasłania ekran i wstrzymuje liczenie sztuk.
 *
 * Blokada jest tu CELOWA i jest całą pointą: zapomniana przerwa zatrzymuje
 * robotę, zamiast po cichu zawyżać tempo. Operator zderzy się z nią przy
 * pierwszej sztuce i poprawi natychmiast. Przerwa kończąca się sama przy
 * zapisie ukrywałaby ten sam błąd, a tempa nikt później nie zweryfikuje.
 */
const minuty = (from: string, now: string): number => {
  const a = Date.parse(from), b = Date.parse(now)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return Math.floor((b - a) / 60_000)
}

export function BreakOverlay({ startedAt, now, onEnd }: { startedAt: string; now: string; onEnd: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="p-8 flex flex-col gap-6" style={{
        width: 480, borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)',
        color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4">
          <div className="flex items-center justify-center flex-shrink-0 text-[26px]" style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)',
          }}>⏸</div>
          <div>
            <h3 className="font-extrabold text-[22px]" style={{ letterSpacing: '-.01em' }}>Przerwa</h3>
            <p className="text-sm font-bold mt-0.5" style={{ color: 'var(--mut)' }}>Liczenie sztuk jest wstrzymane</p>
          </div>
        </div>

        <div className="hmi-v10-mono text-center font-bold leading-none py-2"
          style={{ fontSize: 64, color: 'var(--amb)' }}>
          {minuty(startedAt, now)} min
        </div>

        <p className="text-[15px] m-0" style={{ color: 'var(--mut)', lineHeight: 1.5 }}>
          Dopóki przerwa trwa, ekran <b style={{ color: 'var(--ink)' }}>nie zapisze sztuk</b>.
          Żeby wrócić do liczenia, wyłącz ją tym przyciskiem.
        </p>

        <button type="button" onClick={onEnd} className="text-base font-bold"
          style={{ height: 56, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff' }}>
          Wracam do pracy
        </button>
      </div>
    </div>
  )
}
