import { describe, it, expect } from 'vitest'

import { DEFAULT_CONTAINERS_PER_PALLET, planPalletTags } from './palletTags'

/** Dostawa z 12.08.2026: 9000 kg podzielone na dwa numery porządkowe. */
const KOKO = { containerKg: 15, containersPerPallet: DEFAULT_CONTAINERS_PER_PALLET }

describe('planPalletTags — ile zawieszek z numeru porządkowego', () => {
  it('domyślna paleta głównego dostawcy to 36 pojemników (9 na warstwę × 4)', () => {
    expect(DEFAULT_CONTAINERS_PER_PALLET).toBe(36)
  })

  it('3000 kg po 15 kg = 200 pojemników → 5 pełnych palet i 20 w reszcie', () => {
    const plan = planPalletTags({ batchNo: '471', kg: 3000, ...KOKO })

    expect(plan.containers).toBe(200)
    expect(plan.fullPallets).toBe(5)
    expect(plan.restContainers).toBe(20)
    expect(plan.tags).toHaveLength(6)
  })

  it('6000 kg po 15 kg = 400 pojemników → 11 pełnych palet i 4 w reszcie', () => {
    const plan = planPalletTags({ batchNo: '472', kg: 6000, ...KOKO })

    expect(plan.containers).toBe(400)
    expect(plan.fullPallets).toBe(11)
    expect(plan.restContainers).toBe(4)
    expect(plan.tags).toHaveLength(12)
  })

  it('pełna paleta waży kaliber × liczba pojemników, reszta tylko swoje', () => {
    const { tags } = planPalletTags({ batchNo: '471', kg: 3000, ...KOKO })

    expect(tags[0]).toMatchObject({ palletIndex: 1, palletCount: 6, containers: 36, netKg: 540, full: true })
    expect(tags[5]).toMatchObject({ palletIndex: 6, palletCount: 6, containers: 20, netKg: 300, full: false })
  })

  it('kilogramy zawieszek sumują się DOKŁADNIE do wagi numeru porządkowego', () => {
    // Waga nie dzieląca się równo przez kaliber — ostatnia paleta domyka sumę,
    // żeby zawieszki nie „wyprodukowały" kilogramów, których dostawa nie ma.
    const { tags } = planPalletTags({ batchNo: '473', kg: 3005, ...KOKO })

    const suma = tags.reduce((s, t) => s + t.netKg, 0)
    expect(Math.round(suma * 10) / 10).toBe(3005)
  })

  it('waga równa pełnym paletom nie robi pustej zawieszki na resztę', () => {
    const plan = planPalletTags({ batchNo: '474', kg: 1080, ...KOKO })

    expect(plan.containers).toBe(72)
    expect(plan.fullPallets).toBe(2)
    expect(plan.restContainers).toBe(0)
    expect(plan.tags).toHaveLength(2)
    expect(plan.tags.every(t => t.full)).toBe(true)
  })

  it('inny dostawca układa po 8 na warstwę — 32 na paletę', () => {
    const plan = planPalletTags({ batchNo: '475', kg: 3000, containerKg: 15, containersPerPallet: 32 })

    expect(plan.containers).toBe(200)
    expect(plan.fullPallets).toBe(6)
    expect(plan.restContainers).toBe(8)
    expect(plan.tags).toHaveLength(7)
  })

  it('inny kaliber zmienia liczbę pojemników, nie układ palety', () => {
    const plan = planPalletTags({ batchNo: '476', kg: 3000, containerKg: 20, containersPerPallet: 36 })

    expect(plan.containers).toBe(150)
    expect(plan.fullPallets).toBe(4)
    expect(plan.restContainers).toBe(6)
  })

  it('ręcznie przeliczony stos wygrywa z wyliczeniem z kalibru', () => {
    // 5.08.2026, partia 459: operator naliczył 199 pojemników, waga dawała 200.
    const plan = planPalletTags({ batchNo: '459', kg: 3000, containersCount: 199, ...KOKO })

    expect(plan.containers).toBe(199)
    expect(plan.fullPallets).toBe(5)
    expect(plan.restContainers).toBe(19)
  })

  it('surowiec niekalibrowany bez ręcznej liczby nie zmyśla zawieszek', () => {
    const plan = planPalletTags({ batchNo: '477', kg: 3000, containerKg: null, containersPerPallet: 36 })

    expect(plan.containers).toBeNull()
    expect(plan.tags).toEqual([])
  })

  it('niekalibrowany z ręczną liczbą pojemników drukuje się normalnie', () => {
    const plan = planPalletTags({ batchNo: '478', kg: 1000, containerKg: null, containersCount: 40, containersPerPallet: 36 })

    expect(plan.containers).toBe(40)
    expect(plan.tags).toHaveLength(2)
    expect(plan.tags[1].containers).toBe(4)
  })

  it('bezsensowna liczba pojemników na palecie nie zapętla druku', () => {
    const plan = planPalletTags({ batchNo: '479', kg: 3000, containerKg: 15, containersPerPallet: 0 })

    expect(plan.tags).toEqual([])
  })
})
