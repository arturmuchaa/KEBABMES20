// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ open: vi.fn(), resolve: vi.fn(), list: vi.fn(), history: vi.fn() }))
vi.mock('@/lib/otworzDokument', () => ({ useOtworzDokument: () => api.open }))
vi.mock('@/lib/api', () => ({
  labelTemplatesApi: { resolve: api.resolve }, finishedUnitsApi: { listByPlanLine: api.list },
  labelPrintJobsApi: { history: api.history },
}))
import { UnitReprintModal } from './UnitReprintModal'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue([{ id: 'existing-unit', qrCode: 'U|original', batchNo: '401', status: 'planned' }])
  api.history.mockResolvedValue([])
})

describe('existing reprint dialog: one piece, A4 or Zebra', () => {
  for (const [kind, path] of [['pdf', '/etykiety/druk'], ['zebra', '/etykiety/zebra']]) {
    it(`routes ${kind} without generating another unit`, async () => {
      api.resolve.mockResolvedValue({ kind })
      render(<UnitReprintModal line={{ id: 'line', clientName: 'VATAN', recipeId: 'r1' }} open onClose={() => {}} />)
      fireEvent.click(await screen.findByRole('button', { name: 'Dodrukuj' }))
      await waitFor(() => expect(api.open).toHaveBeenCalledOnce())
      const url = new URL(api.open.mock.calls[0][0], 'http://mes.test')
      expect(url.pathname).toBe(path)
      expect(url.searchParams.get('unitIds')).toBe('existing-unit')
      expect(url.searchParams.get('planLineId')).toBe('line')
      expect(api.resolve).toHaveBeenCalledWith('VATAN', 'r1')
    })
  }
  it('does not guess a printer pathway after a failed lookup', async () => {
    api.resolve.mockRejectedValue(new Error('offline'))
    render(<UnitReprintModal line={{ id: 'line' }} open onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dodrukuj' }))
    await waitFor(() => expect(api.resolve).toHaveBeenCalled())
    expect(api.open).not.toHaveBeenCalled()
  })
  it.each(['zpl', 'a4'])('selects a frozen %s revision without resolving the current template', async language => {
    api.history.mockResolvedValue([{ id: 'original-job', state: language === 'a4' ? 'dialog_opened' : 'submitted', language, revisionId: 17, printerName: 'Printer' }])
    render(<UnitReprintModal line={{ id: 'line', clientName: 'VATAN', recipeId: 'r1' }} open onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dodrukuj' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Dodruk z tej wersji' }))
    const url = new URL(api.open.mock.calls[0][0], 'http://mes.test')
    expect(url.pathname).toBe(language === 'a4' ? '/etykiety/druk' : '/etykiety/zebra')
    expect(url.searchParams.get('sourceJobId')).toBe('original-job')
    expect(url.searchParams.get('unitIds')).toBe('existing-unit')
    expect(url.searchParams.has('clientId')).toBe(false)
    expect(api.resolve).not.toHaveBeenCalled()
  })
  it('does not silently use current data when history is unavailable', async () => {
    api.history.mockRejectedValue(new Error('offline'))
    render(<UnitReprintModal line={{ id: 'line' }} open onClose={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Dodrukuj' }))
    await waitFor(() => expect(api.history).toHaveBeenCalled())
    expect(api.open).not.toHaveBeenCalled()
    expect(api.resolve).not.toHaveBeenCalled()
  })
})
