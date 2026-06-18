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

/** Pozycja kartonu do walidacji offline: uprawnione kody + wolne miejsce. */
export interface OfflineLine {
  lineId: string
  eligible: Set<string>
  /** Wolne miejsce w pozycji w chwili pobrania (target − packed). */
  remaining: number
}

export interface PerLineScanCheck {
  code: string
  lines: OfflineLine[]
  /** Kody już zakolejkowane w tej sesji (w kolejności). */
  scanned: string[]
}

/**
 * Walidacja skanu OFFLINE względem POZYCJI kartonu mieszanego. Lustro serwerowego
 * `pick_line_for_unit`: przydziela zakolejkowane sztuki zachłannie do pierwszej
 * pasującej pozycji z wolnym miejscem; nową sztukę akceptuje tylko, gdy jest
 * jeszcze miejsce w którejś pasującej pozycji. Pure — testowalna.
 */
export function validateScanPerLine({ code, lines, scanned }: PerLineScanCheck): { ok: boolean; reason?: string } {
  if (scanned.includes(code)) return { ok: false, reason: 'Sztuka już zeskanowana' }
  if (!lines.some(l => l.eligible.has(code))) return { ok: false, reason: 'Sztuka nie pasuje do kartonu' }

  const used = lines.map(() => 0)
  const assign = (c: string): boolean => {
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].eligible.has(c) && used[i] < lines[i].remaining) { used[i]++; return true }
    }
    return false
  }
  // Odtwórz zużycie miejsca przez wcześniejsze skany z kolejki (best-effort).
  for (const c of scanned) assign(c)
  if (!assign(code)) return { ok: false, reason: 'Pozycja kartonu pełna — brak miejsca dla tej sztuki' }
  return { ok: true }
}
