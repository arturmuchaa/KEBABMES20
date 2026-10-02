import { describe, it, expect } from 'vitest'

import { mmToDots } from '@/features/deboning/byproductLabelZpl'
import { LOGO_LARGE_DOTS_W as LOGO_DOTS_W_DUZY } from '@/lib/labelLogo'
import {
  LOGO_H_MM, LOT_FONT_MAX_MM, LOT_FONT_MIN_MM, LOTY_DOL_MM, TAG_FIELD_W_MM, TAG_H_MM,
  TAG_MARGIN_MM, TAG_W_MM, layoutSupplierLots, opisLotu, receptionTagZpl,
  receptionTagsStreamZpl, shortenSupplier, splitSupplierLots,
} from './receptionTagZpl'

const mm = (dots: number) => (dots * 25.4) / 203
/** Prawa krawędź pola zadruku w mm. */
const PRAWA_MM = TAG_W_MM - TAG_MARGIN_MM

interface Wiersz { text: string; xMm: number; yMm: number; fontMm: number; prawaMm: number }

/** Wszystkie napisy z gotowego ZPL z ich prawą krawędzią. Font 0 jest
 *  proporcjonalny; 0,6 wysokości na znak to bezpieczna górna granica dla
 *  wielkich liter (Zebra Programming Guide). Blok `^FB` kończy się na
 *  swojej szerokości. */
function wiersze(zpl: string): Wiersz[] {
  const re = /\^FO(\d+),(\d+)\^A0N,(\d+),\d+(?:\^FB(\d+),\d+,-?\d+,[LCR])?(?:\^FR)?\^FD([\s\S]*?)\^FS/g
  const out: Wiersz[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(zpl))) {
    const xMm = mm(Number(m[1]))
    const fontMm = mm(Number(m[3]))
    const prawaMm = m[4] !== undefined
      ? xMm + mm(Number(m[4]))
      : xMm + m[5].length * fontMm * 0.6
    out.push({ text: m[5], xMm, yMm: mm(Number(m[2])), fontMm, prawaMm })
  }
  return out
}

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

describe('shortenSupplier — nazwa dostawcy na 80 mm taśmy', () => {
  it('zdejmuje formę prawną, która nie mówi nic operatorowi', () => {
    expect(shortenSupplier('KOKO Sp. z o.o.')).toBe('KOKO')
    expect(shortenSupplier('Drobimex Spółka z ograniczoną odpowiedzialnością')).toBe('Drobimex')
  })

  it('długą nazwę przycina, zamiast pozwolić drukarce uciąć ją w losowym miejscu', () => {
    expect(shortenSupplier('Zakład Przetwórstwa Drobiowego Wielkopolska Północ').length).toBeLessThanOrEqual(26)
  })

  it('pusta nazwa zostaje pusta — zawieszka nie wymyśla dostawcy', () => {
    expect(shortenSupplier('')).toBe('')
  })
})

describe('receptionTagZpl — zawieszka palety przyjęcia 80×100', () => {
  it('trzyma format rolki zawieszek: 80 mm w poprzek, 100 mm wzdłuż', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).toContain(`^PW${mmToDots(80)}`)
    expect(zpl).toContain(`^LL${mmToDots(100)}`)
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
    expect(zpl).toContain('^FDPaleta^FS')
    expect(zpl).toContain('^FD3 / 6^FS')
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
const NAJGORSZE = {
  ...BASE,
  receptionNo: '128/08/2026',
  supplierName: 'Zakład Przetwórstwa Drobiowego Wielkopolska Północ',
  batchNo: '1471',
  netKg: 1245.5,
  containers: 199,
  containerKg: 12.5,
  batchKg: 12480.5,
  palletIndex: 12,
  palletCount: 12,
  full: false,
}

/** Napisy nie mogą na siebie wjeżdżać — sprawdzamy każdą parę prostokątów. */
function kolizje(zpl: string): string[] {
  const w = wiersze(zpl)
  const out: string[] = []
  for (let i = 0; i < w.length; i++) {
    for (let j = i + 1; j < w.length; j++) {
      const a = w[i]; const b = w[j]
      // Wiersz `^FB` do prawej zajmuje tylko końcówkę bloku.
      const lewa = (r: Wiersz) => (r.prawaMm - r.xMm > r.text.length * r.fontMm * 0.6 + 0.5
        ? r.prawaMm - r.text.length * r.fontMm * 0.6 : r.xMm)
      const poziomo = lewa(a) < b.prawaMm && lewa(b) < a.prawaMm
      const pionowo = a.yMm < b.yMm + b.fontMm && b.yMm < a.yMm + a.fontMm
      if (poziomo && pionowo) out.push(`${a.text} × ${b.text}`)
    }
  }
  return out
}

describe('receptionTagZpl — nic nie wychodzi poza pole zadruku', () => {
  it('pełna i niepełna paleta mieszczą się w 74 mm pola zadruku', () => {
    for (const dane of [{ ...NAJGORSZE, full: true }, NAJGORSZE]) {
      for (const w of wiersze(receptionTagZpl(dane))) {
        expect({ text: w.text, ok: w.prawaMm <= PRAWA_MM + 0.2 }).toEqual({ text: w.text, ok: true })
      }
    }
  })

  it('żaden wiersz nie zjeżdża poniżej dolnej krawędzi taśmy', () => {
    for (const w of wiersze(receptionTagZpl(NAJGORSZE))) {
      expect(w.yMm + w.fontMm).toBeLessThanOrEqual(TAG_H_MM - TAG_MARGIN_MM)
    }
  })

  it('napisy nie nachodzą na siebie przy najdłuższych danych', () => {
    expect(kolizje(receptionTagZpl(NAJGORSZE))).toEqual([])
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

  it('zmierzony skok taśmy trafia do ^LL zamiast nominalnych 100 mm', () => {
    expect(receptionTagZpl(BASE, { labelLengthMm: 102.3 })).toContain(`^LL${mmToDots(102.3)}`)
  })

  // REGRESJA 22.08.2026: wyniesienie `^LL`/`^MNY` do preambuły wysyłanej raz na
  // serię urwało wydruki w 3/4 etykiety na Zebrze GC420t — bez `^LL` w formacie
  // drukarka bierze długość zapisaną u siebie. Te trzy testy mają nie pozwolić
  // wrócić do tego pomysłu.
  it('KAŻDA etykieta niesie własną długość taśmy — GC420t inaczej urywa wydruk', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).toContain(`^LL${mmToDots(TAG_H_MM)}`)
    expect(zpl).toContain('^MNY')
  })

  it('…także wtedy, gdy etykieta idzie w środku serii', () => {
    const seria = receptionTagsStreamZpl([BASE, BASE, BASE])
    const formaty = seria.split('^XZ').filter(f => f.includes('^XA'))
    expect(formaty).toHaveLength(3)
    formaty.forEach(f => {
      expect(f).toContain('^LL')
      expect(f).toContain('^MNY')
      expect(f).toContain(`^PW${mmToDots(TAG_W_MM)}`)
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
 * Partia dostawcy (biuro, 22.08 i 02.10.2026). Numer przyjęcia zewnętrznego
 * jest NASZ; numer dostawcy służy do rozmowy z nim przy reklamacji, więc musi
 * dać się przeczytać z palety — na 50×80 szedł fontem 3 mm i nie dało się.
 */
const loty = (...numery: string[]) => numery.map(no => ({ no }))

/** Wiersz o podanej treści. */
function wiersz(zpl: string, tekst: string): Wiersz {
  const w = wiersze(zpl).find(r => r.text === tekst)
  if (!w) throw new Error(`brak wiersza „${tekst}"`)
  return w
}

describe('receptionTagZpl — partia dostawcy', () => {
  it('drukuje numer partii dostawcy pod rubryką „Partia dostawcy"', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('4577') })
    expect(zpl).toContain('^FDPartia dostawcy^FS')
    expect(zpl).toContain('^FD4577^FS')
  })

  it('jeden lot idzie największym fontem rubryki — ale dużo mniejszym niż numer przyjęcia zewnętrznego', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('1234567') })
    expect(wiersz(zpl, '1234567').fontMm).toBeCloseTo(LOT_FONT_MAX_MM, 0)
    expect(wiersz(zpl, '1234567').fontMm).toBeLessThan(wiersz(zpl, '471').fontMm / 1.5)
  })

  it('długi numer lotu zmniejsza font, zamiast wychodzić poza taśmę', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('PL-2026/08/12345-AB') })
    const w = wiersz(zpl, 'PL-2026/08/12345-AB')
    expect(w.fontMm).toBeLessThan(LOT_FONT_MAX_MM)
    expect(w.prawaMm).toBeLessThanOrEqual(PRAWA_MM + 0.2)
  })

  it('wszystkie loty złożone na jeden numer przyjęcia zewnętrznego, nie tylko pierwszy', () => {
    expect(receptionTagZpl({ ...BASE, supplierLots: loty('4577', '4578') }))
      .toContain('^FD4577 / 4578^FS')
  })

  it('sześć lotów mieści się bez urywania i nadal fontem większym niż dawne 3 mm', () => {
    const uklad = layoutSupplierLots(loty('1234567', '2345678', '3456789', '4567890', '5678901', '6789012'))
    expect(uklad.rows.map(r => r.no).join(' ')).not.toContain('…')
    expect(uklad.rows.map(r => r.no).join(' / ').split(' / ')).toHaveLength(6)
    expect(uklad.fontMm).toBeGreaterThanOrEqual(5)
  })

  it('kolejne wiersze idą NIŻEJ i nie wchodzą na daty', () => {
    const zpl = receptionTagZpl({
      ...NAJGORSZE, supplierLots: loty('1234567', '2345678', '3456789', '4567890', '5678901', '6789012'),
    })
    const uklad = layoutSupplierLots(loty('1234567', '2345678', '3456789', '4567890', '5678901', '6789012'))
    const ys = uklad.rows.map(r => wiersz(zpl, r.no).yMm)
    ys.slice(1).forEach((y, i) => expect(y).toBeGreaterThan(ys[i]))
    expect(ys[ys.length - 1] + uklad.fontMm).toBeLessThanOrEqual(LOTY_DOL_MM + 0.2)
    expect(kolizje(zpl)).toEqual([])
  })

  it('powtórzony lot nie zajmuje miejsca dwa razy', () => {
    expect(splitSupplierLots(loty('4577', '4577'))).toEqual(['4577'])
  })

  it('brak numeru daje kreskę, a nie pustą rubrykę wyglądającą na błąd druku', () => {
    expect(splitSupplierLots([])).toEqual(['—'])
    expect(splitSupplierLots(loty('  '))).toEqual(['—'])
    expect(receptionTagZpl(BASE)).toContain('^FD—^FS')
  })

  it('dopiero gdy nawet najmniejszy font nie mieści lotów, ucina — i mówi to wielokropkiem', () => {
    const duzo = loty(...Array.from({ length: 40 }, (_, i) => String(1234500 + i)))
    const uklad = layoutSupplierLots(duzo)
    expect(uklad.fontMm).toBe(LOT_FONT_MIN_MM)
    expect(uklad.rows[uklad.rows.length - 1].no.endsWith(' …')).toBe(true)
  })

  it('partia dostawcy siedzi NIŻEJ niż numer przyjęcia zewnętrznego', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('4577') })
    expect(wiersz(zpl, '4577').yMm).toBeGreaterThan(wiersz(zpl, '471').yMm)
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

  it('opis lotu niesie jego kilogramy', () => {
    expect(opisLotu({ no: '112906', kg: 450 })).toBe('112906 450 kg')
  })

  it('lot bez wagi (starsze przyjęcia) zostaje samym numerem', () => {
    expect(opisLotu({ no: '112906' })).toBe('112906')
    expect(opisLotu({ no: '112906', kg: 0 })).toBe('112906')
    expect(opisLotu({ no: '112906', kg: null })).toBe('112906')
  })

  it('tabelka: lot w wierszu, numer z lewej, kilogramy wyrównane do prawej', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: LACZONA })
    expect(zpl).toContain('^FDPartie dostawcy^FS')
    const no = wiersz(zpl, '112918')
    const kg = wiersz(zpl, '1800 kg')
    expect(kg.yMm).toBeCloseTo(no.yMm, 1)
    expect(zpl).toMatch(/\^FB\d+,1,0,R\^FD1800 kg\^FS/)
    expect(kg.prawaMm).toBeLessThanOrEqual(PRAWA_MM + 0.2)
  })

  it('trzy loty z wagami nadal czytelne przy rozładunku — co najmniej 6 mm', () => {
    expect(layoutSupplierLots(LACZONA).fontMm).toBeGreaterThanOrEqual(6)
  })

  it('cztery loty z wagami mieszczą się bez wielokropka', () => {
    const cztery = [
      { no: '112906', kg: 450 }, { no: '112907', kg: 1200 },
      { no: '112918', kg: 1800 }, { no: '112944', kg: 600 },
    ]
    const zpl = receptionTagZpl({ ...BASE, supplierLots: cztery })
    expect(zpl).not.toContain('…')
    for (const lot of cztery) expect(zpl).toContain(`^FD${lot.no}^FS`)
  })

  it('sześć długich lotów z wagami: kilogramy ustępują, ale WSZYSTKIE numery są na zawieszce', () => {
    const szesc = [
      { no: '1234567', kg: 1245.5 }, { no: '2345678', kg: 1245.5 },
      { no: '3456789', kg: 1245.5 }, { no: '4567890', kg: 1245.5 },
      { no: '5678901', kg: 1245.5 }, { no: '6789012', kg: 1245.5 },
    ]
    const zpl = receptionTagZpl({ ...NAJGORSZE, supplierLots: szesc })
    expect(zpl).not.toContain('…')
    for (const lot of szesc) expect(zpl).toContain(lot.no)
    for (const w of wiersze(zpl)) expect(w.prawaMm).toBeLessThanOrEqual(PRAWA_MM + 0.2)
    expect(kolizje(zpl)).toEqual([])
  })
})

/**
 * Numer przyjęcia zewnętrznego jest u nas NAJWAŻNIEJSZY (biuro, 02.10.2026):
 * ma być najbardziej widoczny i nie zlewać się z resztą zawieszki.
 */
describe('receptionTagZpl — numer przyjęcia zewnętrznego', () => {
  it('ma największy font na zawieszce', () => {
    const zpl = receptionTagZpl({ ...BASE, supplierLots: loty('1234567') })
    const max = Math.max(...wiersze(zpl).filter(w => w.text !== '471').map(w => w.fontMm))
    expect(wiersz(zpl, '471').fontMm).toBeGreaterThan(max * 1.5)
  })

  it('zwykłym czarnym drukiem — bez białego na czarnym pasie, który na Zebrze bywa nieczytelny', () => {
    const zpl = receptionTagZpl(BASE)
    expect(zpl).not.toContain('^FR')
    expect(zpl).toMatch(/\^FB\d+,1,0,C\^FD471\^FS/)
  })

  it('stoi sam w swojej sekcji — żaden inny napis nie dzieli z nim wysokości', () => {
    const zpl = receptionTagZpl({ ...NAJGORSZE, batchNo: '471' })
    const nr = wiersz(zpl, '471')
    const obok = wiersze(zpl).filter(w => w.text !== '471'
      && w.yMm < nr.yMm + nr.fontMm && nr.yMm < w.yMm + w.fontMm)
    expect(obok).toEqual([])
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

  it('mieści się w polu zadruku i nie wchodzi na numer dokumentu ani dostawcę', () => {
    const zpl = receptionTagZpl(NAJGORSZE)
    const m = LOGO.exec(zpl)!
    const lewa = mm(Number(m[1]))
    const dol = mm(Number(m[2])) + LOGO_H_MM
    expect(Number(m[1]) + LOGO_DOTS_W_DUZY).toBeLessThanOrEqual(mmToDots(PRAWA_MM))
    // Znak stoi z lewej w nagłówku, numer dokumentu z prawej — bez zderzenia.
    expect(lewa + mm(LOGO_DOTS_W_DUZY)).toBeLessThan(wiersz(zpl, '128/08/2026').xMm)
    expect(dol).toBeLessThan(wiersz(zpl, shortenSupplier(NAJGORSZE.supplierName)).yMm)
  })

  it('przesunięcie kalibracyjne rusza znak razem z resztą etykiety', () => {
    const bez = LOGO.exec(receptionTagZpl(BASE))!
    const z = LOGO.exec(receptionTagZpl(BASE, { offsetXMm: -2, offsetYMm: 1 }))!
    expect(Number(bez[1]) - Number(z[1])).toBe(mmToDots(2))
    expect(Number(z[2]) - Number(bez[2])).toBe(mmToDots(1))
  })
})
