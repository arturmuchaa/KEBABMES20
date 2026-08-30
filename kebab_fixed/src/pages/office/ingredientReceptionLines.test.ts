/**
 * Pozycje dostawy DDFiP — składnik czy opakowanie.
 *
 * Karta 1.3.1 to „Rejestr przyjęcia OPAKOWAŃ, przypraw i dodatków
 * technologicznych", więc jedno auto wiezie oba rodzaje, a każdy idzie na
 * inny magazyn. Oba WYBIERA się z listy: magazyn opakowań scala pozycje po
 * nazwie, więc literówka nie podniosłaby alarmu, tylko po cichu założyła
 * drugą pozycję i rozbiła stan na dwa wiersze.
 */
import { describe, it, expect } from 'vitest'
import { pozycjaGotowa, opisMagazynow, type Pozycja } from './IngredientReceptionPage'

const poz = (p: Partial<Pozycja> = {}): Pozycja => ({
  kind: 'ingredient', ingredientId: '', packagingId: '',
  qty: '', batchNo: '', expiryDate: '', pricePerUnit: '', ...p,
})

describe('pozycjaGotowa', () => {
  it('składnik potrzebuje wyboru z kartoteki', () => {
    expect(pozycjaGotowa(poz({ qty: '10' }))).toBe(false)
    expect(pozycjaGotowa(poz({ ingredientId: 'ing-sol', qty: '10' }))).toBe(true)
  })

  it('opakowanie potrzebuje wyboru z magazynu', () => {
    expect(pozycjaGotowa(poz({ kind: 'packaging', qty: '120' }))).toBe(false)
    expect(pozycjaGotowa(poz({ kind: 'packaging', packagingId: 'pak-1', qty: '120' })))
      .toBe(true)
  })

  it('zerowa i ujemna ilość odpada niezależnie od rodzaju', () => {
    expect(pozycjaGotowa(poz({ ingredientId: 'ing-sol', qty: '0' }))).toBe(false)
    expect(pozycjaGotowa(poz({ kind: 'packaging', packagingId: 'pak-1', qty: '-5' })))
      .toBe(false)
  })

  it('identyfikator składnika NIE ratuje pozycji opakowaniowej', () => {
    // Przełącznik rodzaju czyści wybór; gdyby przestał, ten test zapali się
    // zanim dokument pojedzie na backend z pozycją nie z tej listy.
    expect(pozycjaGotowa(poz({ kind: 'packaging', ingredientId: 'ing-sol', qty: '10' })))
      .toBe(false)
  })

  it('identyfikator opakowania NIE ratuje pozycji składnikowej', () => {
    expect(pozycjaGotowa(poz({ kind: 'ingredient', packagingId: 'pak-1', qty: '10' })))
      .toBe(false)
  })
})

describe('opisMagazynow', () => {
  it('mówi wprost, ile pozycji idzie na który magazyn', () => {
    const opis = opisMagazynow([
      poz({ ingredientId: 'a', qty: '1' }),
      poz({ ingredientId: 'b', qty: '1' }),
      poz({ kind: 'packaging', packagingId: 'pak-1', qty: '1' }),
    ])
    expect(opis).toBe('2 poz. na magazyn przypraw · 1 poz. na magazyn tulei i opakowań — pod tym numerem dokumentu.')
  })

  it('nie wspomina o magazynie, na który nic nie idzie', () => {
    const opis = opisMagazynow([poz({ kind: 'packaging', packagingId: 'pak-1', qty: '1' })])
    expect(opis).toBe('1 poz. na magazyn tulei i opakowań — pod tym numerem dokumentu.')
    expect(opis).not.toContain('przypraw')
  })

  it('pusty dokument nie kłamie liczbami', () => {
    expect(opisMagazynow([])).toBe('Pozycje wejdą na magazyn pod tym numerem dokumentu.')
  })
})
