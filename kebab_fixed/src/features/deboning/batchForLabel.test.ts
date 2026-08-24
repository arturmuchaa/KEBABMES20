/**
 * Partia do etykiety ubocznych.
 *
 * Etykieta grzbietów i kości przepisuje datę ważności Z ĆWIARTKI. Kafel
 * „do zważenia" (partie z zamkniętym rozbiorem, czekające na uboczne) podawał
 * do kreatora partię SKLEJONĄ Z DWÓCH PÓL — id i numer — więc etykieta dla
 * partii 502 wyszła 24.08.2026 z pustym terminem, choć ćwiartka ma go w bazie
 * (2026-08-27). Uzupełniamy brakujące pola z pełnej listy partii.
 */
import { describe, it, expect } from 'vitest'
import { batchForLabel } from './batchForLabel'

/** Tyle o partii wie etykieta — reszta pól RawBatch jest tu bez znaczenia. */
type Partia = {
  id: string; internalBatchNo: string
  expiryDate?: string; slaughterDate?: string
}

const PELNA: Partia[] = [
  { id: 'b502', internalBatchNo: '502', expiryDate: '2026-08-27', slaughterDate: '2026-08-20' },
  { id: 'b503', internalBatchNo: '503', expiryDate: '2026-08-28', slaughterDate: '2026-08-21' },
]

describe('batchForLabel', () => {
  it('sklejoną partię bez daty uzupełnia z pełnej listy', () => {
    const sklejona: Partia = { id: 'b502', internalBatchNo: '502' }
    expect(batchForLabel(sklejona, PELNA).expiryDate).toBe('2026-08-27')
  })

  it('oddaje CAŁY rekord z listy, nie tylko datę', () => {
    const out = batchForLabel({ id: 'b502', internalBatchNo: '502' } as Partia, PELNA)
    expect(out.slaughterDate).toBe('2026-08-20')
  })

  it('partii, która ma już datę, nie podmienia', () => {
    const wlasna: Partia = { id: 'b502', internalBatchNo: '502', expiryDate: '2026-09-01' }
    expect(batchForLabel(wlasna, PELNA).expiryDate).toBe('2026-09-01')
  })

  it('partii spoza listy nie wymyśla — oddaje to, co dostał', () => {
    const obca: Partia = { id: 'b999', internalBatchNo: '999' }
    expect(batchForLabel(obca, PELNA)).toBe(obca)
  })

  it('pusta lista niczego nie psuje', () => {
    const sklejona: Partia = { id: 'b502', internalBatchNo: '502' }
    expect(batchForLabel(sklejona, [])).toBe(sklejona)
  })

  it('pusty string traktuje jak brak daty — tak wygląda sklejka z wpisu', () => {
    const sklejona: Partia = { id: 'b502', internalBatchNo: '502', expiryDate: '' }
    expect(batchForLabel(sklejona, PELNA).expiryDate).toBe('2026-08-27')
  })
})
