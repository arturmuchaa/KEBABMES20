import { describe, it, expect } from 'vitest'
import { batchDisplayNo } from './batchDisplayNo'

describe('batchDisplayNo — numer partii w tabeli przyjęć', () => {
  it('żywa partia pokazuje swój numer', () => {
    expect(batchDisplayNo({ internalBatchNo: '423', internalBatchSeq: 423 })).toBe('423')
  })

  it('usunięta partia pokazuje pierwotny numer, nie znacznik techniczny', () => {
    // Anulowanie zwalnia numer do puli, podmieniając go na ANUL-<id>,
    // żeby ten sam numer dało się przyjąć ponownie (prod 2026-07-20).
    expect(batchDisplayNo({
      internalBatchNo: 'ANUL-cd973e59d2864120ac63', internalBatchSeq: 423,
    })).toBe('423')
  })

  it('brak seq (dane sprzed fixu) — nie wymyśla numeru', () => {
    expect(batchDisplayNo({ internalBatchNo: 'ANUL-abc', internalBatchSeq: 0 })).toBe('—')
  })

  it('pusty numer nie wywraca tabeli', () => {
    expect(batchDisplayNo({ internalBatchNo: '', internalBatchSeq: 0 })).toBe('—')
  })
})
