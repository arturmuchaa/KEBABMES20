// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'

const pdf = vi.hoisted(() => vi.fn(() => Promise.resolve()))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), downloadDocPdf: pdf }))
import { KartyHaccpDialog, adresKarty } from './KartyHaccp'

afterEach(() => { cleanup(); pdf.mockClear() })

describe('Karty HACCP przyjęć', () => {
  it('adres PDF: karta 1.1.1 i 1.1.1/2 z serwera, „dane=1” tylko dla wypełnionej', () => {
    expect(adresKarty('111', '2026-10-01', true)).toMatch(/\/karty-haccp\/rejestr-przyjecia\/pdf\?od=2026-10-01&dane=1$/)
    expect(adresKarty('1112', '2026-10-01', false)).toMatch(/\/karty-haccp\/rejestr-przyjecia-szczegolowy\/pdf\?od=2026-10-01$/)
  })
  it('archiwum: 12 miesięcy, bieżący oznaczony; pusta karta bez danych z systemu', async () => {
    render(<KartyHaccpDialog app={{ toast: vi.fn() }} onClose={vi.fn()} />)
    expect(screen.getAllByRole('button', { name: /^Karta 1\.1\.1 — / })).toHaveLength(12)
    expect(screen.getByText('bieżący')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pusta do ręcznego wypełnienia' }))
    fireEvent.click(screen.getAllByRole('button', { name: /^Karta 1\.1\.1\/2 — / })[0])
    await waitFor(() => expect(pdf).toHaveBeenCalledTimes(1))
    const [url, plik] = pdf.mock.calls[0] as unknown as [string, string]
    expect(url).toMatch(/rejestr-przyjecia-szczegolowy\/pdf\?od=\d{4}-\d{2}-01$/)
    expect(plik).toMatch(/^Karta-1\.1\.1-2-.+\.pdf$/)
  })
})
