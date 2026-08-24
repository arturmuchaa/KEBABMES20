// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react'

/**
 * Korekta ważeń ubocznych z dziennika.
 *
 * 24.08.2026 partia 503 dostała DUBEL grzbietów — dwie palety minutę po sobie
 * (15:10 i 15:11), ta sama tara i ta sama liczba pojemników. Nie było jak tego
 * zdjąć: ważenia ubocznych to palety w JSON-ie, a jedyną drogą był SQL.
 */
const { correctWeighing, byprodWeighings } = vi.hoisted(() => ({
  correctWeighing: vi.fn(async (_dto: any) => ({})),
  byprodWeighings: vi.fn(),
}))

const WAZENIA = [
  { id: 'b503:backs:1', kind: 'backs', rawBatchId: 'rb-503', rawBatchNo: '503',
    weighedAt: '2026-08-24T13:10:07+00:00', weighedAtLocal: '2026-08-24T15:10:07', dayLocal: '2026-08-24',
    tareLabel: '', tareKg: 0, containers: 12, kgGross: 186.0, netKg: 162.0 },
  { id: 'b503:backs:2', kind: 'backs', rawBatchId: 'rb-503', rawBatchNo: '503',
    weighedAt: '2026-08-24T13:11:23+00:00', weighedAtLocal: '2026-08-24T15:11:23', dayLocal: '2026-08-24',
    tareLabel: '', tareKg: 0, containers: 12, kgGross: 186.5, netKg: 162.5 },
]

vi.mock('@/lib/apiClient', () => ({
  deboningApi:   { weighings: async () => ({ data: [] }) },
  byproductsApi: {
    weighings: async (...a: any[]) => { byprodWeighings(...a); return { data: WAZENIA } },
    correctWeighing,
  },
}))

import { DeboningWeighingsLog } from './DeboningWeighingsLog'

const otworzGrzbiety = async () => {
  render(<DeboningWeighingsLog from="2026-08-24" to="2026-08-24" defaultOpen />)
  fireEvent.click(await screen.findByRole('button', { name: /Grzbiety/ }))
}
const wiersz = (godzina: string) =>
  screen.getAllByRole('row').find(r => r.textContent?.includes(godzina))!

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('dziennik ważeń — korekta ubocznych', () => {
  it('każde ważenie ma przycisk poprawki', async () => {
    await otworzGrzbiety()
    await waitFor(() => expect(screen.getAllByTestId('wazenie-popraw')).toHaveLength(2))
  })

  it('usunięcie dubla wskazuje paletę CZASEM ważenia, nie numerem wiersza', async () => {
    await otworzGrzbiety()
    await waitFor(() => screen.getAllByTestId('wazenie-popraw'))
    fireEvent.click(within(wiersz('15:11')).getByTestId('wazenie-popraw'))
    fireEvent.change(screen.getByPlaceholderText(/dubel/), { target: { value: 'dubel z 15:11' } })
    fireEvent.click(screen.getByTestId('wazenie-usun'))

    await waitFor(() => expect(correctWeighing).toHaveBeenCalled())
    expect(correctWeighing.mock.calls[0][0]).toEqual({
      rawBatchId: 'rb-503', kind: 'backs',
      weighedAt: '2026-08-24T13:11:23+00:00',
      reason: 'dubel z 15:11', delete: true,
    })
  })

  it('bez powodu nie da się ani usunąć, ani zapisać', async () => {
    await otworzGrzbiety()
    await waitFor(() => screen.getAllByTestId('wazenie-popraw'))
    fireEvent.click(within(wiersz('15:11')).getByTestId('wazenie-popraw'))
    expect((screen.getByTestId('wazenie-usun') as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByTestId('wazenie-zapisz') as HTMLButtonElement).disabled).toBe(true)
  })

  it('poprawka wagi wysyła nowe netto, nie usuwa', async () => {
    await otworzGrzbiety()
    await waitFor(() => screen.getAllByTestId('wazenie-popraw'))
    fireEvent.click(within(wiersz('15:10')).getByTestId('wazenie-popraw'))
    fireEvent.change(screen.getByPlaceholderText(/dubel/), { target: { value: 'zla tara' } })
    const netto = screen.getAllByRole('textbox')[0] as HTMLInputElement
    fireEvent.change(netto, { target: { value: '150,5' } })
    fireEvent.click(screen.getByTestId('wazenie-zapisz'))

    await waitFor(() => expect(correctWeighing).toHaveBeenCalled())
    expect(correctWeighing.mock.calls[0][0]).toMatchObject({ netKg: 150.5, reason: 'zla tara' })
    expect(correctWeighing.mock.calls[0][0].delete).toBeUndefined()
  })

  it('po korekcie dziennik przeładowuje się sam', async () => {
    await otworzGrzbiety()
    await waitFor(() => screen.getAllByTestId('wazenie-popraw'))
    byprodWeighings.mockClear()
    fireEvent.click(within(wiersz('15:11')).getByTestId('wazenie-popraw'))
    fireEvent.change(screen.getByPlaceholderText(/dubel/), { target: { value: 'dubel' } })
    fireEvent.click(screen.getByTestId('wazenie-usun'))
    await waitFor(() => expect(byprodWeighings).toHaveBeenCalled())
  })

  it('zakładka Mięso nie dostaje przycisków korekty ubocznych', async () => {
    render(<DeboningWeighingsLog from="2026-08-24" to="2026-08-24" defaultOpen />)
    await waitFor(() => expect(screen.queryAllByTestId('wazenie-popraw')).toHaveLength(0))
  })
})
