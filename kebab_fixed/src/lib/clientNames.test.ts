/**
 * Nazwy odbiorcy na papierze: nazwa handlowa firmy i WŁASNA nazwa receptury.
 *
 * Właściciel (2026-09-12): „na palety … klient i receptura, ale zgodnie
 * z nazwą zdefiniowaną w ustawieniach, czyli np. POLAT BEYAZ AFIYET,
 * a w ustawieniach ma BEYAZ, czyli na karton pokazuje POLAT BEYAZ".
 */
import { describe, it, expect } from 'vitest'

import { buildClientNameIndex, resolveClientName, resolveRecipeName } from './clientNames'

const KARTOTEKA = [
  {
    id: 'c-polat', name: 'POLAT GIDA SP. Z O.O.', displayName: 'POLAT',
    hdiRecipeNames: [{ recipeId: 'r-beyaz', name: 'BEYAZ' }],
  },
  {
    id: 'c-truva', name: 'TRUVA FOOD GMBH', displayName: 'TRUVA',
    hdiRecipeNames: [],
  },
]

describe('resolveRecipeName — własna nazwa receptury odbiorcy', () => {
  it('podmienia nazwę receptury na tę z kartoteki odbiorcy', () => {
    const idx = buildClientNameIndex(KARTOTEKA)
    expect(resolveRecipeName(idx, { id: 'c-polat' }, 'r-beyaz', 'BEYAZ AFIYET')).toBe('BEYAZ')
  })

  it('odbiorca bez własnej nazwy zostaje przy nazwie receptury', () => {
    const idx = buildClientNameIndex(KARTOTEKA)
    expect(resolveRecipeName(idx, { id: 'c-truva' }, 'r-beyaz', 'BEYAZ AFIYET')).toBe('BEYAZ AFIYET')
  })

  it('własna nazwa obowiązuje TYLKO swojego odbiorcę', () => {
    const idx = buildClientNameIndex(KARTOTEKA)
    expect(resolveRecipeName(idx, { id: 'c-polat' }, 'r-kirmizi', 'KIRMIZI')).toBe('KIRMIZI')
  })

  it('trafia po nazwie firmy, gdy ekran nie ma id odbiorcy', () => {
    const idx = buildClientNameIndex(KARTOTEKA)
    expect(resolveRecipeName(idx, { name: 'POLAT GIDA SP. Z O.O.' }, 'r-beyaz', 'BEYAZ AFIYET'))
      .toBe('BEYAZ')
  })

  it('dwie firmy o tej samej nazwie: bez id zostaje nazwa receptury', () => {
    // Pułapka YALCIN — dwie karty o tej samej nazwie handlowej. Zgadywanie,
    // o którą chodzi, wydrukowałoby cudzą nazwę na palecie.
    const idx = buildClientNameIndex([
      { id: 'c-a', name: 'YALCIN', displayName: 'YALCIN',
        hdiRecipeNames: [{ recipeId: 'r-beyaz', name: 'BEYAZ' }] },
      { id: 'c-b', name: 'YALCIN', displayName: 'YALCIN', hdiRecipeNames: [] },
    ])
    expect(resolveRecipeName(idx, { name: 'YALCIN' }, 'r-beyaz', 'BEYAZ AFIYET')).toBe('BEYAZ AFIYET')
    expect(resolveRecipeName(idx, { id: 'c-a' }, 'r-beyaz', 'BEYAZ AFIYET')).toBe('BEYAZ')
  })

  it('bez kartoteki i bez id receptury oddaje nazwę wejściową', () => {
    const idx = buildClientNameIndex(KARTOTEKA)
    expect(resolveRecipeName(null, { id: 'c-polat' }, 'r-beyaz', 'BEYAZ AFIYET')).toBe('BEYAZ AFIYET')
    expect(resolveRecipeName(idx, { id: 'c-polat' }, '', 'BEYAZ AFIYET')).toBe('BEYAZ AFIYET')
  })

  it('czyta też surowe snake_case z backendu', () => {
    const idx = buildClientNameIndex([
      { id: 'c-polat', name: 'POLAT GIDA SP. Z O.O.', display_name: 'POLAT',
        hdi_recipe_names: [{ recipe_id: 'r-beyaz', name: 'BEYAZ' }] },
    ])
    expect(resolveRecipeName(idx, { id: 'c-polat' }, 'r-beyaz', 'BEYAZ AFIYET')).toBe('BEYAZ')
    expect(resolveClientName(idx, 'POLAT GIDA SP. Z O.O.')).toBe('POLAT')
  })
})

describe('resolveClientName — nazwa handlowa', () => {
  it('podmienia pełną firmę na nazwę handlową, a nieznaną zostawia', () => {
    const idx = buildClientNameIndex(KARTOTEKA)
    expect(resolveClientName(idx, 'POLAT GIDA SP. Z O.O.')).toBe('POLAT')
    expect(resolveClientName(idx, 'NOWY KLIENT')).toBe('NOWY KLIENT')
  })
})
