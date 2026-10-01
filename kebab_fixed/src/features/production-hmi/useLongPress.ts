/**
 * Przytrzymanie wiersza planu → szczegóły; krótkie dotknięcie → wybór.
 *
 * Hala obsługuje ekran palcem w rękawicy, więc o „przytrzymaniu" decyduje
 * czas, a nie menu kontekstowe przeglądarki (to blokujemy). Drgnięcie palca
 * o kilka pikseli nie przerywa gestu; przesunięcie dalej — tak, bo to już
 * nie jest przytrzymanie. Po długim przytrzymaniu przeglądarka i tak wyśle
 * `click` — połykamy go, inaczej szczegóły otwierałyby się RAZEM ze zmianą
 * zaznaczenia.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type React from 'react'

export const LONG_PRESS_MS = 600
const TOLERANCJA_PX = 12

export function useLongPress(onLongPress: () => void, onClick: () => void, ms = LONG_PRESS_MS) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const start = useRef<{ x: number; y: number } | null>(null)
  const zjedzKlik = useRef(false)
  const [wciska, setWciska] = useState(false)
  const longRef = useRef(onLongPress); longRef.current = onLongPress
  const clickRef = useRef(onClick); clickRef.current = onClick

  const sprzatnij = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    start.current = null
    setWciska(false)
  }, [])

  // Odmontowanie wiersza (np. biuro zdjęło pozycję) w trakcie przytrzymania.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (e.button !== undefined && e.button !== 0) return
    zjedzKlik.current = false
    start.current = { x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 }
    setWciska(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      start.current = null
      setWciska(false)
      zjedzKlik.current = true
      longRef.current()
    }, ms)
  }, [ms])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const s = start.current
    if (!s) return
    const x = Number(e.clientX) || 0, y = Number(e.clientY) || 0
    if (Math.abs(x - s.x) > TOLERANCJA_PX || Math.abs(y - s.y) > TOLERANCJA_PX) sprzatnij()
  }, [sprzatnij])

  const onClickCapture = useCallback(() => {
    if (zjedzKlik.current) { zjedzKlik.current = false; return }
    clickRef.current()
  }, [])

  return {
    pressing: wciska,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp: sprzatnij,
      onPointerCancel: sprzatnij,
      onPointerLeave: sprzatnij,
      onClick: onClickCapture,
      onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    },
  }
}
