// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

/**
 * Widoczny strażnik ważenia zbiorczego.
 *
 * 24.08.2026 na masownię pojechała paleta z etykietą „485", choć ważono partię
 * 503: ekran nie wiedział, co stoi na wadze, i podpowiadał najstarszy lot
 * z puli. Operator nie widział ani numeru partii, ani ile z niej jeszcze wolno
 * zważyć — limit istniał wyłącznie w backendzie i nigdy nie zdążył zadziałać,
 * bo dobieranie FEFO po cichu przerzucało nadmiar na inną partię.
 */

vi.mock('@/lib/api', () => ({
  meatPalletsApi: { list: async () => [], create: vi.fn() },
  // Pula w kolejności FEFO — 485 najstarsza, dokładnie jak z produkcji.
  meatStockApi: {
    list: async () => ({ data: [
      { lotNo: '485', kgInitial: 2560, kgAvailable: 1360, kgBulkFree: 2360, expiryDate: '2026-08-18' },
      { lotNo: '502', kgInitial: 2293, kgAvailable: 2293, kgBulkFree: 1803, expiryDate: '2026-08-29' },
      { lotNo: '503', kgInitial: 493,  kgAvailable: 493,  kgBulkFree: 193,  expiryDate: '2026-08-29' },
    ] }),
  },
}))
vi.mock('@/lib/zebra', () => ({
  getDevices: async () => [], sendZpl: vi.fn(), probeBrowserPrint: async () => true,
}))
vi.mock('@/features/deboning/utils', () => ({ getProductionDate: () => '2026-08-24' }))

import { BulkWeighingWizard } from './BulkWeighingWizard'

const SCALE = { connected: true, stable: true, gross: 0 } as any

function pokaz(activeBatchNo?: string) {
  render(
    <BulkWeighingWizard
      scale={SCALE} cartTares={[20]} operator="MARCIN"
      activeBatchNo={activeBatchNo} onClose={() => {}}
    />,
  )
}

const kafelek = (key: string) => screen.getByTestId(`bw-cel-${key}`) as HTMLButtonElement

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('ważenie zbiorcze — widoczny strażnik partii', () => {
  it('pokazuje, którą partię hala waży', async () => {
    pokaz('503')
    expect((await screen.findByTestId('bw-partia')).textContent).toBe('503')
  })

  it('mówi wprost, ile zważono, ile na paletach i ile zostało', async () => {
    pokaz('503')
    const licznik = await screen.findByTestId('bw-licznik')
    expect(licznik.textContent).toContain('zważone 493 kg')
    expect(licznik.textContent).toContain('na paletach 300 kg')
    expect(licznik.textContent).toContain('zostało 193 kg')
  })

  it('nie pozwala wybrać palety większej, niż partia jeszcze ma do wydania', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    // Z 193 kg wyjdzie jeszcze cała paleta 100 kg — więc 400 i 600 są zamknięte.
    expect(kafelek('t600').disabled).toBe(true)
    expect(kafelek('t400').disabled).toBe(true)
    expect(kafelek('t100').disabled).toBe(false)
  })

  it('zablokowany kafelek mówi, dlaczego', async () => {
    pokaz('503')
    await screen.findByTestId('bw-partia')
    expect(kafelek('t600').textContent).toContain('zostało 193 kg')
  })

  it('bez wskazanej partii nic nie blokuje — brak wiedzy to nie zero', async () => {
    pokaz(undefined)
    await waitFor(() => expect(kafelek('t600').disabled).toBe(false))
    expect(screen.queryByTestId('bw-partia')).toBeNull()
  })
})
