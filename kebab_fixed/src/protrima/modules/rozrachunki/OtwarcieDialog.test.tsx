// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA } from './daneTestowe.fixture'
import { mapujKarte } from './model'

/** Saldo otwarcia — stan z arkusza na początek dnia startu (01.10.2026 w danych testowych). */
const api = vi.hoisted(() => ({ ustawOtwarcie: vi.fn(), dodajZalegle: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { OtwarcieDialog } from './OtwarcieDialog'

describe('Rozrachunki — saldo otwarcia', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onClose = vi.fn()
  const onZapisano = vi.fn()
  const bez = mapujKarte({ ...SUROWA_KARTA, otwarcia: { wz: null, fv: null } })
  const z = mapujKarte(SUROWA_KARTA)
  /** Rozliczenia już otwarte zerowym saldem FV — zapisuje się tylko to, co zmienione. */
  const otwartaFv = mapujKarte({ ...SUROWA_KARTA, otwarcia: { wz: null, fv: { kwota: 0, zalegle_od: null, uwagi: '' } } })
  const onOdswiez = vi.fn()
  /** `zakladka: null` — bez wskazania (okno wybiera samo). */
  const mount = (karta = bez, ksiega?: 'wz' | 'fv', zakladka: 'zalegle' | 'kwota' | null = 'kwota') => render(
    <AppCtx.Provider value={app}><OtwarcieDialog karta={karta} ksiega={ksiega} zakladka={zakladka ?? undefined} onClose={onClose} onZapisano={onZapisano} onOdswiez={onOdswiez} /></AppCtx.Provider>)
  const sekcja = (k: 'WZ' | 'Faktury') => screen.getByRole('group', { name: `Saldo otwarcia — ${k}` })
  const kwotaW = (k: 'WZ' | 'Faktury') => within(sekcja(k)).getByLabelText(`Kwota ${k}`) as HTMLInputElement
  const zapisz = () => screen.getByRole('button', { name: /Zapisz saldo otwarcia|Zapisuję/ }) as HTMLButtonElement

  afterEach(cleanup)
  beforeEach(() => {
    api.ustawOtwarcie.mockReset(); onClose.mockReset(); onZapisano.mockReset(); onOdswiez.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    api.ustawOtwarcie.mockResolvedValue({ ok: true })
    api.dodajZalegle.mockReset().mockResolvedValue({ dokumenty: [] })
  })

  it('tekst pomocy z datą startu; fokus na kwocie WZ; przy otwartych rozliczeniach bez zmian zapis nieaktywny', () => {
    mount(otwartaFv)
    expect(screen.getByText('Stan na początek dnia 01.10.2026. Dokumenty z tego dnia i późniejsze liczą się już w systemie.')).toBeTruthy()
    expect(document.activeElement).toBe(kwotaW('WZ'))
    expect(zapisz().disabled).toBe(true)
    expect(zapisz().getAttribute('data-tip')).toBe('Nic nie zmieniono')
    expect(screen.queryByText(/nie drukuje się/)).toBeNull()
  })

  it('klient bez salda otwarcia: puste pola można zapisać jako 0 — obie księgi idą do serwera', async () => {
    mount()
    expect(screen.getByText(/saldo nie drukuje się na WZ ani w papierach kursu/)).toBeTruthy()
    expect(zapisz().disabled).toBe(false)
    expect(zapisz().getAttribute('data-tip')).toBeNull()
    fireEvent.click(zapisz())
    await waitFor(() => expect(onZapisano).toHaveBeenCalled())
    expect(api.ustawOtwarcie).toHaveBeenCalledWith('c1', 'wz', { kwota: 0, zalegle_od: null, uwagi: '' })
    expect(api.ustawOtwarcie).toHaveBeenCalledWith('c1', 'fv', { kwota: 0, zalegle_od: null, uwagi: '' })
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Saldo otwarcia zapisane', detail: 'WZ: zero · FV: zero' }))
  })

  it('bez placeholderów w obu zakładkach (D9) — „puste = 0” w etykiecie kwoty', () => {
    mount()
    expect(document.querySelectorAll('[placeholder]').length).toBe(0)
    expect(within(sekcja('WZ')).getByText('Kwota (EUR) — puste = 0')).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'Zaległe dokumenty' }))
    expect(document.querySelectorAll('[placeholder]').length).toBe(0)
  })

  it('„klient winien” + 6 300 → do API z minusem; nietknięta księga FV nie idzie', async () => {
    mount(otwartaFv)
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

  describe('zakładka „Zaległe dokumenty” (D13)', () => {
    const tabela = () => screen.getByRole('table', { name: 'Zaległe dokumenty do zapisania' })
    const pole = (nazwa: string, wiersz: number) => within(tabela()).getByLabelText(`${nazwa}, wiersz ${wiersz}`) as HTMLInputElement
    const zapiszZal = () => screen.getByRole('button', { name: /Zapisz zaległy dokument|Zapisz \d+ dokument|Zapisuję/ }) as HTMLButtonElement

    it('domyślna dla klienta bez salda otwarcia; zakładki przełączają; fokus w numerze pierwszego wiersza', () => {
      mount(bez, undefined, null)
      expect(screen.getByRole('tab', { name: 'Zaległe dokumenty' }).getAttribute('aria-selected')).toBe('true')
      expect(document.activeElement).toBe(pole('Numer', 1))
      expect(zapiszZal().disabled).toBe(true)
      expect(zapiszZal().getAttribute('data-tip')).toBe('Wpisz co najmniej jeden dokument')
      fireEvent.click(screen.getByRole('tab', { name: 'Jedna kwota' }))
      expect(screen.getByRole('button', { name: 'Zapisz saldo otwarcia' })).toBeTruthy()
      cleanup()
      // Klient z samą kwotą zbiorczą — od „Jedna kwota”.
      mount(z, undefined, null)
      expect(screen.getByRole('tab', { name: 'Jedna kwota' }).getAttribute('aria-selected')).toBe('true')
    })

    it('wiersz po wierszu: termin z daty + termin klienta, Enter w kwocie dodaje następny wiersz, zapis woła dodajZalegle z dokładnymi danymi', async () => {
      mount(bez, undefined, 'zalegle')
      fireEvent.change(pole('Numer', 1), { target: { value: 'FV 101/2026' } })
      fireEvent.change(pole('Data wystawienia', 1), { target: { value: '2026-09-15' } })
      expect(pole('Termin', 1).value).toBe('2026-09-22')
      fireEvent.change(pole('Do zapłaty', 1), { target: { value: '1 250,50' } })
      fireEvent.keyDown(pole('Do zapłaty', 1), { key: 'Enter' })
      await waitFor(() => expect(document.activeElement).toBe(pole('Numer', 2)))
      // Nowy wiersz bierze księgę i datę z poprzedniego.
      expect(pole('Data wystawienia', 2).value).toBe('2026-09-15')
      fireEvent.change(pole('Księga', 2), { target: { value: 'wz' } })
      expect(pole('Termin', 2).value).toBe('2026-09-15')
      fireEvent.change(pole('Numer', 2), { target: { value: 'WZ 44/09' } })
      fireEvent.change(pole('Termin', 2), { target: { value: '2026-09-30' } })
      fireEvent.change(pole('Data wystawienia', 2), { target: { value: '2026-09-20' } })
      expect(pole('Termin', 2).value).toBe('2026-09-30')
      fireEvent.change(pole('Do zapłaty', 2), { target: { value: '300' } })
      fireEvent.change(pole('Uwagi', 2), { target: { value: 'z zeszytu' } })
      expect(screen.getByText(/Do zapisania:/).textContent).toContain('2 dokumenty')
      expect(zapiszZal().textContent).toBe('Zapisz 2 dokumenty')
      fireEvent.click(zapiszZal())
      await waitFor(() => expect(api.dodajZalegle).toHaveBeenCalledWith('c1', [
        { ksiega: 'fv', numer: 'FV 101/2026', data: '2026-09-15', termin: '2026-09-22', kwota: 1250.5, uwagi: '' },
        { ksiega: 'wz', numer: 'WZ 44/09', data: '2026-09-20', termin: '2026-09-30', kwota: 300, uwagi: 'z zeszytu' },
      ]))
      await waitFor(() => expect(onZapisano).toHaveBeenCalled())
      expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Zapisano 2 dokumenty sprzed startu',
        detail: 'WZ: 300,00 € · FV: 1 250,50 € — są na karcie, wpłatę można przypiąć do każdego' }))
    })

    it('walidacja przy polach: data od startu, numer zajęty na karcie i w paczce, kwota; zapis nieaktywny z podpowiedzią „Wiersz N”', () => {
      mount(z, undefined, 'zalegle')
      fireEvent.change(pole('Numer', 1), { target: { value: 'fv 512/2026' } })
      expect(within(tabela()).getByText('Numer fv 512/2026 jest już w księdze faktur')).toBeTruthy()
      fireEvent.change(pole('Numer', 1), { target: { value: 'FV 90/2026' } })
      fireEvent.change(pole('Data wystawienia', 1), { target: { value: '2026-10-01' } })
      expect(within(tabela()).getByText('Data musi być przed startem rozliczeń (01.10.2026)')).toBeTruthy()
      fireEvent.change(pole('Data wystawienia', 1), { target: { value: '2026-09-01' } })
      fireEvent.change(pole('Do zapłaty', 1), { target: { value: 'abc' } })
      expect(within(tabela()).getByText('Kwota większa od zera')).toBeTruthy()
      expect(zapiszZal().disabled).toBe(true)
      expect(zapiszZal().getAttribute('data-tip')).toBe('Wiersz 1: Kwota większa od zera')
      fireEvent.change(pole('Do zapłaty', 1), { target: { value: '100' } })
      fireEvent.keyDown(pole('Do zapłaty', 1), { key: 'Enter' })
      fireEvent.change(pole('Numer', 2), { target: { value: 'FV 90/2026' } })
      expect(within(tabela()).getByText('Numer FV 90/2026 jest już w księdze faktur')).toBeTruthy()
      // Usunięcie wiersza z błędem — zapis znów możliwy.
      fireEvent.click(within(tabela()).getByRole('button', { name: 'Usuń wiersz 2' }))
      expect(zapiszZal().disabled).toBe(false)
    })

    it('termin 0 dni przy gotówce: zamiast „+ 0 dni” podpis „termin = data (gotówka)”', () => {
      mount(bez, 'wz', 'zalegle')
      fireEvent.change(pole('Księga', 1), { target: { value: 'wz' } })
      fireEvent.change(pole('Data wystawienia', 1), { target: { value: '2026-09-15' } })
      expect(pole('Termin', 1).value).toBe('2026-09-15')
      expect(within(tabela()).getByText('termin = data (gotówka)')).toBeTruthy()
      expect(within(tabela()).queryByText('+ 0 dni')).toBeNull()
    })

    it('odmowa serwera — komunikat w oknie, wiersze zostają; Ctrl+Enter zapisuje', async () => {
      api.dodajZalegle.mockRejectedValueOnce(new Error('Wiersz 1: numer FV 7 jest już w księdze'))
      mount(bez, 'fv', 'zalegle')
      fireEvent.change(pole('Numer', 1), { target: { value: 'FV 7' } })
      fireEvent.change(pole('Data wystawienia', 1), { target: { value: '2026-09-01' } })
      fireEvent.change(pole('Do zapłaty', 1), { target: { value: '50' } })
      fireEvent.keyDown(pole('Numer', 1), { key: 'Enter', ctrlKey: true })
      expect(await screen.findByText(/Wiersz 1: numer FV 7 jest już w księdze/)).toBeTruthy()
      expect(pole('Numer', 1).value).toBe('FV 7')
      expect(onZapisano).not.toHaveBeenCalled()
    })

    it('klient z kwotą zbiorczą — ostrzeżenie przed podwójnym wpisaniem; już wpisane zaległe na liście', () => {
      const zZaleglym = mapujKarte({ ...SUROWA_KARTA, dokumenty: { ...SUROWA_KARTA.dokumenty, fv: [...SUROWA_KARTA.dokumenty.fv,
        { ...SUROWA_KARTA.dokumenty.fv[0], id: 'z1', numer: 'FV 70/2026', data: '2026-09-01', kwota: 800, zostalo: 800, zrodlo: 'otwarcie', otwarcie: false }] } })
      mount(zZaleglym, undefined, 'zalegle')
      expect(screen.getByText(/Klient ma już saldo otwarcia jedną kwotą \(WZ: −6 300,00 €\)/)).toBeTruthy()
      const lista = screen.getByRole('table', { name: 'Wpisane zaległe dokumenty' })
      expect(within(lista).getByText('FV 70/2026')).toBeTruthy()
    })
  })
})
