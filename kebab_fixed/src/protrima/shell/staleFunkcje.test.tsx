// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, cleanup, act } from '@testing-library/react'
import React, { useEffect, useMemo, useState } from 'react'
import { useStaleFunkcje } from './staleFunkcje'

afterEach(cleanup)

/**
 * Karta robocza (edytor zamówienia, przyjęcia, WZ, podział, papiery kursu) liczy
 * polecenia z `onDone` i oddaje je powłoce przez `setCmds` — powłoka zapisuje je
 * w swoim stanie i renderuje się od nowa. Funkcja pisana w miejscu (`() => …`)
 * jest wtedy przy każdym renderze nowa → nowe polecenia → `setCmds` → render…
 * bez końca (31.10.2026: edytor zamówienia kręcił się w kółko, klik nie dochodził).
 */
function Karta({ onDone, setCmds, licz }: { onDone: () => void; setCmds: (c: unknown[]) => void; licz: () => void }) {
  licz()
  const cmds = useMemo(() => [{ id: 'close', run: onDone }], [onDone])
  useEffect(() => { setCmds(cmds) }, [cmds, setCmds])
  return null
}

function Powloka({ licz, naZamknij }: { licz: () => void; naZamknij: (n: number) => void }) {
  const [, setCmdMap] = useState<unknown[]>([])
  const [wersja, setWersja] = useState(0)
  const stala = useStaleFunkcje()
  // `setCmds` stały jak w App (cmdsFor), `onDone` pisany w miejscu — przez `stala`.
  const setCmds = useMemo(() => (c: unknown[]) => setCmdMap(c), [])
  return (
    <>
      <button onClick={() => setWersja(v => v + 1)}>odśwież</button>
      <Karta licz={licz} setCmds={setCmds} onDone={stala('done:t1', () => naZamknij(wersja))} />
    </>
  )
}

describe('stałe funkcje kart roboczych', () => {
  it('ta sama tożsamość między renderami, woła NAJNOWSZĄ funkcję', () => {
    let ostatnia: ((x: number) => number) | null = null
    const tozsamosci = new Set<unknown>()
    function T({ mnoznik }: { mnoznik: number }) {
      const stala = useStaleFunkcje()
      ostatnia = stala('k', (x: number) => x * mnoznik)
      tozsamosci.add(ostatnia)
      return null
    }
    const { rerender } = render(<T mnoznik={2} />)
    rerender(<T mnoznik={3} />)
    rerender(<T mnoznik={5} />)
    expect(tozsamosci.size).toBe(1)
    expect(ostatnia!(10)).toBe(50)
  })

  it('różne klucze → różne funkcje (każda karta ma swoją)', () => {
    let a: unknown, b: unknown
    function T() { const stala = useStaleFunkcje(); a = stala('done:a', () => 1); b = stala('done:b', () => 2); return null }
    render(<T />)
    expect(a).not.toBe(b)
  })

  it('karta z poleceniami zależnymi od onDone nie wpada w pętlę renderów', () => {
    let rendery = 0
    const zamkniete: number[] = []
    // Bezpiecznik: pętla renderów ma skończyć test błędem, a nie go zawiesić.
    const licz = () => { if (++rendery > 50) throw new Error('pętla renderów karty roboczej') }
    const { getByText } = render(<Powloka licz={licz} naZamknij={n => zamkniete.push(n)} />)
    // Pierwszy render + render po setCmds. Bez stałej funkcji: setki renderów i ostrzeżenie Reacta.
    expect(rendery).toBeLessThanOrEqual(3)
    act(() => { getByText('odśwież').click() })
    expect(rendery).toBeLessThanOrEqual(5)
  })
})
