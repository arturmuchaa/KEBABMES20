// @vitest-environment jsdom
/**
 * Załadunek: lista zamówień pojazdu jest WSPÓLNA dla wszystkich skanerów.
 *
 * Biuro (12.09.2026): „na biuro pokazuje wybrane zamówienia na samochodzie,
 * a z telefonu pokazuje, że nie ma wybranych zamówień — chcę, żeby jak osoba B
 * zeskanuje coś, osoba C widziała to samo na swoim skanerze".
 *
 * Przyczyna: lista żyła w `localStorage` TEGO telefonu. Sam skan zawsze szedł
 * na serwer, więc prawda istniała — telefon jej po prostu nie pytał.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const stan = vi.hoisted(() => ({
  naAucie: [] as string[],
  statusy: [] as any[],
  zapytaneAuta: [] as string[],
}))

vi.mock('@/lib/api', () => ({
  palletScanApi: {
    activeLoading: () => Promise.resolve([]),
    ordersOnVehicle: (vid: string) => {
      stan.zapytaneAuta.push(vid)
      return Promise.resolve(stan.naAucie)
    },
    loadingStatus: (id: string) =>
      Promise.resolve(stan.statusy.find((s: any) => s.order.id === id)),
    scan: vi.fn(),
    lookup: () => Promise.resolve({}),
    finalizeLoading: vi.fn(),
    loadingDocument: vi.fn(),
  },
  vehiclesApi: { list: () => Promise.resolve([{ id: 'v1', name: 'SOLÓWKA', plate: 'KR 1' }]) },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))

import { MobileZaladunekPage } from './MobileZaladunekPage'

const ZAM_B = {
  order: { id: 'o-b', orderNo: 'DEM-S/Z/9/09/26', clientName: "DEM`S", deliveryDate: null, status: 'confirmed' },
  pallets: [{ palletNo: 1, status: 'loaded', totalKg: 100, totalQty: 4, items: [] }],
  totals: { totalPallets: 1, loadedPallets: 1, coldPallets: 0, createdPallets: 0, totalKg: 100, loadedKg: 100 },
}

beforeEach(() => {
  stan.naAucie = []
  stan.zapytaneAuta = []
  stan.statusy = [JSON.parse(JSON.stringify(ZAM_B))]
  try { localStorage.clear() } catch {}
})
afterEach(() => { cleanup(); try { localStorage.clear() } catch {} })

function pokaz() {
  render(
    <MemoryRouter initialEntries={['/mobile/zaladunek/v1']}>
      <Routes>
        <Route path="/mobile/zaladunek/:vehicleId" element={<MobileZaladunekPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Załadunek — wspólna lista zamówień pojazdu', () => {
  it('telefon C widzi zamówienie, które zeskanowała osoba B', async () => {
    // Telefon C nie ma NIC u siebie, ale serwer wie, co stoi na aucie.
    stan.naAucie = ['o-b']
    pokaz()
    expect(await screen.findByText(/DEM-S\/Z\/9\/09\/26/, {}, { timeout: 3000 })).toBeTruthy()
  })

  it('pyta serwer o TO auto, nie o jakiekolwiek', async () => {
    stan.naAucie = ['o-b']
    pokaz()
    await waitFor(() => expect(stan.zapytaneAuta).toContain('v1'))
  })

  it('brak sieci nie kasuje listy, którą telefon ma u siebie', async () => {
    try {
      localStorage.setItem('kebab.mobile.zaladunek.v1.selectedOrderIds', JSON.stringify(['o-b']))
    } catch {}
    stan.naAucie = []
    const { palletScanApi } = await import('@/lib/api')
    ;(palletScanApi.ordersOnVehicle as any) = () => Promise.reject(new Error('brak sieci'))

    pokaz()

    expect(await screen.findByText(/DEM-S\/Z\/9\/09\/26/, {}, { timeout: 3000 })).toBeTruthy()
  })
})
