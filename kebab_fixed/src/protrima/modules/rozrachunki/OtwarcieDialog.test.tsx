// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA } from './daneTestowe'
import { mapujKarte } from './model'

/** Saldo otwarcia — stan z arkusza na początek dnia startu (01.10.2026 w danych testowych). */
const api = vi.hoisted(() => ({ ustawOtwarcie: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { OtwarcieDialog } from './OtwarcieDialog'

describe('Rozrachunki — saldo otwarcia', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onClose = vi.fn()
  const onZapisano = vi.fn()
  const bez = mapujKarte({ ...SUROWA_KARTA, otwarcia: { wz: null, fv: null } })
  const z = mapujKarte(SUROWA_KARTA)
  const onOdswiez = vi.fn()
  const mount = (karta = bez, ksiega?: 'wz' | 'fv') => render(
    <AppCtx.Provider value={app}><OtwarcieDialog karta={karta} ksiega={ksiega} onClose={onClose} onZapisano={onZapisano} onOdswiez={onOdswiez} /></AppCtx.Provider>)
  const sekcja = (k: 'WZ' | 'Faktury') => screen.getByRole('group', { name: `Saldo otwarcia — ${k}` })
  const kwotaW = (k: 'WZ' | 'Faktury') => within(sekcja(k)).getByLabelText(`Kwota ${k}`) as HTMLInputElement
  const zapisz = () => screen.getByRole('button', { name: /Zapisz saldo otwarcia|Zapisuję/ }) as HTMLButtonElement

  afterEach(cleanup)
  beforeEach(() => {
    api.ustawOtwarcie.mockReset(); onClose.mockReset(); onZapisano.mockReset(); onOdswiez.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    api.ustawOtwarcie.mockResolvedValue({ ok: true })
  })

  it('tekst pomocy z datą startu; fokus na kwocie WZ; bez zmian zapis nieaktywny', () => {
    mount()
    expect(screen.getByText('Stan na początek dnia 01.10.2026. Dokumenty z tego dnia i późniejsze liczą się już w systemie.')).toBeTruthy()
    expect(document.activeElement).toBe(kwotaW('WZ'))
    expect(zapisz().disabled).toBe(true)
    expect(zapisz().getAttribute('data-tip')).toBe('Nic nie zmieniono')
  })

  it('„klient winien” + 6 300 → do API z minusem; nietknięta księga FV nie idzie', async () => {
    mount()
    expect(within(sekcja('WZ')).getByRole('button', { name: 'klient winien' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.change(kwotaW('WZ'), { target: { value: '6 300' } })
    fireEvent.change(within(sekcja('WZ')).getByLabelText('Zaległe od WZ'), { target: { value: '2026-09-20' } })
    fireEvent.change(within(sekcja('WZ')).getByLabelText('Uwagi WZ'), { target: { value: 'z Excela' } })
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.ustawOtwarcie).toHaveBeenCalledWith('c1', 'wz', { kwota: -6300, zalegle_od: '2026-09-20', uwagi: 'z Excela' }))
    expect(api.ustawOtwarcie).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saldo otwarcia zapisane', detail: 'WZ: klient winien 6 300,00 €' }))
  })

  it('„nadpłata” + 350 → kwota dodatnia; okno otwarte z księgi FV ma fokus w FV', async () => {
    mount(bez, 'fv')
    expect(document.activeElement).toBe(kwotaW('Faktury'))
    fireEvent.click(within(sekcja('Faktury')).getByRole('button', { name: 'nadpłata' }))
    fireEvent.change(kwotaW('Faktury'), { target: { value: '350' } })
    fireEvent.keyDown(kwotaW('Faktury'), { key: 'Enter' })
    await waitFor(() => expect(api.ustawOtwarcie).toHaveBeenCalledWith('c1', 'fv', expect.objectContaining({ kwota: 350, zalegle_od: null })))
  })

  it('istniejące saldo otwarcia wypełnia pola', () => {
    mount(z)
    expect(kwotaW('WZ').value).toBe('6 300,00')
    expect(within(sekcja('WZ')).getByRole('button', { name: 'klient winien' }).getAttribute('aria-pressed')).toBe('true')
    expect((within(sekcja('WZ')).getByLabelText('Zaległe od WZ') as HTMLInputElement).value).toBe('2026-09-20')
    expect((within(sekcja('WZ')).getByLabelText('Uwagi WZ') as HTMLInputElement).value).toBe('z Excela')
    expect(kwotaW('Faktury').value).toBe('')
    expect(zapisz().disabled).toBe(true)
  })

  it('kwota ze znakiem albo nie liczba — komunikat przy polu, zapis nieaktywny', () => {
    mount()
    fireEvent.change(kwotaW('WZ'), { target: { value: '-5' } })
    expect(within(sekcja('WZ')).getByText('Wpisz kwotę bez znaku — kierunek wybierz wyżej')).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
    fireEvent.change(kwotaW('WZ'), { target: { value: 'abc' } })
    expect(zapisz().disabled).toBe(true)
  })

  it('zaległe od po dacie startu — komunikat przy polu', () => {
    mount()
    fireEvent.change(kwotaW('WZ'), { target: { value: '100' } })
    fireEvent.change(within(sekcja('WZ')).getByLabelText('Zaległe od WZ'), { target: { value: '2026-10-05' } })
    expect(within(sekcja('WZ')).getByText(/nie może być po dacie startu/)).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
  })

  it('WZ zapisane, FV odrzucone — komunikat mówi, co się zapisało, karta odświeżona, ponowny zapis wysyła tylko FV', async () => {
    api.ustawOtwarcie.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('Kontrahent zablokowany'))
    mount()
    fireEvent.change(kwotaW('WZ'), { target: { value: '6 300' } })
    fireEvent.click(within(sekcja('Faktury')).getByRole('button', { name: 'nadpłata' }))
    fireEvent.change(kwotaW('Faktury'), { target: { value: '350' } })
    fireEvent.click(zapisz())
    expect(await screen.findByText(/Saldo otwarcia FV nie zapisano — Kontrahent zablokowany\. Saldo otwarcia WZ jest już zapisane\./)).toBeTruthy()
    expect(onOdswiez).toHaveBeenCalledTimes(1)
    expect(onZapisano).not.toHaveBeenCalled()
    api.ustawOtwarcie.mockClear().mockResolvedValue({ ok: true })
    fireEvent.click(zapisz())
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(api.ustawOtwarcie).toHaveBeenCalledTimes(1)
    expect(api.ustawOtwarcie).toHaveBeenCalledWith('c1', 'fv', expect.objectContaining({ kwota: 350 }))
  })

  it('odmowa serwera — komunikat w oknie, pola zostają', async () => {
    api.ustawOtwarcie.mockRejectedValue(new Error('Kontrahent nie znaleziony'))
    mount()
    fireEvent.change(kwotaW('WZ'), { target: { value: '6 300' } })
    fireEvent.click(zapisz())
    expect(await screen.findByText(/Kontrahent nie znaleziony/)).toBeTruthy()
    expect(kwotaW('WZ').value).toBe('6 300')
    expect(onZapisano).not.toHaveBeenCalled()
  })
})
