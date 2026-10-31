// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import React from 'react'

/** Ważenie palety przed mroźnią — odpowiedź w kształcie API (syntetyczna). */
const mag = vi.hoisted(() => ({ mrozniaOstatnieWazenie: (_id: string): Promise<unknown> => Promise.resolve(null) }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), magazynApi: mag }))
import { WazeniePalety } from './WazeniePalety'
import type { Pallet } from '../../../data/model'

const P = (status: Pallet['status']) => ({ id: 'pal-1', no: 3, carton: '000803', status, items: [], readyQty: 0, batches: [] }) as unknown as Pallet
const W = (o: Record<string, unknown> = {}) => ({ id: 'w1', code: 'PAL|o1|3', containerKind: 'order', containerId: 'pal-1', cartonNo: '000803', clientName: 'YALCIN', orderNo: 'YALCIN/Z/7', lines: [], batches: [],
  palletTypeId: 'euro', palletTypeName: 'EURO', tareMinKg: 33.25, tareMaxKg: 36.75, tareKg: 35, marginPct: 1, grossKg: 836, netKg: 800, diffKg: 1, ok: true, weighMode: 'auto', operator: 'Marek', weighedAt: '2026-10-31T08:15:00Z', ...o })
const zwykle = (t: string | null) => (t ?? '').replace(/ /g, ' ')

afterEach(cleanup)
// Odrzucenie (404) podajemy zwykłą funkcją, nie szpiegiem vi.fn: szpieg po resecie zgłasza
// obsłużone odrzucenie jako nieobsłużone i wywraca test, choć komponent je łapie.
const odpowiedz = (w: unknown) => { const f = vi.fn((_id: string) => Promise.resolve(w)); mag.mrozniaOstatnieWazenie = f; return f }
const nieWazony = () => { mag.mrozniaOstatnieWazenie = () => Promise.reject(new Error('404: Ten karton nie był ważony')) }
beforeEach(() => { odpowiedz(null) })

describe('Ważenie palety w szczegółach', () => {
  it('rozpisana — bez zapytania o ważenie', () => {
    const f = odpowiedz(W())
    render(<WazeniePalety p={P('created')} />)
    expect(screen.getByText(/Rozpisana — ważenie po spakowaniu/)).toBeTruthy()
    expect(f).not.toHaveBeenCalled()
  })
  it('zważona zgodnie: rodzaj palety z tarą, brutto, netto ze sztuk i z wagi, kto i kiedy', async () => {
    const f = odpowiedz(W())
    render(<WazeniePalety p={P('cold')} />)
    expect(await screen.findByText('Zważona — waga zgodna')).toBeTruthy()
    expect(f).toHaveBeenCalledWith('pal-1')
    const box = screen.getByLabelText('Ważenie palety 3')
    const tekst = zwykle(box.textContent)
    expect(tekst).toContain('EURO · tara 33,3 kg–36,8 kg')
    expect(tekst).toContain('Brutto836,0 kg')
    expect(tekst).toContain('Netto ze sztuk800,0 kg')
    expect(tekst).toContain('Netto z wagi801,0 kg')
    expect(tekst).toContain('Marek')
  })
  it('niezgodna i ważona ręcznie — ostrzeżenie z różnicą', async () => {
    odpowiedz(W({ ok: false, diffKg: 12, weighMode: 'manual' }))
    render(<WazeniePalety p={P('packed')} />)
    expect(zwykle((await screen.findByText(/NIEZGODNA/)).textContent)).toBe('Zważona — NIEZGODNA +12,0 kg')
    expect(screen.getByText('ręcznie')).toBeTruthy()
  })
  it('w mroźni bez ważenia (404 „nie był ważony”) — „Niezważona”', async () => {
    nieWazony()
    render(<WazeniePalety p={P('cold')} />)
    expect(await screen.findByText('Niezważona')).toBeTruthy()
  })
  it('spakowana bez ważenia — czeka na ważenie przed mroźnią', async () => {
    nieWazony()
    render(<WazeniePalety p={P('packed')} />)
    expect(await screen.findByText(/czeka na ważenie przed mroźnią/)).toBeTruthy()
  })
})
