/**
 * ProductionHmiPage — stanowisko produkcyjne hali.
 *
 * Na razie zaślepka: rama kiosku (splash → PIN → ten ekran) musi dać się
 * zbudować i zainstalować, zanim powstanie treść. Kolejne zadania planu
 * wypełnią ją listą planu dnia, licznikiem sztuk, przerwą i statystykami.
 */
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'

export function ProductionHmiPage() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4"
      style={{ ...HMI_VARS, background: 'var(--bg)', color: 'var(--ink)', fontFamily: HMI_FONT }}>
      <div className="text-[13px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.3em' }}>Produkcja</div>
      <h1 className="font-extrabold text-4xl" style={{ letterSpacing: '-.01em' }}>Plan dnia</h1>
      <p className="text-base" style={{ color: 'var(--mut)' }}>Ekran w budowie.</p>
    </div>
  )
}
