/**
 * receptionCheck — kontrola HACCP dostawy, kolumny f-k karty 1.1.1.
 *
 * Czysta logika, zero React i zero fetch: te same reguły obowiązują
 * w formularzu biura i (docelowo) na kiosku przy rampie, więc nie mogą
 * mieszkać w komponencie.
 *
 * Progi temperatur pochodzą z `progPrzyjecia` — jedno miejsce na tę
 * decyzję w całej aplikacji, bo wisi na niej też magazyn i etykieta.
 */
import { progPrzyjecia } from './storageState'

export interface ReceptionCheck {
  receptionId:    string
  /** kol. f — ocena wizualna dostawy i książka mycia pojazdu. */
  visual:         'bz' | 'N' | null
  /** kol. g/h — NAJWYŻSZY zmierzony odczyt (instrukcja 1.1). */
  tempChamber:    number | null
  tempMeat:       number | null
  /** kol. i — zgodność kg z zamówieniem i dokumentami. */
  kgMatch:        'bz' | 'N' | null
  notes:          string          // kol. j
  /** kol. k — 'K' dostawa przyjęta, 'N' odmowa przyjęcia. */
  verdict:        'K' | 'N' | null
  ncDescription:  string
  ncAction:       string
  ncAt:           string | null
}

export type CheckStatus = 'brak' | 'niepelne' | 'komplet'

/** Pola, bez których wiersz karty 1.1.1 ma dziurę. */
const WYMAGANE = ['visual', 'tempChamber', 'tempMeat', 'kgMatch', 'verdict'] as const

/** Wypełnione = różne od null i od pustego napisu. Zero °C JEST pomiarem —
 *  `!value` wywaliłoby poprawny odczyt z komory na granicy. */
const wypelnione = (v: unknown) => v !== null && v !== undefined && v !== ''

export function checkStatus(c: ReceptionCheck): CheckStatus {
  const ile = WYMAGANE.filter(k => wypelnione(c[k])).length
  if (ile === 0) return 'brak'
  return ile === WYMAGANE.length ? 'komplet' : 'niepelne'
}

export function tempExceeded(
  temp: number | null | undefined,
  category: string | null | undefined,
  state: string | null | undefined,
): boolean {
  if (temp === null || temp === undefined) return false
  return temp > progPrzyjecia(category, state).maxC
}

/** Jakiekolwiek „N" wymaga opisania, co z tym zrobiono — inaczej karta
 *  pokazuje niezgodność bez wyjaśnienia i audytor pyta o nią pierwszą. */
export function needsCorrectiveAction(c: ReceptionCheck): boolean {
  return c.visual === 'N' || c.kgMatch === 'N' || c.verdict === 'N'
}

export function checkIssues(
  c: ReceptionCheck,
  category: string | null | undefined,
  state: string | null | undefined,
): string[] {
  const out: string[] = []
  const prog = progPrzyjecia(category, state)
  if (tempExceeded(c.tempChamber, category, state)) {
    out.push(`Temperatura komory ${c.tempChamber} °C przekracza próg ${prog.opis}`)
  }
  if (tempExceeded(c.tempMeat, category, state)) {
    out.push(`Temperatura mięsa ${c.tempMeat} °C przekracza próg ${prog.opis}`)
  }
  if (needsCorrectiveAction(c) && !c.ncAction.trim()) {
    out.push('Niezgodność bez opisu — uzupełnij działanie korygujące')
  }
  return out
}
