/**
 * Etykieta partii przyprawionej — 100 × 150 mm, drukowana po odbiorze z masownicy.
 *
 * Właściciel 18.09.2026: „po wpisaniu, ile kg zważono, ma się drukować etykieta
 * z Zebry: jaka partia mięsa DUŻE LITERY, jaki skład palet poszedł do tej
 * partii, godzina wsadu, godzina zakończenia, mięso — ilość spodziewana
 * i zważona, receptura, jeżeli np. filet to też widoczne, oraz logo Księżyc".
 */
import { describe, it, expect } from 'vitest'
import { mixingLabelZpl, LABEL_W_MM, LABEL_H_MM } from './mixingLabelZpl'
import { LOGO_DOTS_W } from '@/lib/labelLogo'

const WSAD = {
  batchNo: '563',
  recipeName: 'KIRMIZI',
  orderNo: 'MAS/18/09/26/2',
  machineId: 3,
  kgMeat: 600,
  kgExpected: 744,
  kgWeighed: 745.5,
  startedAt: '2026-09-18T09:56:00Z',
  finishedAt: '2026-09-18T10:47:00Z',
  mixMinutes: 50,
  meat: [
    { palletNo: 'PAL/18/09/26/3', lotNo: '563', kg: 200, materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs' },
    { palletNo: 'PAL/18/09/26/4', lotNo: '563', kg: 200, materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs' },
    { palletNo: '', lotNo: '569', kg: 200, materialName: 'Filet z kurczaka', materialTypeId: 'mat-filet-kurczak' },
  ],
}

const zpl = (nadpisz: Partial<typeof WSAD> = {}) => mixingLabelZpl({ ...WSAD, ...nadpisz })

describe('etykieta partii przyprawionej', () => {
  it('ma rozmiar 100 × 150 mm', () => {
    expect(LABEL_W_MM).toBe(100)
    expect(LABEL_H_MM).toBe(150)
    // 203 dpi: 100 mm = 799 punktów szerokości taśmy, 150 mm = 1199 długości.
    expect(zpl()).toContain('^PW799')
    expect(zpl()).toContain('^LL1199')
  })

  it('numer partii jest największym napisem na etykiecie', () => {
    const out = zpl()
    const fonty = [...out.matchAll(/\^A0N,(\d+),\d+\^FD([^^]*)/g)]
      .map(m => ({ h: Number(m[1]), tekst: m[2] }))
    const najwiekszy = fonty.sort((a, b) => b.h - a.h)[0]
    expect(najwiekszy.tekst).toBe('563')
  })

  it('wypisuje skład: palety, partie i kilogramy', () => {
    const out = zpl()
    expect(out).toContain('PAL/18/09/26/3')
    expect(out).toContain('PAL/18/09/26/4')
    expect(out).toMatch(/partia 569/)
    expect(out).toMatch(/200 kg/)
  })

  it('pokazuje godziny wsadu i zakończenia oraz cykl', () => {
    const out = zpl()
    expect(out).toContain('09:56')
    expect(out).toContain('10:47')
    expect(out).toContain('50 min')
  })

  it('stawia obok siebie ilość spodziewaną i zważoną', () => {
    const out = zpl()
    expect(out).toContain('745,5 kg')
    expect(out).toContain('744 kg')
    expect(out).toMatch(/spodziewan/i)
  })

  it('wypisuje recepturę i masownicę', () => {
    const out = zpl()
    expect(out).toContain('KIRMIZI')
    expect(out).toContain('MAS/18/09/26/2')
    expect(out).toMatch(/Masownica 3/)
  })

  it('surowiec inny niż z/s widać na etykiecie', () => {
    expect(zpl()).toContain('FILET Z KURCZAKA')
  })

  it('sam z/s nie zaśmieca etykiety plakietką', () => {
    const out = zpl({
      meat: [{ palletNo: 'PAL/1', lotNo: '563', kg: 600, materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs' }],
    })
    expect(out).not.toContain('MIĘSO Z/S')
  })

  it('partia mieszana mówi, z czego powstała', () => {
    const out = zpl({ batchNo: 'PP26' })
    expect(out).toContain('PP26')
    expect(out).toMatch(/563 \+ 569|569 \+ 563/)
  })

  it('niesie logo Księżyc', () => {
    const out = zpl()
    expect(out).toContain('^GFA,')
    expect(out).toContain(String(LOGO_DOTS_W / 8))
  })

  it('długi skład nie wylewa się poza etykietę', () => {
    const duzo = Array.from({ length: 12 }, (_, i) => ({
      palletNo: `PAL/18/09/26/${i + 1}`, lotNo: '563', kg: 50,
      materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs',
    }))
    const out = zpl({ meat: duzo })
    const yFO = [...out.matchAll(/\^FO\d+,(\d+)/g)].map(m => Number(m[1]))
    expect(Math.max(...yFO)).toBeLessThan(1199)
    // Reszta pozycji ma być POLICZONA, a nie po cichu ucięta — ile dokładnie
    // wierszy się zmieści, zależy od układu i wolno to zmieniać.
    const ilePoliczono = Number(out.match(/\+ (\d+) poz/)?.[1])
    const ileWypisano = [...out.matchAll(/PAL\/18\/09\/26\/\d+/g)].length
    expect(ilePoliczono + ileWypisano).toBe(12)
    // Godziny i masownica MUSZĄ zostać — to skład ustępuje miejsca, nie one.
    expect(out).toContain('09:56')
    expect(out).toMatch(/Masownica 3/)
  })

  it('znaki sterujące ZPL z danych nie rozbijają etykiety', () => {
    const out = zpl({ recipeName: 'KIR^MIZI~X' })
    expect(out).not.toContain('KIR^MIZI')
    expect(out).toContain('KIR MIZI X')
  })

  it('brak godziny zakończenia nie wypisuje „Invalid Date"', () => {
    const out = zpl({ finishedAt: '' })
    expect(out).not.toMatch(/Invalid/i)
  })
})

/**
 * Strażnik układu: na etykiecie NIC nie może zachodzić na nic innego.
 *
 * Pierwszy układ miał kolumnę kilogramów na stałym X i przy dłuższym numerze
 * palety napisy zlewały się w jeden ciąg — na ekranie tego nie widać, bo ZPL
 * czyta dopiero drukarka. Szerokość litery liczymy ostrożnie (0,55 wysokości;
 * font A0 Zebry jest węższy), więc test jest pesymistyczny — i dobrze.
 */
describe('układ etykiety się nie zlewa', () => {
  const SZER_LITERY = 0.55   // font A0 Zebry jest węższy — model pesymistyczny

  interface Pole { x: number; y: number; w: number; h: number; tekst: string }

  /** Prostokąty WSZYSTKICH napisów etykiety — z uwzględnieniem pól dosuniętych
   *  do prawej (^FB ...,R), które zaczynają się tam, gdzie kończy się tekst. */
  const pola = (out: string): Pole[] =>
    [...out.matchAll(/\^FO(\d+),(\d+)\^A0N,(\d+),\d+(?:\^FB(\d+),\d+,\d+,(\w))?\^FD([^^]*)/g)]
      .map(m => {
        const x = Number(m[1]), y = Number(m[2]), h = Number(m[3])
        const tekst = m[6]
        const w = tekst.length * h * SZER_LITERY
        const doPrawej = m[5] === 'R'
        return { x: doPrawej ? x + Number(m[4]) - w : x, y, w, h, tekst }
      })
      .filter(p => p.tekst.trim().length > 0)

  const nachodzi = (a: Pole, b: Pole) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h

  const kolizje = (out: string): string[] => {
    const lista = pola(out)
    const zle: string[] = []
    for (let i = 0; i < lista.length; i++) {
      for (let j = i + 1; j < lista.length; j++) {
        if (nachodzi(lista[i], lista[j])) {
          zle.push(`„${lista[i].tekst}" nachodzi na „${lista[j].tekst}"`)
        }
      }
    }
    return zle
  }

  it('typowy wsad 600 kg z trzech palet', () => {
    expect(kolizje(zpl())).toEqual([])
  })

  it('czterocyfrowa waga i długie nazwy też się mieszczą', () => {
    const out = zpl({
      recipeName: 'BEYAZ AFIYET SPECJAL', kgWeighed: 1245.5, kgExpected: 1240, kgMeat: 1000,
      meat: Array.from({ length: 5 }, (_, i) => ({
        palletNo: `PAL/18/09/26/${i + 10}`, lotNo: '1563', kg: 200,
        materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs',
      })),
    })
    expect(kolizje(out)).toEqual([])
  })

  it('partia mieszana z dodatkową linijką nie psuje układu', () => {
    expect(kolizje(zpl({ batchNo: 'PP26' }))).toEqual([])
  })

  it('jedna paleta — etykieta też trzyma się kupy', () => {
    const out = zpl({
      meat: [{ palletNo: 'PAL/17/09/26/18', lotNo: '563', kg: 200,
               materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs' }],
    })
    expect(kolizje(out)).toEqual([])
  })

  it('nic nie wychodzi poza szerokość i wysokość taśmy', () => {
    for (const p of pola(zpl())) {
      expect(p.x + p.w).toBeLessThanOrEqual(799)
      expect(p.y + p.h).toBeLessThanOrEqual(1199)
    }
  })

  it('wszystkie trzy palety mieszczą się na etykiecie', () => {
    const out = zpl()
    expect(out).toContain('PAL/18/09/26/3')
    expect(out).toContain('PAL/18/09/26/4')
    expect(out).not.toMatch(/\+ \d+ poz/)
  })
})
