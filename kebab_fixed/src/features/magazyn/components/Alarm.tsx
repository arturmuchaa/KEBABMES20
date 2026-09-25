/**
 * Błąd skanu na CAŁYM ekranie.
 *
 * DLACZEGO PEŁNY EKRAN, a nie pasek: magazynier nie patrzy na ekran — panel
 * milczy, gdy jest dobrze, a podnosi go dopiero dźwięk. Kiedy już spojrzy,
 * komunikat musi być nie do przeoczenia, z dwóch–trzech metrów, od wózka.
 *
 * NAZWA SKANERA jest obowiązkowa: przy dwóch ludziach pracujących obok siebie
 * każdy musi wiedzieć, czy to jego wpadka. Alarm znika sam (steruje nim
 * strona) i przepuszcza dotknięcia — magazynier wraca do roboty, nie do
 * zamykania okienek.
 */
import type { StanAlarmu } from '@/features/magazyn/magazynTypes'

export function Alarm({ alarm }: { alarm: StanAlarmu | null }) {
  if (!alarm) return null
  const blad = alarm.ton === 'blad'
  const kolor = blad ? 'var(--red)' : 'var(--amb)'
  const tlo = blad ? 'var(--redSoft)' : 'var(--ambSoft)'
  const opis = blad ? '#991B1B' : '#92400E'

  return (
    <div role="alert" data-ton={alarm.ton}
      className="pointer-events-none fixed inset-0 z-[90] flex flex-col items-center justify-center gap-5 p-8 text-center"
      style={{ background: tlo, border: `10px solid ${kolor}` }}>
      <span className="hmi-v10-mono rounded-lg px-3.5 py-1 text-[15px] font-extrabold tracking-[0.14em]"
        style={{ color: kolor, border: `2px solid ${kolor}` }}>
        SKANER {alarm.skaner}
      </span>
      <span className="font-extrabold leading-none"
        style={{ color: kolor, fontSize: 'clamp(34px, 5.4vw, 76px)' }}>{alarm.naglowek}</span>
      <span className="leading-snug"
        style={{ color: opis, maxWidth: '30ch', fontSize: 'clamp(16px, 1.9vw, 26px)' }}>
        {alarm.szczegol}
      </span>
      {alarm.gdzie ? (
        <span className="rounded-xl px-7 py-3 font-extrabold"
          style={{ background: '#fff', border: `2px solid ${kolor}`, color: 'var(--ink)',
                   fontSize: 'clamp(19px, 2.2vw, 32px)' }}>
          {alarm.gdzie}
        </span>
      ) : null}
    </div>
  )
}
