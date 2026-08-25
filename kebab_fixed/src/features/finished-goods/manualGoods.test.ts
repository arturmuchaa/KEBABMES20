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

// ── Grupowanie po kliencie i koszyk ──────────────────────────────────────
import { groupLinesByClient, cartTotals } from './manualGoods'

const zam = (over: any = {}) => ({
  id: 'o1', orderNo: 'ZAM/1', clientId: 'c1', clientName: 'Bulli', status: 'new',
  lines: [{ id: 'ol1', qty: 20, qtyDone: 8, kgPerUnit: 35, recipeId: 'r1', recipeName: 'WROCŁAW' }],
  ...over,
})

describe('groupLinesByClient', () => {
  it('składa pozycje w grupy klientów', () => {
    const g = groupLinesByClient([
      zam(),
      zam({ id: 'o2', orderNo: 'ZAM/2', lines: [{ id: 'ol2', qty: 5, qtyDone: 0, kgPerUnit: 40, recipeId: 'r1' }] }),
      zam({ id: 'o3', orderNo: 'ZAM/3', clientId: 'c2', clientName: 'Zagros',
            lines: [{ id: 'ol3', qty: 6, qtyDone: 0, kgPerUnit: 40, recipeId: 'r2' }] }),
    ])
    expect(g.map(x => x.clientName)).toEqual(['Bulli', 'Zagros'])
    expect(g[0].lines.map(l => l.id)).toEqual(['ol1', 'ol2'])
  })

  it('pomija zamówienia zamknięte — nie ma ich po co produkować', () => {
    const g = groupLinesByClient([zam({ status: 'done' }), zam({ id: 'o2', status: 'cancelled' })])
    expect(g).toEqual([])
  })

  it('każda pozycja niesie numer zamówienia — po nim liczy się pokrycie', () => {
    expect(groupLinesByClient([zam()])[0].lines[0]).toMatchObject({ orderNo: 'ZAM/1', orderId: 'o1' })
  })

  it('grupa podaje, ile kg jeszcze brakuje u tego klienta', () => {
    expect(groupLinesByClient([zam()])[0].kgLeft).toBe(420)   // 12 szt. × 35 kg
  })

  it('klienci po alfabecie, żeby lista nie skakała między odświeżeniami', () => {
    const g = groupLinesByClient([
      zam({ clientId: 'c9', clientName: 'Zagros' }),
      zam({ id: 'o2', clientId: 'c1', clientName: 'Alfa' }),
    ])
    expect(g.map(x => x.clientName)).toEqual(['Alfa', 'Zagros'])
  })

  it('znosi śmieci z API', () => {
    expect(groupLinesByClient(null as any)).toEqual([])
    expect(groupLinesByClient([{ id: 'o1', status: 'new' } as any])).toEqual([])
  })
})

describe('cartTotals', () => {
  it('liczy pozycje, sztuki i kilogramy', () => {
    expect(cartTotals([
      { qty: 12, kgPerUnit: 35 } as any,
      { qty: 6, kgPerUnit: 40 } as any,
    ])).toEqual({ pozycje: 2, sztuki: 18, kg: 660 })
  })

  it('pusty koszyk to zera, nie NaN', () => {
    expect(cartTotals([])).toEqual({ pozycje: 0, sztuki: 0, kg: 0 })
  })

  it('kilogramy zaokrągla do dwóch miejsc', () => {
    expect(cartTotals([{ qty: 3, kgPerUnit: 17.53 } as any]).kg).toBe(52.59)
  })
})

// ── Numer partii: co dokładnie stanie na wyrobie ─────────────────────────
import { ddmmrr, batchNoPreview, normalizeManualBatchNo } from './manualGoods'

describe('ddmmrr', () => {
  it('data produkcji w formacie numeru partii', () => {
    expect(ddmmrr('2026-08-23')).toBe('230826')
  })

  it('pusta albo popsuta data nie udaje numeru', () => {
    expect(ddmmrr('')).toBe('')
    expect(ddmmrr('nie-data')).toBe('')
  })
})

describe('normalizeManualBatchNo — biuro wpisuje sam numer porządkowy', () => {
  it('goły numer dostaje datę produkcji z przodu', () => {
    expect(normalizeManualBatchNo('456', '2026-08-23')).toBe('230826 456')
  })

  it('pełny numer zostaje bez zmian — nie doklejamy daty drugi raz', () => {
    expect(normalizeManualBatchNo('230826 456', '2026-08-23')).toBe('230826 456')
  })

  it('numer z literami (PP13, PM2) też dostaje datę', () => {
    expect(normalizeManualBatchNo('PP13', '2026-08-23')).toBe('230826 PP13')
  })

  it('spacje na brzegach nie robią różnicy', () => {
    expect(normalizeManualBatchNo('  456 ', '2026-08-23')).toBe('230826 456')
  })

  it('bez daty produkcji oddaje to, co wpisano', () => {
    expect(normalizeManualBatchNo('456', '')).toBe('456')
  })

  it('pusty wpis zostaje pusty', () => {
    expect(normalizeManualBatchNo('', '2026-08-23')).toBe('')
  })
})

describe('batchNoPreview — co stanie na wyrobie', () => {
  it('jeden wsad z masowni: data + numer wsadu', () => {
    expect(batchNoPreview({ mode: 'masownia', batchNos: ['344'], manual: '', producedDate: '2026-08-25' }))
      .toBe('250826 344')
  })

  it('kilka wsadów: numer mieszany PM nada system', () => {
    expect(batchNoPreview({ mode: 'masownia', batchNos: ['344', 'PP13'], manual: '', producedDate: '2026-08-25' }))
      .toBe('250826 PM… (numer nada system)')
  })

  it('bez wskazanego wsadu nie ma czego pokazać', () => {
    expect(batchNoPreview({ mode: 'masownia', batchNos: [], manual: '', producedDate: '2026-08-25' })).toBe('—')
  })

  it('tryb ręczny pokazuje numer po doklejeniu daty', () => {
    expect(batchNoPreview({ mode: 'recznie', batchNos: [], manual: '456', producedDate: '2026-08-23' }))
      .toBe('230826 456')
  })
})
