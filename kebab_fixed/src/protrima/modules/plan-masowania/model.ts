/**
 * Plan masowania — czysta logika (bez Reacta).
 *
 * Port „Planowania masowania” ze starego MES. Rachunki puli mięsa, FEFO i
 * podziału na partie przy potwierdzeniu są TE SAME (wspólne biblioteki
 * `features/products/lib`) — tu dochodzi to, czego tam nie było:
 * potrzeby z zamówień liczone na żywo razem ze szkicem, podział na wsady
 * masownic, uwagi dla operatora, wpisywanie z klawiatury (zawsze jeden pusty
 * wiersz na końcu) i błędy przy polu zamiast jednego zdania pod tabelą.
 */
import type { IngredientStock, Recipe } from '@/features/ingredients/types'
import type { MixingDemandRow } from '@/lib/api'
import { liczba } from '../receptury/model'

export { liczba }

export type StatusWiersza = 'new' | 'planned' | 'confirmed' | 'in_progress' | 'done'

export interface LotPlanu {
  meatLotId: string
  kgPlanned: number
  /** Po wykonaniu kg_planned schodzi do 0, a zużyte mięso zostaje tutaj. */
  kgActual?: number
  lotNo?: string
  materialTypeId?: string
  materialName?: string
  supplierName?: string
}

export interface Wiersz {
  klucz: string
  id?: string
  recipeId: string
  kg: string
  uwagi: string
  status: StatusWiersza
  orderNo?: string
  kgDone?: number
  lots: LotPlanu[]
  /** Partie mięsa przyprawionego, które już powstały z tej pozycji. */
  partie?: Array<{ batchNo: string; kgMeat: number; kgOutput: number }>
}

export interface PartiaMiesa {
  id: string
  lotNo: string
  /** Pula dnia: wolne z API + rezerwacje wczytanego planu tego dnia. */
  kgAvailable: number
  expiryDate: string
  materialName?: string
  materialTypeId?: string
  supplierName?: string
}

let licznik = 0
export const nowyKlucz = () => `n${++licznik}`
export const pustyWiersz = (): Wiersz => ({ klucz: nowyKlucz(), recipeId: '', kg: '', uwagi: '', status: 'new', lots: [] })

const ZS = 'mat-mieso-zs'
export const toZs = (l: { materialTypeId?: string }) => (l.materialTypeId || ZS) === ZS

// ─── Dni ─────────────────────────────────────────────────────────────────────

const p2 = (n: number) => String(n).padStart(2, '0')
export const dzisIso = (teraz = new Date()) => `${teraz.getFullYear()}-${p2(teraz.getMonth() + 1)}-${p2(teraz.getDate())}`
/** Przesunięcie daty ISO o N dni — na składnikach daty lokalnej, bez strefy. */
export function przesunDzien(iso: string, dni: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return dzisIso(new Date(y, m - 1, d + dni))
}
export const dataPl = (iso?: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return y && m && d ? `${d}.${m}.${y}` : iso
}
const DNI = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
/** „dziś”, „jutro”, „wczoraj” albo dzień tygodnia — planista myśli dniami, nie datami. */
export function nazwaDnia(iso: string, dzis = dzisIso()): string {
  if (iso === dzis) return 'dziś'
  if (iso === przesunDzien(dzis, 1)) return 'jutro'
  if (iso === przesunDzien(dzis, -1)) return 'wczoraj'
  const [y, m, d] = iso.split('-').map(Number)
  return DNI[new Date(y, m - 1, d).getDay()]
}
export type RodzajDnia = 'miniony' | 'dzis' | 'przyszly'
export const rodzajDnia = (iso: string, dzis = dzisIso()): RodzajDnia => (iso < dzis ? 'miniony' : iso === dzis ? 'dzis' : 'przyszly')

// ─── Wiersze ─────────────────────────────────────────────────────────────────

export interface PozycjaSerwera {
  id: string; recipeId: string; meatKg: number; status: string; orderNo?: string; kgDone?: number; notes?: string | null
  meatLots?: Array<{ meatLotId: string; meatLotNo?: string; kgPlanned: number; kgActual?: number; materialTypeId?: string; materialName?: string; supplierName?: string }>
  sessions?: Array<{ batchNo?: string | null; kgMeat: number; kgOutput: number }>
}

export function zPlanu(items: PozycjaSerwera[]): Wiersz[] {
  return items.map(o => ({
    klucz: o.id, id: o.id, recipeId: o.recipeId, kg: String(o.meatKg).replace('.', ','), uwagi: o.notes ?? '',
    status: (['planned', 'confirmed', 'in_progress', 'done'].includes(o.status) ? o.status : 'planned') as StatusWiersza,
    orderNo: o.orderNo, kgDone: o.kgDone,
    lots: (o.meatLots ?? []).map(l => ({
      meatLotId: l.meatLotId, kgPlanned: l.kgPlanned, kgActual: l.kgActual, lotNo: l.meatLotNo,
      materialTypeId: l.materialTypeId, materialName: l.materialName, supplierName: l.supplierName,
    })),
    partie: (o.sessions ?? []).filter(s => s.batchNo).map(s => ({ batchNo: String(s.batchNo), kgMeat: s.kgMeat, kgOutput: s.kgOutput })),
  }))
}

/** Pozycja w masownicy albo gotowa — biuro zmienia już tylko kolejność. */
export const nietykalny = (w: Wiersz) => w.status === 'in_progress' || w.status === 'done'
export const wypelniony = (w: Wiersz) => !!w.id || !!w.recipeId || w.kg.trim() !== ''
export const kgWiersza = (w: Wiersz) => { const v = liczba(w.kg); return v > 0 ? v : 0 }

/** Zawsze jeden pusty wiersz na końcu — wpisujesz następną pozycję bez klikania „Dodaj”. */
export function zOgonem(wiersze: Wiersz[]): Wiersz[] {
  const n = [...wiersze]
  while (n.length > 1 && !wypelniony(n[n.length - 1]) && !wypelniony(n[n.length - 2])) n.pop()
  return n.length && !wypelniony(n[n.length - 1]) ? n : [...n, pustyWiersz()]
}

/** Kilogramy partii do pokazania: rezerwacja przed wykonaniem, zużycie po. */
export const kgPartii = (l: LotPlanu) => (l.kgPlanned || 0) || (l.kgActual || 0)
export const sumaPartii = (w: Wiersz) => w.lots.reduce((s, l) => s + kgPartii(l), 0)

export type StanPartii = 'brak' | 'czesc' | 'komplet' | 'nadmiar'
export function stanPartii(w: Wiersz): StanPartii {
  const kg = kgWiersza(w), lot = sumaPartii(w)
  if (lot > kg + 0.5) return 'nadmiar'
  if (lot <= 0.001) return 'brak'
  return lot >= kg - 0.5 ? 'komplet' : 'czesc'
}

/** Półprodukt z pozycji — jak serwer (`calc_kg_output`): mięso + składniki w kg/l i woda. */
export function polprodukt(r: Recipe | undefined, miesoKg: number): number {
  if (!r || miesoKg <= 0) return 0
  const dod = r.ingredients
    .filter(i => ['kg', 'l'].includes((i.unit || '').toLowerCase()) || i.isUnlimited)
    .reduce((s, i) => s + (i.qtyPer100kg * miesoKg) / 100, 0)
  return Math.round((miesoKg + dod) * 100) / 100
}

/**
 * Podział pozycji na wsady masownic: 600 kg (maks. 700) i 200 kg (maks. 250).
 * Resztę dolewamy do ostatniego wsadu, gdy mieści się w jego maksimum —
 * 650 kg to jeden wsad, nie 600 + 50. Podpowiedź dla planisty i na wydruk,
 * nie rozkaz: operator i tak wybiera maszynę na panelu.
 */
export function wsady(kg: number): number[] {
  if (!(kg > 0)) return []
  const out: number[] = []
  let r = Math.round(kg * 10) / 10
  while (r >= 600) { out.push(600); r = Math.round((r - 600) * 10) / 10 }
  while (r >= 200) { out.push(200); r = Math.round((r - 200) * 10) / 10 }
  if (r > 0) {
    const i200 = out.lastIndexOf(200), i600 = out.lastIndexOf(600)
    if (i200 >= 0 && r <= 50) out[i200] += r
    else if (i600 >= 0 && r <= 100 && i200 < 0) out[i600] += r
    else out.push(r)
  }
  return out
}
export function opisWsadow(kg: number): string {
  const w = wsady(kg)
  if (!w.length) return ''
  const grupy: Array<{ kg: number; n: number }> = []
  w.forEach(x => { const g = grupy.find(y => y.kg === x); if (g) g.n++; else grupy.push({ kg: x, n: 1 }) })
  return grupy.map(g => (g.n > 1 ? `${g.n}×${fmt(g.kg)}` : fmt(g.kg))).join(' + ')
}

const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** Kilogramy: całe bez przecinka, ułamki z jednym miejscem; twarda spacja w tysiącach. */
export const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.05 ? nf0 : nf1).format(v).replace(/\s/g, ' ')
export const fmt2 = (v: number) => nf2.format(v).replace(/\s/g, ' ')

// ─── Walidacja i zapis ───────────────────────────────────────────────────────

export interface BledyWiersza { receptura?: string; kg?: string; partie?: string }

export function bledy(wiersze: Wiersz[]): Record<string, BledyWiersza> {
  const out: Record<string, BledyWiersza> = {}
  wiersze.filter(wypelniony).forEach(w => {
    if (nietykalny(w)) return
    const e: BledyWiersza = {}
    if (!w.recipeId) e.receptura = 'Wybierz recepturę'
    const kg = liczba(w.kg)
    if (!w.kg.trim()) e.kg = 'Podaj kg mięsa'
    else if (!(kg > 0)) e.kg = 'Kg mięsa musi być większe od zera'
    else if (kg > 20000) e.kg = 'Ponad 20 ton w jednej pozycji — sprawdź liczbę'
    if (!e.kg && stanPartii(w) === 'nadmiar') e.partie = `Partie (${fmt(sumaPartii(w))} kg) przekraczają pozycję (${fmt(kg)} kg)`
    if (e.receptura || e.kg || e.partie) out[w.klucz] = e
  })
  return out
}
export function pierwszyBlad(wiersze: Wiersz[], b: Record<string, BledyWiersza>): { pole: string; tekst: string } | null {
  for (const w of wiersze) {
    const e = b[w.klucz]
    if (e?.receptura) return { pole: `pm-rec-${w.klucz}`, tekst: e.receptura }
    if (e?.kg) return { pole: `pm-kg-${w.klucz}`, tekst: e.kg }
    if (e?.partie) return { pole: `pm-kg-${w.klucz}`, tekst: e.partie }
  }
  return null
}

export function doZapisu(wiersze: Wiersz[]) {
  return wiersze.filter(wypelniony).map((w, i) => ({
    id: w.id, recipeId: w.recipeId, meatKg: kgWiersza(w), seq: i + 1, notes: w.uwagi.trim(),
    meatLots: w.lots.filter(l => l.kgPlanned > 0).map(l => ({ meatLotId: l.meatLotId, kgPlanned: l.kgPlanned })),
  }))
}

/** Porównanie szkicu z zapisanym planem — kolejność też jest zmianą. */
export const odcisk = (wiersze: Wiersz[]) => JSON.stringify(
  wiersze.filter(wypelniony).map(w => [w.id ?? w.klucz, w.recipeId, kgWiersza(w), w.uwagi.trim(),
    w.lots.filter(l => l.kgPlanned > 0).map(l => [l.meatLotId, l.kgPlanned])]))

export function przesun(wiersze: Wiersz[], klucz: string, o: -1 | 1): Wiersz[] {
  const pelne = wiersze.filter(wypelniony)
  const i = pelne.findIndex(w => w.klucz === klucz), j = i + o
  if (i < 0 || j < 0 || j >= pelne.length) return wiersze
  const n = [...pelne];[n[i], n[j]] = [n[j], n[i]]
  return zOgonem(n)
}

// ─── Podsumowania ────────────────────────────────────────────────────────────

export interface Przyprawa { ingredientId: string; nazwa: string; jedn: string; potrzeba: number; stan: number | null; bezStanu: boolean; brak: number }

/** Przyprawy na cały plan w kolejności receptur (tak jak operator je dodaje), ze stanem magazynu. */
export function przyprawyPlanu(wiersze: Wiersz[], receptury: Map<string, Recipe>, stany: IngredientStock[] | null, tylkoNiewykonane = true): Przyprawa[] {
  const st = new Map((stany ?? []).map(s => [s.ingredientId, s]))
  const acc = new Map<string, Przyprawa>()
  wiersze.forEach(w => {
    if (tylkoNiewykonane && w.status === 'done') return
    const kg = Math.max(0, kgWiersza(w) - (tylkoNiewykonane ? w.kgDone ?? 0 : 0)), r = receptury.get(w.recipeId)
    if (!r || kg <= 0) return
    r.ingredients.forEach(i => {
      const s = st.get(i.ingredientId)
      const bez = !!i.isUnlimited || !!s?.isUnlimited
      const cur = acc.get(i.ingredientId) ?? { ingredientId: i.ingredientId, nazwa: i.ingredientName, jedn: i.unit, potrzeba: 0, stan: bez ? null : s ? s.qtyAvailable : stany ? 0 : null, bezStanu: bez, brak: 0 }
      cur.potrzeba += (i.qtyPer100kg * kg) / 100
      acc.set(i.ingredientId, cur)
    })
  })
  return [...acc.values()].map(p => ({ ...p, potrzeba: Math.round(p.potrzeba * 1000) / 1000, brak: p.bezStanu || p.stan == null ? 0 : Math.max(0, Math.round((p.potrzeba - p.stan) * 1000) / 1000) }))
}

export interface Bilans { miesoKg: number; polproduktKg: number; pulaZs: number; potrzebaZs: number; zostanieZs: number; bezPartiiKg: number; pozycji: number }

export function bilans(wiersze: Wiersz[], receptury: Map<string, Recipe>, partie: PartiaMiesa[]): Bilans {
  const pelne = wiersze.filter(wypelniony)
  const otwarte = pelne.filter(w => w.status !== 'done')
  const miesoKg = pelne.reduce((s, w) => s + kgWiersza(w), 0)
  const polproduktKg = pelne.reduce((s, w) => s + polprodukt(receptury.get(w.recipeId), kgWiersza(w)), 0)
  const inne = new Set(partie.filter(p => !toZs(p)).map(p => p.id))
  const pulaZs = partie.filter(toZs).reduce((s, p) => s + p.kgAvailable, 0)
  // Kilogramy bez przypisanej partii liczą się do zapotrzebowania na z/s — tak rozdziela je FEFO.
  const naInne = otwarte.reduce((s, w) => s + w.lots.filter(l => inne.has(l.meatLotId)).reduce((a, l) => a + (l.kgPlanned || 0), 0), 0)
  // Pozycja w masownicy: zmasowana część zeszła już z magazynu, pula potrzebuje tylko reszty.
  const potrzebaOtwartych = otwarte.reduce((s, w) => s + Math.max(0, kgWiersza(w) - (w.kgDone ?? 0)), 0)
  const potrzebaZs = Math.max(0, potrzebaOtwartych - naInne)
  const bezPartiiKg = otwarte.filter(w => !nietykalny(w)).reduce((s, w) => s + Math.max(0, kgWiersza(w) - sumaPartii(w)), 0)
  return { miesoKg, polproduktKg, pulaZs, potrzebaZs, zostanieZs: pulaZs - potrzebaZs, bezPartiiKg, pozycji: pelne.length }
}

// ─── Potrzeby z zamówień ─────────────────────────────────────────────────────

export interface Potrzeba extends MixingDemandRow {
  /** Półprodukt ze szkicu planu tego dnia (zamiast zapisanego stanu z serwera). */
  wSzkicuKg: number
  /** Brak półproduktu po uwzględnieniu szkicu — schodzi na żywo przy dodawaniu pozycji. */
  brakKg: number
  /** Ile mięsa dodać do planu: brak przeliczony na mięso i zaokrąglony w górę do pełnych wsadów 200 kg. */
  proponowaneMiesoKg: number
}

export function potrzebyNaZywo(wiersze: Wiersz[], dane: MixingDemandRow[], receptury: Map<string, Recipe>): Potrzeba[] {
  return dane.map(d => {
    const r = receptury.get(d.recipeId)
    // Szkic: niewykonana część pozycji tego dnia (wykonana jest już półproduktem na stanie).
    const wSzkicuKg = wiersze.filter(w => w.recipeId === d.recipeId && w.status !== 'done')
      .reduce((s, w) => s + polprodukt(r, Math.max(0, kgWiersza(w) - (w.kgDone ?? 0))), 0)
    const inneDni = Math.max(0, d.plannedMixingKg - d.plannedMixingThisDayKg)
    const brakKg = Math.max(0, Math.round((d.orderedKg - d.seasonedFreeKg - d.productionPlanKg - inneDni - wSzkicuKg) * 10) / 10)
    const na100 = polprodukt(r, 100) || 100
    const mieso = brakKg > 0 ? (brakKg * 100) / na100 : 0
    return { ...d, wSzkicuKg: Math.round(wSzkicuKg * 10) / 10, brakKg, proponowaneMiesoKg: mieso > 0 ? Math.ceil(mieso / 200 - 1e-9) * 200 : 0 }
  })
}

export const ETYKIETA_STATUSU: Record<StatusWiersza, string> = {
  new: 'Niezapisana', planned: 'W kolejce', confirmed: 'W kolejce', in_progress: 'W masownicy', done: 'Gotowe',
}
