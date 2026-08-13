/**
 * KARTA PRODUKCJI KEBAB — dane wiersz po wierszu dla wydruku kierownika.
 *
 * Odwzorowanie kartki, którą biuro wypełniało dotąd ręcznie w Excelu.
 * Rozwiązanie TYMCZASOWE: dopóki hala nie ma kiosku, kierownik dostaje
 * papier — dlatego układ i kolumny zostają jeden do jednego, a MES tylko
 * wypełnia je danymi planu.
 *
 * Czysta logika (bez DOM) — układ i CSS druku siedzą w
 * `ProductionCardPrintPage`.
 */
import type { ProductionPlan, ProductionPlanLine } from '@/lib/mockApi'

/** Puste wiersze na dopiski długopisem w trakcie zmiany. */
export const BLANK_ROWS = 5

const WEEKDAYS = [
  'NIEDZIELA', 'PONIEDZIAŁEK', 'WTOREK', 'ŚRODA',
  'CZWARTEK', 'PIĄTEK', 'SOBOTA',
]

export interface CardRow {
  blank:      boolean
  qty:        number
  kgPerUnit:  number
  kind:       string
  sleeve:     string
  client:     string
  totalKg:    number
  /** Podział na partie w zapisie z kartki ręcznej: „1x470, 19x472". */
  batches:    string
}

export interface ProductionCard {
  planNo:   string
  planDate: string
  weekday:  string
  totalKg:  number
  rows:     CardRow[]
}

const EMPTY_ROW: CardRow = {
  blank: true, qty: 0, kgPerUnit: 0, kind: '', sleeve: '',
  client: '', totalKg: 0, batches: '',
}

/**
 * Kolumna NR PARTII z `batch_allocation`.
 *
 * Jedna partia → sam numer („472"); podział → „1x470, 19x472" (zapis, którego
 * biuro używa od zawsze). Sztuka złożona z resztek ma numer łączony
 * („471/472") i wchodzi tak samo — jest jedną ze sztuk.
 */
export function formatBatchSplit(
  allocation: Record<string, any> | null | undefined,
): string {
  if (!allocation || typeof allocation !== 'object') return ''
  const parts = Object.entries(allocation)
    .map(([batchNo, a]) => ({ batchNo, pieces: Number((a as any)?.pieces ?? 0) }))
    .filter(p => p.pieces > 0)
  if (parts.length === 0) return ''
  if (parts.length === 1) return parts[0].batchNo
  return parts.map(p => `${p.pieces}x${p.batchNo}`).join(', ')
}

function lineRow(l: ProductionPlanLine): CardRow {
  const qty   = Number(l.qty) || 0
  const kgPu  = Number(l.kgPerUnit) || 0
  return {
    blank:     false,
    qty,
    kgPerUnit: kgPu,
    kind:      l.recipeName || l.productTypeName || '',
    sleeve:    l.packagingName || '',
    client:    l.clientName || '',
    totalKg:   qty * kgPu,
    batches:   formatBatchSplit((l as any).batchAllocation),
  }
}

/**
 * Wiersze karty w kolejności planowania — pozycja pod pozycją, bez pustych
 * separatorów między klientami (biuro ich nie chce: zjadały miejsce i
 * spychały kartkę na drugą stronę). Puste wiersze tylko na końcu, na dopiski.
 */
export function buildProductionCard(plan: ProductionPlan): ProductionCard {
  const lines = plan?.lines ?? []
  const rows: CardRow[] = lines.map(lineRow)

  for (let i = 0; i < BLANK_ROWS; i++) rows.push({ ...EMPTY_ROW })

  const totalKg = lines.reduce(
    (s, l) => s + (Number(l.qty) || 0) * (Number(l.kgPerUnit) || 0), 0,
  )
  const d = new Date(plan?.planDate + 'T00:00:00')
  return {
    planNo:   plan?.planNo ?? '',
    planDate: plan?.planDate ?? '',
    weekday:  Number.isFinite(d.getTime()) ? WEEKDAYS[d.getDay()] : '',
    totalKg,
    rows,
  }
}
