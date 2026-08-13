/**
 * Przydział mięsa przyprawionego do pozycji planu produkcji.
 *
 * JEDNO źródło prawdy dla formularza planowania — lustro backendowego
 * `_compute_allocation` + `_check_plan_shortfalls`:
 *
 *  • JEDNA SZTUKA = JEDNA PARTIA. Sztuki mieszane (PM), składane z resztek
 *    kilku partii, są wyłączone — na magazynie przyprawionym leży mięso
 *    z gotowymi partiami i wyrób ma dostać numer jednej z nich. Resztka
 *    poniżej masy sztuki zostaje w partii (uzgadnia ją korekta przyprawionego).
 *  • JEDEN WSPÓLNY PRZEBIEG po pozycjach — pozycja bierze z puli po kolei,
 *    dokładnie tyle, ile potrzebuje. Wcześniej każda pozycja liczyła
 *    dostępność tak, jakby wszystkie pozostałe brały przed nią, więc dwie
 *    pozycje zgłaszały ten sam brak podwójnie i niezgodnie z backendem.
 *
 * Kolejność partii w pozycji ma znaczenie (bierzemy po kolei), dlatego
 * `toggleBatchSelection` trzyma zaznaczenie w kolejności FEFO — odznaczenie
 * i ponowne zaznaczenie wraca do dokładnie tego samego stanu.
 */

export interface AllocSeasonedBatch {
  id:           string
  batchNo?:     string
  kgFree?:      number
  kgAvailable?: number
}

export interface AllocPlanLine {
  qty:               string | number
  kgPerUnit:         string | number
  seasonedBatchIds?: string[]
  seasonedBatchId?:  string
}

export interface LineBatchTake {
  batchId: string
  batchNo: string
  pieces:  number
  kg:      number
}

export interface LineAllocation {
  qty:            number
  neededKg:       number
  /** Sztuki, które da się złożyć z CAŁYCH partii zaznaczonych w pozycji. */
  pieces:         number
  allocatedKg:    number
  missingPieces:  number
  missingKg:      number
  hasBatches:     boolean
  /** Czy pozycja ma pokrycie w mięsie (pozycja bez partii = jeszcze nie oceniana). */
  ok:             boolean
  perBatch:       LineBatchTake[]
}

export interface PlanAllocation {
  lines:       LineAllocation[]
  /** Wolne kg partii PO przydziale wszystkich pozycji formularza. */
  freeByBatch: Record<string, number>
  /** kg zajęte przez pozycje formularza, per partia. */
  usedByBatch: Record<string, number>
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

const batchFreeKg = (s: AllocSeasonedBatch): number =>
  Math.max(0, num(s.kgFree ?? s.kgAvailable))

/** Partie pozycji: lista ma pierwszeństwo, pojedyncza partia to zgodność wstecz. */
export function lineBatchIds(line: AllocPlanLine): string[] {
  const ids = line.seasonedBatchIds ?? []
  if (ids.length > 0) return ids
  return line.seasonedBatchId ? [line.seasonedBatchId] : []
}

/**
 * Zaznaczenie/odznaczenie partii w pozycji, trzymane w kolejności `fefoOrder`
 * (ta sama kolejność, w której partie widać na liście). Dzięki temu przydział
 * nie zależy od tego, w jakiej kolejności planista klikał.
 */
export function toggleBatchSelection(
  ids: string[] | undefined | null,
  id: string,
  fefoOrder: string[],
): string[] {
  const cur = ids ?? []
  const next = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id]
  const rank = (b: string) => {
    const i = fefoOrder.indexOf(b)
    return i === -1 ? Number.MAX_SAFE_INTEGER : i
  }
  return [...next].sort((a, b) => rank(a) - rank(b))
}

/**
 * Rozdziel mięso między pozycje formularza — jeden przebieg, po kolei.
 * Pozycja bierze z każdej swojej partii tylko CAŁE sztuki (bez PM).
 */
export function allocatePlanMeat(
  lines: AllocPlanLine[] | undefined | null,
  seasoned: AllocSeasonedBatch[] | undefined | null,
): PlanAllocation {
  const byId = new Map<string, AllocSeasonedBatch>()
  const free: Record<string, number> = {}
  for (const s of seasoned ?? []) {
    if (!s?.id) continue
    byId.set(s.id, s)
    free[s.id] = batchFreeKg(s)
  }
  const free0 = { ...free }

  const out: LineAllocation[] = (lines ?? []).map(line => {
    const qty  = Math.max(0, Math.floor(num(line.qty)))
    const kgPu = num(line.kgPerUnit)
    const ids  = lineBatchIds(line)
    const neededKg = qty * kgPu
    const perBatch: LineBatchTake[] = []

    if (qty <= 0 || kgPu <= 0 || ids.length === 0) {
      return {
        qty, neededKg, pieces: 0, allocatedKg: 0,
        missingPieces: 0, missingKg: 0,
        hasBatches: ids.length > 0,
        ok: true,   // nic do oceny: pozycja niekompletna albo bez partii
        perBatch,
      }
    }

    let stillPieces = qty
    for (const bid of ids) {
      if (stillPieces <= 0) break
      const s = byId.get(bid)
      if (!s) continue
      const pcs = Math.min(stillPieces, Math.floor((free[bid] ?? 0) / kgPu))
      if (pcs <= 0) continue
      const kg = pcs * kgPu
      free[bid] = (free[bid] ?? 0) - kg
      stillPieces -= pcs
      perBatch.push({ batchId: bid, batchNo: s.batchNo ?? '', pieces: pcs, kg })
    }

    const pieces = qty - stillPieces
    return {
      qty,
      neededKg,
      pieces,
      allocatedKg:   pieces * kgPu,
      missingPieces: stillPieces,
      missingKg:     stillPieces * kgPu,
      hasBatches:    true,
      ok:            stillPieces === 0,
      perBatch,
    }
  })

  const usedByBatch: Record<string, number> = {}
  for (const [bid, kg0] of Object.entries(free0)) {
    const used = kg0 - (free[bid] ?? 0)
    if (used > 0) usedByBatch[bid] = used
  }

  return { lines: out, freeByBatch: free, usedByBatch }
}
