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
}))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), rozliczeniaApi: api }))
import { KartaKlienta } from './KartaKlienta'

/** Faktura korygująca w księdze FV — wiersz ujemny z tym, co zmniejszyła (najnowsza na górze). */
const KOREKTA = {
  id: 'k1', numer: 'FVK 3/2026', data: '2026-11-08', kwota: -426, zaplacono: 0, zostalo: 0, termin: '2026-11-15', forma: '', uwagi: 'reklamacja',
  zrodlo: 'reczna', otwarcie: false, stan: { kod: 'korekta', dni: 0, czesciowo: false }, zamkniety: null, brak_vat: false,
  korekta: true, rozliczyla: [{ numer: 'FV 528/2026', kwota: 426 }],
}
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
  })

  it('nagłówek z ustawień i trzy kafelki sald z minusem typograficznym na czerwono', async () => {
    mount()
    await gotowe()
    expect(api.karta).toHaveBeenCalledWith('c1')
    expect(screen.getByRole('heading', { name: 'RONDO GRILL' })).toBeTruthy()
    expect(screen.getByText('NIP HU99000001')).toBeTruthy()
    expect(screen.getByText('Termin FV: 7 dni')).toBeTruthy()
    expect(screen.getByText('WZ: gotówka przy odbiorze')).toBeTruthy()
    expect(screen.getByText(/Waluta:/).textContent).toBe('Waluta: EUR')
    expect((screen.getByLabelText('Notatka o kliencie') as HTMLInputElement).value).toBe('płaci w piątki')
    const k = kafelki()
    for (const [tytul, saldo] of [['Saldo WZ', '−8 409,50 €'], ['Saldo FV', '−30 038,20 €'], ['Saldo łącznie', '−38 447,70 €']]) {
      const kafel = within(k).getByText(tytul).closest('.rr-sum') as HTMLElement
      expect(within(kafel).getByText(saldo).className).toMatch(/crit-ink/)
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
    fireEvent.click(screen.getByRole('button', { name: 'Rok' }))
    cleanup()
    mount()
    await gotowe()
    expect((screen.getByLabelText('Ukryj zapłacone') as HTMLInputElement).checked).toBe(true)
    expect(numery(ksiega('Faktury'))).not.toContain('FV 512/2026')
    // Okres zawsze od „Wszystko” (spec 8.2) — nie przechodzi na kartę kolejnego klienta.
    expect(screen.getByRole('button', { name: 'Wszystko' }).getAttribute('aria-pressed')).toBe('true')
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

  it('filtr „Ten miesiąc” zostawia FV 541 i 553, kafelki sald bez zmian', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime('2026-11-09')
    mount()
    await gotowe()
    fireEvent.click(screen.getByRole('button', { name: 'Ten miesiąc' }))
    expect(numery(ksiega('Faktury'))).toEqual(['FV 553/2026', 'FV 541/2026'])
    expect(within(kafelki()).getByText('−38 447,70 €')).toBeTruthy()
    expect(within(kafelki()).getByText('−30 038,20 €')).toBeTruthy()
    // Od–do: własny zakres dat
    fireEvent.click(screen.getByRole('button', { name: 'Od–do' }))
    fireEvent.change(screen.getByLabelText('Od dnia'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('Do dnia'), { target: { value: '2026-10-31' } })
    expect(numery(ksiega('Faktury'))).toEqual(['FV 528/2026', 'FV 512/2026'])
    fireEvent.click(screen.getByRole('button', { name: 'Wszystko' }))
    expect(numery(ksiega('Faktury'))).toHaveLength(4)
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
    expect(onOtworz).toHaveBeenLastCalledWith(expect.objectContaining({ rodzaj: 'otwarcie', ksiega: 'wz' }))
    fireEvent.click(screen.getByRole('button', { name: '← Kontrahenci' }))
    expect(onWroc).toHaveBeenCalled()
  })

  it('dziennik: wpis z datą przypomnienia woła dodajWpis, potem toast i odświeżenie; Odhacz', async () => {
    mount()
    await gotowe()
    const dz = screen.getByRole('region', { name: 'Dziennik ustaleń' })
    // Nieodhaczone przypomnienia na górze, zaległe wyróżnione.
    const wpisy = within(dz).getAllByRole('listitem')
    expect(wpisy.map(w => w.getAttribute('data-id'))).toEqual(['j3', 'j1', 'j2'])
    expect(wpisy[0].className).toMatch(/zalegle/)
    const dodaj = within(dz).getByRole('button', { name: 'Dodaj wpis' }) as HTMLButtonElement
    expect(dodaj.disabled).toBe(true)
    fireEvent.change(within(dz).getByLabelText('Treść ustalenia'), { target: { value: 'dzwoniłem' } })
    fireEvent.change(within(dz).getByLabelText('Przypomnij'), { target: { value: '2026-11-12' } })
    expect(dodaj.disabled).toBe(false)
    fireEvent.click(dodaj)
    await waitFor(() => expect(api.dodajWpis).toHaveBeenCalledWith('c1', 'dzwoniłem', '2026-11-12'))
    await waitFor(() => expect(app.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok' })))
    expect(api.karta).toHaveBeenCalledTimes(2)
    expect((within(dz).getByLabelText('Treść ustalenia') as HTMLInputElement).value).toBe('')
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

  it('błąd wczytania karty → komunikat z „Spróbuj ponownie”', async () => {
    api.karta.mockRejectedValueOnce(new Error('Brak połączenia z serwerem'))
    mount()
    expect(await screen.findByText(/Brak połączenia z serwerem/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Spróbuj ponownie' }))
    expect(await gotowe()).toBeTruthy()
  })
})
