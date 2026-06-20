import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { filterUnitsByIds } from '@/lib/unitReprint'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import arialRegularUrl from '@/assets/fonts/LiberationSans-Regular.ttf?url'
import arialBoldUrl from '@/assets/fonts/LiberationSans-Bold.ttf?url'
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi, labelTemplatesApi, recipesApi, clientsApi } from '@/lib/apiClient'
import type { FinishedUnitCard, LabelTemplate, LabelSlotOffset, LabelFieldPos } from '@/lib/api'

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
  orgCode = '',
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
    // Kod nadzoru HALAL — stały dla całej partii, wpisywany przy druku (klient pod nadzorem).
    org_code: orgCode || '',
  }
}

// ─── pdf-lib helpers ──────────────────────────────────────────────────────────

/**
 * Wykrywa prostokąt rzeczywistej treści (nie-białej) na obrazie tła — do „Dopasuj do A4",
 * gdy etykieta ma białe marginesy WtopioNE w grafikę (PDF jest A4, ale projekt mały na środku).
 * Zwraca ułamki [0..1] (x0,y0 od lewego-górnego) albo null.
 */
async function contentBBox(dataUrl: string): Promise<{ x0: number; y0: number; x1: number; y1: number } | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const w = img.naturalWidth, h = img.naturalHeight
      if (!w || !h) { resolve(null); return }
      const maxDim = 1000
      const sc = Math.min(1, maxDim / Math.max(w, h))
      const cw = Math.max(1, Math.round(w * sc)), ch = Math.max(1, Math.round(h * sc))
      const cv = document.createElement('canvas')
      cv.width = cw; cv.height = ch
      const ctx = cv.getContext('2d', { willReadFrequently: true })
      if (!ctx) { resolve(null); return }
      ctx.drawImage(img, 0, 0, cw, ch)
      let data: Uint8ClampedArray
      try { data = ctx.getImageData(0, 0, cw, ch).data } catch { resolve(null); return }
      let minX = cw, minY = ch, maxX = -1, maxY = -1
      const TH = 244 // próg bieli (RGB ≥ TH = tło)
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          const i = (y * cw + x) * 4
          const a = data[i + 3]
          const isBg = a < 10 || (data[i] >= TH && data[i + 1] >= TH && data[i + 2] >= TH)
          if (!isBg) {
            if (x < minX) minX = x; if (x > maxX) maxX = x
            if (y < minY) minY = y; if (y > maxY) maxY = y
          }
        }
      }
      if (maxX < 0) { resolve(null); return }
      resolve({ x0: minX / cw, y0: minY / ch, x1: (maxX + 1) / cw, y1: (maxY + 1) / ch })
    }
    img.onerror = () => resolve(null)
    img.src = dataUrl
  })
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return arr
}

const TEXT_KEYS = ['prod_date', 'freeze_date', 'best_before', 'batch_no', 'weight', 'org_code'] as const

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

/**
 * Resolves the effective position of a field on a given slot.
 * Jeśli istnieje ręczne nadpisanie (slotFieldPositions[slot][key]) → pozycja BEZWZGLĘDNA
 * (bez globalnego slotOffset) — do nierównych etykiet. Inaczej: pozycja bazowa + slotOffset.
 */
function resolveFieldPos(
  base: LabelFieldPos | undefined,
  slotFieldPositions: Record<string, Record<string, LabelFieldPos>> | undefined,
  slot: number,
  key: string,
  offsetX: number,
  offsetY: number,
): LabelFieldPos | null {
  const override = slotFieldPositions?.[String(slot)]?.[key]
  if (override) return override
  if (!base) return null
  return { ...base, x: base.x + offsetX, y: base.y + offsetY }
}

async function buildVectorPdf(
  template: LabelTemplate,
  units: FinishedUnitCard[],
  perSheet: number,
  shelfLifeDays: number,
  qrMapRef: Record<string, string>,
  orgCode = '',
): Promise<string> {
  const MM = 2.83465 // mm → pt

  const srcDoc = await PDFDocument.load(dataUrlToBytes(template.backgroundPdf!))
  const out = await PDFDocument.create()
  out.registerFontkit(fontkit)
  const [regBytes, boldBytes] = await Promise.all([
    fetch(arialRegularUrl).then(r => r.arrayBuffer()),
    fetch(arialBoldUrl).then(r => r.arrayBuffer()),
  ])
  const font = await out.embedFont(regBytes, { subset: true })
  const fontBold = await out.embedFont(boldBytes, { subset: true })
  const fp = template.fieldPositions
  const slotOffsets = template.slotOffsets
  const slotFP = template.slotFieldPositions

  // ── Kalibracja druku — kompensacja ucinanego paska (przesunięcie X/Y w mm + skala %).
  // Stosujemy jako jedno przekształcenie afiniczne na CAŁEJ stronie (tło + nadrukowane pola
  // razem), więc nic się nie rozjeżdża. dxMm + = w prawo, dyMm + = w dół, scale w %.
  const calib = template.printCalib || {}
  const scale = (calib.scale ?? 100) / 100
  const dxPt = (calib.dxMm ?? 0) * MM
  const dyPt = (calib.dyMm ?? 0) * MM
  // „Dopasuj tło do A4" — wypełnia arkusz: (1) rozciąga źródłowy PDF do A4, oraz
  // (2) gdy treść ma białe marginesy WtopioNE w grafikę, przybliża do samej treści
  // (crop), skalując tło I pola razem, więc nic się nie rozjeżdża.
  const fit = !!calib.fit
  const A4W = 595.276   // 210 mm w pt
  const A4H = 841.89    // 297 mm w pt

  const srcPage = srcDoc.getPage(0)
  const srcW = srcPage.getWidth()
  const srcH = srcPage.getHeight()
  const embedded = await out.embedPage(srcPage)
  // Wymiar strony wyjściowej + układ współrzędnych pól: A4 gdy „fit", inaczej rozmiar źródła.
  const pageW = fit ? A4W : srcW
  const pageH = fit ? A4H : srcH
  const srcToPageX = pageW / srcW   // rozciągnięcie źródła do strony (object-fit: fill przy fit)
  const srcToPageY = pageH / srcH

  // Crop do treści — tylko gdy fit, mamy obraz tła i są realne marginesy do usunięcia.
  let crop: { x0: number; y0: number; x1: number; y1: number } | null = null
  if (fit && template.backgroundData) {
    const bb = await contentBBox(template.backgroundData)
    if (bb && (bb.x1 - bb.x0) > 0.05 && (bb.y1 - bb.y0) > 0.05 &&
        ((bb.x1 - bb.x0) < 0.97 || (bb.y1 - bb.y0) < 0.97)) {
      crop = bb
    }
  }

  // Wspólne przekształcenie afiniczne f(px,py)=(Tx+S·px, Ty+S·py) dla tła i pól
  // (px,py = punkt w pt w układzie strony, origin lewy-dolny).
  let S: number, Tx: number, Ty: number
  if (crop) {
    // box treści w pt (origin lewy-dolny); y obrazu liczony od góry → odwracamy
    const bx0 = crop.x0 * pageW, bx1 = crop.x1 * pageW
    const yblLow = pageH * (1 - crop.y1), yblHigh = pageH * (1 - crop.y0)
    const cx = (bx0 + bx1) / 2, cy = (yblLow + yblHigh) / 2
    // skala „contain" — powiększ box treści aż wypełni krótszą oś (nie obcina treści)
    const cropScale = Math.min(pageW / (bx1 - bx0), pageH / (yblHigh - yblLow))
    S = cropScale * scale
    Tx = (pageW / 2 + dxPt) - S * cx
    Ty = (pageH / 2 - dyPt) - S * cy
  } else {
    // bez cropu: górna krawędź u góry, dyPt dosuwa w dół (jak dotąd)
    S = scale
    Tx = dxPt
    Ty = pageH * (1 - scale) - dyPt
  }
  const tx = (px: number) => Tx + px * S
  const ty = (py: number) => Ty + py * S
  const ts = (s: number) => s * S

  for (let i = 0; i < units.length; i += perSheet) {
    const group = units.slice(i, i + perSheet)
    const page = out.addPage([pageW, pageH])
    page.drawPage(embedded, { x: Tx, y: Ty, xScale: S * srcToPageX, yScale: S * srcToPageY })

    for (let slot = 0; slot < group.length; slot++) {
      const unit = group[slot]
      const offsetX = slotOffsetX(slot, perSheet, slotOffsets)
      const offsetY = slotOffsetY(slot, slotOffsets)
      const vals = unitFieldValues(unit, shelfLifeDays, orgCode)

      // Text fields
      for (const key of TEXT_KEYS) {
        const pos = resolveFieldPos(fp[key], slotFP, slot, key, offsetX, offsetY)
        if (!pos || !vals[key]) continue
        const xPt = tx((pos.x / 100) * pageW)
        const sizePt = ts(pos.size)
        const yTopFrac = (pos.y / 100) * pageH
        const yPt = ty(pageH - yTopFrac - pos.size)

        if (key === 'weight') {
          // Split "number kg" → number part bold (if pos.bold), " kg" always regular
          const raw = String(vals[key])
          const spaceIdx = raw.indexOf(' ')
          const numberPart = spaceIdx >= 0 ? raw.slice(0, spaceIdx) : raw
          const unitPart = spaceIdx >= 0 ? raw.slice(spaceIdx) : ''
          const activeFont = pos.bold ? fontBold : font
          page.drawText(numberPart, {
            x: xPt,
            y: yPt,
            size: sizePt,
            font: activeFont,
            color: rgb(0, 0, 0),
          })
          if (unitPart) {
            const numberWidth = activeFont.widthOfTextAtSize(numberPart, sizePt)
            page.drawText(unitPart, {
              x: xPt + numberWidth,
              y: yPt,
              size: sizePt,
              font,
              color: rgb(0, 0, 0),
            })
          }
        } else {
          page.drawText(String(vals[key]), {
            x: xPt,
            y: yPt,
            size: sizePt,
            font: pos.bold ? fontBold : font,
            color: rgb(0, 0, 0),
          })
        }
      }

      // QR code
      const qrPos = resolveFieldPos(fp['qr'], slotFP, slot, 'qr', offsetX, offsetY)
      const qrUrl = qrMapRef[unit.id]
      if (qrPos && qrUrl) {
        const img = await out.embedPng(dataUrlToBytes(qrUrl))
        const qrSizePt = qrPos.size * MM
        const xPt = tx((qrPos.x / 100) * pageW)
        const yTopFrac = (qrPos.y / 100) * pageH
        const yPt = ty(pageH - yTopFrac - qrSizePt)
        page.drawImage(img, {
          x: xPt,
          y: yPt,
          width: ts(qrSizePt),
          height: ts(qrSizePt),
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
  // Dodruk pojedynczej/wybranych sztuk: ?unitIds=id1,id2 → drukuj tylko te.
  const unitIdsFilter = (params.get('unitIds') || '').split(',').map(s => s.trim()).filter(Boolean)

  const unitsRes    = useApi(() => finishedUnitsApi.listByPlanLine(planLineId), [planLineId])
  const templateRes = useApi(() => labelTemplatesApi.get(clientId, recipeId),  [clientId, recipeId])
  const recipeRes   = useApi(() => recipesApi.byId(recipeId),                  [recipeId])
  const clientsRes  = useApi(() => clientsApi.list(), [])

  // Plan przekazuje clientId jako NAZWĘ (czasem wyświetlaną), nie id — dopasuj po
  // id ORAZ name/displayName, inaczej pole „Kod nadzoru" nigdy się nie pokaże.
  const halal = !!(clientsRes.data ?? []).find(
    (c: any) => c.id === clientId || c.name === clientId || c.displayName === clientId,
  )?.halalSupervision
  const [orgCode, setOrgCode] = useState('')
  // Prefill kodu nadzoru z pamięci per klient (poprzedni druk) — edytowalny co partię.
  useEffect(() => {
    if (clientId) setOrgCode(localStorage.getItem(`orgcode:${clientId}`) || '')
  }, [clientId])
  function changeOrgCode(v: string) {
    setOrgCode(v)
    if (clientId) localStorage.setItem(`orgcode:${clientId}`, v)
  }

  const [qrMap, setQrMap] = useState<Record<string, string>>({})
  const [pdfUrl, setPdfUrl] = useState('')
  const printedRef = useRef(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const units    = filterUnitsByIds(unitsRes.data ?? [], unitIdsFilter)
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
          const url = await QRCode.toDataURL(u.qrCode, {
            width: 1000,               // wysoka rozdzielczość → ostre krawędzie modułów w druku (~1000px na ~25mm = ~1000dpi)
            margin: 4,                 // quiet zone — wymagane 4 moduły białego marginesu
            errorCorrectionLevel: 'H', // 30% korekcji: odporność na szron/stretch/refleksy w szokówce i mroźni
          })
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
    if (!dataReady || !template?.backgroundPdf) return
    if (Object.keys(qrMap).length === 0) return
    let objectUrl = ''
    buildVectorPdf(template, units, template.labelsPerSheet || 2, shelfLifeDays, qrMap, orgCode)
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
  }, [dataReady, template?.backgroundPdf, qrMap, orgCode])

  // Auto-print for raster (image background) mode only
  useEffect(() => {
    if (!dataReady || template?.backgroundPdf || printedRef.current) return
    if (clientsRes.loading) return            // poczekaj aż wiemy czy klient ma nadzór
    if (halal && !orgCode) return             // nadzór HALAL → najpierw wpisz kod nadzoru
    printedRef.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [dataReady, template?.backgroundPdf, clientsRes.loading, halal, orgCode])

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

  // Kalibracja druku (kompensacja ucinanego paska) — wspólna dla obu gałęzi.
  const calib = template.printCalib || {}
  const calibTransform = `translate(${calib.dxMm ?? 0}mm, ${calib.dyMm ?? 0}mm) scale(${(calib.scale ?? 100) / 100})`

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
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span>{units.length} etykiet · {pages.length} stron · {perSheet}/A4</span>
            {halal && (
              <label className="flex items-center gap-1.5 font-semibold text-slate-700">
                Kod nadzoru:
                <input value={orgCode} onChange={e => changeOrgCode(e.target.value)} placeholder="np. 7J8EX"
                  className="w-24 rounded border border-slate-300 px-2 py-0.5 font-mono uppercase" />
              </label>
            )}
            {pdfUrl && <span className="text-green-700 font-semibold">✓ PDF wektorowy</span>}
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
        /* Pełna wierność druku — nie pozwól przeglądarce przyciemniać/pomijać tła i obrazów */
        html, body, .label-sheet, .label-bg, .label-field {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .label-sheet {
          position: relative;
          width: 210mm;
          height: 297mm;
          overflow: hidden;
          background: #fff;
          box-sizing: border-box;
        }
        .label-calib {
          position: absolute;
          inset: 0;
          transform-origin: top left;
        }
        .label-bg {
          position: absolute;
          inset: 0;
          width: 100%;
          height: 100%;
          object-fit: fill;
          image-rendering: auto;
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
        <div className="flex items-center gap-3 text-sm text-slate-600">
          <span>{units.length} etykiet · {pages.length} stron · {perSheet}/A4</span>
          {halal && (
            <label className="flex items-center gap-1.5 font-semibold text-slate-700">
              Kod nadzoru:
              <input value={orgCode} onChange={e => changeOrgCode(e.target.value)} placeholder="np. 7J8EX"
                className="w-24 rounded border border-slate-300 px-2 py-0.5 font-mono uppercase" />
            </label>
          )}
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
         {/* Kalibracja druku: tło + pola przesuwane/skalowane razem */}
         <div className="label-calib" style={{ transform: calibTransform }}>
          {/* ONE background fills the full A4 sheet — the artwork is the whole page */}
          {template.backgroundData && (
            <img className="label-bg" src={template.backgroundData} alt="" />
          )}

          {/* For each unit on this sheet, overlay its fields at the correct slot offset */}
          {pageUnits.map((unit, slot) => {
            const offsetX = slotOffsetX(slot, perSheet, template.slotOffsets)
            const offsetY = slotOffsetY(slot, template.slotOffsets)
            const values = unitFieldValues(unit, shelfLifeDays, orgCode)
            const qrDataUrl = qrMap[unit.id] ?? ''

            const qrPos = resolveFieldPos(fp.qr, template.slotFieldPositions, slot, 'qr', offsetX, offsetY)
            return (
              <div key={unit.id}>
                {/* QR code */}
                {qrPos && qrDataUrl && (
                  <img
                    className="label-field"
                    src={qrDataUrl}
                    alt={`QR ${unit.qrCode}`}
                    style={{
                      left: `${qrPos.x}%`,
                      top: `${qrPos.y}%`,
                      width: `${qrPos.size}mm`,
                      height: `${qrPos.size}mm`,
                      imageRendering: 'pixelated',
                    }}
                  />
                )}

                {/* Text fields: prod_date, freeze_date, best_before, batch_no, weight */}
                {(['prod_date', 'freeze_date', 'best_before', 'batch_no', 'weight', 'org_code'] as const).map((key) => {
                  const pos = resolveFieldPos(fp[key], template.slotFieldPositions, slot, key, offsetX, offsetY)
                  if (!pos) return null
                  if (key === 'org_code' && !values[key]) return null
                  const sharedStyle = {
                    left: `${pos.x}%`,
                    top: `${pos.y}%`,
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
        </div>
      ))}
    </div>
  )
}
