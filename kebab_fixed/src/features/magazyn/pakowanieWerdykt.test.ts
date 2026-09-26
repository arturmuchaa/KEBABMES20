/**
 * Werdykt skanu sztuki — trzy ścieżki spec §5.3 jako czysta logika.
 *
 * Najważniejszy test tego pliku to „ACTIVE → cisza": jeśli kiedyś ktoś doda
 * tu „miły zielony błysk", pakowanie 90 sztuk znowu zacznie się zatrzymywać
 * na każdej z nich.
 */
import { describe, it, expect } from 'vitest'
import { werdyktPakowania } from './pakowanieWerdykt'
import type { OtwartyKarton, SkanPakowania } from '@/lib/api'

const K = (id: string, nr: string, klient: string): OtwartyKarton => ({
  kind: 'stock', id, cartonNo: nr, clientName: klient, orderNo: '', palletNo: 0,
  deliveryDate: '', openedAt: '', targetQty: 60, packedQty: 28, lines: [],
})

const skan = (x: Partial<SkanPakowania>): SkanPakowania =>
  ({ result: 'ACTIVE', unit: 'YALCIN · KIRMIZI 15 kg', container: null, ...x })

describe('werdykt pakowania', () => {
  it('do aktywnego kartonu: CISZA — ani dźwięku, ani alarmu', () => {
    const w = werdyktPakowania(skan({ container: K('k1', '000318', 'YALCIN') }), 'k1')
    expect(w.dzwiek).toBe('cisza')
    expect(w.alarm).toBeNull()
    expect(w.uwaga).toBeNull()
    expect(w.aktywny).toBe('k1')
  })

  it('pierwszy skan bez aktywnego kartonu USTAWIA aktywny', () => {
    const w = werdyktPakowania(skan({ container: K('k1', '000318', 'YALCIN') }), null)
    expect(w.aktywny).toBe('k1')
    expect(w.dzwiek).toBe('cisza')
  })

  it('do innego kartonu: krótki ton i bursztyn w pasku, aktywny ZOSTAJE', () => {
    const w = werdyktPakowania(skan({ result: 'OTHER', unit: "DEM`S · YAPRAK 25 kg",
      container: K('k3', '000320', "DEM`S") }), 'k1')
    expect(w.dzwiek).toBe('inny')
    expect(w.aktywny).toBe('k1')
    expect(w.uwaga?.naglowek).toBe('ODŁÓŻ DO KARTONU 000320')
    expect(w.uwaga?.szczegol).toContain('000320')
    expect(w.alarm).toBeNull()
  })

  it('bez miejsca: czerwony alarm, nic nie zapisane', () => {
    const w = werdyktPakowania(skan({ result: 'NO_PLACE', unit: 'BULLI · KIRMIZI 10 kg' }), 'k1')
    expect(w.dzwiek).toBe('blad')
    expect(w.alarm?.ton).toBe('blad')
    expect(w.alarm?.szczegol).toContain('BULLI')
    expect(w.alarm?.gdzie).toMatch(/biuro/i)
    expect(w.alarm?.naglowek).toBe('BRAK KARTONU DLA TEJ SZTUKI')
  })

  it('już spakowana w innym kartonie mówi W KTÓRYM', () => {
    const w = werdyktPakowania(skan({ result: 'ALREADY', where: '000320', sameCarton: false }), 'k1')
    expect(w.alarm?.gdzie).toBe('KARTON 000320')
  })

  it('ten sam kod drugi raz do tego samego kartonu to nie jest wpadka', () => {
    const w = werdyktPakowania(skan({ result: 'ALREADY', where: '000318', sameCarton: true }), 'k1')
    expect(w.alarm).toBeNull()
    expect(w.dzwiek).toBe('cisza')
  })

  it('aktywny karton zamknięty przez drugą osobę — wyraźnie to mówimy', () => {
    const w = werdyktPakowania(skan({ activeClosed: true,
      container: K('k2', '000322', 'YALCIN') }), 'k1')
    expect(w.aktywny).toBe('k2')
    expect(w.uwaga?.naglowek).toMatch(/ZAMKNIĘTY/)
    expect(w.dzwiek).toBe('inny')
  })

  it('karton zapełniony tym skanem: zostaje aktywny, uwaga „pełny"', () => {
    const w = werdyktPakowania(skan({ full: true, container: K('k1', '000318', 'YALCIN') }), 'k1')
    expect(w.uwaga?.naglowek).toMatch(/PEŁNY/)
    expect(w.pelny).toBe('000318')
  })

  it('niewyprodukowana i nieznany kod to błędy', () => {
    expect(werdyktPakowania(skan({ result: 'NOT_PRODUCED' }), 'k1').alarm?.ton).toBe('blad')
    expect(werdyktPakowania(skan({ result: 'INVALID', unit: '' }), 'k1').alarm?.naglowek)
      .toMatch(/NIEZNANY/)
  })
})
