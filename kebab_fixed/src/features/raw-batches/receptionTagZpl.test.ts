import { describe, it, expect } from 'vitest'

import { LABEL_H_MM, LABEL_W_MM, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { LOGO_DOTS_W } from '@/lib/labelLogo'
import {
  LOGO_H_MM, opisLotu, receptionTagZpl, receptionTagsStreamZpl, shortenSupplier,
  splitSupplierLots,
} from './receptionTagZpl'

const BASE = {
  receptionNo: '12/08/2026',
  supplierName: 'KOKO Sp. z o.o.',
  batchNo: '471',
  netKg: 540,
  containers: 36,
  containerKg: 15,
  palletIndex: 3,
  palletCount: 6,
  batchKg: 3000,
  slaughterDate: '2026-08-04',
  expiryDate: '2026-08-18',
  receivedDate: '2026-08-12',
}

describe('shortenSupplier — nazwa dostawcy na 50 mm taśmy', () => {
  it('zdejmuje formę prawną, która nie mówi nic operatorowi', () => {
    expect(shortenSupplier('KOKO Sp. z o.o.')).toBe('KOKO')
    expect(shortenSupplier('Drobimex Spółka z ograniczoną odpowiedzialnością')).toBe('Drobimex')
  })

  it('długą nazwę przycina, zamiast pozwolić drukarce uciąć ją w losowym miejscu', () => {
    expect(shortenSupplier('Zakład Przetwórstwa Drobiowego Wielkopolska').length).toBeLessThanOrEqual(22)
  })

  it('pusta nazwa zostaje pusta — zawieszka nie wymyśla dostawcy', () => {
    expect(shortenSupplier('')).toBe('')
  })
})

describe('receptionTagZpl — zawieszka palety przyjęcia 50×80', () => {
  it('trzyma format taśmy hali: 50 mm w poprzek, 80 mm wzdłuż', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).toContain(`^PW${mmToDots(LABEL_W_MM)}`)
    expect(zpl).toContain(`^LL${mmToDots(LABEL_H_MM)}`)
  })

  it('otwiera i zamyka etykietę, ustawia UTF-8 i etykiety wykrawane', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl.startsWith('^XA')).toBe(true)
    expect(zpl.trimEnd().endsWith('^XZ')).toBe(true)
    expect(zpl).toContain('^CI28')  // polskie znaki: Ubój, Ważność
    expect(zpl).toContain('^MNY')   // szukaj przerwy między etykietami
    expect(zpl).toContain('^LH0,0') // zeruj przesunięcie z ustawień drukarki
  })

  it('drukuje komplet pól uzgodniony z biurem', () => {
    const zpl = receptionTagZpl(BASE)

    expect(zpl).toContain('12/08/2026')   // nr przyjęcia
    expect(zpl).toContain('KOKO')         // dostawca
    expect(zpl).toContain('471')          // nr porządkowy
    expect(zpl).toContain('540 kg')       // waga netto palety
    expect(zpl).toContain('36 poj.')      // ilość pojemników
    expect(zpl).toContain('04.08.2026')   // data uboju
    expect(zpl).toContain('18.08.2026')   // data przydatności
    expect(zpl).toContain('12.08.2026')   // data przyjęcia
  })

  it('pokazuje, która to paleta z ilu i ile waży cała partia', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).toContain('PALETA 3 / 6')
    expect(zpl).toContain('3000 kg')
  })

  it('dopisuje kaliber przy pojemnikach, gdy jest znany', () => {
    expect(receptionTagZpl(BASE)).toContain('36 poj. x 15 kg')
  })

  it('surowiec niekalibrowany pokazuje same pojemniki, bez zmyślonego kalibru', () => {
    const zpl = receptionTagZpl({ ...BASE, containerKg: null })
    expect(zpl).toContain('36 poj.')
    expect(zpl).not.toContain(' x  kg')
    expect(zpl).not.toContain('null')
  })

  it('paletę niepełną podpisuje, żeby nikt jej nie liczył jako pełnej', () => {
    const zpl = receptionTagZpl({ ...BASE, palletIndex: 6, containers: 20, netKg: 300, full: false })
    expect(zpl).toContain('NIEPEŁNA')
  })

  it('znaki sterujące z nazwy dostawcy nie rozbijają komend ZPL', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierName: 'A^B~C' })
    expect(zpl).not.toContain('^B~C')
  })

  it('kopie idą jednym ^PQ, a nie n razy tym samym poleceniem', () => {
    const zpl = receptionTagZpl(BASE, { copies: 2 })
    expect(zpl).toContain('^PQ2,0,0,Y')
    expect(zpl.match(/\^XA/g)).toHaveLength(1)
  })
})

/**
 * Drukarka nie zawija tekstu — wiersz szerszy od pola zadruku po prostu
 * znika na taśmie (hala, 14.08.2026: z „KOŚCI" zostawało „ŚCI"). Dlatego
 * mierzymy KAŻDY wiersz najgorszymi danymi, jakie mogą przyjść z przyjęcia.
 */
describe('receptionTagZpl — nic nie wychodzi poza pole zadruku', () => {
  /** Font 0 jest proporcjonalny; 0,6 wysokości na znak to bezpieczna górna
   *  granica dla wielkich liter (Zebra Programming Guide). */
  const SZEROKOSC_ZNAKU = 0.6
  const POLE_MM = 44   // 50 mm taśmy minus 2 × 3 mm marginesu

  function najszerszyWiersz(zpl: string): { text: string; mm: number } {
    const re = /\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS/g
    let m: RegExpExecArray | null
    let max = { text: '', mm: 0 }
    while ((m = re.exec(zpl))) {
      const fontMm = (Number(m[1]) * 25.4) / 203
      const mm = m[2].length * fontMm * SZEROKOSC_ZNAKU
      if (mm > max.mm) max = { text: m[2], mm }
    }
    return max
  }

  const NAJGORSZE = {
    ...BASE,
    receptionNo: '128/08/2026',
    supplierName: 'Zakład Przetwórstwa Drobiowego Wielkopolska',
    batchNo: '1471',
    netKg: 1245.5,
    containers: 199,
    batchKg: 12480,
    palletIndex: 12,
    palletCount: 12,
  }

  it('pełna paleta mieści się w 44 mm', () => {
    const w = najszerszyWiersz(receptionTagZpl(NAJGORSZE))
    expect({ text: w.text, mm: Math.round(w.mm) }).toMatchObject({ mm: expect.any(Number) })
    expect(w.mm).toBeLessThanOrEqual(POLE_MM)
  })

  it('paleta niepełna też — dopisek „NIEPEŁNA" nie może rozepchać wiersza', () => {
    const w = najszerszyWiersz(receptionTagZpl({ ...NAJGORSZE, full: false }))
    expect(w.mm).toBeLessThanOrEqual(POLE_MM)
  })

  it('żaden wiersz nie zjeżdża poniżej dolnej krawędzi taśmy', () => {
    const zpl = receptionTagZpl({ ...NAJGORSZE, full: false })
    const re = /\^FO\d+,(\d+)\^A0N,(\d+),/g
    let m: RegExpExecArray | null
    while ((m = re.exec(zpl))) {
      const dolMm = ((Number(m[1]) + Number(m[2])) * 25.4) / 203
      expect(dolMm).toBeLessThanOrEqual(LABEL_H_MM)
    }
  })
})

/**
 * Kalibracja stanowiska. Biuro zgłosiło (22.08.2026) „co druga zawieszka źle
 * skalibrowana" — ten sam ZPL na każdą sztukę, więc winna była nie treść, tylko
 * obsługa mediów powtarzana przy każdej etykiecie. Stąd `setup: false`.
 */
describe('receptionTagZpl — kalibracja drukarki', () => {
  /** Wszystkie współrzędne `^FO` z gotowego ZPL. */
  function pola(zpl: string): Array<[number, number]> {
    const re = /\^FO(\d+),(\d+)/g
    const out: Array<[number, number]> = []
    let m: RegExpExecArray | null
    while ((m = re.exec(zpl))) out.push([Number(m[1]), Number(m[2])])
    return out
  }

  it('przesunięcie dosuwa KAŻDE pole o tyle samo — układ zawieszki się nie rozjeżdża', () => {
    const bez = pola(receptionTagZpl(BASE))
    const z = pola(receptionTagZpl(BASE, { offsetXMm: 2, offsetYMm: 1 }))
    expect(z).toHaveLength(bez.length)
    z.forEach(([x, y], i) => {
      expect(x - bez[i][0]).toBe(mmToDots(2))
      expect(y - bez[i][1]).toBe(mmToDots(1))
    })
  })

  it('przesunięcie w górę nie schodzi poniżej zera — ujemne `^FO` wywala cały format', () => {
    const zpl = receptionTagZpl(BASE, { offsetXMm: -5, offsetYMm: -5 })
    expect(zpl).not.toMatch(/\^FO-|\^FO\d+,-/)
    expect(pola(zpl).every(([x, y]) => x >= 0 && y >= 0)).toBe(true)
  })

  it('zmierzony skok taśmy trafia do ^LL zamiast nominalnych 80 mm', () => {
    expect(receptionTagZpl(BASE, { labelLengthMm: 82 })).toContain(`^LL${mmToDots(82)}`)
  })

  // REGRESJA 22.08.2026: wyniesienie `^LL`/`^MNY` do preambuły wysyłanej raz na
  // serię urwało wydruki w 3/4 etykiety na Zebrze GC420t — bez `^LL` w formacie
  // drukarka bierze długość zapisaną u siebie. Te trzy testy mają nie pozwolić
  // wrócić do tego pomysłu.
  it('KAŻDA etykieta niesie własną długość taśmy — GC420t inaczej urywa wydruk', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).toContain(`^LL${mmToDots(LABEL_H_MM)}`)
    expect(zpl).toContain('^MNY')
  })

  it('…także wtedy, gdy etykieta idzie w środku serii', () => {
    const seria = receptionTagsStreamZpl([BASE, BASE, BASE])
    const formaty = seria.split('^XZ').filter(f => f.includes('^XA'))
    expect(formaty).toHaveLength(3)
    formaty.forEach(f => {
      expect(f).toContain('^LL')
      expect(f).toContain('^MNY')
      expect(f).toContain(`^PW${mmToDots(LABEL_W_MM)}`)
    })
  })

  it('seria idzie JEDNYM strumieniem, a nie zadaniem na zawieszkę', () => {
    const seria = receptionTagsStreamZpl([BASE, BASE])
    expect(seria.match(/\^XA/g)).toHaveLength(2)
    expect(seria.match(/\^XZ/g)).toHaveLength(2)
    // Bez `^PQ`: każda zawieszka ma inny numer palety i inną wagę.
    expect(seria).not.toContain('^PQ')
  })

  it('pusta seria nie wysyła na drukarkę pustego formatu', () => {
    expect(receptionTagsStreamZpl([])).toBe('')
  })

  it('kalibracja stanowiska obowiązuje każdą zawieszkę w serii', () => {
    const seria = receptionTagsStreamZpl([BASE, BASE], { labelLengthMm: 82 })
    expect(seria.match(new RegExp(`\\^LL${mmToDots(82)}`, 'g'))).toHaveLength(2)
  })
})

/**
 * Partia dostawcy na dole zawieszki (biuro, 22.08.2026). Numer porządkowy jest
 * NASZ i wisi wielkim drukiem u góry; numer dostawcy służy do rozmowy z nim
 * przy reklamacji, więc musi być na palecie, a nie tylko w księdze.
 */
const NAJGORSZE_LOTY = {
  ...BASE,
  receptionNo: '128/08/2026',
  supplierName: 'Zakład Przetwórstwa Drobiowego Wielkopolska',
  batchNo: '1471',
  netKg: 1245.5,
  containers: 199,
  batchKg: 12480,
  palletIndex: 12,
  palletCount: 12,
  full: false,
}

const loty = (...numery: string[]) => numery.map(no => ({ no }))

/** Współrzędna Y wiersza o podanej treści (w punktach drukarki). */
function yWiersza(zpl: string, wartosc: string): number {
  const re = /\^FO\d+,(\d+)\^A0N,\d+,\d+\^FD([\s\S]*?)\^FS/g
  let m: RegExpExecArray | null
  while ((m = re.exec(zpl))) if (m[2] === wartosc) return Number(m[1])
  return Number.NaN
}

/** Wysokość fontu wiersza o podanej treści (w punktach). */
function fontWiersza(zpl: string, wartosc: string): number {
  const re = /\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS/g
  let m: RegExpExecArray | null
  while ((m = re.exec(zpl))) if (m[2] === wartosc) return Number(m[1])
  return Number.NaN
}

describe('receptionTagZpl — partia dostawcy', () => {
  it('drukuje numer partii dostawcy pod rubryką „Partia dostawcy"', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('4577') })
    expect(zpl).toContain('^FDPartia dostawcy^FS')
    expect(zpl).toContain('^FD4577^FS')
  })

  it('wszystkie loty złożone na jeden numer przyjęcia zewnętrznego, nie tylko pierwszy', () => {
    expect(receptionTagZpl({ ...BASE, supplierLots: loty('4577', '4578') }))
      .toContain('^FD4577 / 4578^FS')
  })

  it('trzy loty wchodzą w jeden wiersz, sześć w dwa — nic się nie urywa', () => {
    const wiersze = splitSupplierLots(loty('4577', '4578', '4579', '4580', '4581', '4582'))
    expect(wiersze).toEqual(['4577 / 4578 / 4579', '4580 / 4581 / 4582'])
    expect(wiersze.join(' ')).not.toContain('…')
  })

  it('drugi wiersz trafia na zawieszkę NIŻEJ niż pierwszy', () => {
    const zpl = receptionTagZpl({
      ...BASE, supplierLots: loty('4577', '4578', '4579', '4580', '4581', '4582'),
    })
    expect(yWiersza(zpl, '4580 / 4581 / 4582'))
      .toBeGreaterThan(yWiersza(zpl, '4577 / 4578 / 4579'))
  })

  it('powtórzony lot nie zajmuje miejsca dwa razy', () => {
    expect(splitSupplierLots(loty('4577', '4577'))).toEqual(['4577'])
  })

  it('brak numeru daje kreskę, a nie pustą rubrykę wyglądającą na błąd druku', () => {
    expect(splitSupplierLots([])).toEqual(['—'])
    expect(splitSupplierLots(loty('  '))).toEqual(['—'])
    expect(receptionTagZpl(BASE)).toContain('^FD—^FS')
  })

  it('dłuższe numery pakuje ciaśniej, zamiast rozpychać wiersz', () => {
    expect(splitSupplierLots(loty('1234567', '2345678', '3456789', '4567890')))
      .toEqual(['1234567 / 2345678', '3456789 / 4567890'])
  })

  it('dopiero po zapełnieniu obu wierszy ucina — i sygnalizuje to wielokropkiem', () => {
    const out = splitSupplierLots(loty('1234567', '2345678', '3456789', '4567890', '5678901'))
    expect(out).toHaveLength(2)
    expect(out[1].endsWith(' …')).toBe(true)
  })

  it('partia dostawcy siedzi NIŻEJ niż numer przyjęcia zewnętrznego', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('4577') })
    expect(yWiersza(zpl, '4577')).toBeGreaterThan(yWiersza(zpl, '471'))
  })

  it('sześć lotów przy najdłuższych danych nadal mieści się w 44 mm', () => {
    const zpl = receptionTagZpl({
      ...NAJGORSZE_LOTY,
      supplierLots: loty('1234567', '2345678', '3456789', '4567890', '5678901', '6789012'),
    })
    const re = /\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS/g
    let m: RegExpExecArray | null
    while ((m = re.exec(zpl))) {
      const mm = m[2].length * ((Number(m[1]) * 25.4) / 203) * 0.6
      expect(mm).toBeLessThanOrEqual(44)
    }
  })
})

/**
 * PARTIA ŁĄCZONA — kilka lotów dostawcy na jednym numerze przyjęcia
 * zewnętrznego. Zawieszka pokazuje wtedy kilogramy przy każdym locie
 * (biuro, 29.08.2026): waga palety i waga całego numeru nie mówią, ile
 * przyszło z którego lotu, a przy reklamacji to jest pierwsze pytanie.
 */
describe('receptionTagZpl — partia łączona z kilogramami', () => {
  const LACZONA = [
    { no: '112906', kg: 450 },
    { no: '112907', kg: 1200 },
    { no: '112918', kg: 1800 },
  ]

  it('każdy lot ma przy sobie swoje kilogramy', () => {
    expect(opisLotu({ no: '112906', kg: 450 })).toBe('112906 450 kg')
    expect(splitSupplierLots(LACZONA, { maxZnakow: 30, maxWierszy: 3, zKilogramami: true }))
      .toEqual(['112906 450 kg / 112907 1200 kg', '112918 1800 kg'])
  })

  it('lot bez wagi (starsze przyjęcia) zostaje samym numerem', () => {
    expect(opisLotu({ no: '112906' })).toBe('112906')
    expect(opisLotu({ no: '112906', kg: 0 })).toBe('112906')
    expect(opisLotu({ no: '112906', kg: null })).toBe('112906')
  })

  it('rubryka mówi wprost, że przy numerach są kilogramy', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: LACZONA })
    expect(zpl).toContain('^FDPartie dostawcy (kg)^FS')
    expect(zpl).toContain('^FD112918 1800 kg^FS')
  })

  it('font jest MNIEJSZY niż przy jednej partii — inaczej kilogramy by się nie zmieściły', () => {
    // Jeden lot: kilogramy zostają przy numerze przyjęcia („z partii …"),
    // więc w rubryce stoi sam numer — i to jego font porównujemy.
    const jedna = receptionTagZpl({ ...BASE, supplierLots: [{ no: '112906', kg: 450 }] })
    const wiele = receptionTagZpl({ ...BASE, supplierLots: LACZONA })
    expect(fontWiersza(wiele, '112918 1800 kg'))
      .toBeLessThan(fontWiersza(jedna, '112906'))
  })

  it('cztery loty z wagami mieszczą się bez wielokropka', () => {
    const cztery = [
      { no: '112906', kg: 450 }, { no: '112907', kg: 1200 },
      { no: '112918', kg: 1800 }, { no: '112944', kg: 600 },
    ]
    const zpl = receptionTagZpl({ ...BASE, supplierLots: cztery })
    expect(zpl).not.toContain('…')
    for (const lot of cztery) expect(zpl).toContain(opisLotu(lot))
  })

  it('nic z sekcji lotów nie wchodzi na daty u dołu zawieszki', () => {
    const zpl = receptionTagZpl({
      ...BASE,
      supplierLots: [
        { no: '1234567', kg: 1245.5 }, { no: '2345678', kg: 1245.5 },
        { no: '3456789', kg: 1245.5 }, { no: '4567890', kg: 1245.5 },
      ],
    })
    const re = /\^FO\d+,(\d+)\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS/g
    const yUboj = (() => {
      const re = /\^FO\d+,(\d+)\^A0N,\d+,\d+\^FD(Ubój[\s\S]*?)\^FS/
      return Number(re.exec(zpl)![1])
    })()
    let m: RegExpExecArray | null
    while ((m = re.exec(zpl))) {
      if (!m[3].includes('kg') || m[3].includes('poj.')) continue
      expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(yUboj)
    }
  })

  it('partia łączona też nie wychodzi poza 44 mm pola zadruku', () => {
    const zpl = receptionTagZpl({
      ...NAJGORSZE_LOTY,
      supplierLots: [
        { no: '1234567', kg: 1245.5 }, { no: '2345678', kg: 1245.5 },
        { no: '3456789', kg: 1245.5 }, { no: '4567890', kg: 1245.5 },
        { no: '5678901', kg: 1245.5 }, { no: '6789012', kg: 1245.5 },
      ],
    })
    const re = /\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS/g
    let m: RegExpExecArray | null
    while ((m = re.exec(zpl))) {
      const mm = m[2].length * ((Number(m[1]) * 25.4) / 203) * 0.6
      expect(mm).toBeLessThanOrEqual(44)
    }
  })
})

describe('receptionTagZpl — znak firmowy', () => {
  const LOGO = /\^FO(\d+),(\d+)\^GFA,(\d+),\d+,(\d+),([0-9A-F]+)\^FS/

  it('wysyła znak razem z etykietą — drukarka nie ma dostępu do plików aplikacji', () => {
    expect(LOGO.test(receptionTagZpl(BASE))).toBe(true)
  })

  it('deklarowana długość mapy bitowej zgadza się z liczbą bajtów heksa', () => {
    const m = LOGO.exec(receptionTagZpl(BASE))!
    expect(m[5].length).toBe(Number(m[3]) * 2)
    expect(Number(m[3]) % Number(m[4])).toBe(0)
  })

  it('mieści się w polu zadruku i nie wchodzi na numer dokumentu', () => {
    const m = LOGO.exec(receptionTagZpl(NAJGORSZE_LOTY))!
    const mm = (dots: number) => (dots * 25.4) / 203
    const lewa = mm(Number(m[1]))
    const dol = mm(Number(m[2])) + LOGO_H_MM
    // Prawa krawędź liczona w PUNKTACH — w milimetrach wychodzi 47,05 przez
    // zaokrąglenie siatki drukarki, a na taśmie znak stoi równo z polem.
    expect(Number(m[1]) + LOGO_DOTS_W).toBeLessThanOrEqual(mmToDots(LABEL_W_MM - 3))
    // Najdłuższy numer dokumentu („128/08/2026", font 4 mm) kończy się poniżej
    // 30 mm — znak zaczyna się dalej, więc wiersze się nie zderzą.
    expect(lewa).toBeGreaterThan(30)
    expect(dol).toBeLessThan(9)
  })

  it('przesunięcie kalibracyjne rusza znak razem z resztą etykiety', () => {
    const bez = LOGO.exec(receptionTagZpl(BASE))!
    const z = LOGO.exec(receptionTagZpl(BASE, { offsetXMm: -2, offsetYMm: 1 }))!
    expect(Number(bez[1]) - Number(z[1])).toBe(mmToDots(2))
    expect(Number(z[2]) - Number(bez[2])).toBe(mmToDots(1))
  })
})
