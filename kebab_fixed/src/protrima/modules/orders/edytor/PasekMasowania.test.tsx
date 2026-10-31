// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import React from 'react'

/** Pasek masowania: liczby z podglądu serwera, zgrupowane po recepturze — dane w kształcie API (syntetyczne). */
const preview = vi.hoisted(() => vi.fn())
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), materialRequirementsApi: { preview } }))
import { PasekMasowania } from './PasekMasowania'
import { doPodgladu, masowaniePoRecepturach } from './masowanie'

const L = (o: Partial<{ qty: string; kgPerUnit: string; recipeId: string; productTypeId: string; id: string }>) =>
  ({ id: '', qty: '10', kgPerUnit: '20', productTypeId: 'pt', recipeId: 'r1', packagingId: '', notes: '', ...o })
const REC = [{ id: 'r1', name: 'BEYAZ' }, { id: 'r2', name: 'KIRMIZI' }]
// Odpowiedź serwera: pozycje 0 i 1 to BEYAZ (70/30 → dwa wiersze), pozycja 2 to KIRMIZI bez dodatków.
const WYNIK = {
  yieldPct: 70,
  lines: [
    { lineIndex: 0, meatTypeId: 'zs', meatName: 'Mięso z/s', kgMeat: 120.4, rawTypeId: 'cw', rawName: 'Ćwiartka', requiresDeboning: true, kgRaw: 172 },
    { lineIndex: 0, meatTypeId: 'fi', meatName: 'Filet', kgMeat: 51.6, rawTypeId: 'fi', rawName: 'Filet', requiresDeboning: false, kgRaw: 51.6 },
    { lineIndex: 1, meatTypeId: 'zs', meatName: 'Mięso z/s', kgMeat: 86.25, rawTypeId: 'cw', rawName: 'Ćwiartka', requiresDeboning: true, kgRaw: 123.2 },
    { lineIndex: 2, meatTypeId: 'zs', meatName: 'Mięso z/s', kgMeat: 100, rawTypeId: 'cw', rawName: 'Ćwiartka', requiresDeboning: true, kgRaw: 142.9 },
  ],
  totalsByRaw: [{ rawTypeId: 'cw', rawName: 'Ćwiartka', kgRaw: 438.1, kgMeat: 306.65 }, { rawTypeId: 'fi', rawName: 'Filet', kgRaw: 51.6, kgMeat: 51.6 }],
}
const LINIE = [L({ qty: '10', kgPerUnit: '20' }), L({ qty: '5', kgPerUnit: '20' }), L({ recipeId: 'r2', qty: '5', kgPerUnit: '20' }), L({ qty: '' })]

afterEach(cleanup)
beforeEach(() => { preview.mockReset(); preview.mockResolvedValue(WYNIK) })

describe('masowanie — logika', () => {
  it('do podglądu tylko kompletne pozycje; mięso po recepturze zaokrąglone w górę po zsumowaniu', () => {
    const items = doPodgladu(LINIE)
    expect(items).toEqual([
      { qty: 10, kgPerUnit: 20, recipeId: 'r1', productTypeId: 'pt' }, { qty: 5, kgPerUnit: 20, recipeId: 'r1', productTypeId: 'pt' },
      { qty: 5, kgPerUnit: 20, recipeId: 'r2', productTypeId: 'pt' }])
    const m = masowaniePoRecepturach(items, WYNIK, id => REC.find(r => r.id === id)!.name)
    expect(m.map(r => [r.nazwa, r.wyrobKg, r.miesoKg, r.bezSkladu])).toEqual([['BEYAZ', 300, 259, false], ['KIRMIZI', 100, 100, true]])
    expect(m[0].miesoDokladne).toBeCloseTo(258.25)
  })
})

describe('PasekMasowania', () => {
  it('pokazuje mięso na recepturę, sumę i surowiec; pyta serwer tylko o kompletne pozycje', async () => {
    render(<PasekMasowania lines={LINIE} recipes={REC} />)
    const pasek = screen.getByRole('region', { name: 'Masowanie i surowiec' })
    expect(await within(pasek).findByText('359 kg mięsa')).toBeTruthy()
    expect(preview).toHaveBeenCalledTimes(1)
    expect(preview.mock.calls[0][0]).toHaveLength(3)
    expect(within(pasek).getByText('BEYAZ').parentElement!.textContent).toBe('BEYAZ259 kg')
    expect(within(pasek).getByText('KIRMIZI').parentElement!.className).toContain('warn')
    const surowiec = within(pasek).getByLabelText('Surowiec')
    expect(surowiec.textContent).toContain('Ćwiartka 439 kg')
    expect(surowiec.textContent).toContain('Filet 52 kg')
  })

  it('bez kompletnej pozycji nie pyta serwera; błąd serwera pokazany słowami', async () => {
    const { rerender } = render(<PasekMasowania lines={[L({ qty: '' })]} recipes={REC} />)
    expect(screen.getByText(/po wpisaniu pierwszej kompletnej pozycji/)).toBeTruthy()
    await new Promise(r => setTimeout(r, 450))
    expect(preview).not.toHaveBeenCalled()
    preview.mockRejectedValue(new Error('Receptura nie istnieje'))
    rerender(<PasekMasowania lines={[L({})]} recipes={REC} />)
    expect(await screen.findByText(/Nie udało się policzyć masowania: Receptura nie istnieje/)).toBeTruthy()
    await waitFor(() => expect(preview).toHaveBeenCalledTimes(1))
  })
})
