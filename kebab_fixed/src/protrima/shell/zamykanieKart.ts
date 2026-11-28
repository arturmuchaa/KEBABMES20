/**
 * Zamykanie kart hurtem (prawy przycisk na karcie, Ctrl+Shift+W) — czysta logika.
 * Pulpit nigdy nie znika. Karty edycji (nowe/edycja zamówienia, WZ, podział, przyjęcia,
 * papiery kursu) nie pilnują niezapisanych zmian, więc wracają osobno — App pyta o nie.
 */
import type { WTab } from './Chrome'

export type TrybZamykania = 'jedna' | 'pozostale' | 'wszystkie'

export const jestEdycja = (t: WTab) => t.kind !== 'module' && t.kind !== 'order'

export function doZamkniecia(tabs: WTab[], tryb: TrybZamykania, kartaId: string): { zwykle: string[]; edycja: WTab[] } {
  const cel = tabs.filter(t => t.id !== 'pulpit' && (
    tryb === 'jedna' ? t.id === kartaId : tryb === 'pozostale' ? t.id !== kartaId : true))
  return { zwykle: cel.filter(t => !jestEdycja(t)).map(t => t.id), edycja: cel.filter(jestEdycja) }
}

/** Karty po zamknięciu `ids`; aktywna zamknięta → pierwsza pozostała inna niż Pulpit, inaczej Pulpit. */
export function poZamknieciu(tabs: WTab[], ids: string[], active: string): { tabs: WTab[]; active: string } {
  const out = new Set(ids.filter(id => id !== 'pulpit'))
  const next = tabs.filter(t => !out.has(t.id))
  if (!out.has(active)) return { tabs: next, active }
  return { tabs: next, active: next.find(t => t.id !== 'pulpit')?.id ?? 'pulpit' }
}
