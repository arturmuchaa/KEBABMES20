// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), importRaster: vi.fn() }))
vi.mock('@/lib/api', () => ({
  zebraDesignsApi: { get: api.get, save: api.save }, labelTemplatesApi: { importRaster: api.importRaster },
  clientsApi: { list: () => Promise.resolve([{ id: 'c1', name: 'TEST' }]) },
  recipesApi: { list: () => Promise.resolve([{ id: 'r1', name: 'Kebab' }]) },
}))
vi.mock('@/lib/zebra', () => ({
  getDevices: () => Promise.resolve({ list: [], default: null }),
  probeBrowserPrint: () => Promise.resolve({ ok: false }), browserPrintBaseUrl: () => 'http://localhost', sendZpl: vi.fn(),
}))
import { ZebraDesignerPage } from './ZebraDesignerPage'

const imported = {
  language: 'epl', dpi: 203, widthMm: 50.4, heightMm: 80.1,
  sourceSha256: 'source-hash', backgroundData: 'data:image/png;base64,AAA',
  backgroundZpl: '^XA^PW8^LL1^FO0,0^GFA,1,1,1,80^FS^PQ1^XZ',
}
beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ exists: false })
  api.save.mockResolvedValue({ ok: true })
  api.importRaster.mockResolvedValue(imported)
  vi.stubGlobal('confirm', vi.fn(() => true))
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected external request'))))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const open = () => render(<MemoryRouter initialEntries={['/?clientId=TEST&recipeId=r1']}><ZebraDesignerPage /></MemoryRouter>)

describe('existing Zebra designer: strict local raster import', () => {
  it('imports binary PRN, saves original physical dimensions and reopens without Labelary', async () => {
    const view = open()
    const input = screen.getByLabelText('Import grafiki PRN EPL ZPL') as HTMLInputElement
    await waitFor(() => expect(input.disabled).toBe(false))
    const file = new File([new Uint8Array([0, 255, 10])], 'raster.prn')
    fireEvent.change(input, { target: { files: [file] } })
    await screen.findByText(/Zaimportowano grafikę lokalnie/)
    expect(api.importRaster).toHaveBeenCalledWith(file, 203)
    expect((screen.getByLabelText('Rozmiar etykiety') as HTMLSelectElement).disabled).toBe(true)
    expect((screen.getByLabelText('DPI eksportu') as HTMLSelectElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz' }))
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    const saved = api.save.mock.calls[0][0]
    expect(saved).toMatchObject({ widthMm: 50.4, heightMm: 80.1, dpi: 203, backgroundZpl: imported.backgroundZpl, sizeKey: 'raster-v1:epl:source-hash' })
    view.unmount()
    api.get.mockResolvedValue({ exists: true, design: saved })
    open()
    await waitFor(() => expect(api.importRaster).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByAltText('tło etykiety').getAttribute('src')).toBe(imported.backgroundData))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('reports unsupported input without replacing the design', async () => {
    api.importRaster.mockRejectedValue(new Error('Nieobsługiwana instrukcja EPL: GK'))
    open()
    const input = screen.getByLabelText('Import grafiki PRN EPL ZPL') as HTMLInputElement
    await waitFor(() => expect(input.disabled).toBe(false))
    fireEvent.change(input, { target: { files: [new File(['N\nGK'], 'bad.prn')] } })
    await screen.findByText('Nieobsługiwana instrukcja EPL: GK')
    expect((screen.getByLabelText('Rozmiar etykiety') as HTMLSelectElement).value).toBe('100x150')
    expect(api.save).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })
})
