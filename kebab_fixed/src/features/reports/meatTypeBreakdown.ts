/**
 * meatTypeBreakdown — sekcja „Mięsa / Ilość uzysku kg" karty 2.1.1.
 *
 * Szablon 2.1.1 przewiduje w tym miejscu LISTĘ rodzajów mięsa, nie jedną
 * pozycję. Karta drukowała dotąd na sztywno „Mięso Z/S", więc pobrania na
 * mięso bez skóry (b/s — osobne pasmo wydajności, ~30 kg tygodniowo) szły
 * na dokument pod cudzą etykietą: 4.08 i 11.08.2026 po ~33 kg.
 *
 * Rozbicie dotyczy WYŁĄCZNIE opisu — bilans karty liczy się dalej na sumie
 * mięsa z partii, więc rozdzielenie rodzajów nie rusza ani grzbietów, ani
 * kości, ani wiersza „Suma".
 */

const LABELS: Record<string, string> = {
  zs: 'Mięso Z/S',
  bs: 'Mięso B/S',
}

export interface MeatEntry {
  /** 'zs' | 'bs'; brak = 'zs' (domyślna wartość backendu). */
  readonly meatType?: string | null
  readonly kgMeat: number
}

export interface MeatTypeRow {
  readonly type: string
  readonly label: string
  readonly kg: number
}

/** Kolejność na karcie: najpierw z/s, potem b/s, na końcu rodzaje nieznane. */
const ORDER = ['zs', 'bs']
const rank = (t: string) => {
  const i = ORDER.indexOf(t)
  return i === -1 ? ORDER.length : i
}

/**
 * Sumuje mięso per rodzaj i zwraca pozycje w kolejności do druku.
 *
 * @param totalKg gdy podane, suma pozycji jest uzgadniana do tej liczby —
 *   różnicę zaokrągleń bierze na siebie pozycja NAJWIĘKSZA, żeby drobny
 *   rodzaj (33 kg b/s) nie dostał doklejonego grosza.
 */
export function meatByType(entries: readonly MeatEntry[], totalKg?: number): MeatTypeRow[] {
  const sums = new Map<string, number>()
  for (const e of entries) {
    const type = e.meatType || 'zs'
    sums.set(type, (sums.get(type) ?? 0) + Number(e.kgMeat || 0))
  }

  const rows = [...sums.entries()]
    .filter(([, kg]) => kg > 0)
    .map(([type, kg]) => ({ type, label: LABELS[type] ?? `Mięso ${type.toUpperCase()}`, kg }))
    .sort((a, b) => rank(a.type) - rank(b.type) || b.kg - a.kg)

  if (totalKg == null || rows.length === 0) return rows

  const diff = totalKg - rows.reduce((s, r) => s + r.kg, 0)
  if (diff === 0) return rows
  const biggest = rows.reduce((a, r) => (r.kg > a.kg ? r : a), rows[0])
  return rows.map(r => (r === biggest ? { ...r, kg: r.kg + diff } : r))
}
