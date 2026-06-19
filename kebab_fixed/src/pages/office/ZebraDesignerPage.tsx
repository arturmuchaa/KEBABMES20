import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { ArrowLeft, Type, QrCode, Square, Save, Printer, Trash2, LayoutTemplate, ClipboardPaste, FileDown } from 'lucide-react'
import { zebraDesignsApi, type ZebraDesign, type ZebraElement } from '@/lib/api'
import { getDevices, sendZpl, type ZebraDevice } from '@/lib/zebra'
import { LABEL_PRESETS } from '@/features/zebra/labelPresets'

const SCALE = 3 // px per mm na canvasie
const SIZES: Record<string, { w: number; h: number }> = {
  '100x150': { w: 100, h: 150 },
  '100x300': { w: 100, h: 300 },
}
const BIND = ['', '[[WAGA]]', '[[PARTIA]]', '[[DATA_PROD]]', '[[DATA_MROZ]]', '[[BEST_BEFORE]]', '[[KLIENT]]', '[[QR]]']

function uid() { return Math.random().toString(36).slice(2, 9) }

export function ZebraDesignerPage() {
  const [params] = useSearchParams()
  const recipeId = params.get('recipeId') || ''
  const [sizeKey, setSizeKey] = useState('100x150')
  const [dpi, setDpi] = useState(203)
  const [elements, setElements] = useState<ZebraElement[]>([])
  const [backgroundZpl, setBackgroundZpl] = useState('')
  const [bgImg, setBgImg] = useState('')          // podgląd tła 1:1 (Labelary PNG)
  const [bgBusy, setBgBusy] = useState(false)
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [sel, setSel] = useState<string | null>(null)
  const [devices, setDevices] = useState<ZebraDevice[]>([])
  const [deviceUid, setDeviceUid] = useState('')
  const [msg, setMsg] = useState('')
  const canvasRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)

  const size = SIZES[sizeKey] || SIZES['100x150']

  useEffect(() => {
    zebraDesignsApi.get(recipeId, sizeKey).then(r => {
      if (r.exists && r.design) {
        setElements(r.design.elements || []); setDpi(r.design.dpi || 203)
        const bg = r.design.backgroundZpl || ''
        setBackgroundZpl(bg)
        if (bg) renderBg(bg, r.design.dpi || 203)
        else setBgImg('')
      } else { setElements([]); setBackgroundZpl(''); setBgImg('') }
      setSel(null)
    }).catch(() => setElements([]))
  }, [recipeId, sizeKey])

  useEffect(() => {
    getDevices().then(({ default: d, list }) => { setDevices(list); setDeviceUid(d?.uid || list[0]?.uid || '') }).catch(() => {})
  }, [])

  function addEl(type: ZebraElement['type']) {
    const base: ZebraElement = type === 'text'
      ? { id: uid(), type, x: 5, y: 5, w: 60, fontMm: 4, align: 'L', value: 'Tekst' }
      : type === 'qr'
        ? { id: uid(), type, x: 5, y: 5, mag: 5, value: '[[QR]]' }
        : { id: uid(), type, x: 5, y: 5, w: 40, h: 15, thickMm: 0.4 }
    setElements(e => [...e, base]); setSel(base.id)
  }

  // Podgląd tła 1:1 — renderuje wklejony ZPL do obrazka przez serwis Labelary.
  async function renderBg(zpl: string, useDpi = dpi) {
    if (!zpl.trim()) { setBgImg(''); return }
    setBgBusy(true)
    try {
      const dpmm = useDpi >= 300 ? 12 : 8
      const wIn = (size.w / 25.4).toFixed(2)
      const hIn = (size.h / 25.4).toFixed(2)
      const res = await fetch(`https://api.labelary.com/v1/printers/${dpmm}dpmm/labels/${wIn}x${hIn}/0/`, {
        method: 'POST', headers: { Accept: 'image/png' }, body: zpl,
      })
      if (!res.ok) throw new Error(`Labelary ${res.status}`)
      const blob = await res.blob()
      setBgImg(URL.createObjectURL(blob))
      setMsg('Podgląd tła zaktualizowany')
    } catch (e) {
      setBgImg('')
      setMsg(e instanceof Error ? `Podgląd tła: ${e.message}` : 'Błąd podglądu tła (Labelary)')
    } finally { setBgBusy(false) }
  }

  function applyBackground() {
    setBackgroundZpl(pasteText)
    setPasteOpen(false)
    renderBg(pasteText)
  }

  async function downloadZpl() {
    const d: ZebraDesign = { recipeId, sizeKey, widthMm: size.w, heightMm: size.h, dpi, backgroundZpl, elements }
    try {
      const r = await zebraDesignsApi.renderSample(d)
      if (!r.zpl) { setMsg('Brak ZPL do pobrania'); return }
      const blob = new Blob([r.zpl], { type: 'text/plain' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `etykieta-${sizeKey}.zpl`
      a.click()
      URL.revokeObjectURL(a.href)
      setMsg('Pobrano ZPL')
    } catch (e) { setMsg(e instanceof Error ? e.message : 'Błąd pobierania ZPL') }
  }

  function loadPreset(key: string) {
    const p = LABEL_PRESETS.find(x => x.key === key)
    if (!p) return
    if (elements.length > 0 && !confirm('Zastąpić obecny układ wzorem etykiety?')) return
    setElements(p.build()); setSel(null); setMsg(`Wczytano wzór: ${p.name}`)
  }

  function update(id: string, patch: Partial<ZebraElement>) {
    setElements(e => e.map(el => el.id === id ? { ...el, ...patch } : el))
  }

  function onPointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation(); setSel(id)
    const el = elements.find(x => x.id === id); if (!el) return
    const rect = canvasRef.current!.getBoundingClientRect()
    drag.current = { id, dx: e.clientX - rect.left - el.x * SCALE, dy: e.clientY - rect.top - el.y * SCALE }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return
    const rect = canvasRef.current!.getBoundingClientRect()
    const x = Math.max(0, Math.round((e.clientX - rect.left - drag.current.dx) / SCALE))
    const y = Math.max(0, Math.round((e.clientY - rect.top - drag.current.dy) / SCALE))
    update(drag.current.id, { x, y })
  }
  function onPointerUp() { drag.current = null }

  async function save() {
    const d: ZebraDesign = { recipeId, sizeKey, widthMm: size.w, heightMm: size.h, dpi, backgroundZpl, elements }
    try { await zebraDesignsApi.save(d); setMsg('Zapisano') } catch (e) { setMsg(e instanceof Error ? e.message : 'Błąd zapisu') }
  }

  async function testPrint() {
    const d: ZebraDesign = { recipeId, sizeKey, widthMm: size.w, heightMm: size.h, dpi, backgroundZpl, elements }
    const dev = devices.find(x => x.uid === deviceUid)
    if (!dev) { setMsg('Brak drukarki Zebra (BrowserPrint)'); return }
    try { const r = await zebraDesignsApi.renderSample(d); if (r.zpl) { await sendZpl(dev, r.zpl); setMsg('Wysłano test') } }
    catch (e) { setMsg(e instanceof Error ? e.message : 'Błąd druku') }
  }

  const selEl = elements.find(e => e.id === sel) || null

  return (
    <div className="min-h-screen bg-slate-100">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b bg-white px-4 py-2">
        <Link to="/office/szablony-etykiet" className="flex items-center gap-1 text-sm font-semibold text-slate-600"><ArrowLeft size={16} /> Wstecz</Link>
        <span className="mx-2 text-sm font-bold">Projektant Zebra</span>
        <select value={sizeKey} onChange={e => setSizeKey(e.target.value)} className="rounded border px-2 py-1 text-sm">
          <option value="100x150">100×150 mm</option>
          <option value="100x300">100×300 mm</option>
        </select>
        <select value={dpi} onChange={e => setDpi(Number(e.target.value))} className="rounded border px-2 py-1 text-sm">
          <option value={203}>203 dpi</option>
          <option value={300}>300 dpi</option>
        </select>
        <select value="" onChange={e => e.target.value && loadPreset(e.target.value)}
          className="flex items-center rounded border border-violet-300 bg-violet-50 px-2 py-1 text-sm font-semibold text-violet-700"
          title="Wczytaj gotowy wzór całej etykiety">
          <option value="">📋 Wczytaj wzór…</option>
          {LABEL_PRESETS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
        </select>
        <button onClick={() => addEl('text')} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm"><Type size={14} /> Tekst</button>
        <button onClick={() => addEl('qr')} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm"><QrCode size={14} /> QR</button>
        <button onClick={() => addEl('box')} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm"><Square size={14} /> Ramka</button>
        <button onClick={() => { setPasteText(backgroundZpl); setPasteOpen(o => !o) }} className="flex items-center gap-1 rounded bg-amber-200 px-2 py-1 text-sm font-semibold text-amber-900" title="Wklej ZPL z Zebra Designer — podgląd 1:1"><ClipboardPaste size={14} /> Wklej ZPL (tło)</button>
        <button onClick={save} className="flex items-center gap-1 rounded bg-blue-600 px-3 py-1 text-sm font-semibold text-white"><Save size={14} /> Zapisz</button>
        <button onClick={downloadZpl} className="flex items-center gap-1 rounded bg-slate-200 px-2 py-1 text-sm" title="Pobierz złożony ZPL do pliku (druk USB przez Zebra Setup Utilities)"><FileDown size={14} /> Pobierz ZPL</button>
        <select value={deviceUid} onChange={e => setDeviceUid(e.target.value)} className="rounded border px-2 py-1 text-sm">
          {devices.length === 0 && <option value="">— brak drukarki —</option>}
          {devices.map(d => <option key={d.uid} value={d.uid}>{d.name}</option>)}
        </select>
        <button onClick={testPrint} className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 text-sm font-semibold text-white"><Printer size={14} /> Test druku</button>
        {msg && <span className="text-sm text-slate-600">{msg}</span>}
      </div>

      {/* Panel: wklej ZPL z Zebra Designer → podgląd tła 1:1 (Labelary) */}
      {pasteOpen && (
        <div className="border-b bg-amber-50 px-4 py-3">
          <div className="mb-1 text-xs font-semibold text-amber-900">
            Wklej ZPL z Zebra Designer (eksport „do pliku" → Notatnik → Ctrl+A, Ctrl+C). Tło renderowane 1:1; pola dynamiczne nakładasz na wierzch.
          </div>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={4}
            placeholder="^XA ... ^GFA ... ^XZ"
            className="w-full rounded border border-amber-300 px-2 py-1 font-mono text-[11px]" />
          <div className="mt-2 flex items-center gap-2">
            <button onClick={applyBackground} disabled={bgBusy}
              className="rounded bg-amber-600 px-3 py-1 text-sm font-semibold text-white disabled:opacity-50">
              {bgBusy ? 'Renderuję…' : 'Ustaw tło 1:1'}
            </button>
            <button onClick={() => { setBackgroundZpl(''); setBgImg(''); setPasteText(''); setPasteOpen(false) }}
              className="rounded bg-slate-200 px-3 py-1 text-sm">Usuń tło</button>
            <span className="text-xs text-amber-800">Wymaga internetu (Labelary). Tło zapisuje się z projektem.</span>
          </div>
        </div>
      )}

      <div className="flex gap-4 p-4">
        {/* Canvas */}
        <div
          ref={canvasRef}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerDown={() => setSel(null)}
          className="relative shrink-0 border border-slate-400 bg-white shadow"
          style={{ width: size.w * SCALE, height: size.h * SCALE }}
        >
          {/* Tło 1:1 z wklejonego ZPL (render Labelary) */}
          {bgImg && (
            <img src={bgImg} alt="tło etykiety" draggable={false}
              className="pointer-events-none absolute inset-0 h-full w-full object-contain" />
          )}
          {elements.map(el => (
            <div
              key={el.id}
              onPointerDown={e => onPointerDown(e, el.id)}
              className={`absolute cursor-move ${sel === el.id ? 'outline outline-2 outline-blue-500' : ''}`}
              style={{ left: el.x * SCALE, top: el.y * SCALE }}
            >
              {el.type === 'text' && (
                <div style={{ width: (el.w || 60) * SCALE, fontSize: (el.fontMm || 4) * SCALE, lineHeight: 1.05,
                  textAlign: el.align === 'C' ? 'center' : el.align === 'R' ? 'right' : 'left' }}>
                  {el.value || ''}
                </div>
              )}
              {el.type === 'qr' && (
                <div className="flex items-center justify-center bg-slate-800 text-[8px] text-white"
                  style={{ width: (el.mag || 5) * 6, height: (el.mag || 5) * 6 }}>QR</div>
              )}
              {el.type === 'box' && (
                <div style={{ width: (el.w || 40) * SCALE, height: (el.h || 15) * SCALE,
                  border: `${Math.max(1, (el.thickMm || 0.4) * SCALE)}px solid #111` }} />
              )}
            </div>
          ))}
        </div>

        {/* Panel właściwości */}
        <div className="w-72 shrink-0 rounded-lg border bg-white p-3 text-sm">
          {!selEl ? (
            <div className="space-y-2 text-slate-500">
              <div className="flex items-center gap-1.5 font-semibold text-violet-700"><LayoutTemplate size={15} /> Wskazówka</div>
              <div>Wczytaj gotowy wzór całej etykiety („Wczytaj wzór…" u góry), a potem poprawiaj elementy. Albo dodawaj Tekst / QR / Ramkę i przeciągaj po płótnie.</div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold uppercase">{selEl.type}</span>
                <button onClick={() => { setElements(e => e.filter(x => x.id !== selEl.id)); setSel(null) }} className="text-red-600"><Trash2 size={16} /></button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <label>X mm<input type="number" value={selEl.x} onChange={e => update(selEl.id, { x: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label>Y mm<input type="number" value={selEl.y} onChange={e => update(selEl.id, { y: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
              </div>
              {selEl.type === 'text' && (<>
                <label className="block">Szerokość mm<input type="number" value={selEl.w || 0} onChange={e => update(selEl.id, { w: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label className="block">Font mm<input type="number" value={selEl.fontMm || 0} onChange={e => update(selEl.id, { fontMm: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label className="block">Wyrównanie
                  <select value={selEl.align || 'L'} onChange={e => update(selEl.id, { align: e.target.value as any })} className="w-full rounded border px-1">
                    <option value="L">Lewo</option><option value="C">Środek</option><option value="R">Prawo</option>
                  </select></label>
                <label className="block">Treść<textarea value={selEl.value || ''} onChange={e => update(selEl.id, { value: e.target.value })} rows={3} className="w-full rounded border px-1 font-mono text-xs" /></label>
                <label className="block">Wstaw dane
                  <select value="" onChange={e => e.target.value && update(selEl.id, { value: (selEl.value || '') + e.target.value })} className="w-full rounded border px-1">
                    {BIND.map(b => <option key={b} value={b}>{b || '— wybierz —'}</option>)}
                  </select></label>
              </>)}
              {selEl.type === 'qr' && (<>
                <label className="block">Powiększenie (1–10)<input type="number" min={1} max={10} value={selEl.mag || 5} onChange={e => update(selEl.id, { mag: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                <label className="block">Dane<input value={selEl.value || ''} onChange={e => update(selEl.id, { value: e.target.value })} className="w-full rounded border px-1 font-mono text-xs" /></label>
              </>)}
              {selEl.type === 'box' && (<>
                <div className="grid grid-cols-2 gap-2">
                  <label>Szer. mm<input type="number" value={selEl.w || 0} onChange={e => update(selEl.id, { w: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                  <label>Wys. mm<input type="number" value={selEl.h || 0} onChange={e => update(selEl.id, { h: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
                </div>
                <label className="block">Grubość mm<input type="number" step="0.1" value={selEl.thickMm || 0.4} onChange={e => update(selEl.id, { thickMm: Number(e.target.value) })} className="w-full rounded border px-1" /></label>
              </>)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
