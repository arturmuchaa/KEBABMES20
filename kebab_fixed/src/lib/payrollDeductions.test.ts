import { describe, it, expect } from 'vitest'
import { splitDeductions, sumDeductions, type Deduction } from './payrollDeductions'

const d = (id: string, date: string, amount = 50): Deduction => ({
  id, deductionDate: date, description: `poz. ${id}`, amount,
  sourceType: 'manual', sourceId: null, status: 'pending',
})

describe('splitDeductions — reguła zakresu jest ścisła, ale nic nie ginie', () => {
  it('w zakresie wchodzi, wcześniejsze idzie do zaległych', () => {
    const res = splitDeductions([d('a', '2026-08-04'), d('b', '2026-07-30')],
      '2026-08-03', '2026-08-09')
    expect(res.inRange.map(x => x.id)).toEqual(['a'])
    expect(res.overdue.map(x => x.id)).toEqual(['b'])
  })

  it('brzegi zakresu włącznie', () => {
    const res = splitDeductions([d('a', '2026-08-03'), d('b', '2026-08-09')],
      '2026-08-03', '2026-08-09')
    expect(res.inRange).toHaveLength(2)
    expect(res.overdue).toHaveLength(0)
  })

  it('data po zakresie nie jest zaległa — jeszcze nie jej czas', () => {
    const res = splitDeductions([d('a', '2026-08-20')], '2026-08-03', '2026-08-09')
    expect(res.inRange).toHaveLength(0)
    expect(res.overdue).toHaveLength(0)
  })
})

describe('sumDeductions', () => {
  it('sumuje kwoty', () => {
    expect(sumDeductions([d('a', '2026-08-04', 56), d('b', '2026-08-05', 14)])).toBe(70)
  })
})
