// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA_PELNA, SUROWY_DOKUMENT } from './daneTestowe.fixture'

/** Karta klienta — dane RONDO GRILL w kształcie odpowiedzi `GET /api/rozliczenia/klienci/c1`. */
const api = vi.hoisted(() => ({
  karta: vi.fn(), ustawKlienta: vi.fn(), dokument: vi.fn(), edytujDokument: vi.fn(), usunDokument: vi.fn(),
  usunWplate: vi.fn(), dodajWpis: vi.fn(), odhaczWpis: vi.fn(), historiaZmian: vi.fn(),
  wpiszKwoteFv: vi.fn(), nieLicz: vi.fn(), usunWpis: vi.fn(), ustawWylaczenie: vi.fn(),
}))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { KartaKlienta } from './KartaKlienta'

/** Faktura korygująca w księdze FV — wiersz ujemny z tym, co zmniejszyła (najnowsza na górze). */
const KOREKTA = {
  id: 'k1', numer: 'FVK 3/2026', data: '2026-11-08', kwota: -426, zaplacono: 0, zostalo: 0, termin: '2026-11-15', forma: '', uwagi: 'reklamacja',
  zrodlo: 'reczna', otwarcie: false, stan: { kod: 'korekta', dni: 0, czesciowo: false }, zamkniety: null, brak_vat: false,
  korekta: true, rozliczyla: [{ numer: 'FV 528/2026', kwota: 426 }],
}
/** Zaległa faktura sprzed startu (01.10.2026) — `zrodlo: 'otwarcie'`, ale `otwarcie: false` (osobny dokument, nie kwota zbiorcza). */
const ZALEGLA = {
  id: 'z77', numer: 'FV 77/2026', data: '2026-09-12', kwota: 3200, zaplacono: 0, zostalo: 3200, termin: '2026-09-19', forma: 'przelew', uwagi: '',
  zrodlo: 'otwarcie', otwarcie: false, stan: { kod: 'po_terminie', dni: 54, czesciowo: false }, zamkniety: null, brak_vat: false,
}
/** WZ nieliczona (D2) i FV z papierów kursu bez kwoty (D4). */
const NIELICZONA = {
  id: 'w05', numer: 'WZ 05/11', data: '2026-11-05', kwota: 980, zaplacono: 0, zostalo: 0, termin: '2026-11-05', forma: 'gotowka', uwagi: '',
  zrodlo: 'mes_wz', otwarcie: false, stan: { kod: 'nie_licz', dni: 0, czesciowo: false }, zamkniety: null, brak_vat: false,
  kg: 85, nie_licz: true, nie_licz_powod: 'towar dla pracowników',
}
const BEZ_KWOTY = {
  id: 'fk1', numer: 'FV 590/2026', data: '2026-11-10', kwota: null, zaplacono: 0, zostalo: 0, termin: '2026-11-17', forma: 'przelew', uwagi: '',
  zrodlo: 'kurs', otwarcie: false, stan: { kod: 'czeka_na_kwote', dni: 0, czesciowo: false }, zamkniety: null, brak_vat: false, kg: 1250.5,
}
const Z_NOWYMI = { ...SUROWA_KARTA_PELNA, dokumenty: { wz: [NIELICZONA, ...SUROWA_KARTA_PELNA.dokumenty.wz], fv: [BEZ_KWOTY, ...SUROWA_KARTA_PELNA.dokumenty.fv] } }
const Z_KOREKTA = { ...SUROWA_KARTA_PELNA, dokumenty: { ...SUROWA_KARTA_PELNA.dokumenty, fv: [KOREKTA, ...SUROWA_KARTA_PELNA.dokumenty.fv] } }

/** Odpowiedź `GET /api/rozliczenia/klient/c1/historia-zmian` — najnowsze pierwsze. */
const HISTORIA = {
  wpisy: [
    { id: 'h3', kiedy: '2026-11-10T14:05:00+00:00', kto: 'Szef', obiekt: 'wplata', akcja: 'usunieto', czego: 'Wpłata 300,00 € z 05.11.2026',
      opis: 'usunięto wpłatę 300,00 PLN', powod: 'wpisana dwa razy', usuniete: true },
    { id: 'h2', kiedy: '2026-11-09T10:00:00+00:00', kto: 'Anna', obiekt: 'otwarcie', akcja: 'zmiana', czego: 'Saldo otwarcia WZ',
      opis: 'saldo otwarcia WZ: kwota 0,00 → −6 300,00', powod: '', usuniete: false },
  ],
  wiecej: false,
}

describe('Rozrachunki — karta klienta', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onOtworz = vi.fn()
  const onWroc = vi.fn()
  const mount = () => render(<AppCtx.Provider value={app}><KartaKlienta clientId="c1" onWroc={onWroc} onOtworz={onOtworz} /></AppCtx.Provider>)
  const ksiega = (nazwa: 'Księga WZ' | 'Faktury') => screen.getByRole('table', { name: nazwa })
  const numery = (t: HTMLElement) => within(t).queryAllByRole('row').map(r => r.getAttribute('data-numer')).filter(Boolean)
  const wiersz = (t: HTMLElement, numer: string) => within(t).getAllByRole('row').find(r => r.getAttribute('data-numer') === numer) as HTMLElement
  const kafelki = () => screen.getByRole('group', { name: 'Salda klienta' })
  const gotowe = () => screen.findByRole('table', { name: 'Faktury' })

  afterEach(() => { cleanup(); vi.useRealTimers() })
  beforeEach(() => {
    Object.values(api).forEach(f => f.mockReset()); onOtworz.mockReset(); onWroc.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
    try { window.localStorage.clear() } catch { /* bez pamięci */ }
    api.karta.mockResolvedValue(SUROWA_KARTA_PELNA)
    api.dokument.mockResolvedValue(SUROWY_DOKUMENT)
    api.edytujDokument.mockResolvedValue({})
    api.usunDokument.mockResolvedValue({ ok: true })
    api.usunWplate.mockResolvedValue({ ok: true })
    api.dodajWpis.mockResolvedValue({ id: 'j9' })
    api.odhaczWpis.mockResolvedValue({ ok: true })
    api.ustawKlienta.mockResolvedValue({ ok: true })
    api.historiaZmian.mockResolvedValue(HISTORIA)
    api.wpiszKwoteFv.mockResolvedValue({})
    api.nieLicz.mockResolvedValue({})
    api.usunWpis.mockResolvedValue({ ok: true })
    api.ustawWylaczenie.mockResolvedValue({ ok: true })
  })

  it('nagłówek z ustawień i trzy kafelki sald z minusem typograficznym — saldo bez czerwieni, czerwony tylko podpis po terminie (D5)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00'))
    mount()
    await gotowe()
    // Domyślny okres obrotu i kg — ten miesiąc (jak na liście); filtr dokumentów nie idzie do serwera.
    expect(api.karta).toHaveBeenCalledWith('c1', '', '', '2026-11-01', '2026-11-30')
    expect(screen.getByRole('heading', { name: 'RONDO GRILL' })).toBeTruthy()
    expect(screen.getByText('NIP HU99000001')).toBeTruthy()
    expect(screen.getByText('Termin FV: 7 dni')).toBeTruthy()
    expect(screen.getByText('WZ: gotówka przy odbiorze')).toBeTruthy()
    expect(screen.getByText(/Waluta:/).textContent).toBe('Waluta: EUR')
    expect((screen.getByLabelText('Notatka o kliencie') as HTMLInputElement).value).toBe('płaci w piątki')
    const k = kafelki()
    for (const [tytul, saldo] of [['Saldo WZ', '−8 409,50 €'], ['Saldo FV', '−30 038,20 €'], ['Saldo łącznie', '−38 447,70 €']]) {
      const kafel = within(k).getByText(tytul).closest('.rr-sum') as HTMLElement
      expect(within(kafel).getByText(saldo).className).not.toMatch(/crit-ink/)
    }
    expect(within(k).getByText(/po terminie 8 409,50 € · najstarsza 13 dni/)).toBeTruthy()
    expect(within(k).getByText(/po terminie 15 689,50 € · najstarsza 13 dni/)).toBeTruthy()
  })

  it('księgi: stan w pigułce, saldo otwarcia wyróżnione, zapłacone wyszarzone, WZ bez cen i ostrzeżenia', async () => {
    mount()
    await gotowe()
    const wz = ksiega('Księga WZ')
    expect(numery(wz)).toEqual(['WZ 30/11', 'WZ 02/11', 'WZ 21/10', 'Saldo otwarcia'])
    const w21 = wiersz(wz, 'WZ 21/10')
    // Pigułka bez dopisku, „częściowo” w drugiej linii komórki Stan.
    expect(within(w21).getByText('13 dni po terminie').className).toMatch(/tag crit/)
    expect(within(w21).getByText('częściowo').closest('td')).toBe(within(w21).getByText('13 dni po terminie').closest('td'))
    // Ostrzeżenie bez VAT w komórce numeru (nigdy w ucinanej kolumnie Uwagi).
    const vat = within(w21).getByLabelText('bez VAT — sprawdź wycenę')
    expect(vat.closest('td')).toBe(within(w21).getByText('WZ 21/10').closest('td'))
    expect(vat.getAttribute('data-tip')).toBe('bez VAT — sprawdź wycenę')
    // Kwoty w księdze bez symbolu waluty — waluta w nagłówku kolumny.
    expect(within(w21).getByText('3 120,00').className).toMatch(/crit-ink/)
    expect(within(wz).getByRole('columnheader', { name: 'Kwota €' })).toBeTruthy()
    expect(within(wz).getByRole('columnheader', { name: 'Zapłacono €' })).toBeTruthy()
    expect(within(wz).getByRole('columnheader', { name: 'Zostało €' })).toBeTruthy()
    expect(wiersz(wz, 'Saldo otwarcia').className).toMatch(/rr-otwarcie/)
    expect(within(wiersz(wz, 'WZ 30/11')).getByText('czeka na ceny')).toBeTruthy()
    const fv = ksiega('Faktury')
    expect(numery(fv)).toEqual(['FV 553/2026', 'FV 541/2026', 'FV 528/2026', 'FV 512/2026'])
    expect(wiersz(fv, 'FV 512/2026').className).toMatch(/closed/)
    expect(within(wiersz(fv, 'FV 541/2026')).getByText('termin jutro').className).toMatch(/tag warn/)
    expect(within(wiersz(fv, 'FV 512/2026')).getByText('zapłacona po 2 dniach')).toBeTruthy()
    // Dokument w innej walucie — wypisany, nie znika po cichu.
    expect(screen.getByText(/w innej walucie niż EUR/)).toBeTruthy()
    expect(screen.getByText(/FV 9\/2026/)).toBeTruthy()
  })

  it('„Ukryj zapłacone” chowa zapłaconą FV 512/2026 i spłacone saldo otwarcia; wybór zapamiętany, okres nie', async () => {
    mount()
    await gotowe()
    expect(numery(ksiega('Faktury'))).toContain('FV 512/2026')
    fireEvent.click(screen.getByLabelText('Ukryj zapłacone'))
    expect(numery(ksiega('Faktury'))).not.toContain('FV 512/2026')
    expect(numery(ksiega('Księga WZ'))).not.toContain('Saldo otwarcia')
    cleanup()
    mount()
    await gotowe()
    expect((screen.getByLabelText('Ukryj zapłacone') as HTMLInputElement).checked).toBe(true)
    expect(numery(ksiega('Faktury'))).not.toContain('FV 512/2026')
    // Dawnego filtra okresu dokumentów już nie ma — jeden wybór okresu (obrót i kg).
    expect(screen.queryByRole('button', { name: 'Wszystko' })).toBeNull()
    expect(screen.queryByRole('group', { name: 'Okres dokumentów' })).toBeNull()
  })

  it('wiersze księgi: tylko jeden w kolejności Tab, strzałki przesuwają kursor', async () => {
    mount()
    await gotowe()
    const fv = ksiega('Faktury')
    const tabowalne = () => within(fv).getAllByRole('row').filter(r => r.getAttribute('data-numer') && r.tabIndex === 0)
    expect(tabowalne().map(r => r.getAttribute('data-numer'))).toEqual(['FV 553/2026'])
    wiersz(fv, 'FV 553/2026').focus()
    fireEvent.keyDown(wiersz(fv, 'FV 553/2026'), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wiersz(fv, 'FV 541/2026'))
    expect(tabowalne().map(r => r.getAttribute('data-numer'))).toEqual(['FV 541/2026'])
    fireEvent.keyDown(wiersz(fv, 'FV 541/2026'), { key: 'End' })
    expect(document.activeElement).toBe(wiersz(fv, 'FV 512/2026'))
    fireEvent.keyDown(wiersz(fv, 'FV 512/2026'), { key: 'Home' })
    expect(document.activeElement).toBe(wiersz(fv, 'FV 553/2026'))
  })

  it('okres obrotu i kg: kafelki „Obrót” i „Sprzedane kg” z podpisem okresu; zmiana okresu pyta serwer, dokumenty (także sprzed startu) zostają', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-12T10:00:00'))
    api.karta.mockResolvedValue({ ...SUROWA_KARTA_PELNA, obrot: 21650.4, kg: 1834.5, fv_bez_kwoty: 1,
      dokumenty: { ...SUROWA_KARTA_PELNA.dokumenty, fv: [...SUROWA_KARTA_PELNA.dokumenty.fv, ZALEGLA] } })
    mount()
    await gotowe()
    const obrot = screen.getByRole('group', { name: 'Obrót' })
    expect(within(obrot).getByText('21 650,40 €')).toBeTruthy()
    expect(within(obrot).getByText('Ten miesiąc · 01.11–30.11.2026')).toBeTruthy()
    const kg = screen.getByRole('group', { name: 'Sprzedane kg' })
    expect(within(kg).getByText('1 834,5 kg')).toBeTruthy()
    expect(within(kg).getByText(/FV bez kwoty: 1/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Ten rok' }))
    await waitFor(() => expect(api.karta).toHaveBeenLastCalledWith('c1', '', '', '2026-01-01', '2026-12-31'))
    fireEvent.click(screen.getByRole('button', { name: 'Od początku' }))
    await waitFor(() => expect(api.karta).toHaveBeenLastCalledWith('c1', '', '', '', ''))
    // Okres nie zawęża ksiąg — zaległa faktura z września jest widoczna przy każdym okresie.
    expect(numery(ksiega('Faktury'))).toContain('FV 77/2026')
    // Zły zakres — komunikat, bez zapytania.
    const ile = api.karta.mock.calls.length
    fireEvent.click(screen.getByRole('button', { name: 'Od–do' }))
    fireEvent.change(screen.getByLabelText('Okres od'), { target: { value: '2026-11-20' } })
    fireEvent.change(screen.getByLabelText('Okres do'), { target: { value: '2026-11-10' } })
    expect(screen.getByText('Data „do” jest wcześniejsza niż „od”')).toBeTruthy()
    await waitFor(() => expect(api.karta.mock.calls.length).toBeGreaterThanOrEqual(ile))
    expect(api.karta.mock.calls.some(c => c[3] === '2026-11-20')).toBe(false)
    // Salda bez zmian — zawsze za całość.
    expect(within(kafelki()).getByText('−38 447,70 €')).toBeTruthy()
  })

  it('zaległy dokument sprzed startu: znacznik „sprzed startu”, klik → szczegóły (nie okno salda otwarcia)', async () => {
    api.karta.mockResolvedValue({ ...SUROWA_KARTA_PELNA, dokumenty: { ...SUROWA_KARTA_PELNA.dokumenty, fv: [...SUROWA_KARTA_PELNA.dokumenty.fv, ZALEGLA] } })
    api.dokument.mockResolvedValue({ ...ZALEGLA, ksiega: 'fv', client_id: 'c1', pokrycie: [], historia: [] })
    mount()
    await gotowe()
    const w = wiersz(ksiega('Faktury'), 'FV 77/2026')
    expect(within(w).getByText('sprzed startu').className).toMatch(/tag/)
    fireEvent.click(w)
    expect(onOtworz).not.toHaveBeenCalled()
    const dlg = await screen.findByRole('dialog')
    await waitFor(() => expect(api.dokument).toHaveBeenCalledWith('z77'))
    expect(await within(dlg).findByText(/zaległy dokument sprzed startu rozliczeń/)).toBeTruthy()
    // Zaległy: numer, data (przed startem) i kwota do zmiany; zmiana kwoty tylko z powodem.
    const kw = within(dlg).getByLabelText('Kwota') as HTMLInputElement
    fireEvent.change(kw, { target: { value: '3 000' } })
    const zapisz = within(dlg).getByRole('button', { name: 'Zapisz zmiany' }) as HTMLButtonElement
    expect(zapisz.disabled).toBe(true)
    expect(within(dlg).getByText('Zmiana kwoty wymaga powodu')).toBeTruthy()
    fireEvent.change(within(dlg).getByLabelText('Data wystawienia'), { target: { value: '2026-10-05' } })
    expect(within(dlg).getByText(/Zaległy dokument musi mieć datę sprzed 01\.10\.2026/)).toBeTruthy()
    fireEvent.change(within(dlg).getByLabelText('Data wystawienia'), { target: { value: '2026-09-10' } })
    fireEvent.change(within(dlg).getByLabelText('Powód zmiany'), { target: { value: 'klient dopłacił przed startem' } })
    fireEvent.click(zapisz)
    await waitFor(() => expect(api.edytujDokument).toHaveBeenCalledWith('z77', { data: '2026-09-10', kwota: 3000, powod: 'klient dopłacił przed startem' }))
    // Usunięcie zaległego — z powodem.
  })

  it('przyciski nagłówka wołają onOtworz z rodzajem okna', async () => {
    mount()
    await gotowe()
    fireEvent.click(screen.getByRole('button', { name: '+ Wpłata' }))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'wplata' }))
    fireEvent.click(screen.getByRole('button', { name: '+ Faktura' }))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'faktura' }))
    fireEvent.click(screen.getByRole('button', { name: 'Drukuj saldo' }))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'druk' }))
    fireEvent.click(screen.getByRole('button', { name: 'Saldo otwarcia' }))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'otwarcie' }))
    fireEvent.click(screen.getByRole('button', { name: 'Ustawienia' }))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'ustawienia' }))
    // Klik w wiersz salda otwarcia → okno salda otwarcia tej księgi
    fireEvent.click(wiersz(ksiega('Księga WZ'), 'Saldo otwarcia'))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'otwarcie', ksiega: 'wz', zakladka: 'kwota' }))
    fireEvent.click(screen.getByRole('button', { name: '← Kontrahenci' }))
    expect(onWroc).toHaveBeenCalled()
  })

  it('notatki (dawniej dziennik): notatka z datą przypomnienia woła dodajWpis, potem toast i odświeżenie; Odhacz', async () => {
    mount()
    await gotowe()
    expect(screen.queryByText(/Dziennik ustaleń/)).toBeNull()
    const dz = screen.getByRole('region', { name: 'Notatki' })
    // Nieodhaczone przypomnienia na górze, zaległe wyróżnione.
    const wpisy = within(dz).getAllByRole('listitem')
    expect(wpisy.map(w => w.getAttribute('data-id'))).toEqual(['j3', 'j1', 'j2'])
    expect(wpisy[0].className).toMatch(/zalegle/)
    const dodaj = within(dz).getByRole('button', { name: 'Dodaj notatkę' }) as HTMLButtonElement
    expect(dodaj.disabled).toBe(true)
    expect(dodaj.getAttribute('data-tip')).toBe('Wpisz treść notatki')
    fireEvent.change(within(dz).getByLabelText('Treść notatki'), { target: { value: 'dzwoniłem' } })
    fireEvent.change(within(dz).getByLabelText('Przypomnij'), { target: { value: '2026-11-12' } })
    expect(dodaj.disabled).toBe(false)
    fireEvent.click(dodaj)
    await waitFor(() => expect(api.dodajWpis).toHaveBeenCalledWith('c1', 'dzwoniłem', '2026-11-12'))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Notatka dodana' })))
    expect(api.karta).toHaveBeenCalledTimes(2)
    expect((within(dz).getByLabelText('Treść notatki') as HTMLInputElement).value).toBe('')
    fireEvent.click(within(wpisy[0]).getByRole('button', { name: 'Odhacz' }))
    await waitFor(() => expect(api.odhaczWpis).toHaveBeenCalledWith('j3'))
  })

  it('wpłaty: „Rozliczyła” z numerami i nadpłatą; usunięcie bez powodu nieaktywne, z powodem woła usunWplate', async () => {
    mount()
    await gotowe()
    const wpl = screen.getByRole('table', { name: 'Wpłaty' })
    const p3 = within(wpl).getAllByRole('row').find(r => r.getAttribute('data-id') === 'p3') as HTMLElement
    const roz = p3.querySelector('td.rr-rozliczyla') as HTMLElement
    expect(roz.textContent).toBe('FV 528/2026: 7 000,00 €; nadpłata: 250,00 €')
    // Pozycja nie łamie się w środku kwoty (spacja to też separator tysięcy) — łamie się tylko między pozycjami.
    expect(Array.from(roz.querySelectorAll('.rr-nw')).map(e => e.textContent)).toEqual(['FV 528/2026: 7 000,00 €', 'nadpłata: 250,00 €'])
    const p1 = within(wpl).getAllByRole('row').find(r => r.getAttribute('data-id') === 'p1') as HTMLElement
    fireEvent.click(within(p1).getByRole('button', { name: /Usuń/ }))
    const dlg = await screen.findByRole('dialog')
    const usun = within(dlg).getByRole('button', { name: 'Usuń wpłatę' }) as HTMLButtonElement
    expect(usun.disabled).toBe(true)
    expect(usun.getAttribute('data-tip')).toBe('Wpisz powód usunięcia')
    api.usunWplate.mockRejectedValueOnce(new Error('Wpłata jest już usunięta'))
    fireEvent.change(within(dlg).getByLabelText('Powód'), { target: { value: 'pomyłka' } })
    fireEvent.click(usun)
    expect(await within(dlg).findByText(/Wpłata jest już usunięta/)).toBeTruthy()
    expect((within(dlg).getByLabelText('Powód') as HTMLInputElement).value).toBe('pomyłka')
    fireEvent.keyDown(within(dlg).getByLabelText('Powód'), { key: 'Enter' })
    await waitFor(() => expect(api.usunWplate).toHaveBeenLastCalledWith('p1', 'pomyłka'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: expect.stringContaining('17 325,00 €') }))
    expect(api.karta).toHaveBeenCalledTimes(2)
  })

  it('klik w dokument → szczegóły z pokryciem i historią; zmiana uwag woła edytujDokument', async () => {
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Faktury'), 'FV 512/2026'))
    const dlg = await screen.findByRole('dialog')
    await waitFor(() => expect(api.dokument).toHaveBeenCalledWith('f512'))
    expect(await within(dlg).findByText(/ustalenie z klientem/)).toBeTruthy()
    expect(within(dlg).getByRole('table', { name: 'Pokrycie wpłatami' })).toBeTruthy()
    const zapisz = within(dlg).getByRole('button', { name: 'Zapisz zmiany' }) as HTMLButtonElement
    expect(zapisz.disabled).toBe(true)
    const uwagi = within(dlg).getByLabelText('Uwagi') as HTMLInputElement
    expect(uwagi.value).toBe('ręczna')
    fireEvent.change(uwagi, { target: { value: 'reklamacja 426 €' } })
    fireEvent.click(zapisz)
    await waitFor(() => expect(api.edytujDokument).toHaveBeenCalledWith('f512', { uwagi: 'reklamacja 426 €' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok' }))
    expect(api.karta).toHaveBeenCalledTimes(2)
  })

  it('faktura ręczna: Usuń wymaga powodu i woła usunDokument', async () => {
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Faktury'), 'FV 512/2026'))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(await within(dlg).findByRole('button', { name: 'Usuń fakturę…' }))
    const usun = within(dlg).getByRole('button', { name: 'Usuń fakturę' }) as HTMLButtonElement
    expect(usun.disabled).toBe(true)
    fireEvent.change(within(dlg).getByLabelText('Powód usunięcia'), { target: { value: 'duplikat' } })
    fireEvent.click(usun)
    await waitFor(() => expect(api.usunDokument).toHaveBeenCalledWith('f512', 'duplikat'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('WZ z MES nie ma „Usuń” w szczegółach', async () => {
    api.dokument.mockResolvedValue({ ...SUROWA_KARTA_PELNA.dokumenty.wz[1], pokrycie: [], historia: [] })
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Księga WZ'), 'WZ 21/10'))
    const dlg = await screen.findByRole('dialog')
    await waitFor(() => expect(api.dokument).toHaveBeenCalledWith('w21'))
    expect(await within(dlg).findByText(/WZ z MES/)).toBeTruthy()
    expect(within(dlg).queryByRole('button', { name: /Usuń/ })).toBeNull()
  })

  it('notatka o kliencie zapisuje się po wyjściu z pola', async () => {
    mount()
    await gotowe()
    const pole = screen.getByLabelText('Notatka o kliencie')
    fireEvent.change(pole, { target: { value: 'limit 20 000 €' } })
    fireEvent.blur(pole)
    await waitFor(() => expect(api.ustawKlienta).toHaveBeenCalledWith('c1', { notatka: 'limit 20 000 €' }))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok' })))
    // Esc cofa niezapisaną zmianę
    fireEvent.change(pole, { target: { value: 'coś' } })
    fireEvent.keyDown(pole, { key: 'Escape' })
    expect((pole as HTMLInputElement).value).toBe('limit 20 000 €')
  })

  it('rozliczenia nieotwarte: podpowiedź, że saldo nie drukuje się na WZ, i przycisk do salda otwarcia', async () => {
    api.karta.mockResolvedValue({ ...SUROWA_KARTA_PELNA, rozliczenia_otwarte: false, otwarcia: { wz: null, fv: null } })
    mount()
    await gotowe()
    const nota = screen.getByText(/Saldo nie drukuje się jeszcze na WZ ani w papierach kursu/).closest('.note') as HTMLElement
    expect(nota.textContent).toContain('Saldo nie drukuje się jeszcze na WZ ani w papierach kursu — wprowadź saldo otwarcia (może być 0).')
    expect(nota.className).toMatch(/warn/)
    fireEvent.click(within(nota).getByRole('button', { name: 'Wprowadź saldo otwarcia' }))
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'otwarcie' }))
  })

  it('rozliczenia otwarte: bez podpowiedzi o saldzie otwarcia', async () => {
    mount()
    await gotowe()
    expect(screen.queryByText(/Saldo nie drukuje się jeszcze/)).toBeNull()
  })

  it('faktura korygująca: ujemny wiersz w księdze FV z pigułką „korekta”; klik → szczegóły z tym, co zmniejszyła, i „Usuń korektę…”', async () => {
    api.karta.mockResolvedValue(Z_KOREKTA)
    api.dokument.mockResolvedValue({ ...KOREKTA, pokrycie: [], historia: [] })
    mount()
    await gotowe()
    const fv = ksiega('Faktury')
    expect(numery(fv)[0]).toBe('FVK 3/2026')
    const w = wiersz(fv, 'FVK 3/2026')
    expect(w.className).toMatch(/rr-korekta/)
    expect(within(w).getByText('−426,00')).toBeTruthy()
    expect(within(w).getByText('korekta').className).toMatch(/tag/)
    expect(within(w).getByText('zmniejszyła FV 528/2026')).toBeTruthy()
    expect(w.getAttribute('aria-label')).toBe('FVK 3/2026, korekta −426,00 €')
    fireEvent.click(w)
    const dlg = await screen.findByRole('dialog')
    await waitFor(() => expect(api.dokument).toHaveBeenCalledWith('k1'))
    expect(await within(dlg).findByText('FV 528/2026: 426,00 €')).toBeTruthy()
    expect(within(dlg).queryByRole('table', { name: 'Pokrycie wpłatami' })).toBeNull()
    expect(within(dlg).queryByLabelText('Termin płatności')).toBeNull()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Usuń korektę…' }))
    fireEvent.change(within(dlg).getByLabelText('Powód usunięcia'), { target: { value: 'wpisana pomyłkowo' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Usuń korektę' }))
    await waitFor(() => expect(api.usunDokument).toHaveBeenCalledWith('k1', 'wpisana pomyłkowo'))
  })

  it('historia zmian: zwinięta (bez zapytania), po rozwinięciu najnowsze pierwsze, usunięcia oznaczone z powodem', async () => {
    mount()
    await gotowe()
    const przycisk = screen.getByRole('button', { name: /Historia zmian/ })
    expect(przycisk.getAttribute('aria-expanded')).toBe('false')
    expect(api.historiaZmian).not.toHaveBeenCalled()
    fireEvent.click(przycisk)
    expect(przycisk.getAttribute('aria-expanded')).toBe('true')
    const tab = await screen.findByRole('table', { name: 'Historia zmian' })
    await waitFor(() => expect(api.historiaZmian).toHaveBeenCalledWith('c1'))
    const wiersze = within(tab).getAllByRole('row').slice(1)
    expect(wiersze.map(r => r.getAttribute('data-id'))).toEqual(['h3', 'h2'])
    expect(within(wiersze[0]).getByText('usunięte').className).toMatch(/tag crit/)
    expect(within(wiersze[0]).getByText('wpisana dwa razy')).toBeTruthy()
    expect(within(wiersze[0]).getByText('Wpłata 300,00 € z 05.11.2026')).toBeTruthy()
    expect(within(wiersze[0]).getByText('Szef')).toBeTruthy()
    expect(wiersze[0].className).toMatch(/rr-usuniete/)
    expect(within(wiersze[1]).queryByText('usunięte')).toBeNull()
    fireEvent.click(przycisk)
    expect(screen.queryByRole('table', { name: 'Historia zmian' })).toBeNull()
  })

  it('historia zmian: błąd → komunikat z „Spróbuj ponownie”; pusta — zdanie zamiast tabeli', async () => {
    api.historiaZmian.mockRejectedValueOnce(new Error('Serwer nie odpowiada')).mockResolvedValueOnce({ wpisy: [], wiecej: false })
    mount()
    await gotowe()
    fireEvent.click(screen.getByRole('button', { name: /Historia zmian/ }))
    expect(await screen.findByText(/Serwer nie odpowiada/)).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Spróbuj ponownie' })[0])
    expect(await screen.findByText(/Brak zmian/)).toBeTruthy()
  })

  it('WZ nieliczona: domyślnie ukryta za „Pokaż nieliczone (1)”; po włączeniu wyszarzona z tagiem i powodem; wybór zapamiętany', async () => {
    api.karta.mockResolvedValue(Z_NOWYMI)
    mount()
    await gotowe()
    expect(numery(ksiega('Księga WZ'))).not.toContain('WZ 05/11')
    const przel = screen.getByLabelText('Pokaż nieliczone (1)') as HTMLInputElement
    expect(przel.checked).toBe(false)
    fireEvent.click(przel)
    const w = wiersz(ksiega('Księga WZ'), 'WZ 05/11')
    expect(w.className).toMatch(/rr-nieliczona/)
    expect(within(w).getByText('nie liczona').className).toMatch(/tag neutral/)
    expect(within(w).getByText('towar dla pracowników')).toBeTruthy()
    cleanup()
    mount()
    await gotowe()
    expect(numery(ksiega('Księga WZ'))).toContain('WZ 05/11')
  })

  it('szczegóły WZ: „Nie licz do rozrachunków…” wymaga powodu i woła nieLicz; nieliczoną można liczyć z powrotem', async () => {
    api.dokument.mockResolvedValue({ ...SUROWA_KARTA_PELNA.dokumenty.wz[1], ksiega: 'wz', kg: 340, nie_licz: false, pokrycie: [], historia: [] })
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Księga WZ'), 'WZ 21/10'))
    const dlg = await screen.findByRole('dialog')
    fireEvent.click(await within(dlg).findByRole('button', { name: 'Nie licz do rozrachunków…' }))
    const nie = within(dlg).getByRole('button', { name: 'Nie licz tej WZ' }) as HTMLButtonElement
    expect(nie.disabled).toBe(true)
    expect(nie.getAttribute('data-tip')).toBe('Wpisz powód')
    api.nieLicz.mockRejectedValueOnce(new Error('Dokument jest usunięty'))
    fireEvent.change(within(dlg).getByLabelText('Powód nieliczenia'), { target: { value: 'nie nasze pieniądze' } })
    fireEvent.click(nie)
    expect(await within(dlg).findByText(/Dokument jest usunięty/)).toBeTruthy()
    expect((within(dlg).getByLabelText('Powód nieliczenia') as HTMLInputElement).value).toBe('nie nasze pieniądze')
    fireEvent.keyDown(within(dlg).getByLabelText('Powód nieliczenia'), { key: 'Enter' })
    await waitFor(() => expect(api.nieLicz).toHaveBeenLastCalledWith('w21', true, 'nie nasze pieniądze'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'WZ 21/10 nie liczy się do rozrachunków' }))
    // Cofnięcie
    api.dokument.mockResolvedValue({ ...NIELICZONA, ksiega: 'wz', pokrycie: [], historia: [] })
    api.karta.mockResolvedValue(Z_NOWYMI)
    cleanup(); mount(); await gotowe()
    fireEvent.click(screen.getByLabelText('Pokaż nieliczone (1)'))
    fireEvent.click(wiersz(ksiega('Księga WZ'), 'WZ 05/11'))
    const dlg2 = await screen.findByRole('dialog')
    expect(await within(dlg2).findByText(/„towar dla pracowników”/)).toBeTruthy()
    fireEvent.click(within(dlg2).getByRole('button', { name: 'Licz z powrotem…' }))
    fireEvent.change(within(dlg2).getByLabelText('Powód cofnięcia'), { target: { value: 'pomyłka' } })
    fireEvent.click(within(dlg2).getByRole('button', { name: 'Licz z powrotem' }))
    await waitFor(() => expect(api.nieLicz).toHaveBeenLastCalledWith('w05', false, 'pomyłka'))
  })

  it('FV bez kwoty: wiersz „czeka na kwotę” z „Wpisz kwotę” → szczegóły z polem kwoty (fokus), Enter woła wpiszKwoteFv', async () => {
    api.karta.mockResolvedValue(Z_NOWYMI)
    api.dokument.mockResolvedValue({ ...BEZ_KWOTY, ksiega: 'fv', client_id: 'c1', pokrycie: [], historia: [] })
    mount()
    await gotowe()
    const w = wiersz(ksiega('Faktury'), 'FV 590/2026')
    expect(within(w).getByText('czeka na kwotę').className).toMatch(/tag warn/)
    expect(within(w).getByText('z papierów kursu · 1 250,5 kg')).toBeTruthy()
    fireEvent.click(within(w).getByRole('button', { name: 'Wpisz kwotę' }))
    const dlg = await screen.findByRole('dialog')
    const pole = await within(dlg).findByLabelText('Kwota brutto') as HTMLInputElement
    await waitFor(() => expect(document.activeElement).toBe(pole))
    const kafle = within(dlg).getByRole('group', { name: 'Podsumowanie dokumentu' })
    expect(within(kafle).getByText('czeka na kwotę')).toBeTruthy()
    expect(within(kafle).getByText('1 250,5 kg')).toBeTruthy()
    const zapiszK = within(dlg).getByRole('button', { name: 'Zapisz kwotę' }) as HTMLButtonElement
    expect(zapiszK.disabled).toBe(true)
    fireEvent.change(pole, { target: { value: '0' } })
    expect(within(dlg).getByText('Wpisz kwotę większą od zera')).toBeTruthy()
    fireEvent.change(pole, { target: { value: '12 450,80' } })
    fireEvent.keyDown(pole, { key: 'Enter' })
    await waitFor(() => expect(api.wpiszKwoteFv).toHaveBeenCalledWith('fk1', 12450.8))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'FV 590/2026 — kwota 12 450,80 € wpisana', detail: 'faktura weszła do salda · termin 17.11.2026' }))
    expect(api.karta).toHaveBeenCalledTimes(2)
  })

  it('szczegóły FV: kafelki kwota/zapłacono/zostało/kg/termin, wpłaty z całą kwotą wpłaty, „+ Wpłata do tego dokumentu” otwiera wpłatę z przypiętym dokumentem', async () => {
    api.dokument.mockResolvedValue({ ...SUROWA_KARTA_PELNA.dokumenty.fv[2], ksiega: 'fv', client_id: 'c1', kg: 980,
      pokrycie: [{ data: '2026-11-05', forma: 'przelew', kwota: 7000, kwota_wplaty: 7250, uwagi: 'tytuł 528', kto: 'biuro', rodzaj: 'wplata', wplata_id: 'p3' }],
      historia: [] })
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Faktury'), 'FV 528/2026'))
    const dlg = await screen.findByRole('dialog')
    const kafle = await within(dlg).findByRole('group', { name: 'Podsumowanie dokumentu' })
    const kafel = (k: string) => within(kafle).getByText(k).closest('.rr-sum') as HTMLElement
    expect(within(kafel('Kwota')).getByText('14 280,00 €')).toBeTruthy()
    expect(within(kafel('Zapłacono')).getByText('7 000,00 €')).toBeTruthy()
    expect(within(kafel('Zostało')).getByText('7 280,00 €').className).toMatch(/crit-ink/)
    expect(within(kafel('kg')).getByText('980 kg')).toBeTruthy()
    expect(within(kafel('Termin')).getByText('03.11.2026')).toBeTruthy()
    const tab = within(dlg).getByRole('table', { name: 'Pokrycie wpłatami' })
    expect(within(tab).getByText('7 000,00 €')).toBeTruthy()
    expect(within(tab).getByText('7 250,00 €')).toBeTruthy()
    expect(within(tab).getByText('biuro')).toBeTruthy()
    const wpl = within(dlg).getByRole('button', { name: '+ Wpłata do tego dokumentu' })
    expect(document.activeElement).toBe(wpl)
    fireEvent.click(wpl)
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'wplata', ksiega: 'fv', dokumentId: 'f528' }))
  })

  it('szczegóły bez wpłat: „Brak wpłat” i przycisk wpłaty; faktura ręczna — pole kg w zmianie danych', async () => {
    api.dokument.mockResolvedValue({ ...SUROWA_KARTA_PELNA.dokumenty.fv[0], ksiega: 'fv', kg: null, pokrycie: [], historia: [] })
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Faktury'), 'FV 553/2026'))
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByText('Brak wpłat')).toBeTruthy()
    expect(within(dlg).getByRole('button', { name: '+ Wpłata do tego dokumentu' })).toBeTruthy()
    fireEvent.change(within(dlg).getByLabelText('Kilogramy'), { target: { value: '420,5' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zapisz zmiany' }))
    await waitFor(() => expect(api.edytujDokument).toHaveBeenCalledWith('f553', { kg: 420.5 }))
  })

  it('notatki: usunięcie z potwierdzeniem w oknie woła usunWpis, toast, odświeżenie', async () => {
    mount()
    await gotowe()
    const dz = screen.getByRole('region', { name: 'Notatki' })
    fireEvent.click(within(dz).getByRole('button', { name: 'Usuń notatkę: wysłałem zestawienie mailem' }))
    const dlg = await screen.findByRole('dialog')
    expect(within(dlg).getByText('wysłałem zestawienie mailem')).toBeTruthy()
    expect(document.activeElement).toBe(within(dlg).getByLabelText('Powód'))
    fireEvent.change(within(dlg).getByLabelText('Powód'), { target: { value: 'nieaktualne' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Usuń notatkę' }))
    await waitFor(() => expect(api.usunWpis).toHaveBeenCalledWith('j2', 'nieaktualne'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Notatka usunięta' }))
    expect(api.karta).toHaveBeenCalledTimes(2)
  })

  it('klient wyłączony: wyraźna informacja i „Przywróć do rozrachunków” woła ustawWylaczenie(id, false)', async () => {
    api.karta.mockResolvedValue({ ...SUROWA_KARTA_PELNA, rozliczenia_otwarte: false, klient: { ...SUROWA_KARTA_PELNA.klient, wylaczony: true } })
    mount()
    await gotowe()
    expect(screen.getByText('Wyłączony z rozrachunków.')).toBeTruthy()
    expect(screen.queryByText(/Saldo nie drukuje się jeszcze/)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Przywróć do rozrachunków' }))
    await waitFor(() => expect(api.ustawWylaczenie).toHaveBeenCalledWith('c1', false))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'RONDO GRILL wraca do rozrachunków' })))
  })

  it('karta i szczegóły dokumentu bez placeholderów (D9); notatka o kliencie ma widoczną etykietę', async () => {
    mount()
    await gotowe()
    expect(screen.getByText('Notatka o kliencie')).toBeTruthy()
    fireEvent.click(wiersz(ksiega('Faktury'), 'FV 512/2026'))
    await screen.findByRole('dialog')
    await screen.findByRole('group', { name: 'Podsumowanie dokumentu' })
    expect(document.querySelectorAll('[placeholder]').length).toBe(0)
  })

  it('FV bez kwoty z terminem zmienionym ręcznie: okno i toast pokazują termin z serwera, nie data + termin FV', async () => {
    api.karta.mockResolvedValue(Z_NOWYMI)
    api.dokument.mockResolvedValue({ ...BEZ_KWOTY, termin: '2026-11-30', ksiega: 'fv', client_id: 'c1', pokrycie: [], historia: [] })
    api.wpiszKwoteFv.mockResolvedValue({ ...BEZ_KWOTY, kwota: 500, termin: '2026-11-30', stan: { kod: 'w_terminie', dni: 18, czesciowo: false } })
    mount()
    await gotowe()
    fireEvent.click(within(wiersz(ksiega('Faktury'), 'FV 590/2026')).getByRole('button', { name: 'Wpisz kwotę' }))
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByText(/z terminem 30\.11\.2026/)).toBeTruthy()
    fireEvent.change(within(dlg).getByLabelText('Kwota brutto'), { target: { value: '500' } })
    fireEvent.click(within(dlg).getByRole('button', { name: 'Zapisz kwotę' }))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ detail: 'faktura weszła do salda · termin 30.11.2026' })))
  })

  it('szczegóły nieliczonej WZ: „nie liczona” raz (w tytule), powód w nocie, bez edycji terminu i formy i bez sekcji wpłat', async () => {
    api.karta.mockResolvedValue(Z_NOWYMI)
    api.dokument.mockResolvedValue({ ...NIELICZONA, ksiega: 'wz', pokrycie: [], historia: [] })
    mount()
    await gotowe()
    fireEvent.click(screen.getByLabelText('Pokaż nieliczone (1)'))
    fireEvent.click(wiersz(ksiega('Księga WZ'), 'WZ 05/11'))
    const dlg = await screen.findByRole('dialog')
    await within(dlg).findByRole('group', { name: 'Podsumowanie dokumentu' })
    expect(within(dlg).getAllByText(/nie liczon/i)).toHaveLength(1)
    expect(within(dlg).queryByLabelText('Termin płatności')).toBeNull()
    expect(within(dlg).queryByRole('group', { name: 'Forma płatności' })).toBeNull()
    expect(within(dlg).queryByRole('region', { name: 'Wpłaty do tego dokumentu' })).toBeNull()
  })

  it('zaległa WZ sprzed startu: bez „Nie licz do rozrachunków…” (usuwa się ją z powodem)', async () => {
    const zalWz = { ...ZALEGLA, id: 'z9', numer: 'WZ/77/09/26' }
    api.karta.mockResolvedValue({ ...SUROWA_KARTA_PELNA, dokumenty: { ...SUROWA_KARTA_PELNA.dokumenty, wz: [...SUROWA_KARTA_PELNA.dokumenty.wz, zalWz] } })
    api.dokument.mockResolvedValue({ ...zalWz, ksiega: 'wz', pokrycie: [], historia: [] })
    mount()
    await gotowe()
    fireEvent.click(wiersz(ksiega('Księga WZ'), 'WZ/77/09/26'))
    const dlg = await screen.findByRole('dialog')
    expect(await within(dlg).findByRole('button', { name: 'Usuń dokument…' })).toBeTruthy()
    expect(within(dlg).queryByRole('button', { name: 'Nie licz do rozrachunków…' })).toBeNull()
  })

  it('błąd wczytania karty → komunikat z „Spróbuj ponownie”', async () => {
    api.karta.mockRejectedValueOnce(new Error('Brak połączenia z serwerem'))
    mount()
    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await gotowe()).toBeTruthy()
  })
})
