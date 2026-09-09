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
import { CartonLabel } from '@/features/labels/CartonLabel'
import { buildCartonLabelContent, cartonLabelTotalKg } from '@/features/labels/cartonLabelLines'

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
  // Ta sama reguła co na palecie zamówienia — jeden wydruk w dwóch miejscach.
  const items = carton.lines?.length
    ? carton.lines.map(l => ({
        qty: l.targetQty, kgPerUnit: l.kgPerUnit,
        recipeName: l.recipeName, packagingName: l.packagingName,
      }))
    : [{
        qty: carton.targetQty, kgPerUnit: carton.kgPerUnit,
        recipeName: carton.recipeName, packagingName: carton.packagingName,
      }]
  const { recipeHeader, lines: mainLines } = buildCartonLabelContent(items)
  const totalKg = cartonLabelTotalKg(items)

  return (
    <CartonLabel
      cornerNo={cartonNo}
      clientName={clientDisplay(carton.clientName)}
      recipeHeader={recipeHeader}
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
