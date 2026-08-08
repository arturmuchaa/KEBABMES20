/**
 * Potrącenia oczekujące w kontekście jednego rozliczenia.
 *
 * Reguła: do rozliczenia wchodzą TYLKO potrącenia z datą w jego zakresie.
 * Zaległe (starsze, wciąż nierozliczone) nie wchodzą po cichu, ale muszą być
 * widoczne — inaczej cicho zniknęłyby z płacy przy przesuwaniu okresu.
 */

export interface Deduction {
  id: string
  deductionDate: string
  description: string
  amount: number
  /** 'deduction' zabiera z wypłaty, 'credit' dokłada. */
  kind?: string
  sourceType: string
  sourceId: string | null
  status: string
}

export function splitDeductions(
  items: Deduction[], dateFrom: string, dateTo: string,
): { inRange: Deduction[]; overdue: Deduction[] } {
  const inRange: Deduction[] = []
  const overdue: Deduction[] = []
  for (const d of items) {
    if (d.deductionDate >= dateFrom && d.deductionDate <= dateTo) inRange.push(d)
    else if (d.deductionDate < dateFrom) overdue.push(d)
    // Data po zakresie to potrącenie przyszłe — poczeka na swoje rozliczenie.
  }
  return { inRange, overdue }
}

/**
 * Netto efekt pozycji: potrącenia na plus (będą odjęte), uznania na minus.
 * Kwoty zostają dodatnie — o kierunku decyduje `kind`.
 */
export function sumDeductions(items: Deduction[]): number {
  return items.reduce(
    (s, d) => s + (d.kind === 'credit' ? -Number(d.amount || 0) : Number(d.amount || 0)),
    0,
  )
}
