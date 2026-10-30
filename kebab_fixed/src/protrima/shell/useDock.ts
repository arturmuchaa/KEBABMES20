import React, { useCallback, useState } from 'react'
import { useApp } from './context'

const czytaj = (k: string, d: number) => { try { const v = Number(window.localStorage.getItem(k)); return v > 0.2 && v < 0.9 ? v : d } catch { return d } }
const zapisz = (k: string, v: number) => { try { window.localStorage.setItem(k, String(v)) } catch { /* bez pamięci */ } }

/**
 * Lista + panel szczegółów: panel na dole albo z boku (Widok → Panel szczegółów).
 * `ratio` to część obszaru zajęta przez panel; osobno zapamiętana dla dołu i boku.
 */
export function useDock(workRef: React.RefObject<HTMLDivElement>, key: string) {
  const { panel } = useApp()
  const side = panel === 'bok'
  const k = `protrima.dock.${key}.${panel}`
  const def = side ? 0.42 : 0.5
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const ratio = ratios[k] ?? czytaj(k, def)
  const setRatio = useCallback((v: number) => setRatios(r => ({ ...r, [k]: v })), [k])
  const [drag, setDrag] = useState(false)

  const startDrag = useCallback((e: React.MouseEvent) => {
    e.preventDefault(); setDrag(true)
    const box = workRef.current!.getBoundingClientRect()
    let last = ratio
    const move = (ev: MouseEvent) => {
      const r = side ? 1 - (ev.clientX - box.left) / box.width : 1 - (ev.clientY - box.top) / box.height
      last = Math.max(side ? 0.3 : 0.22, Math.min(side ? 0.7 : 0.85, r))
      setRatio(last)
    }
    const up = () => { setDrag(false); window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); zapisz(k, last) }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [workRef, side, ratio, setRatio, k])
  const reset = useCallback(() => { setRatio(def); zapisz(k, def) }, [def, k, setRatio])

  /** Styl listy, gdy panel jest otwarty (`maxed` = panel powiększony). */
  const listStyle = (open: boolean, maxed: boolean): React.CSSProperties => {
    if (!open) return { flex: 1 }
    const r = maxed ? (side ? 0.7 : 0.84) : ratio
    return side ? { width: `calc((100% - 7px) * ${1 - r})`, flex: 'none' } : { height: `calc((100% - 7px) * ${1 - r})`, flex: 'none' }
  }
  return { side, drag, startDrag, reset, listStyle }
}
