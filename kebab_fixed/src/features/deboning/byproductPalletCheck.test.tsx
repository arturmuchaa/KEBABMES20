// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ByproductPalletCheckModal, palletCheckNet } from './ByproductPalletCheckModal'
import { byproductPalletChecksApi } from '@/lib/api'
import { sendZpl } from '@/lib/zebra'
import type { RawBatch } from '@/types'

vi.mock('@/lib/api', () => ({ byproductPalletChecksApi: { create: vi.fn(), recent: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/zebra', () => ({ getDevices: vi.fn().mockResolvedValue({ default: { name: 'zebra' }, list: [] }), sendZpl: vi.fn().mockResolvedValue(undefined), probeBrowserPrint: vi.fn() }))
afterEach(cleanup)

const batches = [{ id: 'b695', internalBatchNo: '695' }, { id: 'b696', internalBatchNo: '696' }] as RawBatch[]
const scale = { available: true, connected: true, stable: true, gross: 412.5, tare: vi.fn() }

describe('paleta grzbietów/kości — ważenie informacyjne', () => {
  it('net = gross − pallet − E2 × 2 kg', () => {
    expect(palletCheckNet(412.5, 18, 20)).toBe(354.5)
    expect(palletCheckNet(412.5, null, 20)).toBe(0)
    expect(palletCheckNet(10, 18, 0)).toBe(0)
  })

  it('records the pallet from two batches and prints a "paleta zbiorcza" label', async () => {
    vi.mocked(byproductPalletChecksApi.create).mockResolvedValue({ id: 'x', kind: 'backs', kgNet: 354.5, kgGross: 412.5, tareKg: 18, tareLabel: 'H1',
      e2Count: 20, tareE2Kg: 40, weighMode: 'auto', reason: '', workersKg: 356, weighedBy: 'k', weighedAt: '2026-11-06T11:00:00Z',
      batches: [{ rawBatchId: 'b695', rawBatchNo: '695', expiryDate: '2026-11-12' }, { rawBatchId: 'b696', rawBatchNo: '696', expiryDate: '2026-11-13' }] })
    render(<ByproductPalletCheckModal scale={scale} cartTares={[6]} batches={batches} defaultBatchId="b695" productionDate="2026-11-06" onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '696' }))
    fireEvent.click(screen.getAllByRole('button').find(b => b.textContent?.startsWith('H1'))!)
    for (let i = 0; i < 20; i++) fireEvent.click(screen.getByRole('button', { name: 'Więcej pojemników' }))
    const save = screen.getByRole('button', { name: /ZAPISZ I DRUKUJ ETYKIETĘ — GRZBIETY 354,5 KG/ })
    await act(async () => { fireEvent.click(save) })
    const dto = vi.mocked(byproductPalletChecksApi.create).mock.calls[0][0]
    expect(dto).toMatchObject({ kind: 'backs', rawBatchIds: ['b695', 'b696'], kgNet: 354.5, kgGross: 412.5, tareKg: 18, tareE2Kg: 40, e2Count: 20, weighMode: 'auto' })
    const zpl = vi.mocked(sendZpl).mock.calls[0][1] as string
    expect(zpl).toContain('695+696'); expect(zpl).toContain('paleta zbiorcza'); expect(zpl).toContain('354,5 kg')
    expect(screen.getByRole('status').textContent).toMatch(/Zapisano i wydrukowano/)
    expect(screen.getByText(/pracownicy zważyli z partii 695, 696: 356,0 kg · różnica −1,5 kg/)).toBeTruthy()
  })
})
