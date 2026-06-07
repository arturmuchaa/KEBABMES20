import { useState, useEffect, useCallback, useRef } from 'react'

/**
 * Stabilny JSON-equality check.
 * KLUCZOWE: pozwala uniknąć re-renderów przy pollingu gdy serwer zwraca
 * identyczne dane (np. polling /entries co 5s — bez tego cała strona
 * re-renderuje się co 5s mimo braku zmian, powodując mruganie UI).
 */
function shallowEqualByJson(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || a === undefined || b === undefined) return false
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[] = []) {
  const [data,    setData]    = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const ref       = useRef(fetcher)
  ref.current     = fetcher
  const abortRef  = useRef<AbortController | null>(null)
  // Trzymamy referencję do `data`, żeby `run` mógł sprawdzić czy to pierwszy fetch
  // (pokazać skeleton) czy refetch (cicho, bez migania UI).
  const dataRef   = useRef<T | null>(null)
  dataRef.current = data

  const run = useCallback(async () => {
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    const firstFetch = dataRef.current === null
    if (firstFetch) setLoading(true)
    setError(null)
    try {
      const result = await ref.current()
      if (!ctrl.signal.aborted) {
        // Pomiń aktualizację jeżeli wynik jest IDENTYCZNY z poprzednim —
        // zapobiega niepotrzebnym re-renderom przy pollingach (mruganiu).
        if (!shallowEqualByJson(dataRef.current, result)) {
          setData(result)
        }
        if (firstFetch) setLoading(false)
      }
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setError(e instanceof Error ? e.message : 'Błąd')
        if (firstFetch) setLoading(false)
      }
    }
  }, []) // eslint-disable-line

  useEffect(() => {
    run()
    return () => { abortRef.current?.abort() }
  }, [run, ...deps]) // eslint-disable-line

  return { data, loading, error, refetch: run }
}

export function useMutation<I = void, O = unknown>(fn: (i: I) => Promise<O>) {
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)

  const mutate = useCallback(async (input?: I): Promise<O> => {
    setLoading(true)
    setError(null)
    try {
      return await fn(input as I)
    } catch (e) {
      const m = e instanceof Error ? e.message : 'Błąd'
      setError(m)
      throw e
    } finally {
      setLoading(false)
    }
  }, [fn]) // eslint-disable-line

  return { mutate, loading, error, clearError: () => setError(null) }
}
