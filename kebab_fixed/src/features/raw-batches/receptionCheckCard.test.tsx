// @vitest-environment jsdom
/** Sekcja kontroli HACCP w podglądzie dostawy — ekran z TEMPERATURAMI,
 *  więc obowiązuje ta sama zasada co ekrany z kilogramami: test komponentu,
 *  nie tylko czystej funkcji. */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const get = vi.fn()
const save = vi.fn()
const forDoc = vi.fn()
vi.mock('@/lib/apiClient', () => ({
  receptionChecksApi: { get: (...a: any[]) => get(...a), save: (...a: any[]) => save(...a) },
  // Sloty podpisu doszły w fazie 2 — komponent czyta stąd kolumny l/m.
  signaturesApi: { forDoc: (...a: any[]) => forDoc(...a), eligible: vi.fn(), sign: vi.fn() },
}))

import { ReceptionCheckCard } from './components/ReceptionCheckCard'

const pusty = {
  receptionId: 'r1', visual: null, tempChamber: null, tempMeat: null,
  kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null, status: 'brak',
}

beforeEach(() => {
  cleanup()
  get.mockReset(); save.mockReset(); forDoc.mockReset()
  forDoc.mockResolvedValue([])
  get.mockResolvedValue(pusty)
  save.mockImplementation((_id: string, dto: any) => Promise.resolve({ ...pusty, ...dto }))
})

describe('ReceptionCheckCard', () => {
  it('dostawa bez wpisu prosi o uzupełnienie', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/Uzupełnij kontrolę HACCP/i)).toBeTruthy()
  })

  it('temperatura ponad progiem pokazuje uwagę, ale nie blokuje zapisu', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'bz', kgMatch: 'bz', verdict: 'K',
                            tempChamber: 2, tempMeat: 9, status: 'komplet' })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/przekracza próg/i)).toBeTruthy()
    const zapisz = screen.getByRole('button', { name: /Zapisz/i })
    expect(zapisz.hasAttribute('disabled')).toBe(false)
  })

  it('zapis wysyła wpisane wartości, przecinek dziesiętny działa jak kropka', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText(/Uzupełnij kontrolę HACCP/i)
    fireEvent.change(screen.getByLabelText(/Temperatura komory/i), { target: { value: '2,5' } })
    fireEvent.click(screen.getByRole('button', { name: /Zapisz/i }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][1].tempChamber).toBe(2.5)
  })

  it('ocena N żąda opisania działania korygującego', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'N', kgMatch: 'bz', verdict: 'N',
                            tempChamber: 2, tempMeat: 3, status: 'komplet' })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    // Dwa trafienia są poprawne: nagłówek bloku i etykieta pola.
    expect((await screen.findAllByText(/działanie korygujące/i)).length).toBeGreaterThan(0)
    expect(screen.getByLabelText(/Opis niezgodności/i)).toBeTruthy()
  })

  it('odmowa przyjęcia pyta o zdjęcie surowca ze stanu', async () => {
    get.mockResolvedValue({ ...pusty, visual: 'bz', kgMatch: 'bz', verdict: 'N',
                            tempChamber: 2, tempMeat: 3, status: 'komplet' })
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/anulować przyjęcie/i)).toBeTruthy()
  })
})

describe('ReceptionCheckCard — sloty podpisu', () => {
  it('bez podpisów pokazuje przyciski dla obu ról', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText(/Wykonał \(l\)/)).toBeTruthy()
    expect(screen.getByText(/Sprawdził \(m\)/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^Podpisz$/ })).toHaveLength(2)
  })

  it('złożony podpis pokazuje nazwisko zamiast przycisku', async () => {
    forDoc.mockResolvedValue([{
      role: 'wykonal', workerId: 'w-1', signerName: 'Jan K.',
      png: 'data:image/png;base64,AA', signedAt: '2026-08-14T07:14:00Z',
    }])
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    expect(await screen.findByText('Jan K.')).toBeTruthy()
    // Została JEDNA rola do podpisania, więc jeden przycisk.
    expect(screen.getAllByRole('button', { name: /^Podpisz$/ })).toHaveLength(1)
  })

  it('po zapisie wpisu odświeża podpisy — zapis mógł je unieważnić', async () => {
    render(<ReceptionCheckCard receptionId="r1" category="drob" storageState="chlodzony" />)
    await screen.findByText(/Wykonał \(l\)/)
    forDoc.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Zapisz kontrolę/i }))
    await waitFor(() => expect(forDoc).toHaveBeenCalled())
  })
})
