/**
 * Harmonogram odświeżania planu i postępu skanów HMI produkcji — moduł czysty,
 * fałszywy zegar. Liczby to SYMULACJA (natychmiastowe API), nie pomiar sprzętu.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { utworzHarmonogramOdswiezania, OKRES_MS, CISZA_MS, MIN_ODSTEP_MS } from './harmonogramOdswiezania'

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

/** Odświeżenie, które czeka na `pusc()` — do sprawdzania „jeden w locie". */
function wolneOdswiezanie() {
  const st = { wolania: 0, wLocie: 0, maxWLocie: 0, pusc: [] as (() => void)[] }
  const odswiez = () => {
    st.wolania++; st.wLocie++; st.maxWLocie = Math.max(st.maxWLocie, st.wLocie)
    return new Promise<void>(r => { st.pusc.push(() => { st.wLocie--; r() }) })
  }
  return { st, odswiez }
}

describe('utworzHarmonogramOdswiezania', () => {
  it('bez skanów odświeża co 5 s — zmiany z biura przychodzą same', async () => {
    const odswiez = vi.fn(() => Promise.resolve())
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    await vi.advanceTimersByTimeAsync(OKRES_MS - 1)
    expect(odswiez).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(odswiez).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(OKRES_MS * 2)
    expect(odswiez).toHaveBeenCalledTimes(3)
    h.zatrzymaj()
  })

  it('100 zapisów co 50 ms: najwyżej 3 odczyty w 5 s + ciszy, ostatni zapis pokryty', async () => {
    const odswiez = vi.fn(() => Promise.resolve())
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    const starty: number[] = []
    odswiez.mockImplementation(() => { starty.push(Date.now()); return Promise.resolve() })
    const t0 = Date.now()
    let ostatniZapis = 0
    for (let i = 0; i < 100; i++) {
      h.poZapisie(); ostatniZapis = Date.now()
      await vi.advanceTimersByTimeAsync(50)
    }
    await vi.advanceTimersByTimeAsync(CISZA_MS + 400)
    expect(odswiez.mock.calls.length).toBeGreaterThanOrEqual(1)
    expect(odswiez.mock.calls.length).toBeLessThanOrEqual(3)
    // Stała seria nie przesuwa odczytu w nieskończoność: pierwszy najpóźniej po okresie.
    expect(starty[0] - t0).toBeLessThanOrEqual(OKRES_MS)
    // Jakiś odczyt wyszedł PO ostatnim zapisie (końcowe uzgodnienie).
    expect(starty.some(s => s >= ostatniZapis)).toBe(true)
    h.zatrzymaj()
  })

  it('pojedynczy zapis: jedno odświeżenie po ciszy, nie od razu', async () => {
    const odswiez = vi.fn(() => Promise.resolve())
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    h.poZapisie()
    await vi.advanceTimersByTimeAsync(CISZA_MS - 1)
    expect(odswiez).toHaveBeenCalledTimes(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(odswiez).toHaveBeenCalledTimes(1)
    h.zatrzymaj()
  })

  it('jedno odświeżenie w locie; prośby w trakcie = JEDNO dodatkowe po nim', async () => {
    const { st, odswiez } = wolneOdswiezanie()
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    h.teraz(); h.teraz(); h.teraz()
    expect(st.wolania).toBe(1)
    st.pusc.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(st.wolania).toBe(2)
    st.pusc.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    expect(st.wolania).toBe(2)
    expect(st.maxWLocie).toBe(1)
    h.zatrzymaj()
  })

  it('zapis W TRAKCIE odczytu dostaje własne odświeżenie po nim (odczyt mógł wyjść wcześniej)', async () => {
    const { st, odswiez } = wolneOdswiezanie()
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    h.teraz()
    h.poZapisie()
    await vi.advanceTimersByTimeAsync(CISZA_MS + MIN_ODSTEP_MS)
    expect(st.wolania).toBe(1)                // nic nie nakłada się na odczyt w locie
    st.pusc.shift()!()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(MIN_ODSTEP_MS)
    expect(st.wolania).toBe(2)
    h.zatrzymaj()
  })

  it('zatrzymaj: żadnych timerów ani nowych odczytów, także po odczycie w locie', async () => {
    const { st, odswiez } = wolneOdswiezanie()
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    h.teraz()
    h.poZapisie()
    h.zatrzymaj()
    st.pusc.shift()!()
    await vi.advanceTimersByTimeAsync(OKRES_MS * 3)
    expect(st.wolania).toBe(1)
    h.poZapisie(); h.teraz()
    await vi.advanceTimersByTimeAsync(OKRES_MS)
    expect(st.wolania).toBe(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
