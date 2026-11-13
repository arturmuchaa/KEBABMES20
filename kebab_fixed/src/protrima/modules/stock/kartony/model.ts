/**
 * Kartony magazynowe — czysta logika (bez Reacta), zasady starego MES:
 * karton = jednostka pakowa BEZ zamówienia, dla jednego klienta albo „na magazyn”,
 * jednorodny albo mieszany (30×10 kg + 20×15 kg); sztuki skanuje do niego magazyn,
 * zamówienie przypina biuro później (Pokrycie → Kartony z magazynu).
 * Kartka kartonu = ten sam wydruk co kartka palety, w stopce „MAGAZYN”,
 * kod `SCARTON|<id>` (StockCartonLabelPage).
 */
import type { StockCarton, StockCartonCreateDto } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { zlozNazweWyrobu } from '@/features/wz/nazwaWyrobu'
import { buildCartonLabelContent, cartonLabelTotalKg } from '@/features/labels/cartonLabelLines'
import { num } from '@/features/orders/order-entry/model'
import type { Kartka } from '../../orders/druk/KartkiPalet'
import { naglowekWLiniach, nazwaNaKartce, type OpcjeKartki } from '../../orders/druk/nazwaKartki'

export const qrKartonu = (id: string) => `SCARTON|${id}`
export const nrKartonu = (c: Pick<StockCarton, 'cartonNo'>) => formatCartonNo(c.cartonNo) || '—'

export type StanKartonu = 'pusty' | 'pakowany' | 'spakowany'
export const STAN_KARTONU: Record<StanKartonu, string> = { pusty: 'Do zapakowania', pakowany: 'W pakowaniu', spakowany: 'Spakowany' }
export const stanKartonu = (c: Pick<StockCarton, 'packedQty' | 'targetQty'>): StanKartonu =>
  c.packedQty <= 0 ? 'pusty' : c.targetQty > 0 && c.packedQty >= c.targetQty ? 'spakowany' : 'pakowany'

const kgTxt = (v: number) => `${String(v).replace('.', ',')} kg`

/** Skład jednym ciągiem: jednorodny „KEBAB UDO 100% BEYAZ · 10 kg”, mieszany „30×10 kg + 20×15 kg”. */
export function skladKartonu(c: StockCarton): string {
  if (c.lines.length > 1) return c.lines.map(l => `${l.targetQty}×${kgTxt(l.kgPerUnit)}`).join(' + ')
  const l = c.lines[0]
  const nazwa = zlozNazweWyrobu(l?.productTypeName || c.productTypeName, l?.recipeName || c.recipeName)
  return `${nazwa} · ${kgTxt(l?.kgPerUnit ?? c.kgPerUnit)}`
}

/**
 * Kartka kartonu — receptura nazwana tak, jak nazywa ją odbiorca (kartoteka),
 * treść (nazwa klienta, receptura / rodzaj) wybierana przy druku jak przy paletach.
 * Karton bez klienta nie ma nazwy na kartce — tylko skład i „MAGAZYN”.
 */
export function kartkaKartonu(c: StockCarton, klientNa: (n: string) => string,
  recepturaNa: (k: { id?: string; name?: string }, recipeId: string | undefined, fallback: string) => string,
  opcje: OpcjeKartki = {}): Kartka {
  const items = c.lines.length
    ? c.lines.map(l => {
      const n = nazwaNaKartce(l.productTypeName ? (opcje.rodzajNa ?? (x => x))(l.productTypeName) : '',
        recepturaKartonu(c, l, recepturaNa), opcje)
      return { qty: l.targetQty, kgPerUnit: l.kgPerUnit, packagingName: l.packagingName, recipeName: n.nazwa, rodzaj: n.rodzaj, receptura: n.receptura }
    })
    // Karton bez rozpisanych pozycji nie niesie id receptury — zostaje nazwa z receptury.
    : [{ qty: c.targetQty, kgPerUnit: c.kgPerUnit, recipeName: c.recipeName, packagingName: c.packagingName, rodzaj: '', receptura: c.recipeName }]
  const { recipeHeader, lines } = buildCartonLabelContent(items)
  const szt = items.reduce((a, i) => a + i.qty, 0)
  return {
    palletNo: c.cartonNo ?? 0, qr: qrKartonu(c.id), cornerNo: nrKartonu(c),
    clientName: opcje.nazwa?.trim() || (c.clientName ? klientNa(c.clientName) : ''),
    recipeHeader, headerLines: naglowekWLiniach(recipeHeader, items.filter(i => Number(i.kgPerUnit) > 0), opcje.tryb ?? 'recipe'),
    mainLines: lines.length ? lines : [`${szt} SZT`], totalKg: cartonLabelTotalKg(items),
    orderNo: '', stopka: 'MAGAZYN',
  }
}

const recepturaKartonu = (c: StockCarton, l: StockCarton['lines'][number],
  recepturaNa: (k: { id?: string; name?: string }, recipeId: string | undefined, fallback: string) => string) =>
  (c.clientName ? recepturaNa({ id: c.clientId, name: c.clientName }, l.recipeId, l.recipeName) : l.recipeName)

/** Rodzaje i receptury kartonu (przed zamianą) — do pól zamiany przy druku. */
export function wyrobyKartonu(c: StockCarton,
  recepturaNa: (k: { id?: string; name?: string }, recipeId: string | undefined, fallback: string) => string,
  rodzajNa: (n: string) => string = n => n) {
  const rodzaje = new Set<string>(), receptury = new Set<string>()
  for (const l of c.lines) {
    if (l.productTypeName) rodzaje.add(rodzajNa(l.productTypeName))
    const r = recepturaKartonu(c, l, recepturaNa)
    if (r) receptury.add(r)
  }
  if (!c.lines.length && c.recipeName) receptury.add(c.recipeName)
  return { rodzaje: [...rodzaje].sort(), receptury: [...receptury].sort() }
}

// ─── Nowy karton ─────────────────────────────────────────────────────────
export interface PozycjaKartonu { productTypeId: string; recipeId: string; packagingId: string; kgPerUnit: string; qty: string }
export interface FormKartonu { clientId: string; pozycje: PozycjaKartonu[]; ile?: string }
/** Górna granica serii — ta sama co na serwerze. */
export const MAX_SERIA_KARTONOW = 100
/** Ile takich samych kartonów założyć; puste pole = jeden. */
export const ileKartonow = (f: FormKartonu) => (f.ile?.trim() ? Number(f.ile) : 1)
export const pustaPozycja = (): PozycjaKartonu => ({ productTypeId: '', recipeId: '', packagingId: '', kgPerUnit: '', qty: '' })

/** Pusta pozycja (nic nie wybrano, nic nie wpisano) nie jest pozycją — nie blokuje zapisu. */
export const pustaPoz = (p: PozycjaKartonu) => !p.productTypeId && !p.recipeId && !p.kgPerUnit.trim() && !p.qty.trim()

export function bledyKartonu(f: FormKartonu): Record<string, string> {
  const e: Record<string, string> = {}
  const pozycje = f.pozycje.filter(p => !pustaPoz(p))
  if (!pozycje.length) e.pozycje = 'Dodaj przynajmniej jedną pozycję kartonu.'
  if (f.ile?.trim() && (!/^\d+$/.test(f.ile.trim()) || Number(f.ile) < 1 || Number(f.ile) > MAX_SERIA_KARTONOW))
    e.ile = `Liczba kartonów: od 1 do ${MAX_SERIA_KARTONOW}.`
  f.pozycje.forEach((p, i) => {
    if (pustaPoz(p)) return
    if (!p.productTypeId) e[`p${i}`] = 'Wybierz rodzaj.'
    else if (!p.recipeId) e[`r${i}`] = 'Wybierz recepturę.'
    if (!(num(p.kgPerUnit) > 0)) e[`k${i}`] = 'Waga sztuki musi być większa od zera.'
    if (!/^\d+$/.test(p.qty.trim()) || Number(p.qty) <= 0) e[`q${i}`] = 'Sztuk: liczba całkowita większa od zera.'
  })
  return e
}

export interface SlownikiKartonu {
  clients: Array<{ id: string; name: string }>
  productTypes: Array<{ id: string; name: string }>
  recipes: Array<{ id: string; name: string }>
  packaging: Array<{ id: string; name: string }>
}

/** Formularz → DTO jak w starym oknie „Nowy karton magazynowy” (nazwy z kartotek; bez klienta = pusty id). */
export function doUtworzenia(f: FormKartonu, s: SlownikiKartonu): StockCartonCreateDto {
  const nazwa = (arr: Array<{ id: string; name: string }>, id: string) => arr.find(x => x.id === id)?.name ?? ''
  return {
    clientId: f.clientId,
    clientName: f.clientId ? nazwa(s.clients, f.clientId) : '',
    lines: f.pozycje.filter(p => !pustaPoz(p)).map(p => ({
      recipeId: p.recipeId, recipeName: nazwa(s.recipes, p.recipeId),
      productTypeId: p.productTypeId, productTypeName: nazwa(s.productTypes, p.productTypeId),
      packagingId: p.packagingId, packagingName: p.packagingId ? nazwa(s.packaging, p.packagingId) : '',
      kgPerUnit: num(p.kgPerUnit), qty: Number(p.qty),
    })),
  }
}

/** Pozycja z wolnego wyrobu na magazynie: tuleja w wierszu magazynu jest tylko nazwą — id z kartoteki opakowań. */
export function pozycjaZMagazynu(p: { productTypeId?: string; recipeId: string; packaging: string; kgPerUnit: number; qty: number },
  packaging: Array<{ id: string; name: string }>): PozycjaKartonu {
  const norm = (x: string) => x.trim().toLowerCase()
  const tuleja = p.packaging && p.packaging !== '—' ? packaging.find(x => norm(x.name) === norm(p.packaging)) : undefined
  return { productTypeId: p.productTypeId ?? '', recipeId: p.recipeId, packagingId: tuleja?.id ?? '', kgPerUnit: String(p.kgPerUnit), qty: String(p.qty) }
}
