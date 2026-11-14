// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

const wz = vi.hoisted(() => ({ byId: vi.fn(), updatePrices: vi.fn(), cancel: vi.fn(), quantityChain: vi.fn() }))
const hdi = vi.hoisted(() => ({ anuluj: vi.fn() }))
const cmr = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
const fx = vi.hoisted(() => ({ eurRate: vi.fn() }))
const carriers = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => { const o = await orig() as Record<string, object>
  return { ...o, wzApi: { ...o.wzApi, ...wz }, hdiApi: { ...o.hdiApi, ...hdi }, cmrApi: { ...o.cmrApi, ...cmr }, fxApi: fx, carriersApi: carriers } })
import { OknoDzialania } from './Okna'
import { zWz, zCmr, zHdi } from './model'

const app = { toast: vi.fn() } as unknown as AppApi
const DOK_WZ = zWz({ id: 'w1', number: 'WZ/2/11/26', buyer_name: 'VATAN', status: 'wstepny', source_type: 'manual', valued: true, total_value: 100, currency: 'PLN', release_date: '2026-11-14' })
const mount = (okno: Parameters<typeof OknoDzialania>[0]['okno']) => { const onZmiana = vi.fn(), onClose = vi.fn()
  render(<AppCtx.Provider value={app}><OknoDzialania okno={okno} onClose={onClose} onZmiana={onZmiana} /></AppCtx.Provider>); return { onZmiana, onClose } }
afterEach(cleanup)
beforeEach(() => { [...Object.values(wz), ...Object.values(hdi), ...Object.values(cmr), fx.eurRate, carriers.list].forEach(f => f.mockReset())
  wz.byId.mockResolvedValue({ id: 'w1', number: 'WZ/2/11/26', currency: 'PLN', eur_rate: null, valued: true, total_value: 100,
    lines: [{ name: 'KEBAB UDO 30kg', qty: 20, unit: 'szt', total_kg: 600, price: 14.2, value: 8520 }, { name: 'Jogurt naturalny', qty: 12, unit: 'szt', price: 6.9, value: 82.8, stock_type: 'reczna' }] })
  carriers.list.mockResolvedValue([{ id: 'car1', name: 'TRANS-POL' }]) })

describe('okna działań modułu Dokumenty', () => {
  it('ceny i waluta: przecinek, EUR z kursem — DTO do updatePrices', async () => {
    wz.updatePrices.mockResolvedValue({})
    const { onZmiana } = mount({ co: 'ceny', dok: DOK_WZ })
    const c0 = await screen.findByLabelText('Cena, KEBAB UDO 30kg') as HTMLInputElement
    expect(c0.value).toBe('14,20')
    fireEvent.change(c0, { target: { value: '3,40' } })
    fireEvent.click(screen.getByRole('button', { name: 'EUR' }))
    fireEvent.change(screen.getByLabelText('Kurs EUR'), { target: { value: '4,2512' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz ceny' }))
    await waitFor(() => expect(wz.updatePrices).toHaveBeenCalledWith('w1', [{ index: 0, price: 3.4 }, { index: 1, price: 6.9 }], 'EUR', 4.2512))
    expect(onZmiana).toHaveBeenCalled()
  })
  it('anulowanie WZ wymaga potwierdzenia; błąd serwera zostaje w oknie', async () => {
    wz.cancel.mockRejectedValueOnce(new Error('WZ jest już załadowany na auto')).mockResolvedValueOnce({})
    const { onZmiana, onClose } = mount({ co: 'anuluj', dok: DOK_WZ })
    expect(screen.getByText(/wróci na stan magazynu/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj dokument' }))
    expect(await screen.findByText(/załadowany na auto/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj dokument' }))
    await waitFor(() => expect(onZmiana).toHaveBeenCalled())
    expect(wz.cancel).toHaveBeenCalledWith('w1')
  })
  it('anulowanie HDI', async () => {
    hdi.anuluj.mockResolvedValue({})
    mount({ co: 'anulujHdi', dok: zHdi({ id: 'h1', number: '52/11/26', status: 'wystawiony' }) })
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj dokument' }))
    await waitFor(() => expect(hdi.anuluj).toHaveBeenCalledWith('h1'))
  })
  it('edycja CMR: pola z dokumentu, zapis przez update', async () => {
    cmr.get.mockResolvedValue({ id: 'c1', payload: { carrier: { name: 'TRANS-POL', plate: 'KR 1' }, attachments: { invoice_no: 'FV 1' }, instructions: 'TRANSPORT MROŻNICZY -22',
      goods: [{ name: 'KEBAB', qty: 20, kg: 600, auto: true }, { name: 'Jogurt', qty: 12, kg: 12 }] } })
    cmr.update.mockResolvedValue({})
    mount({ co: 'edytujCmr', dok: zCmr({ id: 'c1', number: '68/11/26', status: 'wystawiony' }) })
    const plate = await screen.findByLabelText('Nr rejestracyjny') as HTMLInputElement
    await waitFor(() => expect(plate.value).toBe('KR 1'))
    fireEvent.change(plate, { target: { value: 'KR 999' } })
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz CMR' }))
    await waitFor(() => expect(cmr.update).toHaveBeenCalledWith('c1', expect.objectContaining({ carrier_id: 'car1', plate: 'KR 999', invoice_no: 'FV 1',
      goods_manual: [{ name: 'Jogurt', qty: 12, kg: 12 }] })))
  })
  it('raport rozjazdu: łańcuch ilości z zaznaczonym etapem', async () => {
    wz.quantityChain.mockResolvedValue({ order_no: 'VATAN/Z/3', lines: [{ name: 'KEBAB 30kg', kg_per_unit: 30, ordered: 20, planned: 20, reported: 20, scanned: 18, packed: 18, shipped: 18, documented: 20 }] })
    mount({ co: 'rozjazd', dok: zWz({ id: 'w2', number: 'WM/1', status: 'wstepny', source_type: 'order', source_id: 'o1', loading_status: 'rozjazd' }) })
    expect(await screen.findByText('KEBAB 30kg')).toBeTruthy()
    expect(wz.quantityChain).toHaveBeenCalledWith('o1')
  })
})
