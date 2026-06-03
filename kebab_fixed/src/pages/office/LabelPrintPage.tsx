import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { finishedUnitsApi, labelTemplatesApi, recipesApi } from '@/lib/apiClient'
import type { FinishedUnitCard, LabelTemplate } from '@/lib/api'

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

/** Compute dynamic field values for one unit. */
function unitFieldValues(
  unit: FinishedUnitCard,
  shelfLifeDays: number,
): Record<string, string> {
  const prodDateIso = (unit as any).producedDate || unit.producedAt?.slice(0, 10) || todayIso()
  const bestBeforeIso = addDays(prodDateIso, shelfLifeDays)
  return {
    prod_date: fmtDate(prodDateIso),
    freeze_date: fmtDate(prodDateIso),
    best_before: fmtDate(bestBeforeIso),
    batch_no: unit.batchNo,
  }
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
  const printedRef = useRef(false)

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

  useEffect(() => {
    if (!dataReady || printedRef.current) return
    printedRef.current = true
    const timer = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(timer)
  }, [dataReady])

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
            const dx = slot * (100 / perSheet)
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
                      left: `${fp.qr.x + dx}%`,
                      top: `${fp.qr.y}%`,
                      width: `${fp.qr.size}mm`,
                      height: `${fp.qr.size}mm`,
                      imageRendering: 'pixelated',
                    }}
                  />
                )}

                {/* Text fields: prod_date, freeze_date, best_before, batch_no */}
                {(['prod_date', 'freeze_date', 'best_before', 'batch_no'] as const).map((key) => {
                  const pos = fp[key]
                  if (!pos) return null
                  return (
                    <span
                      key={key}
                      className="label-field"
                      style={{
                        left: `${pos.x + dx}%`,
                        top: `${pos.y}%`,
                        fontSize: `${pos.size}pt`,
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
