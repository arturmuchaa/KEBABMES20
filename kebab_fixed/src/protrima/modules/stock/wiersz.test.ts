import { describe, it, expect } from 'vitest'
import type { StockPos } from '../../data/stock'
import { klientPrzydzialu, kolumnyZWartoscia } from './wiersz'

describe('Wyrób gotowy — wiersz tabeli', () => {
  it('klient przy numerze zamówienia tylko wtedy, gdy numer go nie zawiera', () => {
    expect(klientPrzydzialu('YALCIN/Z/7/10/26', 'YALCIN')).toBeUndefined()
    expect(klientPrzydzialu('GOLD-KEBAB/Z/6/10/26', 'GOLD KEBAB s.r.o.')).toBeUndefined()
    expect(klientPrzydzialu('DEM-S/Z/4/10/26', 'DEM`S')).toBeUndefined()
    expect(klientPrzydzialu('Z/12/10/26', 'ZAGROS GmbH')).toBe('ZAGROS')
    expect(klientPrzydzialu('VATAN/Z/6/10/26', 'POLAT')).toBe('POLAT')
    expect(klientPrzydzialu('VATAN/Z/6/10/26', undefined)).toBeUndefined()
  })

  it('kolumny Przydatność i Plan tylko, gdy w widoku jest choć jedna wartość', () => {
    const p = (o: Partial<StockPos>) => ({ bestBefore: undefined, planNo: undefined, ...o }) as StockPos
    expect(kolumnyZWartoscia([p({}), p({})])).toEqual({ przydatnosc: false, plan: false })
    expect(kolumnyZWartoscia([p({}), p({ planNo: 'PP/3/10/26' })])).toEqual({ przydatnosc: false, plan: true })
    expect(kolumnyZWartoscia([p({ bestBefore: new Date('2026-12-01') })])).toEqual({ przydatnosc: true, plan: false })
  })
})
