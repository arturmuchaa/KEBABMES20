/**
 * Wspólny layout etykiety kartonu (A4 poziom) — IDENTYCZNY dla palety zamówienia
 * i kartonu magazynowego. Auto-dopasowanie czcionki + auto-druk gdy gotowe.
 *
 * Dane są przekazywane jako propsy (klient, pozycje „N X KGkg (receptura)",
 * waga, numer w rogu, QR), żeby oba źródła (zamówienie / stock_carton) dawały
 * ten sam wydruk. Treść pozycji buduje `cartonLabelLines.ts`.
 *
 * DWIE KOPIE. Właściciel (2026-09-09): „na jedną paletę drukujemy 2 kartki
 * tego samego i naklejamy 2 na karton". Kopia siedzi w dokumencie, a nie
 * w ustawieniu drukarki — inaczej zależałaby od tego, czy ktoś pamiętał
 * podbić liczbę egzemplarzy w oknie druku.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import { drukuj } from '@/lib/print'
import { formatKgCompact } from './cartonLabelLines'

export { formatKgCompact }

/** Ile kartek wychodzi z drukarki na jedną paletę. */
export const KOPII_NA_PALETE = 2

/** Widełki stopnia pisma treści głównej.
 *
 *  GÓRA. 90pt i ANI PUNKTU WIĘCEJ. Podniesienie sufitu do 160pt dało przy
 *  jednej pozycji litery na pół strony — właściciel (2026-09-09):
 *  „przy jednej czcionka maksymalnie 90, aby to było czytelne; aktualnie
 *  jest za duża i wszystko przytłacza". Kartka ma się czytać, nie krzyczeć.
 *
 *  DÓŁ. Musi być NAPRAWDĘ nisko: najdłuższa realna pozycja
 *  („8 X 30KG 75CM SHORMA TRUVA + AROMAT") potrzebuje ~27pt, a przy dawnym
 *  dnie 30pt treść wyjeżdżała poza stronę i drukowała się na dwóch. */
const MAX_PT = 90
const MIN_PT = 14

export interface CartonLabelProps {
  /** Numer kartonu — mały, prawy górny róg, BEZ dopisku (np. „000005"). */
  cornerNo: string
  clientName: string
  /** Receptura wspólna dla całej kartki — osobna linia pod klientem.
   *  `null`, gdy karton wiezie kilka receptur: wtedy każda stoi przy
   *  swojej pozycji w `mainLines`. */
  recipeHeader?: string | null
  /** Pozycje główne, np. ["20 X 40KG"] albo ["20 X 40KG BEYAZ AFIYET"]. */
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

/** Jedna kartka A4. Renderowana `KOPII_NA_PALETE` razy. */
function Kartka(props: CartonLabelProps & { egzemplarz: number }) {
  const { cornerNo, clientName, recipeHeader, mainLines, totalKg,
          footerLabel, footerValue, qrDataUrl, qrCaption, egzemplarz } = props

  const contentBoxRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [fontSizePt, setFontSizePt] = useState(MAX_PT)
  const [layoutReady, setLayoutReady] = useState(false)

  useLayoutEffect(() => {
    function fitContent() {
      const box = contentBoxRef.current
      const content = contentRef.current
      if (!box || !content) return
      const availableWidth = Math.max(120, box.clientWidth)
      const availableHeight = Math.max(120, box.clientHeight)

      const miesciSie = (pt: number) => {
        content.style.fontSize = `${pt}pt`
        return content.scrollWidth <= availableWidth && content.scrollHeight <= availableHeight
      }

      // Dobijanie POŁOWIENIEM do 0,5pt zamiast schodzenia co 2pt: właściciel
      // prosił o „maksymalnie jak największą czcionkę", a krok co 2pt oddawał
      // najbliższy parzysty stopień w dół — na kartce z dwiema pozycjami to
      // widoczna strata. Kilkanaście pomiarów zamiast trzydziestu.
      let dol = MIN_PT
      let gora = MAX_PT
      let najlepszy = MIN_PT
      if (miesciSie(MAX_PT)) {
        najlepszy = MAX_PT
      } else {
        while (gora - dol > 0.5) {
          const srodek = (dol + gora) / 2
          if (miesciSie(srodek)) { najlepszy = srodek; dol = srodek }
          else gora = srodek
        }
      }
      // Ostatni pomiar w pętli mógł być nieudany — wracamy na wybrany stopień,
      // żeby element został fizycznie ustawiony na tym, co zapisujemy w stanie.
      content.style.fontSize = `${najlepszy}pt`
      setFontSizePt(najlepszy)
      setLayoutReady(true)
    }
    setLayoutReady(false)
    setFontSizePt(MAX_PT)
    const frame = window.requestAnimationFrame(fitContent)
    window.addEventListener('resize', fitContent)
    return () => { window.cancelAnimationFrame(frame); window.removeEventListener('resize', fitContent) }
  }, [clientName, recipeHeader, mainLines.join('|')])

  return (
    <div className="label-page relative overflow-hidden" data-testid="label-page" data-egzemplarz={egzemplarz}>
      {/* Wąskie marginesy boczne: o rozmiarze pisma przy kilku pozycjach
            decyduje SZEROKOŚĆ najdłuższej linii, więc każdy oddany
            milimetr to większa czcionka na całej kartce. */}
        <div className="flex h-full w-full flex-col px-[7mm] py-[10mm]">
        <div className="flex items-start justify-end leading-none" style={{ fontFamily: 'Arial, sans-serif' }}>
          {/* Numer kartonu — mały, prawy górny róg, bez dopisku */}
          <div data-testid="label-corner-no" className="text-[12pt] font-bold tracking-widest text-slate-800">{cornerNo}</div>
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
              // Pozycja z recepturą jest długa; bez tego przeglądarka łamie ją
              // w losowym miejscu i „(BEYAZ AFIYET)" ląduje w osobnej linii,
              // a fit tego nie widzi, bo mierzy wysokość już po złamaniu.
              whiteSpace: 'nowrap',
            }}
          >
            <div>{clientName}</div>
            {recipeHeader && <div>{recipeHeader}</div>}
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
  )
}

/** Style strony — wspólne dla kartki pojedynczej i wydruku wielu palet. */
export const CARTON_LABEL_STYLES = `
  .label-page { width: 297mm; height: 210mm; background: #fff; }
  @media screen { .label-page { margin: 16px auto; box-shadow: 0 1px 4px rgba(0,0,0,.08); } }
  @media print {
    .no-print { display: none !important; }
    html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
    .label-page { margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; }
    .label-page:last-of-type { break-after: auto; page-break-after: auto; }
    @page { size: A4 landscape; margin: 0; }
  }
`

/** Dwie identyczne kartki tej samej palety — para do naklejenia na karton. */
export function CartonLabelPages(props: CartonLabelProps) {
  return (
    <>
      {Array.from({ length: KOPII_NA_PALETE }, (_, i) => (
        <Kartka key={i} {...props} egzemplarz={i + 1} />
      ))}
    </>
  )
}

export function CartonLabel(props: CartonLabelProps) {
  const { backTo, backLabel = 'Wróć', qrDataUrl } = props
  const printedRef = useRef(false)

  useEffect(() => {
    if (!qrDataUrl || printedRef.current) return
    printedRef.current = true
    const t = window.setTimeout(() => void drukuj(), 250)
    return () => window.clearTimeout(t)
  }, [qrDataUrl])

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{CARTON_LABEL_STYLES}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link to={backTo} className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900">
          <ArrowLeft size={14} /> {backLabel}
        </Link>
        <button onClick={() => void drukuj()} className="flex items-center gap-1.5 rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
          <Printer size={14} /> Drukuj etykietę ({KOPII_NA_PALETE} kopie)
        </button>
      </div>

      <CartonLabelPages {...props} />
    </div>
  )
}
