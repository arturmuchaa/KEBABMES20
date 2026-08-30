import { describe, it, expect } from 'vitest'
import { ddfipRows } from './ddfipRegisterRows'

const doc = (over: Record<string, unknown> = {}) => ({
  id: 'r1',
  receptionNo: 'DF/1/08',
  supplierId: 'sup1',
  supplierName: 'BERG PRZYPRAWY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  assortment: 'Mieszanka KEBAB, Sól',
  receivedDate: '2026-08-12',
  documentNo: 'FV 123/2026',
  visualCheck: 'bz',
  complianceCheck: 'bz',
  notes: '',
  decision: 'K',
  doneBy: 'Anna',
  checkedBy: 'Marek',
  lines: [],
  ...over,
}) as any

describe('ddfipRows — karta 1.3.1', () => {
  it('jeden wiersz na dostawę, kolumny a–k z systemu', () => {
    const [row] = ddfipRows([doc()], 11)
    expect(row).toEqual([
      'DF/1/08', 'BERG PRZYPRAWY', 'Mieszanka KEBAB, Sól', '12.08.2026',
      'FV 123/2026', 'b/z', 'b/z', '', 'K', 'Anna', 'Marek',
    ])
  })

  it('karta 1.3.1 wypełnia się CAŁA — w odróżnieniu od 1.1.1', () => {
    // Przy mięsie oceny powstają przy aucie i MES ich nie zna. Tutaj wpisuje
    // je biuro w formularzu przyjęcia, więc wydruk nie ma pustych kratek.
    const [row] = ddfipRows([doc()], 11)
    expect(row.filter(c => c === '')).toHaveLength(1)   // tylko puste uwagi
  })

  it('ocena N wychodzi na wydruk jako N, nie jako pusto', () => {
    const [row] = ddfipRows([doc({ decision: 'N', visualCheck: 'N',
                                   notes: 'Rozerwane worki' })], 11)
    expect(row[5]).toBe('N')
    expect(row[7]).toBe('Rozerwane worki')
    expect(row[8]).toBe('N')
  })

  it('obcina formę prawną dostawcy — kolumna ma 32 mm, nie pół strony', () => {
    expect(ddfipRows([doc()], 11)[0][1]).toBe('BERG PRZYPRAWY')
  })

  it('sortuje po dacie rosnąco — karta czyta się od początku miesiąca', () => {
    const rows = ddfipRows([
      doc({ id: 'b', receptionNo: 'DF/2/08', receivedDate: '2026-08-20' }),
      doc({ id: 'a', receptionNo: 'DF/1/08', receivedDate: '2026-08-03' }),
    ], 11)
    expect(rows.map(r => r[0])).toEqual(['DF/1/08', 'DF/2/08'])
  })

  it('ten sam dzień porządkuje numerem, nie kolejnością z bazy', () => {
    const rows = ddfipRows([
      doc({ id: 'b', receptionNo: 'DF/10/08', receivedDate: '2026-08-03' }),
      doc({ id: 'a', receptionNo: 'DF/2/08',  receivedDate: '2026-08-03' }),
    ], 11)
    expect(rows.map(r => r[0])).toEqual(['DF/2/08', 'DF/10/08'])
  })

  it('dopełnia wiersz do liczby kolumn karty', () => {
    expect(ddfipRows([doc()], 13)).toHaveLength(1)
    expect(ddfipRows([doc()], 13)[0]).toHaveLength(13)
  })

  it('pusty miesiąc daje pustą kartę, nie błąd', () => {
    expect(ddfipRows([], 11)).toEqual([])
  })
})
