// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../../shell/context'
import { mapClientOrder } from '@/lib/api'
import { mapujZamowienie } from '../../../data/mapuj'
import { DocumentsTab } from './Documents'

/** Zamówienie w kształcie API (syntetyczne): jedna pozycja 20 × 40 kg, połowa w magazynie. */
const order = (status = 'confirmed') => mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'T/Z/1', client_name: 'T', status, lines: [
  { id: 'a', qty: 20, kg_per_unit: 40, recipe_id: 'k', recipe_name: 'KIRMIZI', product_type_name: 'UDO', qty_stock: 10 },
] }), { clients: [], pallets: {}, wz: [], planByLine: {} })
const app = { genHdi: vi.fn(), issueWz: vi.fn(), openCmr: vi.fn(), splitOrder: vi.fn(), printOrder: vi.fn(), printPicking: vi.fn(), printPallets: vi.fn(), toast: vi.fn() }
const mount = (status?: string) => render(<AppCtx.Provider value={app as unknown as AppApi}><DocumentsTab order={order(status)} /></AppCtx.Provider>)
afterEach(cleanup)
beforeEach(() => Object.values(app).forEach(f => f.mockReset()))

describe('zakładka Dokumenty', () => {
  it('Wystaw HDI: najpierw pytanie (numer HDI nie wraca do puli), Wróć niczego nie wystawia', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Wystaw HDI/ }))
    const dlg = screen.getByRole('dialog')
    expect(app.genHdi).not.toHaveBeenCalled()
    // Okno mówi o obu przypadkach — przeglądarka nie wie, czy HDI już jest.
    expect(within(dlg).getByText(/Pierwsze wystawienie nada numer HDI/)).toBeTruthy()
    expect(within(dlg).getByText(/Ponowne odświeży treść/)).toBeTruthy()
    // Brak wyrobu (10 z 20 szt. × 40 kg) — ostrzeżenie przed, nie toast po fakcie.
    expect(within(dlg).getByText(/400 kg/)).toBeTruthy()
    fireEvent.click(within(dlg).getByRole('button', { name: 'Wróć' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.genHdi).not.toHaveBeenCalled()
  })

  it('Wystaw HDI po potwierdzeniu: jedno wywołanie, okno znika', () => {
    mount()
    fireEvent.click(screen.getByRole('button', { name: /Wystaw HDI/ }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Wystaw HDI/ }))
    expect(app.genHdi).toHaveBeenCalledTimes(1)
    expect(app.genHdi).toHaveBeenCalledWith('o1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('zamknięte zamówienie: Podgląd HDI bez pytania (HDI zamrożone, numer już nadany); WZ i podział zablokowane', () => {
    mount('done')
    fireEvent.click(screen.getByRole('button', { name: /Podgląd HDI/ }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(app.genHdi).toHaveBeenCalledWith('o1')
    expect((screen.getByRole('button', { name: /Wystaw WZ/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: /Podział wysyłki/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('skutek słowem: WZ i podział zdejmują towar ze stanu, HDI i CMR nadają numer, wydruki bez skutku', () => {
    mount()
    const skutek = (nazwa: RegExp) => screen.getByRole('button', { name: nazwa }).querySelector('.dt-s')?.textContent ?? null
    expect(skutek(/Wystaw WZ/)).toBe('zdejmuje towar ze stanu')
    expect(skutek(/Podział wysyłki/)).toBe('zdejmuje towar ze stanu')
    expect(skutek(/Wystaw HDI/)).toBe('nadaje numer')
    expect(skutek(/Wystaw CMR/)).toBe('nadaje numer')
    expect(skutek(/^Zamówienie/)).toBeNull()
    expect(skutek(/Lista kompletacji/)).toBeNull()
    const wydruki = screen.getByRole('region', { name: 'Wydruki' })
    expect(within(wydruki).getByText('nic nie zmieniają w systemie')).toBeTruthy()
  })

  it('szkic: dokumenty wydania zablokowane z powodem w podpowiedzi, wydruki działają', () => {
    mount('draft')
    for (const n of [/Wystaw WZ/, /Wystaw HDI/, /Wystaw CMR/, /Podział wysyłki/]) {
      const b = screen.getByRole('button', { name: n }) as HTMLButtonElement
      expect(b.disabled).toBe(true)
      expect(b.dataset.tip).toBe('Najpierw potwierdź zamówienie')
    }
    fireEvent.click(screen.getByRole('button', { name: /^Zamówienie/ }))
    expect(app.printOrder).toHaveBeenCalledWith('o1')
  })
})
