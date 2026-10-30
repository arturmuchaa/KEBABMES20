// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'

const m = vi.hoisted(() => ({
  carriers: vi.fn(), generate: vi.fn(), hdiGenerate: vi.fn(), pdf: vi.fn(() => Promise.resolve()),
}))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object),
  carriersApi: { list: m.carriers },
  cmrApi: { generate: m.generate, pdfUrl: (id: string) => `/api/cmr/${id}/pdf` },
  hdiApi: { generate: m.hdiGenerate, pdfUrl: (id: string) => `/api/hdi/${id}/pdf` },
  downloadDocPdf: m.pdf,
}))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { CmrDialog, formularzCmr, generujHdi, INSTRUKCJE_DOMYSLNE } from './Cmr'
import { wierszeKompletacji } from '../druk/ListaKompletacji'
import { mapClientOrder } from '@/lib/api'

afterEach(cleanup)
beforeEach(() => { Object.values(m).forEach(f => f.mockClear()); m.carriers.mockResolvedValue([{ id: 'k1', name: 'TRANS-POL', city: 'Opole', defaultPlate: 'OP 12345' }]) })
const app = { toast: vi.fn() } as unknown as AppApi

describe('CMR', () => {
  it('bez przewoźnika nie ma numeru rejestracyjnego; puste pozycje dodatkowe odpadają', () => {
    expect(formularzCmr({ carrierId: '', plate: 'OP 1', invoiceNo: ' FV 1 ', instructions: INSTRUKCJE_DOMYSLNE, goods: [{ name: ' ', qty: 1, kg: 1 }, { name: 'Sos', qty: 2, kg: 3 }] }))
      .toEqual({ carrier_id: '', plate: '', invoice_no: 'FV 1', instructions: 'TRANSPORT MROŻNICZY -22', goods_manual: [{ name: 'Sos', qty: 2, kg: 3 }] })
  })
  it('wybór przewoźnika podpowiada jego numer; wystawienie → PDF', async () => {
    m.generate.mockResolvedValue({ id: 'c9', number: '12/10/26', status: 'ok' })
    const onClose = vi.fn()
    render(<AppCtx.Provider value={app}><CmrDialog orderId="o1" orderNo="ISSA/Z/3/10/26" onClose={onClose} /></AppCtx.Provider>)
    await screen.findByRole('option', { name: 'TRANS-POL, Opole' })
    expect((screen.getByLabelText('Numer rejestracyjny') as HTMLInputElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Przewoźnik'), { target: { value: 'k1' } })
    expect((screen.getByLabelText('Numer rejestracyjny') as HTMLInputElement).value).toBe('OP 12345')
    fireEvent.click(screen.getByRole('button', { name: 'Wystaw CMR' }))
    await waitFor(() => expect(m.generate).toHaveBeenCalledWith('o1', expect.objectContaining({ carrier_id: 'k1', plate: 'OP 12345', instructions: INSTRUKCJE_DOMYSLNE })))
    await waitFor(() => expect(m.pdf).toHaveBeenCalledWith('/api/cmr/c9/pdf', 'CMR-12-10-26.pdf'))
    expect(onClose).toHaveBeenCalled()
  })
  it('odmowa serwera zostaje w oknie', async () => {
    m.generate.mockRejectedValue(new Error('Zamówienie nie ma wydanego towaru'))
    render(<AppCtx.Provider value={app}><CmrDialog orderId="o1" orderNo="X" onClose={() => {}} /></AppCtx.Provider>)
    fireEvent.click(screen.getByRole('button', { name: 'Wystaw CMR' }))
    expect(await screen.findByText(/nie ma wydanego towaru/)).toBeTruthy()
  })
  it('HDI: generuje i otwiera PDF; niepełne — ostrzeżenie', async () => {
    m.hdiGenerate.mockResolvedValue({ id: 'h1', number: '54/10/26', status: 'wstepny', incomplete: true, totals: { qty: 10, kg: 250 } })
    const toast = vi.fn()
    await generujHdi('o1', toast)
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'warn', title: expect.stringContaining('stan faktyczny') }))
    expect(m.pdf).toHaveBeenCalledWith('/api/hdi/h1/pdf', 'HDI-54-10-26.pdf')
  })
})

describe('lista kompletacji', () => {
  it('na magazynie, zostało, wydane w całości, palety przy pozycji', () => {
    const o = mapClientOrder({ id: 'o1', order_no: 'T', status: 'confirmed', lines: [
      { id: 'a', qty: 20, kg_per_unit: 40, total_kg: 800, product_type_name: 'UDO', recipe_name: 'KIRMIZI', qty_stock: 5, qty_delivered: 0 },
      { id: 'b', qty: 10, kg_per_unit: 20, total_kg: 200, product_type_name: 'UDO', recipe_name: 'BEYAZ', qty_stock: 0, qty_delivered: 10 },
    ] })
    const k = wierszeKompletacji(o, [{ palletNo: 2, notes: '', items: [{ orderLineId: 'a', qty: 12 }] }, { palletNo: 3, notes: '', items: [{ orderLineId: 'a', qty: 8 }] }])
    expect(k.rows.map(r => [r.leży, r.zostalo, r.wydane, r.palety.join(' ')])).toEqual([[5, 15, false, 'P2(12) P3(8)'], [0, 0, true, '']])
    expect([k.szt, k.kg]).toEqual([30, 1000])
  })
})
