// @vitest-environment jsdom
/**
 * Ekran wzorów podpisów na kiosku rozbioru.
 *
 * BŁĄD Z PRODUKCJI (2026-09-02): „Failed to fetch" i pusta lista pracowników.
 * Ekran strzelał WŁASNYM `fetch` z `credentials: 'include'`, a produkcja ma
 * CORS z gwiazdką — żądanie z poświadczeniami przy `Allow-Origin: *` jest
 * blokowane przez przeglądarkę (spec CORS), co wygląda właśnie jak
 * „Failed to fetch". Do tego własny fetch nie dokładał nagłówka
 * `Authorization`, więc `/api/workers` i tak oddałoby 401.
 *
 * Te testy pilnują, że ekran korzysta z KLIENTA APLIKACJI — jedynego
 * miejsca, które wie o tokenie i nie wysyła poświadczeń.
 */
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const listaPracownikow = vi.fn()
const wzor = vi.fn()
const zapiszWzor = vi.fn()
vi.mock('@/lib/apiClient', () => ({
  usersApi: { list: (...a: any[]) => listaPracownikow(...a) },
  signaturesApi: {
    sample: (...a: any[]) => wzor(...a),
    saveSample: (...a: any[]) => zapiszWzor(...a),
  },
}))

import { SignatureSamplesScreen } from './SignatureSamplesScreen'

beforeEach(() => {
  cleanup()
  listaPracownikow.mockReset(); wzor.mockReset(); zapiszWzor.mockReset()
  listaPracownikow.mockResolvedValue([
    { id: 'w-1', name: 'Jan K.', active: true },
    { id: 'w-2', name: 'Ewa M.', active: true },
  ])
  wzor.mockRejectedValue(new Error('brak wzoru'))
})

describe('SignatureSamplesScreen', () => {
  it('bierze pracowników z KLIENTA APLIKACJI, nie własnym fetch', async () => {
    // Sedno błędu: własny fetch nie nosi tokenu i wywala się na CORS.
    render(<SignatureSamplesScreen onClose={() => {}} />)
    await waitFor(() => expect(listaPracownikow).toHaveBeenCalled())
  })

  it('pokazuje pracowników na liście', async () => {
    render(<SignatureSamplesScreen onClose={() => {}} />)
    expect(await screen.findByText('Jan K.')).toBeTruthy()
    expect(screen.getByText('Ewa M.')).toBeTruthy()
  })

  it('pomija pracowników nieaktywnych', async () => {
    listaPracownikow.mockResolvedValue([
      { id: 'w-1', name: 'Jan K.', active: true },
      { id: 'w-9', name: 'Zwolniony', active: false },
    ])
    render(<SignatureSamplesScreen onClose={() => {}} />)
    await screen.findByText('Jan K.')
    expect(screen.queryByText('Zwolniony')).toBeNull()
  })

  it('błąd wczytywania mówi, co się stało — nie zostawia pustego ekranu', async () => {
    listaPracownikow.mockRejectedValue(new Error('Brak dostępu'))
    render(<SignatureSamplesScreen onClose={() => {}} />)
    expect(await screen.findByText(/Brak dostępu/)).toBeTruthy()
  })

  it('brak wzoru u pracownika to normalny stan, nie błąd ekranu', async () => {
    render(<SignatureSamplesScreen onClose={() => {}} />)
    expect(await screen.findByText('Jan K.')).toBeTruthy()
    expect(screen.queryByText(/Failed to fetch/i)).toBeNull()
  })
})

describe('SignatureSamplesScreen — PIN na panelu dotykowym', () => {
  const wybierz = async () => {
    render(<SignatureSamplesScreen onClose={() => {}} />)
    fireEvent.click(await screen.findByText('Jan K.'))
  }

  it('daje klawiaturę numeryczną — panel nie ma fizycznej klawiatury', async () => {
    await wybierz()
    for (const k of ['1', '5', '9', '0', '⌫']) {
      expect(screen.getByRole('button', { name: k })).toBeTruthy()
    }
  })

  it('nie pokazuje liter — PIN jest wyłącznie cyfrowy', async () => {
    await wybierz()
    expect(screen.queryByRole('button', { name: 'A' })).toBeNull()
  })

  it('cofanie kasuje ostatnią cyfrę', async () => {
    await wybierz()
    fireEvent.click(screen.getByRole('button', { name: '1' }))
    fireEvent.click(screen.getByRole('button', { name: '2' }))
    fireEvent.click(screen.getByRole('button', { name: '⌫' }))
    // Jedna kropka została — druga skasowana.
    expect(screen.getAllByText('•')).toHaveLength(1)
  })

  it('PIN nie przekracza czterech cyfr', async () => {
    await wybierz()
    for (const k of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByRole('button', { name: k }))
    }
    expect(screen.getAllByText('•')).toHaveLength(4)
  })
})
