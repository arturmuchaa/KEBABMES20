/**
 * Kartki na palety całego zamówienia — jeden wydruk zamiast klikania paleta
 * po palecie.
 *
 * Właściciel (2026-09-09): „możliwość drukowania wszystkich lub zaznaczeniu
 * wielu kartek na palety, aby nie drukować pojedynczo". Przy zamówieniu na
 * kilkanaście palet dotychczasowa ścieżka to kilkanaście otwartych okien
 * i kilkanaście potwierdzeń druku.
 *
 * `?palety=1,3,4` drukuje wskazane; brak parametru = wszystkie palety
 * zamówienia. Każda paleta wychodzi w DWÓCH kopiach, jedna za drugą —
 * magazynier zdejmuje parę z drukarki i idzie z nią do palety.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Printer } from 'lucide-react'
import QRCode from 'qrcode'

import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, orderPalletsApi } from '@/lib/apiClient'
import { useClientNames } from '@/lib/clientNames'
import { drukuj } from '@/lib/print'
import {
  CARTON_LABEL_STYLES, CartonLabelPages, KOPII_NA_PALETE,
} from '@/features/labels/CartonLabel'
import { buildCartonLabelContent, cartonLabelTotalKg } from '@/features/labels/cartonLabelLines'

/** Numery palet z `?palety=1,3,4`. Brak parametru = wszystkie (null).
 *  Śmieci w parametrze pomijamy zamiast wywracać wydruk — adres bywa
 *  sklejany ręcznie. */
export function parsePalletParam(raw: string | null): number[] | null {
  if (raw === null) return null
  const numery = raw.split(',')
    .map(s => Number(s.trim()))
    .filter(n => Number.isFinite(n) && n > 0)
  return numery
}

export function PalletLabelsBatchPrintPage() {
  const clientDisplay = useClientNames()
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const orderRes = useApi(() => clientOrdersApi.byId(id), [id])
  const palletsRes = useApi(() => orderPalletsApi.list(id), [id])
  const [qrByPallet, setQrByPallet] = useState<Record<number, string>>({})

  const order = orderRes.data
  const pallets = palletsRes.data ?? []

  const wybrane = useMemo(() => {
    const chciane = parsePalletParam(params.get('palety'))
    if (chciane === null) return pallets
    // Kolejność Z PARAMETRU, nie z listy palet: biuro zaznacza palety
    // w takiej kolejności, w jakiej stoją w chłodni.
    return chciane
      .map(nr => pallets.find(p => p.palletNo === nr))
      .filter((p): p is NonNullable<typeof p> => !!p)
  }, [pallets, params])

  const kartki = useMemo(() => {
    if (!order) return []
    const linesById = Object.fromEntries(order.lines.map(line => [line.id, line]))
    return wybrane.map(paleta => {
      const items = paleta.items.map(item => {
        const line = linesById[item.orderLineId]
        return {
          qty: item.qty,
          kgPerUnit: Number(line?.kgPerUnit ?? item.kgPerUnit ?? 0),
          recipeName: line?.recipeName ?? item.recipeName ?? '',
          packagingName: line?.packagingName ?? item.packagingName ?? '',
        }
      })
      const totalQty = items.reduce((sum, it) => sum + it.qty, 0)
      const { recipeHeader, lines } = buildCartonLabelContent(items)
      return {
        palletNo: paleta.palletNo,
        cornerNo: paleta.cartonNo || `P${paleta.palletNo}`,
        recipeHeader,
        // Paleta bez ani jednej pozycji z wagą — zostaje sama liczba sztuk,
        // żeby kartka nie wyszła pusta.
        mainLines: lines.length ? lines : [`${totalQty} SZT`],
        totalKg: cartonLabelTotalKg(items),
      }
    })
  }, [order, wybrane])

  useEffect(() => {
    document.title = order
      ? `Kartki palet — ${order.orderNo}`
      : 'Kartki palet'
  }, [order])

  useEffect(() => {
    if (!order || !kartki.length) return
    const origin = typeof window !== 'undefined' ? window.location.origin : ''
    let porzucone = false
    Promise.all(kartki.map(async k => {
      const url = `${origin}/m/p/${order.id}/${k.palletNo}`
      const dataUrl = await QRCode.toDataURL(url, {
        errorCorrectionLevel: 'Q', margin: 4, width: 480,
        color: { dark: '#000000', light: '#FFFFFF' },
      }).catch(() => '')
      return [k.palletNo, dataUrl] as const
    })).then(pary => {
      if (porzucone) return
      setQrByPallet(Object.fromEntries(pary))
    })
    return () => { porzucone = true }
  }, [order, kartki])

  // Auto-druk dopiero, gdy KAŻDA kartka ma swój kod — inaczej z drukarki
  // wychodzą palety bez QR, którego magazynier nie ma jak zeskanować.
  const qrKomplet = kartki.length > 0 && kartki.every(k => qrByPallet[k.palletNo])
  useEffect(() => {
    if (!qrKomplet) return
    const t = window.setTimeout(() => void drukuj(), 400)
    return () => window.clearTimeout(t)
  }, [qrKomplet])

  if (orderRes.loading || palletsRes.loading) {
    return <div className="p-10 text-center text-muted-foreground">Ładowanie kartek palet…</div>
  }
  if (orderRes.error || palletsRes.error) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-red-700">Nie udało się otworzyć kartek palet</div>
          <div className="text-sm text-slate-700">{orderRes.error || palletsRes.error}</div>
        </div>
      </div>
    )
  }
  if (!order || !kartki.length) {
    return (
      <div className="min-h-screen bg-slate-50 px-4 py-10">
        <div className="mx-auto max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-2 text-lg font-bold text-slate-900">Nie ma palet do wydrukowania</div>
          <div className="text-sm text-slate-700">
            Zamówienie nie ma jeszcze rozpisanych palet albo żadna z zaznaczonych już nie istnieje.
          </div>
          <div className="mt-5">
            <Link to="/office/zamowienia" className="inline-flex items-center gap-1.5 rounded bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">
              <ArrowLeft size={14} /> Wróć do zamówień
            </Link>
          </div>
        </div>
      </div>
    )
  }

  const opisPalet = kartki.map(k => k.palletNo).join(', ')
  return (
    <div className="min-h-screen bg-white text-black">
      <style>{CARTON_LABEL_STYLES}</style>

      <div className="no-print sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-slate-100 px-4 py-2">
        <Link to="/office/zamowienia" className="flex items-center gap-1.5 text-sm text-slate-700 hover:text-slate-900">
          <ArrowLeft size={14} /> Wróć do zamówień
        </Link>
        <div className="text-sm text-slate-700">
          {order.orderNo} · palety {opisPalet} · {kartki.length * KOPII_NA_PALETE} kartek
        </div>
        <button onClick={() => void drukuj()} className="flex items-center gap-1.5 rounded bg-brand px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-dark">
          <Printer size={14} /> Drukuj wszystkie
        </button>
      </div>

      {kartki.map(k => (
        <CartonLabelPages
          key={k.palletNo}
          cornerNo={k.cornerNo}
          clientName={clientDisplay(order.clientName)}
          recipeHeader={k.recipeHeader}
          mainLines={k.mainLines}
          totalKg={k.totalKg}
          footerLabel="ZAMÓWIENIE:"
          footerValue={order.orderNo}
          qrDataUrl={qrByPallet[k.palletNo] ?? ''}
          qrCaption={`${k.cornerNo} · ${order.orderNo}`}
          backTo="/office/zamowienia"
        />
      ))}
    </div>
  )
}

/**
 * Stary adres kartki pojedynczej palety (`/palety/:palletNo/druk`).
 *
 * Kartkę składa dziś jedna strona — druga implementacja tego samego wydruku
 * rozjechałaby się przy pierwszej zmianie układu, tak jak rozjechały się
 * trzy miejsca budujące nazwy pozycji WZ. Adres zostaje, żeby zakładki
 * i otwarte okna biura dalej działały.
 */
export function PalletLabelRedirect() {
  const { id = '', palletNo = '' } = useParams<{ id: string; palletNo: string }>()
  return <Navigate to={`/office/zamowienia/${id}/palety/druk?palety=${palletNo}`} replace />
}
