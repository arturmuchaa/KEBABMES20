import { describe, it, expect } from 'vitest'

import { LABEL_H_MM, LABEL_W_MM, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { LOGO_DOTS_W } from '@/lib/labelLogo'
import { LOGO_H_MM, fmtSupplierBatches, receptionTagZpl, shortenSupplier } from './receptionTagZpl'

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

  it('w serii (`setup: false`) nie powtarza komend obsługi mediów', () => {
    const zpl = receptionTagZpl(BASE, { setup: false })
    expect(zpl).not.toContain('^LL')
    expect(zpl).not.toContain('^MNY')
  })

  it('…ale zostawia szerokość taśmy i zerowanie przesunięcia z drukarki', () => {
    const zpl = receptionTagZpl(BASE, { setup: false })
    expect(zpl).toContain(`^PW${mmToDots(LABEL_W_MM)}`)
    expect(zpl).toContain('^LH0,0')
    expect(zpl).toContain('^FD471^FS')
  })

  it('pojedynczy wydruk domyślnie nadal ustawia taśmę sam', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).toContain('^MNY')
    expect(zpl).toContain(`^LL${mmToDots(LABEL_H_MM)}`)
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

describe('receptionTagZpl — partia dostawcy', () => {
  it('drukuje numer partii dostawcy pod rubryką „Partia dostawcy"', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierBatchNos: ['4577'] })
    expect(zpl).toContain('^FDPartia dostawcy^FS')
    expect(zpl).toContain('^FD4577^FS')
  })

  it('wszystkie loty złożone na jeden numer porządkowy, nie tylko pierwszy', () => {
    expect(receptionTagZpl({ ...BASE, supplierBatchNos: ['4577', '4578'] }))
      .toContain('^FD4577 / 4578^FS')
  })

  it('powtórzony lot nie zajmuje wiersza dwa razy', () => {
    expect(fmtSupplierBatches(['4577', '4577'])).toBe('4577')
  })

  it('brak numeru daje kreskę, a nie pustą rubrykę wyglądającą na błąd druku', () => {
    expect(fmtSupplierBatches([])).toBe('—')
    expect(fmtSupplierBatches(['  '])).toBe('—')
    expect(receptionTagZpl(BASE)).toContain('^FD—^FS')
  })

  it('długą listę lotów ucinamy MY — drukarka ucięłaby ją bez śladu', () => {
    const out = fmtSupplierBatches(['1234567', '2345678', '3456789', '4567890'])
    expect(out.endsWith('…')).toBe(true)
    expect(out.length).toBeLessThanOrEqual(19)
  })

  it('partia dostawcy siedzi NIŻEJ niż numer porządkowy', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierBatchNos: ['4577'] })
    const y = (wartosc: string) => {
      const re = /\^FO\d+,(\d+)\^A0N,\d+,\d+\^FD([\s\S]*?)\^FS/g
      let m: RegExpExecArray | null
      while ((m = re.exec(zpl))) if (m[2] === wartosc) return Number(m[1])
      return Number.NaN
    }
    expect(y('4577')).toBeGreaterThan(y('471'))
  })

  it('najdłuższa dopuszczalna lista lotów mieści się w 44 mm', () => {
    const zpl = receptionTagZpl({ ...NAJGORSZE_LOTY, supplierBatchNos: ['1234567', '2345678', '3456789'] })
    const re = /\^A0N,(\d+),\d+\^FD([\s\S]*?)\^FS/g
    let m: RegExpExecArray | null
    while ((m = re.exec(zpl))) {
      const mm = m[2].length * ((Number(m[1]) * 25.4) / 203) * 0.6
      expect(mm).toBeLessThanOrEqual(44)
    }
  })
})

/**
 * Znak firmowy. Wchodzi w prawy górny róg — jedyne miejsce na zawieszce, które
 * nie zabiera wiersza treści. Pilnujemy, żeby nie wjechał na numer dokumentu
 * ani poza pole zadruku, bo drukarka nie ostrzega: po prostu utnie.
 */
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
