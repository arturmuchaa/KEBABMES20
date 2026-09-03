import { describe, expect, it } from 'vitest'
import { chwila, etykietaRoli, konkluzja, opisStanu, stanPodpisu } from './weryfikacjaPodpisow'

const p = (over: Partial<any> = {}): any => ({
  role: 'wykonal', signerName: 'Artur Mucha', workerId: 'w-1',
  signedAt: '2026-09-02T19:32:11Z', contentHash: 'abc', zgodny: true,
  active: true, supersededAt: null, ...over,
})
const v = (podpisy: any[]): any => ({
  docType: 'reception_check', docId: 'r1', receptionNo: '4/09',
  supplierName: 'KOKO', receivedDate: '2026-09-02', tresc: 'x',
  currentHash: 'abc', algorytm: 'SHA-256', signatures: podpisy,
})

describe('stanPodpisu', () => {
  it('aktywny i zgodny to podpis ważny', () => {
    expect(stanPodpisu(p())).toBe('wazny')
  })

  it('unieważniony jest unieważniony, choćby hash się zgadzał', () => {
    expect(stanPodpisu(p({ active: false, zgodny: true }))).toBe('uniewazniony')
  })

  it('aktywny z niezgodnym hashem to sygnał awarii, nie „ważny"', () => {
    // Stan teoretycznie niemożliwy. Gdyby wystąpił, protokół ma o nim
    // krzyczeć — zamilczenie takiej rozbieżności jest gorsze niż błąd.
    expect(stanPodpisu(p({ zgodny: false }))).toBe('rozjechany')
  })
})

describe('opisStanu — zdania dla kontroli', () => {
  it('unieważniony tłumaczy PRZYCZYNĘ, nie tylko fakt', () => {
    expect(opisStanu('uniewazniony')).toMatch(/zmieniono po podpisaniu/i)
  })
  it('ważny mówi, że dotyczy aktualnej treści', () => {
    expect(opisStanu('wazny')).toMatch(/aktualnej treści/i)
  })
  it('rozjechany prosi o wyjaśnienie', () => {
    expect(opisStanu('rozjechany')).toMatch(/wyjaśnienia/i)
  })
})

describe('etykietaRoli', () => {
  it('nazywa kolumny karty 1.1.1', () => {
    expect(etykietaRoli('wykonal')).toMatch(/Wykonał/)
    expect(etykietaRoli('wykonal')).toMatch(/l\)/)
    expect(etykietaRoli('sprawdzil')).toMatch(/Sprawdził/)
  })
  it('nieznanej roli nie zmyśla', () => {
    expect(etykietaRoli('cokolwiek')).toBe('cokolwiek')
  })
})

describe('chwila', () => {
  it('pusty czas nie psuje protokołu', () => {
    expect(chwila(null)).toBe('')
    expect(chwila('nie-data')).toBe('')
  })
  it('formatuje po polsku', () => {
    expect(chwila('2026-09-02T19:32:11Z')).toMatch(/2026/)
  })
})

describe('konkluzja', () => {
  it('obie kolumny podpisane', () => {
    expect(konkluzja(v([p(), p({ role: 'sprawdzil' })])))
      .toMatch(/podpisany w obu kolumnach/i)
  })
  it('jedna kolumna to podpis CZĘŚCIOWY', () => {
    expect(konkluzja(v([p()]))).toMatch(/częściowo/i)
  })
  it('same unieważnione mówią, co się stało', () => {
    expect(konkluzja(v([p({ active: false })]))).toMatch(/unieważnione/i)
  })
  it('brak podpisów to brak podpisów, nie błąd', () => {
    expect(konkluzja(v([]))).toMatch(/nie został jeszcze podpisany/i)
  })
  it('podpis rozjechany NIE liczy się jako ważny', () => {
    expect(konkluzja(v([p({ zgodny: false }), p({ role: 'sprawdzil', zgodny: false })])))
      .not.toMatch(/podpisany w obu kolumnach/i)
  })
  it('brak danych nie wywraca ekranu', () => {
    expect(konkluzja(null)).toBe('')
  })
})
