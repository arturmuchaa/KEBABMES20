// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi, type Cmd } from '../../shell/context'
import { SUROWA_KARTA, SUROWA_LISTA } from './daneTestowe'

/** Rozrachunki — lista kontrahentów. Dane w kształcie odpowiedzi `GET /api/rozliczenia`. */
const api = vi.hoisted(() => ({ lista: vi.fn(), ustawStart: vi.fn(), przypiszWz: vi.fn(), karta: vi.fn() }))
const klienci = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api, clientsApi: klienci }))
import { RozrachunkiModule } from './RozrachunkiModule'

const KLIENCI = [
  { id: 'c1', name: 'ROJPAK', displayName: '', nip: 'HU25341187', active: true },
  { id: 'c2', name: 'NAZAR SP. Z O.O.', displayName: 'NAZAR', nip: '7471234567', active: true },
]

describe('Rozrachunki — lista kontrahentów', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const setCmds = vi.fn()
  const mount = () => render(<AppCtx.Provider value={app}><RozrachunkiModule active setCtx={vi.fn()} setCmds={setCmds} /></AppCtx.Provider>)
  const nazwyWierszy = () => screen.getAllByRole('row').map(r => r.getAttribute('data-nazwa')).filter(Boolean)
  const wiersz = (nazwa: string) => screen.getAllByRole('row').find(r => r.getAttribute('data-nazwa') === nazwa) as HTMLElement
  afterEach(cleanup)
  beforeEach(() => {
    Object.values(api).forEach(f => f.mockReset()); klienci.list.mockReset(); setCmds.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    try { window.localStorage.clear() } catch { /* bez pamięci */ }
    api.lista.mockResolvedValue(SUROWA_LISTA)
    api.przypiszWz.mockResolvedValue({ ok: true })
    api.ustawStart.mockResolvedValue({ start: '2026-10-01' })
    api.karta.mockResolvedValue(SUROWA_KARTA)
    klienci.list.mockResolvedValue(KLIENCI)
  })

  it('wiersz: nazwa, saldo z minusem typograficznym na czerwono, pigułka zaległości, dzwonek przypomnienia', async () => {
    mount()
    await screen.findByText('ROJPAK')
    const r = wiersz('ROJPAK')
    const saldo = within(r).getByText(/−38 447,70/)
    expect(saldo.closest('td')?.className).toMatch(/crit-ink/)
    expect(within(r).getByText('13 dni po terminie').className).toMatch(/tag crit/)
    expect(within(r).getByLabelText('Przypomnienie na dziś')).toBeTruthy()
    const boss = within(wiersz('BOSS KEBAB')).getAllByText('+350,00 zł')
    expect(boss[0].closest('td')?.className).toMatch(/ok-ink/)
    // Kafelki sum: osobno PLN i EUR
    expect(screen.getByText('Należności EUR')).toBeTruthy()
    expect(screen.getByText('Należności PLN')).toBeTruthy()
    expect(screen.getByText('Gotówka z WZ do odebrania')).toBeTruthy()
    expect(screen.getByText('Nadpłaty klientów')).toBeTruthy()
  })

  it('klik nagłówka „Saldo łącznie” sortuje od największego dłużnika, drugi klik odwraca; wybór zapamiętany', async () => {
    mount()
    await screen.findByText('ROJPAK')
    expect(nazwyWierszy()).toEqual(['ROJPAK', 'TRUVA GASTRO', 'BOSS KEBAB', 'POLAT'])
    fireEvent.click(screen.getByRole('button', { name: /Saldo łącznie/ }))
    expect(nazwyWierszy()).toEqual(['ROJPAK', 'TRUVA GASTRO', 'POLAT', 'BOSS KEBAB'])
    expect(screen.getByRole('columnheader', { name: /Saldo łącznie/ }).getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(screen.getByRole('button', { name: /Saldo łącznie/ }))
    expect(nazwyWierszy()).toEqual(['BOSS KEBAB', 'POLAT', 'TRUVA GASTRO', 'ROJPAK'])
    expect(JSON.parse(window.localStorage.getItem('protrima.rozrachunki.sort') ?? 'null')).toEqual({ kol: 'saldo', kier: 'desc' })
    cleanup()
    mount()
    await screen.findByText('ROJPAK')
    expect(nazwyWierszy()).toEqual(['BOSS KEBAB', 'POLAT', 'TRUVA GASTRO', 'ROJPAK'])
  })

  it('filtr „Nadpłaty” zostawia tylko BOSS KEBAB; szukanie „roj” zostawia jeden wiersz, Enter otwiera jego kartę', async () => {
    mount()
    await screen.findByText('ROJPAK')
    fireEvent.click(screen.getByRole('button', { name: /Nadpłaty/ }))
    expect(nazwyWierszy()).toEqual(['BOSS KEBAB'])
    fireEvent.click(screen.getByRole('button', { name: /Wszyscy/ }))
    fireEvent.change(screen.getByLabelText('Szukaj kontrahenta'), { target: { value: 'roj' } })
    expect(nazwyWierszy()).toEqual(['ROJPAK'])
    fireEvent.keyDown(screen.getByLabelText('Szukaj kontrahenta'), { key: 'Enter' }) // jedno trafienie → od razu karta
    expect(screen.getByRole('button', { name: '← Kontrahenci' })).toBeTruthy()
  })

  it('pusta lista → komunikat z podpowiedzią, co zrobić', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, kontrahenci: [], bez_kontrahenta: [], inna_waluta: 0,
      podsumowanie: { PLN: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0 } } })
    mount()
    expect(await screen.findByText('Nikt jeszcze nie ma rozliczeń — dodaj saldo otwarcia albo wystaw WZ')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    // Same zera — bez kafelków „0,00 zł” nad pustym widokiem.
    expect(screen.queryByRole('group', { name: 'Sumy rozrachunków' })).toBeNull()
  })

  it('sumy same zera (tylko rozliczeni) → bez kafelków sum, tabela zostaje', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, kontrahenci: [SUROWA_LISTA.kontrahenci[3]], bez_kontrahenta: [], inna_waluta: 0,
      podsumowanie: { PLN: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0 }, EUR: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0 } } })
    mount()
    await screen.findByText('POLAT')
    expect(screen.queryByRole('group', { name: 'Sumy rozrachunków' })).toBeNull()
    expect(screen.getByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
  })

  it('długa nazwa: tekst w osobnym elemencie z wielokropkiem i podpowiedzią, dzwonek poza ucinaną częścią', async () => {
    mount()
    await screen.findByText('ROJPAK')
    const r = wiersz('ROJPAK')
    const nazwa = within(r).getByText('ROJPAK')
    expect(nazwa.className).toMatch(/rr-nazwa/)
    expect(nazwa.getAttribute('title')).toBe('ROJPAK · NIP HU25341187')
    const dzwonek = within(r).getByLabelText('Przypomnienie na dziś')
    expect(nazwa.contains(dzwonek)).toBe(false)
    expect(dzwonek.closest('td')).toBe(nazwa.closest('td'))
  })

  it('błąd serwera → komunikat z „Spróbuj ponownie”, nie pusty ekran', async () => {
    api.lista.mockRejectedValueOnce(new Error('Brak połączenia z serwerem'))
    mount()
    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('ROJPAK')).toBeTruthy()
  })

  it('WZ bez kontrahenta (1): wybór kontrahenta i „Przypisz” woła przypiszWz, potem odświeża listę', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, bez_kontrahenta: [{ ...SUROWA_LISTA.bez_kontrahenta[0], nabywca: 'NAZAR GASTRO KFT' }] })
    mount()
    expect(await screen.findByText(/Dokumenty w innej walucie niż kontrahent \(2\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /WZ bez kontrahenta \(1\)/ }))
    const przypisz = await screen.findByRole('button', { name: 'Przypisz' }) as HTMLButtonElement
    expect(przypisz.disabled).toBe(true)
    const pole = await screen.findByRole('combobox', { name: 'Kontrahent dla WZ 07/11' })
    await waitFor(() => expect(klienci.list).toHaveBeenCalled())
    fireEvent.focus(pole)
    fireEvent.change(pole, { target: { value: 'naz' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    expect(przypisz.disabled).toBe(false)
    fireEvent.click(przypisz)
    await waitFor(() => expect(api.przypiszWz).toHaveBeenCalledWith('d1', 'c2'))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok' })))
    expect(api.lista).toHaveBeenCalledTimes(2)
  })

  it('nabywca z WZ zgodny z kontrahentem — wybór podpowiedziany od razu', async () => {
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /WZ bez kontrahenta \(1\)/ }))
    const pole = await screen.findByRole('combobox', { name: 'Kontrahent dla WZ 07/11' }) as HTMLInputElement
    await waitFor(() => expect(pole.value).toBe('NAZAR'))
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz' }))
    await waitFor(() => expect(api.przypiszWz).toHaveBeenCalledWith('d1', 'c2'))
  })

  it('klik w wiersz / Enter otwiera kartę w module; „← Kontrahenci” i Esc wracają do listy', async () => {
    mount()
    fireEvent.click(await screen.findByText('ROJPAK'))
    expect(screen.queryByRole('table', { name: 'Kontrahenci z saldami' })).toBeNull()
    await waitFor(() => expect(api.karta).toHaveBeenCalledWith('c1'))
    expect(await screen.findByRole('table', { name: 'Faktury' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← Kontrahenci' }))
    expect(await screen.findByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
    const r = wiersz('TRUVA GASTRO')
    fireEvent.keyDown(r, { key: 'Enter' })
    expect(screen.getByRole('button', { name: '← Kontrahenci' })).toBeTruthy()
    expect(screen.getAllByText('TRUVA GASTRO').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
  })

  it('strzałki przesuwają kursor po wierszach', async () => {
    mount()
    await screen.findByText('ROJPAK')
    wiersz('ROJPAK').focus()
    fireEvent.keyDown(wiersz('ROJPAK'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wiersz('TRUVA GASTRO'))
    fireEvent.keyDown(wiersz('TRUVA GASTRO'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(wiersz('ROJPAK'))
  })

  it('komenda „Data startu rozliczeń” — dialog z datą zapisuje ustawStart', async () => {
    mount()
    await screen.findByText('ROJPAK')
    const cmds = setCmds.mock.calls[setCmds.mock.calls.length - 1]?.[0] as Cmd[]
    expect(cmds.map(c => c.label)).toEqual(['Odśwież', 'Data startu rozliczeń'])
    act(() => { cmds.find(c => c.id === 'start')!.run!() })
    const dlg = await screen.findByRole('dialog')
    const pole = within(dlg).getByLabelText('Data startu') as HTMLInputElement
    expect(pole.value).toBe('2026-11-09')
    fireEvent.change(pole, { target: { value: '2026-10-01' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zapisz' }))
    await waitFor(() => expect(api.ustawStart).toHaveBeenCalledWith('2026-10-01'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ title: expect.stringContaining('01.10.2026') }))
  })
})
