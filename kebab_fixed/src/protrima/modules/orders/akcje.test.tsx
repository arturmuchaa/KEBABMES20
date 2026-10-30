// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { mapujZamowienie } from '../../data/mapuj'
import { mapClientOrder } from '@/lib/api'

const api = vi.hoisted(() => ({ delete: vi.fn(() => Promise.resolve()), updateStatus: vi.fn(() => Promise.reject(new Error('Nie można anulować zamówienia: przypięte kartony 000123'))), cofnijRealizacje: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), clientOrdersApi: api }))
const refresh = vi.fn(() => Promise.resolve())
vi.mock('../../data/store', () => ({ useOrders: () => ({ refresh }) }))
import { useOrderActions, dozwolone } from './akcje'

afterEach(cleanup)
const app = { toast: vi.fn() } as unknown as AppApi
const order = mapujZamowienie(mapClientOrder({ id: 'o1', order_no: 'TEST/Z/1', client_name: 'TEST', status: 'confirmed', lines: [] }), { clients: [], pallets: {}, wz: [], planByLine: {} })

function Harness({ r }: { r: 'delete' | 'cancel' }) {
  const a = useOrderActions()
  return <><button onClick={() => a.zapytaj(r, order)}>start</button>{a.dialog}</>
}
const mount = (r: 'delete' | 'cancel') => { render(<AppCtx.Provider value={app}><Harness r={r} /></AppCtx.Provider>); fireEvent.click(screen.getByText('start')) }

describe('akcje zamówienia', () => {
  it('usunięcie dopiero po wpisaniu USUŃ', async () => {
    mount('delete')
    const btn = screen.getByRole('button', { name: 'Usuń na zawsze' }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    fireEvent.change(screen.getByLabelText(/Wpisz/), { target: { value: 'usun' } })
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('o1'))
    expect(refresh).toHaveBeenCalled()
  })
  it('odmowa serwera przy anulowaniu — jego słowami, okno zostaje', async () => {
    mount('cancel')
    fireEvent.click(screen.getByRole('button', { name: 'Anuluj zamówienie' }))
    expect(await screen.findByText(/przypięte kartony 000123/)).toBeTruthy()
  })
  it('bramki statusów jak na serwerze', () => {
    expect(dozwolone({ status: 'done' })).toMatchObject({ undo: true, delete: false, cancel: false, confirm: false })
    expect(dozwolone({ status: 'draft' })).toMatchObject({ confirm: true, delete: true })
  })
})
