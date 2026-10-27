// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const api = vi.hoisted(() => ({ get: vi.fn(), save: vi.fn(), clients: vi.fn(), recipes: vi.fn() }))
vi.mock('@/lib/apiClient', () => ({
  labelTemplatesApi: { get: api.get, save: api.save },
  clientsApi: { list: api.clients }, recipesApi: { list: api.recipes },
}))
vi.mock('qrcode', () => ({ default: { toDataURL: () => Promise.resolve('data:image/png;base64,AAA') } }))
vi.mock('@/lib/pdfToImage', () => ({ pdfFirstPageToPng: vi.fn() }))
vi.mock('./LabelPrintPage', () => ({ buildVectorPdf: vi.fn() }))
import { LabelTemplateSetupPage } from './LabelTemplateSetupPage'

const template = () => ({
  id: 'template', clientId: 'VATAN', recipeId: 'r1', kind: 'overlay', pageSize: 'a4', zpl: '',
  backgroundData: 'data:image/png;base64,AAA', backgroundPdf: 'data:application/pdf;base64,BBB',
  labelsPerSheet: 2,
  fieldPositions: { qr: { x: 10.123456, y: 20, size: 35 }, weight: { x: 30, y: 40, size: 12, bold: true, fontFamily: 'Arial Narrow' } },
  slotOffsets: [{ dx: 0, dy: 0 }, { dx: 48.7, dy: 0.5 }],
  slotFieldPositions: { '1': { qr: { x: 60.234567, y: 21, size: 32 } } },
  printCalib: { dxMm: 1.5, dyMm: -2, scale: 98, fit: true, fitStretch: true },
})
beforeEach(() => {
  vi.clearAllMocks()
  api.get.mockResolvedValue({ exists: true, template: template() })
  api.save.mockResolvedValue({})
  api.clients.mockResolvedValue([{ id: 'c1', name: 'VATAN' }])
  api.recipes.mockResolvedValue([{ id: 'r1', name: 'Kebab' }])
})
afterEach(cleanup)
async function open() {
  render(<MemoryRouter initialEntries={['/?clientId=VATAN&recipeId=r1']}><LabelTemplateSetupPage /></MemoryRouter>)
  await screen.findByRole('button', { name: /^Kod QR/ })
}

describe('MES Label Studio: existing A4 form, no schema conversion', () => {
  it('roundtrips every legacy setting without rewriting fractional coordinates', async () => {
    await open()
    fireEvent.click(screen.getAllByRole('button', { name: 'Zapisz szablon' })[0])
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    const { id, ...expected } = template()
    expect(api.save.mock.calls[0][0]).toEqual(expected)
  })
  it('edits a second-slot position in mm and undo restores the exact original', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Etykieta 2' }))
    fireEvent.click(screen.getByRole('button', { name: /^Kod QR/ }))
    fireEvent.change(screen.getByLabelText('X (mm)'), { target: { value: '126' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Zapisz szablon' })[0])
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    expect(api.save.mock.calls[0][0].slotFieldPositions['1'].qr.x).toBe(60)
    expect(api.save.mock.calls[0][0].fieldPositions).toEqual(template().fieldPositions)
    fireEvent.click(screen.getByRole('button', { name: 'Cofnij' }))
    await waitFor(() => expect((screen.getByLabelText('X (mm)') as HTMLInputElement).value).toBe('126.493'))
  })
  it('retains classic UI, per-slot overrides and advanced calibration', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: 'Układ klasyczny' }))
    expect(screen.getByText('Konfiguracja szablonu etykiety')).toBeTruthy()
    expect(screen.getByText('Korekta położenia etykiet 2+')).toBeTruthy()
    expect(screen.getByText('Kalibracja druku (ucinany pasek / marginesy)')).toBeTruthy()
    expect(screen.getByLabelText(/Rozciągnij na całą wysokość/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Zapisz szablon' })[0])
    await waitFor(() => expect(api.save).toHaveBeenCalled())
    expect(api.save.mock.calls[0][0].printCalib).toEqual(template().printCalib)
  })
  it('keyboard movement respects position lock and input editing', async () => {
    await open()
    fireEvent.click(screen.getByRole('button', { name: /^Kod QR/ }))
    const workspace = screen.getByRole('group', { name: 'Obszar roboczy etykiety A4' })
    fireEvent.keyDown(workspace, { key: 'ArrowRight', shiftKey: true })
    expect(Number((screen.getByLabelText('X (mm)') as HTMLInputElement).value)).toBeCloseTo(22.259)
    fireEvent.click(screen.getByLabelText('Zablokuj edycję pozycji w tej sesji'))
    fireEvent.keyDown(workspace, { key: 'ArrowRight', shiftKey: true })
    expect(Number((screen.getByLabelText('X (mm)') as HTMLInputElement).value)).toBeCloseTo(22.259)
    fireEvent.keyDown(workspace, { key: 'z', ctrlKey: true })
    expect(Number((screen.getByLabelText('X (mm)') as HTMLInputElement).value)).toBeCloseTo(21.259)
  })
  it('never enables save when loading the selected template fails', async () => {
    api.get.mockRejectedValue(new Error('offline'))
    render(<MemoryRouter initialEntries={['/?clientId=VATAN&recipeId=r1']}><LabelTemplateSetupPage /></MemoryRouter>)
    await waitFor(() => expect(api.get).toHaveBeenCalled())
    expect((screen.getByRole('button', { name: 'Zapisz szablon' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByRole('group', { name: 'Obszar roboczy etykiety A4' })).toBeNull()
  })
})
