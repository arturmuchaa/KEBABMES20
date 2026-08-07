/**
 * batchOrder — własna kolejność partii na pasku HMI rozbioru.
 *
 * Pasek sortuje się FEFO (najkrótszy termin pierwszy). To dobra zasada
 * magazynowa, ale bywa sprzeczna z planem dnia: gdy na stanie są 466, 467
 * i 468, a zakład zaczyna 466 dopiero jutro, FEFO stawia ją skrajnie z lewej
 * — najbliżej ręki — i operator klika w nią przez pomyłkę.
 *
 * Hala może więc ułożyć pasek po swojemu. Kolejność jest wspólna dla całego
 * zakładu (klucz `hmi_batch_order` w app_settings), bo opisuje fakt — plan
 * dnia i ustawienie palet — a nie preferencję jednego operatora.
 *
 * WAŻNE: to zmienia WYŁĄCZNIE układ kafli. Znaczniki terminów, twarda blokada
 * partii przeterminowanej i ostrzeżenia HACCP liczą się dalej z dat.
 *
 * Bez importów z React — logika ma się dać przetestować w vitest (node, bez DOM).
 */

/** Minimum, którego potrzebuje sortowanie. RawBatch spełnia to strukturalnie. */
export interface OrderableBatch {
  internalBatchNo:   string
  expiryDate:        string
  internalBatchSeq?: number
}

/** Porządek FEFO stosowany dotąd na pasku: termin rosnąco, potem numer partii. */
function fefo(a: OrderableBatch, b: OrderableBatch): number {
  if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
  return (a.internalBatchSeq ?? 0) - (b.internalBatchSeq ?? 0)
}

/**
 * mergeBatchOrder — scala zapisaną kolejność z FEFO. Nie mutuje wejścia.
 *
 * Reguły:
 *   1. partie wskazane w `savedOrder` idą w tej kolejności,
 *   2. partie spoza konfiguracji doklejają się NA KONIEC, między sobą FEFO —
 *      dzięki temu nowa dostawa pojawia się przewidywalnie i nie rozbija
 *      ustawienia zrobionego rano,
 *   3. numery z konfiguracji nieobecne na liście są pomijane (partia zeszła
 *      albo została anulowana — konfiguracja jej nie wskrzesza).
 */
export function mergeBatchOrder<T extends OrderableBatch>(
  batches: T[], savedOrder: string[],
): T[] {
  if (savedOrder.length === 0) return [...batches].sort(fefo)

  const byNo = new Map<string, T>()
  for (const b of batches) byNo.set(b.internalBatchNo, b)

  const out: T[] = []
  const used = new Set<string>()
  for (const no of savedOrder) {
    // Set pilnuje duplikatów w konfiguracji — ta sama partia nie może
    // pojawić się na pasku dwa razy.
    if (used.has(no)) continue
    const b = byNo.get(no)
    if (!b) continue
    out.push(b)
    used.add(no)
  }

  const reszta = batches.filter(b => !used.has(b.internalBatchNo)).sort(fefo)
  return [...out, ...reszta]
}

/**
 * moveBatch — przestawia element listy z pozycji `from` na `to`.
 * Wynik nadaje się wprost do zapisania jako nowa konfiguracja kolejności.
 */
export function moveBatch<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items
  if (from < 0 || from >= items.length) return items
  const next = [...items]
  const [moved] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved)
  return next
}
