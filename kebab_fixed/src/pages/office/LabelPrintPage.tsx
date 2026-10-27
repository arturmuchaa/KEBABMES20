import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import QRCode from 'qrcode'
// pdf-lib + fontkit ładowane NA ŻĄDANIE (patrz buildVectorPdf) — razem ~500 kB
// po gzipie, a potrzebne wyłącznie przy składaniu etykiety wektorowej.
// W paczce wejściowej były największą pozycją i na słabym łączu biura
// przesądzały o tym, czy MES się w ogóle wczyta.
import arialRegularUrl from '@/assets/fonts/LiberationSans-Regular.ttf?url'
import arialBoldUrl from '@/assets/fonts/LiberationSans-Bold.ttf?url'
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi, labelTemplatesApi, recipesApi, clientsApi } from '@/lib/apiClient'
import type { A4Placement, LabelRenderUnit, LabelTemplate, LabelSlotOffset, LabelFieldPos } from '@/lib/api'
import { drukuj } from '@/lib/print'
import { UNIT_QR_OPTIONS } from '@/features/labels/unitQr'
import { groupA4Units } from '@/features/labels/a4Layout'
import { useA4PrintJob } from '@/features/labels/useA4PrintJob'
import { labelJobStateLabel } from '@/features/labels/printJobWorkflow'

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
  unit: LabelRenderUnit,
  shelfLifeDays: number,
  orgCode = '',
): Record<string, string> {
  const prodDateIso = unit.producedDate || unit.producedAt?.slice(0, 10) || todayIso()
  const bestBeforeIso = addDays(prodDateIso, shelfLifeDays)
  const prefix = ddmmrr(prodDateIso)
  return {
    prod_date: fmtDate(prodDateIso),
    freeze_date: fmtDate(prodDateIso),
    best_before: fmtDate(bestBeforeIso),
    batch_no: unit.batchNo ? `${prefix} ${unit.batchNo}` : prefix,
    weight: formatWeight(unit.weightKg),
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

export async function buildVectorPdf(
  template: LabelTemplate,
  units: LabelRenderUnit[],
  perSheet: number,
  shelfLifeDays: number,
  qrMapRef: Record<string, string>,
  orgCode = '',
  placements?: A4Placement[],
  signal?: AbortSignal,
): Promise<string> {
  const MM = 72 / 25.4 // mm → pt
  const checkActive = () => { if (signal?.aborted) throw new Error('Przerwano generowanie PDF') }
  checkActive()

  const { PDFDocument, StandardFonts, rgb } = await import('pdf-lib')
  const { default: fontkit } = await import('@pdf-lib/fontkit')
  checkActive()

  const srcDoc = await PDFDocument.load(dataUrlToBytes(template.backgroundPdf!))
  const out = await PDFDocument.create()
  out.registerFontkit(fontkit)
  const [regBytes, boldBytes] = await Promise.all([
    fetch(arialRegularUrl, { signal }).then(r => r.arrayBuffer()),
    fetch(arialBoldUrl, { signal }).then(r => r.arrayBuffer()),
  ])
  const font = await out.embedFont(regBytes, { subset: true })
  const fontBold = await out.embedFont(boldBytes, { subset: true })
  const times = await out.embedFont(StandardFonts.TimesRoman)
  const timesBold = await out.embedFont(StandardFonts.TimesRomanBold)
  const courier = await out.embedFont(StandardFonts.Courier)
  const courierBold = await out.embedFont(StandardFonts.CourierBold)
  function fieldFont(pos: LabelFieldPos, bold = !!pos.bold) {
    if (pos.fontFamily === 'Times New Roman') return bold ? timesBold : times
    if (pos.fontFamily === 'Courier New') return bold ? courierBold : courier
    return bold ? fontBold : font
  }
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
  // Opcjonalne przycięcie białych marginesów. Format wyjściowy jest ZAWSZE A4,
  // tak jak układ współrzędnych edytora — niezależnie od tej opcji.
  const fit = !!calib.fit
  const fitStretch = !!calib.fitStretch
  const A4W = 210 * MM
  const A4H = 297 * MM

  const srcPage = srcDoc.getPage(0)
  const srcW = srcPage.getWidth()
  const srcH = srcPage.getHeight()
  const embedded = await out.embedPage(srcPage)
  // Najpierw normalizuj samo TŁO do A4, dopiero potem nakładaj pola w mm/pt.
  // Truva: PDF 259 × 367 mm + QR 35 mm zmniejszał się w sterowniku do ~28 mm.
  // Rozmiar źródła nie może określać rozmiaru gotowego arkusza ani nadruku.
  const pageW = A4W
  const pageH = A4H
  const srcToPageX = pageW / srcW   // identycznie jak object-fit: fill w edytorze
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

  // Przekształcenie afiniczne (osobno X/Y): f(px,py)=(Tx+px·Sx, Ty+py·Sy) dla tła i pól.
  // Sx≠Sy tylko w trybie „rozciągnij na całą wysokość" (usuwa pasek u dołu).
  let Sx: number, Sy: number, Tx: number, Ty: number
  if (crop) {
    const bx0 = crop.x0 * pageW, bx1 = crop.x1 * pageW
    const yblLow = pageH * (1 - crop.y1), yblHigh = pageH * (1 - crop.y0)
    const fillX = pageW / (bx1 - bx0)
    const fillY = pageH / (yblHigh - yblLow)
    if (fitStretch) {
      // Wypełnij CAŁY arkusz: box treści → pełne A4 (lekkie rozciągnięcie pionowe/poziome).
      Sx = fillX * scale
      Sy = fillY * scale
      Tx = -Sx * bx0 + dxPt
      Ty = -Sy * yblLow - dyPt
    } else {
      // „contain" — powiększ proporcjonalnie aż treść wypełni krótszą oś (bez obcinania, bez deformacji).
      const s = Math.min(fillX, fillY) * scale
      const cx = (bx0 + bx1) / 2, cy = (yblLow + yblHigh) / 2
      Sx = Sy = s
      Tx = (pageW / 2 + dxPt) - s * cx
      Ty = (pageH / 2 - dyPt) - s * cy
    }
  } else {
    // bez cropu: skaluj względem ŚRODKA strony, żeby szablon był zawsze wyśrodkowany
    // (a nie dosunięty do rogu przy skali ≠ 100%). dxPt/dyPt dosuwa już wyśrodkowaną treść.
    Sx = Sy = scale
    Tx = (pageW / 2 + dxPt) - Sx * (pageW / 2)
    Ty = (pageH / 2 - dyPt) - Sy * (pageH / 2)
  }
  const tx = (px: number) => Tx + px * Sx
  const ty = (py: number) => Ty + py * Sy
  const ts = (s: number) => s * Sy                  // rozmiar tekstu skaluje się z wysokością
  const tsSquare = (s: number) => s * Math.min(Sx, Sy)  // QR zawsze kwadratowy (czytelność skanu)

  for (const group of groupA4Units(units, perSheet, placements)) {
    checkActive()
    const page = out.addPage([pageW, pageH])
    page.drawPage(embedded, { x: Tx, y: Ty, xScale: Sx * srcToPageX, yScale: Sy * srcToPageY })

    for (const { unit, slot } of group) {
      checkActive()
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
          const activeFont = fieldFont(pos)
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
              font: fieldFont(pos, false),
              color: rgb(0, 0, 0),
            })
          }
        } else {
          page.drawText(String(vals[key]), {
            x: xPt,
            y: yPt,
            size: sizePt,
            font: fieldFont(pos),
            color: rgb(0, 0, 0),
          })
        }
      }

      // QR code
      const qrPos = resolveFieldPos(fp['qr'], slotFP, slot, 'qr', offsetX, offsetY)
      const qrUrl = qrMapRef[unit.id]
      if (qrPos && qrUrl) {
        const img = await out.embedPng(dataUrlToBytes(qrUrl))
        const qpt = tsSquare(qrPos.size * MM)   // QR kwadratowy nawet przy rozciąganiu
        const xPt = tx((qrPos.x / 100) * pageW)
        const yTopEdge = ty(pageH - (qrPos.y / 100) * pageH)  // górna krawędź QR (układ lewy-dolny)
        page.drawImage(img, {
          x: xPt,
          y: yTopEdge - qpt,
          width: qpt,
          height: qpt,
        })
      }
    }
  }

  const bytes = await out.save()
  checkActive()
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' })
  return URL.createObjectURL(blob)
}

// ─── Main component ───────────────────────────────────────────────────────────

export function LabelPrintPage() {
  const [params] = useSearchParams()
  const workflow = useA4PrintJob()
  const frozen = workflow.snapshot?.a4
  const planLineId = params.get('planLineId') || ''
  const clientId   = params.get('clientId')   || ''
  const recipeId   = params.get('recipeId')   || ''
  // Dodruk pojedynczej/wybranych sztuk: ?unitIds=id1,id2 → drukuj tylko te.
  const unitIdsParam = params.get('unitIds')

  const live = !workflow.skipLive && !frozen
  const unitsRes    = useApi(() => live ? finishedUnitsApi.listByPlanLine(planLineId) : Promise.resolve([]), [planLineId, live])
  const templateRes = useApi(() => live ? labelTemplatesApi.get(clientId, recipeId) : Promise.resolve(null), [clientId, recipeId, live])
  const recipeRes   = useApi(() => live ? recipesApi.byId(recipeId) : Promise.resolve(null), [recipeId, live])
  const clientsRes  = useApi(() => live ? clientsApi.list() : Promise.resolve([]), [live])

  // Plan przekazuje clientId jako NAZWĘ (czasem wyświetlaną), nie id — dopasuj po
  // id ORAZ name/displayName, inaczej pole „Kod nadzoru" nigdy się nie pokaże.
  const halal = frozen?.halal ?? !!(clientsRes.data ?? []).find(
    (c: any) => c.id === clientId || c.name === clientId || c.displayName === clientId,
  )?.halalSupervision
  const [currentOrgCode, setOrgCode] = useState('')
  const orgCode = frozen?.orgCode ?? currentOrgCode
  // Prefill kodu nadzoru z pamięci per klient (poprzedni druk) — edytowalny co partię.
  useEffect(() => {
    try { if (clientId) setOrgCode(localStorage.getItem(`orgcode:${clientId}`) || '') } catch { /* private mode */ }
  }, [clientId])
  function changeOrgCode(v: string) {
    setOrgCode(v)
    try { if (clientId) localStorage.setItem(`orgcode:${clientId}`, v) } catch { /* private mode */ }
  }

  const [qrState, setQrState] = useState<{ key: symbol | null; map: Record<string, string> }>({ key: null, map: {} })
  const [qrFailure, setQrFailure] = useState<{ key: symbol | null; error: string }>({ key: null, error: '' })
  const [pdfState, setPdfState] = useState<{ key: symbol | null; url: string }>({ key: null, url: '' })
  const [pdfLoaded, setPdfLoaded] = useState('')
  const [pdfFailure, setPdfFailure] = useState<{ key: symbol | null; error: string }>({ key: null, error: '' })
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const selection = useMemo(() => {
    if (frozen) return { units: frozen.units, error: '' }
    const all = unitsRes.data ?? []
    if (unitIdsParam === null) return { units: all, error: '' }
    const ids = unitIdsParam.split(',')
    const chosen = all.filter(u => ids.includes(u.id))
    if (ids.some(id => !id || id !== id.trim()) || new Set(ids).size !== ids.length || chosen.length !== ids.length) {
      return { units: [], error: 'Nieprawidłowy wybór sztuk — nie zastąpiono go całą serią.' }
    }
    return { units: chosen, error: '' }
  }, [frozen, unitsRes.data, unitIdsParam])
  const units = selection.units
  const tplResp  = templateRes.data
  const template = frozen?.template ?? (live ? tplResp?.template : null) ?? null
  const recipe   = recipeRes.data
  const shelfLifeDays = frozen?.shelfLifeDays ?? recipe?.shelfLifeDays ?? 5
  // An old QR map/PDF/error must never become ready for different loaded inputs,
  // even when a route is reused or a saved job is fetched again under the same ID.
  const renderKey = useMemo(() => Symbol('a4-render'), [template, units, shelfLifeDays, orgCode, frozen, planLineId, clientId, recipeId, unitIdsParam])
  const qrMap = qrState.key === renderKey ? qrState.map : {}
  const pdfUrl = pdfState.key === renderKey ? pdfState.url : ''
  const qrError = qrFailure.key === renderKey ? qrFailure.error : ''
  const pdfError = pdfFailure.key === renderKey ? pdfFailure.error : ''
  const tooMany = units.length > 200 ? 'Jedno zadanie A4 może zawierać do 200 sztuk. Wybierz mniejszą paczkę.' : ''
  const perSheet = template?.labelsPerSheet ?? 2
  const layout = useMemo(() => {
    try { return { pages: groupA4Units(units, perSheet, frozen?.placements), error: '' } }
    catch (e) { return { pages: [], error: e instanceof Error ? e.message : 'Błąd układu A4' } }
  }, [units, perSheet, frozen?.placements])

  // Generate QR data URLs for all units
  useEffect(() => {
    if (units.length === 0 || tooMany) return
    let cancelled = false
    const map: Record<string, string> = {}

    setQrFailure({ key: renderKey, error: '' })
    // Sequential: don't allocate a thousand 1000×1000 canvases at once.
    void (async () => {
      const codes = new Set<string>()
      for (const u of units) {
        if (cancelled) return
        if (!u.qrCode?.startsWith('U|') || u.qrCode.length <= 2 || codes.has(u.qrCode)) throw new Error('Brak unikalnego QR sztuki')
        codes.add(u.qrCode)
        map[u.id] = await QRCode.toDataURL(u.qrCode, UNIT_QR_OPTIONS)
      }
      if (!cancelled) setQrState({ key: renderKey, map })
    })().catch(e => { if (!cancelled) setQrFailure({ key: renderKey, error: e instanceof Error ? e.message : 'Błąd QR — druk zablokowany' }) })

    return () => { cancelled = true }
  }, [units, renderKey, tooMany])

  // Ready for preview; printer IO additionally requires frozen inputs + a claim.
  const allQrReady = units.length > 0 && units.every((u) => Boolean(qrMap[u.id]))
  const dataReady  = allQrReady && template !== null && Boolean(frozen || recipe) && !workflow.loading && !workflow.error && !tooMany && !layout.error

  // Build vector PDF when template has backgroundPdf and all QR codes are ready
  useEffect(() => {
    if (!dataReady || !template?.backgroundPdf) return
    if (Object.keys(qrMap).length === 0) return
    let objectUrl = ''
    let cancelled = false
    const controller = new AbortController()
    setPdfState({ key: null, url: '' })
    setPdfFailure({ key: renderKey, error: '' })
    buildVectorPdf(template, units, perSheet, shelfLifeDays, qrMap, orgCode, frozen?.placements, controller.signal)
      .then((url) => {
        if (cancelled) { URL.revokeObjectURL(url); return }
        objectUrl = url
        setPdfState({ key: renderKey, url })
      })
      .catch((err) => {
        if (!cancelled) setPdfFailure({ key: renderKey, error: err instanceof Error ? err.message : 'Nie udało się utworzyć PDF' })
      })
    return () => {
      cancelled = true
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [dataReady, template, units, perSheet, shelfLifeDays, qrState, orgCode, renderKey, frozen?.placements])

  // Only a fresh user intent may print. Loading/reloading a job never does.
  useEffect(() => {
    if (pdfError || qrError || layout.error) { workflow.renderFailed(pdfError || qrError || layout.error); return }
    if (!workflow.job || !dataReady || (template?.backgroundPdf && (!pdfUrl || (workflow.job.transport === 'browser' && pdfLoaded !== pdfUrl)))) return
    void workflow.complete(workflow.job.id, async assertActive => {
      assertActive()
      if (workflow.job!.transport === 'file') {
        if (!pdfUrl) throw new Error('Brak gotowego PDF — nie wyeksportowano pliku')
        const a = document.createElement('a')
        a.href = pdfUrl; a.download = `etykiety-${workflow.job!.id}.pdf`
        document.body.appendChild(a); a.click(); a.remove()
      } else if (template?.backgroundPdf) {
        const target = iframeRef.current?.contentWindow
        if (!target) throw new Error('Podgląd PDF nie jest gotowy do druku')
        target.print()
      } else {
        await drukuj({ strict: true, beforePrint: assertActive })
      }
    }, async () => {
      if (template?.backgroundPdf) {
        if (workflow.job!.transport === 'browser' && '__TAURI_INTERNALS__' in window) throw new Error('Druk PDF w Tauri wymaga zewnętrznej przeglądarki PDF. Anuluj niewysłane zadanie i wybierz eksport PDF.')
      } else {
        const images = Array.from(document.querySelectorAll<HTMLImageElement>('.label-sheet img'))
        await document.fonts?.ready
        await Promise.all(images.map(img => img.decode()))
      }
    })
  }, [workflow, dataReady, template?.backgroundPdf, pdfUrl, pdfLoaded, pdfError, qrError, layout.error])

  // ── Loading states ──
  const anyLoading = workflow.loading || (live && (unitsRes.loading || templateRes.loading || recipeRes.loading || clientsRes.loading))
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
  if (live && unitsRes.error)    errParts.push(`sztuki: ${unitsRes.error}`)
  if (live && templateRes.error) errParts.push(`szablon: ${templateRes.error}`)
  if (live && recipeRes.error)   errParts.push(`receptura: ${recipeRes.error}`)
  if (live && clientsRes.error)  errParts.push(`klient: ${clientsRes.error}`)
  if (workflow.error) errParts.push(workflow.error)
  if (selection.error || tooMany || qrError || layout.error) errParts.push(selection.error || tooMany || qrError || layout.error)
  if (errParts.length > 0) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Błąd ładowania danych</div>
          <ul className="text-sm text-slate-700 list-disc pl-5">
            {errParts.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
          <button className="mt-3 rounded border px-3 py-2" onClick={workflow.reload}>Odśwież historię (bez ponawiania druku)</button>
        </div>
      </div>
    )
  }

  // ── No template ──
  if (live && tplResp && !tplResp.exists) {
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
  const pages = layout.pages

  const fp = template.fieldPositions

  // Kalibracja druku (kompensacja ucinanego paska) — wspólna dla obu gałęzi.
  const calib = template.printCalib || {}
  const calibTransform = `translate(${calib.dxMm ?? 0}mm, ${calib.dyMm ?? 0}mm) scale(${(calib.scale ?? 100) / 100})`
  const canPrint = dataReady && !workflow.busy && (!workflow.job || workflow.job.state === 'prepared')
    && (!workflow.needsAcknowledgement || workflow.acknowledged) && (!halal || Boolean(orgCode.trim()))
  const nativePdf = Boolean(template.backgroundPdf && '__TAURI_INTERNALS__' in window)
  const restartParams = new URLSearchParams(params)
  restartParams.delete('jobId'); restartParams.delete('requestKey')
  const archiveNotice = <div className="no-print space-y-2 border-b bg-white px-4 py-3 text-sm" aria-busy={workflow.busy}>
    <p>Okno druku nie potwierdza wydruku. Drukuj w skali 100%, bez dopasowania. Wybór urządzenia następuje w systemowym dialogu.</p>
    {frozen && <p>Snapshot rewizji #{workflow.snapshot!.revisionId}: oryginalne dane, kod nadzoru i sloty. {template.backgroundPdf ? 'PDF jest składany ponownie istniejącym rendererem A4.' : 'Arkusz jest składany ponownie w HTML.'} Nie jest to gotowy archiwalny plik PDF.</p>}
    {workflow.needsAcknowledgement && <label className="flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-2">
      <input type="checkbox" checked={workflow.acknowledged} disabled={workflow.busy} onChange={e => workflow.setAcknowledged(e.target.checked)} />
      {workflow.source ? 'Sprawdziłem wydruki. Świadomie zlecam dodruk z oryginalnym QR i w pierwotnych slotach.' : 'Rozumiem, że ta ścieżka używa aktualnych danych. Wersję historyczną wybiera się z historii sztuki.'}
    </label>}
    {workflow.message && <p role="status" className="rounded border bg-slate-50 p-2">{workflow.message}</p>}
    {workflow.busy && <p role="status">Przygotowywanie i obsługa zadania… Nie uruchamiaj kolejnej próby.</p>}
    {nativePdf && <p role="note">Tauri nie obsługuje drukowania osadzonego PDF tą ścieżką. Pobierz PDF i wydrukuj go z zewnętrznej przeglądarki PDF w skali 100%.</p>}
    {workflow.job && <section aria-label="Historia zadania A4" className="space-y-2 rounded border p-3">
      <h2 className="font-bold">{labelJobStateLabel[workflow.job.state]}</h2>
      <p className="break-all text-xs">Zadanie {workflow.job.id} · {workflow.job.count} sztuk · {workflow.job.printerName}</p>
      <ol className="text-xs">{workflow.job.events.map((e, i) => <li key={i}>{labelJobStateLabel[e.state]} — {e.actor}, {e.createdAt}</li>)}</ol>
      {workflow.job.state === 'prepared' && <button disabled={workflow.busy} onClick={() => workflow.changeState('cancel')} className="rounded border px-3 py-2">Anuluj niewysłane zadanie</button>}
      {workflow.job.state === 'submitting' && <div className="space-y-2 bg-amber-50 p-2">
        <p>Poprzednia próba mogła otworzyć dialog. Zamknij poprzednie okna i sprawdź wydruki. Po 5 minutach można zapisać nieznany wynik.</p>
        <label className="flex gap-2"><input type="checkbox" checked={workflow.acknowledged} onChange={e => workflow.setAcknowledged(e.target.checked)} />Sprawdziłem poprzednią próbę i drukarkę.</label>
        <button disabled={workflow.busy || !workflow.acknowledged} onClick={() => workflow.changeState('recover')} className="rounded border px-3 py-2">Zapisz nieznany wynik</button>
      </div>}
      {!workflow.busy && ['dialog_opened', 'exported', 'uncertain'].includes(workflow.job.state) && <Link className="inline-block rounded border px-3 py-2" to={`?sourceJobId=${encodeURIComponent(workflow.job.id)}`}>Zleć świadomy dodruk całego zadania</Link>}
      {!workflow.busy && workflow.job.state === 'cancelled' && (planLineId || params.get('sourceJobId')) && <Link className="inline-block rounded border px-3 py-2" to={`?${restartParams}`}>Przygotuj nowe zadanie</Link>}
    </section>}
    <button disabled={workflow.busy} onClick={workflow.reload} className="rounded border px-3 py-2">Odśwież stan (bez ponawiania druku)</button>
  </div>

  // ── Vector PDF render branch (pdf-lib) ──
  if (template.backgroundPdf) {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        {/* Top bar */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
          <Link
            to="/office/planowanie-produkcji"
            className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900"
          >
            <ArrowLeft size={14} /> Wróć
          </Link>
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <span>{units.length} etykiet · {pages.length} stron · {perSheet}/A4</span>
            {halal && (
              <label className="flex items-center gap-1.5 font-semibold text-slate-700">
                Kod nadzoru:
                <input value={orgCode} title={orgCode} maxLength={128} disabled={Boolean(frozen) || workflow.busy} onChange={e => changeOrgCode(e.target.value)} placeholder="np. 7J8EX"
                  className="w-24 rounded border border-slate-300 px-2 py-0.5 font-mono uppercase" />
              </label>
            )}
            {pdfUrl && <span className="text-green-700 font-semibold">✓ PDF wektorowy</span>}
          </div>
          <div className="flex items-center gap-2">
            {pdfUrl && (
              <button
                disabled={!canPrint || workflow.job?.transport === 'browser'} onClick={() => workflow.prepare('file', orgCode)}
                className="flex items-center gap-1.5 rounded bg-slate-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
              >
                <Download size={14} /> Pobierz PDF
              </button>
            )}
            <button
              disabled={!canPrint || !pdfUrl || nativePdf || workflow.job?.transport === 'file'}
              onClick={() => workflow.prepare('browser', orgCode)}
              className="flex items-center gap-1.5 rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
            >
              <Printer size={14} /> Drukuj
            </button>
          </div>
        </div>

        {archiveNotice}

        <div className="border-b border-slate-200 bg-white px-4 py-2 text-sm text-slate-700">
          Gotowy arkusz <b>A4 · 210 × 297 mm</b>, {perSheet} etykiet na stronie.
          {' '}Drukuj: <b>rozmiar rzeczywisty / 100%</b>, <b>1 strona na arkusz</b>.
          {' '}Układ etykiet jest już złożony w PDF.
        </div>

        {/* PDF viewer */}
        <div className="flex-1 flex items-stretch">
          {pdfError ? (
            <div role="alert" className="p-6 text-sm text-red-700">Błąd generowania PDF: {pdfError}</div>
          ) : !pdfUrl ? (
            <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm py-20">
              Generuję PDF wektorowy…
            </div>
          ) : (
            <iframe
              ref={iframeRef}
              src={`${pdfUrl}#toolbar=0`}
              onLoad={() => setPdfLoaded(pdfUrl)}
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
          transform-origin: center center;
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
          .label-pages { overflow: visible !important; }
          @page { size: A4 portrait; margin: 0; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link
          to="/office/planowanie-produkcji"
          className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900"
        >
          <ArrowLeft size={14} /> Wróć
        </Link>
        <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
          <span>{units.length} etykiet · {pages.length} stron · {perSheet}/A4</span>
          {halal && (
            <label className="flex items-center gap-1.5 font-semibold text-slate-700">
              Kod nadzoru:
              <input value={orgCode} title={orgCode} maxLength={128} disabled={Boolean(frozen) || workflow.busy} onChange={e => changeOrgCode(e.target.value)} placeholder="np. 7J8EX"
                className="w-24 rounded border border-slate-300 px-2 py-0.5 font-mono uppercase" />
            </label>
          )}
        </div>
        <button
          disabled={!canPrint || workflow.job?.transport === 'file'} onClick={() => workflow.prepare('browser', orgCode)}
          className="flex items-center gap-1.5 rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <Printer size={14} /> Drukuj
        </button>
      </div>

      {archiveNotice}

      <p className="no-print px-4 py-2 text-sm text-slate-600 md:hidden">Podgląd zachowuje wymiary arkusza. Przewiń go w poziomie, aby zobaczyć prawą etykietę.</p>
      <div className="label-pages overflow-x-auto" role="region" tabIndex={0} aria-label="Arkusze A4 — podgląd przewijany w poziomie">
      {pages.map((pageUnits, pageIdx) => (
        <div key={pageIdx} className="label-sheet">
         {/* Kalibracja druku: tło + pola przesuwane/skalowane razem */}
         <div className="label-calib" style={{ transform: calibTransform }}>
          {/* ONE background fills the full A4 sheet — the artwork is the whole page */}
          {template.backgroundData && (
            <img className="label-bg" src={template.backgroundData} alt="" />
          )}

          {/* For each unit on this sheet, overlay its fields at the correct slot offset */}
          {pageUnits.map(({ unit, slot }) => {
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
    </div>
  )
}
