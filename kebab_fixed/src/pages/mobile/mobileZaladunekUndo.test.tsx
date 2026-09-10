// @vitest-environment jsdom
/**
 * Zdejmowanie palety z samochodu WPROST na ekranie załadunku.
 *
 * Biuro (2026-09-10): „cofnij paletę DEM'S z auta, bo przypadkowo
 * zeskanowałem, a nie mam jeszcze przycisku cofnij".
 *
 * Przycisk „Wróć paletę" istniał (od 2026-09-09), ale TYLKO na ekranie
 * pojedynczej palety — tym, na który wchodzi się po zeskanowaniu kartki QR.
 * Magazynier ładuje auto z innego ekranu (Załadunek → auto → zamówienia →
 * skan) i tam pomyłki cofnąć nie mógł: musiałby wyjść i zeskanować kartkę
 * drugi raz, żeby trafić na ekran z przyciskiem.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const stan = vi.hoisted(() => ({ statusy: [] as any[], skany: [] as any[] }))

vi.mock('@/lib/api', () => ({
  palletScanApi: {
    activeLoading: () => Promise.resolve([]),
    loadingStatus: (id: string) =>
      Promise.resolve(stan.statusy.find((s: any) => s.order.id === id)),
    scan: (code: string, action: string) => {
      stan.skany.push({ code, action })
      // Po cofnięciu paleta wraca do mroźni — tak robi backend, gdy
      // przechodziła przez nią przed załadunkiem.
      const s = stan.statusy[0]
      const nr = Number(code.split('|')[2])
      const p = s.pallets.find((x: any) => x.palletNo === nr)
      if (action === 'undo' && p) {
        p.status = 'cold_storage'
        s.totals.loadedPallets -= 1
      }
      return Promise.resolve({ order: s.order, palletNo: nr, totalKg: 100 })
    },
    lookup: () => Promise.resolve({}),
    finalizeLoading: vi.fn(),
    loadingDocument: vi.fn(),
  },
  vehiclesApi: { list: () => Promise.resolve([{ id: 'v1', name: 'SOLÓWKA', plate: 'KR 1' }]) },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))

import { MobileZaladunekPage } from './MobileZaladunekPage'

const ZAMOWIENIE = {
  order: { id: 'o1', orderNo: "DEM-S/Z/1/09/26", clientName: "DEM`S", deliveryDate: null, status: 'confirmed' },
  pallets: [
    { palletNo: 1, status: 'loaded', totalKg: 100, totalQty: 4, items: [] },
    { palletNo: 2, status: 'cold_storage', totalKg: 80, totalQty: 3, items: [] },
  ],
  totals: { totalPallets: 2, loadedPallets: 1, coldPallets: 1, createdPallets: 0, totalKg: 180, loadedKg: 100 },
}

beforeEach(() => {
  stan.skany = []
  stan.statusy = [JSON.parse(JSON.stringify(ZAMOWIENIE))]
  try {
    localStorage.setItem('kebab.mobile.zaladunek.v1.selectedOrderIds', JSON.stringify(['o1']))
  } catch {}
})
afterEach(() => { cleanup(); try { localStorage.clear() } catch {} })

async function pokaz() {
  render(
    <MemoryRouter initialEntries={['/mobile/zaladunek/v1']}>
      <Routes>
        <Route path="/mobile/zaladunek/:vehicleId" element={<MobileZaladunekPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await waitFor(() => expect(screen.queryByText(/P1/)).toBeTruthy(), { timeout: 3000 })
}

describe('Załadunek — zdejmowanie palety z samochodu', () => {
  it('paleta ZAŁADOWANA ma przycisk zdejmowania', async () => {
    await pokaz()
    expect(screen.getByLabelText(/Zdejmij paletę P1 z samochodu/i)).toBeTruthy()
  })

  it('paleta w mroźni NIE ma tego przycisku — nie ma czego zdejmować', async () => {
    await pokaz()
    expect(screen.queryByLabelText(/Zdejmij paletę P2 z samochodu/i)).toBeNull()
  })

  it('klik wysyła cofnięcie dla WŁAŚCIWEJ palety', async () => {
    await pokaz()
    fireEvent.click(screen.getByLabelText(/Zdejmij paletę P1 z samochodu/i))
    await waitFor(() => expect(stan.skany.length).toBe(1))
    expect(stan.skany[0]).toEqual({ code: 'PAL|o1|1', action: 'undo' })
  })

  it('po cofnięciu lista pokazuje nowy stan palety', async () => {
    await pokaz()
    fireEvent.click(screen.getByLabelText(/Zdejmij paletę P1 z samochodu/i))
    await waitFor(() =>
      expect(screen.queryByLabelText(/Zdejmij paletę P1 z samochodu/i)).toBeNull())
  })
})
