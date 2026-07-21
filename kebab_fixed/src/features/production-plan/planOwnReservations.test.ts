/**
 * Edycja planu: mięso zarezerwowane PRZEZ TEN plan musi być widoczne jako wolne.
 *
 * Bug: `kg_free = kg_available - kg_reserved`, więc po zapisaniu planu jego
 * własne rezerwacje zjadały pulę i przy ponownej edycji WSZYSTKIE pozycje
 * świeciły na czerwono („brakuje X kg mięsa"), mimo że backend przy zapisie
 * i tak najpierw zwalnia rezerwacje tego planu (_restore_reservations).
 * Jedynym obejściem było odznaczenie i ponowne zaznaczenie partii.
 */
import { describe, it, expect } from 'vitest'
import { ownReservedByBatch, withOwnReservations } from './planOwnReservations'

describe('ownReservedByBatch', () => {
  it('sumuje kg z pozycji czystych (jedna partia = jeden wpis)', () => {
    const lines = [
      { qtyDone: 0, batchAllocation: { 'B-1': { kg: 120, batch_id: 'id-1', pieces: 6 } } },
      { qtyDone: 0, batchAllocation: { 'B-1': { kg: 80, batch_id: 'id-1', pieces: 4 } } },
    ]
    expect(ownReservedByBatch(lines)).toEqual({ 'id-1': 200 })
  })

  it('sumuje kg ze sztuki mieszanej (kubełek parts / PM)', () => {
    const lines = [
      {
        qtyDone: 0,
        batchAllocation: {
          'B-1': { kg: 100, batch_id: 'id-1', pieces: 5 },
          __MIXED__: {
            pieces: 1,
            parts: {
              'B-1': { kg: 7, batch_id: 'id-1' },
              'B-2': { kg: 13, batch_id: 'id-2' },
            },
          },
        },
      },
    ]
    expect(ownReservedByBatch(lines)).toEqual({ 'id-1': 107, 'id-2': 13 })
  })

  it('POMIJA pozycje zamrożone (qtyDone>0) — backend ich rezerwacji nie zwalnia', () => {
    const lines = [
      { qtyDone: 3, batchAllocation: { 'B-1': { kg: 60, batch_id: 'id-1' } } },
      { qtyDone: 0, batchAllocation: { 'B-1': { kg: 40, batch_id: 'id-1' } } },
    ]
    expect(ownReservedByBatch(lines)).toEqual({ 'id-1': 40 })
  })

  it('znosi śmieci: brak alokacji, kg<=0, batch_id puste', () => {
    const lines = [
      { qtyDone: 0 },
      { qtyDone: 0, batchAllocation: {} },
      { qtyDone: 0, batchAllocation: { 'B-1': { kg: 0, batch_id: 'id-1' } } },
      { qtyDone: 0, batchAllocation: { 'B-2': { kg: 10 } } },
    ]
    expect(ownReservedByBatch(lines)).toEqual({})
  })
})

describe('withOwnReservations', () => {
  const seasoned = [
    { id: 'id-1', kgAvailable: 300, kgFree: 100 }, // 200 kg trzyma edytowany plan
    { id: 'id-2', kgAvailable: 150, kgFree: 150 },
  ]

  it('oddaje pule zarezerwowane przez edytowany plan (to jest ten bug)', () => {
    const lines = [{ qtyDone: 0, batchAllocation: { 'B-1': { kg: 200, batch_id: 'id-1' } } }]
    const out = withOwnReservations(seasoned, lines)
    expect(out.find(s => s.id === 'id-1')!.kgFree).toBe(300)
    expect(out.find(s => s.id === 'id-2')!.kgFree).toBe(150)
  })

  it('nigdy nie przekracza kgAvailable (rezerwacja nie tworzy mięsa)', () => {
    const lines = [{ qtyDone: 0, batchAllocation: { 'B-1': { kg: 9999, batch_id: 'id-1' } } }]
    const out = withOwnReservations(seasoned, lines)
    expect(out.find(s => s.id === 'id-1')!.kgFree).toBe(300)
  })

  it('tryb tworzenia planu (brak pozycji) nie zmienia nic', () => {
    expect(withOwnReservations(seasoned, [])).toEqual(seasoned)
    expect(withOwnReservations(seasoned, undefined)).toEqual(seasoned)
  })

  it('nie gubi pozostałych pól partii', () => {
    const rich = [{ id: 'id-1', kgAvailable: 300, kgFree: 100, recipeId: 'r1', batchNo: 'B-1' }]
    const out = withOwnReservations(rich, [
      { qtyDone: 0, batchAllocation: { 'B-1': { kg: 50, batch_id: 'id-1' } } },
    ])
    expect(out[0]).toMatchObject({ recipeId: 'r1', batchNo: 'B-1', kgFree: 150 })
  })
})
