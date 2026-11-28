// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'

const kontr = vi.hoisted(() => ({ propozycjeAdresow: vi.fn(), zastosujAdresy: vi.fn() }))
const groups = vi.hoisted(() => ({ list: vi.fn(), create: vi.fn(), rename: vi.fn(), setMembers: vi.fn(), remove: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), kontrahenciApi: kontr, clientGroupsApi: groups }))
import { PoprawAdresyDialog } from './PoprawAdresyDialog'
import { GrupyDialog } from './GrupyDialog'

const app = { toast: vi.fn() } as unknown as AppApi
afterEach(cleanup)
beforeEach(() => { [kontr, groups].forEach(o => Object.values(o).forEach(f => f.mockReset())) })

const PROP = [
  { rodzaj: 'odbiorca', id: 'sk', nazwa: 'BULLI', pelna: 'BULLI KEBAB, s. r. o.', obecne: { address: 'Hlavná 1200/4', postal_code: '04022 ', city: ' Košice', country: 'SK' },
    proponowane: { address: 'Hlavná 1200/4', postal_code: '040 22', city: 'Košice', country: 'SK' } },
  { rodzaj: 'dostawca', id: 'w', nazwa: 'KOWALSKI', pelna: 'JAN KOWALSKI', obecne: { address: 'SZKOLNA 3', postal_code: '', city: '', country: 'PL' },
    proponowane: { address: 'Szkolna 3', postal_code: '', city: '', country: 'PL' } },
]

describe('Popraw adresy', () => {
  it('obecne → proponowane, wszystkie zaznaczone; odznaczony nie idzie do zapisu', async () => {
    kontr.propozycjeAdresow.mockResolvedValue(PROP)
    kontr.zastosujAdresy.mockResolvedValue({ zmieniono: 1 })
    const onZastosowano = vi.fn()
    render(<AppCtx.Provider value={app}><PoprawAdresyDialog onClose={vi.fn()} onZastosowano={onZastosowano} /></AppCtx.Provider>)
    expect(await screen.findByText('040 22 Košice')).toBeTruthy()
    expect(screen.getByText('Szkolna 3')).toBeTruthy()
    const cb = screen.getByLabelText('Popraw: KOWALSKI') as HTMLInputElement
    expect(cb.checked).toBe(true)
    fireEvent.click(cb)
    fireEvent.click(screen.getByRole('button', { name: 'Zastosuj zaznaczone (1)' }))
    await waitFor(() => expect(kontr.zastosujAdresy).toHaveBeenCalledTimes(1))
    expect(kontr.zastosujAdresy.mock.calls[0][0]).toEqual([{ rodzaj: 'odbiorca', id: 'sk', address: 'Hlavná 1200/4', postal_code: '040 22', city: 'Košice', country: 'SK' }])
    await waitFor(() => expect(onZastosowano).toHaveBeenCalled())
  })
  it('pusta lista — wszystko dobrze', async () => {
    kontr.propozycjeAdresow.mockResolvedValue([])
    render(<AppCtx.Provider value={app}><PoprawAdresyDialog onClose={vi.fn()} onZastosowano={vi.fn()} /></AppCtx.Provider>)
    expect(await screen.findByText('Wszystkie adresy wyglądają dobrze')).toBeTruthy()
  })
})

describe('Grupy odbiorców', () => {
  const KL = [{ id: 'c1', code: 'K1', name: 'YBM Gastro GmbH', displayName: 'YALCIN', active: true, createdAt: '' }, { id: 'c2', code: 'K2', name: 'Emin Handels GmbH', displayName: 'YALCIN', active: true, createdAt: '' }]
  it('nowa grupa z Enter; skład zaznaczany ptaszkami i zapisany', async () => {
    groups.list.mockResolvedValue([])
    groups.create.mockResolvedValue({ id: 'g1', name: 'YALCIN', members: [] })
    render(<AppCtx.Provider value={app}><GrupyDialog klienci={KL} onClose={vi.fn()} /></AppCtx.Provider>)
    const nazwa = await screen.findByLabelText('Nazwa nowej grupy')
    fireEvent.change(nazwa, { target: { value: 'YALCIN' } })
    groups.list.mockResolvedValue([{ id: 'g1', name: 'YALCIN', members: [] }])
    fireEvent.keyDown(nazwa, { key: 'Enter' })
    await waitFor(() => expect(groups.create).toHaveBeenCalledWith('YALCIN'))
    fireEvent.click(await screen.findByRole('button', { name: 'Skład: YALCIN' }))
    fireEvent.click(screen.getByLabelText('YALCIN — YBM Gastro GmbH'))
    fireEvent.click(screen.getByLabelText('YALCIN — Emin Handels GmbH'))
    fireEvent.click(screen.getByRole('button', { name: 'Zapisz skład' }))
    await waitFor(() => expect(groups.setMembers).toHaveBeenCalledWith('g1', ['c1', 'c2']))
  })
  it('spółka z innej grupy jest zablokowana z podpowiedzią', async () => {
    groups.list.mockResolvedValue([{ id: 'g1', name: 'A', members: [{ id: 'c1', name: 'YBM Gastro GmbH' }] }, { id: 'g2', name: 'B', members: [] }])
    render(<AppCtx.Provider value={app}><GrupyDialog klienci={KL} onClose={vi.fn()} /></AppCtx.Provider>)
    fireEvent.click(await screen.findByRole('button', { name: 'Skład: B' }))
    expect((screen.getByLabelText('YALCIN — YBM Gastro GmbH') as HTMLInputElement).disabled).toBe(true)
    expect(screen.getByText('w grupie A')).toBeTruthy()
  })
})
