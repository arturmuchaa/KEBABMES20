/**
 * Wspólny layout etykiety kartonu (A4 poziom) — IDENTYCZNY dla palety zamówienia
 * i kartonu magazynowego. Auto-dopasowanie czcionki + auto-druk gdy gotowe.
 *
 * Dane są przekazywane jako propsy (klient, pozycje „N X KGkg", waga, numer
 * w rogu, QR), żeby oba źródła (zamówienie / stock_carton) dawały ten sam wydruk.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { fmtKg } from '@/lib/utils'

export function formatKgCompact(value: number) {
  return Number.isInteger(value) ? fmtKg(value, 0) : fmtKg(value, 1)
}

export interface CartonLabelProps {
  /** Duży numer w prawym górnym rogu (np. „P3" lub numer kartonu). */
  topBig: string
  /** Mały podpis nad numerem (np. „KARTON 000042"). */
  topSmall?: string
  clientName: string
  /** Pozycje główne, np. ["18 X 40KG"]. */
  mainLines: string[]
  totalKg: number
  /** Lewy dół: etykieta + wartość (np. „ZAMÓWIENIE:" / „ZAM/1" albo „MAGAZYN" / ""). */
  footerLabel: string
  footerValue: string
  qrDataUrl: string
  qrCaption: string
  backTo: string
  backLabel?: string
}

export function CartonLabel(props: CartonLabelProps) {
  const { topBig, topSmall, clientName, mainLines, totalKg,
          footerLabel, footerValue, qrDataUrl, qrCaption, backTo,
          backLabel = 'Wróć' } = props

  const contentBoxRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const printedRef = useRef(false)
  const [fontSizePt, setFontSizePt] = useState(90)
  const [layoutReady, setLayoutReady] = useState(false)

  useLayoutEffect(() => {
    function fitContent() {
      const box = contentBoxRef.current
      const content = contentRef.current
      if (!box || !content) return
      const availableWidth = Math.max(120, box.clientWidth)
      const availableHeight = Math.max(120, box.clientHeight)
      let next = 90
      content.style.fontSize = `${next}pt`
      while (next > 30 && (content.scrollWidth > availableWidth || content.scrollHeight > availableHeight)) {
        next -= 2
        content.style.fontSize = `${next}pt`
      }
      setFontSizePt(next)
      setLayoutReady(true)
    }
    setLayoutReady(false)
    setFontSizePt(90)
    const frame = window.requestAnimationFrame(fitContent)
    window.addEventListener('resize', fitContent)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', fitContent) }
  }, [clientName, mainLines.join('|')])

  useEffect(() => {
    if (!layoutReady || !qrDataUrl || printedRef.current) return
    printedRef.current = true
    const t = window.setTimeout(() => window.print(), 250)
    return () => window.clearTimeout(t)
  }, [layoutReady, qrDataUrl])

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`
        .label-page { width: 297mm; height: 210mm; background: #fff; }
        @media screen { .label-page { margin: 16px auto; box-shadow: 0 1px 4px rgba(0,0,0,.08); } }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .label-page { margin: 0 !important; box-shadow: none !important; }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link to={backTo} className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900">
          <ArrowLeft size={14} /> {backLabel}
        </Link>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
          <Printer size={14} /> Drukuj etykietę
        </button>
      </div>

      <div className="label-page relative overflow-hidden">
        <div className="flex h-full w-full flex-col px-[12.7mm] py-[12.7mm]">
          <div className="flex items-start justify-end leading-none" style={{ fontFamily: '"Arial Black", Arial, sans-serif' }}>
            <div className="flex flex-col items-end">
              {topSmall && (
                <div className="text-[11pt] font-bold tracking-wider text-slate-700" style={{ fontFamily: 'Arial, sans-serif' }}>
                  {topSmall}
                </div>
              )}
              <div className="text-[38pt]">{topBig}</div>
            </div>
          </div>

          <div ref={contentBoxRef} className="flex flex-1 items-center justify-center overflow-hidden py-4">
            <div
              ref={contentRef}
              className="text-center uppercase leading-[0.94]"
              style={{
                fontFamily: '"Arial Black", Arial, sans-serif',
                fontWeight: 900,
                fontSize: `${fontSizePt}pt`,
                visibility: layoutReady ? 'visible' : 'hidden',
              }}
            >
              <div>{clientName}</div>
              {mainLines.map((ln, i) => (
                <div key={i} className={i === 0 ? 'mt-4' : ''}>{ln}</div>
              ))}
            </div>
          </div>

          <div className="flex items-end justify-between gap-6" style={{ fontFamily: 'Arial, sans-serif' }}>
            <div className="text-left leading-tight">
              <div className="text-[13pt] font-semibold tracking-wide text-slate-700">WAGA NETTO</div>
              <div className="text-[18pt] font-bold">{formatKgCompact(totalKg)} KG</div>
              <div className="mt-2 text-[10pt] uppercase tracking-wide text-slate-600">
                {footerLabel}{footerValue ? ` ${footerValue}` : ''}
              </div>
            </div>
            {qrDataUrl && (
              <div className="flex flex-col items-center text-center">
                <img src={qrDataUrl} alt="QR" className="block" style={{ width: '38mm', height: '38mm', imageRendering: 'pixelated' }} />
                <div className="mt-1 text-[8pt] font-mono leading-none text-slate-700">{qrCaption}</div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
