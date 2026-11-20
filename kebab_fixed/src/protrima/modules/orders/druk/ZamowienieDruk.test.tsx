// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { mapClientOrder } from '@/lib/api'
const n = vi.hoisted(() => ({ dostepny: vi.fn(), stronaPdf: vi.fn() }))
vi.mock('@/lib/druk/natywny', () => ({ natywny: n }))
const zapis = vi.hoisted(() => ({ zapiszPdf: vi.fn() }))
vi.mock('@/lib/druk/zapis', () => zapis)
const druk = vi.hoisted(() => ({ drukuj: vi.fn(() => Promise.resolve(true)) }))
vi.mock('@/lib/print', () => druk)
import { DokumentZamowienia, pozycjeDokumentu, zapiszJakoPdf } from './ZamowienieDruk'

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

describe('Zapisz PDF zamówienia', () => {
  it('aplikacja: PDF strony od razu do Pobranych jako ZAMOWIENIE_<klient>_<nr>.pdf, bez okna druku', async () => {
    n.dostepny.mockResolvedValue(true); n.stronaPdf.mockResolvedValue('JVBERg==')
    zapis.zapiszPdf.mockResolvedValue({ nazwa: 'x', sciezka: 'C:\\Downloads\\ZAMOWIENIE_SAS ISSA_ISSA-Z-3-10-26.pdf' })
    const toast = vi.fn()
    await zapiszJakoPdf(o, 'Sas Issa', { toast })
    expect(zapis.zapiszPdf.mock.calls[0][0]).toBe('ZAMOWIENIE_SAS ISSA_ISSA-Z-3-10-26.pdf')
    expect(Array.from(zapis.zapiszPdf.mock.calls[0][1] as Uint8Array)).toEqual([37, 80, 68, 70])
    expect(druk.drukuj).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'ok', title: 'Zapisano PDF zamówienia' }))
  })
  it('przeglądarka: okno druku jak dawniej', async () => {
    n.dostepny.mockResolvedValue(false)
    await zapiszJakoPdf(o, 'X', { toast: vi.fn() })
    expect(druk.drukuj).toHaveBeenCalled()
  })
})
