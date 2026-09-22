// @vitest-environment jsdom
/**
 * Panel śladu skanowania — „czy gdzieś sztuka nie zginęła".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

const stan = vi.hoisted(() => ({ slad: [] as any[], padnij: false }))
vi.mock('@/lib/api', () => ({
  palletScanApi: {
    slad: () => (stan.padnij ? Promise.reject(new Error('x')) : Promise.resolve(stan.slad)),
  },
}))

import { SladSkanowania } from './SladSkanowania'

beforeEach(() => { stan.slad = []; stan.padnij = false })
afterEach(cleanup)

describe('ślad skanowania', () => {
  it('pokazuje etapy PO POLSKU, nie kodami z bazy', async () => {
    stan.slad = [{ pallet_no: 1, status: 'shipped', zdarzenia: [
      { action: 'cold_storage', scanned_at: '2026-09-20T09:14:00Z', operator: 'VLAD M.', vehicle: '' },
      { action: 'loaded', scanned_at: '2026-09-20T11:02:00Z', operator: 'VLAD M.', vehicle: 'SOLÓWKA KR 1' },
    ] }]
    render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText('Mroźnia')).toBeTruthy()
    expect(screen.getByText('Na auto')).toBeTruthy()
    expect(screen.getByText('SOLÓWKA KR 1')).toBeTruthy()
    expect(screen.queryByText('cold_storage')).toBeNull()
  })

  it('paleta bez skanów jest WIDOCZNA i opisana wprost', async () => {
    stan.slad = [{ pallet_no: 4, status: 'created', zdarzenia: [] }]
    render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText('Paleta P4')).toBeTruthy()
    expect(screen.getByText(/nikt jej nie skanował/i)).toBeTruthy()
  })

  it('cofnięcie jest wyróżnione — to ślad pomyłki', async () => {
    stan.slad = [{ pallet_no: 2, status: 'loaded', zdarzenia: [
      { action: 'undo', scanned_at: '2026-09-20T11:07:00Z', operator: 'VLAD M.', vehicle: '' },
    ] }]
    const { container } = render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText('Cofnięto')).toBeTruthy()
    expect(container.querySelector('[data-akcja="undo"]')).toBeTruthy()
  })

  it('zamówienie bez palet mówi to wprost, zamiast pustki', async () => {
    render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText(/nie ma palet/i)).toBeTruthy()
  })

  it('błąd sieci nie zostawia ekranu na "Wczytuję…"', async () => {
    stan.padnij = true
    render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText(/Nie udało się wczytać/i)).toBeTruthy()
  })
})
