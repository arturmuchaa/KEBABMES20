import { describe, it, expect } from 'vitest'
import { WzLine } from '@/lib/api'
import { buildHdiRows } from './hdiRows'

const line = (p: Partial<WzLine> & { name: string; batch_no: string }): WzLine => ({
  qty: 100, unit: 'kg', price: 0.02, value: 2,
  stock_type: 'byproduct', production_date: '2026-08-07', ...p,
})

describe('buildHdiRows', () => {
  it('grupuje towary w kolejności pozycji dokumentu, partie od najstarszej', () => {
    // Kolejność wejścia jak na WZ/16/08/26 — wymieszana.
    const rows = buildHdiRows([
      line({ name: 'Grzbiety z kurczaka', batch_no: '469' }),
      line({ name: 'Kości z kurczaka', batch_no: '469' }),
      line({ name: 'Kości z kurczaka', batch_no: '461' }),
      line({ name: 'Grzbiety z kurczaka', batch_no: '466' }),
    ])
    expect(rows.map(r => `${r.name} ${r.batch_no}`)).toEqual([
      'Grzbiety z kurczaka 466',
      'Grzbiety z kurczaka 469',
      'Kości z kurczaka 461',
      'Kości z kurczaka 469',
    ])
  })

  it('numery partii sortuje liczbowo, nie tekstowo (9 przed 10)', () => {
    const rows = buildHdiRows([
      line({ name: 'Mięso z/s', batch_no: '10' }),
      line({ name: 'Mięso z/s', batch_no: '9' }),
    ])
    expect(rows.map(r => r.batch_no)).toEqual(['9', '10'])
  })

  it('ten sam towar z tej samej partii = jedna linia (kg i pojemniki sumowane)', () => {
    const rows = buildHdiRows([
      line({ name: 'Grzbiety z kurczaka', batch_no: '468', qty: 615, containers: 46 }),
      line({ name: 'Grzbiety z kurczaka', batch_no: '468', qty: 159, containers: 12 }),
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0].total_kg).toBe(774)
    expect(rows[0].containers).toBe(58)
  })

  it('nie scala tej samej partii, gdy różnią się daty na dokumencie', () => {
    const rows = buildHdiRows([
      line({ name: 'Kości z kurczaka', batch_no: '468', expiry_date: '2026-08-11' }),
      line({ name: 'Kości z kurczaka', batch_no: '468', expiry_date: '2026-08-12' }),
    ])
    expect(rows).toHaveLength(2)
  })

  it('pomija wyrób gotowy i pozycje bez numeru partii', () => {
    expect(buildHdiRows([
      line({ name: 'Kebab 40 kg', batch_no: 'R/12/08/26', stock_type: 'fg' }),
      { name: 'Usługa', qty: 1, unit: 'szt', price: null, value: null, stock_type: 'raw' },
    ])).toEqual([])
  })

  it('nie modyfikuje wejściowych linii', () => {
    const input = [
      line({ name: 'Grzbiety z kurczaka', batch_no: '468', qty: 615, containers: 46 }),
      line({ name: 'Grzbiety z kurczaka', batch_no: '468', qty: 159, containers: 12 }),
    ]
    buildHdiRows(input)
    expect(input[0].total_kg).toBeUndefined()
    expect(input[0].containers).toBe(46)
  })
})
