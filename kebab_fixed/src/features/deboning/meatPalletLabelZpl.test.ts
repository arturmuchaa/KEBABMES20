import { describe, it, expect } from 'vitest'
import { meatPalletLabelZpl, MAX_LOTS_ON_LABEL } from './meatPalletLabelZpl'
import { mmToDots, LABEL_W_MM, LABEL_H_MM } from './byproductLabelZpl'

const BASE = {
  palletNo: 'PAL/14/08/26/3',
  netKg: 600,
  containers: 30,
  productionDate: '2026-08-14',
  expiryDate: '2026-08-19',
  lots: [{ lotNo: '475', kg: 420 }, { lotNo: '476', kg: 180 }],
}

describe('meatPalletLabelZpl — etykieta palety mięsa', () => {
  it('rozmiar taśmy taki sam jak przy ubocznych', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain(`^PW${mmToDots(LABEL_W_MM)}`)
    expect(zpl).toContain(`^LL${mmToDots(LABEL_H_MM)}`)
    expect(zpl).toContain('^CI28')
  })

  it('niesie numer palety, wagę i pojemniki', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('PAL/14/08/26/3')
    expect(zpl).toContain('600 kg')
    expect(zpl).toContain('30 pojem')
  })

  // QR zdjęty 24.08.2026 — masownia go nie skanowała, a zabierał róg etykiety.
  // Numer palety zostaje drukiem: po nim odnajduje się paletę w „Zważone dziś".
  it('numer palety zostaje na etykiecie mimo zdjęcia QR', () => {
    expect(meatPalletLabelZpl(BASE)).toContain('PAL/14/08/26/3')
  })

  it('drukuje skład partii z kilogramami', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('475')
    expect(zpl).toContain('420 kg')
    expect(zpl).toContain('476')
    expect(zpl).toContain('180 kg')
  })

  it('przy piątej partii ostatni wiersz to „+ N kolejnych"', () => {
    const duzo = { ...BASE, lots: [
      { lotNo: '471', kg: 100 }, { lotNo: '472', kg: 100 }, { lotNo: '473', kg: 100 },
      { lotNo: '474', kg: 100 }, { lotNo: '475', kg: 100 }, { lotNo: '476', kg: 100 },
    ] }
    const zpl = meatPalletLabelZpl(duzo)
    expect(zpl).toContain('471')
    expect(zpl).toContain(`+ ${6 - MAX_LOTS_ON_LABEL} kolejnych`)
    expect(zpl).not.toContain('476')
  })

  it('daty w formacie dd.mm.rrrr', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('14.08.2026')
    expect(zpl).toContain('19.08.2026')
  })

  it('żaden wiersz nie wychodzi poza szerokość taśmy', () => {
    const maxX = mmToDots(LABEL_W_MM)
    const zpl = meatPalletLabelZpl({ ...BASE, netKg: 1234.5, containers: 120 })
    const pola = [...zpl.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+\^FD([^^]*)\^FS/g)]
    expect(pola.length).toBeGreaterThan(5)
    for (const [, x, , h, tekst] of pola) {
      expect(Number(x) + tekst.length * Number(h) * 0.6).toBeLessThanOrEqual(maxX)
    }
  })

  it('wszystko mieści się w wysokości taśmy', () => {
    const maxY = mmToDots(LABEL_H_MM)
    const zpl = meatPalletLabelZpl(BASE)
    for (const [, , y] of zpl.matchAll(/\^FO(\d+),(\d+)/g)) {
      expect(Number(y)).toBeLessThan(maxY)
    }
  })

  it('znaki sterujące ZPL z danych nie rozbijają etykiety', () => {
    const zpl = meatPalletLabelZpl({ ...BASE, palletNo: 'PAL^1~2' })
    expect(zpl).toContain('PAL 1 2')
  })
})

/**
 * Numer partii na etykiecie palety.
 *
 * Operator masowania czyta z zawieszki dwie rzeczy: ile bierze i Z CZEGO.
 * Numer partii szedł mniejszą czcionką niż waga i tonął w wierszu „503 — 200 kg",
 * a przy palecie z JEDNEJ partii ten dopisek z kilogramami niczego nie wnosi:
 * powtarza wagę palety, która stoi wyżej wielkim drukiem (biuro, 24.08.2026).
 */

/** Wysokość czcionki (w punktach ^A0N) użyta do wydrukowania danego napisu. */
function fontHeightOf(zpl: string, tekst: string): number | null {
  const m = zpl.match(new RegExp(`\\^A0N,(\\d+),\\d+\\^FD${tekst.replace(/[/^$.*+?()[\]{}|\\]/g, '\\$&')}\\^FS`))
  return m ? Number(m[1]) : null
}

describe('meatPalletLabelZpl — numer partii', () => {
  const JEDNA = { ...BASE, netKg: 200, lots: [{ lotNo: '503', kg: 200 }] }

  it('paleta z JEDNEJ partii pokazuje sam numer, bez powtarzania kilogramów', () => {
    const zpl = meatPalletLabelZpl(JEDNA)
    expect(zpl).toContain('503')
    expect(zpl).not.toContain('503 — 200 kg')
  })

  it('numer jednej partii jest co najmniej tak duży jak waga palety', () => {
    const zpl = meatPalletLabelZpl(JEDNA)
    const waga = fontHeightOf(zpl, '200 kg')
    const numer = fontHeightOf(zpl, '503')
    expect(waga).toBeGreaterThan(0)
    expect(numer).toBeGreaterThanOrEqual(waga as number)
  })

  it('przy jednej partii nie ma nagłówka „Partie:" — nie ma czego wyliczać', () => {
    expect(meatPalletLabelZpl(JEDNA)).not.toContain('Partie:')
  })

  it('dwie partie DALEJ pokazują, ile z której — po to jest ta etykieta', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('Partie:')
    expect(zpl).toContain('475 — 420 kg')
    expect(zpl).toContain('476 — 180 kg')
  })

  it('etykieta jednej partii mieści się na taśmie', () => {
    const zpl = meatPalletLabelZpl(JEDNA)
    const yMax = Math.max(...[...zpl.matchAll(/\^FO\d+,(\d+)/g)].map(m => Number(m[1])))
    expect(yMax).toBeLessThan(mmToDots(LABEL_H_MM))
  })
})

/**
 * Układ przeniesiony z etykiety ubocznych: rodzaj → nr porządkowy → waga,
 * a daty małym drukiem na dole (biuro, 24.08.2026). QR zdjęty — masownia go
 * nie skanuje, a zabierał róg etykiety.
 */
describe('meatPalletLabelZpl — układ jak na ubocznych', () => {
  const JEDNA = {
    palletNo: 'PAL/24/08/26/7', netKg: 200, containers: 10,
    productionDate: '2026-08-24', expiryDate: '2026-08-28',
    slaughterDate: '2026-08-21', receivedDate: '2026-08-22',
    lots: [{ lotNo: '503', kg: 200 }],
  }

  /** Kolejność napisów na etykiecie, z góry na dół. */
  function kolejnosc(zpl: string): string[] {
    return [...zpl.matchAll(/\^FO\d+,(\d+)\^A0N,\d+,\d+\^FD([^^]*)\^FS/g)]
      .sort((a, b) => Number(a[1]) - Number(b[1]))
      .map(m => m[2])
  }

  it('nie drukuje już kodu QR', () => {
    expect(meatPalletLabelZpl(JEDNA)).not.toContain('^BQ')
  })

  it('idzie rodzaj, numer porządkowy, waga — a daty na końcu', () => {
    const k = kolejnosc(meatPalletLabelZpl(JEDNA))
    expect(k[0]).toBe('MIĘSO')
    expect(k.indexOf('Nr porządkowy')).toBeLessThan(k.indexOf('Waga netto'))
    expect(k.indexOf('503')).toBeLessThan(k.indexOf('200 kg'))
    expect(k.indexOf('Waga netto')).toBeLessThan(k.findIndex(t => t.startsWith('Ważenie')))
  })

  it('daty na dole w ustalonej kolejności: ważenie, ubój, ważność, przyjęcie', () => {
    const k = kolejnosc(meatPalletLabelZpl(JEDNA)).filter(t => /^(Ważenie|Ubój|Ważność|Przyjęcie)/.test(t))
    expect(k).toEqual([
      'Ważenie 24.08.2026',
      'Ubój 21.08.2026',
      'Ważność 28.08.2026',
      'Przyjęcie 22.08.2026',
    ])
  })

  it('numer partii zostaje największy na etykiecie', () => {
    const zpl = meatPalletLabelZpl(JEDNA)
    const font = (t: string) => Number(zpl.match(new RegExp(`\\^A0N,(\\d+),\\d+\\^FD${t}\\^FS`))?.[1] ?? 0)
    expect(font('503')).toBeGreaterThan(font('200 kg'))
  })

  it('paleta z dwóch partii NIE udaje jednej daty uboju ani przyjęcia', () => {
    const zpl = meatPalletLabelZpl({
      ...JEDNA, lots: [{ lotNo: '503', kg: 50 }, { lotNo: '504', kg: 150 }],
    })
    expect(zpl).toContain('503 — 50 kg')
    expect(zpl).toContain('504 — 150 kg')
    expect(zpl).not.toContain('Ubój')
    expect(zpl).not.toContain('Przyjęcie')
    // Ważenie i najkrótsza ważność dalej mają sens dla całej palety.
    expect(zpl).toContain('Ważenie 24.08.2026')
    expect(zpl).toContain('Ważność 28.08.2026')
  })

  it('brakującej daty nie drukuje jako pustego wiersza', () => {
    const zpl = meatPalletLabelZpl({ ...JEDNA, slaughterDate: '', receivedDate: '' })
    expect(zpl).not.toContain('Ubój')
    expect(zpl).not.toContain('Przyjęcie')
    expect(zpl).toContain('Ważność 28.08.2026')
  })

  it('mieści się na taśmie także przy czterech partiach', () => {
    const zpl = meatPalletLabelZpl({
      ...JEDNA,
      lots: [{ lotNo: '1', kg: 50 }, { lotNo: '2', kg: 50 }, { lotNo: '3', kg: 50 }, { lotNo: '4', kg: 50 }],
    })
    const yMax = Math.max(...[...zpl.matchAll(/\^FO\d+,(\d+)/g)].map(m => Number(m[1])))
    expect(yMax).toBeLessThan(mmToDots(LABEL_H_MM))
  })
})
