import { describe, it, expect } from 'vitest'

import { filterWz, wzTabCounts, type WzTab } from './wzListView'

/**
 * Rejestr WZ czyta się jak rejestr faktur: aktywne dokumenty w jednym miejscu,
 * anulowane osobno. Wcześniej anulowane leżały w tej samej liście, tylko
 * wyszarzone — przy 12 anulowanych na 34 dokumenty w sierpniu lista przestała
 * być czytelna.
 */
const DOCS = [
  { id: '1', number: 'WZ/1/08/26', buyer_name: 'KRAK-TOL', buyer_nip: '6772447787', status: 'wstepny' },
  { id: '2', number: 'WZ/2/08/26', buyer_name: 'GRASO', buyer_nip: '1111111111', status: 'wstepny' },
  { id: '3', number: 'ANUL WZ/2/08/26', buyer_name: 'MARCIN', buyer_nip: '', status: 'anulowany' },
] as any[]

describe('filterWz — zakładki rejestru WZ', () => {
  it('zakładka aktywnych pomija anulowane', () => {
    expect(filterWz(DOCS, '', 'active').map(d => d.id)).toEqual(['1', '2'])
  })

  it('zakładka anulowanych pokazuje TYLKO anulowane', () => {
    expect(filterWz(DOCS, '', 'cancelled').map(d => d.id)).toEqual(['3'])
  })

  it('szukajka działa w obrębie zakładki, nie przez całą bazę', () => {
    expect(filterWz(DOCS, 'MARCIN', 'active')).toEqual([])
    expect(filterWz(DOCS, 'MARCIN', 'cancelled').map(d => d.id)).toEqual(['3'])
  })

  it('szuka po numerze, odbiorcy i NIP-ie', () => {
    expect(filterWz(DOCS, 'WZ/1', 'active').map(d => d.id)).toEqual(['1'])
    expect(filterWz(DOCS, 'graso', 'active').map(d => d.id)).toEqual(['2'])
    expect(filterWz(DOCS, '6772447787', 'active').map(d => d.id)).toEqual(['1'])
  })

  it('liczniki zakładek liczą całość, nie przefiltrowaną listę', () => {
    expect(wzTabCounts(DOCS)).toEqual({ active: 2, cancelled: 1 })
  })

  it('pusta lista nie wywraca liczników', () => {
    expect(wzTabCounts([])).toEqual({ active: 0, cancelled: 0 })
    expect(filterWz([], 'cokolwiek', 'active' as WzTab)).toEqual([])
  })
})
