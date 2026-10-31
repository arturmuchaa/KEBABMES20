import { useRef } from 'react'

type Fn = (...a: never[]) => unknown

/**
 * Stałe funkcje dla kart roboczych powłoki — `stala(klucz, fn)` zwraca dla danego klucza
 * ZAWSZE tę samą funkcję, która woła najnowszą przekazaną `fn`.
 *
 * Po co: karta (edytor zamówienia, przyjęcia, WZ, podział wysyłki, papiery kursu) liczy
 * polecenia z `onDone` i oddaje je powłoce przez `setCmds`; powłoka zapisuje je w stanie
 * i renderuje się od nowa. `onDone` pisany w miejscu był przy każdym renderze nowy →
 * nowe polecenia → `setCmds` → render powłoki → … bez końca (31.10.2026: edytor
 * zamówienia przerysowywał się w kółko, kliknięcia nie dochodziły).
 * Ten sam wzorzec co `cmdsFor`/`ctxFor` w App — tam dla setterów, tu dla wywołań zwrotnych.
 */
export function useStaleFunkcje() {
  const najnowsze = useRef<Record<string, Fn>>({})
  const stale = useRef<Record<string, Fn>>({})
  const stala = useRef(<F extends Fn>(klucz: string, fn: F): F => {
    najnowsze.current[klucz] = fn
    return (stale.current[klucz] ??= ((...a: never[]) => najnowsze.current[klucz](...a)) as Fn) as F
  })
  return stala.current
}
