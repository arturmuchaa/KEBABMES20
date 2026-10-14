import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { labelsZebraApi, zebraDesignsApi, type ZebraRenderResult } from '@/lib/api'
import { getDevices, sendZpl, zebraErrorMessage } from '@/lib/zebra'
import { ZebraPrinterPanel } from '@/components/ZebraPrinterPanel'

export function ZebraPrintPage() {
  const [params] = useSearchParams()
  const planLineId = params.get('planLineId') || ''
  const clientId = params.get('clientId') || ''
  const recipeId = params.get('recipeId') || ''

  const [render, setRender] = useState<ZebraRenderResult | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [printerBusy, setPrinterBusy] = useState(false)

  useEffect(() => {
    // Projekt Zebra z projektanta (per klient+receptura); rozmiar zapisany w projekcie.
    // Brak → fallback na import .prn.
    zebraDesignsApi.render(clientId, recipeId, planLineId)
      .then(r => {
        if (r.ok) { setRender(r as ZebraRenderResult); return }
        return labelsZebraApi.render(planLineId, clientId, recipeId).then(setRender)
      })
      .catch(() => labelsZebraApi.render(planLineId, clientId, recipeId).then(setRender)
        .catch(() => setRender({ ok: false, reason: 'Błąd pobierania ZPL' })))
  }, [planLineId, clientId, recipeId])

  async function print(zpl: string, label: string) {
    if (busyRef.current || printerBusy) return
    busyRef.current = true
    setBusy(true)
    try {
      const { default: device } = await getDevices()
      if (!device) throw new Error('Wybrana drukarka Zebra jest niedostępna. Odśwież listę i sprawdź USB.')
      await sendZpl(device, zpl)
      setMsg({ ok: true, text: `${label} — przekazano do BrowserPrint` })
    } catch (e) { setMsg({ ok: false, text: zebraErrorMessage(e) }) }
    finally { setBusy(false); busyRef.current = false }
  }

  function downloadZpl() {
    if (!render?.zpl) { setMsg({ ok: false, text: 'Brak ZPL do pobrania' }); return }
    const blob = new Blob([render.zpl], { type: 'text/plain' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `etykiety-${planLineId || 'zebra'}.zpl`
    a.click()
    URL.revokeObjectURL(a.href)
    setMsg({ ok: true, text: 'Pobrano ZPL — wyślij do Zebry (Zebra Setup Utilities → Send File)' })
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-xl space-y-4">
        <Link to="/office/szablony-etykiet" className="flex items-center gap-1 text-sm font-semibold text-slate-600 hover:text-slate-900">
          <ArrowLeft size={16} /> Szablony etykiet
        </Link>
        <h1 className="flex items-center gap-2 text-xl font-black"><Printer size={20} /> Druk Zebra</h1>

        <ZebraPrinterPanel defaultProfile="100x150" disabled={busy} onBusyChange={setPrinterBusy} />

        {render && !render.ok && (
          <div className="rounded-lg border border-red-200 bg-white p-4 text-sm">
            <div className="font-bold text-red-700">{render.reason}</div>
            <Link to={`/etykiety/zebra-designer?clientId=${encodeURIComponent(clientId)}&recipeId=${encodeURIComponent(recipeId)}`}
              className="mt-2 inline-block text-ink underline">Otwórz Projektant Zebra</Link>
          </div>
        )}

        <button disabled={busy || printerBusy || !render?.ok} onClick={() => render?.zpl && print(render.zpl, `Druk ${render.count} szt`)}
          className="w-full rounded-lg bg-brand px-4 py-3 text-base font-bold text-white hover:bg-brand-dark disabled:opacity-50">
          Drukuj {render?.ok ? `(${render.count})` : ''}
        </button>

        {/* Awaryjny druk USB bez BrowserPrint: pobierz ZPL i wyślij przez Zebra Setup Utilities */}
        {render?.ok && (
          <button onClick={downloadZpl}
            className="w-full rounded-lg border-2 border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Pobierz ZPL (druk USB bez BrowserPrint)
          </button>
        )}

        {msg && (
          <div className={`flex items-center gap-2 rounded-lg border-2 p-3 text-sm font-semibold ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>
            {msg.ok ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />} {msg.text}
          </div>
        )}
      </div>
    </div>
  )
}
