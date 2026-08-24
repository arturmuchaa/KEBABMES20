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

  it('QR koduje numer palety — masownia go zeskanuje', () => {
    const zpl = meatPalletLabelZpl(BASE)
    expect(zpl).toContain('^BQ')
    expect(zpl).toContain('PAL/14/08/26/3')
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
