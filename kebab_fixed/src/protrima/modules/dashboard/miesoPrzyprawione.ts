import { mixingByRecipe, type Line } from '../../data/model'

export interface SeasonedLite { recipeId: string; recipeName: string; kgAvailable: number; kgReserved: number }
export interface WierszMiesa { name: string; req: number; free: number; all: number; level: 'ok' | 'warn' | 'crit'; known: boolean }

/**
 * Wiersze panelu „Mięso przyprawione”: wolne mięso danej receptury a wyrób do zmasowania z zamówień
 * (backend liczy go z pokrycia). Najpierw receptury z największym niedoborem.
 */
export function wierszeMiesa(pozycje: Array<{ line: Line; orderNo: string }>, seasoned: SeasonedLite[]): WierszMiesa[] {
  const need = mixingByRecipe(pozycje)
  const byId = new Map<string, { name: string; free: number; all: number }>()
  for (const s of seasoned) {
    const x = byId.get(s.recipeId) ?? { name: s.recipeName, free: 0, all: 0 }
    x.free += Math.max(0, s.kgAvailable - s.kgReserved); x.all += s.kgAvailable
    byId.set(s.recipeId, x)
  }
  const names = new Set([...need.map(n => n.recipe), ...[...byId.values()].map(v => v.name)])
  // Filtr pustych wierszy: potrzeba nieznana (receptura bez składu) ≠ brak potrzeb — taki wiersz zostaje,
  // to jedyny ślad na Pulpicie, że dla zamówionego wyrobu nie da się policzyć mięsa do zmasowania.
  return [...names].map((name): WierszMiesa => {
    const n = need.find(x => x.recipe === name)
    const s = [...byId.values()].find(v => v.name === name)
    const req = n?.remainingKg ?? 0
    const free = s?.free ?? 0
    const level = req > 0 && free < req ? (free <= 0 ? 'crit' : 'warn') : 'ok'
    return { name, req, free, all: s?.all ?? 0, level, known: n?.known ?? true }
  }).filter(r => r.req > 0 || r.free > 0 || !r.known).sort((a, b) => (b.req - b.free) - (a.req - a.free))
}
