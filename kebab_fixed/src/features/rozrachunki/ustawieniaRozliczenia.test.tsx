// @vitest-environment jsdom
/**
 * Włączanie rozliczenia kontrahentowi i wybór waluty.
 *
 * Luka złapana w przeglądzie 24.09.2026: moduł nie dawał się włączyć nikomu
 * inaczej niż SQL-em w bazie, a ekran radził „włącz w kartotece kontrahenta"
 * — takiego pola w kartotece nie było.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ klienci: [] as any[] }))
const wolania = vi.hoisted(() => ({ ustawienia: [] as any[] }))

vi.mock('@/lib/api', () => ({
  clientsApi: {
    list: () => Promise.resolve(JSON.parse(JSON.stringify(stan.klienci))),
    ustawRozliczenie: (id: string, enabled: boolean, currency: string, basis?: string) => {
      wolania.ustawienia.push({ id, enabled, currency, basis })
      return Promise.resolve({})
    },
  },
}))

import { UstawieniaRozliczenia } from './UstawieniaRozliczenia'

beforeEach(() => {
  stan.klienci = [
    { id: 'c1', name: 'TRUVA gastro s.r.o.', displayName: 'TRUVA' },
    { id: 'c2', name: 'YBM Gastro GmbH', displayName: 'YALCIN' },
  ]
  wolania.ustawienia = []
})
afterEach(cleanup)

describe('włączanie rozliczenia', () => {
  it('włącza kontrahenta z wybraną walutą', async () => {
    render(<UstawieniaRozliczenia onZmiana={() => {}} />)
    fireEvent.change(await screen.findByTestId('wybor-klienta'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wybor-waluty'), { target: { value: 'EUR' } })
    fireEvent.click(screen.getByTestId('wlacz-rozliczenie'))

    await waitFor(() => expect(wolania.ustawienia).toHaveLength(1))
    expect(wolania.ustawienia[0]).toMatchObject({ id: 'c1', enabled: true, currency: 'EUR' })
  })

  it('wysyła podstawę rozliczenia, gdy biuro ją wybierze', async () => {
    render(<UstawieniaRozliczenia onZmiana={() => {}} />)
    fireEvent.change(await screen.findByTestId('wybor-klienta'), { target: { value: 'c1' } })
    fireEvent.change(screen.getByTestId('wybor-podstawy'), { target: { value: 'wz' } })
    fireEvent.click(screen.getByTestId('wlacz-rozliczenie'))

    await waitFor(() => expect(wolania.ustawienia).toHaveLength(1))
    expect(wolania.ustawienia[0].basis).toBe('wz')
  })

  it('bez wybranego kontrahenta nic nie wysyła', async () => {
    render(<UstawieniaRozliczenia onZmiana={() => {}} />)
    await screen.findByTestId('wybor-klienta')
    fireEvent.click(screen.getByTestId('wlacz-rozliczenie'))

    await waitFor(() => expect(wolania.ustawienia).toHaveLength(0))
  })
})
