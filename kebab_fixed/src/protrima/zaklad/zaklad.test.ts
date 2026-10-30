import { describe, it, expect } from 'vitest'
import { logoDokumentu, profilZakladu, PROFIL_DOMYSLNY } from './zaklad'
import { STANDARD_SZTUK, MAX_KG_RESZTKI, sztukNaPalete } from '../modules/orders/palety/model'

/** Wdrożenie w innym zakładzie nie może nieść danych pierwszego zakładu. */
describe('profil zakładu', () => {
  it('logo pierwszego zakładu tylko na jego dokumentach — inny zakład dostaje dokument bez cudzego logo', () => {
    expect(logoDokumentu({ name: 'FHUP Marek Księżyc' })).toBe('/logo-ksiezyc-print.png')
    expect(logoDokumentu({ name: 'Zakład Mięsny Nowak Sp. z o.o.' })).toBeNull()
    expect(logoDokumentu(null)).toBeNull()
  })
  it('moduł palet bierze standard pakowania z profilu zakładu, nie z własnych stałych', () => {
    expect(profilZakladu()).toBe(PROFIL_DOMYSLNY)
    expect(STANDARD_SZTUK).toBe(PROFIL_DOMYSLNY.pakowanie.sztukNaPalete)
    expect(MAX_KG_RESZTKI).toBe(PROFIL_DOMYSLNY.pakowanie.maxKgResztki)
    expect(sztukNaPalete(50)).toBe(15)
    // Waga spoza standardu — paleta ok. kgPaletyNietypowej.
    expect(sztukNaPalete(45)).toBe(Math.floor(PROFIL_DOMYSLNY.pakowanie.kgPaletyNietypowej / 45))
  })
})
