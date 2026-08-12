import { describe, it, expect } from 'vitest'
import {
  detailRows, documentLabel, mainRows, paginate, plDate, plNum, shortSupplier,
} from './receptionRegisterRows'
import type { Reception } from '@/types'

const rec = (over: Partial<Reception> = {}): Reception => ({
  id: 'r1',
  receptionNo: '1/08/2026',
  receivedDate: '2026-08-11',
  supplierId: 'sup1',
  supplierName: 'KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
  documentNo: 'WZ 27/MDU/08/2026',
  hdiNo: '33656',
  hdiScan: '',
  notes: '',
  kgTotal: 9000,
  batches: [
    { internalBatchNo: '470', kgReceived: 5235, pricePerKg: 5.2, kgMeat: 3439.5,
      slaughterDate: '2026-08-10', expiryDate: '2026-08-17',
      materialName: 'Ćwiartka z kurczaka', supplierBatches: [] },
    { internalBatchNo: '471', kgReceived: 3765, pricePerKg: 5.2, kgMeat: 1278.5,
      slaughterDate: '2026-08-10', expiryDate: '2026-08-17',
      materialName: 'Ćwiartka z kurczaka', supplierBatches: [] },
  ] as any,
  ...over,
})

describe('shortSupplier', () => {
  it('obcina formę prawną, zostawia nazwę', () => {
    expect(shortSupplier('KOKO SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ')).toBe('KOKO')
    expect(shortSupplier('"FARMEX" SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ')).toBe('FARMEX')
    expect(shortSupplier('PS INWEST PLUS SP. Z O.O.')).toBe('PS INWEST PLUS')
  })

  it('nazwę bez formy prawnej zostawia w spokoju', () => {
    expect(shortSupplier('PERFECT MEAT')).toBe('PERFECT MEAT')
  })
})

describe('plDate / plNum', () => {
  it('formatuje datę po polsku', () => {
    expect(plDate('2026-08-11')).toBe('11.08.2026')
  })

  it('pusta albo niepełna data daje pustą kratkę, nie „Invalid Date"', () => {
    expect(plDate('')).toBe('')
    expect(plDate('brak')).toBe('')
  })

  it('zero to pusta kratka — na karcie nie pisze się 0 kg', () => {
    expect(plNum(0)).toBe('')
    expect(plNum(5235)).toBe('5235')
  })
})

describe('mainRows — karta 1.1.1', () => {
  it('jeden wiersz na dostawę, kolumny a–e z systemu', () => {
    const [row] = mainRows([rec()], 13)
    expect(row.slice(0, 5)).toEqual([
      '1/08/2026', 'KOKO', 'Ćwiartka z kurczaka', '11.08.2026',
      'HDI 33656 / WZ 27/MDU/08/2026',
    ])
  })

  it('kolumny oceny zostają PUSTE — to zapis z pomiaru, nie z bazy', () => {
    const [row] = mainRows([rec()], 13)
    expect(row).toHaveLength(13)
    expect(row.slice(5)).toEqual(Array(8).fill(''))
  })

  it('asortyment bez powtórzeń — dwie ćwiartki to nadal jeden asortyment', () => {
    expect(mainRows([rec()], 13)[0][2]).toBe('Ćwiartka z kurczaka')
  })

  it('sortuje chronologicznie, nie kolejnością z API', () => {
    const rows = mainRows([
      rec({ id: 'b', receptionNo: '2/08/2026', receivedDate: '2026-08-12' }),
      rec({ id: 'a', receptionNo: '1/08/2026', receivedDate: '2026-08-11' }),
    ], 13)
    expect(rows.map(r => r[0])).toEqual(['1/08/2026', '2/08/2026'])
  })
})

describe('documentLabel — kolumna (e)', () => {
  it('podaje oba numery: HDI i dokument handlowy', () => {
    expect(documentLabel('33656', 'WZ 388/MDU/08/2026')).toBe('HDI 33656 / WZ 388/MDU/08/2026')
  })

  it('radzi sobie, gdy dostawca podał tylko jeden z nich', () => {
    expect(documentLabel('33656', '')).toBe('HDI 33656')
    expect(documentLabel('', 'FS 24411/MAG/2026')).toBe('FS 24411/MAG/2026')
    expect(documentLabel('', '')).toBe('')
  })
})

describe('detailRows — karta 1.1.1/2', () => {
  it('jeden wiersz na numer porządkowy, pod wspólnym numerem przyjęcia', () => {
    const rows = detailRows([rec()], 9)
    expect(rows).toHaveLength(2)
    expect(rows[0].slice(0, 6)).toEqual(
      ['1/08/2026', '470', '5235', '10.08.2026', '17.08.2026', '5,2'])
    expect(rows[1][0]).toBe('1/08/2026')
    expect(rows[1][1]).toBe('471')
  })

  it('„Mięso [kg]" wchodzi z rozbioru — na koniec miesiąca jest już znane', () => {
    const rows = detailRows([rec()], 9)
    expect(rows[0][6]).toBe('3439,5')
    // Uwagi i podpis zostają ręczne.
    expect(rows[0].slice(7)).toEqual(['', ''])
  })

  it('partia jeszcze nierozebrana zostawia kratkę pustą, nie zero', () => {
    const r = rec()
    const rows = detailRows([{ ...r, batches: [{ ...r.batches[0], kgMeat: 0 }] as any }], 9)
    expect(rows[0][6]).toBe('')
  })
})

describe('anulowane rejestracje', () => {
  const zAnulowana = () => rec({
    batches: [
      { internalBatchNo: '466', kgReceived: 10005, pricePerKg: 5.2, kgMeat: 6659,
        slaughterDate: '2026-08-06', expiryDate: '2026-08-13', status: 'active',
        materialName: 'Ćwiartka z kurczaka', supplierBatches: [] },
      { internalBatchNo: 'ANUL-70fe21e146e24f8fa175', kgReceived: 4005, pricePerKg: 5.2,
        kgMeat: 0, slaughterDate: '2026-08-06', expiryDate: '2026-08-13',
        status: 'cancelled', materialName: 'Ćwiartka z kurczaka', supplierBatches: [] },
    ] as any,
  })

  it('nie trafiają na kartę szczegółową — to korekta wpisu, nie dostawa', () => {
    const rows = detailRows([zAnulowana()], 9)
    expect(rows).toHaveLength(1)
    expect(rows[0][1]).toBe('466')
  })

  it('dostawa złożona z samych anulowanych znika z karty 1.1.1', () => {
    const r = rec()
    const same = { ...r, batches: r.batches.map(b => ({ ...b, status: 'cancelled' })) } as any
    expect(mainRows([same], 13)).toEqual([])
  })
})

describe('surowiec bez rozbioru', () => {
  it('filet sam jest mięsem — w kolumnie „Mięso [kg]" stoi waga dostawy', () => {
    // Backend ustawia kgMeat = kgReceived dla surowca, który nie idzie na
    // rozbiór; wydruk ma pokazać wagę, a nie pustkę jak przy nieprzerobionej.
    const filet = rec({
      batches: [{ internalBatchNo: '465', kgReceived: 816, pricePerKg: 14.5,
        kgMeat: 816, slaughterDate: '2026-08-05', expiryDate: '2026-08-12',
        materialName: 'Filet z kurczaka', supplierBatches: [] }] as any,
    })
    expect(detailRows([filet], 9)[0][6]).toBe('816')
  })
})

describe('paginate', () => {
  it('tnie wiersze na kartki', () => {
    const pages = paginate([1, 2, 3, 4, 5], 2)
    expect(pages).toEqual([[1, 2], [3, 4], [5]])
  })

  it('miesiąc bez dostaw daje jedną PUSTĄ kartę do wypełnienia ręcznie', () => {
    expect(paginate([], 12)).toEqual([[]])
  })
})
