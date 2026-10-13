/** Wspólne parametry podglądu i wydruku etykiety pojedynczej sztuki. */
export const UNIT_QR_OPTIONS = {
  width: 1000,
  margin: 4,
  errorCorrectionLevel: 'H' as const,
}

// Taka sama długość i tryb kodowania jak U| + 20-znakowe id sztuki.
// Prefix TEST wyklucza pomylenie próbnego wydruku ze sztuką produkcyjną.
export const SAMPLE_UNIT_QR = 'TEST|a1b2c3d4e5f6a7b8c'
