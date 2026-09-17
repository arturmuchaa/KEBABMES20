/**
 * Dwa kafle akcji na ekranie spoczynku masowni.
 *
 * To jedyna decyzja, jaką panel stawia przed operatorem, gdy nic nie robi:
 * odważyć przyprawy na zapas czy załadować wolną masownicę. Dlatego zajmują
 * cały panel roboczy i są czytelne z metra, w rękawicach.
 *
 * KOLORY. Motyw hali to biel + indygo, ale zieleń ma tu już zajęte znaczenie
 * („Gotowe — odbierz" na szynie maszyn). Gdyby akcja startu też była zielona,
 * na jednym ekranie stałyby dwie zielenie znaczące co innego. Stąd para:
 * indygo dla mieszania (akcja główna stanowiska) i morski dla przypraw —
 * wyraźnie inny od indygo, a przy tym nie zielony i nie bursztynowy, więc nie
 * podszywa się pod „odbierz" ani pod ostrzeżenie.
 *
 * Kolor morski żyje TYLKO tutaj i celowo nie wchodzi do wspólnego motywu hali:
 * wspólne zostają biel, indygo i znaczenia semantyczne.
 *
 * Nieaktywny kafel schodzi do szarości, a nie do wyblakłego koloru — wyblakły
 * kolor czyta się jak „prawie można".
 */
export const KOLOR_PRZYPRAW = '#0F766E'
export const KOLOR_MIESZANIA = '#4F46E5'

export function ActionTile({ title, lead, foot, color, disabled, onClick }: {
  title: string
  /** Jedno zdanie: co się stanie po dotknięciu. */
  lead: string
  /** Stan pod kreską: co następne, które maszyny wolne. Pusty = bez stopki. */
  foot: string
  color: string
  disabled?: boolean
  onClick: () => void
}) {
  const tlo = disabled ? '#E7EAEE' : color
  const tekst = disabled ? 'var(--mut)' : '#fff'
  const przygaszony = disabled ? 'var(--mut)' : 'rgba(255,255,255,.82)'

  return (
    <button type="button" disabled={disabled} onClick={onClick}
      className="rounded-2xl p-7 text-left flex flex-col gap-3 h-full w-full"
      style={{
        background: tlo,
        color: tekst,
        border: disabled ? '2px solid var(--line)' : 'none',
        cursor: disabled ? 'not-allowed' : 'pointer',
        minHeight: 240,
      }}>
      <span className="text-[30px] font-extrabold leading-tight tracking-tight">{title}</span>
      <span className="text-[17px] leading-relaxed" style={{ color: przygaszony, maxWidth: '36ch' }}>
        {lead}
      </span>
      {foot ? (
        <span className="mt-auto pt-4 text-[15px] font-bold"
          style={{
            color: przygaszony,
            borderTop: `1px solid ${disabled ? 'var(--line)' : 'rgba(255,255,255,.3)'}`,
          }}>
          {foot}
        </span>
      ) : null}
    </button>
  )
}
