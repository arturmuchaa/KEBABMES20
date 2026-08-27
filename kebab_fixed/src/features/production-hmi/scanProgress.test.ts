/**
 * Próg skanu — ile z pozycji wolno jeszcze poprawić.
 *
 * Reguła hali: dopóki sztuka nie jest zeskanowana, jest tylko liczbą na
 * ekranie i wolno ją odjąć. Po skanie leży na magazynie wyrobu gotowego —
 * wtedy zostaje wyłącznie przepisanie pracy komu innemu.
 */
import { describe, it, expect } from 'vitest'

import { isConfirmed, lineScanState, removablePieces, scanOf } from './scanProgress'

const linia = (over: any = {}) => ({ id: 'l1', qty: 20, qtyDone: 12, ...over })

describe('scanOf', () => {
  it('pozycja bez wygenerowanych sztuk ma zerowy skan, a nie undefined', () => {
    expect(scanOf({}, 'l1')).toEqual({ total: 0, scanned: 0 })
    expect(scanOf(undefined, 'l1')).toEqual({ total: 0, scanned: 0 })
  })
})

describe('removablePieces — ile jeszcze wolno odjąć', () => {
  it('bez skanu wolno odjąć wszystko, co wpisano', () => {
    expect(removablePieces(linia(), {})).toBe(12)
  })

  it('zeskanowane sztuki są nietykalne — zostaje sama nadwyżka', () => {
    expect(removablePieces(linia(), { l1: { total: 20, scanned: 8 } })).toBe(4)
  })

  it('gdy zeskanowano tyle, ile wpisano, nie da się odjąć nic', () => {
    expect(removablePieces(linia(), { l1: { total: 20, scanned: 12 } })).toBe(0)
  })

  // Skan jednej sztuki z pozycji NIE zamraża całej pozycji — nadwyżkę wpisaną
  // przez pomyłkę trzeba dać się skasować (decyzja właściciela 27.08.2026).
  it('pierwszy skan nie zamraża reszty pozycji', () => {
    expect(removablePieces(linia(), { l1: { total: 20, scanned: 1 } })).toBe(11)
  })

  it('rozjazd w drugą stronę (zeskanowano więcej niż wpisano) nie robi liczby ujemnej', () => {
    expect(removablePieces(linia({ qtyDone: 3 }), { l1: { total: 20, scanned: 8 } })).toBe(0)
  })
})

describe('isConfirmed — kiedy pozycja jest POTWIERDZONA', () => {
  it('wszystkie sztuki pozycji zeskanowane', () => {
    expect(isConfirmed(linia({ qtyDone: 20 }), { l1: { total: 20, scanned: 20 } })).toBe(true)
  })

  it('część zeskanowana to jeszcze nie potwierdzenie', () => {
    expect(isConfirmed(linia({ qtyDone: 20 }), { l1: { total: 20, scanned: 19 } })).toBe(false)
  })

  it('brak skanów nie potwierdza pozycji, nawet zrobionej', () => {
    expect(isConfirmed(linia({ qtyDone: 20 }), { l1: { total: 20, scanned: 0 } })).toBe(false)
  })

  // Biuro wydrukowało etykiety tylko na część pozycji — do „potwierdzone"
  // brakuje sztuk, więc pozycja zostaje „gotowa". Cichy awans byłby kłamstwem.
  it('mniej wygenerowanych sztuk niż planowanych nie awansuje pozycji', () => {
    expect(isConfirmed(linia({ qtyDone: 20 }), { l1: { total: 12, scanned: 12 } })).toBe(false)
  })
})

describe('lineScanState — stan pozycji na liście planu', () => {
  it('nietknięta pozycja jest zaplanowana', () => {
    expect(lineScanState(linia({ qtyDone: 0 }), {})).toBe('PLANNED')
  })

  it('zaczęta pozycja jest w trakcie', () => {
    expect(lineScanState(linia(), {})).toBe('IN_PROGRESS')
  })

  it('policzona, ale niezeskanowana pozycja jest gotowa', () => {
    expect(lineScanState(linia({ qtyDone: 20 }), { l1: { total: 20, scanned: 5 } })).toBe('DONE')
  })

  it('zeskanowana w całości pozycja jest potwierdzona', () => {
    expect(lineScanState(linia({ qtyDone: 20 }), { l1: { total: 20, scanned: 20 } })).toBe('CONFIRMED')
  })
})
