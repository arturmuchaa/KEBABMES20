/**
 * Rozdzielenie pozostałości na partie.
 *
 * Biuro podaje JEDNĄ liczbę per receptura („zostało trochę KIRMIZI"), bo
 * nikt nie rozdziela resztek w chłodni na partie. System przypisuje je
 * FEFO: skoro najstarsze partie schodzą pierwsze, to co zostało pochodzi
 * z najmłodszych.
 */
import { describe, it, expect } from 'vitest'
import { splitRemainder, changedAssignments } from './remainderSplit'

const b = (id: string, theoryKg: number, expiryDate?: string) =>
  ({ id, batchNo: id, theoryKg, expiryDate })

describe('splitRemainder', () => {
  it('resztę zatrzymuje NAJMŁODSZA partia, starsze schodzą do zera', () => {
    const out = splitRemainder(
      [b('470', 40, '2026-08-17'), b('PP13', 59.1, '2026-08-18')], 30,
    )
    expect(out.map(a => [a.batchNo, a.targetKg])).toEqual([['470', 0], ['PP13', 30]])
    expect(out.find(a => a.batchNo === '470')!.close).toBe(true)
    expect(out.find(a => a.batchNo === 'PP13')!.close).toBe(false)
  })

  it('gdy zostało więcej niż mieści najmłodsza — nadwyżka wchodzi na starszą', () => {
    const out = splitRemainder(
      [b('470', 40, '2026-08-17'), b('PP13', 20, '2026-08-18')], 50,
    )
    expect(out.map(a => [a.batchNo, a.targetKg])).toEqual([['470', 30], ['PP13', 20]])
  })

  it('„nic nie zostało" zamyka wszystkie partie', () => {
    const out = splitRemainder([b('470', 40), b('PP13', 59.1)], 0)
    expect(out.every(a => a.targetKg === 0 && a.close)).toBe(true)
  })

  it('deklaracja większa niż stan teoretyczny nie tworzy mięsa z powietrza', () => {
    const out = splitRemainder([b('470', 10)], 999)
    expect(out[0].targetKg).toBe(10)
  })

  it('bez daty ważności kolejność po numerze partii', () => {
    const out = splitRemainder([b('B', 10), b('A', 10)], 10)
    expect(out.map(a => [a.batchNo, a.targetKg])).toEqual([['A', 0], ['B', 10]])
  })

  it('pusta lista nie wywraca rozliczenia', () => {
    expect(splitRemainder([], 10)).toEqual([])
    expect(splitRemainder(null, 10)).toEqual([])
  })
})

describe('changedAssignments', () => {
  it('koryguje tylko partie, których stan się zmienia', () => {
    const out = splitRemainder(
      [b('470', 40, '2026-08-17'), b('PP13', 59.1, '2026-08-18')], 59.1,
    )
    // PP13 zostaje bez zmian (59,1 → 59,1), 470 schodzi 40 → 0
    expect(changedAssignments(out).map(a => a.batchNo)).toEqual(['470'])
  })

  it('brak zmian = brak korekt', () => {
    const out = splitRemainder([b('470', 40)], 40)
    expect(changedAssignments(out)).toEqual([])
  })
})
