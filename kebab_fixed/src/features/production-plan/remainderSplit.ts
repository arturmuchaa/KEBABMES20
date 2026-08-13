/**
 * Rozdzielenie zadeklarowanej POZOSTAŁOŚCI mięsa przyprawionego na partie.
 *
 * Na koniec dnia operator widzi „zostało trochę KIRMIZI, trochę BEYAZ" —
 * nie rozdziela resztek w chłodni na partie. Pyta się go więc o JEDNĄ liczbę
 * per receptura, a przypisanie do partii robi system.
 *
 * Reguła: mięso schodzi FEFO (najstarsze partie pierwsze), więc to, co
 * zostało, pochodzi z NAJMŁODSZYCH partii. Wypełniamy od końca: najmłodsza
 * partia zatrzymuje resztę, starsze schodzą do zera i zostają zamknięte.
 * Różnica na każdej partii to realny ubytek (masowanie, podłoga, ścinki).
 */

export interface RemainderBatch {
  id:         string
  batchNo:    string
  /** Stan wyliczony z receptury — punkt wyjścia, nie pomiar. */
  theoryKg:   number
  /** Kolejność FEFO: rosnąco = najstarsza pierwsza. */
  expiryDate?: string
}

export interface RemainderAssignment {
  id:       string
  batchNo:  string
  theoryKg: number
  /** Ile ma zostać na tej partii po rozliczeniu. */
  targetKg: number
  /** 0 kg = partia wyczerpana, zamykamy ją. */
  close:    boolean
}

const n = (v: unknown): number => {
  const x = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(x) ? x : 0
}

/** FEFO: najstarsza (najkrótsza ważność) pierwsza; przy remisie po numerze. */
function fefo(a: RemainderBatch, b: RemainderBatch): number {
  const ea = a.expiryDate || '9999-12-31'
  const eb = b.expiryDate || '9999-12-31'
  if (ea !== eb) return ea < eb ? -1 : 1
  return (a.batchNo || '').localeCompare(b.batchNo || '')
}

/**
 * @param batches partie tej receptury użyte w produkcji
 * @param declaredKg ile mięsa tej receptury realnie zostało (0 = nic)
 */
export function splitRemainder(
  batches: RemainderBatch[] | undefined | null,
  declaredKg: number,
): RemainderAssignment[] {
  const list = [...(batches ?? [])].sort(fefo)
  let zostalo = Math.max(0, n(declaredKg))

  // Od najmłodszej: to ona przetrwała, bo starsze poszły pierwsze.
  const target = new Map<string, number>()
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i]
    const moze = Math.max(0, n(b.theoryKg))
    const bierze = Math.min(zostalo, moze)
    target.set(b.id, Math.round(bierze * 1000) / 1000)
    zostalo -= bierze
  }

  return list.map(b => {
    const t = target.get(b.id) ?? 0
    return {
      id: b.id,
      batchNo: b.batchNo,
      theoryKg: Math.round(n(b.theoryKg) * 1000) / 1000,
      targetKg: t,
      close: t <= 0.05,
    }
  })
}

/** Partie, których stan trzeba skorygować (reszta zostaje bez zmian). */
export function changedAssignments(
  assignments: RemainderAssignment[],
): RemainderAssignment[] {
  return assignments.filter(a => Math.abs(a.targetKg - a.theoryKg) > 0.05)
}
