/**
 * Nazwa wyrobu na kartce palety / kartonu — czysta logika (bez Reacta): tryb
 * (receptura / rodzaj / oba), zamiany wpisane przy druku i układ długiej nazwy.
 */
import { zlozNazweWyrobu } from '@/features/wz/nazwaWyrobu'

/** Co stoi na kartce obok liczb: sama receptura (jak dotąd), sam rodzaj albo rodzaj z recepturą. */
export type TrybNazwy = 'recipe' | 'type' | 'type_recipe'
export const TRYBY_NAZWY: Array<{ v: TrybNazwy; t: string }> = [
  { v: 'recipe', t: 'Receptura' }, { v: 'type', t: 'Rodzaj' }, { v: 'type_recipe', t: 'Rodzaj i receptura' },
]
/** Rodzaj i receptura zmienione przy druku — klucz to nazwa, która stałaby na kartce bez zmiany. */
export interface Zamiany { rodzaj: Record<string, string>; receptura: Record<string, string> }
export const BEZ_ZAMIAN: Zamiany = { rodzaj: {}, receptura: {} }
export interface OpcjeKartki {
  /** Nazwa klienta wpisana przy druku; pusta = nazwa z kartoteki. */
  nazwa?: string
  tryb?: TrybNazwy
  /** Rodzaj pod nazwą z dokumentów („KEBAB MIX” zamiast „KEBAB MIX 95/5”). */
  rodzajNa?: (productTypeName: string) => string
  zamiany?: Zamiany
}

/** Od tylu znaków nazwa „rodzaj receptura” idzie w dwóch liniach (krótka mieści się większym pismem w jednej). */
export const DLUGA_NAZWA = 16

/** Nazwa wyrobu na kartce wg trybu, po zamianach wpisanych przy druku; rodzaj i receptura też osobno. */
export function nazwaNaKartce(rodzajZ: string, recepturaZ: string, opcje: OpcjeKartki) {
  const z = opcje.zamiany ?? BEZ_ZAMIAN
  const rodzaj = (rodzajZ && z.rodzaj[rodzajZ]?.trim()) || rodzajZ
  const receptura = (recepturaZ && z.receptura[recepturaZ]?.trim()) || recepturaZ
  const tryb = opcje.tryb ?? 'recipe'
  // Bez powtórzeń: „KEBAB YAPRAK” + „YAPRAK” → „KEBAB YAPRAK” (jak HDI i WZ).
  const nazwa = tryb === 'recipe' ? receptura : tryb === 'type' ? (rodzaj || receptura) : zlozNazweWyrobu(rodzaj, receptura)
  return { nazwa, rodzaj, receptura }
}

/**
 * Nagłówek w dwóch liniach: cała kartka to jeden wyrób, tryb „Rodzaj i receptura”, nazwa długa
 * i bez powtórzeń (właściciel 07.11.2026: „rodzaj w jednej linii, pod spodem receptura”).
 */
export function naglowekWLiniach(header: string | null, wyroby: Array<{ rodzaj: string; receptura: string }>, tryb: TrybNazwy): string[] | undefined {
  if (tryb !== 'type_recipe' || !header) return undefined
  const pary = new Set(wyroby.map(w => `${w.rodzaj}\u0000${w.receptura}`))
  if (pary.size !== 1) return undefined
  const { rodzaj, receptura } = wyroby[0]
  if (!rodzaj || !receptura || header !== `${rodzaj} ${receptura}` || header.length <= DLUGA_NAZWA) return undefined
  return [rodzaj, receptura]
}

