/**
 * Etykiety A4 z szablonu PDF — wektorowo, według zasad starego `buildVectorPdf`
 * (src/pages/office/LabelPrintPage.tsx), które działały u ZAGROS/TRUVA:
 *  - tło PDF zawsze rozciągnięte na cały arkusz A4 (rozmiar źródła nie zmienia
 *    rozmiaru arkusza ani nadruku — TRUVA 259 × 367 mm),
 *  - kalibracja (dx/dy mm, skala %) jako jedno przekształcenie całej strony
 *    względem jej środka (tło i pola razem),
 *  - waga: liczba wg pogrubienia pola, „ kg” zawsze zwykłym krojem,
 *  - 1 albo 2 etykiety na arkusz (slot 2 = `polePlotna`).
 * pdf-lib, fontkit i Liberation Sans (Arial) ładowane na żądanie.
 */
import type { LabelDesign, LabelField, UnitForLabel } from '@/lib/api'
import { UNIT_QR_OPTIONS } from '@/features/labels/unitQr'
import { A4_MM, polePlotna, wartosciPol } from './model'

const MM = 72 / 25.4
const W = A4_MM.w * MM
const H = A4_MM.h * MM

export interface Transformacja { Sx: number; Sy: number; Tx: number; Ty: number }

export function transformacjaA4(d: LabelDesign): Transformacja {
  const c = d.calibration ?? { dxMm: 0, dyMm: 0, scale: 100 }
  const s = (c.scale ?? 100) / 100
  const dx = (c.dxMm ?? 0) * MM, dy = (c.dyMm ?? 0) * MM
  return { Sx: s, Sy: s, Tx: (W / 2 + dx) - s * (W / 2), Ty: (H / 2 - dy) - s * (H / 2) }
}

/** Lewy-górny róg pola w mm → punkt rysowania w pt (pdf-lib: od lewego-dolnego, tekst od linii bazowej). */
export function punktPola(f: LabelField, t: Transformacja): { xPt: number; yPt: number; sizePt: number } {
  const size = f.sizePt ?? 10
  const xRaw = f.xMm * MM
  const yRaw = f.kind === 'qr' ? H - f.yMm * MM - (f.qrMm ?? 25) * MM
    : f.kind === 'box' ? H - f.yMm * MM - (f.hMm ?? 8) * MM
      : H - f.yMm * MM - size
  return { xPt: t.Tx + xRaw * t.Sx, yPt: t.Ty + yRaw * t.Sy, sizePt: size * t.Sy }
}

const zBase64 = (dataUrl: string) => {
  const b64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}
const doBase64 = (bytes: Uint8Array) => {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export interface OpcjeA4 {
  orgCode?: string
  /** Ile sztuk ma pozycja (planLineId → liczba) — do „3/29”. */
  razem?: Record<string, number>
  /** null = czcionki standardowe pdf-lib (testy); domyślnie Liberation Sans przez fetch. */
  czcionki?: null | (() => Promise<{ reg: ArrayBuffer; bold: ArrayBuffer }>)
}

async function liberation(): Promise<{ reg: ArrayBuffer; bold: ArrayBuffer }> {
  const [{ default: regUrl }, { default: boldUrl }] = await Promise.all([
    import('@/assets/fonts/LiberationSans-Regular.ttf?url'), import('@/assets/fonts/LiberationSans-Bold.ttf?url')])
  const [reg, bold] = await Promise.all([fetch(regUrl).then(r => r.arrayBuffer()), fetch(boldUrl).then(r => r.arrayBuffer())])
  return { reg, bold }
}

/** Jeden PDF ze wszystkimi etykietami (kolejność sztuk zachowana) → base64 bez prefiksu. */
export async function zbudujPdfA4(d: LabelDesign, units: UnitForLabel[], opts: OpcjeA4 = {}): Promise<string> {
  const { PDFDocument, StandardFonts, rgb, degrees } = await import('pdf-lib')
  const out = await PDFDocument.create()
  let arial, arialB
  if (opts.czcionki === null) {
    arial = await out.embedFont(StandardFonts.Helvetica)
    arialB = await out.embedFont(StandardFonts.HelveticaBold)
  } else {
    const { default: fontkit } = await import('@pdf-lib/fontkit')
    out.registerFontkit(fontkit)
    const f = await (opts.czcionki ?? liberation)()
    arial = await out.embedFont(f.reg, { subset: true })
    arialB = await out.embedFont(f.bold, { subset: true })
  }
  const times = await out.embedFont(StandardFonts.TimesRoman), timesB = await out.embedFont(StandardFonts.TimesRomanBold)
  const cour = await out.embedFont(StandardFonts.Courier), courB = await out.embedFont(StandardFonts.CourierBold)
  const krój = (f: LabelField, bold = !!f.bold) =>
    f.font === 'times' ? (bold ? timesB : times) : f.font === 'courier' ? (bold ? courB : cour) : (bold ? arialB : arial)

  let tlo: Awaited<ReturnType<typeof out.embedPage>> | null = null
  let srcW = W, srcH = H
  if (d.backgroundPdf) {
    const src = await PDFDocument.load(zBase64(d.backgroundPdf))
    const strona = src.getPage(0)
    srcW = strona.getWidth(); srcH = strona.getHeight()
    tlo = await out.embedPage(strona)
  }
  const t = transformacjaA4(d)
  const naArkusz = d.labelsPerSheet === 2 ? 2 : 1
  const QRCode = (await import('qrcode')).default

  for (let i = 0; i < units.length; i += naArkusz) {
    const strona = out.addPage([W, H])
    if (tlo) strona.drawPage(tlo, { x: t.Tx, y: t.Ty, xScale: t.Sx * (W / srcW), yScale: t.Sy * (H / srcH) })
    for (let slot = 0 as 0 | 1; slot < naArkusz && i + slot < units.length; slot = (slot + 1) as 0 | 1) {
      const u = units[i + slot]
      const w = wartosciPol(u, { orgCode: opts.orgCode, razem: opts.razem?.[u.planLineId] })
      for (const baza of d.fields) {
        const f = polePlotna(d, baza, slot)
        const p = punktPola(f, t)
        if (f.kind === 'qr') {
          const png = await QRCode.toDataURL(w.qr, UNIT_QR_OPTIONS)
          const img = await out.embedPng(zBase64(png))
          const bok = (f.qrMm ?? 25) * MM * Math.min(t.Sx, t.Sy)
          strona.drawImage(img, { x: p.xPt, y: p.yPt, width: bok, height: bok })
          continue
        }
        if (f.kind === 'box') {
          const wPt = (f.wMm ?? 30) * MM * t.Sx, hPt = (f.hMm ?? 8) * MM * t.Sy
          strona.drawRectangle(f.fill === 'white'
            ? { x: p.xPt, y: p.yPt, width: wPt, height: hPt, color: rgb(1, 1, 1) }
            : { x: p.xPt, y: p.yPt, width: wPt, height: hPt, borderColor: rgb(0, 0, 0), borderWidth: (f.thickMm ?? 0.3) * MM })
          continue
        }
        const tekst = f.kind === 'static_text' ? (f.text ?? '') : w[f.kind]
        if (!tekst) continue
        const obrot = f.rotation ? { rotate: degrees(-f.rotation) } : {}
        if (f.kind === 'weight' && tekst.endsWith(' kg')) {
          const liczba = tekst.slice(0, -3)
          strona.drawText(liczba, { x: p.xPt, y: p.yPt, size: p.sizePt, font: krój(f), color: rgb(0, 0, 0), ...obrot })
          strona.drawText(' kg', { x: p.xPt + krój(f).widthOfTextAtSize(liczba, p.sizePt), y: p.yPt, size: p.sizePt, font: krój(f, false), color: rgb(0, 0, 0), ...obrot })
        } else {
          strona.drawText(tekst, { x: p.xPt, y: p.yPt, size: p.sizePt, font: krój(f), color: rgb(0, 0, 0), ...obrot })
        }
      }
    }
  }
  return doBase64(await out.save())
}
