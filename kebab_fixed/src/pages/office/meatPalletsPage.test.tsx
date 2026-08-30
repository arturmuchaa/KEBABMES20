// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'

/**
 * Korekta palety z biura.
 *
 * 24.08.2026 cztery palety trzeba było poprawić ręcznie w bazie produkcyjnej:
 * trzy razy zła partia, raz brak liczby pojemników (218 kg zamiast 200).
 * Ten ekran ma zamknąć tę klasę zgłoszeń bez sięgania po SQL.
 */
type KorektaDto = {
  kgNet: number; containers: number; reason: string
  lots: { lotNo: string; kg: number }[]
}
const { correct, usun } = vi.hoisted(() => ({
  correct: vi.fn(async (_palletNo: string, _dto: any) => ({})),
  usun: vi.fn(async (_palletNo: string, _reason: string) => ({ palletNo: '', deleted: true })),
}))

const PALETY = [
  { id: 'p1', palletNo: 'PAL/24/08/26/18', targetKg: 200, stackKg: 200,
    kgNet: 218, containers: 0, carrierLabel: 'wózek 5,5', operator: 'MARCIN',
    productionDate: '2026-08-24', expiryDate: '2026-08-31',
    lots: [{ lotNo: '504', kg: 218 }] },
  { id: 'p2', palletNo: 'PAL/24/08/26/17', targetKg: 200, stackKg: 200,
    kgNet: 200, containers: 8, carrierLabel: 'wózek 6,5', operator: 'MARCIN',
    productionDate: '2026-08-24', expiryDate: '2026-08-31',
    lots: [{ lotNo: '504', kg: 200 }] },
]

vi.mock('@/hooks/useApi', () => ({
  useApi: (fn: () => any) => ({ data: fn(), loading: false, error: null, refetch: vi.fn() }),
}))
vi.mock('@/lib/api', () => ({ meatPalletsApi: { list: () => PALETY, correct, usun } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import { MeatPalletsPage } from './MeatPalletsPage'

const otworzKorekte = (nr: string) => {
  const wiersz = screen.getAllByTestId('paleta-wiersz')
    .find(r => r.textContent?.includes(nr))!
  fireEvent.click(within(wiersz).getByRole('button', { name: /Popraw/ }))
}
/** Pole w OKNIE korekty. Zawężamy do dialogu, bo „Pojemniki" jest też
 *  nagłówkiem kolumny w tabeli pod spodem. */
const pole = (etykieta: string) => {
  const okno = screen.getByRole('dialog')
  const lab = within(okno).getByText(etykieta)
  return lab.parentElement!.querySelector('input') as HTMLInputElement
}
const zapisz = () => screen.getByRole('button', { name: /Zapisz i przedrukuj/ }) as HTMLButtonElement

beforeEach(() => vi.clearAllMocks())
afterEach(cleanup)

describe('MeatPalletsPage — korekta palety', () => {
  it('wyróżnia paletę bez pojemników — to sygnał nieodjętej tary', () => {
    render(<MeatPalletsPage />)
    expect(screen.getAllByTestId('paleta-bez-pojemnikow')).toHaveLength(1)
  })

  it('paleta z pojemnikami nie jest oznaczana', () => {
    render(<MeatPalletsPage />)
    const ok = screen.getAllByTestId('paleta-wiersz').find(r => r.textContent?.includes('/17'))!
    expect(within(ok).queryByTestId('paleta-bez-pojemnikow')).toBeNull()
  })

  it('okno startuje od AKTUALNYCH danych palety', () => {
    render(<MeatPalletsPage />)
    otworzKorekte('/18')
    expect(pole('Waga netto [kg]').value).toBe('218')
    expect(pole('Pojemniki').value).toBe('0')
    expect(screen.getAllByTestId('korekta-lot')).toHaveLength(1)
  })

  it('bez powodu nie da się zapisać', () => {
    render(<MeatPalletsPage />)
    otworzKorekte('/18')
    expect(zapisz().disabled).toBe(true)
    expect(screen.getByTestId('korekta-bledy').textContent).toContain('powód')
  })

  it('niezgodna suma składu blokuje zapis', () => {
    render(<MeatPalletsPage />)
    otworzKorekte('/18')
    fireEvent.change(pole('Powód korekty'), { target: { value: 'brak pojemników' } })
    fireEvent.change(pole('Waga netto [kg]'), { target: { value: '200' } })
    expect(screen.getByTestId('korekta-bledy').textContent).toContain('nie zgadza się')
    expect(zapisz().disabled).toBe(true)
  })

  it('poprawna korekta jedzie do backendu z powodem i składem', async () => {
    render(<MeatPalletsPage />)
    otworzKorekte('/18')
    fireEvent.change(pole('Powód korekty'), { target: { value: 'operator nie wpisał pojemników' } })
    fireEvent.change(pole('Waga netto [kg]'), { target: { value: '200' } })
    fireEvent.change(pole('Pojemniki'), { target: { value: '9' } })
    const lot = screen.getAllByTestId('korekta-lot')[0]
    fireEvent.change(lot.querySelectorAll('input')[1], { target: { value: '200' } })

    expect(zapisz().disabled).toBe(false)
    fireEvent.click(zapisz())

    await waitFor(() => expect(correct).toHaveBeenCalled())
    expect(correct.mock.calls[0][0]).toBe('PAL/24/08/26/18')
    expect(correct.mock.calls[0][1] as KorektaDto).toEqual({
      kgNet: 200, containers: 9,
      reason: 'operator nie wpisał pojemników',
      lots: [{ lotNo: '504', kg: 200 }],
    })
  })

  it('da się zmienić partię — najczęstsza pomyłka z 24.08', async () => {
    render(<MeatPalletsPage />)
    otworzKorekte('/17')
    fireEvent.change(pole('Powód korekty'), { target: { value: 'ważono 503, ekran podpowiedział 504' } })
    const lot = screen.getAllByTestId('korekta-lot')[0]
    fireEvent.change(lot.querySelectorAll('input')[0], { target: { value: '503' } })
    fireEvent.click(zapisz())
    await waitFor(() => expect(correct).toHaveBeenCalled())
    expect((correct.mock.calls[0][1] as KorektaDto).lots).toEqual([{ lotNo: '503', kg: 200 }])
  })

  it('ta sama partia dwa razy jest zatrzymana', () => {
    render(<MeatPalletsPage />)
    otworzKorekte('/17')
    fireEvent.change(pole('Powód korekty'), { target: { value: 'podział' } })
    fireEvent.click(screen.getByRole('button', { name: /Dołóż partię/ }))
    const loty = screen.getAllByTestId('korekta-lot')
    fireEvent.change(loty[0].querySelectorAll('input')[1], { target: { value: '100' } })
    fireEvent.change(loty[1].querySelectorAll('input')[0], { target: { value: '504' } })
    fireEvent.change(loty[1].querySelectorAll('input')[1], { target: { value: '100' } })
    expect(screen.getByTestId('korekta-bledy').textContent).toContain('dwa razy')
  })
})


/**
 * Zdjęcie palety.
 *
 * Operator na hali dotyka „Etykieta" przy pełnym wskazaniu wagi i zapisuje
 * paletę, której nie ma. Biuro umiało ją poprawić, ale nie zdjąć — zostawała
 * zmniejszona do 0,5 kg i i tak pokazywała się masowni (biuro, 30.08.2026).
 */
describe('MeatPalletsPage — zdjęcie palety', () => {
  beforeEach(() => { usun.mockClear() })
  afterEach(cleanup)

  const otworzUsuwanie = (nr: string) => {
    fireEvent.click(screen.getByTestId(`paleta-usun-${nr}`))
  }

  it('bez powodu nie da się zdjąć palety', async () => {
    render(<MeatPalletsPage />)
    otworzUsuwanie('PAL/24/08/26/18')

    const przycisk = await screen.findByRole('button', { name: /zdejmij paletę/i })
    expect((przycisk as HTMLButtonElement).disabled).toBe(true)
    expect(usun).not.toHaveBeenCalled()
  })

  it('zbyt krótki powód nadal blokuje', async () => {
    render(<MeatPalletsPage />)
    otworzUsuwanie('PAL/24/08/26/18')

    const pole = await screen.findByPlaceholderText(/przez pomyłkę/i)
    fireEvent.change(pole, { target: { value: 'ok' } })
    const przycisk = screen.getByRole('button', { name: /zdejmij paletę/i })
    expect((przycisk as HTMLButtonElement).disabled).toBe(true)
  })

  it('z powodem wysyła numer palety i powód', async () => {
    render(<MeatPalletsPage />)
    otworzUsuwanie('PAL/24/08/26/18')

    const pole = await screen.findByPlaceholderText(/przez pomyłkę/i)
    fireEvent.change(pole, { target: { value: 'operator kliknął etykietę' } })
    fireEvent.click(screen.getByRole('button', { name: /zdejmij paletę/i }))

    await waitFor(() => expect(usun).toHaveBeenCalledWith(
      'PAL/24/08/26/18', 'operator kliknął etykietę'))
  })

  it('okno pokazuje skład palety, żeby biuro wiedziało, co zdejmuje', async () => {
    render(<MeatPalletsPage />)
    otworzUsuwanie('PAL/24/08/26/18')

    // Skład stoi też w wierszu tabeli, więc pytamy WEWNĄTRZ okna.
    const okno = await screen.findByRole('dialog')
    expect(within(okno).getByText(/504: 218/)).toBeTruthy()
    expect(within(okno).getByText(/218 kg/)).toBeTruthy()
  })
})
