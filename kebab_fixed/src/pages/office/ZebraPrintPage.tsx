import { useEffect, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Printer, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { labelsZebraApi, zebraDesignsApi, type ZebraRenderResult } from '@/lib/api'
import { getDevices, sendZpl, probeBrowserPrint, type ZebraDevice } from '@/lib/zebra'

const TEST_ZPL = '^XA^FO50,50^A0N,40,40^FDTest Zebra^FS^XZ'

export function ZebraPrintPage() {
  const [params] = useSearchParams()
  const planLineId = params.get('planLineId') || ''
  const clientId = params.get('clientId') || ''
  const recipeId = params.get('recipeId') || ''

  const [render, setRender] = useState<ZebraRenderResult | null>(null)
  const [devices, setDevices] = useState<ZebraDevice[]>([])
  const [deviceUid, setDeviceUid] = useState('')
  const [sdkError, setSdkError] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [bpHint, setBpHint] = useState('')   // diagnostyka połączenia z BrowserPrint

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

  useEffect(() => {
    getDevices()
      .then(async ({ default: def, list }) => {
        setDevices(list); setDeviceUid(def?.uid || list[0]?.uid || '')
        // BrowserPrint załadował się, ale nie zwrócił żadnej drukarki → zdiagnozuj połączenie.
        if (list.length === 0) {
          const probe = await probeBrowserPrint()
          setBpHint(probe.ok
            ? 'Połączono z BrowserPrint, ale brak drukarki. Ustaw drukarkę w aplikacji Zebra BrowserPrint (jako domyślną).'
            : (probe.reason || ''))
        } else { setBpHint('') }
      })
      .catch((e) => setSdkError(e instanceof Error ? e.message : 'BrowserPrint niedostępny'))
  }, [])

  const device = devices.find(d => d.uid === deviceUid) || null

  async function print(zpl: string, label: string) {
    if (!device) { setMsg({ ok: false, text: 'Nie wybrano drukarki Zebra' }); return }
    setBusy(true)
    try { await sendZpl(device, zpl); setMsg({ ok: true, text: `${label} — wysłano` }) }
    catch (e) { setMsg({ ok: false, text: e instanceof Error ? e.message : 'Błąd druku' }) }
    finally { setBusy(false) }
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

        {sdkError && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
            <AlertTriangle size={18} /> {sdkError}. Zainstaluj aplikację Zebra BrowserPrint i wgraj pliki SDK do <code>public/browserprint/</code>.
          </div>
        )}

        {render && !render.ok && (
          <div className="rounded-lg border border-red-200 bg-white p-4 text-sm">
            <div className="font-bold text-red-700">{render.reason}</div>
            <Link to={`/etykiety/zebra-designer?clientId=${encodeURIComponent(clientId)}&recipeId=${encodeURIComponent(recipeId)}`}
              className="mt-2 inline-block text-ink underline">Otwórz Projektant Zebra</Link>
          </div>
        )}

        {!sdkError && (
          <div className="rounded-lg border border-slate-200 bg-white p-4 space-y-3">
            <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">Drukarka</label>
            <select value={deviceUid} onChange={e => setDeviceUid(e.target.value)} className="w-full rounded-lg border-2 border-slate-300 px-3 py-2 text-base">
              {devices.length === 0 && <option value="">— brak drukarek —</option>}
              {devices.map(d => <option key={d.uid} value={d.uid}>{d.name}</option>)}
            </select>
            {devices.length === 0 && bpHint && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
                <AlertTriangle size={16} className="mt-0.5 shrink-0" /> {bpHint}
              </div>
            )}

            <div className="flex gap-2">
              <button disabled={busy || !render?.ok} onClick={() => render?.zpl && print(render.zpl, `Druk ${render.count} szt`)}
                className="flex-1 rounded-lg bg-brand px-4 py-3 text-base font-bold text-white hover:bg-brand-dark disabled:opacity-50">
                Drukuj {render?.ok ? `(${render.count})` : ''}
              </button>
              <button disabled={busy} onClick={() => print(TEST_ZPL, 'Test druku')}
                className="rounded-lg bg-slate-200 px-4 py-3 text-base font-semibold text-slate-700">
                Test druku
              </button>
            </div>
          </div>
        )}

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
