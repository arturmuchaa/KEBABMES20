// @vitest-environment jsdom
/** Kartoteka odbiorcy w starym MES: pole „Kraj” (27.11.2026) idzie do zapisu. */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({ karty: [] as any[], zapisane: null as any }))
vi.mock('@/lib/api', () => ({
  clientsApi: {
    list: () => Promise.resolve(stan.karty),
    create: (dto: any) => { stan.zapisane = dto; return Promise.resolve({ ...dto, id: 'c1' }) },
    update: (_id: string, dto: any) => { stan.zapisane = dto; return Promise.resolve({ ...dto, id: 'c1' }) },
    deactivate: () => Promise.resolve(), delete: () => Promise.resolve({ ok: true }),
  },
  recipesApi: { list: () => Promise.resolve([]) },
  clientGroupsApi: { list: () => Promise.resolve([]) },
  lookupNip: () => Promise.resolve(null),
}))
import { ClientsPage } from './ClientsPage'

afterEach(() => { cleanup(); stan.karty = []; stan.zapisane = null })

describe('pole Kraj w kartotece odbiorcy', () => {
  it('pokazuje zapisany kraj i zapisuje zmieniony', async () => {
    stan.karty = [{ id: 'c1', code: 'K1', name: 'Truva gastro s.r.o.', nip: 'CZ12345678', country: 'CZ', address: 'Polní 45', postalCode: '253 01', city: 'HOSTIVICE', active: true, createdAt: '' }]
    render(<MemoryRouter><ClientsPage /></MemoryRouter>)
    fireEvent.click(await screen.findByTitle('Edytuj'))
    const kraj = await screen.findByLabelText('Kraj') as HTMLInputElement
    expect(kraj.value).toBe('CZ')
    fireEvent.change(kraj, { target: { value: 'sk' } })
    fireEvent.click(screen.getByRole('button', { name: /zapisz/i }))
    await waitFor(() => expect(stan.zapisane).not.toBeNull())
    expect(stan.zapisane.country).toBe('SK')
  })
})
