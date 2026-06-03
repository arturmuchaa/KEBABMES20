import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi, labelTemplatesApi, recipesApi } from '@/lib/apiClient'
import type { FinishedUnitCard, LabelTemplate, LabelSlotOffset } from '@/lib/api'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtDate(iso: string): string {
  // Accepts ISO date (YYYY-MM-DD) or datetime; returns DD.MM.YYYY
  const s = iso ? iso.slice(0, 10) : ''
  if (!s || s.length < 10) return iso || ''
  const [y, m, d] = s.split('-')
  return `${d}.${m}.${y}`
}

function addDays(isoDate: string, days: number): string {
  // Parsowanie numeryczne (Date.UTC) zamiast new Date(string) — bezpieczne na
  // iOS/WebKit, który jest restrykcyjny wobec formatów dat i potrafi rzucić.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '')
  if (!m) return ''
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  d.setUTCDate(d.getUTCDate() + (days || 0))
  return d.toISOString().slice(0, 10)
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Returns DDMMYY string from ISO date YYYY-MM-DD */
function ddmmrr(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate || '')
  if (!m) return ''
  const yy = m[1].slice(2) // last 2 digits of year
  return `${m[3]}${m[2]}${yy}`
}

/** Formats weight: drops trailing .0 — integer → "50 kg", decimal → "50.5 kg" */
function formatWeight(weightKg: number | undefined | null): string {
  if (weightKg === undefined || weightKg === null) return ''
  const n = Number(weightKg)
  if (isNaN(n)) return ''
  // parseFloat removes trailing zeros (e.g. 50.00 → "50", 50.5 → "50.5")
  return `${parseFloat(n.toFixed(10))} kg`
}

/** Compute dynamic field values for one unit. */
function unitFieldValues(
  unit: FinishedUnitCard,
  shelfLifeDays: number,
): Record<string, string> {
  const prodDateIso = (unit as any).producedDate || unit.producedAt?.slice(0, 10) || todayIso()
  const bestBeforeIso = addDays(prodDateIso, shelfLifeDays)
  const prefix = ddmmrr(prodDateIso)
  return {
    prod_date: fmtDate(prodDateIso),
    freeze_date: fmtDate(prodDateIso),
    best_before: fmtDate(bestBeforeIso),
    batch_no: unit.batchNo ? `${prefix} ${unit.batchNo}` : prefix,
    weight: formatWeight((unit as any).weightKg),
  }
}

// ─── pdf-lib helpers ──────────────────────────────────────────────────────────

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

const TEXT_KEYS = ['prod_date', 'freeze_date', 'best_before', 'batch_no', 'weight'] as const

// ─── Slot offset helpers ──────────────────────────────────────────────────────

/** Returns the effective X offset for a given slot, in percentage points of page width. */
function slotOffsetX(slot: number, perSheet: number, offsets: LabelSlotOffset[] | undefined): number {
  if (offsets && offsets[slot] !== undefined) return offsets[slot].dx
  return slot * (100 / perSheet)
}

/** Returns the effective Y offset for a given slot, in percentage points of page height. */
function slotOffsetY(slot: number, offsets: LabelSlotOffset[] | undefined): number {
  if (offsets && offsets[slot] !== undefined) return offsets[slot].dy
  return 0
}

async function buildVectorPdf(
  template: LabelTemplate,
  units: FinishedUnitCard[],
  perSheet: number,
  shelfLifeDays: number,
  qrMapRef: Record<string, string>,
): Promise<string> {
  const MM = 2.83465 // mm → pt

  const srcDoc = await PDFDocument.load(dataUrlToBytes(template.backgroundPdf!))
  const out = await PDFDocument.create()
  const font = await out.embedFont(StandardFonts.Helvetica)
  const fontBold = await out.embedFont(StandardFonts.HelveticaBold)
  const fp = template.fieldPositions
  const slotOffsets = template.slotOffsets

  for (let i = 0; i < units.length; i += perSheet) {
    const group = units.slice(i, i + perSheet)
    const [copied] = await out.copyPages(srcDoc, [0])
    out.addPage(copied)
    const pageW = copied.getWidth()
    const pageH = copied.getHeight()

    for (let slot = 0; slot < group.length; slot++) {
      const unit = group[slot]
      const offsetX = slotOffsetX(slot, perSheet, slotOffsets)
      const offsetY = slotOffsetY(slot, slotOffsets)
      const vals = unitFieldValues(unit, shelfLifeDays)

      // Text fields
      for (const key of TEXT_KEYS) {
        const pos = fp[key]
        if (!pos || !vals[key]) continue
        const effectiveX = pos.x + offsetX
        const effectiveY = pos.y + offsetY
        const xPt = (effectiveX / 100) * pageW
        const sizePt = pos.size
        const yTopFrac = (effectiveY / 100) * pageH

        if (key === 'weight') {
          // Split "number kg" → number part bold (if pos.bold), " kg" always regular
          const raw = String(vals[key])
          const spaceIdx = raw.indexOf(' ')
          const numberPart = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : raw
          const unitPart = spaceIdx >= 0 ? raw.slice(spaceIdx) : ''
          const activeFont = pos.bold ? fontBold : font
          copied.drawText(numberPart, {
            x: xPt,
            y: pageH - yTopFrac - sizePt,
            size: sizePt,
            font: activeFont,
            color: rgb(0, 0, 0),
          })
          if (unitPart) {
            const numberWidth = activeFont.widthOfTextAtSize(numberPart, sizePt)
            copied.drawText(unitPart, {
              x: xPt + numberWidth,
              y: pageH - yTopFrac - sizePt,
              size: sizePt,
              font,
              color: rgb(0, 0, 0),
            })
          }
        } else {
          copied.drawText(String(vals[key]), {
            x: xPt,
            y: pageH - yTopFrac - sizePt,
            size: sizePt,
            font: pos.bold ? fontBold : font,
            color: rgb(0, 0, 0),
          })
        }
      }

      // QR code
      const qrPos = fp['qr']
      const qrUrl = qrMapRef[unit.id]
      if (qrPos && qrUrl) {
        const img = await out.embedPng(dataUrlToBytes(qrUrl))
        const sPt = qrPos.size * MM
        const xPt = ((qrPos.x + offsetX) / 100) * pageW
        const yTopFrac = ((qrPos.y + offsetY) / 100) * pageH
        copied.drawImage(img, {
          x: xPt,
          y: pageH - yTopFrac - sPt,
          width: sPt,
          height: sPt,
        })
      }
    }
  }

  const bytes = await out.save()
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  return URL.createObjectURL(blob)
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LabelPrintPage() {
  const [params] = useSearchParams()
  const planLineId = params.get('planLineId') || ''
  const clientId   = params.get('clientId')   || ''
  const recipeId   = params.get('recipeId')   || ''

  const unitsRes    = useApi(() => finishedUnitsApi.listByPlanLine(planLineId), [planLineId])
  const templateRes = useApi(() => labelTemplatesApi.get(clientId, recipeId),  [clientId, recipeId])
  const recipeRes   = useApi(() => recipesApi.byId(recipeId),                  [recipeId])

  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [pdfUrl, setPdfUrl] = useState('')
  const printedRef = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pdfBuiltRef = useRef(false)

  const units    = unitsRes.data ?? []
  const tplResp  = templateRes.data
  const template = tplResp?.template ?? null
  const recipe   = recipeRes.data
  const shelfLifeDays = recipe?.shelfLifeDays ?? 5

  // Generate QR data URLs for all units
  useEffect(() => {
    if (units.length === 0) return
    let cancelled = false
    const map: Record<string, string> = {}

    Promise.all(
      units.map(async (u) => {
        try {
          const url = await QRCode.toDataURL(u.qrCode, { width: 240, margin: 0 })
          map[u.id] = url
        } catch {
          map[u.id] = ''
        }
      }),
    ).then(() => {
      if (!cancelled) setQrMap(map)
    })

    return () => { cancelled = true }
  }, [units])

  // Auto-print once all data + QR codes are ready
  const allQrReady = units.length > 0 && units.every((u) => qrMap[u.id] !== undefined)
  const dataReady  = allQrReady && template !== null && recipe !== null

  // Build vector PDF when template has backgroundPdf and all QR codes are ready
  useEffect(() => {
    if (!dataReady || !template?.backgroundPdf || pdfBuiltRef.current) return
    if (Object.keys(qrMap).length === 0) return
    pdfBuiltRef.current = true
    let objectUrl = ''
    buildVectorPdf(template, units, template.labelsPerSheet || 2, shelfLifeDays, qrMap)
      .then((url) => {
        objectUrl = url
        setPdfUrl(url)
      })
      .catch((err) => {
        console.error('buildVectorPdf failed:', err)
      })
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dataReady, template?.backgroundPdf, qrMap])

  // Auto-print for raster (image background) mode only
  useEffect(() => {
    if (!dataReady || template?.backgroundPdf || printedRef.current) return
    printedRef.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [dataReady, template?.backgroundPdf])

  // ── Loading states ──
  const anyLoading = unitsRes.loading || templateRes.loading || recipeRes.loading
  if (anyLoading) {
    return (
      <div className="p-10 text-center text-muted-foreground">
        Ładowanie danych do druku etykiet…
      </div>
    )
  }

  // ── Error states ──
  // Pokazujemy KTÓRE źródło zawiodło — diagnostyka (np. iOS/WebKit).
  const errParts: string[] = []
  if (unitsRes.error)    errParts.push(`sztuki: ${unitsRes.error}`)
  if (templateRes.error) errParts.push(`szablon: ${templateRes.error}`)
  if (recipeRes.error)   errParts.push(`receptura: ${recipeRes.error}`)
  if (errParts.length > 0) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Błąd ładowania danych</div>
          <ul className="text-sm text-slate-700 list-disc pl-5">
            {errParts.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      </div>
    )
  }

  // ── No template ──
  if (tplResp && !tplResp.exists) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-amber-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-amber-700">Brak szablonu etykiety</div>
          <div className="mb-4 text-sm text-slate-700">
            Brak szablonu etykiety dla tego klienta+receptury — skonfiguruj go najpierw.
          </div>
          <Link
            to={`/etykiety/szablon?clientId=${encodeURIComponent(clientId)}&recipeId=${encodeURIComponent(recipeId)}`}
            className="inline-flex items-center gap-1.5 rounded bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-700"
          >
            Konfiguruj szablon etykiety
          </Link>
        </div>
      </div>
    )
  }

  if (!template) {
    return (
      <div className="p-10 text-center text-muted-foreground">Brak danych szablonu.</div>
    )
  }

  if (units.length === 0) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-slate-900">Brak sztuk do druku</div>
          <div className="text-sm text-slate-700">
            Linia planu nie ma żadnych zarejestrowanych sztuk.
          </div>
        </div>
      </div>
    )
  }

  // ── Build pages ──
  const perSheet = template.labelsPerSheet || 2
  const pages: FinishedUnitCard[][] = []
  for (let i = 0; i < units.length; i += perSheet) {
    pages.push(units.slice(i, i + perSheet))
  }

  const fp = template.fieldPositions

  // ── Vector PDF render branch (pdf-lib) ──
  if (template.backgroundPdf) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
          <Link
            to="/office/planowanie-produkcji"
            className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft size={14} /> Wróć
          </Link>
          <div className="text-sm text-slate-600">
            {units.length} etykiet · {pages.length} stron · {perSheet}/A4
            {pdfUrl && <span className="ml-2 text-green-700 font-semibold">✓ PDF wektorowy</span>}
          </div>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <a
                href={pdfUrl}
                download="etykiety.pdf"
                className="flex items-center gap-1.5 rounded bg-slate-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700"
              >
                <Download size={14} /> Pobierz PDF
              </a>
            )}
            <button
              disabled={!pdfUrl}
              onClick={() => iframeRef.current?.contentWindow?.print()}
              className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Printer size={14} /> Drukuj
            </button>
          </div>
        </div>

        {/* PDF viewer */}
        <div className="flex-1 flex items-stretch">
          {!pdfUrl ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-20">
              Generuję PDF wektorowy…
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={pdfUrl}
              title="Podgląd etykiet PDF"
              style={{ width: '100%', height: '90vh', border: 0 }}
            />
          )}
        </div>
      </div>
    )
  }

  // ── Raster (image background) render branch — fallback ──
  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`
        .label-sheet {
          position: relative;
          width: 210mm;
          height: 297mm;
          overflow: hidden;
          background: #fff;
          box-sizing: border-box;
        }
        .label-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: fill;
        }
        .label-field {
          position: absolute;
          line-height: 1.1;
          white-space: nowrap;
        }
        @media screen {
          .label-sheet {
            margin: 16px auto;
            box-shadow: 0 1px 4px rgba(0,0,0,.1);
          }
        }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .label-sheet { margin: 0 !important; box-shadow: none !important; break-after: page; }
          .label-sheet:last-child { break-after: auto; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link
          to="/office/planowanie-produkcji"
          className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft size={14} /> Wróć
        </Link>
        <div className="text-sm text-slate-600">
          {units.length} etykiet · {pages.length} stron · {perSheet}/A4
        </div>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Printer size={14} /> Drukuj
        </button>
      </div>

      {pages.map((pageUnits, pageIdx) => (
        <div key={pageIdx} className="label-sheet">
          {/* ONE background fills the full A4 sheet — the artwork is the whole page */}
          {template.backgroundData && (
            <img className="label-bg" src={template.backgroundData} alt="" />
          )}

          {/* For each unit on this sheet, overlay its fields at the correct slot offset */}
          {pageUnits.map((unit, slot) => {
            const offsetX = slotOffsetX(slot, perSheet, template.slotOffsets)
            const offsetY = slotOffsetY(slot, template.slotOffsets)
            const values = unitFieldValues(unit, shelfLifeDays)
            const qrDataUrl = qrMap[unit.id] ?? ''

            return (
              <div key={unit.id}>
                {/* QR code */}
                {fp.qr && qrDataUrl && (
                  <img
                    className="label-field"
                    src={qrDataUrl}
                    alt={`QR ${unit.qrCode}`}
                    style={{
                      left: `${fp.qr.x + offsetX}%`,
                      top: `${fp.qr.y + offsetY}%`,
                      width: `${fp.qr.size}mm`,
                      height: `${fp.qr.size}mm`,
                      imageRendering: 'pixelated',
                    }}
                  />
                )}

                {/* Text fields: prod_date, freeze_date, best_before, batch_no, weight */}
                {(['prod_date', 'freeze_date', 'best_before', 'batch_no', 'weight'] as const).map((key) => {
                  const pos = fp[key]
                  if (!pos) return null
                  const effectiveLeft = pos.x + offsetX
                  const effectiveTop = pos.y + offsetY
                  const sharedStyle = {
                    left: `${effectiveLeft}%`,
                    top: `${effectiveTop}%`,
                    fontSize: `${pos.size}pt`,
                    fontFamily: pos.fontFamily || 'Arial',
                  }
                  if (key === 'weight') {
                    // Number part: bold if pos.bold; " kg" always regular weight 400
                    const raw = values[key] ?? ''
                    const spaceIdx = raw.indexOf(' ')
                    const numberPart = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : raw
                    const unitPart = spaceIdx >= 0 ? raw.slice(spaceIdx) : ''
                    return (
                      <span key={key} className="label-field" style={sharedStyle}>
                        <span style={{ fontWeight: pos.bold ? 700 : 400 }}>{numberPart}</span>
                        {unitPart && <span style={{ fontWeight: 400 }}>{unitPart}</span>}
                      </span>
                    )
                  }
                  return (
                    <span
                      key={key}
                      className="label-field"
                      style={{
                        ...sharedStyle,
                        fontWeight: pos.bold ? 700 : 400,
                      }}
                    >
                      {values[key]}
                    </span>
                  )
                })}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}
