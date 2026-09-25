/**
 * Typy wspólne dla kiosku magazynu.
 *
 * Nazwy ekranów żyją TUTAJ, a nie w stringach rozrzuconych po komponentach —
 * literówka w nazwie ekranu daje pusty panel bez żadnego błędu, a to na hali
 * wygląda jak awaria MES.
 */

/** Ekrany kiosku. PRZYJĘCIE dochodzi w kolejnym plastrze. */
export type EkranMagazynu =
  | 'kafle'
  | 'kartony'
  | 'kartony-praca'
  | 'wydanie-auta'
  | 'wydanie-praca'
  | 'mroznia'

/** Błąd pokazywany na CAŁYM ekranie.
 *
 *  Pełny ekran, a nie pasek: magazynier nie patrzy na ekran — panel milczy,
 *  gdy jest dobrze, a podnosi wzrok dopiero po dźwięku. Kiedy spojrzy,
 *  komunikat ma być nie do przeoczenia. */
export interface StanAlarmu {
  /** Który skaner — 'L' albo 'P'. Dopóki nie ma mostu dwóch skanerów, zawsze 'L'. */
  skaner: 'L' | 'P'
  /** Wielki napis, czytelny z trzech metrów. */
  naglowek: string
  /** Jedno zdanie kontekstu. */
  szczegol: string
  /** Opcjonalna podpowiedź „gdzie to należy" — błąd ma instruować. */
  gdzie?: string
  /** 'blad' = czerwony, 'uwaga' = bursztynowy (przeszło, ale sprawdź). */
  ton: 'blad' | 'uwaga'
  /** Znacznik czasu — wymusza ponowne pokazanie tego samego komunikatu. */
  ts: number
}

export type PokazAlarm = (a: Omit<StanAlarmu, 'ts'>) => void
