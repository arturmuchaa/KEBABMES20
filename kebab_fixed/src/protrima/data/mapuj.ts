/**
 * Mapery: odpowiedzi API KEBABMES20 → model widoku PROTRIMA.
 *
 * Liczby postępu NIE są tu liczone od nowa: magazyn i wydania biorą
 * `naMagazynie` / `wydane` z `features/orders/lineShipping.ts`, a mięso do
 * masowania przychodzi gotowe z backendu (`line.mixing`). Produkcja
 * (`line.production.reportedQty`) to tylko diagnostyka — patrz
 * docs/ORDER_PROGRESS_POLICY.md.
 */
import type { Client as ApiClient, ClientOrder, FinishedGoodsItem, OrderLine } from '@/lib/mockApi'
import type { OrderPallet, WzDoc } from '@/lib/api'
import { naMagazynie, wydane } from '@/features/orders/lineShipping'
import type { Client, Line, Order, OrderDoc, OrderStatus, Pallet, PalletStatus } from './model'
import type { StockPos } from './stock'

/** Data z API ('2026-10-30' albo ISO z czasem) → północ czasu lokalnego. */
export function dataZApi(v?: string | null): Date | undefined {
  if (!v) return undefined
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const pl = /^(\d{2})\.(\d{2})\.(\d{4})/.exec(v)
  if (pl) return new Date(Number(pl[3]), Number(pl[2]) - 1, Number(pl[1]))
  return undefined
}

const godzina = (iso?: string | null) => {
  if (!iso) return undefined
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return undefined
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Kraj z prefiksu VAT UE w NIP-ie; polski NIP bez prefiksu = PL. Inaczej nie wiemy. */
export function krajZNip(nip?: string): string {
  const s = (nip ?? '').replace(/[\s-]/g, '').toUpperCase()
  const pre = /^([A-Z]{2})/.exec(s)
  if (pre) return pre[1]
  return /^\d{10}$/.test(s) ? 'PL' : ''
}

export function mapujKlienta(order: Pick<ClientOrder, 'clientId' | 'clientName'>, k?: ApiClient): Client {
  return {
    id: order.clientId || order.clientName,
    // Nazwa zakładowa — ta sama, którą pokazuje stary MES na liście zamówień.
    name: order.clientName || k?.displayName || k?.name || '—',
    country: krajZNip(k?.nip),
    city: k?.city ?? '',
    nip: k?.nip ?? '',
    address: [k?.address, [k?.postalCode, k?.city].filter(Boolean).join(' ')].filter(Boolean).join(', '),
    contact: k?.contactName ?? '',
    phone: k?.phone ?? '',
    terms: '',
  }
}

const STATUS_PALETY: Record<string, PalletStatus> = {
  created: 'created', packing: 'packing', packed: 'packed', cold_storage: 'cold', loaded: 'loaded',
}

export function mapujPalete(p: OrderPallet): Pallet {
  return {
    id: p.id ?? `nr-${p.palletNo}`,
    // Stały adres palety (order_id, pallet_no) — nigdy indeks na liście (niezmiennik 8).
    no: p.palletNo,
    carton: p.cartonNo ?? '',
    status: STATUS_PALETY[p.status ?? 'created'] ?? 'created',
    items: p.items.map(it => ({ lineId: it.orderLineId, qty: it.qty })),
    readyQty: p.items.reduce((a, it) => a + it.qty, 0),
    coldAt: godzina(p.coldStorageAt),
    loadedAt: godzina(p.loadedAt),
    batches: [],
  }
}

export function mapujPozycje(l: OrderLine, lp: number, planNo?: string): Line {
  return {
    id: l.id,
    lp,
    product: l.productTypeName || '—',
    recipe: l.recipeName || 'Nieznana receptura',
    recipeId: l.recipeId,
    kgPerUnit: l.kgPerUnit,
    packaging: l.packagingName ?? '',
    qty: l.qty,
    planned: planNo ? l.qty : 0,
    planNo,
    produced: l.production?.reportedQty ?? 0,
    stock: naMagazynie(l),
    delivered: wydane(l),
    unposted: l.production?.unpostedQty ?? 0,
    mixingMeatKg: l.mixing?.meatKg ?? null,
    mixingRemainingKg: l.mixing?.remainingKg ?? null,
    note: l.notes || undefined,
  }
}

const STATUS_WZ: Record<string, string> = { wstepny: 'wstępny', zatwierdzony: 'zatwierdzony', anulowany: 'anulowany' }

/** Dokumenty wydania przypięte do zamówienia (`source_type = order`). Anulowanych nie liczymy jako wystawione. */
export function dokumentyZamowienia(orderId: string, wz: WzDoc[]): OrderDoc[] {
  const moje = wz.filter(d => (d.source_type ?? d.sourceType) === 'order' && (d.source_id ?? d.sourceId) === orderId && d.status !== 'anulowany')
  if (!moje.length) return []
  return moje.map(d => ({
    id: d.id,
    kind: 'WZ',
    state: 'issued',
    number: d.number,
    date: d.issued_date ? d.issued_date.split('-').reverse().join('.') : undefined,
    note: [d.doc_series === 'WM' ? 'WM — wewnętrzny' : null, STATUS_WZ[d.status] ?? d.status, d.loading_status === 'rozjazd' ? 'rozjazd przy załadunku' : null].filter(Boolean).join(' · '),
  }))
}

export interface KontekstZamowien {
  clients: ApiClient[]
  pallets: Record<string, OrderPallet[]>
  wz: WzDoc[]
  /** id pozycji zamówienia → numer planu produkcji */
  planByLine: Record<string, string>
}

export function mapujZamowienie(o: ClientOrder, ctx: KontekstZamowien): Order {
  const k = ctx.clients.find(c => c.id === o.clientId)
  const palety = ctx.pallets[o.id]
  const order: Order = {
    id: o.id,
    no: o.orderNo,
    client: mapujKlienta(o, k),
    orderDate: dataZApi(o.orderDate) ?? dataZApi(o.createdAt) ?? new Date(0),
    delivery: dataZApi(o.deliveryDate),
    status: (o.status ?? 'draft') as OrderStatus,
    source: 'KEBABMES',
    createdBy: '',
    notes: o.notes || undefined,
    lines: o.lines.map((l, i) => mapujPozycje(l, i + 1, ctx.planByLine[l.id])),
    pallets: (palety ?? []).map(mapujPalete).sort((a, b) => a.no - b.no),
    retiredPalletNos: [],
    history: o.createdAt ? [{ at: godzina(o.createdAt) ?? '', who: '', text: 'Zamówienie utworzone', kind: 'create' }] : [],
    docs: dokumentyZamowienia(o.id, ctx.wz),
  }
  return order
}

/** Mapa id pozycji zamówienia → numer planu (z linii planów produkcji). */
export function planyPozycji(plans: Array<{ planNo: string; status?: string; lines: Array<{ clientOrderLineId?: string | null }> }>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const p of plans) {
    if (p.status === 'cancelled') continue
    for (const l of p.lines) if (l.clientOrderLineId && !out[l.clientOrderLineId]) out[l.clientOrderLineId] = p.planNo
  }
  return out
}

/**
 * Wiersz magazynu wyrobu gotowego → pozycja widoku. Tylko to, co jeszcze leży
 * (`qtyAvailable > 0`). Przydział = numer zamówienia zapisany na wierszu.
 */
export function mapujWyrob(fg: FinishedGoodsItem & { cartonNo?: string | null }, orders: Order[]): StockPos | null {
  const qty = Number(fg.qtyAvailable ?? 0)
  if (!(qty > 0)) return null
  const order = fg.clientOrderNo ? orders.find(o => o.no === fg.clientOrderNo) : undefined
  const line = order?.lines.find(l => l.recipeId === fg.recipeId && l.kgPerUnit === fg.kgPerUnit)
  return {
    id: fg.id,
    product: fg.productTypeName || '—',
    recipe: fg.recipeName || 'Nieznana receptura',
    recipeId: fg.recipeId,
    productTypeId: fg.productTypeId || undefined,
    qtyShipped: Number(fg.qtyShipped ?? 0),
    kgPerUnit: fg.kgPerUnit,
    packaging: fg.packagingName ?? '',
    batch: fg.batchNo,
    prodDate: dataZApi(fg.producedDate),
    location: 'Magazyn wyrobu',
    qty,
    orderId: order?.id,
    orderNo: fg.clientOrderNo || undefined,
    clientName: fg.clientName || undefined,
    lineId: line?.id,
    cartons: fg.cartonNo ? [fg.cartonNo] : [],
    status: 'stock',
    movements: [],
    planNo: fg.planNo || undefined,
    seasonedBatches: fg.seasonedBatchNos ?? [],
    producedBy: fg.producedBy ?? [],
  }
}
