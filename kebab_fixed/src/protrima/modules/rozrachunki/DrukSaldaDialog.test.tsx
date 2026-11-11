// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { AppCtx, type AppApi } from '../../shell/context'
import { SUROWA_KARTA } from './daneTestowe.fixture'
import { mapujKarte } from './model'

/** Drukuj saldo — zestawienie na dzień albo historia za okres; PDF z serwera (rozliczeniaPdf). */
const dok = vi.hoisted(() => ({ openDocument: vi.fn(), downloadDocPdf: vi.fn() }))
vi.mock('@/lib/api', async (orig) => ({ ...(await orig() as object), ...dok }))
import { DrukSaldaDialog } from './DrukSaldaDialog'

describe('Rozrachunki — drukuj saldo', () => {
  const app = { toast: vi.fn(), appRef: { current: null }, scale: 1 } as unknown as AppApi
  const onClose = vi.fn()
  const karta = mapujKarte(SUROWA_KARTA)
  const mount = () => render(<AppCtx.Provider value={app}><DrukSaldaDialog karta={karta} onClose={onClose} onZapisano={vi.fn()} /></AppCtx.Provider>)
  const przycisk = (n: string) => screen.getByRole('button', { name: n }) as HTMLButtonElement

  afterEach(() => { cleanup(); vi.useRealTimers() })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-09T10:00:00'))
    dok.openDocument.mockReset().mockResolvedValue(undefined)
    dok.downloadDocPdf.mockReset().mockResolvedValue(undefined)
    onClose.mockReset()
    ;(app.toast as ReturnType<typeof vi.fn>).mockClear()
  })

  it('domyślnie zestawienie na dziś → „Podgląd / drukuj” (z fokusem) otwiera PDF; okno zostaje na „Zapisz PDF”', async () => {
    mount()
    expect(document.activeElement).toBe(przycisk('Podgląd / drukuj'))
    expect(przycisk('Zestawienie należności na dzień').getAttribute('aria-pressed')).toBe('true')
    expect((screen.getByLabelText('Na dzień') as HTMLInputElement).value).toBe('2026-11-09')
    fireEvent.click(przycisk('Podgląd / drukuj'))
    await waitFor(() => expect(dok.openDocument).toHaveBeenCalled())
    const [url, nazwa] = dok.openDocument.mock.calls[0]
    expect(url).toMatch(/\/rozliczenia\/klient\/c1\/zestawienie\/pdf\?na_dzien=2026-11-09$/)
    expect(nazwa).toBe('Saldo RONDO GRILL 2026-11-09.pdf')
    await waitFor(() => expect(app.toast).toHaveBeenCalled())
    expect(onClose).not.toHaveBeenCalled()
    await waitFor(() => expect(przycisk('Zapisz PDF').disabled).toBe(false))
    fireEvent.click(przycisk('Zapisz PDF'))
    await waitFor(() => expect(dok.downloadDocPdf).toHaveBeenCalledWith(url, nazwa))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('historia za poprzedni miesiąc → „Zapisz PDF” z od–do całego października', async () => {
    mount()
    fireEvent.click(przycisk('Historia rozliczeń za okres'))
    fireEvent.click(przycisk('Poprzedni miesiąc'))
    expect(screen.getByText('01.10.2026 – 31.10.2026')).toBeTruthy()
    fireEvent.click(przycisk('Zapisz PDF'))
    await waitFor(() => expect(dok.downloadDocPdf).toHaveBeenCalled())
    const [url, nazwa] = dok.downloadDocPdf.mock.calls[0]
    expect(url).toContain('/rozliczenia/klient/c1/historia/pdf?od=2026-10-01&do=2026-10-31')
    expect(nazwa).toBe('Rozliczenia RONDO GRILL 2026-10-01_2026-10-31.pdf')
  })

  it('historia: ten miesiąc domyślnie; od–do bez dat — przyciski nieaktywne z podpowiedzią', async () => {
    mount()
    fireEvent.click(przycisk('Historia rozliczeń za okres'))
    expect(przycisk('Ten miesiąc').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('01.11.2026 – 30.11.2026')).toBeTruthy()
    fireEvent.click(przycisk('Od–do'))
    expect(przycisk('Zapisz PDF').disabled).toBe(true)
    expect(przycisk('Podgląd / drukuj').getAttribute('data-tip')).toBe('Wpisz obie daty okresu')
    fireEvent.change(screen.getByLabelText('Od dnia'), { target: { value: '2026-10-10' } })
    fireEvent.change(screen.getByLabelText('Do dnia'), { target: { value: '2026-11-05' } })
    fireEvent.click(przycisk('Podgląd / drukuj'))
    await waitFor(() => expect(dok.openDocument.mock.calls[0][0]).toContain('od=2026-10-10&do=2026-11-05'))
  })

  it('błąd PDF — komunikat w oknie, okno zostaje', async () => {
    dok.openDocument.mockRejectedValue(new Error('Nie udało się wygenerować PDF'))
    mount()
    fireEvent.click(przycisk('Podgląd / drukuj'))
    expect(await screen.findByText(/Nie udało się wygenerować PDF/)).toBeTruthy()
    expect(onClose).not.toHaveBeenCalled()
  })
})
