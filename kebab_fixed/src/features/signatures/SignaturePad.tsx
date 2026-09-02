/**
 * SignaturePad — pole rysowania wzoru podpisu.
 *
 * Goły <canvas> i Pointer Events: ten sam kod obsługuje palec na HMI
 * rozbioru i mysz w biurze. ŻADNEJ biblioteki zewnętrznej — CSP w Tauri
 * jest restrykcyjne (nonce zabija inline, obce źródła są blokowane) i już
 * raz kosztowało zakład czas przy oknach do druku.
 *
 * Rysunek przycinamy do ramki i skalujemy do 600x200, zanim pójdzie na
 * serwer: kratka podpisu na karcie 1.1.1 ma 18 x 9,5 mm, więc znaczek
 * w rogu wielkiego pustego pola byłby na wydruku niewidoczny.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { bounds, isBlank, SIG_H, SIG_PAD, SIG_W } from './signatureImage'

export function SignaturePad({ onChange, height = 220, disabled = false }: {
  /** Oddaje gotowy PNG (data URI) albo null, gdy pole jest puste. */
  onChange: (png: string | null) => void
  height?: number
  disabled?: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const rysuje = useRef(false)
  const cosNarysowano = useRef(false)
  const [pusty, setPusty] = useState(true)

  /** Płótno pracuje w pikselach URZĄDZENIA — inaczej kreska jest rozmyta
   *  na ekranach o gęstości 2x, a współrzędne rozjeżdżają się z palcem. */
  const przygotuj = useCallback(() => {
    const c = canvasRef.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    const r = c.getBoundingClientRect()
    c.width = Math.round(r.width * dpr)
    c.height = Math.round(r.height * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#111113'
  }, [])

  useEffect(() => {
    przygotuj()
    const onResize = () => { przygotuj(); wyczysc() }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [przygotuj])

  const punkt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!
    const r = c.getBoundingClientRect()
    // Współrzędne CSS, nie urządzenia: kontekst jest już przeskalowany.
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (disabled) return
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    c.setPointerCapture(e.pointerId)
    rysuje.current = true
    const p = punkt(e)
    ctx.beginPath()
    ctx.moveTo(p.x, p.y)
    // Kropka na dotknięcie: bez tego samo tapnięcie nic nie zostawia,
    // a kropka nad „i" jest częścią podpisu.
    ctx.lineTo(p.x + 0.01, p.y)
    ctx.stroke()
    cosNarysowano.current = true
  }

  const rysuj = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!rysuje.current || disabled) return
    const ctx = canvasRef.current?.getContext('2d')
    if (!ctx) return
    const p = punkt(e)
    ctx.lineTo(p.x, p.y)
    ctx.stroke()
  }

  const koniec = () => {
    if (!rysuje.current) return
    rysuje.current = false
    setPusty(!cosNarysowano.current)
    onChange(eksportuj())
  }

  /** Przycięcie do ramki rysunku i przeskalowanie do 600x200. */
  const eksportuj = (): string | null => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return null
    const dane = ctx.getImageData(0, 0, c.width, c.height)
    if (isBlank(dane.data, c.width, c.height)) return null
    const b = bounds(dane.data, c.width, c.height)!

    const out = document.createElement('canvas')
    out.width = SIG_W
    out.height = SIG_H
    const octx = out.getContext('2d')
    if (!octx) return null

    const szer = b.x1 - b.x0 + 1
    const wys = b.y1 - b.y0 + 1
    // Skala wspólna dla obu osi — inaczej podpis rozciąga się w karykaturę.
    const skala = Math.min((SIG_W - SIG_PAD * 2) / szer, (SIG_H - SIG_PAD * 2) / wys)
    const dw = szer * skala
    const dh = wys * skala
    octx.drawImage(c, b.x0, b.y0, szer, wys,
                   (SIG_W - dw) / 2, (SIG_H - dh) / 2, dw, dh)
    return out.toDataURL('image/png')
  }

  const wyczysc = () => {
    const c = canvasRef.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    cosNarysowano.current = false
    setPusty(true)
    onChange(null)
  }

  return (
    <div className="space-y-2">
      <div
        className="relative rounded-md border-2 border-dashed"
        style={{ borderColor: '#C4C4C7', background: '#FFFFFF' }}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={rysuj}
          onPointerUp={koniec}
          onPointerLeave={koniec}
          onPointerCancel={koniec}
          style={{
            width: '100%',
            height,
            display: 'block',
            // Bez tego palec PRZEWIJA stronę zamiast rysować.
            touchAction: 'none',
            cursor: disabled ? 'not-allowed' : 'crosshair',
          }}
        />
        {pusty && (
          <span
            className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm"
            style={{ color: '#A3A3A8' }}
          >
            Podpisz się palcem
          </span>
        )}
        {/* Linia podpisu — bez niej ludzie rysują w losowym miejscu pola. */}
        <span
          className="pointer-events-none absolute"
          style={{ left: '8%', right: '8%', bottom: 34, height: 1, background: '#DCDCDE' }}
        />
      </div>
      <button
        type="button"
        onClick={wyczysc}
        disabled={disabled || pusty}
        className="text-sm font-semibold underline disabled:opacity-40 disabled:no-underline"
      >
        Wyczyść
      </button>
    </div>
  )
}
