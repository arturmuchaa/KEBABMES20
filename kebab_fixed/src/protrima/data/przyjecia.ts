/**
 * Przyjęcia surowca — dokument dostawy (`/api/receptions`) → widok PROTRIMA.
 *
 * Stan dostawy NIE jest liczony od nowa: `resolveDelivery` z
 * features/raw-batches/deliveryView.ts (ćwiartka — stan w raw_batches,
 * filet i mięso z/s — w meat_stock pod numerem partii), status HACCP —
 * `checkStatus` z receptionCheck.ts, próg temperatury — `progPrzyjecia`.
 */
import { BASE } from '@/lib/api'
import { tokenStore } from '@/features/auth/storage'
import { resolveDelivery, type MeatStockMap } from '@/features/raw-batches/deliveryView'
import { batchDisplayNo } from '@/features/raw-batches/batchDisplayNo'
import { checkStatus, needsCorrectiveAction, type CheckStatus, type ReceptionCheck } from '@/features/raw-batches/receptionCheck'
import { progPrzyjecia } from '@/features/raw-batches/storageState'
import type { DeliveryStatus } from '@/lib/utils/fefo'

/**
 * GET z tokenem sesji. Mapper `receptionsApi.list` gubi pola dokumentu
 * (kg i pojemniki wg HDI, usługa), których potrzebuje porównanie z dokumentem —
 * dlatego czytamy surową odpowiedź tym samym adresem i nagłówkiem co lib/api.
 */
export async function getSurowe<T>(path: string): Promise<T> {
  const token = tokenStore.get()
  const res = await fetch(`${BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
  if (res.status === 401) { tokenStore.clear(); location.reload(); throw new Error('Sesja wygasła') }
  if (!res.ok) {
    const e = await res.json().catch(() => ({ detail: res.statusText }))
    const d = e?.detail
    throw new Error(typeof d === 'object' && d?.message ? d.message : String(d ?? `HTTP ${res.status}`))
  }
  return res.json()
}

const n = (v: unknown) => Number(v ?? 0) || 0
const s = (v: unknown) => (v == null ? '' : String(v))
const d10 = (v: unknown) => s(v).slice(0, 10)

export interface PartiaDostawcy { no: string; kg: number | null; slaughter: string; expiry: string }

export interface NumerPorzadkowy {
  id: string
  /** Numer pokazywany (dla anulowanych — pierwotny z sekwencji). */
  no: string
  internalBatchNo: string
  internalBatchSeq?: number
  materialTypeId: string
  material: string
  category: string
  storage: string
  requiresDeboning: boolean
  kgReceived: number
  kgAvailable: number
  status: string
  receivedDate: string
  slaughterDate: string
  expiryDate: string
  containers: number
  containerKg: number
  palletsH1: number
  palletsOther: number
  pricePerKg: number | null
  supplierName: string
  supplierBatchNo: string
  supplierBatches: PartiaDostawcy[]
  notes: string
  // — wyliczone —
  stan: DeliveryStatus
  kgLeft: number
  kgReserved: number
}

export interface Przyjecie {
  id: string
  no: string
  seq: number
  period: string
  date: string
  supplierId: string
  supplierName: string
  documentNo: string
  hdiNo: string
  hdiScan: string
  docKg: number | null
  docContainers: number | null
  isService: boolean
  notes: string
  createdAt: string
  numery: NumerPorzadkowy[]
  // — wyliczone —
  kgReceived: number
  kgLeft: number
  containers: number
  materials: string[]
  /** Najbliższa data przydatności wśród numerów, które jeszcze leżą. */
  nearestExpiry: string
  cancelled: boolean
  stan: 'w_obiegu' | 'rozliczona' | 'anulowana'
}

/** Materiały z /raw-batches/material-types (kategoria do progu temperatury). */
export interface Rodzaj { id: string; name: string; requiresDeboning: boolean; category: string }

export function mapujRodzaje(raw: unknown[]): Rodzaj[] {
  return (raw as Array<Record<string, unknown>>).map(r => ({
    id: s(r.id), name: s(r.name), requiresDeboning: r.requires_deboning !== false, category: s(r.category),
  }))
}

/** Loty magazynu mięsa (`/wz/stock/raw`, stock_type=meat) zsumowane po numerze partii — jak stary ekran przyjęć. */
export function mapaMiesa(rows: unknown[]): MeatStockMap {
  const map: MeatStockMap = {}
  for (const r of rows as Array<Record<string, unknown>>) {
    if (r?.stock_type !== 'meat') continue
    const no = s(r.internal_batch_no)
    if (!no) continue
    const prev = map[no]
    const kgAvailable = n(r.kg_available), kgReserved = n(r.kg_reserved), kgInitial = n(r.kg_initial ?? r.kg_available)
    map[no] = prev
      ? { kgAvailable: prev.kgAvailable + kgAvailable, kgReserved: prev.kgReserved + kgReserved, kgInitial: prev.kgInitial + kgInitial }
      : { kgAvailable, kgReserved, kgInitial }
  }
  return map
}

export function mapujPrzyjecie(r: Record<string, unknown>, rodzaje: Rodzaj[], meat: MeatStockMap): Przyjecie {
  const numery: NumerPorzadkowy[] = ((r.batches as Array<Record<string, unknown>>) ?? []).map(b => {
    const typ = rodzaje.find(t => t.id === s(b.material_type_id))
    const base = {
      id: s(b.id),
      internalBatchNo: s(b.internal_batch_no),
      internalBatchSeq: b.internal_batch_seq != null ? n(b.internal_batch_seq) : undefined,
      materialTypeId: s(b.material_type_id) || 'mat-cwiartka',
      material: s(b.material_name) || typ?.name || 'Ćwiartka z kurczaka',
      category: typ?.category ?? 'drob',
      storage: s(b.storage_state) || 'chlodzony',
      // Flaga z wiersza wygrywa; dostawy sprzed rodzajów to ćwiartka (rozbiór).
      requiresDeboning: b.requires_deboning != null ? b.requires_deboning !== false : (typ?.requiresDeboning ?? true),
      kgReceived: n(b.kg_received), kgAvailable: n(b.kg_available), status: s(b.status),
      receivedDate: d10(b.received_date), slaughterDate: d10(b.slaughter_date), expiryDate: d10(b.expiry_date),
      containers: n(b.containers_count), containerKg: n(b.container_kg), palletsH1: n(b.pallets_h1), palletsOther: n(b.pallets_other),
      pricePerKg: b.price_per_kg == null ? null : n(b.price_per_kg),
      supplierName: s(b.supplier_display_name) || s(b.supplier_name), supplierBatchNo: s(b.supplier_batch_no),
      supplierBatches: ((b.supplier_batches as Array<Record<string, unknown>>) ?? []).map(p => ({
        // kg = null dla partii odtworzonych migracją — nikt ich wtedy nie zapisywał.
        no: s(p.supplier_batch_no), kg: p.kg == null ? null : n(p.kg), slaughter: d10(p.slaughter_date), expiry: d10(p.expiry_date),
      })),
      notes: s(b.notes),
    }
    const no = batchDisplayNo(base)
    const rd = resolveDelivery(base, { requiresDeboning: base.requiresDeboning, meatStock: meat })
    return { ...base, no, stan: rd.status, kgLeft: rd.kgLeft, kgReserved: rd.kgReserved }
  })
  const zywe = numery.filter(x => x.stan === 'awaiting' || x.stan === 'in_progress')
  const cancelled = numery.length > 0 && numery.every(x => x.stan === 'cancelled')
  return {
    id: s(r.id), no: s(r.reception_no), seq: n(r.reception_seq), period: s(r.reception_period), date: d10(r.received_date),
    supplierId: s(r.supplier_id), supplierName: s(r.supplier_name), documentNo: s(r.document_no), hdiNo: s(r.hdi_no), hdiScan: s(r.hdi_scan),
    docKg: r.doc_kg == null ? null : n(r.doc_kg), docContainers: r.doc_containers == null ? null : n(r.doc_containers),
    isService: !!r.is_service, notes: s(r.notes), createdAt: s(r.created_at),
    numery,
    kgReceived: numery.filter(x => x.stan !== 'cancelled').reduce((a, x) => a + x.kgReceived, 0),
    kgLeft: zywe.reduce((a, x) => a + x.kgLeft, 0),
    containers: numery.filter(x => x.stan !== 'cancelled').reduce((a, x) => a + x.containers, 0),
    materials: [...new Set(numery.map(x => x.material))],
    nearestExpiry: zywe.map(x => x.expiryDate).filter(Boolean).sort()[0] ?? '',
    cancelled,
    stan: cancelled ? 'anulowana' : zywe.length ? 'w_obiegu' : 'rozliczona',
  }
}

/** Różnica kg przyjęte − wg dokumentu (HDI); null gdy dokument nie podaje masy. */
export const roznicaKg = (p: Przyjecie) => p.docKg == null || p.docKg <= 0 ? null : Math.round((p.kgReceived - p.docKg) * 1000) / 1000

export interface StanHaccp {
  status: CheckStatus
  check?: ReceptionCheck
  /** Temperatura mięsa lub komory ponad próg któregokolwiek numeru. */
  ponadProg: boolean
  niezgodnosc: boolean
}

/** Kontrola HACCP przyjęcia: komplet / niepełne / brak + przekroczenie progu (najostrzejszy próg z numerów). */
export function stanHaccp(p: Przyjecie, check: ReceptionCheck | undefined): StanHaccp {
  if (!check) return { status: 'brak', ponadProg: false, niezgodnosc: false }
  const max = Math.min(...p.numery.map(x => progPrzyjecia(x.category, x.storage).maxC), 99)
  const t = [check.tempMeat, check.tempChamber].filter((x): x is number => typeof x === 'number')
  return { status: checkStatus(check), check, ponadProg: t.some(x => x > max), niezgodnosc: needsCorrectiveAction(check) }
}

/** Dni od dziś do daty ISO (ujemne = po terminie). */
export function dniDo(iso: string, dzis = new Date()): number | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(dzis.getFullYear(), dzis.getMonth(), dzis.getDate()).getTime()
  return Math.round((new Date(y, m - 1, d).getTime() - t) / 86_400_000)
}
