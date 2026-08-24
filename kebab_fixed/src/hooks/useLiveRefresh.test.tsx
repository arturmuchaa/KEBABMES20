// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import { useState } from 'react'
import { useLiveRefresh } from './useLiveRefresh'

/**
 * Odświeżanie żywych danych ekranu.
 *
 * POWÓD ISTNIENIA: ekran rozbioru miał ręcznie pisany `setInterval` z listą
 * czterech `refetch()` i tablicą zależności. Dołożenie piątego źródła wymagało
 * pamiętania o dopisaniu go w DWÓCH miejscach — i 24.08.2026 nie zostało
 * dopisane: licznik partii zamarzł na wartości sprzed wejścia na ekran.
 *
 * Tu nie ma listy do zapomnienia: odświeżamy WSZYSTKIE wpisy obiektu źródeł.
 */
afterEach(cleanup)

function Ekran({ zrodla, everyMs = 1000 }: { zrodla: Record<string, { refetch: () => void }>; everyMs?: number }) {
  useLiveRefresh(zrodla, everyMs)
  return null
}

describe('useLiveRefresh', () => {
  it('odświeża wszystkie źródła w takt interwału', () => {
    vi.useFakeTimers()
    const a = vi.fn(), b = vi.fn()
    render(<Ekran zrodla={{ a: { refetch: a }, b: { refetch: b } }} />)
    expect(a).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1000) })
    expect(a).toHaveBeenCalledTimes(1)
    expect(b).toHaveBeenCalledTimes(1)
    act(() => { vi.advanceTimersByTime(2000) })
    expect(a).toHaveBeenCalledTimes(3)
    vi.useRealTimers()
  })

  it('źródło DOŁOŻONE później też jest odświeżane — nie ma listy do zapomnienia', () => {
    vi.useFakeTimers()
    const stare = vi.fn(), nowe = vi.fn()
    function Rosnacy() {
      const [maNowe, setMaNowe] = useState(false)
      useLiveRefresh(maNowe
        ? { stare: { refetch: stare }, nowe: { refetch: nowe } }
        : { stare: { refetch: stare } }, 1000)
      return <button onClick={() => setMaNowe(true)}>dołóż</button>
    }
    const { getByText } = render(<Rosnacy />)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(nowe).not.toHaveBeenCalled()
    act(() => { getByText('dołóż').click() })
    act(() => { vi.advanceTimersByTime(1000) })
    expect(nowe).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('zmiana zestawu źródeł NIE restartuje odliczania', () => {
    // Interwał tworzony raz: gdyby zależał od obiektu źródeł, każdy render
    // kasowałby timer przed jego strzałem i odświeżanie nigdy by nie nastąpiło.
    vi.useFakeTimers()
    const f = vi.fn()
    function Migajacy() {
      const [n, setN] = useState(0)
      useLiveRefresh({ a: { refetch: f } }, 1000)   // NOWY obiekt co render
      return <button onClick={() => setN(n + 1)}>render {n}</button>
    }
    const { getByText } = render(<Migajacy />)
    act(() => { vi.advanceTimersByTime(900) })
    act(() => { getByText(/render/).click() })
    act(() => { vi.advanceTimersByTime(200) })
    expect(f).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('sprząta po sobie przy zamknięciu ekranu', () => {
    vi.useFakeTimers()
    const f = vi.fn()
    const { unmount } = render(<Ekran zrodla={{ a: { refetch: f } }} />)
    unmount()
    act(() => { vi.advanceTimersByTime(5000) })
    expect(f).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
