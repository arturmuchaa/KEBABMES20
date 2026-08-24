// @vitest-environment jsdom
/**
 * Ekran logowania kiosku — co pokazać, gdy nie ma z czego wybierać.
 *
 * POWÓD ISTNIENIA: stara wersja (rozbior-v10.tsx) ponawiała zapytanie w kółko
 * ZARÓWNO przy błędzie sieci, JAK I przy pustej liście. Dla rozbioru to
 * przechodziło, bo ludzie tam są od dawna. Nowe stanowisko produkcyjne startuje
 * z pustym działem — kiosk kręciłby „Łączenie z serwerem…" bez końca i nikt by
 * się nie dowiedział, że wystarczy przypisać pracowników w biurze.
 *
 * Dwa przypadki MUSZĄ się różnić:
 *   • sieć nie wstała  → ponawiaj (kiosk startuje przed backendem),
 *   • dział bez ludzi  → powiedz to wprost i daj przycisk „Sprawdź ponownie".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

vi.mock('@/features/auth/AuthContext', () => ({
  useAuth: () => ({ loginPin: vi.fn(), user: null, loading: false }),
}))
vi.mock('@/features/deboning/ServiceMenu', () => ({
  useServiceHold: () => ({ holdProps: {} }),
  ServiceMenuModal: () => null,
}))
vi.mock('@/lib/api', () => ({ BASE: '/api' }))

import { KioskLoginScreen } from './KioskFrame'

const ekran = () => (
  <KioskLoginScreen department="produkcja" label="Produkcja" channel="produkcja" version="1.0.0" />
)

describe('KioskLoginScreen — pusta lista operatorów', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

  it('mówi wprost, że dział nie ma przypisanych ludzi — zamiast kręcić kółkiem', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => [] })))

    render(ekran())

    expect(await screen.findByText(/Nikt nie jest przypisany do działu produkcja/i)).toBeTruthy()
    // Komunikat musi nazwać dział po nazwie technicznej — biuro szuka go w kartotece.
    expect(screen.getByText(/Pracownicy → dział/i)).toBeTruthy()
    expect(screen.queryByText(/Łączenie z serwerem/i)).toBeNull()
  })

  it('po dodaniu ludzi „Sprawdź ponownie" pokazuje ich bez restartu kiosku', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ json: async () => [] })
      .mockResolvedValueOnce({ json: async () => [{ id: 'w1', name: 'MARCIN NOWAK' }] })
    vi.stubGlobal('fetch', fetchMock)

    render(ekran())
    fireEvent.click(await screen.findByRole('button', { name: /Sprawdź ponownie/i }))

    expect(await screen.findByText('MARCIN NOWAK')).toBeTruthy()
  })

  it('błąd sieci ponawia w kółko — kiosk startuje ZANIM backend wstanie', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('brak sieci'))
      .mockResolvedValue({ json: async () => [{ id: 'w1', name: 'MARCIN NOWAK' }] })
    vi.stubGlobal('fetch', fetchMock)

    render(ekran())
    // Przy błędzie NIE wolno pokazać „dział bez ludzi" — to byłoby kłamstwo.
    expect(screen.queryByText(/Nikt nie jest przypisany/i)).toBeNull()

    await vi.advanceTimersByTimeAsync(2100)
    expect(await screen.findByText('MARCIN NOWAK')).toBeTruthy()
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('pyta serwer o operatorów TEGO działu', async () => {
    const fetchMock = vi.fn((_url: string) => Promise.resolve({ json: async () => [] }))
    vi.stubGlobal('fetch', fetchMock)

    render(ekran())
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0])).toContain('department=produkcja')
  })
})
