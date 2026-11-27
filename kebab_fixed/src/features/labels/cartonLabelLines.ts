/**
 * cartonLabelLines — co stoi na kartce naklejanej na paletę.
 *
 * Właściciel (2026-09-09): „jak jedna pozycja: klient, pod spodem receptura,
 * pod spodem kg, czyli np. YALCIN / KIRMIZI / 15x50kg. A dopiero wtedy, gdy
 * jest kilka pozycji, to klient, pod spodem 20x40kg beyaz afiyet — i BEZ
 * NAWIASU — i pod spodem 10x20kg kirmizi. Jeżeli tuleja niestandardowa, przed
 * recepturą tuleja". Oraz: „jak dwie te same pozycje, to też klient, receptura
 * i dwie pozycje; dopiero obok receptura, jak w jednym kartonie dwie różne
 * receptury".
 *
 * Stąd reguła: RECEPTURA JEST NAGŁÓWKIEM, dopóki jest jedna na całą kartkę —
 * wtedy pozycje to same liczby i czyta się je z największej odległości.
 * Schodzi do pozycji dopiero wtedy, gdy karton wiezie dwie różne receptury
 * i inaczej nie dałoby się poznać, która pozycja jest która.
 *
 * Kartka grupowała pozycje po SAMYCH kilogramach, więc dwie receptury o tej
 * samej wadze zlewały się w jedną linię („15 X 40KG"). Grupa to trójka
 * (receptura, kg/szt, tuleja).
 *
 * Czysty moduł: bez Reacta i bez fetch, żeby paleta zamówienia i karton
 * magazynowy opisywały się DOKŁADNIE tak samo — to jeden wydruk w dwóch
 * miejscach aplikacji.
 */
import { fmtKg } from '@/lib/utils'
import { rozmiarTulei, tulejaStandardowa } from '@/features/orders/orderLineSort'

/** Pozycja kartki — wspólny kształt dla palety zamówienia i kartonu magazynowego. */
export interface CartonLabelItem {
  qty: number
  kgPerUnit: number
  recipeName?: string | null
  packagingName?: string | null
  /** Rodzaj produktu (np. „KEBAB KIYMA") — pomaga ustawić grupę, gdy nazwa
   *  receptury jej nie mówi. Opcjonalny: bez niego liczy się receptura. */
  productTypeName?: string | null
}

/** Treść kartki: receptura jako nagłówek (gdy jedna na całą kartkę) i pozycje. */
export interface CartonLabelContent {
  /** Wspólna receptura pod nazwą klienta; `null`, gdy jest ich kilka. */
  recipeHeader: string | null
  /** Pozycje, np. ["20 X 40KG"] albo ["20 X 40KG BEYAZ AFIYET"]. */
  lines: string[]
}

/** Waga sztuki w opisie: „40KG", „8,5KG". Całkowite bez końcówki „,0". */
export function formatKgCompact(value: number) {
  return Number.isInteger(value) ? fmtKg(value, 0) : fmtKg(value, 1)
}

/** Rozmiar tulei do wypisania — tylko spoza standardu 45-65 cm, który zakład
 *  bierze na co dzień. Brak rozmiaru w nazwie (folia, karton klapowy) to nie
 *  jest „tuleja niestandardowa" do wypisania: nie ma czego dopisać. */
function dopisekTulei(packagingName: string): string {
  if (tulejaStandardowa(packagingName)) return ''
  const cm = rozmiarTulei(packagingName)
  return cm === null ? '' : `${cm}CM`
}

/**
 * Grupa rodzaju na kartce (właściciel 27.11.2026, kartka ZAGROS): „zawsze
 * kurczak na górze, potem kurczak sebzeli lub filet, potem yaprak i kiyma".
 * Zakład nie ma pola „grupa" w kartotece, więc grupę czytamy z nazw rodzaju
 * i receptury. Wszystko, co nie jest sebzeli/filetem/yaprakiem/kiymą, to kurczak.
 */
export function grupaRodzaju(nazwa: string): number {
  const n = (nazwa ?? '').toLocaleUpperCase('tr').replace(/İ/g, 'I')
  if (/K[IY]YMA|KIJMA/.test(n)) return 3
  if (/YAPRAK/.test(n)) return 2
  if (/SEBZEL|FILET/.test(n)) return 1
  return 0
}

/**
 * Treść kartki dla podanych pozycji.
 *
 * Nie rusza tablicy wejściowej.
 */
export function buildCartonLabelContent(items: CartonLabelItem[]): CartonLabelContent {
  const grupy = new Map<string, {
    kgPerUnit: number; qty: number; receptura: string; tuleja: string; rodzaj: number
  }>()
  // Kolejność receptur w grupie rodzaju = kolejność pierwszego pojawienia się
  // (paleta przychodzi już ułożona jak zamówienie, `orderLineSort`).
  const kolejnoscReceptur = new Map<string, number>()

  for (const it of items) {
    const kg = Number(it.kgPerUnit) || 0
    // Pozycja bez wagi nie da się opisać jako „N X …KG" — pomijamy zamiast
    // drukować „5 X 0KG".
    if (kg <= 0) continue
    const receptura = (it.recipeName ?? '').trim()
    const tuleja = dopisekTulei((it.packagingName ?? '').trim())
    const klucz = `${receptura}|${kg}|${tuleja}`
    if (!kolejnoscReceptur.has(receptura)) kolejnoscReceptur.set(receptura, kolejnoscReceptur.size)
    const grupa = grupy.get(klucz)
    if (grupa) grupa.qty += Number(it.qty) || 0
    else grupy.set(klucz, {
      kgPerUnit: kg, qty: Number(it.qty) || 0, receptura, tuleja,
      rodzaj: grupaRodzaju(`${it.productTypeName ?? ''} ${receptura}`),
    })
  }

  // Rodzaj, potem receptura, potem kilogramy malejąco — wcześniej same
  // kilogramy i receptury przeplatały się na kartce („misz masz", 27.11.2026).
  const pozycje = [...grupy.values()].sort((a, b) =>
    a.rodzaj - b.rodzaj
    || (kolejnoscReceptur.get(a.receptura) ?? 0) - (kolejnoscReceptur.get(b.receptura) ?? 0)
    || b.kgPerUnit - a.kgPerUnit)
  if (!pozycje.length) return { recipeHeader: null, lines: [] }

  // Nagłówek należy się tylko recepturze, która obowiązuje CAŁĄ kartkę.
  // Pozycja bez nazwy receptury go blokuje: nagłówek mówiłby wtedy o czymś,
  // czego część palety nie dotyczy.
  const receptury = new Set(pozycje.map(g => g.receptura))
  const wspolna = receptury.size === 1 && !receptury.has('')
  const recipeHeader = wspolna ? pozycje[0].receptura : null

  const lines = pozycje.map(g => {
    // Kolejność członów: kilogramy, tuleja, receptura — tuleja stoi PRZED
    // recepturą, bo opisuje opakowanie tej samej pozycji.
    const czlony = [`${g.qty} X ${formatKgCompact(g.kgPerUnit)}KG`]
    if (g.tuleja) czlony.push(g.tuleja)
    if (!wspolna && g.receptura) czlony.push(g.receptura)
    return czlony.join(' ')
  })

  return { recipeHeader, lines }
}

/** Waga netto całej kartki — suma sztuk × kg. */
export function cartonLabelTotalKg(items: CartonLabelItem[]): number {
  return items.reduce(
    (sum, it) => sum + (Number(it.qty) || 0) * (Number(it.kgPerUnit) || 0), 0)
}
