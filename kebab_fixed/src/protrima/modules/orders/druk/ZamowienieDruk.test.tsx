// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { mapClientOrder } from '@/lib/api'
import { DokumentZamowienia, pozycjeDokumentu } from './ZamowienieDruk'

afterEach(cleanup)
const o = mapClientOrder({ id: 'o1', order_no: 'ISSA/Z/3/10/26', client_id: 'c1', client_name: 'ISSA', order_date: '2026-10-26', delivery_date: '2026-11-02', status: 'confirmed', notes: 'Awizacja dzień wcześniej',
  lines: [
    { id: 'a', qty: 100, kg_per_unit: 7, recipe_name: 'BEYAZ HALAL', product_type_name: 'KEBAB UDO 100%', packaging_name: 'KARTON 45CM', notes: 'etykiety FR' },
    { id: 'b', qty: 3, kg_per_unit: 0.1, recipe_name: 'BEYAZ HALAL', product_type_name: 'KEBAB UDO 100%' },
  ] })

describe('zamówienie dla klienta', () => {
  it('sumy bez ogonów zmiennoprzecinkowych', () => {
    const p = pozycjeDokumentu(o)
    expect(p.kg).toBe(700.3)
    expect(p.qty).toBe(103)
  })
  it('dokument: numer, daty, odbiorca z kartoteki, pozycje z opakowaniem i uwagami', () => {
    render(<DokumentZamowienia o={o} firma={{ name: 'FHUP TEST', nip: '1234567890', city: 'Opole' }} klient={{ id: 'c1', name: 'SAS ISSA DISTRIB', address: '1 RUE X', postalCode: '75001', city: 'PARIS', nip: 'FR123' }} wystawil="Anna" uwagiPoz />)
    expect(screen.getByText('ISSA/Z/3/10/26')).toBeTruthy()
    expect(screen.getByText('26.10.2026')).toBeTruthy()
    expect(screen.getByText('02.11.2026')).toBeTruthy()
    expect(screen.getAllByText('SAS ISSA DISTRIB').length).toBeGreaterThan(0)
    expect(screen.getByText('NIP / VAT: FR123')).toBeTruthy()
    expect(screen.getByText('KARTON 45CM')).toBeTruthy()
    expect(screen.getByText('etykiety FR')).toBeTruthy()
    expect(screen.getByText('Awizacja dzień wcześniej')).toBeTruthy()
    expect(document.querySelector('.dz-totals')!.textContent).toContain('700,3 kg')
  })
})
