/**
 * Palety zamówienia — czysta logika zapisu i rozpisu (bez Reacta).
 *
 * Zapis idzie przez orderPalletsApi.save (PUT całej listy) — serwer uzgadnia
 * palety po TOŻSAMOŚCI (id + numer), nigdy po indeksie (niezmiennik 8,
 * incydent YALCIN 09.10.2026). Stąd zasady:
 *  - zawsze budujemy listę ze ŚWIEŻEGO stanu z serwera, nie z widoku;
 *  - istniejące palety wysyłamy z id i numerem, nowe z numerem 0 (numer i karton nada serwer);
 *  - w jednym zapisie albo dodajemy, albo usuwamy (serwer odrzuca oba naraz);
 *  - paleta po pakowaniu / ze skanami jest nietykalna (serwer odmawia — tu też blokujemy);
 *  - suma na paletach nie przekracza ilości pozycji (strażnik rozpis_palet_limit).
 */
import type { OrderPallet } from '@/lib/api'
import { profilZakladu } from '../../../zaklad/zaklad'

export interface PozycjaLite { id: string; lp: number; recipe: string; recipeId: string; kgPerUnit: number; qty: number; product?: string; packaging?: string }
export interface ItemLite { lineId: string; qty: number }

/** Paleta, której zawartość wolno zmienić lub ją usunąć (status „rozpisana”). Skany sprawdza jeszcze serwer. */
export const edytowalna = (p: Pick<OrderPallet, 'status'>) => (p.status ?? 'created') === 'created'

/** Ile sztuk pozycji zostało do rozpisania (opcjonalnie bez jednej palety — przy jej edycji). */
export function pozostalo(lines: PozycjaLite[], pallets: OrderPallet[], pomijajPaleteId?: string): Record<string, number> {
  const na: Record<string, number> = {}
  for (const p of pallets) {
    if (pomijajPaleteId && p.id === pomijajPaleteId) continue
    for (const it of p.items) na[it.orderLineId] = (na[it.orderLineId] ?? 0) + it.qty
  }
  return Object.fromEntries(lines.map(l => [l.id, Math.max(0, l.qty - (na[l.id] ?? 0))]))
}

/** Błędy pozycji palety: liczba całkowita > 0 i nie więcej niż zostało. */
export function bledyPalety(items: ItemLite[], wolne: Record<string, number>): Record<string, string> {
  const e: Record<string, string> = {}
  for (const it of items) {
    if (!Number.isInteger(it.qty) || it.qty <= 0) e[it.lineId] = 'Wpisz liczbę całkowitą sztuk większą od zera.'
    else if (it.qty > (wolne[it.lineId] ?? 0)) e[it.lineId] = `Zostało do rozpisania ${wolne[it.lineId] ?? 0} szt.`
  }
  return e
}

const doApi = (items: ItemLite[]) => items.filter(i => i.qty > 0).map(i => ({ orderLineId: i.lineId, qty: i.qty }))
const zachowaj = (p: OrderPallet): OrderPallet => ({ ...p, items: p.items.map(i => ({ orderLineId: i.orderLineId, qty: i.qty })) })

/** Lista do zapisu: świeże palety + nowe (numer 0 = nada serwer). */
export function zDodanymi(fresh: OrderPallet[], nowe: Array<{ items: ItemLite[]; notes?: string }>): OrderPallet[] {
  return [...fresh.map(zachowaj), ...nowe.map(n => ({ palletNo: 0, notes: n.notes ?? '', items: doApi(n.items) }))]
}
/** Lista do zapisu: zmieniona zawartość jednej palety (id i numer bez zmian). */
export function zZmieniona(fresh: OrderPallet[], id: string, items: ItemLite[], notes?: string): OrderPallet[] {
  if (!fresh.some(p => p.id === id)) throw new Error('Paleta została usunięta lub przeniesiona — odśwież rozpis.')
  return fresh.map(p => p.id === id ? { ...zachowaj(p), notes: notes ?? p.notes, items: doApi(items) } : zachowaj(p))
}
/** Lista do zapisu: bez wskazanej palety. */
export function bezPalety(fresh: OrderPallet[], id: string): OrderPallet[] {
  return fresh.filter(p => p.id !== id).map(zachowaj)
}

export interface PlanPalety { items: ItemLite[]; kg: number; szt: number; mieszana: boolean }

/**
 * Standard pakowania ZAKŁADU (sztuk na paletę wg wagi sztuki, warianty, granica
 * palety z resztek) — z profilu zakładu (`zaklad/zaklad.ts`), nie z kodu modułu:
 * inny zakład pakuje inaczej.
 */
const PAK = profilZakladu().pakowanie
export const STANDARD_SZTUK = PAK.sztukNaPalete
export const WARIANTY_SZTUK = PAK.warianty
export const MAX_KG_RESZTKI = PAK.maxKgResztki

/** Sztuk na pełną paletę: nadpisanie z okna → standard biura → ok. 900 kg dla nietypowej wagi. */
export function sztukNaPalete(kgPerUnit: number, nadpisz?: Record<string, number>): number {
  const n = nadpisz?.[String(kgPerUnit)] ?? STANDARD_SZTUK[kgPerUnit]
  return n && n > 0 ? Math.floor(n) : Math.max(1, Math.floor(PAK.kgPaletyNietypowej / kgPerUnit))
}

type Kosz = { items: ItemLite[]; kg: number; szt: number; k1: string; k2: string; k1s: Set<string> }

/**
 * Rozpis automatyczny pozostałych sztuk — tak, jak pakuje biuro:
 *  1. pełne palety jednej pozycji wg standardu sztuk (60×12, 40×20, 15×60…);
 *  2. resztki: najpierw razem ta sama receptura + rodzaj + tuleja,
 *  3. potem ta sama receptura + rodzaj (inna tuleja/waga),
 *  4. na końcu — jeśli `mieszane` — różne receptury, gdy inaczej zostałyby małe palety.
 * Paleta z resztek nie przekracza `maxKg`; sztuka nigdy nie jest dzielona.
 */
export function rozpisz(lines: PozycjaLite[], wolne: Record<string, number>, opts: { nadpisz?: Record<string, number>; maxKg?: number; mieszane?: boolean } = {}): PlanPalety[] {
  const maxKg = opts.maxKg ?? MAX_KG_RESZTKI
  const pozycje = [...lines].sort((a, b) => a.lp - b.lp).filter(l => (wolne[l.id] ?? 0) > 0 && l.kgPerUnit > 0)
  const pelne: PlanPalety[] = []
  const resztki: Array<{ l: PozycjaLite; qty: number }> = []
  for (const l of pozycje) {
    const n = sztukNaPalete(l.kgPerUnit, opts.nadpisz)
    let rest = wolne[l.id]
    while (rest >= n) { pelne.push({ items: [{ lineId: l.id, qty: n }], szt: n, kg: r3(n * l.kgPerUnit), mieszana: false }); rest -= n }
    if (rest > 0) resztki.push({ l, qty: rest })
  }
  // Poziom 1: resztki tej samej receptury, rodzaju i tulei — dokładamy do kosza, dzieląc pozycję między kosze.
  const k1 = (l: PozycjaLite) => `${l.recipeId}|${l.product ?? ''}|${l.packaging ?? ''}`
  const k2 = (l: PozycjaLite) => `${l.recipeId}|${l.product ?? ''}`
  const kosze: Kosz[] = []
  for (const { l, qty } of resztki) {
    let rest = qty
    while (rest > 0) {
      let kosz = kosze.find(k => k.k1 === k1(l) && k.kg + l.kgPerUnit <= maxKg + 1e-9)
      if (!kosz) { kosz = { items: [], kg: 0, szt: 0, k1: k1(l), k2: k2(l), k1s: new Set([k1(l)]) }; kosze.push(kosz) }
      const ile = Math.max(1, Math.min(rest, Math.floor((maxKg - kosz.kg + 1e-9) / l.kgPerUnit)))
      const it = kosz.items.find(i => i.lineId === l.id)
      if (it) it.qty += ile; else kosz.items.push({ lineId: l.id, qty: ile })
      kosz.kg = r3(kosz.kg + ile * l.kgPerUnit); kosz.szt += ile; rest -= ile
    }
  }
  // Poziom 2 i 3: łączymy CAŁE kosze (najcięższe najpierw), jeśli razem mieszczą się w limicie.
  const scal = (lista: Kosz[], zgodne: (a: Kosz, b: Kosz) => boolean): Kosz[] => {
    const out: Kosz[] = []
    for (const k of [...lista].sort((a, b) => b.kg - a.kg)) {
      const cel = out.find(o => zgodne(o, k) && o.kg + k.kg <= maxKg + 1e-9)
      if (!cel) { out.push({ ...k, items: [...k.items], k1s: new Set(k.k1s) }); continue }
      for (const it of k.items) { const t = cel.items.find(i => i.lineId === it.lineId); if (t) t.qty += it.qty; else cel.items.push({ ...it }) }
      cel.kg = r3(cel.kg + k.kg); cel.szt += k.szt; k.k1s.forEach(x => cel.k1s.add(x)); if (cel.k2 !== k.k2) cel.k2 = '*'
    }
    return out
  }
  let wynik = scal(kosze, (a, b) => a.k2 === b.k2 && a.k2 !== '*')
  if (opts.mieszane ?? true) wynik = scal(wynik, () => true)
  const recOf = (lineId: string) => pozycje.find(l => l.id === lineId)?.recipeId
  // Palety z resztek w kolejności pozycji zamówienia (jak czyta je biuro), nie wg masy.
  const poz = (lineId: string) => pozycje.findIndex(l => l.id === lineId)
  wynik.sort((a, b) => Math.min(...a.items.map(i => poz(i.lineId))) - Math.min(...b.items.map(i => poz(i.lineId))))
  return [...pelne, ...wynik.map(k => ({
    items: [...k.items].sort((a, b) => (pozycje.findIndex(l => l.id === a.lineId)) - (pozycje.findIndex(l => l.id === b.lineId))),
    kg: k.kg, szt: k.szt, mieszana: new Set(k.items.map(i => recOf(i.lineId))).size > 1,
  }))]
}
const r3 = (x: number) => Math.round(x * 1000) / 1000

/**
 * Wariant sztuk na paletę dla wag pakowanych na dwa sposoby (25 kg: 35/30, 35 kg: 25/20) —
 * „system ma sam wykryć” (właściciel, 30.10.2026):
 *  1. palety tego zamówienia już rozpisane jedną pozycją tej wagi w liczbie równej wariantowi → ten wariant;
 *  2. inaczej wariant, który dzieli łączną ilość tej wagi w zamówieniu bez reszty (jeden taki);
 *  3. inaczej standard (pierwszy wariant).
 */
export function wykryjSztuki(lines: PozycjaLite[], pallets: Array<{ items: ItemLite[] }>): Record<string, number> {
  const out: Record<string, number> = {}
  for (const [wStr, war] of Object.entries(WARIANTY_SZTUK)) {
    const w = Number(wStr)
    const ids = new Set(lines.filter(l => l.kgPerUnit === w).map(l => l.id))
    if (!ids.size) continue
    const zPalet = pallets.filter(p => p.items.length === 1 && ids.has(p.items[0].lineId)).map(p => p.items[0].qty)
    const trafione = war.filter(n => zPalet.includes(n))
    if (trafione.length) {
      // Częściej występujący na paletach wygrywa.
      out[wStr] = [...trafione].sort((a, b) => zPalet.filter(x => x === b).length - zPalet.filter(x => x === a).length)[0]
      continue
    }
    const razem = lines.filter(l => ids.has(l.id)).reduce((a, l) => a + l.qty, 0)
    const dzielace = war.filter(n => razem % n === 0)
    out[wStr] = dzielace.length === 1 ? dzielace[0] : war[0]
  }
  return out
}
