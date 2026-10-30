/**
 * Model danych demo PROTRIMA.
 *
 * Kształt odpowiada temu, co zwraca dziś KEBABMES20 (ClientOrder, OrderLine,
 * OrderPallet), ale nazwy są czytelne dla interfejsu. Zasada z
 * docs/ORDER_PROGRESS_POLICY.md jest zachowana: produkcja (zgłoszenia z tabletów),
 * pokrycie (magazyn + wydane) i wysyłka (wydane) to TRZY osobne liczby.
 */

export type OrderStatus = 'draft' | 'confirmed' | 'in_production' | 'done' | 'cancelled'
export type PalletStatus = 'created' | 'packing' | 'packed' | 'cold' | 'loaded' | 'shipped'

export interface Client {
  id: string
  name: string
  country: string
  city: string
  nip: string
  address: string
  contact: string
  phone: string
  terms: string
}

export interface Line {
  id: string
  lp: number
  product: string
  recipe: string
  kgPerUnit: number
  packaging: string
  qty: number
  /** Ilość ujęta w planach produkcji. */
  planned: number
  planNo?: string
  /** Zgłoszono z tabletów produkcyjnych — źródło diagnostyczne. */
  produced: number
  /** Leży na magazynie wyrobu gotowego i jest przydzielone tej pozycji. */
  stock: number
  /** Wyjechało do tego klienta (WZ). */
  delivered: number
  note?: string
}

export interface PalletItem { lineId: string; qty: number }

export interface Pallet {
  id: string
  /** Stały numer palety w zamówieniu (adres QR). Nigdy nie przenumerowywany. */
  no: number
  /** Globalny numer kartonu. */
  carton: string
  status: PalletStatus
  items: PalletItem[]
  readyQty: number
  packedAt?: string
  coldAt?: string
  loadedAt?: string
  by?: string
  batches: string[]
}

export type DocKind = 'ZAM' | 'KOMP' | 'PAL' | 'WZ' | 'CMR' | 'HDI'
export type DocState = 'available' | 'issued' | 'partial' | 'todo' | 'blocked' | 'not_required' | 'frozen'

export interface OrderDoc {
  kind: DocKind
  state: DocState
  number?: string
  date?: string
  by?: string
  note?: string
}

export interface HistoryEntry { at: string; who: string; text: string; kind?: 'edit' | 'scan' | 'doc' | 'prod' | 'create' }

export type ShipmentStatus = 'planned' | 'picking' | 'loading' | 'departed'

export interface Shipment {
  id: string
  no: string
  date: Date
  time: string
  vehicle: string
  plate: string
  driver: string
  carrier: string
  status: ShipmentStatus
  orderIds: string[]
  printPending?: boolean
}

export interface Order {
  id: string
  no: string
  client: Client
  orderDate: Date
  delivery?: Date
  deliveryTime?: string
  status: OrderStatus
  source: 'Ręcznie' | 'Import CSV' | 'E-mail'
  createdBy: string
  notes?: string
  lines: Line[]
  pallets: Pallet[]
  /** Numery palet usuniętych — zablokowane, nie są używane ponownie. */
  retiredPalletNos: number[]
  shipmentId?: string
  history: HistoryEntry[]
  materialIssue?: string
  docs: OrderDoc[]
}

export type Bucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'nodate' | 'closed'
export type Level = 'crit' | 'warn' | 'info'

export interface Flag {
  level: Level
  code: 'overdue' | 'risk' | 'material' | 'pallets' | 'unposted' | 'draft_old'
  label: string
  detail: string
}

export interface Metrics {
  orderedQty: number
  orderedKg: number
  producedKg: number
  stockKg: number
  deliveredKg: number
  coveredKg: number
  missingKg: number
  missingQty: number
  prodPct: number
  coverPct: number
  shipPct: number
  stockPct: number
  palletsTotal: number
  palletsReady: number
  palletsLoaded: number
  unassignedQty: number
  dueDays: number | null
  bucket: Bucket
  flags: Flag[]
  level: Level | null
  recipes: string[]
}

// ─── Daty ──────────────────────────────────────────────────────────────────
/** Demo jest zamrożone w czasie: wszystkie dane opisują ten moment. */
export const TODAY = new Date(2026, 9, 29)
export const DEMO_STAMP = '29.10.2026, 10:42'

const DAY = 86_400_000
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
export const dayDiff = (a: Date, b: Date) =>
  Math.round((new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime()
    - new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime()) / DAY)

const WD = ['nd', 'pn', 'wt', 'śr', 'cz', 'pt', 'sb']
const WD_LONG = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
const MONTHS = ['stycznia', 'lutego', 'marca', 'kwietnia', 'maja', 'czerwca', 'lipca', 'sierpnia', 'września', 'października', 'listopada', 'grudnia']

export const pad2 = (n: number) => String(n).padStart(2, '0')
export const fmtDate = (d?: Date) => d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()}` : '—'
export const fmtDay = (d?: Date) => d ? `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}` : '—'
export const weekday = (d: Date) => WD[d.getDay()]
export const longDate = (d: Date) => `${WD_LONG[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`

export function relDay(d?: Date): string {
  if (!d) return 'bez terminu'
  const n = dayDiff(d, TODAY)
  if (n === 0) return 'dziś'
  if (n === 1) return 'jutro'
  if (n === -1) return 'wczoraj'
  if (n < 0) return `${-n} dni temu`
  if (n < 7) return `${weekday(d)} ${fmtDay(d)}`
  return fmtDay(d)
}

// ─── Liczby ────────────────────────────────────────────────────────────────
const nf0 = new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 0 })
const nf1 = new Intl.NumberFormat('pl-PL', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
/** Polskie formatowanie z twardą spacją jako separatorem tysięcy (także dla 4 cyfr). */
export const num = (n: number) => {
  const s = nf0.format(Math.round(n))
  return Math.abs(n) >= 1000 && Math.abs(n) < 10000 && !/\s/.test(s)
    ? s.replace(/^(-?\d)(\d{3})$/, '$1 $2') : s.replace(/\s/g, ' ')
}
export const num1 = (n: number) => nf1.format(n)
export const kg = (n: number) => `${num(n)} kg`
export const pct = (n: number) => `${Math.round(n)}%`

// ─── Słowniki ──────────────────────────────────────────────────────────────
export const ORDER_STATUS: Record<OrderStatus, string> = {
  draft: 'Szkic',
  confirmed: 'Potwierdzone',
  in_production: 'W realizacji',
  done: 'Zrealizowane',
  cancelled: 'Anulowane',
}

export const PALLET_STATUS: Record<PalletStatus, string> = {
  created: 'Rozpisana',
  packing: 'Pakowanie',
  packed: 'Spakowana',
  cold: 'W mroźni',
  loaded: 'Załadowana',
  shipped: 'Wydana',
}
export const PALLET_FLOW: PalletStatus[] = ['created', 'packing', 'packed', 'cold', 'loaded', 'shipped']

export const DOC_NAME: Record<DocKind, string> = {
  ZAM: 'Zamówienie (wydruk)',
  KOMP: 'Lista kompletacji',
  PAL: 'Kartki palet',
  WZ: 'Wydanie zewnętrzne WZ',
  CMR: 'List przewozowy CMR',
  HDI: 'Dokument HDI',
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  overdue: 'Zaległe',
  today: 'Dziś',
  tomorrow: 'Jutro',
  week: 'Najbliższe 7 dni',
  later: 'Później',
  nodate: 'Bez terminu',
  closed: 'Zamknięte',
}

// ─── Obliczenia ────────────────────────────────────────────────────────────
export const lineKg = (l: Line) => l.qty * l.kgPerUnit
export const lineCovered = (l: Line) => Math.min(l.qty, l.stock + l.delivered)
export const lineMissing = (l: Line) => Math.max(0, l.qty - l.stock - l.delivered)
export const lineUnposted = (l: Line) => Math.max(0, l.produced - l.stock - l.delivered)

export const isClosed = (o: Order) => o.status === 'done' || o.status === 'cancelled'

export function computeMetrics(o: Order): Metrics {
  const sum = (f: (l: Line) => number) => o.lines.reduce((a, l) => a + f(l), 0)
  const orderedKg = sum(lineKg)
  const producedKg = sum(l => Math.min(l.produced, l.qty) * l.kgPerUnit)
  const stockKg = sum(l => l.stock * l.kgPerUnit)
  const deliveredKg = sum(l => l.delivered * l.kgPerUnit)
  const coveredKg = sum(l => lineCovered(l) * l.kgPerUnit)
  const missingKg = sum(l => lineMissing(l) * l.kgPerUnit)
  const missingQty = sum(lineMissing)
  const p = (v: number) => orderedKg > 0 ? (v / orderedKg) * 100 : 0

  const onPallets: Record<string, number> = {}
  o.pallets.forEach(pl => pl.items.forEach(it => { onPallets[it.lineId] = (onPallets[it.lineId] ?? 0) + it.qty }))
  const unassignedQty = o.lines.reduce((a, l) => a + Math.max(0, l.qty - (onPallets[l.id] ?? 0)), 0)

  const closed = isClosed(o)
  const dueDays = o.delivery ? dayDiff(o.delivery, TODAY) : null
  let bucket: Bucket
  if (closed) bucket = 'closed'
  else if (dueDays === null) bucket = 'nodate'
  else if (dueDays < 0) bucket = 'overdue'
  else if (dueDays === 0) bucket = 'today'
  else if (dueDays === 1) bucket = 'tomorrow'
  else if (dueDays <= 7) bucket = 'week'
  else bucket = 'later'

  const flags: Flag[] = []
  if (!closed) {
    if (dueDays !== null && dueDays < 0) {
      flags.push({
        level: 'crit', code: 'overdue', label: `Zaległe ${-dueDays} ${-dueDays === 1 ? 'dzień' : 'dni'}`,
        detail: `Termin minął ${fmtDate(o.delivery)}. ${missingKg > 0 ? `Brakuje ${kg(missingKg)} wyrobu.` : 'Wyrób kompletny — czeka na wydanie.'}`,
      })
    } else if (dueDays !== null && dueDays <= 1 && missingKg > 0 && o.status !== 'draft') {
      flags.push({
        level: dueDays === 0 ? 'crit' : 'warn', code: 'risk', label: 'Zagrożone',
        detail: `Termin ${relDay(o.delivery)}${o.deliveryTime ? ' ' + o.deliveryTime : ''}, pokrycie ${pct(p(coveredKg))}. Brakuje ${kg(missingKg)}.`,
      })
    }
    if (o.materialIssue) flags.push({ level: 'warn', code: 'material', label: 'Brak surowca', detail: o.materialIssue })
    if (dueDays !== null && dueDays >= 0 && dueDays <= 1 && unassignedQty > 0 && o.status !== 'draft') {
      flags.push({
        level: 'warn', code: 'pallets', label: 'Palety nierozpisane',
        detail: `${num(unassignedQty)} szt. bez przypisanej palety, a wysyłka ${relDay(o.delivery)}.`,
      })
    }
    const unposted = o.lines.reduce((a, l) => a + lineUnposted(l), 0)
    if (unposted > 0) {
      flags.push({
        level: 'info', code: 'unposted', label: 'Zgłoszone, nieprzyjęte',
        detail: `${num(unposted)} szt. zgłoszonych z produkcji czeka na przyjęcie na magazyn — nie zwiększają jeszcze pokrycia.`,
      })
    }
    if (o.status === 'draft') {
      const age = -dayDiff(o.orderDate, TODAY)
      if (age >= 2) flags.push({ level: 'info', code: 'draft_old', label: `Szkic od ${age} dni`, detail: 'Zamówienie nie zostało potwierdzone i nie trafia do planowania.' })
    }
  }
  const rank: Record<Level, number> = { crit: 3, warn: 2, info: 1 }
  const level = flags.reduce<Level | null>((m, f) => (!m || rank[f.level] > rank[m] ? f.level : m), null)

  return {
    orderedQty: sum(l => l.qty),
    orderedKg, producedKg, stockKg, deliveredKg, coveredKg, missingKg, missingQty,
    prodPct: p(producedKg), coverPct: p(coveredKg), shipPct: p(deliveredKg), stockPct: p(stockKg),
    palletsTotal: o.pallets.length,
    palletsReady: o.pallets.filter(pl => ['packed', 'cold', 'loaded', 'shipped'].includes(pl.status)).length,
    palletsLoaded: o.pallets.filter(pl => pl.status === 'loaded' || pl.status === 'shipped').length,
    unassignedQty,
    dueDays, bucket, flags, level,
    recipes: [...new Set(o.lines.map(l => l.recipe))],
  }
}

export const palletKg = (o: Order, pl: Pallet) =>
  pl.items.reduce((a, it) => a + it.qty * (o.lines.find(l => l.id === it.lineId)?.kgPerUnit ?? 0), 0)
export const palletQty = (pl: Pallet) => pl.items.reduce((a, it) => a + it.qty, 0)

/** Mięso na 100 kg wyrobu — do zapotrzebowania na masowanie. */
export const MEAT_PER_100: Record<string, number> = {
  KIRMIZI: 88, BEYAZ: 90, 'WROCŁAW': 85, GOLD: 87, BERLIN: 86, YAPRAK: 92,
}

/** Termin dostawy opisany słowami i datą — do nagłówków i kart. */
export function dueText(o: Pick<Order, 'delivery' | 'deliveryTime'>): string {
  if (!o.delivery) return 'bez terminu'
  const n = dayDiff(o.delivery, TODAY)
  const t = o.deliveryTime ? ` ${o.deliveryTime}` : ''
  const d = `${weekday(o.delivery)} ${fmtDay(o.delivery)}`
  if (n === 0) return `dziś, ${d}${t}`
  if (n === 1) return `jutro, ${d}${t}`
  if (n < 0) return `${d}${t} — ${-n} ${-n === 1 ? 'dzień' : 'dni'} po terminie`
  return `${d}${t}`
}
