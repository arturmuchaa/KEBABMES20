/**
 * Co biuro zmieniło w planie w trakcie zmiany.
 *
 * Tablet produkcji nie ma tego wcale, a jest potrzebne: biuro edytuje plan,
 * gdy hala już pracuje. Ekran odpytuje plan cyklicznie i porównuje z tym, co
 * operator ostatnio WIDZIAŁ — różnica idzie na pasek, który nie znika sam.
 *
 * Porównujemy PO `id`, nigdy po miejscu w tablicy: plan wolno przestawić,
 * a usunięcie pierwszej pozycji nie może wyglądać jak zmiana wszystkich
 * pozostałych.
 */

/** Tyle z pozycji planu, ile operator widzi na liście — reszta nie jest zmianą. */
export interface PlanSnapshotLine {
  id: string
  qty: number
  kgPerUnit: number
  recipeName: string
  packagingName: string
  clientName: string
}

export type PoleZmiany = 'receptura' | 'tuleja' | 'klient'

export type PlanChange =
  | { kind: 'added';   line: PlanSnapshotLine }
  | { kind: 'removed'; line: PlanSnapshotLine }
  | { kind: 'qty';     line: PlanSnapshotLine; from: number; to: number }
  | { kind: 'field';   line: PlanSnapshotLine; pole: PoleZmiany; from: string; to: string }

/** Pozycja planu z API → migawka. Braki schodzą do pustych, nie do undefined. */
export function snapshotPlanu(lines: readonly any[]): PlanSnapshotLine[] {
  return (lines ?? []).map(l => ({
    id:            String(l?.id ?? ''),
    qty:           Number(l?.qty ?? 0),
    kgPerUnit:     Number(l?.kgPerUnit ?? 0),
    recipeName:    String(l?.recipeName ?? ''),
    packagingName: String(l?.packagingName ?? ''),
    clientName:    String(l?.clientName ?? ''),
  }))
}

const POLA: { pole: PoleZmiany; klucz: keyof PlanSnapshotLine }[] = [
  { pole: 'receptura', klucz: 'recipeName' },
  { pole: 'tuleja',    klucz: 'packagingName' },
  { pole: 'klient',    klucz: 'clientName' },
]

export function planDiff(
  poprzedni: readonly PlanSnapshotLine[],
  biezacy: readonly PlanSnapshotLine[],
): PlanChange[] {
  const byloWg = new Map(poprzedni.map(l => [l.id, l]))
  const jestWg = new Map(biezacy.map(l => [l.id, l]))
  const zmiany: PlanChange[] = []

  for (const teraz of biezacy) {
    const bylo = byloWg.get(teraz.id)
    if (!bylo) { zmiany.push({ kind: 'added', line: teraz }); continue }
    if (bylo.qty !== teraz.qty) {
      zmiany.push({ kind: 'qty', line: teraz, from: bylo.qty, to: teraz.qty })
    }
    for (const { pole, klucz } of POLA) {
      const a = String(bylo[klucz] ?? ''), b = String(teraz[klucz] ?? '')
      if (a !== b) zmiany.push({ kind: 'field', line: teraz, pole, from: a, to: b })
    }
  }
  for (const bylo of poprzedni) {
    if (!jestWg.has(bylo.id)) zmiany.push({ kind: 'removed', line: bylo })
  }
  return zmiany
}

/** Pozycja bez klienta to produkcja „na magazyn" — tak ją nazywa cały MES. */
const klient = (v: string) => (v.trim() ? v : 'na magazyn')

/** Tekst na pasek — nazywa konkret, żeby zmiana nie przeszła niezauważona. */
export function opiszZmiane(z: PlanChange): string {
  const { recipeName, qty, kgPerUnit } = z.line
  switch (z.kind) {
    case 'added':   return `doszła ${recipeName} ${qty}×${kgPerUnit} kg`
    case 'removed': return `zdjęto ${recipeName} ${qty}×${kgPerUnit} kg`
    case 'qty':     return `${recipeName} ${z.from} → ${z.to} szt.`
    case 'field': {
      const from = z.pole === 'klient' ? klient(z.from) : z.from
      const to   = z.pole === 'klient' ? klient(z.to)   : z.to
      return `${recipeName} — ${z.pole}: ${from} → ${to}`
    }
  }
}
