/**
 * Walidacja skanu sztuki OFFLINE względem pobranej (online) listy uprawnionych
 * sztuk kartonu + lokalnie już zeskanowanych. Pure — testowalna.
 */
export interface LocalScanCheck {
  code: string
  /** Kody QR sztuk uprawnionych do tego kartonu (pobrane gdy była sieć). */
  eligible: Set<string>
  /** Kody już zeskanowane w tej sesji (z kolejki). */
  scanned: Set<string>
}

export function validateScanLocally({ code, eligible, scanned }: LocalScanCheck): { ok: boolean; reason?: string } {
  if (scanned.has(code)) return { ok: false, reason: 'Sztuka już zeskanowana' }
  if (!eligible.has(code)) return { ok: false, reason: 'Sztuka nie pasuje do kartonu' }
  return { ok: true }
}
