// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import type { StockPos } from '../../data/stock'

/** Poprawka rodzaju/receptury zmienia tożsamość wyrobu na magazynie — test na danych w kształcie API. */
const api = vi.hoisted(() => ({
  fg: { zmienRodzaj: vi.fn(), zmienRecepture: vi.fn() },
  typy: { list: vi.fn() },
  rec: { list: vi.fn() },
}))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), finishedGoodsApi: api.fg, productTypesApi: api.typy, recipesApi: api.rec }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { PoprawWyrobDialog, blokadaPoprawki } from './PoprawWyrob'

const app = { toast: vi.fn() } as unknown as AppApi
const P: StockPos = {
  id: 'fg1', product: 'KEBAB UDO 100%', recipe: 'KIRMIZI', recipeId: 'r-kir', productTypeId: 't-udo', qtyShipped: 0,
  kgPerUnit: 25, packaging: 'METAL 65CM', batch: '291026 659', location: 'Magazyn wyrobu', qty: 12, cartons: [], status: 'stock',
  movements: [], seasonedBatches: [], producedBy: [],
}
const mount = (p: StockPos = P) => { const onClose = vi.fn(); render(<AppCtx.Provider value={app}><PoprawWyrobDialog p={p} onClose={onClose} /></AppCtx.Provider>); return onClose }

afterEach(cleanup)
beforeEach(() => {
  Object.values(api.fg).forEach(f => f.mockReset()); refresh.mockClear()
  api.fg.zmienRodzaj.mockResolvedValue({}); api.fg.zmienRecepture.mockResolvedValue({})
  api.typy.list.mockResolvedValue([{ id: 't-udo', name: 'KEBAB UDO 100%' }, { id: 't-mix', name: 'KEBAB MIX 95/5' }])
  api.rec.list.mockResolvedValue([
    { id: 'r-kir', name: 'KIRMIZI', productTypeId: 't-udo' }, { id: 'r-bey', name: 'BEYAZ AFIYET', productTypeId: 't-udo' },
    { id: 'r-mix-kir', name: 'MIX KIRMIZI', productTypeId: 't-mix' }, { id: 'r-uni', name: 'UNIWERSALNA' },
  ])
})

describe('Poprawka rodzaju / receptury', () => {
  it('zmiana samej receptury — jeden zapis receptury, odświeżenie i zamknięcie', async () => {
    const onClose = mount()
    const rec = await screen.findByLabelText('Receptura') as HTMLSelectElement
    await waitFor(() => expect(rec.disabled).toBe(false))
    fireEvent.change(rec, { target: { value: 'r-bey' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz poprawkę' }))
    await waitFor(() => expect(api.fg.zmienRecepture).toHaveBeenCalledWith('fg1', 'r-bey'))
    expect(api.fg.zmienRodzaj).not.toHaveBeenCalled()
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    expect(refresh).toHaveBeenCalled()
  })

  it('zmiana rodzaju zawęża receptury; bez pasującej receptury nie da się zapisać; rodzaj + receptura = dwa zapisy', async () => {
    mount()
    const typ = await screen.findByLabelText('Rodzaj') as HTMLSelectElement
    await waitFor(() => expect(typ.disabled).toBe(false))
    fireEvent.change(typ, { target: { value: 't-mix' } })
    // KIRMIZI (UDO) nie pasuje do MIX — zapis zablokowany, dopóki nie wybierze się receptury MIX.
    expect((screen.getByRole('button', { name: 'Zapisz poprawkę' }) as HTMLButtonElement).disabled).toBe(true)
    const opcje = [...(screen.getByLabelText('Receptura') as HTMLSelectElement).options].map(o => o.value)
    expect(opcje).toEqual(expect.arrayContaining(['r-mix-kir', 'r-uni']))
    expect(opcje).not.toContain('r-bey')
    fireEvent.change(screen.getByLabelText('Receptura'), { target: { value: 'r-mix-kir' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz poprawkę' }))
    await waitFor(() => expect(api.fg.zmienRecepture).toHaveBeenCalledWith('fg1', 'r-mix-kir'))
    expect(api.fg.zmienRodzaj).toHaveBeenCalledWith('fg1', 't-mix')
  })

  it('po wyjeździe choćby jednej sztuki — bez pól i bez zapisu; drugi zapis padł → widać, że rodzaj już zmieniono', async () => {
    expect(blokadaPoprawki({ qtyShipped: 3 })).toMatch(/wyjechało już 3 szt/)
    mount({ ...P, qtyShipped: 3 })
    expect(screen.getByText(/wyjechało już 3 szt/)).toBeTruthy()
    expect(screen.queryByLabelText('Rodzaj')).toBeNull()
    expect((screen.getByRole('button', { name: 'Zapisz poprawkę' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()
    api.fg.zmienRecepture.mockRejectedValue(new Error('Partia jest już na WZ'))
    mount()
    const typ = await screen.findByLabelText('Rodzaj') as HTMLSelectElement
    await waitFor(() => expect(typ.disabled).toBe(false))
    fireEvent.change(typ, { target: { value: 't-mix' } })
    fireEvent.change(screen.getByLabelText('Receptura'), { target: { value: 'r-mix-kir' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz poprawkę' }))
    expect(await screen.findByText(/Rodzaj zmieniono, ale receptury nie: Partia jest już na WZ/)).toBeTruthy()
  })
})
