// @vitest-environment jsdom
/**
 * Mroźnia: cofnięcie palety WPROST z listy.
 *
 * Biuro (12.09.2026): „zeskanowałem DEMS i nie ma możliwości cofnięcia palety,
 * po prostu się skanuje i tyle". Akcja `undo` istniała, ale tylko na ekranie
 * palety otwieranym z adresu w QR — skaner w tej zakładce robił `cold_storage`
 * i nic poza tym, więc patrząc na mroźnię nie było jak tam trafić.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const stan = vi.hoisted(() => ({
  palety: [] as any[],
  skany: [] as Array<{ code: string; action: string }>,
}))

vi.mock('@/lib/api', () => ({
  palletScanApi: {
    inColdStorage: () => Promise.resolve(stan.palety),
    scan: (code: string, action: string) => {
      stan.skany.push({ code, action })
      if (action === 'undo') stan.palety = []
      return Promise.resolve({ palletNo: 1, order: { clientName: 'DEMS' } })
    },
  },
}))
vi.mock('@/lib/clientNames', () => ({ useClientNames: () => (n: string) => n }))

import { MobileMrozniaPage } from './MobileMrozniaPage'

afterEach(() => { cleanup(); stan.palety = []; stan.skany = [] })

function paleta() {
  return {
    orderId: 'o1', orderNo: 'Z/1/09/26', clientName: 'DEMS', deliveryDate: null,
    palletId: 'p1', palletNo: 1, coldStorageAt: '2026-09-12T08:00:00Z', notes: '',
    totalKg: 480, totalQty: 24, parts: [],
  }
}

describe('cofnięcie palety z mroźni', () => {
  it('każda paleta na liście ma przycisk cofnięcia', async () => {
    stan.palety = [paleta()]
    render(<MemoryRouter><MobileMrozniaPage /></MemoryRouter>)
    expect(await screen.findByTestId('cofnij-o1-1')).toBeTruthy()
  })

  it('klik wysyła akcję undo dla TEJ palety', async () => {
    stan.palety = [paleta()]
    render(<MemoryRouter><MobileMrozniaPage /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('cofnij-o1-1'))

    await waitFor(() => expect(stan.skany.length).toBe(1))
    expect(stan.skany[0]).toEqual({ code: 'PAL|o1|1', action: 'undo' })
  })

  it('po cofnięciu paleta znika z listy mroźni', async () => {
    stan.palety = [paleta()]
    render(<MemoryRouter><MobileMrozniaPage /></MemoryRouter>)
    fireEvent.click(await screen.findByTestId('cofnij-o1-1'))

    await waitFor(() => expect(screen.queryByTestId('cofnij-o1-1')).toBeNull())
    expect(await screen.findByText(/Brak palet w mroźni/)).toBeTruthy()
  })

  it('skan w tej zakładce dalej wkłada do mroźni, nie cofa', async () => {
    render(<MemoryRouter><MobileMrozniaPage /></MemoryRouter>)
    const pole = await screen.findByRole('textbox')
    fireEvent.change(pole, { target: { value: 'PAL|o1|2' } })
    fireEvent.submit(pole.closest('form')!)

    await waitFor(() => expect(stan.skany.length).toBe(1))
    expect(stan.skany[0].action).toBe('cold_storage')
  })
})
