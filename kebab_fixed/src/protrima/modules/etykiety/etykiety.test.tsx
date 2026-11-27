// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

/** Projektor etykiet kebabów (27.11.2026). Dane syntetyczne. */
const designs = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), save: vi.fn(), remove: vi.fn(), importPrn: vi.fn(), forPlan: vi.fn() }))
const kl = vi.hoisted(() => ({ list: vi.fn() }))
const rec = vi.hoisted(() => ({ list: vi.fn() }))
const pt = vi.hoisted(() => ({ list: vi.fn() }))
const druk = vi.hoisted(() => ({ drukujEtykiety: vi.fn(), opisBledu: vi.fn(async (e: unknown) => String(e)) }))
const print = vi.hoisted(() => ({ drukuj: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), labelDesignsApi: designs, clientsApi: kl, recipesApi: rec, productTypesApi: pt }))
vi.mock('../../drukarka/drukarka', () => ({ ...druk, ROLKA_ETYKIET: '100x150' }))
vi.mock('@/lib/print', () => print)
vi.mock('@/lib/pdfToImage', () => ({ pdfFirstPageToPng: vi.fn(async () => 'data:image/png;base64,AAAA') }))
vi.mock('./pdfA4', () => ({ zbudujPdfA4: vi.fn(async () => 'JVBERi0x') }))
import { EtykietyModule } from './EtykietyModule'

const app = { toast: vi.fn(), openModule: vi.fn(), appRef: { current: null }, scale: 1, panel: 'bok', setPanel: vi.fn() } as unknown as AppApi
const cmds = vi.fn()
const cmd = (id: string) => cmds.mock.lastCall![0].find((c: { id: string }) => c.id === id)
const mount = () => render(<AppCtx.Provider value={app}><EtykietyModule active setCtx={vi.fn()} setCmds={cmds} /></AppCtx.Provider>)

const ZEBRA = {
  id: 'z1', name: 'YALCIN · Zebra', clientId: 'cy', productTypeId: '', recipeId: '', printMode: 'zebra', backgroundZpl: '^GFA,2,2,1,FF00',
  backgroundPng: 'data:image/png;base64,AAAA', widthMm: 100, heightMm: 150, dpi: 203, labelsPerSheet: 1,
  slotOffset: { dxMm: 105, dyMm: 0 }, calibration: { dxMm: 0, dyMm: 0, scale: 100 }, slot2Fields: {},
  fields: [{ id: 'w', kind: 'weight', xMm: 40, yMm: 60, sizePt: 40, bold: true, font: 'arial' }],
}

afterEach(cleanup)
beforeEach(() => {
  ;[...Object.values(designs), kl.list, rec.list, pt.list, druk.drukujEtykiety, print.drukuj, cmds].forEach(f => f.mockReset())
  designs.list.mockResolvedValue([
    { id: 'z1', name: 'YALCIN · Zebra', clientId: 'cy', clientName: 'YALCIN', productTypeId: '', recipeId: '', productTypeName: '', recipeName: '', printMode: 'zebra', active: true, widthMm: 100, heightMm: 150, labelsPerSheet: 1, sourceName: '', updatedAt: null, updatedBy: '' },
    { id: 'a1', name: 'ZAGROS · A4', clientId: 'cz', clientName: 'ZAGROS', productTypeId: '', recipeId: 'kir', productTypeName: '', recipeName: 'KIRMIZI', printMode: 'a4', active: true, widthMm: 0, heightMm: 0, labelsPerSheet: 2, sourceName: '', updatedAt: null, updatedBy: '' },
  ])
  designs.get.mockResolvedValue(ZEBRA)
  designs.save.mockResolvedValue({ id: 'n1', revision: 1 })
  kl.list.mockResolvedValue([{ id: 'cz', name: 'OKAYTEKIN KG', displayName: 'ZAGROS' }, { id: 'cy', name: 'EMIN GMBH', displayName: 'YALCIN' }])
  rec.list.mockResolvedValue([{ id: 'kir', name: 'KIRMIZI' }])
  pt.list.mockResolvedValue([{ id: 'udo', name: 'KEBAB UDO 100%' }])
  druk.drukujEtykiety.mockResolvedValue(undefined)
  print.drukuj.mockResolvedValue(undefined)
})

const otworzZebre = async () => {
  mount()
  fireEvent.click(await screen.findByRole('button', { name: /YALCIN · Zebra/ }))
  return screen.findByRole('button', { name: /Pole Waga/ })
}

describe('Projektor etykiet', () => {
  it('szablony pogrupowane klientem', async () => {
    mount()
    const grupy = await screen.findAllByRole('heading', { level: 4 })
    expect(grupy.map(g => g.textContent)).toEqual(['YALCIN', 'ZAGROS'])
    expect(screen.getByText(/A4 × 2/)).toBeTruthy()
    expect(screen.getByText(/Zebra 100 × 150/)).toBeTruthy()
  })

  it('nowy szablon A4 z PDF: plik, pole Waga, klient, zapis', async () => {
    mount()
    await screen.findAllByRole('heading', { level: 4 })
    await React.act(async () => { cmd('new').run() })
    const plik = new File(['%PDF-1.4'], 'zagros.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Plik etykiety'), { target: { files: [plik] } })
    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szablon' }))
    await screen.findByRole('img', { name: /Tło etykiety/ })
    fireEvent.click(screen.getByRole('button', { name: 'Dodaj pole: Waga' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Przypisanie' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Klient' }))
    fireEvent.click(await screen.findByRole('option', { name: /ZAGROS/ }))
    await React.act(async () => { await cmd('save').run() })
    await waitFor(() => expect(designs.save).toHaveBeenCalled())
    const zapis = designs.save.mock.calls[0][0]
    expect(zapis).toMatchObject({ printMode: 'a4', clientId: 'cz', sourceName: 'zagros.pdf' })
    expect(zapis.backgroundPdf).toMatch(/^data:application\/pdf;base64,/)
    expect(zapis.fields.map((f: { kind: string }) => f.kind)).toEqual(['weight'])
  })

  it('zapis bez klienta: komunikat, nic nie idzie do serwera', async () => {
    mount()
    await screen.findAllByRole('heading', { level: 4 })
    await React.act(async () => { cmd('new').run() })
    fireEvent.change(screen.getByLabelText('Plik etykiety'), { target: { files: [new File(['%PDF'], 'x.pdf', { type: 'application/pdf' })] } })
    fireEvent.click(screen.getByRole('button', { name: 'Utwórz szablon' }))
    await screen.findByRole('img', { name: /Tło etykiety/ })
    await React.act(async () => { await cmd('save').run() })
    expect(await screen.findByText(/Wybierz klienta/)).toBeTruthy()
    expect(designs.save).not.toHaveBeenCalled()
  })

  it('strzałka przesuwa pole o 0,5 mm, Shift o 5 mm, Ctrl+Z cofa', async () => {
    const p = await otworzZebre()
    fireEvent.click(p)
    const x = () => (screen.getByLabelText('X (mm)') as HTMLInputElement).value
    expect(x()).toBe('40')
    fireEvent.keyDown(window, { key: 'ArrowRight' })
    expect(x()).toBe('40,5')
    fireEvent.keyDown(window, { key: 'ArrowRight', shiftKey: true })
    expect(x()).toBe('45,5')
    fireEvent.keyDown(window, { key: 'z', ctrlKey: true })
    expect(x()).toBe('40,5')
  })

  it('pole poza etykietą pokazuje ostrzeżenie', async () => {
    const p = await otworzZebre()
    fireEvent.click(p)
    fireEvent.change(screen.getByLabelText('X (mm)'), { target: { value: '99' } })
    expect(await screen.findByText(/wychodzi poza etykietę/)).toBeTruthy()
  })

  it('próbny druk: Zebra prosto na drukarkę, A4 przez okno druku', async () => {
    await otworzZebre()
    await React.act(async () => { await cmd('test').run() })
    await waitFor(() => expect(druk.drukujEtykiety).toHaveBeenCalled())
    expect(druk.drukujEtykiety.mock.calls[0][0][0]).toMatch(/^~DGR:K\w+\.GRF,2,1,FF00$/)
    expect(druk.drukujEtykiety.mock.calls[0][0][1]).toContain('^XGR:')
    expect(druk.drukujEtykiety.mock.calls[0][1]).toBe('100x150')
    designs.get.mockResolvedValue({ ...ZEBRA, id: 'a1', printMode: 'a4', backgroundPdf: 'data:application/pdf;base64,JVBE', name: 'ZAGROS · A4', clientId: 'cz' })
    fireEvent.click(screen.getByRole('button', { name: /ZAGROS · A4/ }))
    await screen.findByRole('button', { name: /Pole Waga/ })
    await React.act(async () => { await cmd('test').run() })
    await waitFor(() => expect(print.drukuj).toHaveBeenCalledWith(expect.objectContaining({ rodzaj: 'etykiety', pdfBase64: 'JVBERi0x' })))
  })

  it('panel pola: zmiana rozmiaru i obrotu (Zebra)', async () => {
    const p = await otworzZebre()
    fireEvent.click(p)
    const panel = screen.getByRole('region', { name: 'Właściwości pola' })
    fireEvent.change(within(panel).getByLabelText('Rozmiar (pt)'), { target: { value: '48' } })
    fireEvent.click(within(panel).getByRole('button', { name: 'Obrót 90°' }))
    await React.act(async () => { await cmd('save').run() })
    await waitFor(() => expect(designs.save).toHaveBeenCalled())
    expect(designs.save.mock.calls[0][0].fields[0]).toMatchObject({ sizePt: 48, rotation: 90 })
  })
})
