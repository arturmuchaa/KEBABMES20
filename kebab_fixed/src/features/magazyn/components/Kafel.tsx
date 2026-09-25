/**
 * Kafel czynności na ekranie startowym magazynu.
 *
 * RZECZOWNIK do rozpoznania z metra, pod nim JEDNA linia czasownikiem
 * (co się stanie po dotknięciu), a pod kreską żywy stan — liczba, którą
 * magazynier chce znać, zanim w ogóle wejdzie w czynność.
 *
 * Dlaczego nie czasownik w tytule jak w masowni: masownia ma DWA kafle
 * i operator krąży między nimi w kółko, więc zdanie na kaflu uczy. Magazyn
 * ma CZTERY roboty w czterech miejscach, a magazynier stoi już przy rampie
 * albo przy aucie — on wie, co robi. Kafel służy rozpoznaniu i stanowi.
 * (decyzja właściciela 21.09.2026)
 *
 * Kolory mają zajęte znaczenia: indygo = akcja, zieleń = na dziś komplet,
 * bursztyn = coś czeka na człowieka teraz (np. zaległe sztuki). Kafel
 * wyłączony schodzi do szarości, a nie do wyblakłego koloru — wyblakły
 * kolor czyta się jak „prawie można".
 */
export type WariantKafla = 'zwykly' | 'gotowe' | 'pilne'

/** Wiersz podglądu w środku kafla — „co tam czeka", zanim się wejdzie. */
export interface WierszPodgladu { lewo: string; prawo: string; wyrozniony?: boolean }

export function Kafel({ nazwa, czynnosc, glif, licznik, jednostka, stan, postep,
                        podglad = [], wariant = 'zwykly', disabled = false, onClick }: {
  nazwa: string
  czynnosc: string
  glif: string
  /** Główna liczba pod kreską — string, bo bywa „—" albo „12/14". */
  licznik: string
  jednostka?: string
  stan: string
  /** 0..1 — pasek postępu pod stanem; brak = bez paska. */
  postep?: number
  /** Do czterech wierszy między nagłówkiem a stanem. */
  podglad?: WierszPodgladu[]
  wariant?: WariantKafla
  disabled?: boolean
  onClick: () => void
}) {
  const tlo = disabled ? 'var(--bg)'
    : wariant === 'gotowe' ? 'var(--successSoft)'
    : wariant === 'pilne' ? 'var(--ambSoft)' : 'var(--panel)'
  const ramka = disabled ? 'var(--line)'
    : wariant === 'gotowe' ? 'var(--successLine)'
    : wariant === 'pilne' ? 'var(--ambLine)' : 'var(--line)'
  const akcent = disabled ? 'var(--mut)'
    : wariant === 'gotowe' ? 'var(--success)'
    : wariant === 'pilne' ? 'var(--amb)' : 'var(--accent)'
  const glifTlo = disabled ? 'var(--lineSoft)'
    : wariant === 'gotowe' ? '#fff'
    : wariant === 'pilne' ? '#FDF0DC' : 'var(--accentSoft)'
  const glifRamka = disabled ? 'var(--line)'
    : wariant === 'gotowe' ? 'var(--successLine)'
    : wariant === 'pilne' ? 'var(--ambLine)' : 'var(--accentLine)'

  return (
    <button type="button" onClick={disabled ? undefined : onClick}
      aria-disabled={disabled || undefined}
      data-wariant={wariant}
      className={'group flex h-full w-full flex-col items-start gap-3 rounded-2xl text-left transition '
        + (disabled ? '' : 'hover:-translate-y-0.5 active:scale-[0.99]')}
      style={{
        background: tlo, border: `1.5px solid ${ramka}`, color: 'var(--ink)',
        padding: 'clamp(18px, 2vw, 30px)', minHeight: 190,
        cursor: disabled ? 'not-allowed' : 'pointer',
        boxShadow: disabled ? 'none' : '0 1px 0 rgba(15,23,42,.04)',
      }}>
      <span className="flex w-full items-center gap-4">
        <span className="grid shrink-0 place-items-center rounded-2xl"
          style={{ width: 'clamp(52px, 4.4vw, 70px)', height: 'clamp(52px, 4.4vw, 70px)',
                   fontSize: 'clamp(26px, 2.3vw, 36px)', background: glifTlo,
                   color: akcent, border: `1.5px solid ${glifRamka}` }}>
          {glif}
        </span>
        <span className="flex min-w-0 flex-col gap-1.5">
          <span className="font-extrabold uppercase leading-none tracking-tight"
            style={{ fontSize: 'clamp(26px, 2.7vw, 44px)',
                     color: disabled ? 'var(--mut)' : 'var(--ink)' }}>{nazwa}</span>
          <span style={{ fontSize: 'clamp(14px, 1.15vw, 18px)', color: 'var(--mut)' }}>{czynnosc}</span>
        </span>
        {disabled ? null : (
          <span className="ml-auto self-start text-[26px] font-bold leading-none opacity-40 transition group-hover:translate-x-1 group-hover:opacity-100"
            style={{ color: akcent }} aria-hidden>→</span>
        )}
      </span>

      {podglad.length ? (
        <span className="mt-2 flex w-full flex-col">
          {podglad.slice(0, 4).map((w, i) => (
            <span key={i} className="flex items-baseline gap-3 py-1.5"
              style={{ borderTop: i ? '1px dashed var(--lineSoft)' : undefined }}>
              <span className="min-w-0 flex-1 truncate font-semibold"
                style={{ fontSize: 'clamp(13px, 1.1vw, 17px)',
                         color: w.wyrozniony ? 'var(--amb)' : 'var(--ink)' }}>{w.lewo}</span>
              <span className="hmi-v10-mono shrink-0 font-bold"
                style={{ fontSize: 'clamp(13px, 1.1vw, 17px)',
                         color: w.wyrozniony ? 'var(--amb)' : 'var(--mut)' }}>{w.prawo}</span>
            </span>
          ))}
        </span>
      ) : null}

      <span className="mt-auto flex w-full flex-col gap-2.5 pt-4"
        style={{ borderTop: `1px solid ${disabled ? 'var(--line)' : 'var(--lineSoft)'}` }}>
        <span className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="hmi-v10-mono font-bold leading-none"
            style={{ fontSize: 'clamp(30px, 3vw, 50px)', color: akcent }}>{licznik}</span>
          {jednostka ? (
            <span className="text-[15px] font-bold" style={{ color: 'var(--ink)' }}>{jednostka}</span>
          ) : null}
        </span>
        <span style={{ fontSize: 'clamp(13px, 1.05vw, 16px)', color: 'var(--mut)' }}>{stan}</span>
        {postep !== undefined ? (
          <span className="block h-2.5 w-full overflow-hidden rounded-full"
            style={{ background: 'var(--lineSoft)' }}>
            <span className="block h-full rounded-full transition-all"
              style={{ width: `${Math.round(Math.max(0, Math.min(1, postep)) * 100)}%`,
                       background: akcent }} />
          </span>
        ) : null}
      </span>
    </button>
  )
}
