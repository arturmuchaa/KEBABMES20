/**
 * Plan produkcji w PROTRIMA — czyste funkcje (bez Reacta), testowane w node.
 *
 * Plan dnia układa się z KONKRETNYCH palet z chłodni (paleta = partia na hali,
 * spec 2026-11-26-plan-produkcji-partie-design.md). Liczba sztuk z palety =
 * kg zważone po masowaniu / kg sztuki, w dół; reszta to przewidywana końcówka.
 * Leżakowania nie liczymy jako warunku (właściciel 27.11.2026) — tylko licznik
 * „leży N h” od zważenia, a podpowiedź bierze najpierw palety leżące najdłużej.
 */
import type { CreateProductionPlanDto, PlanSummary, SeasonedPallet } from '@/lib/api'

export type Paleta = SeasonedPallet

export interface Pozycja {
  /** Klucz wiersza w edytorze (stały przez edycję). */
  klucz: string
  /** Id pozycji na serwerze (edycja zapisanego planu). */
  id?: string
  qty: number
  kgPerUnit: number
  recipeId: string
  productTypeId: string
  packagingId?: string
  klient?: string
  zamowienieId?: string
  zamowienieNo?: string
  zamowienieLiniaId?: string
  /** Id palet w kolejności użycia. */
  palety: string[]
  /** Pozycja z końcówek kilku partii (sztuki PM). */
  zKoncowek: boolean
}

/** Składnik kebaba mix (udo/filet 70/30…); pusta lista = kebab z jednego mięsa. */
export interface Skladnik { materialTypeId: string; nazwa: string; pct: number }

const EPS = 1e-6

export function sztukZPalety(kg: number, kgSztuki: number): number {
  if (!(kgSztuki > 0) || !(kg > 0)) return 0
  return Math.floor(kg / kgSztuki + EPS)
}

/** Ile kg zostanie z palet pozycji po zrobieniu `qty` sztuk (informacyjnie). */
export function prognozaKoncowki(palety: Paleta[], qty: number, kgSztuki: number): number {
  const suma = palety.reduce((s, p) => s + p.kgWeighed, 0)
  return Math.max(0, Math.round((suma - qty * kgSztuki) * 10) / 10)
}

export function sumaKoncowek(palety: Paleta[]): { kg: number; sztuk: (kgSztuki: number) => number } {
  const kg = Math.round(palety.reduce((s, p) => s + p.kgWeighed, 0) * 1000) / 1000
  return { kg, sztuk: (kgSztuki: number) => sztukZPalety(kg, kgSztuki) }
}

/** Pełne godziny od zważenia palety po masowaniu (tylko informacja). */
export function lezyGodzin(p: Paleta, teraz: Date): number {
  const t = Date.parse(p.mixedAt ?? '')
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((teraz.getTime() - t) / 3_600_000))
}

/** Kolejność podpowiedzi: końcówki najpierw, potem palety leżące najdłużej. */
export function kolejnoscPalet(a: Paleta, b: Paleta): number {
  if (a.isRemainder !== b.isRemainder) return a.isRemainder ? -1 : 1
  const ta = Date.parse(a.mixedAt ?? '') || 0
  const tb = Date.parse(b.mixedAt ?? '') || 0
  if (ta !== tb) return ta - tb
  return (a.palletNo ?? 0) - (b.palletNo ?? 0)
}

/** Kg sztuki przypadające na składnik (cała sztuka, gdy kebab z jednego mięsa). */
const kgNaSkladnik = (kgSztuki: number, s?: Skladnik) => (s ? (kgSztuki * s.pct) / 100 : kgSztuki)

function pasuje(p: Paleta, poz: Pozycja, s?: Skladnik): boolean {
  if (p.status !== 'in_cold' || p.recipeId !== poz.recipeId) return false
  return !s || (p.materialTypeId ?? '') === s.materialTypeId
}

/**
 * Palety dla pozycji: dla każdego składnika (albo całej sztuki) palety tej
 * receptury w chłodni, w kolejności `kolejnoscPalet`, aż pokryją `qty` sztuk.
 * `zajete` — kg danej palety już przypisane innym pozycjom tego planu.
 */
export function podpowiedzPalet(poz: Pozycja, sklad: Skladnik[], palety: Paleta[], zajete: Map<string, number>): string[] {
  const grupy: Array<Skladnik | undefined> = sklad.length ? sklad : [undefined]
  const wynik: string[] = []
  for (const s of grupy) {
    const kgSzt = kgNaSkladnik(poz.kgPerUnit, s)
    let brakuje = poz.qty
    for (const p of palety.filter(x => pasuje(x, poz, s)).sort(kolejnoscPalet)) {
      if (brakuje <= 0) break
      const wolne = p.kgWeighed - (zajete.get(p.id) ?? 0)
      const szt = sztukZPalety(wolne, kgSzt)
      if (szt <= 0) continue
      wynik.push(p.id)
      brakuje -= szt
    }
  }
  return wynik
}

/** Co nie gra w pozycji — słowami biura. Pusta lista = można zapisać. */
export function bledyPozycji(poz: Pozycja, sklad: Skladnik[], palety: Map<string, Paleta>): string[] {
  if (!poz.palety.length) return ['Wybierz palety']
  const bledy: string[] = []
  const wybrane: Paleta[] = []
  for (const id of poz.palety) {
    const p = palety.get(id)
    if (!p) { bledy.push('Wybrana paleta nie leży już w chłodni — odśwież listę palet'); continue }
    if (p.status !== 'in_cold') bledy.push(`Paleta ${p.palletNo} nie leży w chłodni`)
    if (p.recipeId !== poz.recipeId) bledy.push(`Paleta ${p.palletNo} to ${p.recipeName || 'inna receptura'}`)
    wybrane.push(p)
  }
  if (sklad.length) {
    for (const s of sklad) {
      const swoje = wybrane.filter(p => (p.materialTypeId ?? '') === s.materialTypeId)
      if (!swoje.length) { bledy.push(`Brak palety z mięsem ${s.nazwa}`); continue }
      const kgSzt = kgNaSkladnik(poz.kgPerUnit, s)
      const n = swoje.reduce((acc, p) => acc + sztukZPalety(p.kgWeighed, kgSzt), 0)
      if (n < poz.qty) bledy.push(`${s.nazwa}: palety dają ${n} szt., a pozycja ma ${poz.qty}`)
    }
    return bledy
  }
  const n = poz.zKoncowek
    ? sumaKoncowek(wybrane).sztuk(poz.kgPerUnit)
    : wybrane.reduce((acc, p) => acc + sztukZPalety(p.kgWeighed, poz.kgPerUnit), 0)
  if (n < poz.qty) bledy.push(`Palety dają ${n} szt., a pozycja ma ${poz.qty}`)
  return bledy
}

export function doDto(pozycje: Pozycja[], dzien: string): CreateProductionPlanDto {
  return {
    planDate: dzien,
    palletGate: true,
    lines: pozycje.filter(p => p.qty > 0 && p.kgPerUnit > 0 && p.recipeId).map(p => ({
      id: p.id || undefined,
      qty: p.qty,
      kgPerUnit: p.kgPerUnit,
      productTypeId: p.productTypeId,
      recipeId: p.recipeId,
      packagingId: p.packagingId || undefined,
      clientOrderId: p.zamowienieId || undefined,
      clientOrderNo: p.zamowienieNo || undefined,
      clientOrderLineId: p.zamowienieLiniaId || undefined,
      clientName: p.klient || undefined,
      palletIds: [...p.palety],
      fromRemainders: p.zKoncowek,
    })),
  }
}

export type StanPlanu = 'szkic' | 'do-druku' | 'gotowy' | 'w-produkcji' | 'do-bilansu' | 'zamkniety'

export const ETYKIETA_STANU: Record<StanPlanu, string> = {
  'szkic': 'Szkic',
  'do-druku': 'Etykiety do druku',
  'gotowy': 'Gotowy dla hali',
  'w-produkcji': 'W produkcji',
  'do-bilansu': 'Bez bilansu',
  'zamkniety': 'Zamknięty',
}

export function stanPlanu(plan: { status: string; summary: PlanSummary | null }): StanPlanu {
  const s = plan.summary
  if (plan.status === 'draft') return 'szkic'
  if (plan.status === 'active') {
    if (!s || s.units === 0 || s.labelsPrinted < s.units) return 'do-druku'
    return s.palletsTaken > 0 ? 'w-produkcji' : 'gotowy'
  }
  if (plan.status === 'done' && s && s.pallets > 0 && !s.balanceReady) return 'do-bilansu'
  return 'zamkniety'
}
