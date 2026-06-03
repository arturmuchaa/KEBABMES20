import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, orderPalletsApi } from '@/lib/apiClient'
import { fmtKg } from '@/lib/utils'

function formatKgCompact(value: number) {
  return Number.isInteger(value) ? fmtKg(value, 0) : fmtKg(value, 1)
}

export function PalletLabelPrintPage() {
  const { id = '', palletNo = '' } = useParams<{ id: string; palletNo: string }>()
  const orderRes = useApi(() => clientOrdersApi.byId(id), [id])
  const palletsRes = useApi(() => orderPalletsApi.list(id), [id])
  const printedRef = useRef(false)
  const contentBoxRef = useRef<HTMLDivElement | null>(null)
  const contentRef = useRef<HTMLDivElement | null>(null)
  const [fontSizePt, setFontSizePt] = useState(90)
  const [layoutReady, setLayoutReady] = useState(false)
  const [qrDataUrl, setQrDataUrl] = useState<string>('')

  const order = orderRes.data
  const pallets = palletsRes.data ?? []

  const target = useMemo(
    () => pallets.find((entry) => String(entry.palletNo) === palletNo),
    [palletNo, pallets],
  )

  const stats = useMemo(() => {
    if (!order || !target) return null

    const linesById = Object.fromEntries(order.lines.map((line) => [line.id, line]))
    const details = target.items.map((item) => {
      const line = linesById[item.orderLineId]
      return {
        qty: item.qty,
        kgPerUnit: Number(line?.kgPerUnit ?? item.kgPerUnit ?? 0),
        recipeName: line?.recipeName || item.recipeName || '',
        productTypeName: line?.productTypeName || item.productTypeName || '',
      }
    })

    const totalQty = details.reduce((sum, item) => sum + item.qty, 0)
    const totalKg = details.reduce((sum, item) => sum + item.qty * item.kgPerUnit, 0)
    const uniqueKg = [...new Set(details.map((item) => item.kgPerUnit).filter((value) => value > 0))]

    const mainLabel = uniqueKg.length === 1
      ? `${totalQty} X ${formatKgCompact(uniqueKg[0])}KG`
      : `${totalQty} SZT / ${formatKgCompact(totalKg)}KG`

    return {
      totalQty,
      totalKg,
      mainLabel,
    }
  }, [order, target])

  useEffect(() => {
    document.title = order && target
      ? `Paleta ${target.palletNo} - ${order.clientName}`
      : 'Etykieta palety'
  }, [order, target])

  useEffect(() => {
    if (!order || !target) { setQrDataUrl(''); return }
    // URL zamiast tokenu — dzięki temu skanowanie iOS Camera otwiera landing page
    // (a wewnętrzny skaner też to parsuje, bo backend ma regex /m/p/<id>/<no>).
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/m/p/${order.id}/${target.palletNo}`
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'Q', // 25% korekcji; 'Q' a nie 'H', bo payload to dłuższy URL (druk biurowy)
      margin: 4,                 // quiet zone — wymagane 4 moduły białego marginesu
      width: 480,
      color: { dark: '#000000', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
  }, [order, target])

  useLayoutEffect(() => {
    if (!order || !target || !stats || !contentBoxRef.current || !contentRef.current) return

    function fitContent() {
      const box = contentBoxRef.current
      const content = contentRef.current
      if (!box || !content) return

      const availableWidth = Math.max(120, box.clientWidth)
      const availableHeight = Math.max(120, box.clientHeight)

      let nextFontSize = 90
      content.style.fontSize = `${nextFontSize}pt`

      while (
        nextFontSize > 30 &&
        (content.scrollWidth > availableWidth || content.scrollHeight > availableHeight)
      ) {
        nextFontSize -= 2
        content.style.fontSize = `${nextFontSize}pt`
      }

      setFontSizePt(nextFontSize)
      setLayoutReady(true)
    }

    setLayoutReady(false)
    setFontSizePt(90)
    const frame = window.requestAnimationFrame(fitContent)
    window.addEventListener('resize', fitContent)
    return () => {
      window.cancelAnimationFrame(frame)
      window.removeEventListener('resize', fitContent)
    }
  }, [order, target, stats])

  useEffect(() => {
    if (!order || !target || !stats || !layoutReady || !qrDataUrl || printedRef.current) return
    printedRef.current = true
    const timer = window.setTimeout(() => window.print(), 250)
    return () => window.clearTimeout(timer)
  }, [layoutReady, order, target, stats, qrDataUrl])

  if (orderRes.loading || palletsRes.loading) {
    return <div className="p-10 text-center text-muted-foreground">Ładowanie etykiety palety…</div>
  }

  if (orderRes.error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Nie udało się otworzyć etykiety palety</div>
          <div className="text-sm text-slate-700">{orderRes.error}</div>
        </div>
      </div>
    )
  }

  if (palletsRes.error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Nie udało się pobrać palet</div>
          <div className="text-sm text-slate-700">{palletsRes.error}</div>
        </div>
      </div>
    )
  }

  if (!order || !target || !stats) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-slate-900">Nie znaleziono palety</div>
          <div className="text-sm text-slate-700">Wybrana paleta nie istnieje albo została usunięta.</div>
          <div className="mt-5">
            <Link
              to="/office/zamowienia"
              className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
            >
              <ArrowLeft size={14} /> Wróć do zamówień
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`
        .label-page {
          width: 297mm;
          height: 210mm;
          background: #fff;
        }
        @media screen {
          .label-page {
            margin: 16px auto;
            box-shadow: 0 1px 4px rgba(0, 0, 0, .08);
          }
        }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          .label-page { margin: 0 !important; box-shadow: none !important; }
          @page { size: A4 landscape; margin: 0; }
        }
      `}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link to="/office/zamowienia" className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900">
          <ArrowLeft size={14} /> Wróć do zamówień
        </Link>
        <button
          onClick={() => window.print()}
          className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700"
        >
          <Printer size={14} /> Drukuj etykietę
        </button>
      </div>

      <div className="label-page relative overflow-hidden">
        <div className="flex h-full w-full flex-col px-[12.7mm] py-[12.7mm]">
          <div
            className="flex items-start justify-end leading-none"
            style={{ fontFamily: '"Arial Black", Arial, sans-serif' }}
          >
            <div className="text-[38pt]">P{target.palletNo}</div>
          </div>

          <div
            ref={contentBoxRef}
            className="flex flex-1 items-center justify-center overflow-hidden py-4"
          >
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
              <div>{order.clientName}</div>
              <div className="mt-4">{stats.mainLabel}</div>
            </div>
          </div>

          <div
            className="flex items-end justify-between gap-6"
            style={{ fontFamily: 'Arial, sans-serif' }}
          >
            <div className="text-left leading-tight">
              <div className="text-[13pt] font-semibold tracking-wide text-slate-700">WAGA NETTO</div>
              <div className="text-[18pt] font-bold">{formatKgCompact(stats.totalKg)} KG</div>
              <div className="mt-2 text-[10pt] uppercase tracking-wide text-slate-600">
                ZAMÓWIENIE: {order.orderNo}
              </div>
            </div>
            {qrDataUrl && (
              <div className="flex flex-col items-center text-center">
                <img
                  src={qrDataUrl}
                  alt={`QR P${target.palletNo}`}
                  className="block"
                  style={{ width: '38mm', height: '38mm', imageRendering: 'pixelated' }}
                />
                <div className="mt-1 text-[8pt] font-mono leading-none text-slate-700">
                  P{target.palletNo} · {order.orderNo}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
