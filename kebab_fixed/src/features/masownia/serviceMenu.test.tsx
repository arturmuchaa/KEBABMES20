// @vitest-environment jsdom
/**
 * Menu serwisowe na masowni — to INNY komputer niż kiosk rozbioru (uwaga
 * właściciela 17.09.2026), a serwisant staje przy nim zalogowany: bez wejścia
 * z ekranu roboczego nie sprawdzi portu wagi ani nie cofnie wersji.
 *
 * Masownia nie ma drukarki etykiet ani nie zbiera wzorów podpisów — te sekcje
 * zostają przy rozbiorze, żeby przy maszynie nie było przycisków donikąd.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import '@testing-library/jest-dom/vitest'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import { ServiceMenuModal, SERVICE_CODE } from '@/features/deboning/ServiceMenu'

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ versions: [] }) })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

const wpiszKod = async () => {
  for (const c of SERVICE_CODE) {
    fireEvent.click(screen.getByRole('button', { name: c }))
  }
  await act(async () => { await Promise.resolve() })
}

describe('menu serwisowe masowni', () => {
  it('pokazuje diagnostykę wagi — po to serwisant tu wchodzi', async () => {
    render(<ServiceMenuModal open onClose={vi.fn()} channel="masowanie" version="1.0.4"
      sections={{ printer: false, signatures: false }} />)
    await wpiszKod()
    expect(screen.getAllByText(/Diagnostyka wagi/i).length).toBeGreaterThan(0)
  })

  it('nie proponuje drukarki etykiet ani wzorów podpisów', async () => {
    render(<ServiceMenuModal open onClose={vi.fn()} channel="masowanie" version="1.0.4"
      sections={{ printer: false, signatures: false }} />)
    await wpiszKod()
    expect(screen.queryByText(/Drukarka etykiet/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /Wzory podpisów/i })).toBeNull()
  })

  it('rozbiór dostaje komplet sekcji — domyślnie nic nie znika', async () => {
    render(<ServiceMenuModal open onClose={vi.fn()} channel="rozbior-v10" version="1.0.80" />)
    await wpiszKod()
    expect(screen.getByText(/Drukarka etykiet/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Wzory podpisów/i })).toBeInTheDocument()
  })

  it('cofnięcie wersji pyta serwer o kanał tego kiosku, nie cudzego', async () => {
    render(<ServiceMenuModal open onClose={vi.fn()} channel="masowanie" version="1.0.4"
      sections={{ printer: false, signatures: false }} />)
    await wpiszKod()
    const adresy = (fetch as any).mock.calls.map((c: any[]) => String(c[0]))
    expect(adresy.some(a => a.includes('/desktop-updates/masowanie/versions'))).toBe(true)
    expect(adresy.some(a => a.includes('rozbior'))).toBe(false)
  })
})
