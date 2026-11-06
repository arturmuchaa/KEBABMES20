// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import type { LabelPrintJob } from '@/lib/api'

const api = vi.hoisted(() => ({ design: vi.fn(), legacy: vi.fn(), prepare: vi.fn(), get: vi.fn(), find: vi.fn(), action: vi.fn(), devices: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/api', () => ({ zebraDesignsApi: { render: api.design }, labelsZebraApi: { render: api.legacy },
  labelPrintJobsApi: { prepare: api.prepare, get: api.get, findByKey: api.find, action: api.action },
}))
vi.mock('@/lib/zebra', () => ({ getDevices: api.devices, sendZpl: api.send, zebraErrorMessage: (error: Error) => error.message }))
vi.mock('@/components/ZebraPrinterPanel', () => ({ ZebraPrinterPanel: () => null }))
import { ZebraPrintPage } from './ZebraPrintPage'
afterEach(cleanup)
let saved: LabelPrintJob
beforeEach(() => {
  vi.resetAllMocks()
  saved = {
    id: 'saved-job', ok: true, state: 'prepared', revisionId: 17, sourceJobId: null, language: 'zpl',
    printerName: 'Zebra', printerUid: 'usb-1', transport: 'browserprint', createdAt: '2026-10-19', createdBy: 'office:one',
    unitIds: ['existing-unit'], count: 1, zpl: '^XA^FDfrozen^FS^XZ', events: [],
  }
  api.devices.mockResolvedValue({ default: { uid: 'usb-1', name: 'Zebra' } })
  api.prepare.mockImplementation(async () => ({ ...saved }))
  api.get.mockImplementation(async () => ({ ...saved }))
  api.find.mockResolvedValue(null)
  api.action.mockImplementation(async (_id, dto) => {
    saved = { ...saved, state: dto.action === 'begin' ? 'submitting' : dto.action }
    return { id: saved.id, state: saved.state, attemptToken: 'attempt-1' }
  })
  api.send.mockImplementation(async (_device, _zpl, options) => { await options.beforeSend() })
  api.design.mockResolvedValue({ ok: true, zpl: '^XA^FDpreview^FS^XZ', count: 1 })
})

describe('Zebra print: reprint selection survives both rendering paths', () => {
  it('passes the selected existing ID to the designer and legacy fallback', async () => {
    api.design.mockResolvedValue({ ok: false, reason: 'Brak projektu etykiety Zebra' })
    api.legacy.mockResolvedValue({ ok: true, zpl: '^XA^XZ', count: 1 })
    render(<MemoryRouter initialEntries={['/?planLineId=line&clientId=VATAN&recipeId=r1&unitIds=existing-unit']}><ZebraPrintPage /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Drukuj (1)' })
    expect(api.design).toHaveBeenCalledWith('VATAN', 'r1', 'line', 'existing-unit')
    expect(api.legacy).toHaveBeenCalledWith('line', 'VATAN', 'r1', 'existing-unit')
  })
  it('keeps an explicit empty selection invalid rather than requesting all units', async () => {
    api.design.mockRejectedValue(new Error('invalid ids'))
    api.legacy.mockRejectedValue(new Error('invalid ids'))
    render(<MemoryRouter initialEntries={['/?planLineId=line&unitIds=']}><ZebraPrintPage /></MemoryRouter>)
    await waitFor(() => expect(api.design).toHaveBeenCalledWith('', '', 'line', ''))
    await screen.findByText(/Błąd pobierania ZPL/)
    expect(api.legacy).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Drukuj' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('does not bypass a missing QR validation using another legacy template', async () => {
    api.design.mockResolvedValue({ ok: false, reason: 'Dodaj dynamiczny kod QR' })
    render(<MemoryRouter initialEntries={['/?planLineId=line']}><ZebraPrintPage /></MemoryRouter>)
    await screen.findByText('Dodaj dynamiczny kod QR')
    expect(api.legacy).not.toHaveBeenCalled()
  })
  it('one click freezes first, sends only frozen bytes, then records acknowledgement once', async () => {
    render(<MemoryRouter initialEntries={['/?planLineId=line&clientId=VATAN&recipeId=r1']}><ZebraPrintPage /></MemoryRouter>)
    fireEvent.click(await screen.findByRole('button', { name: 'Drukuj (1)' }))
    await screen.findByRole('region', { name: 'Historia zadania' })
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('saved-job', { action: 'submitted', attempt_token: 'attempt-1' }))
    expect(api.prepare).toHaveBeenCalledWith(expect.objectContaining({ plan_line_id: 'line', client_id: 'VATAN', recipe_id: 'r1', printer_uid: 'usb-1' }))
    expect(api.send).toHaveBeenCalledOnce()
    expect(api.send.mock.calls[0][1]).toBe('^XA^FDfrozen^FS^XZ')
    await waitFor(() => expect((screen.getByRole('button', { name: 'Drukuj (1)' }) as HTMLButtonElement).disabled).toBe(true))
    expect(api.prepare).toHaveBeenCalledOnce()
  })
  it('historical reprint requires acknowledgement and never fetches current templates', async () => {
    const original = { ...saved, id: 'original', state: 'uncertain', revisionId: 9 }
    api.get.mockImplementation(async id => id === 'original' ? original : saved)
    render(<MemoryRouter initialEntries={['/?sourceJobId=original&unitIds=existing-unit']}><ZebraPrintPage /></MemoryRouter>)
    const button = await screen.findByRole('button', { name: 'Drukuj (1)' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(button)
    await waitFor(() => expect(api.prepare).toHaveBeenCalledOnce())
    const dto = api.prepare.mock.calls[0][0]
    expect(dto).toMatchObject({ source_job_id: 'original', unit_ids: ['existing-unit'], acknowledge_uncertain: true })
    expect(dto).not.toHaveProperty('plan_line_id')
    expect(api.design).not.toHaveBeenCalled()
    expect(api.legacy).not.toHaveBeenCalled()
    await waitFor(() => expect(api.action).toHaveBeenCalledWith('saved-job', expect.objectContaining({ action: 'submitted' })))
  })
  it('reload recovers a lost prepare response but never sends automatically', async () => {
    api.find.mockResolvedValue(saved)
    render(<MemoryRouter initialEntries={['/?requestKey=operation-1']}><ZebraPrintPage /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Wyślij zapisane zadanie (1)' })
    expect(api.find).toHaveBeenCalledWith('operation-1')
    expect(api.prepare).not.toHaveBeenCalled()
    expect(api.action).not.toHaveBeenCalled()
    expect(api.send).not.toHaveBeenCalled()
    expect(api.design).not.toHaveBeenCalled()
  })
  it('a reloaded submitting job is blocked, with explicit recovery instead of retry', async () => {
    saved.state = 'submitting'
    render(<MemoryRouter initialEntries={['/?jobId=saved-job']}><ZebraPrintPage /></MemoryRouter>)
    await screen.findByRole('button', { name: 'Zapisz nieznany wynik' })
    expect((screen.getByRole('button', { name: 'Drukuj (1)' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.send).not.toHaveBeenCalled()
    expect(api.prepare).not.toHaveBeenCalled()
    expect(api.design).not.toHaveBeenCalled()
  })
  it('failed history load cannot fall back to current data or print', async () => {
    api.get.mockRejectedValue(new Error('history offline'))
    render(<MemoryRouter initialEntries={['/?sourceJobId=original&unitIds=existing-unit']}><ZebraPrintPage /></MemoryRouter>)
    await screen.findByText(/history offline/)
    expect(api.design).not.toHaveBeenCalled()
    expect(api.legacy).not.toHaveBeenCalled()
    expect(api.prepare).not.toHaveBeenCalled()
  })
})
