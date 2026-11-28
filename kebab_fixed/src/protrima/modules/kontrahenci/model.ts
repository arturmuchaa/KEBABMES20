/**
 * Dział Kontrahenci (PROTRIMA, 27.11.2026) — logika bez Reacta.
 *
 * Kartoteka odbiorców i dostawców na tych samych trasach co stary MES
 * (`/api/clients`, `/api/suppliers`). Pobieranie danych: NIP → GUS/MF,
 * numer z prefiksem kraju → VIES; adres przychodzi z serwera już rozbity
 * (ulica z numerem, kod, miasto, kraj). Pobrane dane NIGDY nie nadpisują
 * po cichu tego, co biuro poprawiło — biuro zaznacza, co przejąć.
 */
import type { Client, ClientRecipeName, CreateClientDto, HdiNameMode } from '@/lib/mockApi'
import type { CreateSupplierDto, Supplier } from '@/types'
import type { NipCompany, ViesCompany } from '@/lib/api'

export type Rodzaj = 'odbiorcy' | 'dostawcy'

export interface Formularz {
  code: string
  name: string; displayName: string; nip: string; regon: string; country: string
  address: string; postalCode: string; city: string
  contactName: string; phone: string; email: string
  // odbiorca
  language: string; destName: string; destAddress: string; destCity: string
  destForHdi: boolean; destForCmr: boolean; halalSupervision: boolean; uslugi: boolean
  hdiNameMode: HdiNameMode; wzUsesHdiNames: boolean; hdiRecipeNames: ClientRecipeName[]
  // dostawca
  vetNumber: string; supplyScope: string
}

export const pustyFormularz = (): Formularz => ({
  code: '', name: '', displayName: '', nip: '', regon: '', country: '', address: '', postalCode: '', city: '',
  contactName: '', phone: '', email: '', language: '', destName: '', destAddress: '', destCity: '',
  destForHdi: true, destForCmr: true, halalSupervision: false, uslugi: false, hdiNameMode: 'type_recipe',
  wzUsesHdiNames: true, hdiRecipeNames: [], vetNumber: '', supplyScope: '',
})

const s = (v: unknown) => (v == null ? '' : String(v))

export const zKlienta = (c: Client): Formularz => ({
  ...pustyFormularz(),
  code: s(c.code), name: s(c.name), displayName: s(c.displayName), nip: s(c.nip), regon: s(c.regon), country: s(c.country),
  address: s(c.address), postalCode: s(c.postalCode), city: s(c.city).trim(), contactName: s(c.contactName), phone: s(c.phone),
  email: s(c.email), language: s(c.language), destName: s(c.destName), destAddress: s(c.destAddress), destCity: s(c.destCity),
  destForHdi: c.destForHdi ?? true, destForCmr: c.destForCmr ?? true, halalSupervision: !!c.halalSupervision, uslugi: !!c.uslugi,
  hdiNameMode: c.hdiNameMode ?? 'type_recipe', wzUsesHdiNames: c.wzUsesHdiNames ?? true, hdiRecipeNames: c.hdiRecipeNames ?? [],
})

export const zDostawcy = (d: Supplier): Formularz => ({
  ...pustyFormularz(),
  code: s(d.code), name: s(d.name), displayName: s(d.displayName), nip: s(d.nip), regon: s(d.regon), country: s(d.country),
  address: s(d.address), postalCode: s(d.postalCode), city: s(d.city), contactName: s(d.contactName), phone: s(d.phone),
  email: s(d.email), vetNumber: s(d.vetNumber), supplyScope: s(d.supplyScope),
})

/** Kraj z pola; pusty = prefiks numeru VAT (cyfry → PL). Jak `kraj_z_vat` na serwerze. */
export function krajZVat(nip: string): string {
  const c = nip.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (/^[A-Z]{2}/.test(c)) return c.slice(0, 2) === 'EL' ? 'GR' : c.slice(0, 2)
  return 'PL'
}
export const krajDlaFormularza = (f: Pick<Formularz, 'country' | 'nip'>) => f.country.trim().toUpperCase() || krajZVat(f.nip)

const PRZYC = (t: string) => t.trim()
export const doDtoKlienta = (f: Formularz): CreateClientDto => ({
  name: PRZYC(f.name), displayName: PRZYC(f.displayName), nip: PRZYC(f.nip), regon: PRZYC(f.regon), country: krajDlaFormularza(f),
  address: PRZYC(f.address), postalCode: PRZYC(f.postalCode), city: PRZYC(f.city), contactName: PRZYC(f.contactName),
  phone: PRZYC(f.phone), email: PRZYC(f.email), language: f.language, destName: PRZYC(f.destName), destAddress: PRZYC(f.destAddress),
  destCity: PRZYC(f.destCity), destForHdi: f.destForHdi, destForCmr: f.destForCmr, halalSupervision: f.halalSupervision,
  uslugi: f.uslugi, hdiNameMode: f.hdiNameMode, wzUsesHdiNames: f.wzUsesHdiNames,
  hdiRecipeNames: f.hdiRecipeNames.filter(n => n.recipeId && n.name.trim()).map(n => ({ recipeId: n.recipeId, name: n.name.trim() })),
})

export const doDtoDostawcy = (f: Formularz): CreateSupplierDto & { country: string } => ({
  code: f.code, name: PRZYC(f.name), displayName: PRZYC(f.displayName), nip: PRZYC(f.nip), regon: PRZYC(f.regon),
  vetNumber: PRZYC(f.vetNumber), address: PRZYC(f.address), postalCode: PRZYC(f.postalCode), city: PRZYC(f.city),
  contactName: PRZYC(f.contactName), phone: PRZYC(f.phone), email: PRZYC(f.email), supplyScope: PRZYC(f.supplyScope),
  country: krajDlaFormularza(f),
})

export function bledy(f: Formularz, _r: Rodzaj): Partial<Record<keyof Formularz, string>> {
  const out: Partial<Record<keyof Formularz, string>> = {}
  if (!f.name.trim()) out.name = 'Wpisz pełną nazwę firmy (jak w rejestrze)'
  if (f.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) out.email = 'To nie wygląda na adres e-mail'
  const c = f.country.trim()
  if (c && !/^[A-Za-z]{2}$/.test(c)) out.country = 'Dwie litery, np. PL, DE, AT'
  return out
}

/** Bez polskich i innych znaków diakrytycznych, małe litery. */
const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l').replace(/Ł/g, 'L').toLowerCase()

export function filtruj<T extends { name: string; displayName?: string; nip?: string; city?: string; code?: string }>(lista: T[], szukaj: string): T[] {
  const q = norm(szukaj.trim())
  if (!q) return lista
  const qCyfry = q.replace(/[\s-]/g, '')
  return lista.filter(x => {
    const tekst = norm([x.name, x.displayName, x.city, x.code].filter(Boolean).join(' '))
    const nip = norm(x.nip ?? '').replace(/[\s-]/g, '')
    return tekst.includes(q) || (qCyfry.length >= 3 && nip.includes(qCyfry))
  })
}

/** Skąd pobrać dane: 10 cyfr (opcjonalnie z PL) → GUS/MF; 2 litery + numer → VIES. */
export function zrodloDlaNumeru(wpis: string): 'gus' | 'vies' | null {
  const c = wpis.toUpperCase().replace(/[\s.-]/g, '')
  if (/^(PL)?\d{10}$/.test(c)) return 'gus'
  if (/^[A-Z]{2}[A-Z0-9]{2,}$/.test(c)) return 'vies'
  return null
}

type PolePor = 'name' | 'nip' | 'regon' | 'address' | 'postalCode' | 'city' | 'country'
const POLA: Array<{ pole: PolePor; etykieta: string }> = [
  { pole: 'name', etykieta: 'Pełna nazwa' }, { pole: 'nip', etykieta: 'NIP / VAT UE' }, { pole: 'regon', etykieta: 'REGON' },
  { pole: 'address', etykieta: 'Ulica i numer' }, { pole: 'postalCode', etykieta: 'Kod pocztowy' }, { pole: 'city', etykieta: 'Miasto' },
  { pole: 'country', etykieta: 'Kraj' },
]
export interface PolePorownania { pole: PolePor; etykieta: string; obecne: string; pobrane: string; przejmij: boolean }

/**
 * Porównanie karty z danymi z rejestru. Nowy kontrahent — zaznaczone wszystko,
 * co przyszło. Istniejący — tylko puste pola: resztę biuro mogło świadomie
 * poprawić, więc przejęcie to jego decyzja (ptaszek).
 */
export function porownanie(obecne: Partial<Formularz>, pobrane: Partial<Formularz>, nowy: boolean): PolePorownania[] {
  return POLA.flatMap(({ pole, etykieta }) => {
    const o = s(obecne[pole]).trim(), p = s(pobrane[pole]).trim()
    if (!p || o === p) return []
    return [{ pole, etykieta, obecne: o, pobrane: p, przejmij: nowy ? true : o === '' }]
  })
}

export const zastosuj = (f: Formularz, wiersze: PolePorownania[]): Formularz =>
  wiersze.reduce((acc, w) => (w.przejmij ? { ...acc, [w.pole]: w.pobrane } : acc), f)

export const pobraneZGus = (d: NipCompany): Partial<Formularz> => ({
  name: s(d.nazwa), nip: s(d.nip), regon: s(d.regon), address: s(d.ulica), postalCode: s(d.kod_pocztowy), city: s(d.miasto),
  country: s(d.kraj) || 'PL',
})
export const pobraneZVies = (d: ViesCompany): Partial<Formularz> => ({
  name: s(d.traderName), nip: s(d.vatNumber), address: s(d.ulica), postalCode: s(d.kodPocztowy), city: s(d.miasto),
  country: s(d.kraj) || s(d.countryCode),
})

const JEZYKI: Record<string, string> = { PL: 'pl', DE: 'de', AT: 'de', SK: 'sk', CZ: 'cs', SI: 'sl', FR: 'fr' }
export const jezykZKraju = (kraj: string) => JEZYKI[kraj.toUpperCase()] ?? 'en'
export const JEZYKI_HDI: Array<{ v: string; l: string }> = [
  { v: '', l: '— z kraju —' }, { v: 'pl', l: 'polski' }, { v: 'de', l: 'niemiecki' }, { v: 'sk', l: 'słowacki' },
  { v: 'cs', l: 'czeski' }, { v: 'sl', l: 'słoweński' }, { v: 'fr', l: 'francuski' }, { v: 'en', l: 'angielski' },
]

const UE = new Set(['AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'HR', 'HU', 'IE', 'IT', 'LT', 'LU',
  'LV', 'MT', 'NL', 'PT', 'RO', 'SE', 'SI', 'SK', 'XI'])
export const czyUe = (kraj: string) => UE.has(kraj.toUpperCase())

/** Data „27.11” albo „27.11.2025”, gdy nie z bieżącego roku. */
export function dataKrotka(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const dm = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return d.getFullYear() === new Date().getFullYear() ? dm : `${dm}.${d.getFullYear()}`
}
