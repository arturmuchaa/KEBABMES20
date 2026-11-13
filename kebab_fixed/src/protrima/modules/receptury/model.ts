/**
 * Receptury — czysta logika (bez Reacta).
 *
 * Port „Receptur masowania” ze starego MES, poprawiony:
 * - termin przydatności nie wraca sam do 5 dni po wyczyszczeniu pola (stary
 *   formularz tak robił, a receptury zakładu mają 364 dni),
 * - ten sam składnik dwa razy i dawka „0” to błąd przy polu, nie cichy zapis,
 * - woda nie na końcu — ostrzeżenie z jednym przyciskiem (kolejność = wydruk
 *   planu masowania, operator dodaje składniki w tej kolejności),
 * - nazwa rodzaju idzie do serwera razem z jego id (stary zapis ją kasował),
 * - przecinek dziesiętny jak w Excelu („4,5”), nie tylko kropka.
 */
import type { CreateRecipeDto, Ingredient, IngredientStock, Recipe } from '@/features/ingredients/types'
import type { RecipeUsage } from '@/lib/api'

export interface WierszSkladu { klucz: string; ingredientId: string; dawka: string }
export interface WierszKomponentu { klucz: string; materialTypeId: string; materialName: string; pct: string }

export interface Formularz {
  nazwa: string
  rodzajId: string
  termin: string
  minuty: string
  uwagi: string
  wiersze: WierszSkladu[]
  komponenty: WierszKomponentu[]
}

let licznik = 0
export const nowyKlucz = () => `w${++licznik}`
export const pustyWiersz = (): WierszSkladu => ({ klucz: nowyKlucz(), ingredientId: '', dawka: '' })

/** „4,5” → 4.5; puste albo śmieci → NaN. */
export function liczba(s: string): number {
  const t = (s ?? '').replace(/\s/g, '').replace(',', '.')
  if (!t || !/^-?\d*\.?\d*$/.test(t)) return NaN
  const v = parseFloat(t)
  return Number.isFinite(v) ? v : NaN
}

/** Liczba do pola edycji: 4.5 → „4,5”, bez ogonów zmiennoprzecinkowych. */
export const doPola = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 1000) / 1000).replace('.', ',')

const nf3 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 3 })
const nf2 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const nf1 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 })
/** Dawki z dokładnością do grama — przyprawy idą po 0,125 kg. */
export const dawka = (v: number) => nf3.format(v).replace(/\s/g, ' ')
export const kg2 = (v: number) => `${nf2.format(v).replace(/\s/g, ' ')} kg`
export const proc1 = (v: number) => `${nf1.format(v)}%`

/** Najczęstszy termin wśród receptur — podpowiedź dla nowej (w zakładzie: 364 dni). */
export function typowyTermin(lista: Recipe[]): number | null {
  const m = new Map<number, number>()
  lista.forEach(r => r.shelfLifeDays > 0 && m.set(r.shelfLifeDays, (m.get(r.shelfLifeDays) ?? 0) + 1))
  let best: number | null = null, n = 0
  m.forEach((c, d) => { if (c > n || (c === n && best != null && d > best)) { best = d; n = c } })
  return best
}

export function pustyFormularz(termin?: number | null): Formularz {
  return { nazwa: '', rodzajId: '', termin: termin ? String(termin) : '', minuty: '', uwagi: '', wiersze: [pustyWiersz()], komponenty: [] }
}

export function zReceptury(r: Recipe, kopia = false): Formularz {
  return {
    nazwa: kopia ? '' : r.name,
    rodzajId: r.productTypeId ?? '',
    termin: r.shelfLifeDays ? String(r.shelfLifeDays) : '',
    minuty: r.mixingMinutes ? String(r.mixingMinutes) : '',
    uwagi: r.notes ?? '',
    wiersze: [...r.ingredients.map(i => ({ klucz: nowyKlucz(), ingredientId: i.ingredientId, dawka: doPola(i.qtyPer100kg) })), pustyWiersz()],
    komponenty: (r.components ?? []).map(c => ({ klucz: nowyKlucz(), materialTypeId: c.materialTypeId, materialName: c.materialName, pct: doPola(c.pct) })),
  }
}

/** Wiersz, w którym operator cokolwiek wpisał. Pusty ostatni wiersz to tylko miejsce na następny składnik. */
export const wypelniony = (w: WierszSkladu) => !!w.ingredientId || w.dawka.trim() !== ''

/** Zawsze jeden pusty wiersz na końcu — jak w edytorze zamówienia: wpisujesz, nie klikasz „Dodaj”. */
export function zOgonem(wiersze: WierszSkladu[]): WierszSkladu[] {
  const bez = [...wiersze]
  while (bez.length > 1 && !wypelniony(bez[bez.length - 1]) && !wypelniony(bez[bez.length - 2])) bez.pop()
  return bez.length && !wypelniony(bez[bez.length - 1]) ? bez : [...bez, pustyWiersz()]
}

export interface BledyFormularza {
  nazwa?: string
  termin?: string
  minuty?: string
  sklad?: string
  komponenty?: string
  wiersze: Record<string, { skladnik?: string; dawka?: string }>
}

export function bledy(f: Formularz, ctx: { nazwyZajete: Set<string>; skladniki: Map<string, Ingredient> }): BledyFormularza {
  const b: BledyFormularza = { wiersze: {} }
  const nazwa = f.nazwa.trim()
  if (!nazwa) b.nazwa = 'Podaj nazwę receptury'
  else if (ctx.nazwyZajete.has(nazwa.toLocaleLowerCase('pl'))) b.nazwa = 'Receptura o tej nazwie już jest — w zamówieniach i na kartkach byłyby nie do odróżnienia'
  const t = liczba(f.termin)
  if (!f.termin.trim()) b.termin = 'Podaj termin przydatności'
  else if (!Number.isInteger(t) || t < 1 || t > 2000) b.termin = 'Termin to liczba dni, 1–2000'
  if (f.minuty.trim()) {
    const m = liczba(f.minuty)
    if (!Number.isInteger(m) || m < 1 || m > 600) b.minuty = 'Minuty 1–600 (puste = standardowe 50)'
  }
  const gdzie = new Map<string, number>()
  const pelne = f.wiersze.filter(wypelniony)
  pelne.forEach((w, i) => {
    const e: { skladnik?: string; dawka?: string } = {}
    if (!w.ingredientId) e.skladnik = 'Wybierz składnik'
    else if (gdzie.has(w.ingredientId)) e.skladnik = `Ten składnik jest już w wierszu ${gdzie.get(w.ingredientId)! + 1}`
    else gdzie.set(w.ingredientId, i)
    const d = liczba(w.dawka)
    if (!w.dawka.trim()) e.dawka = 'Podaj dawkę'
    else if (!(d > 0)) e.dawka = 'Dawka musi być większa od zera'
    else if (d > 100) e.dawka = 'Więcej niż 100 na 100 kg mięsa — sprawdź jednostkę'
    if (e.skladnik || e.dawka) b.wiersze[w.klucz] = e
  })
  if (!pelne.length) b.sklad = 'Dodaj co najmniej jeden składnik'
  const komp = f.komponenty.filter(k => k.materialTypeId || k.pct.trim())
  if (komp.length) {
    if (komp.some(k => !k.materialTypeId || !(liczba(k.pct) > 0))) b.komponenty = 'Każdy komponent potrzebuje rodzaju mięsa i udziału'
    else {
      const suma = komp.reduce((s, k) => s + liczba(k.pct), 0)
      if (Math.abs(suma - 100) > 0.5) b.komponenty = `Udziały muszą dać 100% (jest ${nf1.format(suma)}%)`
    }
  }
  return b
}

/** Pierwszy brak — do podpowiedzi przy zablokowanym „Zapisz” i do skoku kursora. */
export function pierwszyBrak(b: BledyFormularza, f: Formularz): { pole: string; tekst: string } | null {
  if (b.nazwa) return { pole: 'rc-nazwa', tekst: b.nazwa }
  if (b.termin) return { pole: 'rc-termin', tekst: b.termin }
  if (b.minuty) return { pole: 'rc-minuty', tekst: b.minuty }
  for (const w of f.wiersze) {
    const e = b.wiersze[w.klucz]
    if (e?.skladnik) return { pole: `rc-skl-${w.klucz}`, tekst: e.skladnik }
    if (e?.dawka) return { pole: `rc-dawka-${w.klucz}`, tekst: e.dawka }
  }
  if (b.sklad) return { pole: `rc-skl-${f.wiersze[0]?.klucz}`, tekst: b.sklad }
  if (b.komponenty) return { pole: 'rc-komponenty', tekst: b.komponenty }
  return null
}

/**
 * Podsumowanie jak liczy serwer przy zapisie: półprodukt = 100 kg mięsa + suma
 * dawek. Udział = ile procent półproduktu daje składnik (to widzi technolog).
 */
export function podsumowanie(dawki: Array<{ klucz: string; ilosc: number }>) {
  const suma = dawki.reduce((s, d) => s + (d.ilosc > 0 ? d.ilosc : 0), 0)
  const polprodukt = 100 + suma
  const udzialy: Record<string, number> = {}
  dawki.forEach(d => { udzialy[d.klucz] = d.ilosc > 0 ? (d.ilosc / polprodukt) * 100 : 0 })
  return { suma: Math.round(suma * 1000) / 1000, polprodukt: Math.round(polprodukt * 1000) / 1000, przyrost: suma, udzialy }
}
export const podsumowanieFormularza = (f: Formularz) =>
  podsumowanie(f.wiersze.filter(wypelniony).map(w => ({ klucz: w.klucz, ilosc: liczba(w.dawka) || 0 })))

/** Czy któryś składnik bez stanu (woda) stoi przed innymi — wtedy wydruk planu każe lać wodę za wcześnie. */
export function wodaNieNaKoncu(f: Formularz, skladniki: Map<string, Ingredient>): boolean {
  const pelne = f.wiersze.filter(w => w.ingredientId)
  const ostatniNieWoda = pelne.map(w => !skladniki.get(w.ingredientId)?.isUnlimited).lastIndexOf(true)
  return pelne.some((w, i) => skladniki.get(w.ingredientId)?.isUnlimited && i < ostatniNieWoda)
}
export function wodaNaKoniec(f: Formularz, skladniki: Map<string, Ingredient>): Formularz {
  const woda = (w: WierszSkladu) => !!w.ingredientId && !!skladniki.get(w.ingredientId)?.isUnlimited
  const pelne = f.wiersze.filter(wypelniony)
  return { ...f, wiersze: zOgonem([...pelne.filter(w => !woda(w)), ...pelne.filter(woda)]) }
}

export function przesun(f: Formularz, klucz: string, o: -1 | 1): Formularz {
  const pelne = f.wiersze.filter(wypelniony)
  const i = pelne.findIndex(w => w.klucz === klucz), j = i + o
  if (i < 0 || j < 0 || j >= pelne.length) return f
  const n = [...pelne];[n[i], n[j]] = [n[j], n[i]]
  return { ...f, wiersze: zOgonem(n) }
}

export function doDto(f: Formularz, rodzajNazwa: string): CreateRecipeDto {
  const m = liczba(f.minuty)
  return {
    name: f.nazwa.trim(),
    productTypeId: f.rodzajId || undefined,
    productTypeName: f.rodzajId ? rodzajNazwa : '',
    shelfLifeDays: liczba(f.termin),
    mixingMinutes: Number.isInteger(m) && m > 0 ? m : null,
    notes: f.uwagi.trim() || undefined,
    ingredients: f.wiersze.filter(w => w.ingredientId && liczba(w.dawka) > 0)
      .map(w => ({ ingredientId: w.ingredientId, qtyPer100kg: liczba(w.dawka) })),
    components: f.komponenty.filter(k => k.materialTypeId && liczba(k.pct) > 0)
      .map(k => ({ materialTypeId: k.materialTypeId, materialName: k.materialName, pct: liczba(k.pct) })),
  }
}

/** Porównanie bez kluczy wierszy i pustego ogona — „czy jest co tracić” przy Esc. */
export const odcisk = (f: Formularz) => JSON.stringify({
  ...f, nazwa: f.nazwa.trim(), uwagi: f.uwagi.trim(),
  wiersze: f.wiersze.filter(wypelniony).map(w => [w.ingredientId, liczba(w.dawka)]),
  komponenty: f.komponenty.map(k => [k.materialTypeId, liczba(k.pct)]),
})

// ─── Kalkulator ──────────────────────────────────────────────────────────────

export type StanSkladnika = 'ok' | 'malo' | 'brak' | 'bez-stanu' | 'nieznany'
export interface PozycjaKalkulatora { id: string; nazwa: string; jedn: string; ilosc: number; naStanie: number | null; stan: StanSkladnika }

/** Ile mięsa na żądaną masę półproduktu — biuro często myśli „potrzebuję 1200 kg kebaba”. */
export const miesoNaPolprodukt = (polproduktKg: number, wydajnosc100: number) =>
  wydajnosc100 > 0 ? (polproduktKg * 100) / wydajnosc100 : 0

export function kalkulator(r: Recipe, miesoKg: number, stany: IngredientStock[] | null): { pozycje: PozycjaKalkulatora[]; polprodukt: number; braki: number } {
  const st = new Map((stany ?? []).map(s => [s.ingredientId, s]))
  const pozycje = r.ingredients.map(i => {
    const ilosc = Math.round(i.qtyPer100kg * miesoKg * 10) / 1000
    const s = st.get(i.ingredientId)
    let stan: StanSkladnika = 'nieznany'
    if (i.isUnlimited || s?.isUnlimited) stan = 'bez-stanu'
    else if (s) stan = s.qtyAvailable <= 0 || s.qtyAvailable < ilosc ? 'brak' : s.qtyAvailable < ilosc * 1.5 ? 'malo' : 'ok'
    else if (stany) stan = 'brak'
    return { id: i.ingredientId, nazwa: i.ingredientName, jedn: i.unit, ilosc, naStanie: s && !s.isUnlimited ? s.qtyAvailable : null, stan }
  })
  return { pozycje, polprodukt: Math.round(miesoKg * r.totalOutputPer100kg * 10) / 1000, braki: pozycje.filter(p => p.stan === 'brak').length }
}

// ─── Lista ───────────────────────────────────────────────────────────────────

export type Kolumna = 'nazwa' | 'rodzaj' | 'wydajnosc' | 'termin' | 'ostatnio' | 'uzycie'
export type Sort = { kol: Kolumna; kier: 1 | -1 }

export const wUzyciu = (u?: RecipeUsage) => !!u && (u.openOrders > 0 || u.plannedMixing > 0)

export function filtruj(lista: Recipe[], q: string, rodzaj: string): Recipe[] {
  const f = q.trim().toLocaleLowerCase('pl')
  return lista.filter(r => (!rodzaj || (rodzaj === '-' ? !r.productTypeId : r.productTypeId === rodzaj))
    && (!f || `${r.name} ${r.code ?? ''} ${r.productTypeName ?? ''} ${r.ingredients.map(i => i.ingredientName).join(' ')}`.toLocaleLowerCase('pl').includes(f)))
}

export function sortuj(lista: Recipe[], s: Sort, uzycie: Map<string, RecipeUsage>, rodzajNazwa: (r: Recipe) => string): Recipe[] {
  const v = (r: Recipe): string | number => {
    const u = uzycie.get(r.id)
    switch (s.kol) {
      case 'rodzaj': return rodzajNazwa(r).toLocaleLowerCase('pl')
      case 'wydajnosc': return r.totalOutputPer100kg
      case 'termin': return r.shelfLifeDays
      case 'ostatnio': return u?.lastMixedAt ?? ''
      case 'uzycie': return (u?.openOrdersKg ?? 0) + (u?.plannedMixing ?? 0) * 1e6
      default: return r.name.toLocaleLowerCase('pl')
    }
  }
  return [...lista].sort((a, b) => {
    const x = v(a), y = v(b)
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'pl')
    return c * s.kier || a.name.localeCompare(b.name, 'pl')
  })
}

export const dataPl = (iso?: string | null) => {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** „dziś”, „wczoraj”, „5 dni temu”, potem data — do kolumny „Ostatnio masowana”. */
export function kiedy(iso: string | null | undefined, teraz = new Date()): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const dni = Math.floor((new Date(teraz.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (dni <= 0) return 'dziś'
  if (dni === 1) return 'wczoraj'
  if (dni < 30) return `${dni} dni temu`
  return dataPl(iso)
}

export const ETYKIETA_MASOWANIA: Record<string, string> = {
  planned: 'zaplanowane', confirmed: 'potwierdzone', in_progress: 'w masownicy',
}
