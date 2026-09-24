// @vitest-environment jsdom
/**
 * Panel śladu skanowania — „czy gdzieś sztuka nie zginęła".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'

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

// ─── Okno śladu: skład palety i łańcuch etapów (24.09.2026) ─────────────
describe('okno śladu palety', () => {
  const PALETA = {
    pallet_no: 1, status: 'shipped',
    sklad: [
      { qty: 10, kg_per_unit: 40, rodzaj: 'KEBAB UDO 100%', receptura: 'BULLI' },
      { qty: 15, kg_per_unit: 25, rodzaj: 'KEBAB UDO 100%', receptura: 'BULLI' },
    ],
    sztuki: { zadeklarowane: 25, sledzone: 0 },
    zdarzenia: [
      { action: 'loaded', scanned_at: '2026-09-23T10:14:00Z', operator: 'VLAD M.', vehicle: 'MAN 1234' },
    ],
  }

  it('pokazuje SKŁAD palety, a nie samo „P1 na auto"', async () => {
    stan.slad = [PALETA]
    render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText('10 szt')).toBeTruthy()
    expect(screen.getByText('× 40 kg')).toBeTruthy()
    expect(screen.getByText('15 szt')).toBeTruthy()
  })

  it('mówi WPROST, że etapu nikt nie skanuje — to odpowiedź przy reklamacji', async () => {
    stan.slad = [PALETA]
    const { container } = render(<SladSkanowania orderId="o1" />)
    await screen.findByText('Produkcja')
    const produkcja = container.querySelector('[data-etap="produkcja"]')!
    expect(produkcja.getAttribute('data-stan')).toBe('brak_zrodla')
    expect(produkcja.textContent).toMatch(/nie skanowane na tym etapie/i)
  })

  it('ostrzega, że pojedynczej sztuki nie da się dziś wskazać', async () => {
    stan.slad = [PALETA]
    render(<SladSkanowania orderId="o1" />)
    expect(await screen.findByText(/pojedynczej sztuki nie da się dziś wskazać/i)).toBeTruthy()
  })

  it('nie ostrzega, gdy wszystkie sztuki mają numery', async () => {
    stan.slad = [{ ...PALETA, sztuki: { zadeklarowane: 25, sledzone: 25 } }]
    render(<SladSkanowania orderId="o1" />)
    await screen.findByText('Produkcja')
    expect(screen.queryByText(/pojedynczej sztuki nie da się/i)).toBeNull()
  })

  it('przełącza się między paletami zamówienia', async () => {
    stan.slad = [
      PALETA,
      { ...PALETA, pallet_no: 2, sklad: [
        { qty: 7, kg_per_unit: 30, rodzaj: 'KEBAB MIX', receptura: 'YAPRAK' }] },
    ]
    render(<SladSkanowania orderId="o1" />)
    fireEvent.click(await screen.findByText('Paleta P2'))
    expect(await screen.findByText('7 szt')).toBeTruthy()
  })

  it('łańcuch ma zawsze pięć etapów, także dla nietkniętej palety', async () => {
    stan.slad = [{ ...PALETA, zdarzenia: [] }]
    const { container } = render(<SladSkanowania orderId="o1" />)
    await screen.findByText('Produkcja')
    expect(container.querySelectorAll('[data-etap]')).toHaveLength(5)
  })
})
