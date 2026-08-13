/**
 * Przydział mięsa przyprawionego do pozycji planu produkcji.
 *
 * JEDNO źródło prawdy dla formularza planowania — lustro backendowego
 * `_compute_allocation` + `_check_plan_shortfalls`:
 *
 *  • Najpierw CAŁE sztuki z jednej partii — taka sztuka nosi jeden numer.
 *    Resztkę partii (poniżej masy sztuki) zużywamy od razu w sztuce
 *    dopełnionej z kolejnych partii; ta dostaje numer ŁĄCZONY ("471/472"),
 *    więc widać, z czego jest — bez zbiorczego numeru PM.
 *  • JEDEN WSPÓLNY PRZEBIEG po pozycjach — pozycja bierze z puli po kolei,
 *    dokładnie tyle, ile potrzebuje. Wcześniej każda pozycja liczyła
 *    dostępność tak, jakby wszystkie pozostałe brały przed nią, więc dwie
 *    pozycje zgłaszały ten sam brak podwójnie i niezgodnie z backendem.
 *
 * Kolejność partii w pozycji ma znaczenie (bierzemy po kolei), dlatego
 * `toggleBatchSelection` trzyma zaznaczenie w kolejności FEFO — odznaczenie
 * i ponowne zaznaczenie wraca do dokładnie tego samego stanu.
 *
 * UWAGA: `JOIN_LEFTOVER_PIECES` musi odpowiadać backendowemu
 * `MIXED_PIECE_NUMBERING` (production_plans_service.py). Gdy backend jest
 * w trybie "off", ustaw tu `false` — inaczej formularz przepuści plan,
 * który backend odrzuci.
 */

/**
 * Czy sztukę wolno złożyć z resztek kilku partii.
 *
 * WYŁĄCZONE (13.08.2026): nie ma dziś poprawnego numeru dla takiej sztuki.
 * PM odpada — księga HACCP nie zna takiego zapisu. Numer łączony „a/b" też —
 * ta forma ZNACZY JUŻ wyrób z dwóch rodzajów mięsa (udo/filet, indyk).
 * Do czasu ustalenia zapisu z HACCP resztka zostaje w partii.
 * MUSI odpowiadać backendowemu MIXED_PIECE_NUMBERING.
 */
export const JOIN_LEFTOVER_PIECES = false

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

/** Sztuka złożona z resztek kilku partii — numer łączony "471/472". */
export interface JoinedPieceTake {
  label:  string
  pieces: number
  parts:  Array<{ batchId: string; batchNo: string; kg: number }>
}

export interface LineAllocation {
  qty:            number
  neededKg:       number
  /** Wszystkie sztuki, które da się złożyć z zaznaczonych partii. */
  pieces:         number
  allocatedKg:    number
  missingPieces:  number
  missingKg:      number
  hasBatches:     boolean
  /** Czy pozycja ma pokrycie w mięsie (pozycja bez partii = jeszcze nie oceniana). */
  ok:             boolean
  /** Sztuki CAŁE — jedna partia na sztukę. */
  perBatch:       LineBatchTake[]
  /** Sztuki z resztek — numer łączony. */
  joined:         JoinedPieceTake[]
}

export interface PlanAllocation {
  lines:       LineAllocation[]
  /** Wolne kg partii PO przydziale wszystkich pozycji formularza. */
  freeByBatch: Record<string, number>
  /** kg zajęte przez pozycje formularza, per partia. */
  usedByBatch: Record<string, number>
}

const EPS = 1e-6

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
    const joinedMap = new Map<string, JoinedPieceTake>()

    if (qty <= 0 || kgPu <= 0 || ids.length === 0) {
      return {
        qty, neededKg, pieces: 0, allocatedKg: 0,
        missingPieces: 0, missingKg: 0,
        hasBatches: ids.length > 0,
        ok: true,   // nic do oceny: pozycja niekompletna albo bez partii
        perBatch, joined: [],
      }
    }

    // Pula pozycji w kolejności zaznaczenia (= FEFO). Lustro backendowego
    // _compute_allocation: całe sztuki z partii, a jej resztkę od razu
    // zużyj w sztuce dopełnionej z kolejnych partii.
    const pool = ids
      .filter(id => byId.has(id))
      .map(id => ({ id, batchNo: byId.get(id)?.batchNo ?? '' }))

    let stillPieces = qty
    for (let i = 0; i < pool.length; i++) {
      const b = pool[i]

      if (stillPieces > 0) {
        const pcs = Math.min(stillPieces, Math.floor((free[b.id] ?? 0) / kgPu))
        if (pcs > 0) {
          const kg = pcs * kgPu
          free[b.id] = (free[b.id] ?? 0) - kg
          stillPieces -= pcs
          perBatch.push({ batchId: b.id, batchNo: b.batchNo, pieces: pcs, kg })
        }
      }

      while (JOIN_LEFTOVER_PIECES && stillPieces > 0 && (free[b.id] ?? 0) > EPS) {
        let need = kgPu
        const taken: Array<{ idx: number; kg: number }> = []
        for (let j = i; j < pool.length && need > EPS; j++) {
          const take = Math.min(need, free[pool[j].id] ?? 0)
          if (take <= EPS) continue
          taken.push({ idx: j, kg: take })
          need -= take
        }
        if (need > EPS) break   // nawet z resztek nie złożymy całej sztuki

        const label = [...new Set(taken.map(t => pool[t.idx].batchNo))].join('/')
        const bucket = joinedMap.get(label)
          ?? { label, pieces: 0, parts: [] as JoinedPieceTake['parts'] }
        for (const t of taken) {
          const p = pool[t.idx]
          free[p.id] = (free[p.id] ?? 0) - t.kg
          const part = bucket.parts.find(x => x.batchId === p.id)
          if (part) part.kg += t.kg
          else bucket.parts.push({ batchId: p.id, batchNo: p.batchNo, kg: t.kg })
        }
        bucket.pieces += 1
        joinedMap.set(label, bucket)
        stillPieces -= 1
      }
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
      joined:        [...joinedMap.values()],
    }
  })

  const usedByBatch: Record<string, number> = {}
  for (const [bid, kg0] of Object.entries(free0)) {
    const used = kg0 - (free[bid] ?? 0)
    if (used > 0) usedByBatch[bid] = used
  }

  return { lines: out, freeByBatch: free, usedByBatch }
}


/**
 * Partie pozycji planu odczytane z zapisanej alokacji.
 *
 * `production_plan_lines` NIE ma kolumny `seasoned_batch_ids` — trzyma tylko
 * partię główną (`seasoned_batch_id`), numery (`seasoned_batch_nos`) i pełną
 * alokację. Formularz edycji czytał nieistniejące pole, dostawał pustą listę
 * i spadał na samą partię główną: pozycja wielopartyjna traciła resztę partii
 * i świeciła „brakuje mięsa" zaraz po kliknięciu ołówka (zgłoszenie 13.08).
 *
 * Kolejność = kolejność alokacji, czyli FEFO z planowania. Kubełek sztuki
 * z resztek trzyma partie w `parts`.
 */
export function batchIdsFromAllocation(
  allocation: Record<string, any> | null | undefined,
  orderedNos?: string[] | null,
): string[] {
  if (!allocation || typeof allocation !== 'object') return []

  const idsOfBucket = (bucket: any): string[] => {
    if (!bucket || typeof bucket !== 'object') return []
    const parts = bucket.parts
    if (parts && typeof parts === 'object') {
      return Object.values(parts as Record<string, any>)
        .map(p => (p && typeof p === 'object' ? (p as any).batch_id : null))
        .filter((x): x is string => typeof x === 'string' && !!x)
    }
    return typeof bucket.batch_id === 'string' && bucket.batch_id ? [bucket.batch_id] : []
  }

  // Kolejność partii steruje przydziałem, więc bierzemy ją z `seasoned_batch_nos`
  // (tablica Postgresa — zachowuje kolejność zapisu = FEFO z planowania).
  // Kluczy JSON użyć NIE można: JS porządkuje klucze liczbowopodobne („472")
  // przed tekstowymi („55U", „PP13"), więc kolejność zapisu ginie.
  const keys = (orderedNos ?? []).filter(n => n in allocation)
  for (const k of Object.keys(allocation)) if (!keys.includes(k)) keys.push(k)

  const out: string[] = []
  for (const k of keys) {
    for (const id of idsOfBucket(allocation[k])) {
      if (!out.includes(id)) out.push(id)
    }
  }
  return out
}
