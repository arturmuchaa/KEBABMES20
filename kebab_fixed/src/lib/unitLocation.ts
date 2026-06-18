/**
 * Lokalizacja fizyczna sztuki (finished_unit) wyprowadzona z jej statusu.
 * Wspólna logika dla skanera mobilnego i biura — jedno źródło prawdy.
 *
 * planned  → jeszcze nieprodukowana → w produkcji
 * produced → produkcja zeskanowała  → mroźnia szokowa
 * packed   → na palecie/kartonie    → karton {nr} + mroźnia składowa
 * shipped  → załadunek zeskanował   → wydano do klienta
 */
/** Globalny numer kartonu (= paleta) — 6 cyfr z zerami wiodącymi. Pusty gdy brak. */
export function formatCartonNo(n: number | null | undefined): string {
  if (n == null || Number.isNaN(Number(n)) || Number(n) <= 0) return ''
  return String(Math.trunc(Number(n))).padStart(6, '0')
}

export interface UnitLocationInput {
  status: string
  /** Globalny numer kartonu (= paleta), sformatowany np. "000042". */
  cartonNo?: string | null
  /** Nazwa klienta — dla sztuk wydanych. */
  clientName?: string | null
}

export function unitLocation({ status, cartonNo, clientName }: UnitLocationInput): string {
  switch (status) {
    case 'planned':
      return 'W produkcji'
    case 'produced':
      return 'Mroźnia szokowa'
    case 'packed':
      return cartonNo
        ? `Karton ${cartonNo} · Mroźnia składowa`
        : 'Mroźnia składowa'
    case 'shipped':
      return clientName
        ? `Wydano do klienta: ${clientName}`
        : 'Wydano do klienta'
    default:
      return '—'
  }
}
