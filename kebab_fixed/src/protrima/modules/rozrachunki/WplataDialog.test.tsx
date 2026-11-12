// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA_PELNA, SUROWY_PODGLAD } from './daneTestowe.fixture'
import { mapujKarte } from './model'

/** Okno wpłaty — karta RONDO GRILL (EUR, FV przelew 7 dni, WZ gotówka), dziś 09.11.2026. */
const api = vi.hoisted(() => ({ podgladWplaty: vi.fn(), dodajWplate: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { WplataDialog } from './WplataDialog'

describe('Rozrachunki — okno wpłaty', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onClose = vi.fn()
  const onZapisano = vi.fn()
  const karta = mapujKarte(SUROWA_KARTA_PELNA)
  const mount = (extra: { ksiega?: 'wz' | 'fv'; dokumentId?: string } = {}) => render(
    <AppCtx.Provider value={app}><WplataDialog karta={karta} onClose={onClose} onZapisano={onZapisano} {...extra} /></AppCtx.Provider>)
  const pole = () => screen.getByLabelText('Kwota') as HTMLInputElement
  const zapisz = () => screen.getByRole('button', { name: /Zapisz wpłatę|Zapisuję/ }) as HTMLButtonElement
  const wcisniety = (grupa: string) => within(screen.getByRole('group', { name: grupa })).getAllByRole('button')
    .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => b.textContent)
  const wpisz = (v: string) => fireEvent.change(pole(), { target: { value: v } })

  afterEach(() => { cleanup(); vi.useRealTimers() })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T10:00:00'))
    Object.values(api).forEach(f => f.mockReset()); onClose.mockReset(); onZapisano.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    api.podgladWplaty.mockResolvedValue(SUROWY_PODGLAD)
    api.dodajWplate.mockResolvedValue({ ...SUROWY_PODGLAD, id: 'p9' })
  })

  it('kwota po polsku → podgląd po chwili, zapis z domyślnymi; toast mówi, co rozliczyła', async () => {
    mount()
    expect(document.activeElement).toBe(pole())
    expect(wcisniety('Do czego')).toEqual(['Faktury'])
    expect(wcisniety('Forma')).toEqual(['Przelew'])
    expect((screen.getByLabelText('Data wpłaty') as HTMLInputElement).value).toBe('2026-11-09')
    wpisz('15')
    wpisz('15 000,50')
    // Debounce: nic od razu, potem jedno zapytanie z ostatnią wartością.
    expect(api.podgladWplaty).not.toHaveBeenCalled()
    await waitFor(() => expect(api.podgladWplaty).toHaveBeenCalledWith('c1', { ksiega: 'fv', kwota: 15000.5, dokument_id: null }))
    expect(api.podgladWplaty).toHaveBeenCalledTimes(1)
    const podglad = await screen.findByRole('list', { name: 'Podgląd rozliczenia' })
    expect(within(podglad).getByText('zapłacona')).toBeTruthy()
    expect(within(podglad).getByText(/zostaje 4 622,20 €/)).toBeTruthy()
    expect(within(podglad).getByText('FV 528/2026')).toBeTruthy()
    expect(podglad.textContent).toContain('7 280,00 € z 7 280,00 €')
    fireEvent.click(zapisz())
    await waitFor(() => expect(api.dodajWplate).toHaveBeenCalledWith('c1',
      { ksiega: 'fv', forma: 'przelew', kwota: 15000.5, data: '2026-11-09', dokument_id: null, uwagi: '' }))
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'ok', title: 'Wpłata 15 000,50 € zapisana — rozliczyła FV 528/2026 i część FV 541/2026' }))
  })

  it('nadwyżka — zielony wiersz „zostaje jako saldo na plus”', async () => {
    api.podgladWplaty.mockResolvedValue({ przydzialy: [SUROWY_PODGLAD.przydzialy[0]], nadwyzka: 720 })
    mount()
    wpisz('8000')
    const wiersz = await screen.findByText(/\+720,00 € zostaje jako saldo na plus/)
    expect(wiersz.closest('li')?.className).toMatch(/rr-nadwyzka/)
  })

  it.each(['0', '', '-5', 'abc'])('kwota „%s” — zapis nieaktywny, Enter też nic nie wysyła', async (v) => {
    mount()
    wpisz('100'); wpisz(v)
    expect(zapisz().disabled).toBe(true)
    expect(zapisz().getAttribute('data-tip')).toBe('Wpisz kwotę większą od zera')
    fireEvent.click(zapisz())
    fireEvent.keyDown(pole(), { key: 'Enter' })
    if (v) expect(screen.getByText('Wpisz kwotę większą od zera', { selector: '.rr-pole-blad' })).toBeTruthy()
    await new Promise(r => setTimeout(r, 300))
    expect(api.dodajWplate).not.toHaveBeenCalled()
    expect(api.podgladWplaty).not.toHaveBeenCalled()
  })

  it('forma idzie za księgą, dopóki biuro jej samo nie wybierze', async () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'WZ' }))
    expect(wcisniety('Forma')).toEqual(['Gotówka'])
    fireEvent.click(screen.getByRole('button', { name: 'Faktury' }))
    expect(wcisniety('Forma')).toEqual(['Przelew'])
    fireEvent.click(screen.getByRole('button', { name: 'WZ' }))
    fireEvent.click(screen.getByRole('button', { name: 'Przelew' }))
    fireEvent.click(screen.getByRole('button', { name: 'Faktury' }))
    fireEvent.click(screen.getByRole('button', { name: 'WZ' }))
    expect(wcisniety('Forma')).toEqual(['Przelew'])
    wpisz('4000')
    await waitFor(() => expect(api.podgladWplaty).toHaveBeenCalledWith('c1', { ksiega: 'wz', kwota: 4000, dokument_id: null }))
  })

  it('dokument: otwarte dokumenty wybranej księgi od najstarszych; wskazany z karty idzie do podglądu', async () => {
    mount({ ksiega: 'fv', dokumentId: 'f541' })
    const wybor = screen.getByLabelText('Dokument') as HTMLSelectElement
    expect(wybor.value).toBe('f541')
    expect([...wybor.options].map(o => o.textContent)).toEqual([
      'Od najstarszych', 'FV 528/2026 · 27.10.2026 · zostało 7 280,00 €',
      'FV 541/2026 · 03.11.2026 · zostało 12 342,20 €', 'FV 553/2026 · 08.11.2026 · zostało 10 416,00 €'])
    wpisz('500')
    await waitFor(() => expect(api.podgladWplaty).toHaveBeenCalledWith('c1', { ksiega: 'fv', kwota: 500, dokument_id: 'f541' }))
    // Zmiana księgi — dokument z innej księgi odpada.
    fireEvent.click(screen.getByRole('button', { name: 'WZ' }))
    expect((screen.getByLabelText('Dokument') as HTMLSelectElement).value).toBe('')
    expect([...(screen.getByLabelText('Dokument') as HTMLSelectElement).options].map(o => o.value)).toEqual(['', 'w21', 'w02'])
  })

  it('błąd podglądu dla starej kwoty nie wisi po zmianie kwoty — „Liczę…”, potem nowy podgląd', async () => {
    api.podgladWplaty.mockRejectedValueOnce(new Error('Kontrahent nie znaleziony'))
    mount()
    wpisz('100')
    expect(await screen.findByText(/Podgląd niedostępny: Kontrahent nie znaleziony/)).toBeTruthy()
    wpisz('15 000')
    expect(screen.queryByText(/Podgląd niedostępny/)).toBeNull()
    expect(screen.getByText('Liczę rozliczenie…')).toBeTruthy()
    expect(await screen.findByRole('list', { name: 'Podgląd rozliczenia' })).toBeTruthy()
  })

  it('miejsce na podgląd zarezerwowane od początku — pola nie skaczą, gdy pojawi się wynik', () => {
    mount()
    expect(document.querySelector('.rr-podglad-w')).toBeTruthy()
    expect(document.querySelector('.dialog-wrap.rr-dlg-gora, .rr-dlg-gora')).toBeTruthy()
  })

  it('Enter w kwocie zapisuje', async () => {
    mount()
    wpisz('250')
    fireEvent.keyDown(pole(), { key: 'Enter' })
    await waitFor(() => expect(api.dodajWplate).toHaveBeenCalledWith('c1', expect.objectContaining({ kwota: 250 })))
  })

  it('dwa szybkie kliknięcia przy zapisie w toku → jedna wpłata', async () => {
    api.dodajWplate.mockReturnValue(new Promise(() => {}))
    mount()
    wpisz('1000')
    fireEvent.click(zapisz())
    fireEvent.click(zapisz())
    fireEvent.keyDown(pole(), { key: 'Enter' })
    await waitFor(() => expect(zapisz().textContent).toBe('Zapisuję…'))
    expect(api.dodajWplate).toHaveBeenCalledTimes(1)
  })

  it('odmowa serwera — komunikat w oknie, pola zostają, okno otwarte', async () => {
    api.dodajWplate.mockRejectedValue(new Error('Wpłata sprzed daty startu rozliczeń (01.10.2026) jest już w saldzie otwarcia'))
    mount()
    wpisz('1 234,56')
    fireEvent.change(screen.getByLabelText('Uwagi'), { target: { value: 'zapłacił kierowcy' } })
    fireEvent.click(zapisz())
    expect(await screen.findByText(/jest już w saldzie otwarcia/)).toBeTruthy()
    expect(pole().value).toBe('1 234,56')
    expect((screen.getByLabelText('Uwagi') as HTMLInputElement).value).toBe('zapłacił kierowcy')
    expect(onZapisano).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    expect(zapisz().disabled).toBe(false)
  })

  it('data przed startem rozliczeń — komunikat przy polu, zapis nieaktywny', () => {
    mount()
    wpisz('100')
    fireEvent.change(screen.getByLabelText('Data wpłaty'), { target: { value: '2026-09-30' } })
    expect(screen.getByText(/przed startem rozliczeń \(01\.10\.2026\)/)).toBeTruthy()
    expect(zapisz().disabled).toBe(true)
  })

  it('pola wpłaty bez placeholderów (D9); zaległy dokument sprzed startu do wskazania na liście dokumentów', () => {
    mount({ ksiega: 'fv' })
    expect(document.querySelectorAll('[placeholder]').length).toBe(0)
  })
})
