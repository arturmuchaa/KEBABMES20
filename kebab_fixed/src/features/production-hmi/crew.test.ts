import { describe, it, expect } from 'vitest'
import { productionCrew, wrappingCrew, type WorkerRow } from './crew'

const w = (over: Partial<WorkerRow>): WorkerRow => ({
  id: 'w1', name: 'DAWID NOWAK', role: 'WORKER_PRODUCTION', active: true, ...over,
})

describe('productionCrew', () => {
  it('bierze pracowników produkcji, nie każdego kto ma dostęp do panelu', () => {
    const lista = [
      w({ id: 'w1', name: 'DAWID' }),
      w({ id: 'kier', name: 'VOVA', role: 'WORKER_GENERAL' }),
      w({ id: 'biuro', name: 'MARCIN', role: 'OFFICE' }),
      w({ id: 'rozbior', name: 'OLEH', role: 'WORKER_DEBONING' }),
    ]
    expect(productionCrew(lista).map(x => x.id)).toEqual(['w1'])
  })

  it('pomija zwolnionych — archiwum nie ma stać na ekranie hali', () => {
    expect(productionCrew([w({ id: 'w1' }), w({ id: 'w2', active: false })]).map(x => x.id))
      .toEqual(['w1'])
  })

  it('układa po nazwisku, żeby kafle nie skakały między odświeżeniami', () => {
    const lista = [w({ id: 'b', name: 'ZENON' }), w({ id: 'a', name: 'ANNA' })]
    expect(productionCrew(lista).map(x => x.name)).toEqual(['ANNA', 'ZENON'])
  })

  it('znosi śmieci z API', () => {
    expect(productionCrew(null as any)).toEqual([])
    expect(productionCrew([{ id: 'x' } as any])).toEqual([])
  })
})

describe('wrappingCrew', () => {
  it('bierze zaznaczonych foliowczyków', () => {
    const lista = [
      w({ id: 'w1', name: 'VLAD', isWrapper: true }),
      w({ id: 'w2', name: 'ADAM', isWrapper: true }),
      w({ id: 'w3', name: 'DAWID' }),
    ]
    expect(wrappingCrew(lista).map(x => x.name)).toEqual(['ADAM', 'VLAD'])
  })

  it('foliowczyk spoza produkcji też się liczy — foliuje, więc dostaje kilogramy', () => {
    const lista = [w({ id: 'w9', name: 'IHOR', role: 'WORKER_GENERAL', isWrapper: true })]
    expect(wrappingCrew(lista).map(x => x.id)).toEqual(['w9'])
  })

  it('gdy nikt nie zaznaczony, zostaje cała produkcja — okno nie może być puste', () => {
    const lista = [w({ id: 'w1', name: 'DAWID' }), w({ id: 'kier', name: 'VOVA', role: 'WORKER_GENERAL' })]
    expect(wrappingCrew(lista).map(x => x.id)).toEqual(['w1'])
  })

  it('czyta znacznik także w postaci z bazy (is_wrapper)', () => {
    const lista = [
      { id: 'w1', name: 'VLAD', role: 'WORKER_PRODUCTION', active: true, is_wrapper: true } as WorkerRow,
      w({ id: 'w2', name: 'DAWID' }),
    ]
    expect(wrappingCrew(lista).map(x => x.id)).toEqual(['w1'])
  })

  it('zwolniony foliowczyk nie wraca na ekran', () => {
    expect(wrappingCrew([w({ id: 'w1', isWrapper: true, active: false })])).toEqual([])
  })
})
