/**
 * Porównanie planów — jedyne miejsce tego ekranu, gdzie cichy błąd znaczy,
 * że hala produkuje według nieaktualnego planu. Biuro edytuje plan w trakcie
 * zmiany, a operator ma się o tym dowiedzieć z ekranu, nie od kogoś, kto
 * akurat przechodził obok.
 */
import { describe, it, expect } from 'vitest'
import { planDiff, opiszZmiane, snapshotPlanu, type PlanSnapshotLine } from './planDiff'

const l = (over: Partial<PlanSnapshotLine> = {}): PlanSnapshotLine => ({
  id: 'l1', qty: 20, kgPerUnit: 35, recipeName: 'WROCŁAW',
  packagingName: 'Tuleja 120', clientName: 'Bulli', ...over,
})

describe('planDiff', () => {
  it('bez zmian nie zgłasza nic', () => {
    expect(planDiff([l()], [l()])).toEqual([])
  })

  it('nowa pozycja', () => {
    const z = planDiff([l()], [l(), l({ id: 'l2', recipeName: 'KIRMIZI', qty: 10, kgPerUnit: 40 })])
    expect(z).toHaveLength(1)
    expect(opiszZmiane(z[0])).toBe('doszła KIRMIZI 10×40 kg')
  })

  it('zdjęta pozycja', () => {
    const z = planDiff([l()], [])
    expect(opiszZmiane(z[0])).toBe('zdjęto WROCŁAW 20×35 kg')
  })

  it('zmieniona ilość', () => {
    const z = planDiff([l()], [l({ qty: 32 })])
    expect(opiszZmiane(z[0])).toBe('WROCŁAW 20 → 32 szt.')
  })

  it('zmieniona tuleja', () => {
    const z = planDiff([l()], [l({ packagingName: 'Tuleja 65' })])
    expect(opiszZmiane(z[0])).toBe('WROCŁAW — tuleja: Tuleja 120 → Tuleja 65')
  })

  it('zmieniony klient i receptura naraz to DWIE zmiany', () => {
    expect(planDiff([l()], [l({ clientName: 'Nowak', recipeName: 'BULLI' })])).toHaveLength(2)
  })

  it('kolejność pozycji NIE jest zmianą — plan wolno przestawić', () => {
    const a = l(), b = l({ id: 'l2', recipeName: 'BULLI' })
    expect(planDiff([a, b], [b, a])).toEqual([])
  })

  it('porównuje po id, nie po miejscu w tablicy', () => {
    // Gdyby diff szedł po indeksie, usunięcie pierwszej pozycji wyglądałoby
    // jak zmiana wszystkich pozostałych.
    const a = l(), b = l({ id: 'l2', recipeName: 'BULLI' }), c = l({ id: 'l3', recipeName: 'KIRMIZI' })
    const z = planDiff([a, b, c], [b, c])
    expect(z).toHaveLength(1)
    expect(opiszZmiane(z[0])).toBe('zdjęto WROCŁAW 20×35 kg')
  })

  it('pusta waga i brak klienta nie wysypują opisu', () => {
    const z = planDiff([], [l({ id: 'l9', recipeName: 'KIRMIZI', qty: 5, kgPerUnit: 0, clientName: '' })])
    expect(opiszZmiane(z[0])).toBe('doszła KIRMIZI 5×0 kg')
  })

  it('zmiana klienta z pustego na nazwę mówi „na magazyn"', () => {
    const z = planDiff([l({ clientName: '' })], [l({ clientName: 'Nowak' })])
    expect(opiszZmiane(z[0])).toBe('WROCŁAW — klient: na magazyn → Nowak')
  })
})

describe('snapshotPlanu', () => {
  it('bierze z pozycji planu tylko to, co operator widzi na liście', () => {
    const snap = snapshotPlanu([{
      id: 'l1', qty: 20, kgPerUnit: 35, recipeName: 'WROCŁAW',
      packagingName: 'Tuleja 120', clientName: 'Bulli sp. z o.o.',
      qtyDone: 12, totalKg: 700, batchAllocation: {}, cokolwiek: 'nieistotne',
    } as any])
    expect(snap).toEqual([{
      id: 'l1', qty: 20, kgPerUnit: 35, recipeName: 'WROCŁAW',
      packagingName: 'Tuleja 120', clientName: 'Bulli sp. z o.o.',
    }])
  })

  it('brakujące pola schodzą do wartości pustych, nie do undefined', () => {
    // Backend potrafi nie podać tulei ani klienta (produkcja „na magazyn").
    expect(snapshotPlanu([{ id: 'l1', qty: 4 } as any])).toEqual([{
      id: 'l1', qty: 4, kgPerUnit: 0, recipeName: '', packagingName: '', clientName: '',
    }])
  })
})
