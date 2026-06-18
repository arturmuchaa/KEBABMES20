import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, orderPalletsApi } from '@/lib/apiClient'
import { useClientNames } from '@/lib/clientNames'
import { CartonLabel, formatKgCompact } from '@/features/labels/CartonLabel'

export function PalletLabelPrintPage() {
  const clientDisplay = useClientNames()
  const { id = '', palletNo = '' } = useParams<{ id: string; palletNo: string }>()
  const orderRes = useApi(() => clientOrdersApi.byId(id), [id])
  const palletsRes = useApi(() => orderPalletsApi.list(id), [id])
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
      }
    })
    const totalKg = details.reduce((sum, item) => sum + item.qty * item.kgPerUnit, 0)
    const totalQty = details.reduce((sum, item) => sum + item.qty, 0)
    const byKg = new Map<number, number>()
    details.forEach((item) => {
      if (item.kgPerUnit > 0) byKg.set(item.kgPerUnit, (byKg.get(item.kgPerUnit) ?? 0) + item.qty)
    })
    const groups = [...byKg.entries()].sort((a, b) => b[0] - a[0])
    const mainLines = groups.length
      ? groups.map(([kg, qty]) => `${qty} X ${formatKgCompact(kg)}KG`)
      : [`${totalQty} SZT`]
    return { totalKg, mainLines }
  }, [order, target])

  useEffect(() => {
    document.title = order && target ? `Paleta ${target.palletNo} - ${order.clientName}` : 'Etykieta palety'
  }, [order, target])

  useEffect(() => {
    if (!order || !target) { setQrDataUrl(''); return }
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    const url = `${origin}/m/p/${order.id}/${target.palletNo}`
    QRCode.toDataURL(url, {
      errorCorrectionLevel: 'Q', margin: 4, width: 480,
      color: { dark: '#000000', light: '#FFFFFF' },
    }).then(setQrDataUrl).catch(() => setQrDataUrl(''))
  }, [order, target])

  if (orderRes.loading || palletsRes.loading) {
    return <div className="p-10 text-center text-muted-foreground">Ładowanie etykiety palety…</div>
  }
  if (orderRes.error || palletsRes.error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Nie udało się otworzyć etykiety palety</div>
          <div className="text-sm text-slate-700">{orderRes.error || palletsRes.error}</div>
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
            <Link to="/office/zamowienia" className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              <ArrowLeft size={14} /> Wróć do zamówień
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const cornerNo = target.cartonNo || `P${target.palletNo}`
  return (
    <CartonLabel
      cornerNo={cornerNo}
      clientName={clientDisplay(order.clientName)}
      mainLines={stats.mainLines}
      totalKg={stats.totalKg}
      footerLabel="ZAMÓWIENIE:"
      footerValue={order.orderNo}
      qrDataUrl={qrDataUrl}
      qrCaption={`${cornerNo} · ${order.orderNo}`}
      backTo="/office/zamowienia"
      backLabel="Wróć do zamówień"
    />
  )
}
