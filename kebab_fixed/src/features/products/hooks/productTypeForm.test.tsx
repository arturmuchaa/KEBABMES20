// @vitest-environment jsdom
/**
 * useProductTypeForm — wczytanie rodzaju do edycji.
 *
 * Formularz żyje NA STRONIE (hook nad modalem), więc wartości początkowe
 * z `useState` łapią tylko pierwszy render. Bez jawnego `load` wejście
 * w „Edytuj" pokazywało pusty formularz, a zapis nadpisywał skład rodzaju
 * — czyli źródło prawdy produkcji (product_types.components).
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useProductTypeForm } from './index'
import type { ProductType } from '../types'

const MIX: ProductType = {
  id: 't-mix',
  name: 'KEBAB MIX 95/5',
  documentName: 'KEBAB MIX',
  components: [
    { id: 'c1', name: 'Mięso z/s', materialTypeId: 'mat-mieso-zs', sourceType: 'meat_stock', pct: 95 },
    { id: 'c2', name: 'Filet z kurczaka', materialTypeId: 'mat-filet-kurczak', sourceType: 'purchase', pct: 5 },
  ],
  active: true,
  createdAt: '2026-08-29',
}

describe('useProductTypeForm', () => {
  it('load wczytuje rodzaj razem z nazwą dokumentową i składem', () => {
    const { result } = renderHook(() => useProductTypeForm())
    act(() => result.current.load(MIX))
    expect(result.current.name).toBe('KEBAB MIX 95/5')
    expect(result.current.documentName).toBe('KEBAB MIX')
    expect(result.current.components).toHaveLength(2)
  })

  it('zapis oddaje skład z powiązaniem surowca — nie kasuje materialTypeId', () => {
    const { result } = renderHook(() => useProductTypeForm())
    act(() => result.current.load(MIX))
    const dto = result.current.toDto()
    expect(dto.documentName).toBe('KEBAB MIX')
    expect(dto.components.map(c => c.materialTypeId))
      .toEqual(['mat-mieso-zs', 'mat-filet-kurczak'])
    expect(dto.components.map(c => c.pct)).toEqual([95, 5])
  })

  it('wyczyszczona nazwa dokumentowa jedzie do backendu jako pusty string', () => {
    const { result } = renderHook(() => useProductTypeForm())
    act(() => result.current.load(MIX))
    act(() => result.current.setDocumentName('   '))
    expect(result.current.toDto().documentName).toBe('')
  })

  it('reset czyści formularz do jednego pustego składnika', () => {
    const { result } = renderHook(() => useProductTypeForm())
    act(() => result.current.load(MIX))
    act(() => result.current.reset())
    expect(result.current.name).toBe('')
    expect(result.current.documentName).toBe('')
    expect(result.current.components).toHaveLength(1)
  })
})
