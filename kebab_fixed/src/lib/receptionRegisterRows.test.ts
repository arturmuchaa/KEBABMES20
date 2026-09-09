import { describe, it, expect } from 'vitest'
import {
  chwilaPodpisu, detailRows, documentLabel, mainRows, paginate, plDate, plNum,
  shortSupplier,
} from './receptionRegisterRows'
import type { Reception } from '@/types'

const rec = (over: Partial<Reception> = {}): Reception => ({
  id: 'r1',
  receptionNo: '1/08',
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
  it('jeden wiersz na dostawę, kolumny a–f z systemu', () => {
    // Trzy RÓŻNE numery i każdy ma swoją kolumnę: miesięczny (a) to numer
    // dostawy w miesiącu, zewnętrzny (b) to numery porządkowe partii,
    // a numer dokumentu przywozowego stoi dopiero w (f).
    const [row] = mainRows([rec()], 14)
    expect(row.slice(0, 6)).toEqual([
      '1/08', '470, 471', 'KOKO', 'Ćwiartka z kurczaka', '11.08.2026',
      'HDI 33656\nWZ 27/MDU/08/2026',
    ])
  })

  it('kolumny oceny zostają PUSTE — to zapis z pomiaru, nie z bazy', () => {
    const [row] = mainRows([rec()], 14)
    expect(row).toHaveLength(14)
    expect(row.slice(6)).toEqual(Array(8).fill(''))
  })

  it('asortyment bez powtórzeń — dwie ćwiartki to nadal jeden asortyment', () => {
    expect(mainRows([rec()], 14)[0][3]).toBe('Ćwiartka z kurczaka')
  })

  it('blok mrożony dopisuje stan do asortymentu', () => {
    // Bez tego temperatura −15 °C wpisana obok wygląda jak błąd wobec progu
    // +7 °C z legendy. Stan zna system, więc nie każemy go dopisywać ręką.
    const mrozona = rec({ batches: [
      { internalBatchNo: '512', kgReceived: 900, pricePerKg: 18, kgMeat: 0,
        slaughterDate: '', expiryDate: '2027-02-01',
        materialName: 'Wołowina 80/20', storageState: 'mrozony',
        supplierBatches: [] },
    ] as any })
    expect(mainRows([mrozona], 14)[0][3]).toBe('Wołowina 80/20 (mrożona)')
  })

  it('surowiec chłodzony NIE dostaje dopisku — to stan domyślny', () => {
    const chlodzona = rec({ batches: [
      { internalBatchNo: '513', kgReceived: 400, pricePerKg: 22, kgMeat: 0,
        slaughterDate: '', expiryDate: '2026-09-10',
        materialName: 'Dolna zrazowa wołowa', storageState: 'chlodzony',
        supplierBatches: [] },
    ] as any })
    expect(mainRows([chlodzona], 14)[0][3]).toBe('Dolna zrazowa wołowa')
  })

  it('auto z chłodzonym i mrożonym pokazuje oba osobno', () => {
    const mieszana = rec({ batches: [
      { internalBatchNo: '514', kgReceived: 900, pricePerKg: 18, kgMeat: 0,
        slaughterDate: '', expiryDate: '2027-02-01',
        materialName: 'Wołowina 80/20', storageState: 'mrozony', supplierBatches: [] },
      { internalBatchNo: '515', kgReceived: 300, pricePerKg: 9, kgMeat: 0,
        slaughterDate: '', expiryDate: '2026-09-05',
        materialName: 'Łój wołowy otokowy', storageState: 'chlodzony', supplierBatches: [] },
    ] as any })
    expect(mainRows([mieszana], 14)[0][3])
      .toBe('Wołowina 80/20 (mrożona), Łój wołowy otokowy')
  })

  it('sortuje chronologicznie, nie kolejnością z API', () => {
    const rows = mainRows([
      rec({ id: 'b', receptionNo: '2/08', receivedDate: '2026-08-12' }),
      rec({ id: 'a', receptionNo: '1/08', receivedDate: '2026-08-11' }),
    ], 14)
    expect(rows.map(r => r[0])).toEqual(['1/08', '2/08'])
  })
})

describe('documentLabel — kolumna (f)', () => {
  it('podaje oba numery: HDI i dokument handlowy', () => {
    // Właściciel (2026-09-09): „jak są dwa dokumenty, jak np. KOKO, to HDI
    // numer i pod spodem WZ numer — nie w jednej linijce".
    expect(documentLabel('33656', 'WZ 388/MDU/08/2026'))
      .toBe('HDI 33656\nWZ 388/MDU/08/2026')
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
      ['1/08', '470', '5235', '10.08.2026', '17.08.2026', '5,2'])
    expect(rows[1][0]).toBe('1/08')
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
    expect(mainRows([same], 14)).toEqual([])
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

// ── Kolumny oceny (g-l) — dane z kontroli HACCP dostawy ────────────────
//
// Do 31.08.2026 karta drukowała się z pustymi kolumnami f-m i zakład
// dopisywał je długopisem. Od wprowadzenia `reception_checks` system je
// zna i ma wydrukować — pusta kratka zostaje tylko tam, gdzie naprawdę
// nie było pomiaru.
const wpis = {
  receptionId: 'r1', visual: 'bz', tempChamber: 2.5, tempMeat: 3.1,
  kgMatch: 'bz', notes: 'brak uwag', verdict: 'K',
  ncDescription: '', ncAction: '', ncAt: null,
} as any

describe('mainRows — kolumny oceny (g-l)', () => {
  it('bez wpisu kolumny g-l zostają puste', () => {
    const [row] = mainRows([rec()], 14)
    expect(row.slice(6, 12)).toEqual(['', '', '', '', '', ''])
  })

  it('wpis wypełnia ocenę, temperatury, zgodność, uwagi i kwalifikację', () => {
    const [row] = mainRows([rec()], 14, { r1: wpis })
    expect(row[6]).toBe('b/z')        // g — ocena wizualna
    expect(row[7]).toBe('2,5')        // h — komora
    expect(row[8]).toBe('3,1')        // i — mięso
    expect(row[9]).toBe('b/z')        // j — zgodność kg
    expect(row[10]).toBe('brak uwag') // k
    expect(row[11]).toBe('K')         // l — kwalifikacja
  })

  it('temperatura 0 °C drukuje się jako „0", nie jako pusta kratka', () => {
    const [row] = mainRows([rec()], 14, { r1: { ...wpis, tempChamber: 0 } })
    expect(row[7]).toBe('0')
  })

  it('temperatura ujemna (blok mrożony) drukuje się ze znakiem', () => {
    const [row] = mainRows([rec()], 14, { r1: { ...wpis, tempChamber: -18.5 } })
    expect(row[7]).toBe('-18,5')
  })

  it('ocena N drukuje się jako N', () => {
    const [row] = mainRows([rec()], 14, { r1: { ...wpis, visual: 'N' } })
    expect(row[6]).toBe('N')
  })

  it('wpis innej dostawy nie wypełnia tego wiersza', () => {
    const [row] = mainRows([rec()], 14, { INNA: wpis })
    expect(row.slice(6, 12)).toEqual(['', '', '', '', '', ''])
  })
})

// ── Kolumny podpisu (l-m) ──────────────────────────────────────────
//
// Podpis unieważniony (dane zmieniono po podpisaniu) NIE dociera tutaj —
// backend oddaje tylko aktywne. Pusta kratka jest uczciwa; podpis pod
// zmienioną treścią nie jest.
const wpisZPodpisami = {
  ...wpis,
  signatures: {
    wykonal:   { png: 'data:image/png;base64,AAA' },
    sprawdzil: { png: 'data:image/png;base64,BBB' },
  },
} as any

describe('mainRows — podpisy (m-n)', () => {
  it('bez podpisów kratki m-n zostają puste', () => {
    const [row] = mainRows([rec()], 14, { r1: wpis })
    expect(row[12]).toBe('')
    expect(row[13]).toBe('')
  })

  it('podpisy trafiają jako obrazki, nie tekst', () => {
    const [row] = mainRows([rec()], 14, { r1: wpisZPodpisami })
    expect((row[12] as any).png).toBe('data:image/png;base64,AAA')
    expect((row[13] as any).png).toBe('data:image/png;base64,BBB')
  })

  it('kratka niesie też nazwisko i chwilę podpisu', () => {
    // Sam rysunek nie dowodzi niczego — kontrola czyta KTO i KIEDY.
    const zDanymi = {
      ...wpis,
      signatures: {
        wykonal: {
          png: 'data:image/png;base64,AAA',
          signerName: 'Artur Mucha',
          signedAt: '2026-09-02T20:19:31',
        },
      },
    } as any
    const [row] = mainRows([rec()], 14, { r1: zDanymi })
    expect((row[12] as any).name).toBe('Artur Mucha')
    expect((row[12] as any).when).toBe('02.09.2026 20:19')
  })

  it('sam podpis wykonał zostawia kratkę sprawdził pustą', () => {
    const jeden = { ...wpis, signatures: { wykonal: { png: 'data:image/png;base64,AAA' } } } as any
    const [row] = mainRows([rec()], 14, { r1: jeden })
    expect((row[12] as any).png).toBe('data:image/png;base64,AAA')
    expect(row[13]).toBe('')
  })
})

describe('detailRows — kolumna podpisu karty 1.1.1/2', () => {
  it('podpis „wykonał" powtarza się przy każdym numerze porządkowym', () => {
    const rows = detailRows([rec()], 9, { r1: wpisZPodpisami })
    expect(rows).toHaveLength(2)
    expect((rows[0][8] as any).png).toBe('data:image/png;base64,AAA')
    expect((rows[1][8] as any).png).toBe('data:image/png;base64,AAA')
  })

  it('bez podpisu kolumna zostaje pusta', () => {
    const rows = detailRows([rec()], 9)
    expect(rows[0][8]).toBe('')
  })
})

// ── Data i godzina przy podpisie ────────────────────────────────────
// Papierowa karta zawsze miała datę przy parafce i kontrola jej szuka.
// Sam rysunek nie dowodzi niczego — dowodem jest KTO i KIEDY.
describe('chwilaPodpisu', () => {
  it('formatuje po polsku, do minuty', () => {
    const out = chwilaPodpisu('2026-09-02T20:19:31')
    expect(out).toBe('02.09.2026 20:19')
  })

  it('dopełnia zerami — 3 września to 03.09', () => {
    expect(chwilaPodpisu('2026-09-03T08:05:00')).toBe('03.09.2026 08:05')
  })

  it('BEZ sekund — na karcie liczy się czy i kiedy, sekundy ma protokół', () => {
    expect(chwilaPodpisu('2026-09-02T20:19:31')).not.toMatch(/:31/)
  })

  it('brak daty nie psuje kratki', () => {
    expect(chwilaPodpisu(null)).toBe('')
    expect(chwilaPodpisu(undefined)).toBe('')
    expect(chwilaPodpisu('')).toBe('')
  })

  it('śmieć zamiast daty daje pustkę, nie „Invalid Date"', () => {
    expect(chwilaPodpisu('nie-data')).toBe('')
  })
})


// ── Numer przyjęcia zewnętrzny — kolumna (b) ──────────────────────────
//
// Właściciel (2026-09-09): „zwróć uwagę, że tam mamy numer przyjęcia
// i numer przyjęcia miesięczny i numer przyjęcia zewnętrznego".
// Karta 1.1.1 miała dotąd JEDNĄ kolumnę na numer i myliła te pojęcia:
//   * (a) miesięczny — numer dostawy w miesiącu, „10/09",
//   * (b) zewnętrzny — numery porządkowe partii, „534, 535",
//   * (f) dokument przywozowy — HDI i WZ dostawcy.
describe('externalNo — kolumna (b)', () => {
  it('podaje numery porządkowe dostawy, po przecinku', () => {
    expect(mainRows([rec()], 14)[0][1]).toBe('470, 471')
  })

  it('jedna partia to jeden numer', () => {
    const jedna = rec({ batches: [
      { internalBatchNo: '534', kgReceived: 900, pricePerKg: 5, kgMeat: 600,
        slaughterDate: '2026-09-01', expiryDate: '2026-09-08',
        materialName: 'Ćwiartka z kurczaka', supplierBatches: [] },
    ] as any })
    expect(mainRows([jedna], 14)[0][1]).toBe('534')
  })

  it('nie powtarza tego samego numeru dwa razy', () => {
    const dubel = rec({ batches: [
      { internalBatchNo: '534', kgReceived: 500, pricePerKg: 5, kgMeat: 300,
        slaughterDate: '2026-09-01', expiryDate: '2026-09-08',
        materialName: 'Ćwiartka z kurczaka', supplierBatches: [] },
      { internalBatchNo: '534', kgReceived: 400, pricePerKg: 5, kgMeat: 200,
        slaughterDate: '2026-09-01', expiryDate: '2026-09-08',
        materialName: 'Łój wołowy', supplierBatches: [] },
    ] as any })
    expect(mainRows([dubel], 14)[0][1]).toBe('534')
  })

  it('numer miesięczny zostaje w kolumnie (a), osobno od zewnętrznego', () => {
    const [row] = mainRows([rec({ receptionNo: '10/09' })], 14)
    expect(row[0]).toBe('10/09')
    expect(row[1]).toBe('470, 471')
  })
})

describe('documentLabel — dwa dokumenty pod sobą', () => {
  it('KOKO: HDI w pierwszej linii, WZ w drugiej', () => {
    expect(documentLabel('34212', 'WZ 194/MDU/09/2026').split('\n'))
      .toEqual(['HDI 34212', 'WZ 194/MDU/09/2026'])
  })

  it('jeden dokument to JEDNA linia, bez pustej', () => {
    expect(documentLabel('', '04092026').split('\n')).toEqual(['04092026'])
    expect(documentLabel('34212', '').split('\n')).toEqual(['HDI 34212'])
  })

  it('brak obu daje pustą kratkę', () => {
    expect(documentLabel('', '')).toBe('')
  })
})
