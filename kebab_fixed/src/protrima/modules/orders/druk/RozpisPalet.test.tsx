// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { mapClientOrder, type OrderPallet } from '@/lib/api'
import { KartkaRozpisuPalet, RozpisPalet, rozpisNaOsobnejStronie } from './RozpisPalet'
import { KartkaKompletacji } from './ListaKompletacji'
import { DokumentZamowienia } from './ZamowienieDruk'

afterEach(cleanup)

const zamowienie = (pozycji: number) => mapClientOrder({
  id: 'o1', order_no: 'YALCIN/Z/1/11/26', client_id: 'c1', client_name: 'YALCIN', order_date: '2026-11-26',
  delivery_date: '2026-11-28', status: 'confirmed',
  lines: Array.from({ length: pozycji }, (_, i) => ({
    id: `l${i}`, qty: 20, kg_per_unit: 40 - i, recipe_name: 'KIRMIZI', product_type_name: 'KEBAB UDO 100%',
  })),
})
const palety = (n: number, linie = 1): OrderPallet[] => Array.from({ length: n }, (_, i) => ({
  id: `p${i}`, palletNo: i + 1, notes: i === 0 ? 'uwaga wewnętrzna' : '',
  items: Array.from({ length: linie }, (_, j) => ({ orderLineId: `l${j}`, qty: 5 })),
}))

describe('rozpis palet — zawsze na jednej stronie', () => {
  it('małe zamówienie: rozpis zostaje pod listą', () => {
    expect(rozpisNaOsobnejStronie(3, palety(2))).toBe(false)
  })
  it('YALCIN 21 palet: cały rozpis na drugiej stronie', () => {
    expect(rozpisNaOsobnejStronie(15, palety(21, 2))).toBe(true)
  })
  it('blok rozpisu nie łamie się i przechodzi na nową stronę, gdy się nie zmieści', () => {
    const o = zamowienie(15)
    render(<RozpisPalet o={o} pallets={palety(21, 2)} />)
    const sekcja = screen.getByRole('region', { name: 'Rozpis palet' })
    expect(sekcja.className).toContain('dk-rozpis')
    expect(sekcja.className).toContain('dk-page')
    expect(sekcja.querySelectorAll('.dk-pal-card')).toHaveLength(21)
    expect(screen.getByText('PALETA P21')).toBeTruthy()
  })
  it('na małym zamówieniu bez wymuszonej nowej strony', () => {
    render(<RozpisPalet o={zamowienie(3)} pallets={palety(2)} />)
    expect(screen.getByRole('region', { name: 'Rozpis palet' }).className).not.toContain('dk-page')
  })
})

describe('lista kompletacji', () => {
  it('bez rozpisu, gdy biuro go nie chce', () => {
    render(<KartkaKompletacji o={zamowienie(3)} pallets={palety(2)} rozpis={false} />)
    expect(screen.queryByRole('region', { name: 'Rozpis palet' })).toBeNull()
  })
  it('rozpis jako osobny dokument: nagłówek zamówienia i palety, bez tabeli pozycji', () => {
    render(<KartkaRozpisuPalet o={zamowienie(3)} pallets={palety(2)} firma="FHUP" />)
    expect(screen.getByText('Rozpis palet', { selector: '.dz-kind' })).toBeTruthy()
    expect(screen.getByText('YALCIN/Z/1/11/26')).toBeTruthy()
    expect(document.querySelector('.dz-tbl')).toBeNull()
    expect(screen.getByText('PALETA P2')).toBeTruthy()
    // Osobny dokument zaczyna się od góry strony — bez wymuszonego łamania.
    expect(screen.getByRole('region', { name: 'Rozpis palet' }).className).not.toContain('dk-page')
  })
})

describe('zamówienie dla klienta', () => {
  it('lista palet na życzenie, bez uwag wewnętrznych palet', () => {
    render(<DokumentZamowienia o={zamowienie(3)} firma={{ name: 'FHUP' }} uwagiPoz palety={palety(2)} />)
    expect(screen.getByRole('region', { name: 'Rozpis palet' })).toBeTruthy()
    expect(screen.queryByText('uwaga wewnętrzna')).toBeNull()
  })
  it('bez listy palet, gdy nie zaznaczono', () => {
    render(<DokumentZamowienia o={zamowienie(3)} firma={{ name: 'FHUP' }} uwagiPoz />)
    expect(screen.queryByRole('region', { name: 'Rozpis palet' })).toBeNull()
  })
})
