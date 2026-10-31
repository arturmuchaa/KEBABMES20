// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import React, { useState } from 'react'
import { AppCtx, type AppApi } from '../shell/context'
import { Wybor, type WyborItem } from './Wybor'

const ITEMS: WyborItem[] = [{ id: 'r1', label: 'BEYAZ' }, { id: 'r2', label: 'KIRMIZI' }, { id: 'r3', label: 'BEYAZ OSTRY', sub: 'z chili' }]
const app = { appRef: { current: null }, scale: 1 } as unknown as AppApi
afterEach(cleanup)

function mount(start = '', extra: Partial<React.ComponentProps<typeof Wybor>> = {}) {
  const onDalej = vi.fn()
  const zmiany: string[] = []
  function Host() {
    const [v, setV] = useState(start)
    return <Wybor id="w" label="Receptura" items={ITEMS} value={v} onChange={x => { zmiany.push(x); setV(x) }} onDalej={onDalej} {...extra} />
  }
  render(<AppCtx.Provider value={app}><Host /></AppCtx.Provider>)
  const el = screen.getByRole('combobox', { name: 'Receptura' }) as HTMLInputElement
  el.focus()
  return { el, onDalej, zmiany }
}
const key = (el: HTMLElement, k: string, o: object = {}) => fireEvent.keyDown(el, { key: k, ...o })

describe('Wybor — pole wyboru z wpisywaniem', () => {
  it('wpisanie filtruje, Enter wybiera podświetloną i prosi o następne pole', () => {
    const { el, onDalej, zmiany } = mount()
    fireEvent.change(el, { target: { value: 'kir' } })
    expect(screen.getAllByRole('option').map(o => o.getAttribute('aria-label'))).toEqual(['KIRMIZI'])
    key(el, 'Enter')
    expect(zmiany).toEqual(['r2'])
    expect(onDalej).toHaveBeenCalledTimes(1)
    expect(el.value).toBe('KIRMIZI')
    expect(screen.queryByRole('listbox')).toBeNull()
  })

  it('puste pole + Enter rozwija listę zamiast wybierać w ciemno; wypełnione + Enter = zostaw i dalej', () => {
    const a = mount()
    key(a.el, 'Enter')
    expect(screen.getByRole('listbox')).toBeTruthy()
    expect(a.zmiany).toEqual([])
    expect(a.onDalej).not.toHaveBeenCalled()
    cleanup()
    const b = mount('r1')
    key(b.el, 'Enter')
    expect(b.zmiany).toEqual([])
    expect(b.onDalej).toHaveBeenCalledTimes(1)
  })

  it('Esc porzuca wpisywanie bez zmiany; Tab bez tekstu niczego nie zmienia, z tekstem bierze podświetloną', () => {
    const { el, zmiany, onDalej } = mount('r1')
    fireEvent.change(el, { target: { value: 'kir' } })
    key(el, 'Escape')
    expect(el.value).toBe('BEYAZ')
    key(el, 'ArrowDown'); key(el, 'Tab')
    expect(zmiany).toEqual([])
    fireEvent.change(el, { target: { value: 'ostry' } })
    key(el, 'Tab')
    expect(zmiany).toEqual(['r3'])
    expect(onDalej).not.toHaveBeenCalled() // Tab przenosi fokus sam
  })

  it('strzałki chodzą po liście od bieżącego wyboru; klik wybiera; pusta wartość legalna z noneLabel', () => {
    const { el, zmiany } = mount('r1', { noneLabel: '(bez tulei)' })
    key(el, 'ArrowDown')
    expect(el.getAttribute('aria-activedescendant')).toBe('w-o-1')
    key(el, 'ArrowDown'); key(el, 'Enter')
    expect(zmiany).toEqual(['r2'])
    key(el, 'ArrowDown')
    fireEvent.click(screen.getByRole('option', { name: '(bez tulei)' }))
    expect(zmiany).toEqual(['r2', ''])
    expect(el.value).toBe('(bez tulei)')
  })

  it('pusta lista mówi dlaczego', () => {
    const { el } = mount('', { items: [], pusto: 'Najpierw wybierz rodzaj' })
    key(el, 'ArrowDown')
    expect(screen.getByText('Najpierw wybierz rodzaj')).toBeTruthy()
    fireEvent.change(el, { target: { value: 'x' } })
    expect(screen.getByText('Nic nie pasuje do wpisanego tekstu')).toBeTruthy()
  })
})
