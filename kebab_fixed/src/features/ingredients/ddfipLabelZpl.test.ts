import { describe, it, expect } from 'vitest'
import {
  DDFIP_LABEL_H_MM, DDFIP_LABEL_W_MM, DDFIP_NAGLOWEK, DDFIP_PRINT_W_MM,
  ddfipLabelZpl, znakowWWierszu, zawinTekst,
} from './ddfipLabelZpl'

const WEJSCIE = {
  receptionNo:    'DF/1/08',
  ingredientName: 'Mieszanka KEBAB MIX',
  qty:            50,
  unit:           'kg',
  batchNo:        'L2026/08',
  expiryDate:     '2027-08-01',
  supplierName:   'BERG PRZYPRAWY',
  documentNo:     'FV 123/2026',
  receivedDate:   '2026-08-30',
}

/** Wszystkie napisy etykiety: [xMm, fontMm, treść]. */
function napisy(zpl: string): { x: number; font: number; text: string }[] {
  const out: { x: number; font: number; text: string }[] = []
  const re = /\^FO(\d+),(\d+)\^A0N,(\d+),\d+(?:\^FB(\d+),\d+,\d+,\w+,\d+)?\^FD([^^]*)\^FS/g
  let m: RegExpExecArray | null
  while ((m = re.exec(zpl))) {
    out.push({ x: Number(m[1]), font: Number(m[3]), text: m[5] })
  }
  return out
}

/** Punkty → mm przy 203 dpi (domyślna rozdzielczość Zebry w zakładzie). */
const naMm = (dots: number) => (dots * 25.4) / 203

describe('rozmiar taśmy', () => {
  it('etykieta ma 100 mm szerokości i 150 mm wysokości', () => {
    // Rozmiar podany przez właściciela 30.08.2026 — inna taśma niż zawieszki
    // 50x80, bo te nakleja się na paletę, a nie wiesza.
    expect(DDFIP_LABEL_W_MM).toBe(100)
    expect(DDFIP_LABEL_H_MM).toBe(150)
  })

  it('deklaruje drukarce pełną szerokość i długość taśmy', () => {
    const zpl = ddfipLabelZpl(WEJSCIE)
    expect(zpl).toContain(`^PW${Math.round((100 * 203) / 25.4)}`)
    expect(zpl).toContain(`^LL${Math.round((150 * 203) / 25.4)}`)
  })

  it('kasuje przesunięcie zapisane w drukarce i tnie po etykiecie', () => {
    const zpl = ddfipLabelZpl(WEJSCIE)
    expect(zpl).toContain('^LH0,0')
    expect(zpl).toContain('^MNY')
  })

  it('ma polskie znaki (^CI28 = UTF-8)', () => {
    expect(ddfipLabelZpl(WEJSCIE)).toContain('^CI28')
  })
})

describe('treść', () => {
  const zpl = ddfipLabelZpl(WEJSCIE)

  it('numer przyjęcia jest na etykiecie', () => {
    expect(zpl).toContain('DF/1/08')
  })

  it('nazwa składnika jest na etykiecie', () => {
    expect(zpl).toContain('Mieszanka KEBAB MIX')
  })

  it('ilość idzie z jednostką — same cyfry na palecie nic nie mówią', () => {
    expect(zpl).toContain('50 kg')
  })

  it('partia dostawcy jest na etykiecie — po niej idzie identyfikowalność', () => {
    expect(zpl).toContain('L2026/08')
  })

  it('daty po polsku, nie w ISO', () => {
    expect(zpl).toContain('01.08.2027')
    expect(zpl).toContain('30.08.2026')
  })

  it('dostawca i dokument są na etykiecie', () => {
    expect(zpl).toContain('BERG PRZYPRAWY')
    expect(zpl).toContain('FV 123/2026')
  })

  it('termin ważności jest NAJWIĘKSZY po numerze — po nim jedzie FEFO', () => {
    const wsz = napisy(zpl)
    const termin = wsz.find(n => n.text === '01.08.2027')!
    const numer  = wsz.find(n => n.text === 'DF/1/08')!
    const reszta = wsz.filter(n => n !== termin && n !== numer)
    expect(termin.font).toBeGreaterThanOrEqual(Math.max(...reszta.map(n => n.font)))
  })

  it('brak terminu ważności pokazuje kreskę, nie pustkę', () => {
    // Sól i folia terminu nie mają. Pusta kratka wygląda jak zapomniany wpis.
    const bez = ddfipLabelZpl({ ...WEJSCIE, expiryDate: '' })
    expect(bez).toContain('bez terminu')
  })
})

describe('szerokość — drukarka nie zawija, tekst poza taśmą znika', () => {
  it('żaden napis nie wychodzi poza pole zadruku', () => {
    const dlugie = ddfipLabelZpl({
      ...WEJSCIE,
      ingredientName: 'Mieszanka przyprawowa KEBAB MIX 95/5 z dodatkiem czosnku',
      supplierName:   'BERG PRZYPRAWY SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ',
      batchNo:        'L2026/08/PARTIA-BARDZO-DLUGA-123456',
      documentNo:     'FV 1234567890/08/2026 do zamówienia 998877',
      qty:            12345.5,
    })
    for (const n of napisy(dlugie)) {
      const szerokoscMm = n.text.length * naMm(n.font) * 0.6
      expect(naMm(n.x) + szerokoscMm).toBeLessThanOrEqual(DDFIP_LABEL_W_MM)
    }
  })

  it('długa nazwa składnika schodzi do drugiego wiersza, nie ginie', () => {
    const zpl = ddfipLabelZpl({
      ...WEJSCIE,
      ingredientName: 'Mieszanka przyprawowa KEBAB MIX 95/5 z dodatkiem czosnku',
    })
    expect(zpl).toContain('Mieszanka przyprawowa')
  })
})

describe('zawinTekst', () => {
  it('krótki tekst zostaje jednym wierszem', () => {
    expect(zawinTekst('Sól', 20, 2)).toEqual(['Sól'])
  })

  it('łamie na granicy słowa, nie w środku wyrazu', () => {
    expect(zawinTekst('Mieszanka przyprawowa KEBAB', 22, 2))
      .toEqual(['Mieszanka przyprawowa', 'KEBAB'])
  })

  it('gdy na wielokropek brakuje miejsca, zabiera je ostatniemu słowu', () => {
    // Wąski wiersz: „przyprawowa …" ma 13 znaków przy limicie 12, więc trzeba
    // uciąć literę. Lepiej to, niż wiersz szerszy od taśmy — ten po prostu
    // znika z wydruku.
    expect(zawinTekst('Mieszanka przyprawowa KEBAB', 12, 2))
      .toEqual(['Mieszanka', 'przyprawow …'])
  })

  it('nadmiar ucinamy MY, wielokropkiem — drukarka utnie w losowym miejscu', () => {
    const [, drugi] = zawinTekst('Mieszanka przyprawowa KEBAB MIX 95/5 czosnek', 12, 2)
    expect(drugi.endsWith('…')).toBe(true)
  })

  it('słowo dłuższe niż wiersz też zostaje przycięte', () => {
    expect(zawinTekst('ABCDEFGHIJKLMNOPRST', 8, 1)[0].length).toBeLessThanOrEqual(8)
  })

  it('pusty tekst nie tworzy pustego wiersza', () => {
    expect(zawinTekst('', 20, 2)).toEqual([])
  })
})

describe('bezpieczeństwo i kopie', () => {
  it('znaki sterujące ZPL z danych nie rozbijają formatu', () => {
    const zpl = ddfipLabelZpl({ ...WEJSCIE, batchNo: 'L^XA~JA666' })
    expect(zpl).not.toContain('L^XA')
    expect(zpl.match(/\^XA/g) ?? []).toHaveLength(1)
  })

  it('kilka kopii drukuje się jednym formatem', () => {
    expect(ddfipLabelZpl(WEJSCIE, { copies: 4 })).toContain('^PQ4,0,0,Y')
  })

  it('jedna kopia nie dokłada ^PQ', () => {
    expect(ddfipLabelZpl(WEJSCIE)).not.toContain('^PQ')
  })
})

describe('znakowWWierszu', () => {
  it('liczy z pola zadruku, nie z całej taśmy', () => {
    // Font 0 jest proporcjonalny — ~0,6 wysokości na znak.
    expect(znakowWWierszu(5)).toBe(Math.floor(DDFIP_PRINT_W_MM / (5 * 0.6)))
  })
})

describe('nagłówek naklejki', () => {
  it('mieści się w szerokości druku', () => {
    // Nazwa ekranu i nagłówek naklejki to jeden napis (DDFIP_NAGLOWEK), więc
    // zmiana nazwy w menu potrafi ją wypchnąć poza taśmę. Bez tego testu
    // wyszłoby to dopiero na wydruku, po naklejeniu na paletę.
    expect(DDFIP_NAGLOWEK.length).toBeLessThanOrEqual(znakowWWierszu(3.2))
  })

  it('trafia na etykietę', () => {
    const zpl = ddfipLabelZpl({
      receptionNo: 'DF/1/08', ingredientName: 'Folia stretch', qty: 120,
      unit: 'szt', batchNo: 'F-1', expiryDate: '2029-01-01',
      supplierName: 'BERG', documentNo: 'FV 1', receivedDate: '2026-08-30',
    })
    expect(zpl).toContain(DDFIP_NAGLOWEK)
    expect(zpl).not.toContain('Przyjęcie DDFiP')
  })
})
