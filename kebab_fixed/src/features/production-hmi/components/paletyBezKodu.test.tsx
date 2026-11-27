// @vitest-environment jsdom
/** Palety sprzed wdrożenia nie mają etykiety z QR — hala wywozi je z listy (27.11.2026). */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

const api = vi.hoisted(() => ({ list: vi.fn() }))
vi.mock('@/lib/api', () => ({ seasonedPalletsApi: { list: api.list } }))

import { PaletyBezKodu } from './PaletyBezKodu'

afterEach(cleanup)
beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue([
    { id: 'a', palletNo: 11, batchNo: '664', recipeName: 'KIRMIZI', kgWeighed: 4084.57, status: 'in_cold', noLabel: true, planIds: ['pl1'] },
    { id: 'b', palletNo: 12, batchNo: '665', recipeName: 'KIRMIZI', kgWeighed: 1553.9, status: 'in_cold', noLabel: true, planIds: ['inny'] },
    { id: 'c', palletNo: 41, batchNo: '730', recipeName: 'KIRMIZI', kgWeighed: 600, status: 'in_cold', noLabel: false, planIds: ['pl1'] },
  ])
})

describe('PaletyBezKodu', () => {
  it('przycisk tylko gdy plan ma palety bez etykiety; lista tylko tych z planu', async () => {
    render(<PaletyBezKodu planId="pl1" onWywiez={() => {}} />)
    fireEvent.click(await screen.findByRole('button', { name: /Palety bez kodu \(1\)/ }))
    expect(screen.getByText(/Paleta 11/)).toBeInTheDocument()
    expect(screen.queryByText(/Paleta 12/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Paleta 41/)).not.toBeInTheDocument()
    expect(api.list).toHaveBeenCalledWith('in_cold')
  })

  it('Wywieź wysyła id palety i zamyka okno', async () => {
    const wywiez = vi.fn(async () => {})
    render(<PaletyBezKodu planId="pl1" onWywiez={wywiez} />)
    fireEvent.click(await screen.findByRole('button', { name: /Palety bez kodu/ }))
    fireEvent.click(screen.getByRole('button', { name: /Wywieź paletę 11/ }))
    await waitFor(() => expect(wywiez).toHaveBeenCalledWith('a'))
    await waitFor(() => expect(screen.queryByText(/Paleta 11/)).not.toBeInTheDocument())
  })

  it('bez takich palet nic nie pokazuje', async () => {
    api.list.mockResolvedValue([])
    const { container } = render(<PaletyBezKodu planId="pl1" onWywiez={() => {}} />)
    await waitFor(() => expect(api.list).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
