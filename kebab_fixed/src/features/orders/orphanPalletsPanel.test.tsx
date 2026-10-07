// @vitest-environment jsdom
/**
 * Panel palet w poczekalni: pusty → nic; z paletami → numer starego
 * zamówienia, nr palety, karton, odbiorca i skład. Prawdziwy useApi.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ orphans: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig<typeof import('@/lib/api')>()), palletsApi: api }))

import { OrphanPalletsPanel } from './OrphanPalletsPanel'
import { mapOrphanPallet } from '@/lib/api'

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('OrphanPalletsPanel', () => {
  it('pusta poczekalnia — nic nie pokazuje', async () => {
    api.orphans.mockResolvedValue([])
    const { container } = render(<OrphanPalletsPanel />)
    await waitFor(() => expect(api.orphans).toHaveBeenCalledTimes(1))
    expect(container.textContent).toBe('')
  })

  it('pokazuje paletę ze starego zamówienia ze składem', async () => {
    api.orphans.mockResolvedValue([mapOrphanPallet({
      id: 'p6', source_order_no: 'ZAGROS/Z/2/10/26', client_name: 'ZAGROS', pallet_no: 6, carton_no: 363,
      status: 'created', reason: 'usunięcie zamówienia',
      items: [{ recipe_name: 'KIRMIZI', product_type_name: 'KEBAB UDO 100%', packaging_name: 'METAL 65CM', kg_per_unit: '15', qty: 60 }],
    })])
    render(<OrphanPalletsPanel />)
    const panel = await screen.findByRole('region', { name: 'Palety czekające na zamówienie' })
    expect(panel.textContent).toMatch(/Palety czekające na zamówienie \(1\)/)
    expect(panel.textContent).toMatch(/ZAGROS\/Z\/2\/10\/26 · P6/)
    expect(panel.textContent).toMatch(/karton 000363/)
    expect(panel.textContent).toMatch(/60× 15 kg KEBAB UDO 100% · METAL 65CM/)
    expect(panel.textContent).toMatch(/usunięcie zamówienia/)
  })
})
