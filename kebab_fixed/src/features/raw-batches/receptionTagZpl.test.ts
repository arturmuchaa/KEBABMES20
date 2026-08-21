import { describe, it, expect } from 'vitest'

import { LABEL_H_MM, LABEL_W_MM, mmToDots } from '@/features/deboning/byproductLabelZpl'
import { receptionTagZpl, shortenSupplier } from './receptionTagZpl'

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
