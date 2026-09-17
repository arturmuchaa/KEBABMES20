/**
 * Kafelki mięsa na panelu masowania — czysta logika, bez DOM i bez sieci.
 */
import { describe, it, expect } from 'vitest'
import { buildMeatTiles, type TileLot, type TilePallet } from './meatTiles'

const lot = (over: Partial<TileLot> = {}): TileLot => ({
  meatStockId: 'ms-511', lotNo: '511', materialName: 'Mięso z/s',
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
