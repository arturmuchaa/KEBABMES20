/**
 * Numer partii w wierszu planu.
 *
 * Operator musi wiedzieć, z jakiego wsadu robi bieżącą pozycję — bez tego
 * pyta biuro albo zgaduje z kartki. Etykieta bywa długa („2×472 · 6×PP13"),
 * więc pokazujemy najwyżej dwie partie, a resztę zwijamy do „+n": wiersz ma
 * zostać czytelny z dwóch metrów, a pełne rozbicie i tak jest po dotknięciu
 * pozycji.
 */
export interface BatchSource {
  seasonedBatchNos?: (string | null | undefined)[]
  /** Rozbicie z planowania: { numerPartii: { pieces } }. */
  batchAllocation?: Record<string, { pieces?: number } | any>
}

const MAX = 2

export function batchLabel(line: BatchSource | null | undefined): string {
  const src = line || {}

  const ba = src.batchAllocation
  if (ba && typeof ba === 'object' && !Array.isArray(ba)) {
    const czesci = Object.entries(ba)
      .map(([bno, a]) => ({ bno: String(bno || ''), pieces: Number((a || {}).pieces) || 0 }))
      .filter(p => p.bno && p.pieces > 0)
    if (czesci.length) return zwin(czesci.map(p => `${p.pieces}×${p.bno}`))
  }

  const nos = (src.seasonedBatchNos || []).map(n => String(n || '').trim()).filter(Boolean)
  return nos.length ? zwin(nos) : '—'
}

/**
 * Pełne rozbicie partii — do szczegółów pozycji (przytrzymanie wiersza).
 * Główna lista planu partii nie pokazuje wcale; tu nic nie zwijamy.
 */
export function batchParts(line: BatchSource | null | undefined): { batchNo: string; pieces: number | null }[] {
  const src = line || {}
  const ba = src.batchAllocation
  if (ba && typeof ba === 'object' && !Array.isArray(ba)) {
    const czesci = Object.entries(ba)
      .map(([bno, a]) => ({ batchNo: String(bno || ''), pieces: Number((a || {}).pieces) || 0 }))
      .filter(p => p.batchNo && p.pieces > 0)
    if (czesci.length) return czesci
  }
  return (src.seasonedBatchNos || [])
    .map(n => String(n || '').trim()).filter(Boolean)
    .map(batchNo => ({ batchNo, pieces: null }))
}

const zwin = (czesci: string[]): string => {
  const widoczne = czesci.slice(0, MAX).join(' · ')
  const reszta = czesci.length - MAX
  return reszta > 0 ? `${widoczne} +${reszta}` : widoczne
}
