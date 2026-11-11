import { describe, it, expect } from 'vitest'
import {
  etykietaStanu, filtruj, kwotaSalda, liczba, mapujKarte, mapujListe, mapujSzczegoly, opisPlatnosci, pigulka, podpowiedzKlienta,
  rozliczyla, sortuj, symbolWaluty, uporzadkujDziennik, walutyPodsumowania, wOkresie, zakresOkresu,
  type Kontrahent, type Wplata,
} from './model'
import { SUROWA_KARTA, SUROWA_KARTA_PELNA, SUROWA_LISTA, SUROWY_DOKUMENT } from './daneTestowe'

const lista = () => mapujListe(SUROWA_LISTA).kontrahenci
const k = (o: Partial<Kontrahent>): Kontrahent => ({ ...lista()[0], ...o })

describe('mapujListe — nie gubi pól', () => {
  it('snake_case → camelCase dla wiersza, podsumowania, WZ bez kontrahenta', () => {
    const l = mapujListe(SUROWA_LISTA)
    const r = l.kontrahenci[0]
    expect(r).toEqual({ id: 'c1', nazwa: 'ROJPAK', nip: 'HU25341187', waluta: 'EUR', saldoWz: -8409.5, saldoFv: -30038.2, saldo: -38447.7,
      poTerminie: 15689.5, najstarszaDni: 13, najblizszyTerminDni: 1, stan: 'po_terminie', przypomnienie: true })
    expect(r.saldoWz).toBe(-8409.5)
    expect(r.najstarszaDni).toBe(13)
    expect(l.kontrahenci[1].najblizszyTerminDni).toBeNull()
    expect(l.start).toBe('2026-11-09')
    expect(l.podsumowanie.EUR).toEqual({ naleznosci: 38447.7, poTerminie: 15689.5, gotowkaWz: 8409.5, nadplaty: 0 })
    expect(l.bezKontrahenta).toEqual([{ id: 'd1', numer: 'WZ 07/11', data: '2026-11-07', kwota: 1250.4, waluta: 'PLN', nabywca: 'NAZAR' }])
    expect(l.innaWaluta).toBe(2)
  })
  it('pusta / uszkodzona odpowiedź → puste listy zamiast wyjątku', () => {
    expect(mapujListe(null)).toEqual({ start: '', podsumowanie: {}, kontrahenci: [], bezKontrahenta: [], innaWaluta: 0 })
  })
})

describe('mapujKarte — nie gubi pól', () => {
  it('klient, salda, otwarcia, dokumenty, wpłaty, ostrzeżenia, dziennik', () => {
    const c = mapujKarte(SUROWA_KARTA)
    expect(c.klient).toEqual({ id: 'c1', nazwa: 'ROJPAK', nip: 'HU25341187', waluta: 'EUR', terminWz: 0, terminFv: 7,
      formaWz: 'gotowka', formaFv: 'przelew', notatka: 'płaci w piątki', walutaPodpowiedz: null })
    expect(c.start).toBe('2026-10-01')
    expect(c.saldo).toEqual({ wz: -8409.5, fv: -30038.2, lacznie: -38447.7, poTerminieWz: 8409.5, poTerminieFv: 7280,
      najstarszaDniWz: 13, najstarszaDniFv: 6 })
    expect(c.otwarcia).toEqual({ wz: { kwota: -6300, zalegleOd: '2026-09-20', uwagi: 'z Excela' }, fv: null })
    expect(c.dokumenty.wz[0]).toEqual({ id: 'w21', numer: 'WZ 21/10', data: '2026-10-27', kwota: 6120, zaplacono: 3000, zostalo: 3120,
      termin: '2026-10-27', forma: 'gotowka', uwagi: '', zrodlo: 'mes_wz', otwarcie: false,
      stan: { kod: 'po_terminie', dni: 13, czesciowo: true }, zamkniety: null, brakVat: true })
    expect(c.dokumenty.fv[0].zamkniety).toBe('2026-10-20')
    expect(c.wplaty[0]).toEqual({ id: 'p1', ksiega: 'fv', forma: 'przelew', kwota: 17325, data: '2026-10-20', uwagi: 'tytuł',
      utworzyl: 'biuro', dokumentId: null, przydzialy: [{ numer: 'FV 512/2026', kwota: 17325 }], reszta: 0 })
    expect(c.czekaNaCeny).toEqual([{ id: 'w30', numer: 'WZ 30/11', data: '2026-11-09' }])
    expect(c.innaWaluta).toEqual([{ id: 'f9', numer: 'FV 9/2026', data: '2026-11-02', kwota: 500, waluta: 'PLN', rodzaj: 'dokument' }])
    expect(c.dziennik).toEqual([{ id: 'j1', tresc: 'obiecał przelew', przypomnij: '2026-11-12', odhaczono: null, kto: 'biuro',
      kiedy: '2026-11-09T10:00:00' }])
  })
})

describe('pigulka — stan kontrahenta w kształcie', () => {
  it('każdy stan ma swój tekst i ton', () => {
    expect(pigulka(k({ stan: 'po_terminie', najstarszaDni: 41 }))).toEqual({ tekst: '41 dni po terminie', ton: 'late' })
    expect(pigulka(k({ stan: 'po_terminie', najstarszaDni: 1 }))).toEqual({ tekst: '1 dzień po terminie', ton: 'late' })
    expect(pigulka(k({ stan: 'w_terminie', najblizszyTerminDni: 0 }))).toEqual({ tekst: 'termin dziś', ton: 'soon' })
    expect(pigulka(k({ stan: 'w_terminie', najblizszyTerminDni: 1 }))).toEqual({ tekst: 'termin jutro', ton: 'soon' })
    expect(pigulka(k({ stan: 'w_terminie', najblizszyTerminDni: 3 }))).toEqual({ tekst: 'termin za 3 dni', ton: 'soon' })
    expect(pigulka(k({ stan: 'w_terminie', najblizszyTerminDni: 4 }))).toEqual({ tekst: 'w terminie', ton: 'ok' })
    expect(pigulka(k({ stan: 'w_terminie', najblizszyTerminDni: null }))).toEqual({ tekst: 'w terminie', ton: 'ok' })
    expect(pigulka(k({ stan: 'nadplata' }))).toEqual({ tekst: 'nadpłata', ton: 'ok' })
    expect(pigulka(k({ stan: 'rozliczony' }))).toEqual({ tekst: 'rozliczony', ton: 'zero' })
  })
})

describe('etykietaStanu — stan dokumentu', () => {
  it('zapłacona, po terminie, dziś, jutro, za N dni; częściowo z dopiskiem', () => {
    expect(etykietaStanu({ kod: 'zaplacony', dni: 9, czesciowo: false })).toEqual({ tekst: 'zapłacona po 9 dniach', ton: 'zero' })
    expect(etykietaStanu({ kod: 'zaplacony', dni: 1, czesciowo: false }).tekst).toBe('zapłacona po 1 dniu')
    expect(etykietaStanu({ kod: 'zaplacony', dni: 0, czesciowo: false }).tekst).toBe('zapłacona od razu')
    expect(etykietaStanu({ kod: 'po_terminie', dni: 13, czesciowo: false })).toEqual({ tekst: '13 dni po terminie', ton: 'late' })
    expect(etykietaStanu({ kod: 'po_terminie', dni: 13, czesciowo: true }).tekst).toBe('13 dni po terminie · częściowo')
    expect(etykietaStanu({ kod: 'termin_dzis', dni: 0, czesciowo: false })).toEqual({ tekst: 'termin dziś', ton: 'soon' })
    expect(etykietaStanu({ kod: 'termin_jutro', dni: 1, czesciowo: false })).toEqual({ tekst: 'termin jutro', ton: 'soon' })
    expect(etykietaStanu({ kod: 'w_terminie', dni: 6, czesciowo: false })).toEqual({ tekst: 'za 6 dni', ton: 'ok' })
    expect(etykietaStanu({ kod: 'w_terminie', dni: 2, czesciowo: false }).ton).toBe('soon')
    expect(etykietaStanu({ kod: 'czeka_na_ceny', dni: 0, czesciowo: false })).toEqual({ tekst: 'czeka na ceny', ton: 'soon' })
  })
})

describe('sortuj', () => {
  it('po saldzie rosnąco — największy dłużnik pierwszy; malejąco odwrotnie; nie rusza wejścia', () => {
    const l = lista()
    expect(sortuj(l, 'saldo', 'asc').map(x => x.nazwa)).toEqual(['ROJPAK', 'TRUVA GASTRO', 'POLAT', 'BOSS KEBAB'])
    expect(sortuj(l, 'saldo', 'desc')[0].nazwa).toBe('BOSS KEBAB')
    expect(l[0].nazwa).toBe('ROJPAK')
  })
  it('po nazwie po polsku, po najstarszej zaległości', () => {
    expect(sortuj(lista(), 'nazwa', 'asc').map(x => x.nazwa)).toEqual(['BOSS KEBAB', 'POLAT', 'ROJPAK', 'TRUVA GASTRO'])
    expect(sortuj(lista(), 'najstarszaDni', 'desc')[0].nazwa).toBe('TRUVA GASTRO')
  })
})

describe('filtruj', () => {
  it('po terminie, nadpłaty, przypomnienia, waluta', () => {
    expect(filtruj(lista(), 'poTerminie', '').map(x => x.nazwa)).toEqual(['ROJPAK', 'TRUVA GASTRO'])
    expect(filtruj(lista(), 'nadplaty', '').map(x => x.nazwa)).toEqual(['BOSS KEBAB'])
    expect(filtruj(lista(), 'przypomnienia', '').map(x => x.nazwa)).toEqual(['ROJPAK'])
    expect(filtruj(lista(), 'EUR', '').map(x => x.nazwa)).toEqual(['ROJPAK'])
    expect(filtruj(lista(), 'PLN', '')).toHaveLength(3)
    expect(filtruj(lista(), 'wszyscy', '')).toHaveLength(4)
  })
  it('szukanie po nazwie i NIP bez wielkości liter; NIP także bez kresek', () => {
    expect(filtruj(lista(), 'wszyscy', 'roj').map(x => x.nazwa)).toEqual(['ROJPAK'])
    expect(filtruj(lista(), 'wszyscy', 'hu2534').map(x => x.nazwa)).toEqual(['ROJPAK'])
    expect(filtruj(lista(), 'wszyscy', '7531234567').map(x => x.nazwa)).toEqual(['TRUVA GASTRO'])
    expect(filtruj(lista(), 'poTerminie', 'boss')).toEqual([])
  })
})

describe('liczba — kwota wpisana po polsku', () => {
  it('spacje (także twarde), przecinek albo kropka', () => {
    expect(liczba('15 000,50')).toBe(15000.5)
    expect(liczba('15 000.5')).toBe(15000.5)
    expect(liczba('15 000,50')).toBe(15000.5)
    expect(liczba('15 000,50')).toBe(15000.5)
    expect(liczba('15.000,50')).toBe(15000.5)
    expect(liczba('-500')).toBe(-500)
    expect(liczba('−500')).toBe(-500)
    expect(liczba('1 234,56 €')).toBe(1234.56)
    expect(liczba('7280')).toBe(7280)
  })
  it('śmieci → NaN', () => {
    expect(Number.isNaN(liczba('abc'))).toBe(true)
    expect(Number.isNaN(liczba(''))).toBe(true)
    expect(Number.isNaN(liczba('12abc'))).toBe(true)
    expect(Number.isNaN(liczba('1,2,3'))).toBe(true)
  })
})

describe('kwotaSalda — znak salda', () => {
  it('minus typograficzny dla długu, „+” dla nadpłaty, zero bez znaku', () => {
    expect(kwotaSalda(-38447.7, 'EUR')).toBe('−38 447,70 €')
    expect(kwotaSalda(350, 'PLN')).toBe('+350,00 zł')
    expect(kwotaSalda(0, 'PLN')).toBe('0,00 zł')
    expect(kwotaSalda(0.001, 'PLN')).toBe('0,00 zł')
  })
})

describe('walutyPodsumowania — kafelek waluty tylko, gdy ma liczby', () => {
  it('waluta z samymi zerami znika', () => {
    expect(walutyPodsumowania(mapujListe(SUROWA_LISTA))).toEqual(['PLN', 'EUR'])
    const sameEur = mapujListe({ ...SUROWA_LISTA, podsumowanie: { ...SUROWA_LISTA.podsumowanie, PLN: { naleznosci: 0, po_terminie: 0, gotowka_wz: 0, nadplaty: 0 } } })
    expect(walutyPodsumowania(sameEur)).toEqual(['EUR'])
  })
})

describe('podpowiedzKlienta — kontrahent dla WZ bez kontrahenta', () => {
  const klienci = [{ id: 'c2', name: 'NAZAR SP. Z O.O.', displayName: 'NAZAR' }, { id: 'c1', name: 'ROJPAK', displayName: '' }]
  it('nabywca z WZ równy nazwie albo nazwie skróconej (bez wielkości liter i spacji na brzegach)', () => {
    expect(podpowiedzKlienta(' nazar ', klienci)).toBe('c2')
    expect(podpowiedzKlienta('Rojpak', klienci)).toBe('c1')
    expect(podpowiedzKlienta('NAZAR GASTRO', klienci)).toBe('')
    expect(podpowiedzKlienta('', klienci)).toBe('')
  })
})

describe('zakresOkresu / wOkresie — filtr okresu na karcie', () => {
  it('ten miesiąc, kwartał, rok, od–do; „wszystko” bez zakresu', () => {
    expect(zakresOkresu('wszystko', '2026-11-09')).toBeNull()
    expect(zakresOkresu('miesiac', '2026-11-09')).toEqual({ od: '2026-11-01', do: '2026-11-30' })
    expect(zakresOkresu('miesiac', '2026-02-10')).toEqual({ od: '2026-02-01', do: '2026-02-28' })
    expect(zakresOkresu('kwartal', '2026-11-09')).toEqual({ od: '2026-10-01', do: '2026-12-31' })
    expect(zakresOkresu('kwartal', '2026-05-31')).toEqual({ od: '2026-04-01', do: '2026-06-30' })
    expect(zakresOkresu('rok', '2026-11-09')).toEqual({ od: '2026-01-01', do: '2026-12-31' })
    expect(zakresOkresu('zakres', '2026-11-09', '2026-10-01', '')).toEqual({ od: '2026-10-01', do: '' })
    expect(zakresOkresu('zakres', '2026-11-09', '', '')).toBeNull()
  })
  it('granice włącznie, puste „do” = bez końca', () => {
    expect(wOkresie('2026-11-01', { od: '2026-11-01', do: '2026-11-30' })).toBe(true)
    expect(wOkresie('2026-10-31', { od: '2026-11-01', do: '2026-11-30' })).toBe(false)
    expect(wOkresie('2027-01-01', { od: '2026-11-01', do: '' })).toBe(true)
    expect(wOkresie('2026-01-01', null)).toBe(true)
  })
})

describe('rozliczyla — na co poszła wpłata', () => {
  const w = (o: Partial<Wplata>): Wplata => ({ ...mapujKarte(SUROWA_KARTA).wplaty[0], ...o })
  it('numery z kwotami po średniku, reszta jako nadpłata', () => {
    expect(rozliczyla(w({ przydzialy: [{ numer: 'FV 528/2026', kwota: 7280 }, { numer: 'FV 541/2026', kwota: 7720 }], reszta: 0 })))
      .toBe('FV 528/2026 7 280,00; FV 541/2026 7 720,00')
    expect(rozliczyla(w({ przydzialy: [], reszta: 250 }))).toBe('nadpłata 250,00')
    expect(rozliczyla(w({ przydzialy: [{ numer: 'WZ 21/10', kwota: 3000 }], reszta: 0.004 }))).toBe('WZ 21/10 3 000,00')
  })
})

describe('opisPlatnosci — domyślna forma i termin', () => {
  it('gotówka bez terminu — przy odbiorze; inaczej forma i dni', () => {
    expect(opisPlatnosci('gotowka', 0)).toBe('gotówka przy odbiorze')
    expect(opisPlatnosci('przelew', 7)).toBe('przelew, 7 dni')
    expect(opisPlatnosci('przelew', 1)).toBe('przelew, 1 dzień')
    expect(opisPlatnosci('przelew', 0)).toBe('przelew od razu')
  })
})

describe('uporzadkujDziennik — przypomnienia na górze', () => {
  it('nieodhaczone przypomnienia od najwcześniejszego, zaległe oznaczone, reszta jak z serwera', () => {
    const d = uporzadkujDziennik(mapujKarte(SUROWA_KARTA_PELNA).dziennik, '2026-11-09')
    expect(d.map(x => [x.id, x.zalegle])).toEqual([['j3', true], ['j1', false], ['j2', false]])
    const odhaczony = uporzadkujDziennik([{ ...d[0], odhaczono: '2026-11-06T10:00:00' }, d[2]], '2026-11-09')
    expect(odhaczony.map(x => [x.id, x.zalegle])).toEqual([['j3', false], ['j2', false]])
  })
})

describe('mapujSzczegoly — dokument z pokryciem i historią', () => {
  it('nie gubi pól', () => {
    const s = mapujSzczegoly(SUROWY_DOKUMENT)
    expect(s.numer).toBe('FV 512/2026')
    expect(s.zrodlo).toBe('reczna')
    expect(s.pokrycie).toEqual([{ data: '2026-10-20', forma: 'przelew', kwota: 17325, uwagi: 'tytuł' }])
    expect(s.historia).toEqual([{ akcja: 'termin', opis: 'FV 512/2026: termin płatności zmieniona z 2026-10-22 na 2026-10-25',
      powod: 'ustalenie z klientem', kto: 'Anna', kiedy: '2026-10-19T09:30:00' }])
    expect(mapujSzczegoly(null).pokrycie).toEqual([])
  })
})

describe('symbolWaluty — waluta w nagłówku kolumny', () => {
  it('€ i zł, nieznana — kod', () => {
    expect(symbolWaluty('EUR')).toBe('€')
    expect(symbolWaluty('PLN')).toBe('zł')
    expect(symbolWaluty('CHF')).toBe('CHF')
  })
})
