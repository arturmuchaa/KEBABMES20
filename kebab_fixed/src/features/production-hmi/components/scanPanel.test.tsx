// @vitest-environment jsdom
/**
 * Skanowanie gotowych kebabów na stanowisku produkcyjnym.
 *
 * Skaner na hali to „klawiatura": wystukuje kod i wciska Enter. Panel musi
 * łapać to bez dotykania ekranu, bo operator ma zajęte ręce — i po każdym
 * skanie sam wracać do gotowości na następny.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

import { ScanPanel } from './ScanPanel'

afterEach(cleanup)

const wynik = (over: any = {}) => ({
  ok: true, unitId: 'u1', status: 'produced', clientName: 'Bulli sp. z o.o.',
  batchNo: '250826 344', weightKg: 35, done: 5, total: 20, onStock: true, ...over,
})

const skanuj = (kod: string) => {
  const pole = screen.getByTestId('pole-skanu') as HTMLInputElement
  fireEvent.change(pole, { target: { value: kod } })
  fireEvent.submit(pole.closest('form')!)
}

describe('ScanPanel', () => {
  it('skan z czytnika idzie na serwer bez dotykania ekranu', async () => {
    const onScan = vi.fn().mockResolvedValue(wynik())
    render(<ScanPanel onScan={onScan} onClose={() => {}} />)

    skanuj('KEBAB-u1')

    await waitFor(() => expect(onScan).toHaveBeenCalledWith('KEBAB-u1'))
  })

  it('po udanym skanie mówi, co weszło na magazyn', async () => {
    render(<ScanPanel onScan={vi.fn().mockResolvedValue(wynik())} onClose={() => {}} />)

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/Na magazynie/i)).toBeTruthy()
    expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/250826 344/)
    expect(screen.getByTestId('ostatni-skan').textContent).toMatch(/35 kg/)
    expect(screen.getByTestId('postep-pozycji').textContent).toBe('5 / 20')
  })

  it('pole czyści się po każdym skanie — następny kod nie doklei się do poprzedniego', async () => {
    render(<ScanPanel onScan={vi.fn().mockResolvedValue(wynik())} onClose={() => {}} />)

    skanuj('KEBAB-u1')

    await waitFor(() => expect((screen.getByTestId('pole-skanu') as HTMLInputElement).value).toBe(''))
  })

  it('dubel mówi wprost, że ta sztuka już jest', async () => {
    const onScan = vi.fn().mockRejectedValue(Object.assign(new Error('409: duplikat'), { status: 409 }))
    render(<ScanPanel onScan={onScan} onClose={() => {}} />)

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/już zeskanowana/i)).toBeTruthy()
  })

  it('błąd łączności pokazuje treść, a nie ciche nic', async () => {
    const onScan = vi.fn().mockRejectedValue(new Error('brak łączności'))
    render(<ScanPanel onScan={onScan} onClose={() => {}} />)

    skanuj('KEBAB-u1')

    expect(await screen.findByText(/brak łączności/i)).toBeTruthy()
  })

  it('liczy sztuki zeskanowane w tej sesji — operator widzi swój dorobek', async () => {
    const onScan = vi.fn()
      .mockResolvedValueOnce(wynik({ done: 5 }))
      .mockResolvedValueOnce(wynik({ unitId: 'u2', done: 6 }))
    render(<ScanPanel onScan={onScan} onClose={() => {}} />)

    skanuj('KEBAB-u1')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('1'))
    skanuj('KEBAB-u2')
    await waitFor(() => expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('2'))
  })

  it('nieudany skan NIE podbija licznika sesji', async () => {
    const onScan = vi.fn().mockRejectedValue(new Error('brak łączności'))
    render(<ScanPanel onScan={onScan} onClose={() => {}} />)

    skanuj('KEBAB-u1')

    await screen.findByText(/brak łączności/i)
    expect(screen.getByTestId('zeskanowano-teraz').textContent).toBe('0')
  })

  it('pusty kod nie leci na serwer', () => {
    const onScan = vi.fn()
    render(<ScanPanel onScan={onScan} onClose={() => {}} />)

    skanuj('   ')

    expect(onScan).not.toHaveBeenCalled()
  })
})
