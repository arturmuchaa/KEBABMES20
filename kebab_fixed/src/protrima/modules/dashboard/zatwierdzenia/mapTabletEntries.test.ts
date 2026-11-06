import { describe, it, expect } from 'vitest'
import { mapTabletEntries } from '@/lib/api'

describe('wpisy z tabletu w planie (tablet_pending_entries)', () => {
  it('jsonb z serwera (snake_case, też jako tekst) → wpisy do porównania z planem', () => {
    const raw = [{ plan_line_id: 'l1', qty: 12, kg_per_unit: 40, worker_names: ['Jan'], recipe_name: 'KIRMIZI' }]
    expect(mapTabletEntries(raw)).toEqual([{ planLineId: 'l1', qty: 12, kgPerUnit: 40, workerNames: ['Jan'] }])
    expect(mapTabletEntries(JSON.stringify(raw))).toEqual(mapTabletEntries(raw))
  })
  it('brak wpisów albo zepsuty tekst — pusta lista, nie wyjątek', () => {
    expect(mapTabletEntries(null)).toEqual([])
    expect(mapTabletEntries('{zepsute')).toEqual([])
  })
})
