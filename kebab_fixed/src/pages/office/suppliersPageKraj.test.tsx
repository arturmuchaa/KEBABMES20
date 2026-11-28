// @vitest-environment jsdom
/** Kartoteka dostawcy w starym MES: pole „Kraj” (27.11.2026) idzie do zapisu. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({ karty: [] as any[], zapisane: null as any }))
vi.mock('@/lib/apiClient', () => ({
  suppliersApi: {
    list: () => Promise.resolve(stan.karty),
    create: (dto: any) => { stan.zapisane = dto; return Promise.resolve({ ...dto, id: 's1' }) },
    update: (_id: string, dto: any) => { stan.zapisane = dto; return Promise.resolve({ ...dto, id: 's1' }) },
    delete: () => Promise.resolve({ ok: true }),
  },
}))
vi.mock('@/components/PageHeader', () => ({ usePageHeaderActions: () => {} }))
import { SuppliersPage } from './SuppliersPage'

afterEach(() => { cleanup(); stan.karty = []; stan.zapisane = null })

describe('pole Kraj w kartotece dostawcy', () => {
  it('pokazuje zapisany kraj i zapisuje zmieniony', async () => {
    stan.karty = [{ id: 's1', code: 'D1', name: 'OPERTI S.N.C.', nip: 'IT01234567890', country: 'IT', address: 'VIA DEI MILLE 323', postalCode: '', city: '', active: true }]
    render(<MemoryRouter><SuppliersPage /></MemoryRouter>)
    fireEvent.click(await screen.findByTitle('Edytuj'))
    const kraj = await screen.findByLabelText('Kraj') as HTMLInputElement
    expect(kraj.value).toBe('IT')
    fireEvent.change(kraj, { target: { value: 'fr' } })
    fireEvent.click(screen.getByRole('button', { name: /^zapisz$/i }))
    await waitFor(() => expect(stan.zapisane).not.toBeNull())
    expect(stan.zapisane.country).toBe('FR')
  })
})
