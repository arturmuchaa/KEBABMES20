/**
 * Pozycje dostawy DDFiP — składnik czy opakowanie.
 *
 * Karta 1.3.1 to „Rejestr przyjęcia OPAKOWAŃ, przypraw i dodatków
 * technologicznych", więc jedno auto wiezie oba rodzaje. Każdy idzie na inny
 * magazyn, a magazyn opakowań nie ma kartoteki — nazwę wolno wpisać z ręki.
 */
import { describe, it, expect } from 'vitest'
import { pozycjaGotowa, opisMagazynow, type Pozycja } from './IngredientReceptionPage'

const poz = (p: Partial<Pozycja> = {}): Pozycja => ({
  kind: 'ingredient', ingredientId: '', packagingId: '', nazwa: '',
  qty: '', batchNo: '', expiryDate: '', pricePerUnit: '', ...p,
})

describe('pozycjaGotowa', () => {
  it('składnik potrzebuje wyboru z kartoteki', () => {
    expect(pozycjaGotowa(poz({ qty: '10' }))).toBe(false)
    expect(pozycjaGotowa(poz({ ingredientId: 'ing-sol', qty: '10' }))).toBe(true)
  })

  it('opakowanie wchodzi na samą NAZWĘ — magazyn nie ma kartoteki', () => {
    expect(pozycjaGotowa(poz({ kind: 'packaging', nazwa: 'Folia stretch', qty: '120' })))
      .toBe(true)
  })

  it('opakowanie wchodzi też po wyborze istniejącej pozycji magazynu', () => {
    expect(pozycjaGotowa(poz({ kind: 'packaging', packagingId: 'pak-1', qty: '50' })))
      .toBe(true)
  })

  it('opakowanie bez nazwy i bez wyboru odpada', () => {
    expect(pozycjaGotowa(poz({ kind: 'packaging', qty: '50' }))).toBe(false)
  })

  it('sama biała spacja to nie nazwa', () => {
    expect(pozycjaGotowa(poz({ kind: 'packaging', nazwa: '   ', qty: '50' }))).toBe(false)
  })

  it('zerowa i ujemna ilość odpada niezależnie od rodzaju', () => {
    expect(pozycjaGotowa(poz({ ingredientId: 'ing-sol', qty: '0' }))).toBe(false)
    expect(pozycjaGotowa(poz({ kind: 'packaging', nazwa: 'Folia', qty: '-5' }))).toBe(false)
  })

  it('identyfikator składnika NIE ratuje pozycji opakowaniowej', () => {
    // Przełącznik rodzaju czyści wybór; gdyby przestał, ten test zapali się
    // zanim dokument pojedzie na backend z pozycją nie z tej listy.
    expect(pozycjaGotowa(poz({ kind: 'packaging', ingredientId: 'ing-sol', qty: '10' })))
      .toBe(false)
  })
})

describe('opisMagazynow', () => {
  it('mówi wprost, ile pozycji idzie na który magazyn', () => {
    const opis = opisMagazynow([
      poz({ ingredientId: 'a', qty: '1' }),
      poz({ ingredientId: 'b', qty: '1' }),
      poz({ kind: 'packaging', nazwa: 'Folia', qty: '1' }),
    ])
    expect(opis).toBe('2 poz. na magazyn przypraw · 1 poz. na magazyn tulei i opakowań — pod tym numerem dokumentu.')
  })

  it('nie wspomina o magazynie, na który nic nie idzie', () => {
    const opis = opisMagazynow([poz({ kind: 'packaging', nazwa: 'Karton', qty: '1' })])
    expect(opis).toBe('1 poz. na magazyn tulei i opakowań — pod tym numerem dokumentu.')
    expect(opis).not.toContain('przypraw')
  })

  it('pusty dokument nie kłamie liczbami', () => {
    expect(opisMagazynow([])).toBe('Pozycje wejdą na magazyn pod tym numerem dokumentu.')
  })
})
