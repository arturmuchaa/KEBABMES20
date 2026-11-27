// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

/** Druk etykiet sztuk z planu według szablonów klientów (projektor etykiet, 27.11.2026). */
const units = vi.hoisted(() => ({ forPlan: vi.fn(), markLabelsPrinted: vi.fn(), generateFromPlanLine: vi.fn() }))
const designs = vi.hoisted(() => ({ forPlan: vi.fn(), get: vi.fn() }))
const druk = vi.hoisted(() => ({ drukujEtykiety: vi.fn(), opisBledu: vi.fn(async (e: unknown) => (e instanceof Error ? e.message : String(e))) }))
const print = vi.hoisted(() => ({ drukuj: vi.fn() }))
const pdf = vi.hoisted(() => ({ zbudujPdfA4: vi.fn(async () => 'JVBERi0x') }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), finishedUnitsApi: units, labelDesignsApi: designs }))
vi.mock('../../drukarka/drukarka', () => ({ ...druk, ROLKA_ETYKIET: '100x150' }))
vi.mock('@/lib/print', () => print)
vi.mock('../etykiety/pdfA4', () => pdf)
import { OknoEtykiet } from './OknoEtykiet'

const sztuka = (id: string, line: string, poz: number, zm: Record<string, unknown> = {}) => ({
  id, qrCode: `U|${id}`, qrSeq: 1, planLineId: line, linePosition: poz, batchNo: '724', recipeName: 'KIRMIZI',
  productTypeName: 'KEBAB UDO 100%', packagingName: '', clientName: 'ZAGROS', weightKg: 40, producedDate: '2026-11-28',
  status: 'planned', labelPrintedAt: null, clientId: 'cz', productTypeId: 'udo', recipeId: 'kir', shelfLifeDays: 364, ...zm,
})
const A4 = { id: 'a4', name: 'ZAGROS · A4', clientId: 'cz', productTypeId: '', recipeId: '', printMode: 'a4', backgroundPdf: 'data:application/pdf;base64,JVBE',
  widthMm: 0, heightMm: 0, dpi: 203, labelsPerSheet: 2, slotOffset: { dxMm: 105, dyMm: 0 }, calibration: { dxMm: 0, dyMm: 0, scale: 100 },
  slot2Fields: {}, fields: [{ id: 'w', kind: 'weight', xMm: 30, yMm: 20, sizePt: 36 }] }
const ZEBRA = { ...A4, id: 'zb', name: 'YALCIN · Zebra', clientId: 'cy', printMode: 'zebra', backgroundZpl: '^GFA,2,2,1,FF00', widthMm: 100, heightMm: 150, labelsPerSheet: 1 }

afterEach(cleanup)
beforeEach(() => {
  ;[...Object.values(units), ...Object.values(designs), druk.drukujEtykiety, print.drukuj].forEach(f => f.mockReset())
  pdf.zbudujPdfA4.mockClear()
  units.markLabelsPrinted.mockResolvedValue({ marked: 1 })
  druk.drukujEtykiety.mockResolvedValue(undefined)
  print.drukuj.mockResolvedValue(undefined)
  designs.get.mockImplementation(async (id: string) => (id === 'a4' ? A4 : ZEBRA))
})
const mount = () => render(<OknoEtykiet planId="p1" planNo="PROD/28/11/26" onClose={() => {}} />)

describe('Etykiety sztuk według szablonów', () => {
  it('pozycja z szablonem A4 drukuje PDF przez okno druku i oznacza sztuki', async () => {
    units.forPlan.mockResolvedValue([sztuka('u1', 'l1', 1), sztuka('u2', 'l1', 1)])
    designs.forPlan.mockResolvedValue({ l1: { designId: 'a4', name: 'ZAGROS · A4', printMode: 'a4' } })
    mount()
    expect(await screen.findByText(/ZAGROS · A4/)).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /Drukuj niewydrukowane \(2\)/ }))
    await waitFor(() => expect(units.markLabelsPrinted).toHaveBeenCalledWith(['u1', 'u2']))
    expect(pdf.zbudujPdfA4).toHaveBeenCalledWith(expect.objectContaining({ id: 'a4' }), expect.any(Array), expect.any(Object))
    expect(print.drukuj).toHaveBeenCalledWith(expect.objectContaining({ rodzaj: 'etykiety', pdfBase64: 'JVBERi0x', strict: true }))
    expect(druk.drukujEtykiety).not.toHaveBeenCalled()
  })

  it('anulowanie okna druku nie oznacza sztuk', async () => {
    units.forPlan.mockResolvedValue([sztuka('u1', 'l1', 1)])
    designs.forPlan.mockResolvedValue({ l1: { designId: 'a4', name: 'ZAGROS · A4', printMode: 'a4' } })
    print.drukuj.mockRejectedValue(new Error('Wydruk anulowany'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Drukuj niewydrukowane \(1\)/ }))
    expect(await screen.findByText(/Wydruk anulowany/)).toBeTruthy()
    expect(units.markLabelsPrinted).not.toHaveBeenCalled()
  })

  it('pozycja bez szablonu: ostrzeżenie i etykieta systemowa na Zebrze', async () => {
    units.forPlan.mockResolvedValue([sztuka('u1', 'l1', 1, { clientName: 'FUDI' })])
    designs.forPlan.mockResolvedValue({ l1: null })
    mount()
    expect(await screen.findByText(/Brak szablonu dla FUDI · KEBAB UDO 100% · KIRMIZI/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Drukuj niewydrukowane \(1\)/ }))
    await waitFor(() => expect(druk.drukujEtykiety).toHaveBeenCalled())
    expect(druk.drukujEtykiety.mock.calls[0][0][0]).toContain('^PW799')
    expect(druk.drukujEtykiety.mock.calls[0][1]).toBe('100x150')
    expect(units.markLabelsPrinted).toHaveBeenCalledWith(['u1'])
  })

  it('szablon Zebry: ZPL z tłem szablonu; A4 i Zebra w jednym planie — każda grupa swoją drogą', async () => {
    units.forPlan.mockResolvedValue([sztuka('u1', 'l1', 1), sztuka('u2', 'l2', 2, { clientName: 'YALCIN', clientId: 'cy' })])
    designs.forPlan.mockResolvedValue({ l1: { designId: 'a4', name: 'ZAGROS · A4', printMode: 'a4' }, l2: { designId: 'zb', name: 'YALCIN · Zebra', printMode: 'zebra' } })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Drukuj niewydrukowane \(2\)/ }))
    await waitFor(() => expect(units.markLabelsPrinted).toHaveBeenCalledTimes(2))
    expect(druk.drukujEtykiety.mock.calls[0][0][0]).toContain('^GFA,2,2,1,FF00')
    expect(print.drukuj).toHaveBeenCalledTimes(1)
    expect(units.markLabelsPrinted.mock.calls.map(c => c[0])).toEqual([['u1'], ['u2']])
  })

  it('kod HALAL wpisany w oknie trafia na etykietę', async () => {
    units.forPlan.mockResolvedValue([sztuka('u1', 'l1', 1)])
    designs.forPlan.mockResolvedValue({ l1: { designId: 'a4', name: 'ZAGROS · A4', printMode: 'a4' } })
    designs.get.mockResolvedValue({ ...A4, fields: [...A4.fields, { id: 'h', kind: 'org_code', xMm: 10, yMm: 10, sizePt: 10 }] })
    mount()
    fireEvent.change(await screen.findByLabelText(/Kod HALAL/), { target: { value: 'HAL-77' } })
    fireEvent.click(screen.getByRole('button', { name: /Drukuj niewydrukowane \(1\)/ }))
    await waitFor(() => expect(pdf.zbudujPdfA4).toHaveBeenCalled())
    expect((pdf.zbudujPdfA4.mock.calls[0] as unknown[])[2]).toMatchObject({ orgCode: 'HAL-77' })
  })
})
