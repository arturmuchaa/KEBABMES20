/**
 * Kontrakt klawiatury dla pozycji planu produkcji — ten sam co w zamówieniach,
 * ale klient jest tu częścią TOŻSAMOŚCI pozycji: jeden plan dnia obsługuje
 * różnych klientów, a w zamówieniu klient jest raz na cały dokument.
 */
import { describe, it, expect } from 'vitest'
import {
  SLOT_ORDER, CARRIED, emptyPlanLine, carryOver, inheritedSlots, initialSlot,
  nextSlot, prevSlot, applyIdentity, draftComplete, lineKg, num,
  type PlanLine,
} from './planLineModel'

const pelna = (over: Partial<PlanLine> = {}): PlanLine => ({
  ...emptyPlanLine(),
  productTypeId: 'pt1', recipeId: 'r1', packagingId: 'tul65',
  clientId: 'c1', clientName: 'Bulli', qty: '20', kgPerUnit: '35',
  ...over,
})

describe('kolejność slotów', () => {
  it('tożsamość najpierw, liczby na końcu', () => {
    expect(SLOT_ORDER).toEqual(['productTypeId', 'recipeId', 'packagingId', 'clientId', 'qty', 'kgPerUnit'])
  })

  it('klient dziedziczy się razem z tożsamością', () => {
    expect(CARRIED).toContain('clientId')
  })

  it('następny i poprzedni nie wypadają poza listę', () => {
    expect(nextSlot('kgPerUnit')).toBe('kgPerUnit')
    expect(prevSlot('productTypeId')).toBe('productTypeId')
    expect(nextSlot('clientId')).toBe('qty')
    expect(prevSlot('qty')).toBe('clientId')
  })
})

describe('carryOver', () => {
  it('czyści WYŁĄCZNIE sztuki i wagę', () => {
    const next = carryOver(pelna())
    expect(next.productTypeId).toBe('pt1')
    expect(next.recipeId).toBe('r1')
    expect(next.packagingId).toBe('tul65')
    expect(next.clientId).toBe('c1')
    expect(next.clientName).toBe('Bulli')
    expect(next.qty).toBe('')
    expect(next.kgPerUnit).toBe('')
  })

  it('nie przenosi powiązania z pozycją zamówienia', () => {
    const next = carryOver(pelna({ clientOrderId: 'z1', clientOrderLineId: 'zl1' }))
    expect(next.clientOrderId).toBe('')
    expect(next.clientOrderLineId).toBe('')
  })

  it('bez poprzedniej pozycji daje pustą', () => {
    expect(carryOver(null).productTypeId).toBe('')
  })

  it('nie przenosi przydziału partii — nowa pozycja dostaje swój od FEFO', () => {
    const next = carryOver(pelna({ seasonedBatchIds: ['b1'], batchesManual: true }))
    expect(next.seasonedBatchIds).toEqual([])
    expect(next.batchesManual).toBe(false)
  })
})

describe('inheritedSlots', () => {
  it('pokazuje, co przyszło z poprzedniej pozycji', () => {
    const last = pelna()
    const draft = carryOver(last)
    const inh = inheritedSlots(draft, last)
    expect(inh.has('productTypeId')).toBe(true)
    expect(inh.has('clientId')).toBe(true)
    expect(inh.has('qty')).toBe(false)
  })
})

describe('initialSlot', () => {
  it('pusta pozycja startuje od rodzaju', () => {
    expect(initialSlot(emptyPlanLine())).toBe('productTypeId')
  })
  it('z odziedziczoną tożsamością kursor ląduje od razu na sztukach', () => {
    expect(initialSlot(carryOver(pelna()))).toBe('qty')
  })
  it('brak receptury zatrzymuje kursor na recepturze', () => {
    expect(initialSlot({ ...emptyPlanLine(), productTypeId: 'pt1' })).toBe('recipeId')
  })
})

describe('applyIdentity', () => {
  const recipes = [{ id: 'r1', productTypeId: 'pt1' }, { id: 'r9', productTypeId: 'pt9' }]

  it('zmiana rodzaju unieważnia recepturę z innego produktu', () => {
    const out = applyIdentity(pelna({ recipeId: 'r9' }), 'productTypeId', 'pt1', recipes)
    expect(out.recipeId).toBe('')
  })

  it('receptura pasująca do rodzaju zostaje', () => {
    const out = applyIdentity(pelna({ recipeId: 'r1' }), 'productTypeId', 'pt1', recipes)
    expect(out.recipeId).toBe('r1')
  })

  it('zmiana receptury zeruje ręczny przydział partii — inne mięso, inne partie', () => {
    const out = applyIdentity(
      pelna({ seasonedBatchIds: ['b1'], batchesManual: true }), 'recipeId', 'r9', recipes)
    expect(out.seasonedBatchIds).toEqual([])
    expect(out.batchesManual).toBe(false)
  })
})

describe('draftComplete i lineKg', () => {
  it('pozycja bez receptury nie jest gotowa', () => {
    expect(draftComplete(pelna({ recipeId: '' }))).toBe(false)
  })
  it('pozycja bez wagi nie jest gotowa', () => {
    expect(draftComplete(pelna({ kgPerUnit: '0' }))).toBe(false)
  })
  it('klient NIE jest wymagany — produkcja na magazyn go nie ma', () => {
    expect(draftComplete(pelna({ clientId: '', clientName: '' }))).toBe(true)
  })
  it('liczy kilogramy z przecinkiem dziesiętnym', () => {
    expect(lineKg(pelna({ qty: '12', kgPerUnit: '8,5' }))).toBe(102)
    expect(num('8,5')).toBe(8.5)
  })
})
