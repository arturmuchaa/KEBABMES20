// @vitest-environment jsdom
/**
 * Skan bez Entera ma działać — MES nie może zależeć od konfiguracji skanera.
 *
 * Zakład, 17.09.2026: DS2278 wpisywał w pole `http://tauri.localhost/m/p/<zam>/7`
 * i nic się nie działo — paleta zostawała `created`, bo bez sufiksu Enter
 * formularz się nie wysyłał. Konfiguracja skanera ginie przy wymianie sprzętu
 * albo resecie, więc ekran rozpoznaje kompletny kod sam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({ skany: [] as Array<{ code: string; action: string }> }))

vi.mock('@/lib/api', () => ({
  palletScanApi: {
    inColdStorage: () => Promise.resolve([]),
    scan: (code: string, action: string) => {
      stan.skany.push({ code, action })
      return Promise.resolve({ palletNo: 7, order: { clientName: 'YALCIN' } })
    },
  },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))

import { MobileMrozniaPage } from './MobileMrozniaPage'

const KOD = 'http://tauri.localhost/m/p/6890e863376444ceaa10/7'

beforeEach(() => { stan.skany = []; vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); cleanup() })

async function pokazIWpisz(kod: string) {
  render(<MemoryRouter><MobileMrozniaPage /></MemoryRouter>)
  const pole = screen.getByRole('textbox')
  fireEvent.change(pole, { target: { value: kod } })
  return pole
}

describe('auto-wysyłka skanu w Mroźni', () => {
  it('kompletny kod z QR wysyła się BEZ Entera', async () => {
    await pokazIWpisz(KOD)
    expect(stan.skany).toHaveLength(0)          // jeszcze nie — czeka chwilę

    await act(async () => { vi.advanceTimersByTime(300) })

    expect(stan.skany).toHaveLength(1)
    expect(stan.skany[0]).toEqual({ code: KOD, action: 'cold_storage' })
  })

  it('Enter tuż po auto-wysyłce NIE wysyła drugi raz', async () => {
    const pole = await pokazIWpisz(KOD)
    await act(async () => { vi.advanceTimersByTime(300) })
    expect(stan.skany).toHaveLength(1)

    // Skaner jednak dosłał Enter — formularz idzie, ale strażnik go zatrzymuje.
    await act(async () => { fireEvent.submit(pole.closest('form')!) })

    expect(stan.skany).toHaveLength(1)
  })

  it('NIEkompletny kod czeka na Enter, jak dotąd', async () => {
    const pole = await pokazIWpisz('PAL|6890e863')
    await act(async () => { vi.advanceTimersByTime(600) })
    expect(stan.skany).toHaveLength(0)

    await act(async () => { fireEvent.submit(pole.closest('form')!) })
    expect(stan.skany).toHaveLength(1)          // Enter dalej działa
  })

  it('kolejna paleta wysyła się od razu — blokada dotyczy tego SAMEGO kodu', async () => {
    const pole = await pokazIWpisz(KOD)
    await act(async () => { vi.advanceTimersByTime(300) })

    fireEvent.change(pole, { target: { value: KOD.replace(/\/7$/, '/8') } })
    await act(async () => { vi.advanceTimersByTime(300) })

    expect(stan.skany).toHaveLength(2)
  })
})
