/**
 * Etykieta kartonu magazynowego — do naklejenia. Numer kartonu (duży),
 * klient, produkt, ilość×waga + QR (SCARTON|<id>) do otwarcia przy pakowaniu.
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { stockCartonsApi } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { useClientNames } from '@/lib/clientNames'

export function StockCartonLabelPage() {
  const { id = '' } = useParams<{ id: string }>()
  const clientDisplay = useClientNames()
  const { data: carton } = useApi(() => stockCartonsApi.get(id), [id])
  const [qrUrl, setQrUrl] = useState('')
  const printedRef = useRef(false)

  useEffect(() => {
    if (!id) return
    QRCode.toDataURL(`SCARTON|${id}`, { width: 320, margin: 1 }).then(setQrUrl).catch(() => {})
  }, [id])

  useEffect(() => {
    if (!carton || !qrUrl || printedRef.current) return
    printedRef.current = true
    const t = window.setTimeout(() => window.print(), 300)
    return () => window.clearTimeout(t)
  }, [carton, qrUrl])

  if (!carton) return <div className="p-10 text-center text-slate-500">Ładowanie etykiety…</div>

  const totalKg = carton.targetQty * carton.kgPerUnit

  return (
    <div className="min-h-screen bg-white text-black">
      <style>{`@media print { .no-print { display: none !important; } @page { margin: 8mm; } }`}</style>

      <div className="no-print sticky top-0 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link to="/office/magazyn/gotowe" className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900">
          <ArrowLeft size={14} /> Wróć
        </Link>
        <button onClick={() => window.print()} className="flex items-center gap-1.5 rounded bg-blue-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
          <Printer size={14} /> Drukuj
        </button>
      </div>

      <div className="mx-auto max-w-2xl p-8" style={{ fontFamily: 'Arial, sans-serif' }}>
        <div className="flex items-start justify-between">
          <div>
            <div className="text-xs font-bold uppercase tracking-widest text-slate-500">Karton magazynowy</div>
            <div className="font-mono text-6xl font-black leading-none">{formatCartonNo(carton.cartonNo)}</div>
          </div>
          {qrUrl && <img src={qrUrl} alt="QR kartonu" className="h-32 w-32" />}
        </div>

        <div className="mt-8 space-y-2 text-2xl font-black uppercase">
          <div>{clientDisplay(carton.clientName) || '—'}</div>
          <div>{carton.productTypeName || carton.recipeName || '—'}</div>
        </div>

        <div className="mt-6 flex items-end justify-between border-t border-slate-300 pt-4">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-600">Ilość × waga</div>
            <div className="text-3xl font-black">{carton.targetQty} × {carton.kgPerUnit} kg</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-600">Waga netto</div>
            <div className="text-3xl font-black">{totalKg.toFixed(0)} kg</div>
          </div>
        </div>
        {carton.packagingName && (
          <div className="mt-3 text-sm text-slate-600">Tuleja: <b>{carton.packagingName}</b></div>
        )}
      </div>
    </div>
  )
}
