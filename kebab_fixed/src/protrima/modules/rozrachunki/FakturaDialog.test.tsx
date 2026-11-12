// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA_PELNA } from './daneTestowe.fixture'
import { mapujKarte } from './model'

/** Okno faktury — karta RONDO GRILL (EUR, termin FV 7 dni, przelew), dziś 09.11.2026. */
const api = vi.hoisted(() => ({ dodajFakture: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { FakturaDialog } from './FakturaDialog'

describe('Rozrachunki — okno faktury', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onClose = vi.fn()
  const onZapisano = vi.fn()
  const karta = mapujKarte(SUROWA_KARTA_PELNA)
  const mount = () => render(<AppCtx.Provider value={app}><FakturaDialog karta={karta} onClose={onClose} onZapisano={onZapisano} /></AppCtx.Provider>)
  const pole = (l: string) => screen.getByLabelText(l) as HTMLInputElement
  const zmien = (l: string, v: string) => fireEvent.change(pole(l), { target: { value: v } })
  const zapisz = () => screen.getByRole('button', { name: /Dodaj fakturę|Dodaj korektę|Zapisuję/ }) as HTMLButtonElement

  afterEach(() => { cleanup(); vi.useRealTimers() })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T10:00:00'))
    api.dodajFakture.mockReset(); onClose.mockReset(); onZapisano.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    api.dodajFakture.mockResolvedValue({ id: 'f9' })
  })

  it('domyślne: dziś, termin = data + termin FV klienta, przelew; numer z fokusem', () => {
    mount()
    expect(document.activeElement).toBe(pole('Numer'))
    expect(pole('Data wystawienia').value).toBe('2026-11-09')
    expect(pole('Termin').value).toBe('2026-11-16')
    expect(screen.getByRole('button', { name: 'Przelew' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('ujemna = faktura korygująca')).toBeTruthy()
  })

  it('termin idzie za datą, dopóki nie zmieniony ręcznie', () => {
    mount()
    zmien('Data wystawienia', '2026-11-10')
    expect(pole('Termin').value).toBe('2026-11-17')
    zmien('Termin', '2026-11-30')
    zmien('Data wystawienia', '2026-11-12')
    expect(pole('Termin').value).toBe('2026-11-30')
  })

  it('kwota ujemna (korekta) przechodzi; toast nazywa korektę', async () => {
    mount()
    zmien('Numer', 'KOR 1/2026')
    zmien('Kwota brutto', '-500')
    expect(zapisz().disabled).toBe(false)
    expect(zapisz().textContent).toBe('Dodaj korektę')
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.dodajFakture).toHaveBeenCalledWith('c1',
      { numer: 'KOR 1/2026', data: '2026-11-09', kwota: -500, termin: '2026-11-16', forma: 'przelew', uwagi: '' }))
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Korekta KOR 1/2026 dodana — −500,00 €' }))
  })

  it('zwykła faktura: Enter zapisuje, toast z kwotą i terminem', async () => {
    mount()
    zmien('Numer', 'FV 560/2026')
    zmien('Kwota brutto', '10 416,00')
    fireEvent.keyDown(pole('Kwota brutto'), { key: 'Enter' })
    await waitFor(() => expect(api.dodajFakture).toHaveBeenCalledWith('c1', expect.objectContaining({ numer: 'FV 560/2026', kwota: 10416 })))
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Faktura FV 560/2026 dodana — 10 416,00 €', detail: 'termin 16.11.2026 · przelew' }))
  })

  it.each([['', '100'], ['FV 1/2026', '0'], ['FV 1/2026', 'abc'], ['FV 1/2026', '']])('numer „%s”, kwota „%s” — zapis nieaktywny', (numer, kw) => {
    mount()
    zmien('Numer', numer)
    zmien('Kwota brutto', kw)
    expect(zapisz().disabled).toBe(true)
    fireEvent.click(zapisz())
    expect(api.dodajFakture).not.toHaveBeenCalled()
  })

  it('numer już na karcie — komunikat przy polu, bez wysyłania', () => {
    mount()
    zmien('Numer', 'fv 528/2026')
    zmien('Kwota brutto', '100')
    expect(screen.getByText('Faktura FV 528/2026 jest już na karcie tego klienta')).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
  })

  it('dwa szybkie kliknięcia przy zapisie w toku → jedna faktura', async () => {
    api.dodajFakture.mockReturnValue(new Promise(() => {}))
    mount()
    zmien('Numer', 'FV 560/2026')
    zmien('Kwota brutto', '100')
    fireEvent.click(zapisz())
    fireEvent.click(zapisz())
    await waitFor(() => expect(zapisz().textContent).toBe('Zapisuję…'))
    expect(api.dodajFakture).toHaveBeenCalledTimes(1)
  })

  it('odmowa serwera — komunikat w oknie, pola zostają', async () => {
    api.dodajFakture.mockRejectedValue(new Error('Faktura 528/2026 jest już wpisana temu kontrahentowi'))
    mount()
    zmien('Numer', '528/2026')
    zmien('Kwota brutto', '14 280')
    fireEvent.click(zapisz())
    expect(await screen.findByText(/Faktura 528\/2026 jest już wpisana temu kontrahentowi/)).toBeTruthy()
    expect(pole('Numer').value).toBe('528/2026')
    expect(pole('Kwota brutto').value).toBe('14 280')
    expect(onZapisano).not.toHaveBeenCalled()
  })

  it('termin przed datą — komunikat, zapis nieaktywny', () => {
    mount()
    zmien('Numer', 'FV 560/2026')
    zmien('Kwota brutto', '100')
    zmien('Termin', '2026-11-01')
    expect(screen.getByText(/Termin nie może być przed datą wystawienia/)).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
  })

  it('kilogramy (opcjonalnie) idą do API jako liczba i do toastu; złe kg — komunikat przy polu; bez placeholderów', async () => {
    mount()
    expect(document.querySelectorAll('[placeholder]').length).toBe(0)
    zmien('Numer', 'FV 561/2026')
    zmien('Kwota brutto', '2 000')
    zmien('Kilogramy', '-3')
    expect(screen.getByText('Wpisz liczbę kilogramów (0 lub więcej)')).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
    zmien('Kilogramy', '1 250,5')
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.dodajFakture).toHaveBeenCalledWith('c1',
      { numer: 'FV 561/2026', data: '2026-11-09', kwota: 2000, termin: '2026-11-16', forma: 'przelew', uwagi: '', kg: 1250.5 }))
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ detail: 'termin 16.11.2026 · przelew · 1 250,5 kg' }))
  })
})
