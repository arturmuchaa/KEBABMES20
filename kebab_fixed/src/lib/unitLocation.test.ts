import { describe, it, expect } from 'vitest'
import { unitLocation, formatCartonNo } from './unitLocation'

describe('formatCartonNo — globalny numer kartonu', () => {
  it('dopełnia do 6 cyfr', () => {
    expect(formatCartonNo(1)).toBe('000001')
    expect(formatCartonNo(42)).toBe('000042')
  })
  it('pusty dla braku / 0', () => {
    expect(formatCartonNo(null)).toBe('')
    expect(formatCartonNo(undefined)).toBe('')
    expect(formatCartonNo(0)).toBe('')
  })
})

describe('unitLocation — lokalizacja sztuki wg statusu', () => {
  it('planned → W produkcji', () => {
    expect(unitLocation({ status: 'planned' })).toBe('W produkcji')
  })

  it('produced → Mroźnia szokowa', () => {
    expect(unitLocation({ status: 'produced' })).toBe('Mroźnia szokowa')
  })

  it('packed z numerem kartonu → Karton {nr} · Mroźnia składowa', () => {
    expect(unitLocation({ status: 'packed', cartonNo: '000042' }))
      .toBe('Karton 000042 · Mroźnia składowa')
  })

  it('packed bez numeru kartonu → sama Mroźnia składowa', () => {
    expect(unitLocation({ status: 'packed' })).toBe('Mroźnia składowa')
  })

  it('shipped z klientem → Wydano do klienta: {nazwa}', () => {
    expect(unitLocation({ status: 'shipped', clientName: 'ZAGROS' }))
      .toBe('Wydano do klienta: ZAGROS')
  })

  it('shipped bez nazwy klienta → Wydano do klienta', () => {
    expect(unitLocation({ status: 'shipped' })).toBe('Wydano do klienta')
  })

  it('nieznany status → kreska', () => {
    expect(unitLocation({ status: 'whatever' })).toBe('—')
  })
})
