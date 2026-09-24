import { describe, it, expect } from 'vitest'

import { fmtSaldo, stanSalda, sumaZaleglosci } from './rozrachunkiView'

/**
 * Prezentacja rozrachunków.
 *
 * ZNAK: ujemne = klient jest nam winien — tak jak w arkuszu biura, gdzie
 * `SALDO W € = -15649` oznacza dług YBM GASTRO.
 */
describe('prezentacja salda', () => {
  it('dług pokazuje się jako kwota ujemna w walucie klienta', () => {
    expect(fmtSaldo(-15649, 'EUR')).toBe('-15 649,00 €')
  })

  it('złotówki mają swój symbol', () => {
    expect(fmtSaldo(-1000, 'PLN')).toBe('-1 000,00 zł')
  })

  it('nieznana waluta pokazuje swój kod, zamiast znikać', () => {
    expect(fmtSaldo(10, 'USD')).toBe('10,00 USD')
  })

  it('rozróżnia dług, zero i nadpłatę', () => {
    // Nadpłata to zaliczka, nie błąd — ekran nie może jej pokazywać
    // na czerwono razem z zaległościami.
    expect(stanSalda(-100)).toBe('dlug')
    expect(stanSalda(0)).toBe('zero')
    expect(stanSalda(250)).toBe('nadplata')
  })

  it('grosze nie robią z zera długu', () => {
    expect(stanSalda(-0.004)).toBe('zero')
    expect(stanSalda(0.004)).toBe('zero')
  })

  it('suma zaległości przelicza euro kursem, złotówki bierze wprost', () => {
    const suma = sumaZaleglosci(
      [{ saldo: -1000, waluta: 'PLN' }, { saldo: -100, waluta: 'EUR' }], 4.2668)
    expect(suma).toBeCloseTo(-1426.68, 2)
  })

  it('nadpłaty NIE pomniejszają sumy zaległości', () => {
    // Zaliczka jednego klienta nie zmniejsza długu innego — sumujemy
    // wyłącznie to, co ktoś jest winien.
    const suma = sumaZaleglosci(
      [{ saldo: -1000, waluta: 'PLN' }, { saldo: 500, waluta: 'PLN' }], 4.2668)
    expect(suma).toBeCloseTo(-1000, 2)
  })

  it('pusta lista daje zero, a nie NaN', () => {
    expect(sumaZaleglosci([], 4.2668)).toBe(0)
  })

  it('brak kursu nie zamienia euro w NaN', () => {
    // Kurs wpisuje biuro; zanim to zrobi, pozycje w euro mają zostać
    // pominięte, a nie zatruć całą sumę.
    const suma = sumaZaleglosci(
      [{ saldo: -1000, waluta: 'PLN' }, { saldo: -100, waluta: 'EUR' }], 0)
    expect(suma).toBeCloseTo(-1000, 2)
  })
})
