// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { LabelPrintJob } from '@/lib/api'
import type { ZebraDevice } from '@/lib/zebra'

const mocks = vi.hoisted(() => ({ action: vi.fn(), send: vi.fn() }))
vi.mock('@/lib/api', () => ({ labelPrintJobsApi: { action: mocks.action } }))
vi.mock('@/lib/zebra', () => ({ sendZpl: mocks.send }))
import { deliverLabelJob, newLabelOperationKey } from './printJobWorkflow'

const device = { uid: 'usb-1' } as ZebraDevice
const job: LabelPrintJob = {
  id: 'j1', ok: true, state: 'prepared', printerUid: 'usb-1', printerName: 'Zebra', transport: 'browserprint',
  language: 'zpl', zpl: 'exact frozen bytes', count: 1, unitIds: ['u1'], revisionId: 1, sourceJobId: null,
  createdAt: '2026-10-19', createdBy: 'office:one', events: [],
}
beforeEach(() => {
  vi.resetAllMocks()
  mocks.action.mockImplementation(async (_id, dto) => ({ state: dto.action === 'begin' ? 'submitting' : dto.action, attemptToken: 'token' }))
  mocks.send.mockImplementation(async (_device, _zpl, options) => { await options.beforeSend() })
})

describe('durable label delivery: never retry uncertain IO', () => {
  it('creates an operation key on HTTP intranet origins without randomUUID', () => {
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(0xab) })
    try { expect(newLabelOperationKey()).toBe(`label-${'ab'.repeat(16)}`) }
    finally { vi.unstubAllGlobals() }
  })
  it('uses a preflight claim and sends the saved bytes without transport rewriting', async () => {
    await expect(deliverLabelJob(job, { device })).resolves.toBe('submitted')
    expect(mocks.send).toHaveBeenCalledWith(device, job.zpl, expect.objectContaining({ autoCalibrate: false, beforeSend: expect.any(Function) }))
    expect(mocks.action.mock.calls.map(call => call[1].action)).toEqual(['begin', 'submitted'])
  })
  it('a preflight failure leaves the job prepared, with no attempt claim', async () => {
    mocks.send.mockRejectedValue(new Error('head open'))
    await expect(deliverLabelJob(job, { device })).rejects.toThrow('head open')
    expect(mocks.action).not.toHaveBeenCalled()
  })
  it('a lost begin response does not authorize transmission or automatic retry', async () => {
    mocks.action.mockRejectedValue(new Error('connection lost'))
    const wire = vi.fn()
    mocks.send.mockImplementation(async (_device, _zpl, options) => { await options.beforeSend(); wire() })
    await expect(deliverLabelJob(job, { device })).rejects.toThrow('connection lost')
    expect(wire).not.toHaveBeenCalled()
    expect(mocks.action).toHaveBeenCalledOnce()
  })
  it.each(['USB timeout', 'acknowledgement lost'])('persists uncertainty after %s without a second send', async failure => {
    if (failure === 'USB timeout') mocks.send.mockImplementation(async (_device, _zpl, options) => { await options.beforeSend(); throw new Error(failure) })
    else mocks.action.mockImplementation(async (_id, dto) => {
      if (dto.action === 'submitted') throw new Error(failure)
      return { state: dto.action === 'begin' ? 'submitting' : dto.action, attemptToken: 'token' }
    })
    await expect(deliverLabelJob(job, { device })).rejects.toThrow(failure)
    expect(mocks.send).toHaveBeenCalledOnce()
    expect(mocks.action).toHaveBeenLastCalledWith('j1', { action: 'uncertain', attempt_token: 'token' })
  })
  it('wrong USB or terminal jobs are rejected before the transport', async () => {
    await expect(deliverLabelJob(job, { device: { uid: 'other' } as ZebraDevice })).rejects.toThrow('drukarkę')
    for (const state of ['submitting', 'submitted', 'uncertain', 'cancelled', 'exported'] as const) {
      await expect(deliverLabelJob({ ...job, state }, { device })).rejects.toThrow('ponownie')
    }
    expect(mocks.send).not.toHaveBeenCalled()
  })
  it('navigation while preflight is queued aborts without claiming or sending', async () => {
    await expect(deliverLabelJob(job, { device, isActive: () => false })).rejects.toThrow('Ekran został zmieniony')
    expect(mocks.action).not.toHaveBeenCalled()
  })
  it('export records a file handoff, never a printer acknowledgement', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:label'), revokeObjectURL: vi.fn() }))
    await expect(deliverLabelJob({ ...job, transport: 'file', printerUid: 'file:zpl' })).resolves.toBe('exported')
    expect(click).toHaveBeenCalledOnce()
    expect(mocks.send).not.toHaveBeenCalled()
    expect(mocks.action.mock.calls.map(call => call[1].action)).toEqual(['begin', 'exported'])
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
