// @vitest-environment jsdom
/**
 * Tabelka salda (spec 10.1) drukuje się na WZ wychodzącej do klienta,
 * nigdy na WM (wewnętrzny dokument podziału wysyłki) ani na szkicu.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

vi.mock('@/features/rozliczenia/BlokSaldaWz', () => ({
  BlokSaldaWz: ({ wzId }: { wzId: string }) => <div data-testid="blok-salda-wz">{wzId}</div>,
}))

import { WzDocumentView, WzDocData } from './WzDocumentView'

afterEach(cleanup)

const DOC: WzDocData = {
  id: 'w1', number: 'WZ/1/11/26', issued_date: '2026-11-09', release_date: '2026-11-09',
  buyer_name: 'ODBIORCA', valued: false,
  lines: [{ name: 'Kebab', qty: 1, unit: 'szt', price: null, value: null, total_kg: 10 }],
}

describe('WzDocumentView — tabelka salda', () => {
  it('zwykła WZ dostaje tabelkę dla swojego id', () => {
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WZ' }} />)
    expect(screen.getByTestId('blok-salda-wz').textContent).toBe('w1')
  })

  it('WZ sprzed serii (bez doc_series) też', () => {
    render(<WzDocumentView doc={DOC} />)
    expect(screen.getByTestId('blok-salda-wz')).toBeTruthy()
  })

  it('WM nie dostaje tabelki', () => {
    render(<WzDocumentView doc={{ ...DOC, doc_series: 'WM', number: 'WM/1/11/26' }} />)
    expect(screen.queryByTestId('blok-salda-wz')).toBeNull()
  })
})
