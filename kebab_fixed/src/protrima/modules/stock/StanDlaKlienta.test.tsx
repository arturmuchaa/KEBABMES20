// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { ArkuszStanu } from './StanDlaKlienta'
import { jezykKlienta, jezykZNip } from '@/features/rozliczenia/jezykDruku'

afterEach(cleanup)
const rows = [{ product: 'KEBAB UDO 100%', recipe: 'BEYAZ HALAL', kgPerUnit: 15, packaging: 'METAL 55CM', qty: 60, kg: 900,
  batches: [{ batch: '101126 688', date: new Date(2026, 10, 10), qty: 60 }] }]
const firma = { name: 'Zakład Testowy', city: 'Miasto' }
const teraz = new Date(2026, 10, 13, 12, 5)

describe('język dokumentu klienta', () => {
  it('z prefiksu NIP jak HDI; kartoteka ma pierwszeństwo', () => {
    expect([jezykZNip('DE123'), jezykZNip('ATU1'), jezykZNip('FR12'), jezykZNip('6770001112'), jezykZNip(''), jezykZNip('NL99')]).toEqual(['de', 'de', 'fr', 'pl', 'pl', 'en'])
    expect(jezykKlienta('fr', 'DE123')).toBe('fr')
    expect(jezykKlienta('', 'SK2020')).toBe('sk')
  })
})

describe('Stan magazynowy dla klienta — dokument', () => {
  it('klient zagraniczny: polski i język klienta na jednej kartce, z danymi odbiorcy i sumami', () => {
    render(<ArkuszStanu odbiorca={{ nazwa: 'ISSA DISTRIB SARL', adres: '1 Rue X', miasto: '75001 Paris', nip: 'FR12345678901' }} rows={rows} partie jezyk="fr" firma={firma} teraz={teraz} />)
    const doc = screen.getByLabelText('Stan magazynowy dla klienta')
    expect(doc.textContent).toContain('Stan magazynowy')
    expect(doc.textContent).toContain('État du stock')
    expect(doc.textContent).toContain('Odbiorca / Client')
    expect(doc.textContent).toContain('N° TVA: FR12345678901')
    expect(doc.textContent).toContain('Poids net')
    expect(doc.textContent).toContain('101126 688 · 10.11.2026 · 60')
    expect(doc.textContent).toContain('Razem masa netto / Poids net total')
    expect(doc.textContent).toContain('13.11.2026, 12:05')
  })
  it('klient polski: tylko po polsku; bez partii kolumna partii znika', () => {
    render(<ArkuszStanu odbiorca={{ nazwa: 'POLAT' }} rows={rows} partie={false} jezyk="pl" firma={firma} teraz={teraz} />)
    const doc = screen.getByLabelText('Stan magazynowy dla klienta')
    expect(doc.querySelector('[data-drugi-jezyk]')).toBeNull()
    expect(doc.textContent).not.toContain('101126 688')
    expect(doc.textContent).toContain('Razem sztuk')
  })
})
