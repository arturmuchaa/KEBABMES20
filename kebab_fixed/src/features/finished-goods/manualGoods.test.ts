import { describe, it, expect } from 'vitest'
import { manualGoodsIssues, manualGoodsPayload, remainingOnLine, type ManualGoodsForm } from './manualGoods'

const form = (over: Partial<ManualGoodsForm> = {}): ManualGoodsForm => ({
  qty: '10', kgPerUnit: '35', producedDate: '2026-08-25',
  recipeId: 'r1', recipeName: 'WROCŁAW',
  productTypeId: 'pt1', productTypeName: 'KEBAB',
  packagingId: 't1', packagingName: 'METAL 65',
  clientId: '', clientName: '', clientOrderNo: '',
  batchNos: ['344'], consumeSeasoned: true, ...over,
})

describe('manualGoodsIssues — czego pilnujemy przed zapisem', () => {
  it('poprawny wpis nie ma zastrzeżeń', () => {
    expect(manualGoodsIssues(form())).toEqual([])
  })

  it('bez receptury nie wiadomo, co powstało', () => {
    expect(manualGoodsIssues(form({ recipeId: '' }))[0]).toMatch(/receptur/i)
  })

  it('zero sztuk albo zero kilogramów to nie jest wyrób', () => {
    expect(manualGoodsIssues(form({ qty: '0' }))[0]).toMatch(/sztuk/i)
    expect(manualGoodsIssues(form({ kgPerUnit: '0' }))[0]).toMatch(/wag/i)
  })

  it('bez daty produkcji nie da się nadać numeru partii', () => {
    expect(manualGoodsIssues(form({ producedDate: '' }))[0]).toMatch(/dat/i)
  })

  it('zdjęcie mięsa bez wskazanej partii nie ma z czego zejść', () => {
    expect(manualGoodsIssues(form({ batchNos: [], consumeSeasoned: true }))[0]).toMatch(/parti/i)
  })

  it('bez partii, ale i bez zdejmowania mięsa — wolno (historia)', () => {
    expect(manualGoodsIssues(form({ batchNos: [], consumeSeasoned: false }))).toEqual([])
  })
})

describe('manualGoodsPayload — co leci na backend', () => {
  it('przepisuje pola wprost, liczby jako liczby', () => {
    expect(manualGoodsPayload(form())).toMatchObject({
      qty: 10, kgPerUnit: 35, recipeId: 'r1', packagingId: 't1',
      seasonedBatchNos: ['344'], consumeSeasoned: true, producedDate: '2026-08-25',
    })
  })

  it('pilnuje powiązania z zamówieniem — numer i klient idą razem', () => {
    const p = manualGoodsPayload(form({ clientOrderNo: 'ZAM/1', clientName: 'Bulli', clientId: 'c1' }))
    expect(p).toMatchObject({ clientOrderNo: 'ZAM/1', clientName: 'Bulli', clientId: 'c1' })
  })

  it('nie wysyła numeru partii — liczy go backend z daty i wsadu', () => {
    expect(manualGoodsPayload(form())).not.toHaveProperty('batchNo')
  })

  it('przecinek w wadze czyta się jak kropkę — tak wpisuje biuro', () => {
    expect(manualGoodsPayload(form({ kgPerUnit: '17,5' })).kgPerUnit).toBe(17.5)
  })
})

describe('remainingOnLine — ile jeszcze brakuje na pozycji zamówienia', () => {
  it('odejmuje to, co już zrobione', () => {
    expect(remainingOnLine({ qty: 20, qtyDone: 8 })).toBe(12)
  })

  it('nadwyżka nie schodzi poniżej zera', () => {
    expect(remainingOnLine({ qty: 20, qtyDone: 25 })).toBe(0)
  })

  it('brak danych to nie ujemna liczba', () => {
    expect(remainingOnLine({} as any)).toBe(0)
  })
})
