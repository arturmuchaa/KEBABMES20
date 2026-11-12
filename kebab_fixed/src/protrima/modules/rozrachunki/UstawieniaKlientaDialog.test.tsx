// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA } from './daneTestowe.fixture'
import { mapujKarte } from './model'

/** Ustawienia kontrahenta: waluta, domyślne terminy i formy płatności WZ / FV. */
const api = vi.hoisted(() => ({ ustawKlienta: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { UstawieniaKlientaDialog } from './UstawieniaKlientaDialog'

describe('Rozrachunki — ustawienia klienta', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onZapisano = vi.fn()
  const mount = (karta = mapujKarte(SUROWA_KARTA)) => render(
    <AppCtx.Provider value={app}><UstawieniaKlientaDialog karta={karta} onClose={vi.fn()} onZapisano={onZapisano} /></AppCtx.Provider>)
  const zapisz = () => screen.getByRole('button', { name: /Zapisz ustawienia|Zapisuję/ }) as HTMLButtonElement

  afterEach(cleanup)
  beforeEach(() => {
    api.ustawKlienta.mockReset().mockResolvedValue({ ok: true }); onZapisano.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
  })

  it('wysyła tylko zmienione pola', async () => {
    mount()
    expect(document.activeElement).toBe(within(screen.getByRole('group', { name: 'Waluta' })).getByRole('button', { name: 'EUR' }))
    expect(zapisz().disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Termin FV (dni)'), { target: { value: '14' } })
    fireEvent.click(within(screen.getByRole('group', { name: 'Forma WZ' })).getByRole('button', { name: 'Przelew' }))
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.ustawKlienta).toHaveBeenCalledWith('c1', { termin_fv: 14, forma_wz: 'przelew' }))
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Ustawienia RONDO GRILL zapisane' }))
  })

  it('zmiana waluty przy istniejących dokumentach — ostrzeżenie; podpowiedź z NIP', () => {
    mount(mapujKarte({ ...SUROWA_KARTA, klient: { ...SUROWA_KARTA.klient, waluta_podpowiedz: 'PLN' } }))
    expect(screen.getByText(/NIP wskazuje na PLN/)).toBeTruthy()
    expect(screen.queryByText(/przestaną się liczyć do salda/)).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: 'Waluta' })).getByRole('button', { name: 'PLN' }))
    expect(screen.getByText(/Dokumenty w dotychczasowej walucie przestaną się liczyć do salda/)).toBeTruthy()
  })

  it('termin spoza 0–365 — komunikat przy polu, zapis nieaktywny', () => {
    mount()
    fireEvent.change(screen.getByLabelText('Termin WZ (dni)'), { target: { value: '400' } })
    expect(screen.getByText('Termin to liczba dni od 0 do 365')).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
  })

  it('„Prowadź rozrachunki” odznaczone — opis skutków, zapis wysyła wylaczony: true; wyłączony klient — przywrócenie', async () => {
    mount()
    const przel = screen.getByLabelText('Prowadź rozrachunki z tym kontrahentem') as HTMLInputElement
    expect(przel.checked).toBe(true)
    fireEvent.click(przel)
    expect(screen.getByText(/zniknie z listy i sum, saldo nie będzie drukowane na WZ/)).toBeTruthy()
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.ustawKlienta).toHaveBeenCalledWith('c1', { wylaczony: true }))
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ detail: 'wyłączony z rozrachunków — zniknął z listy' }))
    cleanup()
    api.ustawKlienta.mockClear()
    mount(mapujKarte({ ...SUROWA_KARTA, klient: { ...SUROWA_KARTA.klient, wylaczony: true } }))
    const p2 = screen.getByLabelText('Prowadź rozrachunki z tym kontrahentem') as HTMLInputElement
    expect(p2.checked).toBe(false)
    fireEvent.click(p2)
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.ustawKlienta).toHaveBeenCalledWith('c1', { wylaczony: false }))
  })
})
