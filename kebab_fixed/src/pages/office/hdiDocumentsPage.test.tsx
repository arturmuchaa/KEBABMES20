// @vitest-environment jsdom
/**
 * Anulowanie HDI z listy dokumentów (25.09.2026 — wcześniej nie było wcale).
 * Numer anulowanego zostaje spalony, więc wiersz ma zostać w rejestrze
 * z wyraźnym statusem, a nie zniknąć.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, within, waitFor } from '@testing-library/react'

const stan = vi.hoisted(() => ({ rows: [] as any[], anulowane: [] as string[], refetch: 0 }))

vi.mock('@/hooks/useApi', () => ({
  useApi: () => ({ data: stan.rows, loading: false, error: null,
                   refetch: () => { stan.refetch++ } }),
}))
vi.mock('@/lib/api', () => ({
  hdiApi: {
    listDocs: vi.fn(), pdfUrl: (id: string) => id,
    anuluj: (id: string) => { stan.anulowane.push(id); return Promise.resolve({}) },
  },
  downloadDocPdf: vi.fn(),
}))
vi.mock('@/components/PageHeader', () => ({ usePageHeaderActions: () => {} }))

import { HdiDocumentsPage } from './HdiDocumentsPage'

const hdi = (id: string, number: string, status: string) => ({
  id, number, status, clientName: 'ISSA DISTRIB', incomplete: false,
  issueDate: '25.09.2026', createdAt: '2026-09-25',
})

beforeEach(() => {
  stan.rows = [hdi('h1', '12/09/26', 'wstepny'), hdi('h2', '11/09/26', 'anulowany')]
  stan.anulowane = []; stan.refetch = 0
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

const wiersz = (nr: string) => screen.getByText(nr).closest('tr')!

describe('HdiDocumentsPage — anulowanie', () => {
  it('anuluje i odświeża listę', async () => {
    render(<HdiDocumentsPage />)
    fireEvent.click(within(wiersz('12/09/26')).getByTitle(/Anuluj HDI/i))
    await waitFor(() => expect(stan.anulowane).toEqual(['h1']))
    await waitFor(() => expect(stan.refetch).toBe(1))
  })

  it('bez potwierdzenia nic nie wysyła', () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<HdiDocumentsPage />)
    fireEvent.click(within(wiersz('12/09/26')).getByTitle(/Anuluj HDI/i))
    expect(stan.anulowane).toEqual([])
  })

  it('anulowane zostaje w rejestrze z własnym statusem i bez przycisku', () => {
    render(<HdiDocumentsPage />)
    const w = wiersz('11/09/26')
    expect(within(w).getByText('Anulowany')).toBeTruthy()
    expect(within(w).queryByTitle(/Anuluj HDI/i)).toBeNull()
  })
})
