import { describe, it, expect } from 'vitest'
import {
  etykietaStanu, filtruj, kwotaSalda, liczba, mapujKarte, mapujListe, mapujSzczegoly, opisPlatnosci, pigulka, podpowiedzKlienta,
  czesciRozliczenia, numerZSeria, rozliczyla, sortuj, symbolWaluty, uporzadkujDziennik, walutyPodsumowania,
  dodajDni, mapujPodglad, opisRozliczenia, poprzedniMiesiac, dni, doGroszy, formaDomyslna, FORMY, mapujHistorieZmian,
  zakresObrotu, opisOkresu, bladZakresu, kilogramy, kandydaciDoDodania, bledyZaleglego, pustyZalegly, ileDokumentow,
  kafelekKpi, podpisKursu,
  type WierszZaleglego,
  type Kontrahent, type Wplata,
} from './model'
import { SUROWA_KARTA, SUROWA_KARTA_PELNA, SUROWA_LISTA, SUROWA_LISTA_Z_KURSEM, SUROWY_DOKUMENT, SUROWY_PODGLAD } from './daneTestowe.fixture'

const lista = () => mapujListe(SUROWA_LISTA).kontrahenci
const k = (o: Partial<Kontrahent>): Kontrahent => ({ ...lista()[0], ...o })

describe('mapujListe — nie gubi pól', () => {
  it('snake_case → camelCase dla wiersza, podsumowania, WZ bez kontrahenta', () => {
    const l = mapujListe(SUROWA_LISTA)
    const r = l.kontrahenci[0]
    expect(r).toEqual({ id: 'c1', nazwa: 'RONDO GRILL', nip: 'HU99000001', waluta: 'EUR', saldoWz: -8409.5, saldoFv: -30038.2, saldo: -38447.7,
      poTerminie: 15689.5, najstarszaDni: 13, najblizszyTerminDni: 1, stan: 'po_terminie', przypomnienie: true, innaWaluta: 0,
      obrot: 45200.4, kg: 5230, fvBezKwoty: 2 })
    expect(r.saldoWz).toBe(-8409.5)
    expect(r.najstarszaDni).toBe(13)
    expect(l.kontrahenci[1].najblizszyTerminDni).toBeNull()
    expect(l.start).toBe('2026-11-09')
    expect(l.podsumowanie.EUR).toEqual({ naleznosci: 38447.7, poTerminie: 15689.5, gotowkaWz: 8409.5, nadplaty: 0, obrot: 45200.4, kg: 5230 })
    expect(l.wylaczeni).toEqual([{ id: 'c7', nazwa: 'KLIENT PRYWATNY TEST', nip: '', waluta: 'PLN' }])
    expect(l.bezKontrahenta).toEqual([{ id: 'd1', numer: 'WZ 07/11', data: '2026-11-07', kwota: 1250.4, waluta: 'PLN', nabywca: 'NABYWCA TESTOWY' }])
    expect(l.innaWaluta).toBe(2)
    expect(mapujListe({ ...SUROWA_LISTA, kontrahenci: [{ ...SUROWA_LISTA.kontrahenci[0], inna_waluta: 3, stan: 'sprawdz_walute' }] })
      .kontrahenci[0]).toMatchObject({ innaWaluta: 3, stan: 'sprawdz_walute' })
  })
  it('pusta / uszkodzona odpowiedź → puste listy zamiast wyjątku', () => {
    expect(mapujListe(null)).toEqual({ start: '', podsumowanie: {}, kontrahenci: [], bezKontrahenta: [], innaWaluta: 0, wylaczeni: [],
      przeliczenie: { kurs: null, naleznosci: null, poTerminie: null, obrot: null, nadplaty: null } })
  })
})

describe('mapujKarte — nie gubi pól', () => {
  it('klient, salda, otwarcia, dokumenty, wpłaty, ostrzeżenia, dziennik', () => {
    const c = mapujKarte(SUROWA_KARTA)
    expect(c.klient).toEqual({ id: 'c1', nazwa: 'RONDO GRILL', nip: 'HU99000001', waluta: 'EUR', terminWz: 0, terminFv: 7,
      formaWz: 'gotowka', formaFv: 'przelew', notatka: 'płaci w piątki', walutaPodpowiedz: null, wylaczony: false })
    expect(c.start).toBe('2026-10-01')
    expect(c.saldo).toEqual({ wz: -8409.5, fv: -30038.2, lacznie: -38447.7, poTerminieWz: 8409.5, poTerminieFv: 7280,
      najstarszaDniWz: 13, najstarszaDniFv: 6 })
    expect(c.otwarcia).toEqual({ wz: { kwota: -6300, zalegleOd: '2026-09-20', uwagi: 'z Excela' }, fv: null })
    expect(c.dokumenty.wz[0]).toEqual({ id: 'w21', numer: 'WZ 21/10', data: '2026-10-27', kwota: 6120, zaplacono: 3000, zostalo: 3120,
      termin: '2026-10-27', forma: 'gotowka', uwagi: '', zrodlo: 'mes_wz', otwarcie: false,
      stan: { kod: 'po_terminie', dni: 13, czesciowo: true }, zamkniety: null, brakVat: true, korekta: false, rozliczyla: [],
      kg: null, nieLicz: false, nieLiczPowod: '', bezKwoty: false, zalegly: false })
    expect(c.dokumenty.fv[0].zamkniety).toBe('2026-10-20')
    expect(c.wplaty[0]).toEqual({ id: 'p1', ksiega: 'fv', forma: 'przelew', kwota: 17325, data: '2026-10-20', uwagi: 'tytuł',
      utworzyl: 'biuro', dokumentId: null, przydzialy: [{ numer: 'FV 512/2026', kwota: 17325 }], reszta: 0 })
    expect(c.czekaNaCeny).toEqual([{ id: 'w30', numer: 'WZ 30/11', data: '2026-11-09' }])
    expect(c.innaWaluta).toEqual([{ id: 'f9', numer: 'FV 9/2026', data: '2026-11-02', kwota: 500, waluta: 'PLN', rodzaj: 'dokument' }])
    expect(c.dziennik).toEqual([{ id: 'j1', tresc: 'obiecał przelew', przypomnij: '2026-11-12', odhaczono: null, kto: 'biuro',
      kiedy: '2026-11-09T10:00:00' }])
    expect(c.rozliczeniaOtwarte).toBe(true)
    expect(mapujKarte({ ...SUROWA_KARTA, rozliczenia_otwarte: false }).rozliczeniaOtwarte).toBe(false)
  })
  it('karta: wyłączony klient, obrót, kg, FV bez kwoty; dokumenty: kg, nieliczona WZ, FV bez kwoty, zaległy vs zbiorcze saldo otwarcia', () => {
    const c = mapujKarte({ ...SUROWA_KARTA, klient: { ...SUROWA_KARTA.klient, wylaczony: true }, obrot: 21000.5, kg: 1450.25, fv_bez_kwoty: 2,
      dokumenty: {
        wz: [
          { ...SUROWA_KARTA.dokumenty.wz[0], id: 'n1', kg: 120.5, nie_licz: true, nie_licz_powod: 'towar zwrotny', stan: { kod: 'nie_licz', dni: 0, czesciowo: false } },
          { ...SUROWA_KARTA.dokumenty.wz[0], id: 'o1', zrodlo: 'otwarcie', otwarcie: false },
          { ...SUROWA_KARTA.dokumenty.wz[0], id: 'otwarcie-wz', zrodlo: 'otwarcie', otwarcie: true },
        ],
        fv: [{ ...SUROWA_KARTA.dokumenty.fv[0], id: 'k1', kwota: null, zrodlo: 'kurs', kg: 300, stan: { kod: 'czeka_na_kwote', dni: 0, czesciowo: false } }],
      } })
    expect(c.klient.wylaczony).toBe(true)
    expect([c.obrot, c.kg, c.fvBezKwoty]).toEqual([21000.5, 1450.25, 2])
    expect(c.dokumenty.wz[0]).toMatchObject({ kg: 120.5, nieLicz: true, nieLiczPowod: 'towar zwrotny', zalegly: false })
    expect(c.dokumenty.wz[1].zalegly).toBe(true)
    expect(c.dokumenty.wz[2]).toMatchObject({ otwarcie: true, zalegly: false })
    expect(c.dokumenty.fv[0]).toMatchObject({ bezKwoty: true, kwota: 0, kg: 300 })
    expect(etykietaStanu(c.dokumenty.fv[0].stan)).toEqual({ tekst: 'czeka na kwotę', ton: 'soon' })
    expect(etykietaStanu(c.dokumenty.wz[0].stan)).toEqual({ tekst: 'nie liczona', ton: 'zero' })
  })
  it('faktura korygująca: ujemna kwota, znacznik korekty i co zmniejszyła', () => {
    const c = mapujKarte({ ...SUROWA_KARTA, dokumenty: { wz: [], fv: [{ ...SUROWA_KARTA.dokumenty.fv[0], id: 'k1', numer: 'FVK 1/2026', kwota: -200,
      zaplacono: 0, zostalo: 0, stan: { kod: 'korekta', dni: 0, czesciowo: false }, korekta: true,
      rozliczyla: [{ numer: 'FV 512/2026', kwota: 200 }] }] } })
    expect(c.dokumenty.fv[0]).toMatchObject({ kwota: -200, korekta: true, rozliczyla: [{ numer: 'FV 512/2026', kwota: 200 }] })
  })
})

describe('mapujHistorieZmian — historia zmian klienta', () => {
  it('wpisy z serwera, usunięcia oznaczone; pusta odpowiedź → pusta lista', () => {
    const h = mapujHistorieZmian({ wpisy: [{ id: 'h1', kiedy: '2026-11-10T09:15:00+00:00', kto: 'Szef', obiekt: 'wplata', akcja: 'usunieto',
      czego: 'Wpłata 300,00 PLN z 10.11.2026', opis: 'usunięto wpłatę 300,00 PLN', powod: 'wpisana dwa razy', usuniete: true }], wiecej: true })
    expect(h).toEqual({ wpisy: [{ id: 'h1', kiedy: '2026-11-10T09:15:00+00:00', kto: 'Szef', obiekt: 'wplata', akcja: 'usunieto',
      czego: 'Wpłata 300,00 PLN z 10.11.2026', opis: 'usunięto wpłatę 300,00 PLN', powod: 'wpisana dwa razy', usuniete: true }], wiecej: true })
    expect(mapujHistorieZmian(null)).toEqual({ wpisy: [], wiecej: false })
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
    // Klient zagraniczny z domyślnym PLN: same pozycje w EUR — nie „rozliczony”.
    expect(pigulka(k({ stan: 'sprawdz_walute', innaWaluta: 2 }))).toEqual({ tekst: 'sprawdź walutę', ton: 'soon' })
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
    expect(sortuj(l, 'saldo', 'asc').map(x => x.nazwa)).toEqual(['RONDO GRILL', 'TESTOWA GASTRONOMIA', 'PUNKT WZOROWY', 'BAR PRZYKŁADOWY'])
    expect(sortuj(l, 'saldo', 'desc')[0].nazwa).toBe('BAR PRZYKŁADOWY')
    expect(l[0].nazwa).toBe('RONDO GRILL')
  })
  it('po nazwie po polsku, po najstarszej zaległości', () => {
    expect(sortuj(lista(), 'nazwa', 'asc').map(x => x.nazwa)).toEqual(['BAR PRZYKŁADOWY', 'PUNKT WZOROWY', 'RONDO GRILL', 'TESTOWA GASTRONOMIA'])
    expect(sortuj(lista(), 'najstarszaDni', 'desc')[0].nazwa).toBe('TESTOWA GASTRONOMIA')
  })
})

describe('filtruj', () => {
  it('po terminie, nadpłaty, przypomnienia, waluta', () => {
    expect(filtruj(lista(), 'poTerminie', '').map(x => x.nazwa)).toEqual(['RONDO GRILL', 'TESTOWA GASTRONOMIA'])
    expect(filtruj(lista(), 'nadplaty', '').map(x => x.nazwa)).toEqual(['BAR PRZYKŁADOWY'])
    expect(filtruj(lista(), 'przypomnienia', '').map(x => x.nazwa)).toEqual(['RONDO GRILL'])
    expect(filtruj(lista(), 'EUR', '').map(x => x.nazwa)).toEqual(['RONDO GRILL'])
    expect(filtruj(lista(), 'PLN', '')).toHaveLength(3)
    expect(filtruj(lista(), 'wszyscy', '')).toHaveLength(4)
  })
  it('szukanie po nazwie i NIP bez wielkości liter; NIP także bez kresek', () => {
    expect(filtruj(lista(), 'wszyscy', 'rondo').map(x => x.nazwa)).toEqual(['RONDO GRILL'])
    expect(filtruj(lista(), 'wszyscy', 'hu9900').map(x => x.nazwa)).toEqual(['RONDO GRILL'])
    expect(filtruj(lista(), 'wszyscy', '0001112233').map(x => x.nazwa)).toEqual(['TESTOWA GASTRONOMIA'])
    expect(filtruj(lista(), 'poTerminie', 'bar')).toEqual([])
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

describe('przeliczenie na złotówki (D14)', () => {
  it('mapuje kurs NBP i kwoty *_pln; podsumowanie zostaje tylko z walutami', () => {
    const l = mapujListe(SUROWA_LISTA_Z_KURSEM)
    expect(Object.keys(l.podsumowanie)).toEqual(['PLN', 'EUR'])
    expect(l.przeliczenie).toEqual({ kurs: { kurs: 4.2512, tabela: '221/A/NBP/2026', data: '2026-11-12' },
      naleznosci: 181148.86, poTerminie: 81999.2, obrot: 213155.94, nadplaty: 350 })
  })
  it('brak kursu → null (nie zero)', () => {
    expect(mapujListe(SUROWA_LISTA).przeliczenie).toEqual({ kurs: null, naleznosci: null, poTerminie: null, obrot: null, nadplaty: null })
  })
  it('podpis kursu: kurs z 4 miejscami po przecinku, numer tabeli i data po polsku', () => {
    expect(podpisKursu({ kurs: 4.25, tabela: '221/A/NBP/2026', data: '2026-11-12' })).toBe('kurs NBP 4,2500 · tabela 221/A/NBP/2026 z 12.11.2026')
    expect(podpisKursu({ kurs: 4.2512, tabela: '', data: '2026-11-12' })).toBe('kurs NBP 4,2512 z 12.11.2026')
  })
  it('kafelekKpi: dwie waluty i kurs → ≈ zł z rozbiciem; bez kursu → osobno z flagą; jedna waluta → sama', () => {
    const z = mapujListe(SUROWA_LISTA_Z_KURSEM)
    expect(kafelekKpi(z, 'naleznosci', ['PLN', 'EUR'])).toEqual({ kwoty: ['≈ 181 148,86 zł'], wZlotowkach: true,
      rozbicie: '17 700,00 zł · 38 447,70 €', brakKursu: false })
    expect(kafelekKpi(mapujListe(SUROWA_LISTA), 'naleznosci', ['PLN', 'EUR'])).toEqual({ kwoty: ['17 700,00 zł', '38 447,70 €'],
      wZlotowkach: false, rozbicie: null, brakKursu: true })
    expect(kafelekKpi(z, 'nadplaty', ['PLN', 'EUR'])).toEqual({ kwoty: ['350,00 zł'], wZlotowkach: false, rozbicie: null, brakKursu: false })
    // same zera — kwota zero w pierwszej walucie
    const zera = mapujListe({ ...SUROWA_LISTA, podsumowanie: { EUR: { naleznosci: 0 } } })
    expect(kafelekKpi(zera, 'naleznosci', ['EUR']).kwoty).toEqual(['0,00 €'])
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
  const klienci = [{ id: 'c2', name: 'NABYWCA TESTOWY SP. Z O.O.', displayName: 'NABYWCA TESTOWY' }, { id: 'c1', name: 'RONDO GRILL', displayName: '' }]
  it('nabywca z WZ równy nazwie albo nazwie skróconej (bez wielkości liter i spacji na brzegach)', () => {
    expect(podpowiedzKlienta(' nabywca testowy ', klienci)).toBe('c2')
    expect(podpowiedzKlienta('Rondo Grill', klienci)).toBe('c1')
    expect(podpowiedzKlienta('NABYWCA TESTOWY GASTRO', klienci)).toBe('')
    expect(podpowiedzKlienta('', klienci)).toBe('')
  })
})

describe('rozliczyla — na co poszła wpłata', () => {
  const w = (o: Partial<Wplata>): Wplata => ({ ...mapujKarte(SUROWA_KARTA).wplaty[0], ...o })
  it('numer z serią, dwukropek i kwota z walutą — po średniku; reszta jako nadpłata', () => {
    expect(rozliczyla(w({ ksiega: 'fv', przydzialy: [{ numer: 'FV 528/2026', kwota: 7280 }, { numer: 'FV 541/2026', kwota: 7720 }], reszta: 0 }), 'EUR'))
      .toBe('FV 528/2026: 7 280,00 €; FV 541/2026: 7 720,00 €')
    expect(rozliczyla(w({ przydzialy: [], reszta: 250 }), 'PLN')).toBe('nadpłata: 250,00 zł')
    expect(rozliczyla(w({ ksiega: 'wz', przydzialy: [{ numer: 'WZ 21/10', kwota: 3000 }], reszta: 0.004 }), 'EUR')).toBe('WZ 21/10: 3 000,00 €')
  })
  it('goły numer faktury dostaje serię — „512 17 325,00” nie czyta się jak jedna kwota', () => {
    expect(rozliczyla(w({ ksiega: 'fv', przydzialy: [{ numer: '512', kwota: 17325 }], reszta: 0 }), 'EUR')).toBe('FV 512: 17 325,00 €')
    expect(rozliczyla(w({ ksiega: 'wz', przydzialy: [{ numer: 'Saldo otwarcia', kwota: 1250 }, { numer: '14/10', kwota: 6175 }], reszta: 0 }), 'EUR'))
      .toBe('Saldo otwarcia: 1 250,00 €; WZ 14/10: 6 175,00 €')
  })
  it('czesciRozliczenia — te same pozycje osobno (do wierszy bez łamania w środku kwoty)', () => {
    expect(czesciRozliczenia(w({ ksiega: 'fv', przydzialy: [{ numer: '528', kwota: 7280 }], reszta: 250 }), 'EUR'))
      .toEqual(['FV 528: 7 280,00 €', 'nadpłata: 250,00 €'])
  })
  it('numerZSeria — seria tylko gdy jej brak (bez względu na wielkość liter)', () => {
    expect(numerZSeria('528', 'fv')).toBe('FV 528')
    expect(numerZSeria('fv/12/2026', 'fv')).toBe('fv/12/2026')
    expect(numerZSeria('WZ/31/10/26', 'wz')).toBe('WZ/31/10/26')
    expect(numerZSeria('Saldo otwarcia', 'fv')).toBe('Saldo otwarcia')
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
    expect(s.pokrycie).toEqual([{ data: '2026-10-20', forma: 'przelew', kwota: 17325, kwotaWplaty: 17325, uwagi: 'tytuł', kto: '', rodzaj: 'wplata' }])
    expect(s.ksiega).toBe('fv')
    const p = mapujSzczegoly({ ...SUROWY_DOKUMENT, ksiega: 'wz', kg: 1250.5, pokrycie: [{ data: '2026-11-05', forma: 'gotowka', kwota: 300,
      kwota_wplaty: 1000, uwagi: '', kto: 'Anna', rodzaj: 'wplata', wplata_id: 'p9' }] })
    expect(p.ksiega).toBe('wz')
    expect(p.kg).toBe(1250.5)
    expect(p.pokrycie[0]).toEqual({ data: '2026-11-05', forma: 'gotowka', kwota: 300, kwotaWplaty: 1000, uwagi: '', kto: 'Anna', rodzaj: 'wplata' })
    expect(s.historia).toEqual([{ akcja: 'termin', opis: 'FV 512/2026: termin płatności 22.10.2026 → 25.10.2026',
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

describe('mapujPodglad / opisRozliczenia — co rozliczy wpłata', () => {
  it('nie gubi pól podglądu', () => {
    const p = mapujPodglad(SUROWY_PODGLAD)
    expect(p.przydzialy[1]).toEqual({ dokumentId: 'f541', numer: 'FV 541/2026', kwota: 7720, zostaloPrzed: 12342.2, zostaloPo: 4622.2, zamyka: false })
    expect(p.nadwyzka).toBe(0)
    expect(mapujPodglad(null)).toEqual({ przydzialy: [], nadwyzka: 0 })
  })
  it('zamknięte numery, „część” dla niedopłaconych, nadpłata z plusem', () => {
    expect(opisRozliczenia(mapujPodglad(SUROWY_PODGLAD), 'EUR')).toBe('rozliczyła FV 528/2026 i część FV 541/2026')
    const trzy = mapujPodglad({ ...SUROWY_PODGLAD, przydzialy: [
      { ...SUROWY_PODGLAD.przydzialy[0] }, { ...SUROWY_PODGLAD.przydzialy[1], zamyka: true, zostalo_po: 0 },
      { dokument_id: 'f553', numer: 'FV 553/2026', kwota: 10416, zostalo_przed: 10416, zostalo_po: 0, zamyka: true }], nadwyzka: 250 })
    expect(opisRozliczenia(trzy, 'EUR')).toBe('rozliczyła FV 528/2026, FV 541/2026 i FV 553/2026 — nadpłata +250,00 € zostaje na saldzie')
    expect(opisRozliczenia({ przydzialy: [], nadwyzka: 100 }, 'PLN')).toBe('nic nie było do zapłaty — +100,00 zł zostaje jako nadpłata')
    expect(opisRozliczenia({ przydzialy: [], nadwyzka: 0 }, 'PLN')).toBe('')
    const gole = { przydzialy: [{ ...mapujPodglad(SUROWY_PODGLAD).przydzialy[0], numer: '528' }, { ...mapujPodglad(SUROWY_PODGLAD).przydzialy[1], numer: '541' }], nadwyzka: 0 }
    expect(opisRozliczenia(gole, 'EUR', 'fv')).toBe('rozliczyła FV 528 i część FV 541')
  })
})

describe('dodajDni / poprzedniMiesiac — daty w oknach', () => {
  it('termin = data + dni, przez koniec miesiąca i roku', () => {
    expect(dodajDni('2026-11-09', 7)).toBe('2026-11-16')
    expect(dodajDni('2026-12-28', 7)).toBe('2027-01-04')
    expect(dodajDni('2026-11-09', 0)).toBe('2026-11-09')
    expect(dodajDni('', 7)).toBe('')
  })
  it('poprzedni miesiąc — pełny, także przez nowy rok', () => {
    expect(poprzedniMiesiac('2026-11-09')).toEqual({ od: '2026-10-01', do: '2026-10-31' })
    expect(poprzedniMiesiac('2027-01-15')).toEqual({ od: '2026-12-01', do: '2026-12-31' })
    expect(poprzedniMiesiac('2026-03-31')).toEqual({ od: '2026-02-01', do: '2026-02-28' })
  })
})

describe('drobne wspólne: dni, grosze, forma domyślna', () => {
  it('dni po polsku', () => {
    expect(dni(1)).toBe('1 dzień')
    expect(dni(7)).toBe('7 dni')
  })
  it('zaokrąglenie do groszy', () => {
    expect(doGroszy(15000.505)).toBe(15000.51)
    expect(doGroszy(-0.004)).toBe(0)
    expect(doGroszy(-1.005)).toBe(-1.01)
    expect(doGroszy(1.005)).toBe(1.01)
  })
  it('forma z ustawień albo domyślna księgi (WZ gotówka, FV przelew)', () => {
    expect(formaDomyslna('przelew', 'wz')).toBe('przelew')
    expect(formaDomyslna('', 'wz')).toBe('gotowka')
    expect(formaDomyslna('karta', 'fv')).toBe('przelew')
    expect(FORMY.map(f => f[1])).toEqual(['Gotówka', 'Przelew'])
  })
})

describe('okres obrotu i kg — lista i karta', () => {
  const dzis = '2026-11-12'
  it('ten miesiąc, poprzedni (także przez nowy rok), ten rok, od początku (domyślne serwera), od–do', () => {
    expect(zakresObrotu({ okres: 'miesiac', od: '', do: '' }, dzis)).toEqual({ od: '2026-11-01', do: '2026-11-30' })
    expect(zakresObrotu({ okres: 'poprzedni', od: '', do: '' }, dzis)).toEqual({ od: '2026-10-01', do: '2026-10-31' })
    expect(zakresObrotu({ okres: 'poprzedni', od: '', do: '' }, '2027-01-05')).toEqual({ od: '2026-12-01', do: '2026-12-31' })
    expect(zakresObrotu({ okres: 'rok', od: '', do: '' }, dzis)).toEqual({ od: '2026-01-01', do: '2026-12-31' })
    expect(zakresObrotu({ okres: 'odPoczatku', od: '2026-01-01', do: '' }, dzis)).toEqual({ od: '', do: '' })
    expect(zakresObrotu({ okres: 'zakres', od: '2026-11-03', do: '2026-11-09' }, dzis)).toEqual({ od: '2026-11-03', do: '2026-11-09' })
  })
  it('opis pokazuje daty wybrane przez użytkownika, nie obcięte przez serwer', () => {
    expect(opisOkresu({ okres: 'poprzedni', od: '', do: '' }, dzis, '2026-11-12')).toBe('01.10–31.10.2026')
    expect(opisOkresu({ okres: 'odPoczatku', od: '', do: '' }, dzis, '2026-11-12')).toBe('od 12.11.2026')
    expect(opisOkresu({ okres: 'zakres', od: '2025-12-20', do: '2026-01-10' }, dzis, '2026-11-12')).toBe('20.12.2025–10.01.2026')
  })
  it('błąd własnego zakresu po polsku', () => {
    expect(bladZakresu({ okres: 'miesiac', od: '', do: '' })).toBeNull()
    expect(bladZakresu({ okres: 'zakres', od: '2026-11-01', do: '' })).toBe('Wpisz obie daty')
    expect(bladZakresu({ okres: 'zakres', od: '2026-11-10', do: '2026-11-01' })).toMatch(/wcześniejsza/)
    expect(bladZakresu({ okres: 'zakres', od: '2026-11-01', do: '2026-11-01' })).toBeNull()
  })
  it('kilogramy: spacja tysięcy, przecinek, bez zbędnych zer', () => {
    expect(kilogramy(1234.5)).toBe('1 234,5 kg')
    expect(kilogramy(5230)).toBe('5 230 kg')
    expect(kilogramy(0)).toBe('0 kg')
    expect(kilogramy(12.345)).toBe('12,3 kg')
    expect(kilogramy(-40)).toBe('−40 kg')
  })
  it('walutyPodsumowania: waluta z samym obrotem albo kg też dostaje kafelek', () => {
    const zero = { naleznosci: 0, poTerminie: 0, gotowkaWz: 0, nadplaty: 0, obrot: 0, kg: 0 }
    const l = { ...mapujListe(SUROWA_LISTA), podsumowanie: { PLN: { ...zero, kg: 12.5 }, EUR: zero } }
    expect(walutyPodsumowania(l)).toEqual(['PLN'])
  })
  it('kandydaciDoDodania: bez widocznych na liście, wyłączonych i nieaktywnych', () => {
    const klienci = [{ id: 'c1' }, { id: 'c7' }, { id: 'c8' }, { id: 'c9', active: false }]
    expect(kandydaciDoDodania(klienci, [{ id: 'c1' }], [{ id: 'c7' }]).map(c => c.id)).toEqual(['c8'])
  })
})

describe('zaległe dokumenty sprzed startu — walidacja wiersza (D13)', () => {
  const w = (o: Partial<WierszZaleglego>): WierszZaleglego => ({
    klucz: 'z1', ksiega: 'fv', numer: 'FV 101/2026', data: '2026-10-15', termin: '2026-10-22', terminReczny: false, kwota: '1 250,50', uwagi: '', ...o,
  })
  it('poprawny wiersz bez błędów; pusty wiersz pomijany', () => {
    expect(bledyZaleglego(w({}), '2026-11-12', new Set())).toEqual({})
    expect(pustyZalegly(w({ numer: '', kwota: '', uwagi: '' }))).toBe(true)
    expect(pustyZalegly(w({ numer: '', kwota: '', uwagi: 'x' }))).toBe(false)
  })
  it('numer wymagany i unikalny w księdze, data przed startem, termin ≥ data, kwota > 0', () => {
    const b = bledyZaleglego(w({ numer: ' ', data: '2026-11-12', termin: '2026-11-01', kwota: '-5' }), '2026-11-12', new Set())
    expect(b).toEqual({ numer: 'Wpisz numer dokumentu', data: 'Data musi być przed startem rozliczeń (12.11.2026)', termin: 'Termin przed datą wystawienia', kwota: 'Kwota większa od zera' })
    expect(bledyZaleglego(w({ numer: 'fv  101/2026' }), '2026-11-12', new Set(['FV 101/2026'])).numer).toBe('Numer fv  101/2026 jest już w księdze faktur')
    expect(bledyZaleglego(w({ kwota: '' }), '2026-11-12', new Set()).kwota).toBe('Wpisz kwotę do zapłaty')
    expect(bledyZaleglego(w({ data: '' }), '2026-11-12', new Set()).data).toBe('Wpisz datę wystawienia')
  })
  it('ileDokumentow — odmiana', () => {
    expect([1, 2, 5, 12, 22].map(ileDokumentow)).toEqual(['1 dokument', '2 dokumenty', '5 dokumentów', '12 dokumentów', '22 dokumenty'])
  })
})
