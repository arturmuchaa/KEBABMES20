// @vitest-environment jsdom
/**
 * Kolejka skanów głównego ekranu produkcji: FIFO, jeden POST w locie, plan
 * zamrożony w rekordzie, błąd jednej sztuki nie zatrzymuje reszty, nic nie
 * jest ponawiane, odmontowanie nie wypuszcza nowych POST-ów. Plus pomiar
 * (symulacja, nie sprzęt): seria 100 kodów co 50 ms z natychmiastowym API
 * razem z harmonogramem odświeżania.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

const dzwiek = vi.hoisted(() => ({ ok: 0, err: 0 }))
vi.mock('@/features/pwa/beep', () => ({
  beepOk: () => { dzwiek.ok++ },
  beepErr: () => { dzwiek.err++ },
}))

import { useKolejkaSkanow, type RekordSkanu } from './useKolejkaSkanow'
import { utworzHarmonogramOdswiezania } from './harmonogramOdswiezania'
import type { ScanProducedResult } from '@/lib/api'

const wynik = (r: RekordSkanu, over: Partial<ScanProducedResult> = {}): ScanProducedResult => ({
  ok: true, unitId: r.kod, status: 'produced', clientName: 'Bulli', batchNo: 'B1', weightKg: 35,
  done: 1, total: 10, onStock: true, planId: r.planId, planLineId: 'l1', recipeName: 'WROCŁAW', ...over,
})

/** API z licznikiem współbieżności; `wstrzymane` kody czekają na `pusc`. */
function api(opcje: { wstrzymaj?: (r: RekordSkanu) => boolean; blad?: (r: RekordSkanu) => any } = {}) {
  const st = { wolania: [] as RekordSkanu[], wLocie: 0, maxWLocie: 0, pusc: [] as (() => void)[] }
  const wyslij = (r: RekordSkanu) => {
    st.wolania.push(r)
    st.wLocie++; st.maxWLocie = Math.max(st.maxWLocie, st.wLocie)
    const zakoncz = (): Promise<ScanProducedResult> => {
      st.wLocie--
      const b = opcje.blad?.(r)
      return b ? Promise.reject(b) : Promise.resolve(wynik(r))
    }
    if (opcje.wstrzymaj?.(r)) return new Promise<ScanProducedResult>((ok, nie) => { st.pusc.push(() => { zakoncz().then(ok, nie) }) })
    return zakoncz()
  }
  return { st, wyslij }
}

const plynnie = () => act(async () => { for (let i = 0; i < 50; i++) await Promise.resolve() })

beforeEach(() => { dzwiek.ok = 0; dzwiek.err = 0 })
afterEach(() => { cleanup(); vi.useRealTimers() })

describe('useKolejkaSkanow', () => {
  it('500 kodów z WOLNĄ pierwszą odpowiedzią: FIFO, max 1 w locie, nic nie ginie, planId zamrożony', async () => {
    const { st, wyslij } = api({ wstrzymaj: r => r.nr === 1 })
    const sukces = vi.fn()
    const { result } = renderHook(() => useKolejkaSkanow({ wyslij, onSukces: sukces }))
    const kody = Array.from({ length: 500 }, (_, i) => `u${String(i).padStart(20, '0')}`)
    act(() => { kody.forEach(k => result.current.przyjmij(k, 'p1')) })

    expect(st.wolania).toHaveLength(1)
    expect(result.current.stan.oczekujace).toBe(500)
    expect(result.current.czekaja()).toBe(true)
    expect(result.current.stan.zapisane).toBe(0)      // przyjęcie ≠ sukces
    expect(dzwiek.ok).toBe(0)

    await act(async () => { st.pusc.shift()!(); for (let i = 0; i < 10000; i++) await Promise.resolve() })

    expect(st.wolania.map(r => r.kod)).toEqual(kody)
    expect(st.wolania.every(r => r.planId === 'p1')).toBe(true)
    expect(st.maxWLocie).toBe(1)
    expect(result.current.stan.zapisane).toBe(500)
    expect(result.current.stan.oczekujace).toBe(0)
    expect(result.current.czekaja()).toBe(false)
    expect(sukces).toHaveBeenCalledTimes(500)
    expect(dzwiek.ok).toBe(500)
  })

  it('błąd w środku serii: następne idą dalej; odmowa 4xx pewna, sieć = wynik niepewny; bez retry', async () => {
    const { st, wyslij } = api({
      blad: r => r.kod === 'u-dubel' ? Object.assign(new Error('Sztuka już zeskanowana'), { status: 409 })
        : r.kod === 'u-siec' ? new Error('Failed to fetch') : null,
    })
    const { result } = renderHook(() => useKolejkaSkanow({ wyslij }))
    act(() => { ['u-1', 'u-dubel', 'u-2', 'u-siec', 'u-3'].forEach(k => result.current.przyjmij(k, 'p1')) })
    await plynnie(); await plynnie()

    expect(st.wolania.map(r => r.kod)).toEqual(['u-1', 'u-dubel', 'u-2', 'u-siec', 'u-3'])
    expect(result.current.stan.zapisane).toBe(3)
    const bledy = result.current.stan.bledy
    expect(bledy.map(b => b.kod)).toEqual(['u-siec', 'u-dubel'])     // najnowszy na górze, trwałe
    expect(bledy.find(b => b.kod === 'u-dubel')!.niepewny).toBe(false)
    expect(bledy.find(b => b.kod === 'u-siec')!.niepewny).toBe(true)
    expect(bledy.find(b => b.kod === 'u-siec')!.tytul).toMatch(/niepewny/)
    expect(dzwiek.err).toBe(2)
  })

  it('natychmiastowy powtórny skan tej samej etykiety NIE jest cicho połykany (serwer powie „dubel")', async () => {
    const { st, wyslij } = api()
    const { result } = renderHook(() => useKolejkaSkanow({ wyslij }))
    act(() => { result.current.przyjmij('u-1', 'p1'); result.current.przyjmij('u-1', 'p1') })
    await plynnie()
    expect(st.wolania.map(r => r.kod)).toEqual(['u-1', 'u-1'])
  })

  it('odrzuc: skan wstrzymany idzie na listę błędów bez POST', () => {
    const { st, wyslij } = api()
    const { result } = renderHook(() => useKolejkaSkanow({ wyslij }))
    act(() => { result.current.odrzuc('u-1', 'Nie wysłano — skaner wstrzymany', 'przerwa') })
    expect(st.wolania).toHaveLength(0)
    expect(result.current.stan.bledy[0]).toMatchObject({ kod: 'u-1', niepewny: false })
    act(() => { result.current.wyczyscBledy() })
    expect(result.current.stan.bledy).toHaveLength(0)
  })

  it('odmontowanie: odpowiedź w locie nie zmienia stanu, kolejne POST-y nie wychodzą', async () => {
    const { st, wyslij } = api({ wstrzymaj: () => true })
    const sukces = vi.fn()
    const blad = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, unmount } = renderHook(() => useKolejkaSkanow({ wyslij, onSukces: sukces }))
    act(() => { ['a', 'b', 'c'].forEach(k => result.current.przyjmij(k, 'p1')) })
    expect(st.wolania).toHaveLength(1)
    unmount()
    await act(async () => { st.pusc.shift()!(); for (let i = 0; i < 20; i++) await Promise.resolve() })
    expect(st.wolania).toHaveLength(1)
    expect(sukces).not.toHaveBeenCalled()
    expect(dzwiek.ok).toBe(0)
    // Kod po odmontowaniu nic nie przyjmuje.
    result.current.przyjmij('d', 'p1')
    expect(st.wolania).toHaveLength(1)
    expect(blad).not.toHaveBeenCalled()
    blad.mockRestore()
  })

  it('pomiar (symulacja): 100 kodów co 50 ms, natychmiastowe API → 100 POST i ≤ 3 odświeżenia w 5 s + cisza', async () => {
    vi.useFakeTimers()
    const { st, wyslij } = api()
    const odswiez = vi.fn(() => Promise.resolve())
    const h = utworzHarmonogramOdswiezania({ odswiez })
    h.start()
    const { result } = renderHook(() => useKolejkaSkanow({ wyslij, onSukces: () => h.poZapisie() }))

    for (let i = 0; i < 100; i++) {
      act(() => { result.current.przyjmij(`u${i}`, 'p1') })
      await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })   // cisza po serii

    expect(st.wolania).toHaveLength(100)
    expect(result.current.stan.zapisane).toBe(100)
    const odczyty = odswiez.mock.calls.length
    expect(odczyty).toBeGreaterThanOrEqual(1)
    expect(odczyty).toBeLessThanOrEqual(3)
    h.zatrzymaj()
  })
})
