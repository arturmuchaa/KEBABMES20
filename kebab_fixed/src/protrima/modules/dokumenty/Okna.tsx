import type { Dok, Dzialanie } from './model'

export type Okno = { co: Exclude<Dzialanie, 'dopisz'>; dok: Dok }

/** Okna działań — zadanie 4 planu. */
export function OknoDzialania(_: { okno: Okno; onClose: () => void; onZmiana: () => void }) {
  return null
}
