import { describe, it, expect } from 'vitest'
import type { Line } from '../../data/model'
import { wierszeMiesa } from './miesoPrzyprawione'

/** Pozycja zamówienia z polami masowania (syntetyczna). null = backend nie umie policzyć (receptura bez składu). */
const poz = (recipe: string, remainingKg: number | null, meatKg: number | null = remainingKg) =>
  ({ line: { recipeId: recipe.toLowerCase(), recipe, mixingRemainingKg: remainingKg, mixingMeatKg: meatKg } as Line, orderNo: 'X/Z/1' })

describe('panel „Mięso przyprawione”', () => {
  it('receptura bez składu w zamówieniu zostaje w panelu jako potrzeba nieznana, nawet bez mięsa w magazynie', () => {
    // Przegląd 0.6.0: filtr pustych wierszy chował ją (req 0, wolne 0) — biuro traciło jedyny sygnał na Pulpicie.
    const rows = wierszeMiesa([poz('BEYAZ', null)], [])
    expect(rows).toEqual([expect.objectContaining({ name: 'BEYAZ', known: false })])
  })
  it('receptura bez potrzeb i bez wolnego mięsa znika; z potrzebą — zostaje z poziomem braku', () => {
    const rows = wierszeMiesa([poz('KIRMIZI', 300)], [{ recipeId: 'x', recipeName: 'ACILI', kgAvailable: 50, kgReserved: 50 }])
    expect(rows.map(r => r.name)).toEqual(['KIRMIZI'])
    expect(rows[0]).toMatchObject({ req: 300, free: 0, level: 'crit', known: true })
  })
})
