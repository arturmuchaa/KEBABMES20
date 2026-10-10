// @vitest-environment jsdom
/**
 * Etykieta kartonu magazynowego — ten sam wydruk co kartka palety, więc
 * i ta sama nazwa receptury: ta z kartoteki odbiorcy („BEYAZ AFIYET" u nas =
 * „BEYAZ" u POLATa).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

const stan = vi.hoisted(() => ({ karton: null as any, wlasneNazwy: {} as Record<string, string> }))
const nazwaReceptury = vi.hoisted(() =>
  (_k: any, recipeId: string | null | undefined, fallback: string) =>
    stan.wlasneNazwy[recipeId ?? ''] ?? fallback)

vi.mock('@/lib/api', () => ({ stockCartonsApi: { get: () => Promise.resolve(stan.karton) } }))
vi.mock('@/lib/clientNames', () => ({
  useClientNames: () => (n: string) => n,
  useClientRecipeNames: () => nazwaReceptury,
}))
vi.mock('@/lib/print', () => ({ drukuj: vi.fn() }))
vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(() => Promise.resolve('data:image/png;base64,AAA')) } }))

import { StockCartonLabelPage } from './StockCartonLabelPage'
import QRCode from 'qrcode'
import { CARTON_QR_OPTIONS } from '@/features/labels/cartonQr'

afterEach(cleanup)
beforeEach(() => vi.mocked(QRCode.toDataURL).mockClear())

async function pokaz() {
  render(
    <MemoryRouter initialEntries={['/office/magazyn/karton/k1/etykieta']}>
      <Routes>
        <Route path="/office/magazyn/karton/:id/etykieta" element={<StockCartonLabelPage />} />
      </Routes>
    </MemoryRouter>,
  )
  await screen.findAllByTestId('label-page')
}

describe('StockCartonLabelPage — nazwa receptury odbiorcy', () => {
  it('drukuje wlasna nazwe receptury z kartoteki odbiorcy', async () => {
    stan.wlasneNazwy = { 'r-beyaz': 'BEYAZ' }
    stan.karton = {
      id: 'k1', cartonNo: 7, clientId: 'c-polat', clientName: 'POLAT',
      lines: [{ id: 'sl1', recipeId: 'r-beyaz', recipeName: 'BEYAZ AFIYET',
                packagingName: 'METAL 60CM', kgPerUnit: 20, targetQty: 10, packedQty: 0 }],
      recipeName: 'BEYAZ AFIYET', packagingName: 'METAL 60CM',
      kgPerUnit: 20, targetQty: 10, packedQty: 0, status: 'open',
    }
    await pokaz()
    expect(QRCode.toDataURL).toHaveBeenCalledWith('SCARTON|k1', CARTON_QR_OPTIONS)
    for (const slot of screen.getAllByTestId('label-qr-slot')) {
      expect(slot.style.width).toBe('60mm')
      expect(slot.style.height).toBe('60mm')
    }
    expect(screen.getAllByText('POLAT').length).toBeGreaterThan(0)
    expect(screen.getAllByText('BEYAZ').length).toBeGreaterThan(0)
    expect(screen.queryAllByText('BEYAZ AFIYET')).toHaveLength(0)
  })

  it('bez ustawienia zostaje nazwa receptury', async () => {
    stan.wlasneNazwy = {}
    await pokaz()
    expect(screen.getAllByText('BEYAZ AFIYET').length).toBeGreaterThan(0)
  })
})
