// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, act } from '@testing-library/react'

const stan = vi.hoisted(() => ({ padnij: false, wzId: '' }))
vi.mock('@/lib/api', () => ({
  rozliczeniaApi: {
    naWz: (wzId: string) => {
      stan.wzId = wzId
      return stan.padnij
        ? Promise.reject(Object.assign(new Error('Brak zestawienia'), { status: 404 }))
        : Promise.resolve({
          klient: { nazwa: 'ROJPAK', nip: '', adres: '' }, waluta: 'EUR',
          na_dzien: '2026-11-09', policzono: '2026-11-09T10:00:00',
          wz: { pozycje: [{ numer: 'WZ 02/11', data: '2026-11-03', termin: '2026-11-03',
                            kwota: 5289.5, zaplacono: 0, pozostalo: 5289.5,
                            dni_po_terminie: 6, ten_dokument: true }], razem: 5289.5 },
          fv: { pozycje: [], razem: 0 },
          razem: 5289.5, po_terminie: 5289.5, nadplata_wz: 0, nadplata_fv: 0,
        })
    },
  },
}))

import { BlokSaldaWz } from './BlokSaldaWz'

beforeEach(() => { stan.padnij = false; stan.wzId = '' })
afterEach(cleanup)

describe('BlokSaldaWz', () => {
  it('pyta o zestawienie tej WZ i rysuje tabelkę salda', async () => {
    render(<BlokSaldaWz wzId="w3" />)
    expect(await screen.findByTestId('blok-salda')).toBeTruthy()
    expect(stan.wzId).toBe('w3')
    expect(screen.getByText('WZ 02/11')).toBeTruthy()
    // Pod WZ jest już „Razem do zapłaty” samego dokumentu — suma salda ma inną nazwę.
    const blok = screen.getByTestId('blok-salda').textContent ?? ''
    expect(blok).toContain('Łącznie do zapłaty (wszystkie niezapłacone dokumenty): 5 289,50 €')
    expect(blok).not.toContain('Razem do zapłaty')
  })

  it('brak zestawienia (404) — nic nie rysuje, WZ drukuje się normalnie', async () => {
    stan.padnij = true
    const { container } = render(<BlokSaldaWz wzId="wm1" />)
    await waitFor(() => expect(stan.wzId).toBe('wm1'))
    // Odrzucenie obietnicy musi się rozstrzygnąć, zanim sprawdzimy pustkę.
    await act(async () => { await Promise.resolve() })
    expect(container.querySelector('[data-testid="blok-salda"]')).toBeNull()
  })
})
