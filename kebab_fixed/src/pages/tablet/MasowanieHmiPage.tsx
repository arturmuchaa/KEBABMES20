/**
 * MasowanieHmiPage — stanowisko masowni hali.
 *
 * Układ 1:1 z prototypu 0.9: szyna masownic u góry, kolejka dnia i pojemniki
 * z przyprawami po lewej, panel roboczy po prawej. Dwa tory pracy, bo maszyna
 * chodzi 50 minut: PRZYGOTOWANIE (przyprawy do ponumerowanego pojemnika,
 * bez maszyny i bez wody) i ZAŁADUNEK (maszyna + pojemnik + mięso + woda).
 *
 * Wygląd bierze wspólny motyw hali (`hmi-theme`), rama kiosku jest ta sama,
 * co w rozbiorze i produkcji.
 */
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'

export function MasowanieHmiPage() {
  return (
    <div data-testid="masowanie-hmi"
      style={{ ...HMI_VARS, fontFamily: HMI_FONT, height: '100%', background: 'var(--bg)' }} />
  )
}
