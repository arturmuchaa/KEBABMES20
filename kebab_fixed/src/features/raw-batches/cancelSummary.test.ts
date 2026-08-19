import { describe, it, expect } from 'vitest'
import { podsumowanieAnulowania } from './cancelSummary'
import type { RawBatch } from './types'

const partia = (nadpisz: Partial<RawBatch> = {}): RawBatch => ({
  id: 'x', internalBatchNo: '492', internalBatchSeq: 492,
  supplierId: 's1', supplierName: 'PS INWEST PLUS SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  supplierDisplayName: 'SZUMERA', supplierBatchNo: '',
  slaughterDate: '2026-08-19', receivedDate: '2026-08-19', expiryDate: '2026-08-26',
  kgReceived: 4700, kgAvailable: 0, kgUsed: 0, utilizationPct: 0,
  pricePerKg: 10, materialTypeId: 'mat-mieso-zs', materialName: 'Mięso z/s',
  ...nadpisz,
} as RawBatch)

describe('podsumowanieAnulowania — co operator widzi przed anulowaniem', () => {
  it('pokazuje wszystko, co odróżnia partię od sąsiedniej', () => {
    const p = podsumowanieAnulowania(partia())
    expect(p.numer).toBe('492')
    expect(p.dostawca).toBe('SZUMERA')
    expect(p.surowiec).toBe('Mięso z/s')
    expect(p.kg).toBe('4700 kg')
    expect(p.data).toContain('19')
  })

  it('woli nazwę używaną w biurze niż pełną nazwę z KRS-u', () => {
    expect(podsumowanieAnulowania(partia()).dostawca).toBe('SZUMERA')
  })

  it('gdy nie ma nazwy skróconej, bierze pełną — nigdy nie zostawia pustego pola', () => {
    const p = podsumowanieAnulowania(partia({ supplierDisplayName: undefined }))
    expect(p.dostawca).toContain('PS INWEST PLUS')
  })

  it('braki oznacza kreską, nie pustką ani "undefined"', () => {
    const p = podsumowanieAnulowania(partia({
      supplierDisplayName: '', supplierName: '', materialName: '', receivedDate: '',
    }))
    expect(p.dostawca).toBe('—')
    expect(p.surowiec).toBe('—')
    expect(p.data).toBe('—')
  })

  it('kilogramy bez końcówki groszowej — liczba ma być czytelna od razu', () => {
    expect(podsumowanieAnulowania(partia({ kgReceived: 4700 })).kg).toBe('4700 kg')
    expect(podsumowanieAnulowania(partia({ kgReceived: 3000 })).kg).toBe('3000 kg')
  })
})
