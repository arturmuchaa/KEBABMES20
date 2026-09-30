// @vitest-environment jsdom
/**
 * Karta kartonu (właściciel 30.09.2026): pod nagłówkiem HMI, a pierwsza
 * informacja to ważenie — kiedy, kto, zgodna czy nie; albo „NIE WAŻONY".
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { KartaKartonu } from './KartaKartonu'

const K = {
  result: 'OK' as const, status: 'cold_storage' as const, kind: 'stock' as const, id: 'c1', cartonNo: '000123',
  clientName: 'YALCIN', orderNo: '', full: true, netKg: 750, qty: 15,
  lines: [{ qty: 15, kgPerUnit: 50, recipeName: 'ZAGROS', productTypeName: '' }], batches: [],
}
const W = {
  id: 'w1', code: 'SCARTON|c1', containerKind: 'stock', containerId: 'c1', cartonNo: '000123', clientName: 'YALCIN',
  orderNo: '', lines: [], batches: [], palletTypeId: 'euro', palletTypeName: 'EURO', tareMinKg: 33, tareMaxKg: 37,
  tareKg: 35, marginPct: 1, grossKg: 790.5, netKg: 750, diffKg: 0, ok: true, weighMode: 'manual',
  operator: 'Jan', weighedAt: '2026-09-30T08:05:00',
} as any

afterEach(cleanup)

describe('karta kartonu — ważenie', () => {
  it('zważony: zgodna, kiedy, kto, brutto, paleta', () => {
    render(<KartaKartonu karton={{ ...K, lastWeighing: W }} onZamknij={() => {}} />)
    const t = screen.getByTestId('wazenie-kartonu').textContent!
    expect(t).toContain('ZWAŻONY — WAGA ZGODNA')
    expect(t).toContain('30.09.2026 08:05')
    expect(t).toContain('Jan · RĘCZNIE')
    expect(t).toContain('EURO')
  })

  it('niezgodna — czerwony tytuł z różnicą', () => {
    render(<KartaKartonu karton={{ ...K, lastWeighing: { ...W, ok: false, diffKg: 12 } }} onZamknij={() => {}} />)
    expect(screen.getByTestId('wazenie-kartonu').textContent).toContain('WAGA NIEZGODNA')
  })

  it('w mroźni bez ważenia — „NIE WAŻONY — DO ZWAŻENIA"', () => {
    render(<KartaKartonu karton={{ ...K, lastWeighing: null }} onZamknij={() => {}} />)
    expect(screen.getByTestId('wazenie-kartonu').textContent).toContain('NIE WAŻONY — DO ZWAŻENIA')
  })

  it('nie zasłania nagłówka panelu', () => {
    render(<KartaKartonu karton={{ ...K, lastWeighing: null }} onZamknij={() => {}} />)
    const d = screen.getByRole('dialog', { name: 'Karta kartonu' })
    expect(d.className).toContain('top-[76px]')
    expect(d.className).not.toContain('inset-0')
  })
})
