// @vitest-environment jsdom
/**
 * Zdejmowanie palety z samochodu WPROST na ekranie załadunku.
 *
 * Biuro (2026-09-10): „cofnij paletę DEM'S z auta, bo przypadkowo
 * zeskanowałem, a nie mam jeszcze przycisku cofnij".
 *
 * Przycisk „Wróć paletę" istniał (od 2026-09-09), ale TYLKO na ekranie
 * pojedynczej palety — tym, na który wchodzi się po zeskanowaniu kartki QR.
 * Magazynier ładuje auto z innego ekranu i tam pomyłki cofnąć nie mógł.
 *
 * Po przejściu na wspólny stan (20.09.2026) cofnięcie idzie na serwer tak
 * samo jak skan, a ekran przyjmuje ŚWIEŻĄ migawkę — nie odejmuje sobie sam.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const serwer = vi.hoisted(() => ({
  palety: [] as Array<{ nr: number; zaladowana: boolean; wMrozni: boolean }>,
  skany: [] as Array<{ code: string; action: string }>,
}))

function migawka() {
  const zaladowane = serwer.palety.filter((p) => p.zaladowana).length
  return Promise.resolve({
    vehicle: { id: 'v1', name: 'SOLÓWKA', plate: 'KR 1', kind: 'own' },
    orders: [{
      id: 'o1', orderNo: 'DEM-S/Z/1/09/26', clientName: 'DEM`S',
      deliveryDate: null, orderStatus: 'confirmed', position: 0,
      pallets: serwer.palety.map((p) => ({
        id: `o1-${p.nr}`, palletNo: p.nr,
        status: p.zaladowana ? 'loaded' : (p.wMrozni ? 'cold_storage' : 'created'),
        totalQty: 4, totalKg: 100, items: [], onThisVehicle: p.zaladowana,
      })),
      totals: {
        totalPallets: serwer.palety.length, loadedPallets: zaladowane,
        coldPallets: serwer.palety.filter((p) => p.wMrozni && !p.zaladowana).length,
        createdPallets: 0, shippedPallets: 0,
        totalKg: serwer.palety.length * 100, loadedKg: zaladowane * 100,
      },
    }],
    totals: {
      totalPallets: serwer.palety.length, loadedPallets: zaladowane, shippedPallets: 0,
      totalKg: serwer.palety.length * 100, loadedKg: zaladowane * 100,
    },
  })
}

vi.mock('@/lib/api', async () => {
  const rzeczywiste = await vi.importActual<typeof import('@/lib/api')>('@/lib/api')
  return {
    errCode: rzeczywiste.errCode,
    isOfflineError: rzeczywiste.isOfflineError,
    palletScanApi: {
      activeLoading: () => Promise.resolve([]),
      scan: (code: string, action: string) => {
        serwer.skany.push({ code, action })
        const nr = Number(code.split('|')[2])
        const p = serwer.palety.find((x) => x.nr === nr)
        // Backend odsyła paletę tam, skąd przyszła: do mroźni, jeśli w niej była.
        if (action === 'undo' && p) p.zaladowana = false
        return Promise.resolve({
          palletNo: nr, totalKg: 100, result: 'SUCCESS',
          order: { id: 'o1', orderNo: 'DEM-S/Z/1/09/26' },
        })
      },
      finalizeLoading: vi.fn(),
      loadingDocument: vi.fn(),
    },
    vehicleLoadingApi: {
      state: () => migawka(),
      addOrder: () => migawka(),
      removeOrder: () => migawka(),
      reorder: () => migawka(),
      clear: () => migawka(),
    },
  }
})
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))

import { MobileZaladunekPage } from './MobileZaladunekPage'

beforeEach(() => {
  serwer.skany = []
  serwer.palety = [
    { nr: 1, zaladowana: true,  wMrozni: false },
    { nr: 2, zaladowana: false, wMrozni: true  },
  ]
  try { localStorage.clear() } catch {}
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
    await waitFor(() => expect(serwer.skany.length).toBe(1))
    expect(serwer.skany[0]).toEqual({ code: 'PAL|o1|1', action: 'undo' })
  })

  it('po cofnięciu lista pokazuje stan Z SERWERA, nie odjęty lokalnie', async () => {
    await pokaz()
    fireEvent.click(screen.getByLabelText(/Zdejmij paletę P1 z samochodu/i))
    await waitFor(() =>
      expect(screen.queryByLabelText(/Zdejmij paletę P1 z samochodu/i)).toBeNull())
  })
})
