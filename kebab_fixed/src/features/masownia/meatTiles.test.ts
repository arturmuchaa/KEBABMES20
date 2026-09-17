/**
 * Kafelki mięsa na panelu masowania — czysta logika, bez DOM i bez sieci.
 */
import { describe, it, expect } from 'vitest'
import { buildMeatTiles, zrodloKg, type TileLot, type TilePallet } from './meatTiles'

const lot = (over: Partial<TileLot> = {}): TileLot => ({
  meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s', materialTypeId: 'mat-mieso-zs',
  kgFree: 1800, expiryDate: '2026-09-03', ...over,
})

const pallet = (over: Partial<TilePallet> = {}): TilePallet => ({
  id: 'p1', palletNo: 'PAL/17/09/26/1', kgNet: 200, expiryDate: '2026-09-03',
  lots: [{ lotNo: '511', kg: 200 }], ...over,
})

describe('buildMeatTiles', () => {
  it('robi kafelek z palety i zostawia resztę partii na paleciak', () => {
    const tiles = buildMeatTiles({ pallets: [pallet()], lots: [lot({ kgFree: 500 })], taken: {} })
    expect(tiles.map(t => [t.kind, t.kgFree])).toEqual([['pallet', 200], ['lot', 300]])
  })

  it('paleta częściowo pobrana pokazuje tylko to, co zostało', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet()], lots: [lot({ kgFree: 200 })], taken: { p1: 140 },
    })
    expect(tiles.find(t => t.kind === 'pallet')!.kgFree).toBe(60)
  })

  it('paleta pobrana do zera znika z ekranu', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet()], lots: [lot({ kgFree: 0 })], taken: { p1: 200 },
    })
    expect(tiles).toEqual([])
  })

  it('partia bez palet (filet z mostka) dostaje kafelek paleciaka', () => {
    const tiles = buildMeatTiles({
      pallets: [],
      lots: [lot({ meatStockId: 'ms-524', lotNo: '524', materialName: 'Filet z mostka wołowego', kgFree: 600 })],
      taken: {},
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0]).toMatchObject({ kind: 'lot', kgFree: 600, materialName: 'Filet z mostka wołowego', mixed: false })
  })

  it('paleta z dwóch partii jest oznaczona jako mieszana', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet({ lots: [{ lotNo: '511', kg: 60 }, { lotNo: '512', kg: 140 }] })],
      lots: [lot({ kgFree: 60 }), lot({ meatStockId: 'ms-512', lotNo: '512', kgFree: 140 })],
      taken: {},
    })
    const p = tiles.find(t => t.kind === 'pallet')!
    expect(p.mixed).toBe(true)
    expect(p.lots.map(l => l.lotNo)).toEqual(['511', '512'])
  })

  it('kafelek partii nie schodzi poniżej zera, gdy palety biorą więcej niż wolne kg', () => {
    // Partia 524: kg_available=0 przy kg_reserved=600 — rezerwacja biura.
    const tiles = buildMeatTiles({
      pallets: [pallet({ lots: [{ lotNo: '524', kg: 200 }] })],
      lots: [lot({ meatStockId: 'ms-524', lotNo: '524', kgFree: 0 })],
      taken: {},
    })
    expect(tiles.filter(t => t.kind === 'lot')).toEqual([])
  })

  it('wiąże paletę z meat_stock po numerze partii', () => {
    const tiles = buildMeatTiles({ pallets: [pallet()], lots: [lot()], taken: {} })
    expect(tiles[0].lots[0].meatStockId).toBe('ms-511')
  })
})

describe('skąd się bierze mięso — słupek czy waga pod potrzebę', () => {
  it('kafelek partii niesie rodzaj materiału', () => {
    const tiles = buildMeatTiles({
      pallets: [],
      lots: [lot({ meatStockId: 'ms-524', lotNo: '524', materialTypeId: 'mat-wolowina-mostek',
                   materialName: 'Filet z mostka wołowego', kgFree: 600 })],
      taken: {},
    })
    expect(tiles[0].materialTypeId).toBe('mat-wolowina-mostek')
  })

  it('mostek tnie się i waży pod potrzebę', () => {
    // Przychodzi w kartonach bez kalibru — hala tnie na płaty i waży tyle,
    // ile trzeba na wsad.
    expect(zrodloKg('mat-wolowina-mostek')).toBe('utnij i zważ')
    expect(zrodloKg('mat-mieso-indyk')).toBe('utnij i zważ')
  })

  it('z/s POZA słupkiem to mięso jeszcze nie zważone zbiorczo', () => {
    // Po rozbiorze z/s idzie na słupki 100/200/600/800 kg. Luźne kilogramy
    // znaczą, że ważenie zbiorcze tej partii jeszcze się nie odbyło — panel
    // ma to powiedzieć wprost, a nie udawać gotowy wsad.
    expect(zrodloKg('mat-mieso-zs')).toBe('nie na słupku')
  })
})

describe('paleta zyje tylko tak dlugo, jak jej partia', () => {
  it('paleta partii bez miesa NIE pokazuje sie wcale', () => {
    // Na produkcji 524 z 693 palet nalezalo do partii z zerowym stanem —
    // mieso dawno poszlo, a kafelek zostawal i zasmiecal ekran masowni.
    const tiles = buildMeatTiles({
      pallets: [pallet({ id: 'stara', palletNo: 'PAL/01/08/26/1' })],
      lots: [lot({ kgFree: 0 })],
      taken: {},
    })
    expect(tiles).toEqual([])
  })

  it('partia starcza na czesc palet — reszta znika', () => {
    // Zostalo 250 kg partii, a na papierze stoja trzy palety po 200 kg.
    // Fizycznie sa najwyzej pol torej: pokazujemy 200 + 50, trzeciej nie ma.
    const tiles = buildMeatTiles({
      pallets: [
        pallet({ id: 'p1', palletNo: 'PAL/1' }),
        pallet({ id: 'p2', palletNo: 'PAL/2' }),
        pallet({ id: 'p3', palletNo: 'PAL/3' }),
      ],
      lots: [lot({ kgFree: 250 })],
      taken: {},
    })
    expect(tiles.map(t => [t.palletNo, t.kgFree])).toEqual([['PAL/1', 200], ['PAL/2', 50]])
  })

  it('palety ida najstarsza pierwsza — FEFO zostaje zachowane', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet({ id: 'a', palletNo: 'PAL/A' }), pallet({ id: 'b', palletNo: 'PAL/B' })],
      lots: [lot({ kgFree: 200 })],
      taken: {},
    })
    expect(tiles.map(t => t.palletNo)).toEqual(['PAL/A'])
  })

  it('nadwyzka partii ponad palety zostaje na kafelku partii', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet({ id: 'p1', palletNo: 'PAL/1' })],
      lots: [lot({ kgFree: 300 })],
      taken: {},
    })
    expect(tiles.map(t => [t.kind, t.kgFree])).toEqual([['pallet', 200], ['lot', 100]])
  })

  it('paleta mieszana ograniczona partia, ktorej zabraklo', () => {
    // 511 ma jeszcze 60 kg, 512 nie ma nic — paleta niesie tylko to, co zostalo.
    const tiles = buildMeatTiles({
      pallets: [pallet({ id: 'pm', palletNo: 'PAL/MIX',
                         lots: [{ lotNo: '511', kg: 60 }, { lotNo: '512', kg: 140 }] })],
      lots: [lot({ kgFree: 60 }), lot({ meatStockId: 'ms-512', lotNo: '512', kgFree: 0 })],
      taken: {},
    })
    expect(tiles).toHaveLength(1)
    expect(tiles[0].kgFree).toBe(60)
    expect(tiles[0].lots.map(l => l.lotNo)).toEqual(['511'])
  })
})

describe('rezerwacja wlasnego zlecenia nie chowa miesa', () => {
  it('kilogramy zarezerwowane NA TO zlecenie sa do wziecia', () => {
    // Biuro planujac zlecenie rezerwuje partie. Gdyby panel odejmowal kazda
    // rezerwacje, operator nie moglby wziac miesa, ktore biuro mu przypisalo —
    // partia 563 pokazywala 0 kg przy 858 kg na stanie i 1200 kg rezerwacji.
    const tiles = buildMeatTiles({
      pallets: [],
      lots: [lot({ kgFree: 0, reservedByOrder: { o1: 1200 } })],
      taken: {},
      orderId: 'o1',
    })
    expect(tiles[0].kgFree).toBe(1200)
  })

  it('rezerwacja INNEGO zlecenia dalej chowa mieso', () => {
    const tiles = buildMeatTiles({
      pallets: [],
      lots: [lot({ kgFree: 0, reservedByOrder: { inne: 1200 } })],
      taken: {},
      orderId: 'o1',
    })
    expect(tiles).toEqual([])
  })

  it('bez wskazanego zlecenia nic sie nie oddaje', () => {
    const tiles = buildMeatTiles({
      pallets: [],
      lots: [lot({ kgFree: 0, reservedByOrder: { o1: 1200 } })],
      taken: {},
    })
    expect(tiles).toEqual([])
  })

  it('paleta tez korzysta z oddanej rezerwacji', () => {
    const tiles = buildMeatTiles({
      pallets: [pallet({ id: 'p1', palletNo: 'PAL/1' })],
      lots: [lot({ kgFree: 0, reservedByOrder: { o1: 400 } })],
      taken: {},
      orderId: 'o1',
    })
    expect(tiles.map(t => [t.kind, t.kgFree])).toEqual([['pallet', 200], ['lot', 200]])
  })
})
