// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { StrictMode } from 'react'
import type { A4PrintJob, LabelTemplate } from '@/lib/api'

const api = vi.hoisted(() => ({ units: vi.fn(), template: vi.fn(), recipe: vi.fn(), clients: vi.fn(),
  get: vi.fn(), prepare: vi.fn(), find: vi.fn(), action: vi.fn(), print: vi.fn(), qr: vi.fn() }))
vi.mock('@/lib/apiClient', () => ({ finishedUnitsApi: { listByPlanLine: api.units }, labelTemplatesApi: { get: api.template },
  recipesApi: { byId: api.recipe }, clientsApi: { list: api.clients } }))
vi.mock('@/lib/api', () => ({ labelA4JobsApi: { get: api.get, prepare: api.prepare, findByKey: api.find, action: api.action } }))
vi.mock('@/lib/print', () => ({ drukuj: api.print }))
vi.mock('qrcode', () => ({ default: { toDataURL: api.qr } }))
import { LabelPrintPage } from './LabelPrintPage'

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='
const template: LabelTemplate = { id: 't1', clientId: 'CLIENT', recipeId: 'r1', kind: 'overlay', backgroundData: png,
  fieldPositions: { qr: { x: 10, y: 10, size: 35 }, batch_no: { x: 10, y: 30, size: 20 } },
  labelsPerSheet: 2, pageSize: 'a4', zpl: '', slotFieldPositions: { '1': { qr: { x: 60.123456789, y: 70, size: 40 } } } }
const unit = { id: 'u1', qrCode: 'U|original', producedDate: '2026-10-15', weightKg: 20, batchNo: '401' }
let saved: A4PrintJob
beforeEach(() => {
  vi.resetAllMocks()
  saved = { id: 'saved-a4', ok: true, state: 'prepared', language: 'a4', transport: 'browser', printerUid: 'browser:dialog',
    printerName: 'Systemowe okno druku', sourceJobId: null, revisionId: 17, createdAt: '2026-10-20', createdBy: 'office:one',
    count: 1, unitIds: ['u1'], events: [], a4: { rendererVersion: 'legacy-a4-v1', template, units: [unit],
      placements: [{ sheet: 0, slot: 1 }], shelfLifeDays: 365, orgCode: 'HALAL-001', halal: true, labelsPerSheet: 2 } }
  api.units.mockResolvedValue([{ ...unit, qrCode: 'U|preview' }])
  api.template.mockResolvedValue({ exists: true, template })
  api.recipe.mockResolvedValue({ shelfLifeDays: 5 })
  api.clients.mockResolvedValue([])
  api.qr.mockResolvedValue(png)
  api.find.mockResolvedValue(null)
  api.get.mockImplementation(async () => structuredClone(saved))
  api.prepare.mockImplementation(async () => structuredClone(saved))
  api.action.mockImplementation(async (_id, dto) => {
    saved.state = dto.action === 'begin' ? 'submitting' : dto.action
    return { id: saved.id, state: saved.state, attemptToken: 'attempt-a4' }
  })
  api.print.mockResolvedValue(undefined)
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockResolvedValue(undefined) })
})
afterEach(cleanup)
function NavigateAway() {
  const navigate = useNavigate()
  return <><button onClick={() => navigate('/?jobId=other-a4')}>Inne zadanie</button><button onClick={() => navigate(-1)}>Poprzedni ekran</button></>
}
const open = (url: string) => render(<StrictMode><MemoryRouter initialEntries={[url]}><NavigateAway /><LabelPrintPage /></MemoryRouter></StrictMode>)

describe('A4 history over the existing renderer', () => {
  it('one click prepares on the server, renders frozen QR, and records only dialog invocation', async () => {
    open('/?planLineId=line&clientId=CLIENT&recipeId=r1')
    const button = await screen.findByRole('button', { name: 'Drukuj' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    expect(api.print).not.toHaveBeenCalled() // no legacy auto-print on load
    fireEvent.click(button); fireEvent.click(button)
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('saved-a4', { action: 'dialog_opened', attempt_token: 'attempt-a4' }))
    expect(api.prepare).toHaveBeenCalledOnce()
    expect(api.print).toHaveBeenCalledOnce()
    expect(api.qr).toHaveBeenCalledWith('U|original', expect.anything())
    expect(api.prepare.mock.calls[0][0]).toMatchObject({ language: 'a4', transport: 'browser', printer_uid: 'browser:dialog' })
    expect(api.action.mock.calls.map(call => call[1].action)).toEqual(['begin', 'dialog_opened'])
  })
  it('historical subset keeps its old slot and never asks for current production data', async () => {
    const original = { ...saved, id: 'original-job', state: 'dialog_opened' }
    api.get.mockImplementation(async id => structuredClone(id === 'original-job' ? original : saved))
    open('/?sourceJobId=original-job&unitIds=u1')
    const qr = await screen.findByAltText('QR U|original')
    expect(qr.style.left).toBe('60.123456789%')
    const button = screen.getByRole('button', { name: 'Drukuj' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(button)
    await waitFor(() => expect(api.print).toHaveBeenCalledOnce())
    expect(api.prepare.mock.calls[0][0]).toMatchObject({ source_job_id: 'original-job', unit_ids: ['u1'] })
    expect(api.prepare.mock.calls[0][0]).not.toHaveProperty('org_code')
    expect(api.units).not.toHaveBeenCalled(); expect(api.template).not.toHaveBeenCalled()
    expect(api.recipe).not.toHaveBeenCalled(); expect(api.clients).not.toHaveBeenCalled()
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('saved-a4', expect.objectContaining({ action: 'dialog_opened' })))
  })
  it('reload of a submitted dialog does not create or print another job', async () => {
    saved.state = 'dialog_opened'
    open('/?jobId=saved-a4')
    await screen.findByRole('heading', { name: 'Wywołano okno druku — wynik fizyczny niepotwierdzony' })
    expect((screen.getByRole('button', { name: 'Drukuj' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.print).not.toHaveBeenCalled(); expect(api.prepare).not.toHaveBeenCalled(); expect(api.action).not.toHaveBeenCalled()
  })
  it('recovers a lost preparation response by key without auto-printing', async () => {
    api.find.mockResolvedValue(saved)
    open('/?requestKey=operation-1')
    await screen.findByRole('region', { name: 'Historia zadania A4' })
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.action).not.toHaveBeenCalled()
    expect(api.units).not.toHaveBeenCalled(); expect(api.print).not.toHaveBeenCalled()
  })
  it('history failure cannot fall back to current templates', async () => {
    api.get.mockRejectedValue(new Error('history offline'))
    open('/?sourceJobId=missing&unitIds=u1')
    await screen.findByText('history offline')
    expect(api.template).not.toHaveBeenCalled(); expect(api.units).not.toHaveBeenCalled()
    expect(api.print).not.toHaveBeenCalled()
  })
  it('explicit empty selection is an error, not the whole batch', async () => {
    open('/?planLineId=line&unitIds=')
    await screen.findByText(/Nieprawidłowy wybór sztuk/)
    expect(api.prepare).not.toHaveBeenCalled(); expect(api.print).not.toHaveBeenCalled()
  })
  it('lost begin response prevents print and never retries the uncertain job', async () => {
    api.action.mockImplementation(async () => { saved.state = 'submitting'; throw new Error('connection lost') })
    open('/?jobId=saved-a4')
    const button = await screen.findByRole('button', { name: 'Drukuj' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await screen.findByText(/connection lost/)
    expect(api.print).not.toHaveBeenCalled(); expect(api.action).toHaveBeenCalledOnce()
    await screen.findByRole('button', { name: 'Zapisz nieznany wynik' })
  })
  it.each([false, true])('changing route while waiting for images prevents a late print, even when returning=%s', async goBack => {
    let decoded!: () => void
    const decode = vi.fn(() => new Promise<void>(resolve => { decoded = resolve }))
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: decode })
    // One QR and no background makes one decode promise deterministic.
    saved.a4.template = { ...template, backgroundData: '' }
    open('/?jobId=saved-a4')
    const button = await screen.findByRole('button', { name: 'Drukuj' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(decode).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Inne zadanie' }))
    if (goBack) fireEvent.click(screen.getByRole('button', { name: 'Poprzedni ekran' }))
    decoded()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith(goBack ? 'saved-a4' : 'other-a4'))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Drukuj' }) as HTMLButtonElement).disabled).toBe(false))
    expect(api.action).not.toHaveBeenCalled(); expect(api.print).not.toHaveBeenCalled()
  })
  it('changing route during a claim records uncertainty but does not print another document', async () => {
    let claimed!: (value: unknown) => void
    api.action.mockImplementation(async (_id, dto) => {
      if (dto.action === 'begin') return new Promise(resolve => { claimed = resolve })
      return { state: dto.action }
    })
    open('/?jobId=saved-a4')
    const button = await screen.findByRole('button', { name: 'Drukuj' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(api.action).toHaveBeenCalledOnce())
    fireEvent.click(screen.getByRole('button', { name: 'Inne zadanie' }))
    claimed({ state: 'submitting', attemptToken: 'claim-before-navigation' })
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('saved-a4', { action: 'uncertain', attempt_token: 'claim-before-navigation' }))
    expect(api.print).not.toHaveBeenCalled()
  })
  it('image decode failure leaves a prepared job, not a false dialog acknowledgement', async () => {
    Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: vi.fn().mockRejectedValue(new Error('image damaged')) })
    open('/?jobId=saved-a4')
    const button = await screen.findByRole('button', { name: 'Drukuj' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await screen.findByText(/image damaged/)
    expect(api.action).not.toHaveBeenCalled(); expect(api.print).not.toHaveBeenCalled()
  })
  it('an error from the print adapter is recorded as uncertain with no automatic retry', async () => {
    api.print.mockRejectedValue(new Error('native failed'))
    open('/?jobId=saved-a4')
    const button = await screen.findByRole('button', { name: 'Drukuj' })
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(button)
    await screen.findByText(/native failed/)
    expect(api.action.mock.calls.map(call => call[1].action)).toEqual(['begin', 'uncertain'])
    expect(api.print).toHaveBeenCalledOnce()
  })
  it('malformed historical placement shows an error and does not guess another slot', async () => {
    saved.a4.placements = [{ sheet: 0, slot: 5 }]
    open('/?jobId=saved-a4')
    await screen.findByText(/Nieprawidłowy lub powtórzony slot/)
    expect(api.print).not.toHaveBeenCalled(); expect(api.action).not.toHaveBeenCalled()
  })
  it('cancels only a prepared job and does not print it', async () => {
    open('/?jobId=saved-a4')
    fireEvent.click(await screen.findByRole('button', { name: 'Anuluj niewysłane zadanie' }))
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('saved-a4', { action: 'cancel', acknowledge_uncertain: false }))
    expect(api.print).not.toHaveBeenCalled()
  })
})
