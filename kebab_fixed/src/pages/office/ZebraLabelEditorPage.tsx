/**
 * Edytor etykiety Zebra (Faza 1): wklej ZPL z Zebra Designer (statyczne tło) +
 * nałóż pola dynamiczne (wizualnie na obrazie podglądu) → złożony ZPL z [[KLUCZ]].
 * Zapis do label_templates (kind='zpl'); druk wsadowy ^PQ obsługuje backend.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Trash2, Printer, Save, QrCode, Type } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, labelTemplatesApi } from '@/lib/api'
import { getDevices, sendZpl, type ZebraDevice } from '@/lib/zebra'
import { composeZpl, type ZplField } from '@/features/zebra/composeZpl'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

const PLACEHOLDERS = ['PARTIA', 'DATA_PROD', 'DATA_MROZ', 'BEST_BEFORE', 'WAGA', 'NETTO', 'KLIENT', 'RECEPTURA', 'PRODUKT']
const SAMPLE: Record<string, string> = {
  PARTIA: '180626 1', DATA_PROD: '18.06.2026', DATA_MROZ: '18.06.2026',
  BEST_BEFORE: '18.06.2027', WAGA: '10KG', NETTO: '10KG', KLIENT: 'TEST',
  RECEPTURA: 'TEST', PRODUKT: 'TEST', QR: 'TEST-QR',
}
const fillSample = (zpl: string) => zpl.replace(/\[\[([A-Z_]+)\]\]/g, (_, k) => SAMPLE[k] ?? '')

let _seq = 0
const newId = () => `f${Date.now()}_${_seq++}`

export function ZebraLabelEditorPage() {
  const { data: clients } = useApi(() => clientsApi.list(), [])
  const { data: recipes } = useApi(() => recipesApi.list(), [])

  const [clientId, setClientId] = useState('')
  const [recipeId, setRecipeId] = useState('')
  const [backgroundZpl, setBackgroundZpl] = useState('')
  const [previewImg, setPreviewImg] = useState('')
  const [widthMm, setWidthMm] = useState(100)
  const [heightMm, setHeightMm] = useState(150)
  const [dpi, setDpi] = useState(203)
  const [fields, setFields] = useState<ZplField[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [devices, setDevices] = useState<ZebraDevice[]>([])
  const [deviceUid, setDeviceUid] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const boxRef = useRef<HTMLDivElement | null>(null)

  // Wczytaj istniejący szablon Zebra dla klient+receptura.
  useEffect(() => {
    if (!clientId || !recipeId) return
    labelTemplatesApi.get(clientId, recipeId).then(({ template }) => {
      const z = (template?.fieldPositions as any)?.__zebra__
      if (template?.kind === 'zpl' && z) {
        setBackgroundZpl(z.backgroundZpl ?? '')
        setFields(Array.isArray(z.fields) ? z.fields : [])
        setDpi(z.dpi ?? 203); setWidthMm(z.widthMm ?? 100); setHeightMm(z.heightMm ?? 150)
        setPreviewImg(template.backgroundData ?? '')
      } else {
        setBackgroundZpl(''); setFields([]); setPreviewImg('')
      }
    }).catch(() => {})
  }, [clientId, recipeId])

  const composed = useMemo(
    () => composeZpl({ backgroundZpl, fields, dpi }),
    [backgroundZpl, fields, dpi],
  )

  function addField(type: 'text' | 'qr', value: string) {
    const f: ZplField = type === 'qr'
      ? { id: newId(), type, value, xMm: 5, yMm: 5, mag: 4 }
      : { id: newId(), type, value, xMm: 10, yMm: 10, fontMm: 4 }
    setFields(p => [...p, f]); setSelId(f.id)
  }
  function patch(id: string, p: Partial<ZplField>) {
    setFields(prev => prev.map(f => f.id === id ? { ...f, ...p } : f))
  }
  function remove(id: string) { setFields(p => p.filter(f => f.id !== id)); if (selId === id) setSelId(null) }

  // Przeciąganie markera po obrazie → xMm/yMm.
  function onDrag(id: string, e: React.PointerEvent) {
    e.preventDefault()
    const box = boxRef.current; if (!box) return
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const move = (ev: PointerEvent) => {
      const r = box.getBoundingClientRect()
      const xMm = Math.max(0, Math.min(widthMm, ((ev.clientX - r.left) / r.width) * widthMm))
      const yMm = Math.max(0, Math.min(heightMm, ((ev.clientY - r.top) / r.height) * heightMm))
      patch(id, { xMm: Math.round(xMm * 10) / 10, yMm: Math.round(yMm * 10) / 10 })
    }
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up)
  }

  async function loadDevices() {
    try { const { list } = await getDevices(); setDevices(list); if (list[0]) setDeviceUid(list[0].uid) }
    catch (e: any) { setMsg({ ok: false, text: e?.message || 'Brak drukarki Zebra (BrowserPrint)' }) }
  }
  async function testPrint() {
    const dev = devices.find(d => d.uid === deviceUid)
    if (!dev) return setMsg({ ok: false, text: 'Wybierz drukarkę' })
    setBusy(true)
    try { await sendZpl(dev, fillSample(composed)); setMsg({ ok: true, text: 'Test wysłany na drukarkę' }) }
    catch (e: any) { setMsg({ ok: false, text: e?.message || 'Błąd druku' }) }
    finally { setBusy(false) }
  }
  async function save() {
    if (!clientId || !recipeId) return setMsg({ ok: false, text: 'Wybierz klienta i recepturę' })
    setBusy(true)
    try {
      await labelTemplatesApi.save({
        clientId, recipeId, kind: 'zpl', zpl: composed, backgroundData: previewImg,
        fieldPositions: { __zebra__: { backgroundZpl, fields, dpi, widthMm, heightMm } } as any,
      })
      setMsg({ ok: true, text: 'Szablon zapisany' })
    } catch (e: any) { setMsg({ ok: false, text: e?.message || 'Błąd zapisu' }) }
    finally { setBusy(false) }
  }

  function onImg(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return
    const r = new FileReader(); r.onload = () => setPreviewImg(String(r.result)); r.readAsDataURL(file)
  }

  const scale = 360 / widthMm
  const sel = fields.find(f => f.id === selId) || null

  return (
    <div className="min-h-screen bg-slate-50 p-4">
      <div className="mx-auto max-w-6xl space-y-3">
        <div className="flex items-center justify-between">
          <Link to="/office" className="flex items-center gap-1.5 text-sm text-slate-700"><ArrowLeft size={14} /> Wróć</Link>
          <div className="text-sm font-bold uppercase tracking-wide text-slate-700">Edytor etykiety Zebra</div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={loadDevices}>Drukarki</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={testPrint} className="gap-1"><Printer size={14} /> Test</Button>
            <Button size="sm" disabled={busy} onClick={save} className="gap-1"><Save size={14} /> Zapisz</Button>
          </div>
        </div>

        {msg && <div className={`rounded-lg border px-3 py-2 text-sm ${msg.ok ? 'border-emerald-300 bg-emerald-50 text-emerald-800' : 'border-red-300 bg-red-50 text-red-800'}`}>{msg.text}</div>}

        <div className="grid grid-cols-1 gap-3 md:grid-cols-[360px_1fr]">
          {/* Podgląd + przeciąganie */}
          <div>
            <div ref={boxRef} className="relative mx-auto overflow-hidden border border-slate-300 bg-white"
                 style={{ width: 360, height: heightMm * scale }}>
              {previewImg
                ? <img src={previewImg} alt="podgląd" className="absolute inset-0 h-full w-full object-fill" draggable={false} />
                : <div className="absolute inset-0 grid place-items-center text-xs text-slate-400">wgraj obraz podglądu</div>}
              {fields.map(f => (
                <div key={f.id}
                     onPointerDown={e => { setSelId(f.id); onDrag(f.id, e) }}
                     className={`absolute cursor-move whitespace-nowrap rounded px-1 text-[10px] font-bold ${
                       f.id === selId ? 'bg-blue-600 text-white' : 'bg-blue-500/80 text-white'}`}
                     style={{ left: f.xMm * scale, top: f.yMm * scale }}>
                  {f.type === 'qr' ? 'QR' : f.value}
                </div>
              ))}
            </div>
            <label className="mt-2 block text-xs">
              <span className="text-slate-500">Obraz podglądu (z Zebra Designer / zdjęcie)</span>
              <input type="file" accept="image/*" onChange={onImg} className="mt-1 block w-full text-xs" />
            </label>
          </div>

          {/* Panel ustawień */}
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <Field label="Klient"><Picker value={clientId} onChange={setClientId} items={clients} ph="Klient…" /></Field>
              <Field label="Receptura"><Picker value={recipeId} onChange={setRecipeId} items={recipes} ph="Receptura…" /></Field>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field label="Szer. (mm)"><Input type="number" value={widthMm} onChange={e => setWidthMm(+e.target.value || 0)} /></Field>
              <Field label="Wys. (mm)"><Input type="number" value={heightMm} onChange={e => setHeightMm(+e.target.value || 0)} /></Field>
              <Field label="DPI"><Select value={String(dpi)} onValueChange={v => setDpi(+v)}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="203">203</SelectItem><SelectItem value="300">300</SelectItem></SelectContent></Select></Field>
            </div>

            <Field label="Wklej ZPL z Zebra Designer (statyczne tło)">
              <textarea value={backgroundZpl} onChange={e => setBackgroundZpl(e.target.value)} rows={4}
                        placeholder="^XA ... ^GFA ... ^XZ" className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px]" />
            </Field>

            {/* Pola dynamiczne */}
            <div>
              <div className="mb-1 flex flex-wrap items-center gap-1.5 text-xs">
                <span className="font-semibold text-slate-600">Dodaj pole:</span>
                {PLACEHOLDERS.map(k => (
                  <button key={k} onClick={() => addField('text', `[[${k}]]`)} className="rounded bg-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-slate-300">{k}</button>
                ))}
                <button onClick={() => addField('text', 'tekst')} className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-slate-300"><Type size={11} /> tekst</button>
                <button onClick={() => addField('qr', '[[QR]]')} className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[11px] hover:bg-slate-300"><QrCode size={11} /> QR</button>
              </div>
              <div className="divide-y rounded border border-slate-200">
                {fields.length === 0 && <div className="px-2 py-3 text-center text-xs text-slate-400">Brak pól — dodaj powyżej</div>}
                {fields.map(f => (
                  <div key={f.id} onClick={() => setSelId(f.id)}
                       className={`flex items-center gap-2 px-2 py-1.5 text-xs ${f.id === selId ? 'bg-blue-50' : ''}`}>
                    {f.type === 'qr' ? <QrCode size={13} /> : <Type size={13} />}
                    <input value={f.value} onChange={e => patch(f.id, { value: e.target.value })}
                           className="min-w-0 flex-1 rounded border border-slate-200 px-1 py-0.5 font-mono text-[11px]" />
                    <span className="tabular-nums text-slate-400">x{f.xMm} y{f.yMm}</span>
                    {f.type === 'text'
                      ? <input type="number" title="wys. mm" value={f.fontMm} onChange={e => patch(f.id, { fontMm: +e.target.value || 1 })} className="w-12 rounded border border-slate-200 px-1 py-0.5 text-[11px]" />
                      : <input type="number" title="mag" value={f.mag} onChange={e => patch(f.id, { mag: +e.target.value || 1 })} className="w-12 rounded border border-slate-200 px-1 py-0.5 text-[11px]" />}
                    <button onClick={() => remove(f.id)} className="text-red-500 hover:text-red-700"><Trash2 size={13} /></button>
                  </div>
                ))}
              </div>
            </div>

            {devices.length > 0 && (
              <Field label="Drukarka Zebra">
                <Select value={deviceUid} onValueChange={setDeviceUid}>
                  <SelectTrigger className="h-9"><SelectValue placeholder="Wybierz drukarkę…" /></SelectTrigger>
                  <SelectContent>{devices.map(d => <SelectItem key={d.uid} value={d.uid}>{d.name}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}

            <Field label="Złożony ZPL (podgląd)">
              <textarea readOnly value={composed} rows={5} className="w-full rounded border border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[10px]" />
            </Field>
            {sel && <div className="text-[11px] text-slate-500">Zaznaczone: {sel.value} — przeciągnij marker na podglądzie, by ustawić pozycję.</div>}
          </div>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>{children}</label>
}
function Picker({ value, onChange, items, ph }: { value: string; onChange: (v: string) => void; items: any[] | null | undefined; ph: string }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 text-sm"><SelectValue placeholder={ph} /></SelectTrigger>
      <SelectContent>{(items ?? []).map((it: any) => <SelectItem key={it.id} value={it.id}>{it.name || it.id}</SelectItem>)}</SelectContent>
    </Select>
  )
}
