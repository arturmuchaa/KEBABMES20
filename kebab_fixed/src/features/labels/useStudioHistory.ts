import { useLayoutEffect, useRef, useState } from 'react'

/** Bounded snapshots share immutable resources. A drag is one history entry.
 * The caller must not mutate nested objects. UI state (zoom/selection) stays out.
 */
export function useStudioHistory<T extends Record<string, unknown>>(
  value: T, apply: (snapshot: T) => void, resetKey: string, paused: boolean,
) {
  const history = useRef<{ key: string; past: T[]; current: T; future: T[] }>({ key: resetKey, past: [], current: value, future: [] })
  const [, refresh] = useState(0)
  useLayoutEffect(() => {
    const h = history.current
    if (h.key !== resetKey) {
      history.current = { key: resetKey, past: [], current: value, future: [] }
      refresh(n => n + 1)
    } else if (!paused && Object.keys(value).some(key => h.current[key] !== value[key])) {
      h.past = [...h.past.slice(-59), h.current]
      h.current = value
      h.future = []
      refresh(n => n + 1)
    }
  }, [value, resetKey, paused])
  function undo() {
    if (paused) return
    const h = history.current
    const previous = h.past.pop()
    if (!previous) return
    h.future.push(h.current); h.current = previous
    apply(previous); refresh(n => n + 1)
  }
  function redo() {
    if (paused) return
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(h.current); h.current = next
    apply(next); refresh(n => n + 1)
  }
  return { undo, redo, canUndo: !paused && history.current.past.length > 0, canRedo: !paused && history.current.future.length > 0 }
}
