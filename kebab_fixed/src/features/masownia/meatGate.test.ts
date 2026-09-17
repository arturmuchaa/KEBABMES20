/**
 * Bramka partii: panel puszcza tylko to mięso, które biuro wskazało w planie
 * masowania. Czysta logika — bez DOM i bez sieci.
 */
import { describe, it, expect } from 'vitest'
import { gateMeatTiles, officeChoiceLabel } from './meatGate'
import type { MeatTile } from './meatTiles'

const tile = (over: Partial<MeatTile> = {}): MeatTile => ({
  key: 'pallet:p1', kind: 'pallet', palletId: 'p1', palletNo: 'PAL/17/09/26/1',
  lots: [{ lotNo: '511', meatStockId: 'ms-511', kg: 200 }],
  kgFree: 200, expiryDate: '2026-09-03', materialName: 'Mięso z/s',
  materialTypeId: 'mat-mieso-zs', mixed: false, ...over,
})

describe('gateMeatTiles', () => {
  it('bez partii w zleceniu puszcza wszystko', () => {
    // Na produkcji to częsty przypadek: 8 z 12 ostatnich zleceń nie ma partii.
    const out = gateMeatTiles([tile(), tile({ key: 'pallet:p2', lots: [{ lotNo: '513', meatStockId: 'ms-513', kg: 200 }] })], [])
    expect(out.every(t => t.allowed)).toBe(true)
    expect(out.every(t => t.reason === '')).toBe(true)
  })

  it('z partiami biura puszcza tylko wskazane', () => {
    const out = gateMeatTiles(
      [tile(), tile({ key: 'pallet:p2', lots: [{ lotNo: '513', meatStockId: 'ms-513', kg: 200 }] })],
      [{ meatLotNo: '511' }],
    )
    expect(out[0].allowed).toBe(true)
    expect(out[1].allowed).toBe(false)
  })

  it('kafelek odrzucony mówi, co wybrało biuro', () => {
    const [t] = gateMeatTiles([tile({ lots: [{ lotNo: '513', meatStockId: 'ms-513', kg: 200 }] })], [{ meatLotNo: '511' }])
    expect(t.reason).toBe('Biuro wybrało partię 511')
  })

  it('kafelki odrzucone ZOSTAJĄ na liście i w tej samej kolejności', () => {
    const wejscie = [tile({ key: 'a' }), tile({ key: 'b', lots: [{ lotNo: '999', meatStockId: 'ms-999', kg: 10 }] }), tile({ key: 'c' })]
    expect(gateMeatTiles(wejscie, [{ meatLotNo: '511' }]).map(t => t.key)).toEqual(['a', 'b', 'c'])
  })

  it('paleta mieszana przechodzi tylko wtedy, gdy OBIE partie są w planie', () => {
    const mieszana = tile({
      mixed: true,
      lots: [{ lotNo: '511', meatStockId: 'ms-511', kg: 60 }, { lotNo: '512', meatStockId: 'ms-512', kg: 140 }],
    })
    expect(gateMeatTiles([mieszana], [{ meatLotNo: '511' }])[0].allowed).toBe(false)
    expect(gateMeatTiles([mieszana], [{ meatLotNo: '511' }, { meatLotNo: '512' }])[0].allowed).toBe(true)
  })

  it('paleta mieszana odrzucona nazywa partię spoza planu', () => {
    const mieszana = tile({
      mixed: true,
      lots: [{ lotNo: '511', meatStockId: 'ms-511', kg: 60 }, { lotNo: '512', meatStockId: 'ms-512', kg: 140 }],
    })
    expect(gateMeatTiles([mieszana], [{ meatLotNo: '511' }])[0].reason).toBe('Na palecie jest też partia 512, spoza planu')
  })

  it('partia w całości zarezerwowana przez biuro przechodzi (przypadek 524)', () => {
    // 524 ma kg_available=0 przy kg_reserved=600 — kafelek powstaje ze zlecenia,
    // więc bramka nie ma prawa go odrzucić.
    const filet = tile({ key: 'lot:ms-524', kind: 'lot', palletId: '', palletNo: '',
      lots: [{ lotNo: '524', meatStockId: 'ms-524', kg: 600 }], materialName: 'Filet z mostka wołowego' })
    expect(gateMeatTiles([filet], [{ meatLotNo: '524' }])[0].allowed).toBe(true)
  })

  it('pusty numer partii u biura nie otwiera bramki', () => {
    expect(gateMeatTiles([tile()], [{ meatLotNo: '' }])[0].allowed).toBe(true)
  })
})

describe('officeChoiceLabel', () => {
  it('wylicza partie po przecinku', () => {
    expect(officeChoiceLabel([{ meatLotNo: '511' }, { meatLotNo: '512' }])).toBe('511, 512')
  })

  it('bez partii daje pusty napis', () => {
    expect(officeChoiceLabel([])).toBe('')
  })
})
