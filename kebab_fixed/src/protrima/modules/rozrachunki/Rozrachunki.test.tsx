// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within, act } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi, type Cmd } from '../../shell/context'
import { SUROWA_KARTA, SUROWA_LISTA, SUROWY_PODGLAD } from './daneTestowe.fixture'

/** Rozrachunki — lista kontrahentów. Dane w kształcie odpowiedzi `GET /api/rozliczenia`. */
const api = vi.hoisted(() => ({ lista: vi.fn(), ustawStart: vi.fn(), przypiszWz: vi.fn(), karta: vi.fn(), podgladWplaty: vi.fn(), dodajWplate: vi.fn(),
  ustawWylaczenie: vi.fn() }))
const klienci = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api, clientsApi: klienci }))
import { RozrachunkiModule } from './RozrachunkiModule'

const KLIENCI = [
  { id: 'c1', name: 'RONDO GRILL', displayName: '', nip: 'HU99000001', active: true },
  { id: 'c2', name: 'NABYWCA TESTOWY SP. Z O.O.', displayName: 'NABYWCA TESTOWY', nip: '7471234567', active: true },
  { id: 'c7', name: 'KLIENT PRYWATNY TEST', displayName: '', nip: '', active: true },
  { id: 'c8', name: 'NOWY ODBIORCA TEST', displayName: '', nip: '5250000008', active: true },
]
/** Klient z długiem w terminie (−26 280 zł) — bez czerwieni (D5). */
const W_TERMINIE = { id: 'c9', nazwa: 'W TERMINIE TEST', nip: '', waluta: 'PLN', saldo_wz: 0, saldo_fv: -26280, saldo: -26280, po_terminie: 0,
  najstarsza_dni: 0, najblizszy_termin_dni: 9, stan: 'w_terminie', przypomnienie: false, inna_waluta: 0, obrot: 26280, kg: 1800, fv_bez_kwoty: 0 }
const ostatnieKomendy = (setCmds: ReturnType<typeof vi.fn>) => setCmds.mock.calls[setCmds.mock.calls.length - 1]?.[0] as Cmd[]

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
    api.ustawWylaczenie.mockResolvedValue({ ok: true })
    api.karta.mockResolvedValue(SUROWA_KARTA)
    api.podgladWplaty.mockResolvedValue(SUROWY_PODGLAD)
    api.dodajWplate.mockResolvedValue({ ...SUROWY_PODGLAD, id: 'p9' })
    klienci.list.mockResolvedValue(KLIENCI)
  })

  it('wiersz: nazwa, saldo z minusem typograficznym bez czerwieni, czerwień tylko w „Po terminie”, pigułka, dzwonek', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    const r = wiersz('RONDO GRILL')
    const saldo = within(r).getByText('−38 447,70 €')
    expect(saldo.closest('td')?.className).not.toMatch(/crit-ink/)
    expect(within(r).getByText('15 689,50 €').closest('td')?.className).toMatch(/crit-ink/)
    expect(within(r).getByText('13 dni po terminie').className).toMatch(/tag crit/)
    expect(within(r).getByLabelText('Przypomnienie na dziś')).toBeTruthy()
    const boss = within(wiersz('BAR PRZYKŁADOWY')).getAllByText('+350,00 zł')
    expect(boss[0].closest('td')?.className).toMatch(/ok-ink/)
  })

  it('saldo w terminie (−26 280 zł) nie ma klasy czerwieni w żadnej komórce, po terminie ma', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, kontrahenci: [...SUROWA_LISTA.kontrahenci, W_TERMINIE] })
    mount()
    await screen.findByText('W TERMINIE TEST')
    const r = wiersz('W TERMINIE TEST')
    expect(within(r).getAllByText('−26 280,00 zł').length).toBe(2)
    expect(r.querySelectorAll('.crit-ink, .crit').length).toBe(0)
    expect(wiersz('TESTOWA GASTRONOMIA').querySelectorAll('td.crit-ink').length).toBe(1)
  })

  it('kafelki KPI: Należności łącznie, Po terminie (czerwono), Obrót i Sprzedane kg za okres; gotówka i nadpłaty w podpisie', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    const sumy = screen.getByRole('group', { name: 'Sumy rozrachunków' })
    const kafel = (k: string) => within(sumy).getByText(k, { selector: '.k' }).closest('.rr-sum') as HTMLElement
    const kwoty = (k: string) => [...kafel(k).querySelectorAll('.v .rr-kw')].map(x => x.textContent)
    expect(kwoty('Należności łącznie')).toEqual(['17 700,00 zł', '38 447,70 €'])
    expect(kafel('Należności łącznie').querySelector('.crit-ink')).toBeNull()
    expect(kwoty('Po terminie')).toEqual(['15 300,00 zł', '15 689,50 €'])
    expect(kafel('Po terminie').querySelector('.v')?.className).toMatch(/crit-ink/)
    expect(kwoty('Obrót')).toEqual(['21 000,00 zł', '45 200,40 €'])
    expect(within(kafel('Sprzedane kg')).getByText('6 680,5 kg')).toBeTruthy()
    // Okres przy kafelkach okresowych
    expect(within(kafel('Obrót')).getByText(/Ten miesiąc/)).toBeTruthy()
    const pod = within(sumy).getByText('Gotówka z WZ do odebrania').closest('.rr-sumy-pod') as HTMLElement
    expect(within(pod).getByText('2 400,00 zł · 8 409,50 €')).toBeTruthy()
    expect(within(pod).getByText('+350,00 zł')).toBeTruthy()
  })

  it('tabela: kolumny Obrót i kg za okres, znacznik „FV bez kwoty (N)”', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    expect(screen.getByRole('columnheader', { name: /Obrót/ })).toBeTruthy()
    expect(screen.getByRole('columnheader', { name: /^kg/ })).toBeTruthy()
    const r = wiersz('RONDO GRILL')
    expect(within(r).getByText('45 200,40 €')).toBeTruthy()
    expect(within(r).getByText('5 230 kg')).toBeTruthy()
    const fv = within(r).getByText('FV bez kwoty (2)')
    expect(fv.className).toMatch(/tag warn/)
    expect(fv.closest('.rr-nazwa')).toBeNull() // poza ucinaną nazwą
    expect(within(wiersz('TESTOWA GASTRONOMIA')).queryByText(/FV bez kwoty/)).toBeNull()
  })

  it('zmiana okresu woła lista(od, do) z datami okresu; wybór zapamiętany', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 10, 12, 10, 0))
    try {
      mount()
      await screen.findByText('RONDO GRILL')
      expect(api.lista).toHaveBeenLastCalledWith('2026-11-01', '2026-11-30')
      const okres = screen.getByRole('group', { name: 'Okres obrotu i kg' })
      fireEvent.click(within(okres).getByRole('button', { name: 'Poprzedni miesiąc' }))
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31'))
      // Opis z dat wybranych przez użytkownika (serwer dla okresu sprzed startu odda okres obcięty).
      expect(screen.getAllByText(/01\.10–31\.10\.2026/).length).toBeGreaterThan(0)
      fireEvent.click(within(okres).getByRole('button', { name: 'Ten rok' }))
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('2026-01-01', '2026-12-31'))
      fireEvent.click(within(okres).getByRole('button', { name: 'Od początku' }))
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('', ''))
      fireEvent.click(within(okres).getByRole('button', { name: 'Od–do' }))
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('2026-11-01', '2026-11-12'))
      const ile = api.lista.mock.calls.length
      fireEvent.change(screen.getByLabelText('Okres od'), { target: { value: '2026-11-20' } })
      expect(screen.getByRole('alert').textContent).toMatch(/wcześniejsza/)
      expect(api.lista.mock.calls.length).toBe(ile) // zły zakres — bez zapytania
      fireEvent.change(screen.getByLabelText('Okres od'), { target: { value: '2026-11-05' } })
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('2026-11-05', '2026-11-12'))
      expect(JSON.parse(window.localStorage.getItem('protrima.rozrachunki.okres') ?? 'null'))
        .toEqual({ okres: 'zakres', od: '2026-11-05', do: '2026-11-12' })
      cleanup()
      mount()
      await screen.findByText('RONDO GRILL')
      expect(api.lista).toHaveBeenLastCalledWith('2026-11-05', '2026-11-12')
    } finally { vi.useRealTimers() }
  })

  it('chip „Wyłączeni (1)” pokazuje wyłączonych; „Przywróć do rozrachunków” woła API, toast i odświeża listę', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    expect(screen.queryByText('KLIENT PRYWATNY TEST')).toBeNull()
    const chip = screen.getByRole('button', { name: /Wyłączeni/ })
    expect(chip.textContent).toBe('Wyłączeni1')
    fireEvent.click(chip)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    expect(screen.queryByRole('table', { name: 'Kontrahenci z saldami' })).toBeNull()
    const tab = screen.getByRole('table', { name: 'Wyłączeni z rozrachunków' })
    expect(within(tab).getByText('KLIENT PRYWATNY TEST')).toBeTruthy()
    const ile = api.lista.mock.calls.length
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, wylaczeni: [] })
    fireEvent.click(within(tab).getByRole('button', { name: 'Przywróć do rozrachunków' }))
    await waitFor(() => expect(api.ustawWylaczenie).toHaveBeenCalledWith('c7', false))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: expect.stringContaining('KLIENT PRYWATNY TEST') })))
    await waitFor(() => expect(api.lista.mock.calls.length).toBe(ile + 1))
    // Nikogo już nie ma wśród wyłączonych — wraca zwykła lista.
    expect(await screen.findByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
  })

  it('przywracanie odrzucone przez serwer — komunikat przy wierszu, bez toastu', async () => {
    api.ustawWylaczenie.mockRejectedValueOnce(new Error('Brak uprawnień'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: /Wyłączeni/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Przywróć do rozrachunków' }))
    expect(await screen.findByText(/Brak uprawnień/)).toBeTruthy()
    expect(app.toast).not.toHaveBeenCalled()
  })

  it('„+ Kontrahent”: wybór z kartoteki (bez widocznych i wyłączonych) otwiera kartę klienta z fokusem na saldzie otwarcia', async () => {
    api.karta.mockResolvedValue({ ...SUROWA_KARTA, klient: { ...SUROWA_KARTA.klient, id: 'c8', nazwa: 'NOWY ODBIORCA TEST' }, rozliczenia_otwarte: false,
      otwarcia: { wz: null, fv: null }, dokumenty: { wz: [], fv: [] }, wplaty: [], czeka_na_ceny: [], inna_waluta: [], dziennik: [] })
    mount()
    await screen.findByText('RONDO GRILL')
    const cmds = ostatnieKomendy(setCmds)
    act(() => { cmds.find(c => c.id === 'dodaj')!.run!() })
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('heading').textContent).toContain('Dodaj kontrahenta')
    const otworzK = within(dlg).getByRole('button', { name: 'Otwórz kartę' }) as HTMLButtonElement
    expect(otworzK.disabled).toBe(true)
    const pole = await within(dlg).findByRole('combobox', { name: 'Kontrahent z kartoteki' })
    await waitFor(() => expect(klienci.list).toHaveBeenCalled())
    expect(await within(dlg).findByText('Szukaj po nazwie albo NIP.')).toBeTruthy()
    fireEvent.focus(pole)
    fireEvent.change(pole, { target: { value: 'test' } })
    const opcje = within(document.body).getAllByRole('option').map(o => o.textContent)
    expect(opcje.some(o => o?.includes('NOWY ODBIORCA TEST'))).toBe(true)
    expect(opcje.some(o => o?.includes('KLIENT PRYWATNY TEST'))).toBe(false)
    fireEvent.change(pole, { target: { value: 'nowy' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    expect(otworzK.disabled).toBe(false)
    fireEvent.click(otworzK)
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(api.karta.mock.calls[api.karta.mock.calls.length - 1]?.[0]).toBe('c8'))
    expect(screen.getByRole('button', { name: '← Kontrahenci' })).toBeTruthy()
    // Fokus w karcie (nie z powrotem na komendzie „Kontrahent”) — na „Wprowadź saldo otwarcia”.
    const start = await screen.findByRole('button', { name: 'Wprowadź saldo otwarcia' })
    await waitFor(() => expect(document.activeElement).toBe(start))
  })

  it('karta dostaje ten sam okres obrotu i kg co lista (jeden wybór okresu)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00'))
    try {
      mount()
      await screen.findByText('RONDO GRILL')
      fireEvent.click(screen.getByRole('button', { name: 'Poprzedni miesiąc' }))
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('2026-10-01', '2026-10-31'))
      fireEvent.click(screen.getByText('RONDO GRILL'))
      await waitFor(() => expect(api.karta).toHaveBeenLastCalledWith('c1', '', '', '2026-10-01', '2026-10-31'))
      const przel = await screen.findByRole('group', { name: 'Okres obrotu i kg' })
      expect(within(przel).getByRole('button', { name: 'Poprzedni miesiąc' }).getAttribute('aria-pressed')).toBe('true')
      // Zmiana na karcie wraca na listę.
      fireEvent.click(within(przel).getByRole('button', { name: 'Ten rok' }))
      await waitFor(() => expect(api.karta).toHaveBeenLastCalledWith('c1', '', '', '2026-01-01', '2026-12-31'))
      fireEvent.click(screen.getByRole('button', { name: '← Kontrahenci' }))
      await waitFor(() => expect(api.lista).toHaveBeenLastCalledWith('2026-01-01', '2026-12-31'))
    } finally { vi.useRealTimers() }
  })

  it('bez komendy „Data startu rozliczeń”; data startu tylko w podtytule; pola listy bez placeholderów', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    const cmds = ostatnieKomendy(setCmds)
    expect(cmds.map(c => c.label)).toEqual(['Odśwież', 'Kontrahent'])
    expect(cmds.some(c => /Data startu/.test(c.label))).toBe(false)
    expect(screen.getByText(/salda odbiorców od 09\.11\.2026/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /WZ bez kontrahenta \(1\)/ }))
    await screen.findByRole('combobox', { name: 'Kontrahent dla WZ 07/11' })
    expect(document.querySelectorAll('[placeholder]').length).toBe(0)
    expect(api.ustawStart).not.toHaveBeenCalled()
  })

  it('klient z samymi pozycjami w innej walucie: pigułka „sprawdź walutę” (ostrzeżenie), wiersz nie wyszarzony', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, kontrahenci: [...SUROWA_LISTA.kontrahenci,
      { id: 'c6', nazwa: 'ZAGRANICZNY TEST', nip: 'DE999', waluta: 'PLN', saldo_wz: 0, saldo_fv: 0, saldo: 0, po_terminie: 0, najstarsza_dni: 0,
        najblizszy_termin_dni: null, stan: 'sprawdz_walute', przypomnienie: false, inna_waluta: 2 }] })
    mount()
    await screen.findByText('ZAGRANICZNY TEST')
    const r = wiersz('ZAGRANICZNY TEST')
    const pig = within(r).getByText('sprawdź walutę')
    expect(pig.className).toMatch(/tag warn/)
    expect(pig.getAttribute('data-tip')).toMatch(/2 pozycje w innej walucie/)
    expect(r.className).not.toMatch(/closed/)
    expect(wiersz('PUNKT WZOROWY').className).toMatch(/closed/)
  })

  it('klik nagłówka „Saldo łącznie” sortuje od największego dłużnika, drugi klik odwraca; wybór zapamiętany', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    expect(nazwyWierszy()).toEqual(['RONDO GRILL', 'TESTOWA GASTRONOMIA', 'BAR PRZYKŁADOWY', 'PUNKT WZOROWY'])
    fireEvent.click(screen.getByRole('button', { name: /Saldo łącznie/ }))
    expect(nazwyWierszy()).toEqual(['RONDO GRILL', 'TESTOWA GASTRONOMIA', 'PUNKT WZOROWY', 'BAR PRZYKŁADOWY'])
    expect(screen.getByRole('columnheader', { name: /Saldo łącznie/ }).getAttribute('aria-sort')).toBe('ascending')
    fireEvent.click(screen.getByRole('button', { name: /Saldo łącznie/ }))
    expect(nazwyWierszy()).toEqual(['BAR PRZYKŁADOWY', 'PUNKT WZOROWY', 'TESTOWA GASTRONOMIA', 'RONDO GRILL'])
    expect(JSON.parse(window.localStorage.getItem('protrima.rozrachunki.sort') ?? 'null')).toEqual({ kol: 'saldo', kier: 'desc' })
    cleanup()
    mount()
    await screen.findByText('RONDO GRILL')
    expect(nazwyWierszy()).toEqual(['BAR PRZYKŁADOWY', 'PUNKT WZOROWY', 'TESTOWA GASTRONOMIA', 'RONDO GRILL'])
  })

  it('filtr „Nadpłaty” zostawia tylko BAR PRZYKŁADOWY; szukanie „rondo” zostawia jeden wiersz, Enter otwiera jego kartę', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    fireEvent.click(screen.getByRole('button', { name: /Nadpłaty/ }))
    expect(nazwyWierszy()).toEqual(['BAR PRZYKŁADOWY'])
    fireEvent.click(screen.getByRole('button', { name: /Wszyscy/ }))
    fireEvent.change(screen.getByLabelText('Szukaj kontrahenta'), { target: { value: 'rondo' } })
    expect(nazwyWierszy()).toEqual(['RONDO GRILL'])
    fireEvent.keyDown(screen.getByLabelText('Szukaj kontrahenta'), { key: 'Enter' }) // jedno trafienie → od razu karta
    expect(screen.getByRole('button', { name: '← Kontrahenci' })).toBeTruthy()
  })

  it('pusta lista → komunikat z podpowiedzią, co zrobić', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, kontrahenci: [], bez_kontrahenta: [], inna_waluta: 0,
      wylaczeni: [], podsumowanie: { PLN: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0 } } })
    mount()
    expect(await screen.findByText('Nikt jeszcze nie ma rozliczeń — dodaj saldo otwarcia albo wystaw WZ')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    // Same zera — bez kafelków „0,00 zł” nad pustym widokiem.
    expect(screen.queryByRole('group', { name: 'Sumy rozrachunków' })).toBeNull()
  })

  it('sumy same zera (tylko rozliczeni) → bez kafelków sum, tabela zostaje', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, kontrahenci: [SUROWA_LISTA.kontrahenci[3]], bez_kontrahenta: [], inna_waluta: 0,
      podsumowanie: { PLN: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0, obrot: 0, kg: 0 }, EUR: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0, obrot: 0, kg: 0 } } })
    mount()
    await screen.findByText('PUNKT WZOROWY')
    expect(screen.queryByRole('group', { name: 'Sumy rozrachunków' })).toBeNull()
    expect(screen.getByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
  })

  it('długa nazwa: tekst w osobnym elemencie z wielokropkiem i podpowiedzią, dzwonek poza ucinaną częścią', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    const r = wiersz('RONDO GRILL')
    const nazwa = within(r).getByText('RONDO GRILL')
    expect(nazwa.className).toMatch(/rr-nazwa/)
    expect(nazwa.getAttribute('title')).toBe('RONDO GRILL · NIP HU99000001')
    const dzwonek = within(r).getByLabelText('Przypomnienie na dziś')
    expect(nazwa.contains(dzwonek)).toBe(false)
    expect(dzwonek.closest('td')).toBe(nazwa.closest('td'))
  })

  it('błąd serwera → komunikat z „Spróbuj ponownie”, nie pusty ekran', async () => {
    api.lista.mockRejectedValueOnce(new Error('Brak połączenia z serwerem'))
    mount()
    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await screen.findByText('RONDO GRILL')).toBeTruthy()
  })

  it('WZ bez kontrahenta (1): wybór kontrahenta i „Przypisz” woła przypiszWz, potem odświeża listę', async () => {
    api.lista.mockResolvedValue({ ...SUROWA_LISTA, bez_kontrahenta: [{ ...SUROWA_LISTA.bez_kontrahenta[0], nabywca: 'NABYWCA TESTOWY GASTRO KFT' }] })
    mount()
    expect(await screen.findByText(/Dokumenty w innej walucie niż kontrahent \(2\)/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /WZ bez kontrahenta \(1\)/ }))
    const przypisz = await screen.findByRole('button', { name: 'Przypisz' }) as HTMLButtonElement
    expect(przypisz.disabled).toBe(true)
    const pole = await screen.findByRole('combobox', { name: 'Kontrahent dla WZ 07/11' })
    await waitFor(() => expect(klienci.list).toHaveBeenCalled())
    fireEvent.focus(pole)
    fireEvent.change(pole, { target: { value: 'naby' } })
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
    await waitFor(() => expect(pole.value).toBe('NABYWCA TESTOWY'))
    fireEvent.click(screen.getByRole('button', { name: 'Przypisz' }))
    await waitFor(() => expect(api.przypiszWz).toHaveBeenCalledWith('d1', 'c2'))
  })

  it('klik w wiersz / Enter otwiera kartę w module; „← Kontrahenci” i Esc wracają do listy', async () => {
    mount()
    fireEvent.click(await screen.findByText('RONDO GRILL'))
    expect(screen.queryByRole('table', { name: 'Kontrahenci z saldami' })).toBeNull()
    await waitFor(() => expect(api.karta.mock.calls[0]?.[0]).toBe('c1'))
    expect(await screen.findByRole('table', { name: 'Faktury' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '← Kontrahenci' }))
    expect(await screen.findByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
    const r = wiersz('TESTOWA GASTRONOMIA')
    fireEvent.keyDown(r, { key: 'Enter' })
    expect(screen.getByRole('button', { name: '← Kontrahenci' })).toBeTruthy()
    expect(screen.getAllByText('TESTOWA GASTRONOMIA').length).toBeGreaterThan(0)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(await screen.findByRole('table', { name: 'Kontrahenci z saldami' })).toBeTruthy()
  })

  it('strzałki przesuwają kursor po wierszach', async () => {
    mount()
    await screen.findByText('RONDO GRILL')
    wiersz('RONDO GRILL').focus()
    fireEvent.keyDown(wiersz('RONDO GRILL'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wiersz('TESTOWA GASTRONOMIA'))
    fireEvent.keyDown(wiersz('TESTOWA GASTRONOMIA'), { key: 'ArrowUp' })
    expect(document.activeElement).toBe(wiersz('RONDO GRILL'))
  })

  it('„+ Wpłata” na karcie otwiera okno; po zapisie karta i lista się odświeżają, fokus wraca na przycisk', async () => {
    mount()
    fireEvent.click(await screen.findByText('RONDO GRILL'))
    await screen.findByRole('table', { name: 'Faktury' })
    const przycisk = screen.getByRole('button', { name: '+ Wpłata' })
    przycisk.focus()
    fireEvent.click(przycisk)
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByRole('heading').textContent).toContain('Wpłata')
    const kartyPrzed = api.karta.mock.calls.length, listyPrzed = api.lista.mock.calls.length
    fireEvent.change(within(dlg).getByLabelText('Kwota'), { target: { value: '100' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zapisz wpłatę' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(api.dodajWplate).toHaveBeenCalledWith('c1', expect.objectContaining({ kwota: 100 }))
    await waitFor(() => expect(api.karta.mock.calls.length).toBe(kartyPrzed + 1))
    await waitFor(() => expect(api.lista.mock.calls.length).toBe(listyPrzed + 1))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '+ Wpłata' }))
    // Esc zamyka okno, nie kartę.
    fireEvent.click(screen.getByRole('button', { name: 'Saldo otwarcia' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByRole('button', { name: '← Kontrahenci' })).toBeTruthy()
  })
})
