// @vitest-environment jsdom
/**
 * Formularz receptury — czas masowania.
 *
 * Właściciel 18.09.2026: „standard to 50 min, ale są receptury np. YAPRAK,
 * które są na pół godziny — chcę definiować czas w recepturze, a masownica ma
 * go pobierać". Puste pole MUSI zostać pustym `null`, a nie zamienić się
 * w 50: inaczej nie da się odróżnić receptury ustawionej świadomie od nigdy
 * nie ruszanej, a zmiana standardu ominęłaby wszystkie stare.
 */
import { describe, it, expect } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useRecipeForm } from './hooks'

describe('czas masowania w formularzu receptury', () => {
  it('nowa receptura startuje bez własnego czasu', () => {
    const { result } = renderHook(() => useRecipeForm())
    expect(result.current.mixingMinutes).toBe('')
    expect(result.current.toDto().mixingMinutes).toBeNull()
  })

  it('wpisane 30 minut idzie do zapisu', () => {
    const { result } = renderHook(() => useRecipeForm())
    act(() => result.current.setMixingMinutes('30'))
    expect(result.current.toDto().mixingMinutes).toBe(30)
  })

  it('zero i śmieci nie przechodzą — zostaje standard', () => {
    const { result } = renderHook(() => useRecipeForm())
    act(() => result.current.setMixingMinutes('0'))
    expect(result.current.toDto().mixingMinutes).toBeNull()
    act(() => result.current.setMixingMinutes(''))
    expect(result.current.toDto().mixingMinutes).toBeNull()
  })

  it('edycja receptury pokazuje jej zapisany czas', () => {
    const { result } = renderHook(() => useRecipeForm({
      id: 'r1', name: 'YAPRAK', ingredients: [], totalOutputPer100kg: 124,
      shelfLifeDays: 5, mixingMinutes: 30, active: true, createdAt: '2026-09-18',
    } as any))
    expect(result.current.mixingMinutes).toBe('30')
    expect(result.current.toDto().mixingMinutes).toBe(30)
  })

  it('reset czyści czas razem z resztą formularza', () => {
    const { result } = renderHook(() => useRecipeForm())
    act(() => result.current.setMixingMinutes('30'))
    act(() => result.current.reset())
    expect(result.current.mixingMinutes).toBe('')
  })
})
