/**
 * Etykieta kartonu magazynowego — IDENTYCZNY layout jak etykieta palety
 * zamówienia (wspólny komponent CartonLabel). QR `SCARTON|<id>` do pakowania.
 */
import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { stockCartonsApi } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { useClientNames } from '@/lib/clientNames'
import { CartonLabel, formatKgCompact } from '@/features/labels/CartonLabel'

export function StockCartonLabelPage() {
  const { id = '' } = useParams<{ id: string }>()
  const clientDisplay = useClientNames()
  const { data: carton } = useApi(() => stockCartonsApi.get(id), [id])
  const [qrUrl, setQrUrl] = useState('')

  useEffect(() => {
    if (!id) return
    QRCode.toDataURL(`SCARTON|${id}`, {
      errorCorrectionLevel: 'Q', margin: 4, width: 480,
      color: { dark: '#000000', light: '#FFFFFF' },
    }).then(setQrUrl).catch(() => setQrUrl(''))
  }, [id])

  if (!carton) return <div className="p-10 text-center text-slate-500">Ładowanie etykiety…</div>

  const cartonNo = formatCartonNo(carton.cartonNo)
  // Karton mieszany: jedna linia opisu na pozycję; total = suma po pozycjach.
  const lines: { targetQty: number; kgPerUnit: number }[] = carton.lines?.length
    ? carton.lines.map(l => ({ targetQty: l.targetQty, kgPerUnit: l.kgPerUnit }))
    : [{ targetQty: carton.targetQty, kgPerUnit: carton.kgPerUnit }]
  const mainLines = lines.map(l => `${l.targetQty} X ${formatKgCompact(l.kgPerUnit)}KG`)
  const totalKg = lines.reduce((sum, l) => sum + l.targetQty * l.kgPerUnit, 0)

  return (
    <CartonLabel
      cornerNo={cartonNo}
      clientName={clientDisplay(carton.clientName)}
      mainLines={mainLines}
      totalKg={totalKg}
      footerLabel="MAGAZYN"
      footerValue=""
      qrDataUrl={qrUrl}
      qrCaption={cartonNo}
      backTo="/office/magazyn/gotowe"
      backLabel="Wróć"
    />
  )
}
