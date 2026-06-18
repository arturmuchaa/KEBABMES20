/**
 * Generator ZPL: wklejone tło z Zebra Designer (statyka, diacrytyki w grafice)
 * + nakładka pól dynamicznych natywnym ZPL (ASCII). Czysta logika — testowalna.
 * Placeholdery [[KLUCZ]] zostają do podstawienia przy druku (merge_zpl na backendzie).
 */
export interface ZplField {
  id: string
  type: 'text' | 'qr'
  /** Treść — może zawierać [[KLUCZ]] (podstawiane przy druku). */
  value: string
  /** Lewy-górny róg, mm. */
  xMm: number
  yMm: number
  /** Wysokość fontu w mm (text). */
  fontMm?: number
  /** Magnifikacja modułu QR 1–10 (qr). */
  mag?: number
}

export interface ComposeZplInput {
  /** Wklejony ZPL z Zebra Designer (statyczne tło). Może być pusty. */
  backgroundZpl: string
  fields: ZplField[]
  dpi: number
}

export function mmToDots(mm: number, dpi: number): number {
  return Math.round((mm * dpi) / 25.4)
}

/** Usuń znaki sterujące ZPL z treści, NIE ruszając placeholderów [[..]]. */
function escapeZpl(s: string): string {
  return (s ?? '').replace(/[\^~]/g, ' ')
}

function fieldToZpl(f: ZplField, dpi: number): string {
  const x = mmToDots(f.xMm, dpi)
  const y = mmToDots(f.yMm, dpi)
  if (f.type === 'qr') {
    const mag = Math.min(10, Math.max(1, Math.round(f.mag ?? 4)))
    return `^FO${x},${y}^BQN,2,${mag}^FDQA,${escapeZpl(f.value)}^FS`
  }
  const h = mmToDots(f.fontMm ?? 3, dpi)
  return `^FO${x},${y}^A0N,${h},${h}^FD${escapeZpl(f.value)}^FS`
}

export function composeZpl({ backgroundZpl, fields, dpi }: ComposeZplInput): string {
  const overlay = (fields ?? []).map((f) => fieldToZpl(f, dpi)).join('\n')
  const bg = (backgroundZpl ?? '').trim()
  if (!bg) {
    return `^XA\n${overlay}\n^XZ`
  }
  // Usuń OSTATNIE ^XZ (zamknięcie etykiety), doklej nakładkę, zamknij ponownie.
  const lastXz = bg.lastIndexOf('^XZ')
  const body = lastXz >= 0 ? bg.slice(0, lastXz).replace(/\s+$/, '') : bg
  return `${body}\n${overlay}\n^XZ`
}
