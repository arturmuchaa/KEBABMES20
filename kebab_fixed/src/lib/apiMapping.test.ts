import { describe, it, expect } from 'vitest'
import { mapRawBatch } from './api'

/**
 * Mapowanie odpowiedzi backendu na partię.
 *
 * Prod 2026-08-19: formularz edycji wstawał bez kalibru pojemnika, liczby
 * pojemników i palet, choć wszystko to siedziało w bazie (15 kg, 320 szt.,
 * 17 palet). Mapowanie po prostu tych kolumn nie przepisywało — typ je
 * deklarował, więc ani kompilator, ani testy logiki nie miały jak tego złapać.
 *
 * Nośniki zwrotne to saldo wobec dostawcy, nie ozdoba ekranu: zapisanie
 * dostawy z pustymi pojemnikami przeksięgowałoby je różnicowo na zero.
 */
describe('mapRawBatch — nośniki zwrotne przeżywają mapowanie', () => {
  const surowa = {
    id: 'b1', internal_batch_no: '493', kg_received: 4800,
    container_kg: 15, containers_count: 320,
    pallets_h1: 17, pallets_other: 3, pallets_other_kind: 'siatka E1',
  }

  it('przepisuje kaliber i ręczną liczbę pojemników', () => {
    const b = mapRawBatch(surowa)
    expect(b.containerKg).toBe(15)
    expect(b.containersCount).toBe(320)
  })

  it('przepisuje palety wraz z rodzajem', () => {
    const b = mapRawBatch(surowa)
    expect(b.palletsH1).toBe(17)
    expect(b.palletsOther).toBe(3)
    expect(b.palletsOtherKind).toBe('siatka E1')
  })

  it('brak kalibru zostaje NULLem — to nie to samo, co zero kilogramów', () => {
    const b = mapRawBatch({ id: 'b2', internal_batch_no: '494', kg_received: 100 })
    expect(b.containerKg).toBeNull()
    expect(b.containersCount).toBeNull()
    expect(b.palletsH1).toBe(0)
  })
})
