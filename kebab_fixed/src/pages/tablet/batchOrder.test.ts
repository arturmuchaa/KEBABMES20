/**
 * Testy scalania własnej kolejności partii z porządkiem FEFO.
 *
 * Scenariusz z hali (2026-08-07): na stanie 466, 467, 468. FEFO stawia 466
 * pierwszą (najkrótszy termin), ale zakład zaczyna ją dopiero jutro — operator
 * myli się i klika skrajnie lewy kafel. Hala układa pasek 467, 468, 466.
 */
import { describe, it, expect } from 'vitest'
import { mergeBatchOrder, moveBatch, type OrderableBatch } from './batchOrder'

function b(no: string, expiry: string, seq = Number(no)): OrderableBatch {
  return { internalBatchNo: no, expiryDate: expiry, internalBatchSeq: seq }
}

// FEFO: 466 (10.08) < 467 (12.08) < 468 (14.08)
const B466 = b('466', '2026-08-10')
const B467 = b('467', '2026-08-12')
const B468 = b('468', '2026-08-14')

describe('mergeBatchOrder', () => {
  it('bez zapisanej kolejności zachowuje czyste FEFO', () => {
    const out = mergeBatchOrder([B468, B466, B467], [])
    expect(out.map(x => x.internalBatchNo)).toEqual(['466', '467', '468'])
  })

  it('zapisana kolejność wygrywa z FEFO', () => {
    const out = mergeBatchOrder([B466, B467, B468], ['467', '468', '466'])
    expect(out.map(x => x.internalBatchNo)).toEqual(['467', '468', '466'])
  })

  it('nowa dostawa spoza konfiguracji ląduje na końcu', () => {
    const B469 = b('469', '2026-08-16')
    const out = mergeBatchOrder([B466, B467, B468, B469], ['467', '468', '466'])
    expect(out.map(x => x.internalBatchNo)).toEqual(['467', '468', '466', '469'])
  })

  it('kilka partii spoza konfiguracji jest między sobą FEFO', () => {
    const B470 = b('470', '2026-08-20')
    const B469 = b('469', '2026-08-16')
    const out = mergeBatchOrder([B470, B469, B467], ['467'])
    expect(out.map(x => x.internalBatchNo)).toEqual(['467', '469', '470'])
  })

  it('numer z konfiguracji nieobecny na liście jest pomijany', () => {
    // 466 zeszła w całości i zniknęła z paska — konfiguracja jej nie wskrzesza
    const out = mergeBatchOrder([B467, B468], ['467', '468', '466'])
    expect(out.map(x => x.internalBatchNo)).toEqual(['467', '468'])
  })

  it('przy równych datach ważności rozstrzyga numer partii (jak dziś)', () => {
    const x = b('480', '2026-08-12', 480)
    const y = b('479', '2026-08-12', 479)
    const out = mergeBatchOrder([x, y], [])
    expect(out.map(v => v.internalBatchNo)).toEqual(['479', '480'])
  })

  it('nie mutuje tablicy wejściowej', () => {
    const rows = [B468, B466, B467]
    mergeBatchOrder(rows, ['467'])
    expect(rows.map(x => x.internalBatchNo)).toEqual(['468', '466', '467'])
  })

  it('znosi duplikaty w zapisanej kolejności', () => {
    const out = mergeBatchOrder([B466, B467], ['467', '467', '466'])
    expect(out.map(x => x.internalBatchNo)).toEqual(['467', '466'])
  })

  it('pusta lista partii daje pustą listę', () => {
    expect(mergeBatchOrder([], ['467'])).toEqual([])
  })
})

describe('mergeBatchOrder — przestawianie', () => {
  it('kolejność po przeniesieniu kafla na koniec odpowiada zapisowi', () => {
    // operator przytrzymał 466 i przeciągnął na koniec
    const nowa = ['467', '468', '466']
    const out = mergeBatchOrder([B466, B467, B468], nowa)
    expect(out.map(x => x.internalBatchNo)).toEqual(nowa)
  })
})

describe('moveBatch', () => {
  const l = () => ['466', '467', '468']

  it('przesuwa element w prawo', () => {
    expect(moveBatch(l(), 0, 2)).toEqual(['467', '468', '466'])
  })

  it('przesuwa element w lewo', () => {
    expect(moveBatch(l(), 2, 0)).toEqual(['468', '466', '467'])
  })

  it('przesunięcie na własną pozycję nic nie zmienia', () => {
    expect(moveBatch(l(), 1, 1)).toEqual(['466', '467', '468'])
  })

  it('cel poza zakresem przycina się do końca listy', () => {
    expect(moveBatch(l(), 0, 99)).toEqual(['467', '468', '466'])
  })

  it('ujemny cel przycina się do początku', () => {
    expect(moveBatch(l(), 2, -5)).toEqual(['468', '466', '467'])
  })

  it('źródło poza zakresem zwraca listę bez zmian', () => {
    expect(moveBatch(l(), 7, 0)).toEqual(['466', '467', '468'])
  })

  it('nie mutuje wejścia', () => {
    const rows = l()
    moveBatch(rows, 0, 2)
    expect(rows).toEqual(['466', '467', '468'])
  })
})
