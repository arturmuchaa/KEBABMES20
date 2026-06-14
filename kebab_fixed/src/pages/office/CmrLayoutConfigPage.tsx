/**
 * CmrLayoutConfigPage — Wizualny konfigurator pozycji pól CMR.
 * Drag & drop markerów na tle oficjalnego formularza CMR.
 * Pozwala też dodawać/usuwać własne pola tekstowe i zmieniać czcionki.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Settings, Plus, Trash2, Eye, Bold, Italic } from 'lucide-react'
import { cmrApi } from '@/lib/api'
import {
  CMR_FIELDS,
  CMR_LINE_GAP,
  CMR_FONTS,
  CMR_GOODS_ROWH,
  getGoodsRowH,
  fontCss,
  customFieldKeys,
  newCustomKey,
  mergeCmrPositions,
  type CmrPositions,
  type FieldPos,
  type FieldMeta,
} from '@/lib/cmrLayout'

// A4: 210mm × 297mm. Referencyjny piksel bazowy dla druku = 793.7px (96dpi × 210mm/25.4).
const CW = 620                          // szerokość podglądu w px
const CH = Math.round(CW * 297 / 210)   // ≈ 877 px
const SCALE = CW / 793.7                // przelicznik rozmiar-czcionki z druku → podgląd

// Przykładowe dodatkowe linie dla bloków adresowych
const BLOCK_LINE2 = 'UL. PRZYKŁADOWA 1'
const BLOCK_LINE3 = '00-000, MIASTO, KRAJ'

// ─── Marker pola ──────────────────────────────────────────────────────────────
interface MarkerProps {
  field: FieldMeta
  pos: FieldPos
  custom: boolean
  selected: boolean
  dragging: boolean
  onMouseDown: (e: React.MouseEvent, key: string) => void
  onClick: (key: string) => void
}

function FieldMarker({ field, pos, custom, selected, dragging, onMouseDown, onClick }: MarkerProps) {
  const lineGapPx = (CMR_LINE_GAP / 100) * CH
  const fontSize = pos.size * SCALE
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${pos.x}%`,
    top: `${pos.y}%`,
    cursor: dragging ? 'grabbing' : 'grab',
    fontFamily: fontCss(pos.font),
    fontSize: `${fontSize}px`,
    fontWeight: pos.bold ? 700 : 400,
    fontStyle: pos.italic ? 'italic' : 'normal',
    lineHeight: 1.1,
    textTransform: custom ? 'none' : 'uppercase',
    color: '#000',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    outline: selected ? '1.5px solid #2563eb' : custom ? '1px dashed #16a34a' : undefined,
    background: selected ? 'rgba(37,99,235,.08)' : custom ? 'rgba(22,163,74,.05)' : undefined,
    padding: '0 1px',
    zIndex: selected ? 20 : 10,
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault()
    onMouseDown(e, field.key)
  }

  return (
    <div
      style={style}
      onMouseDown={handleMouseDown}
      onClick={() => onClick(field.key)}
      title={field.label}
      className={!selected ? 'cmr-marker-hover' : ''}
    >
      {field.block ? (
        <>
          <div>{field.sample}</div>
          <div style={{ marginTop: `${lineGapPx}px` }}>{BLOCK_LINE2}</div>
          <div style={{ marginTop: `${lineGapPx}px` }}>{BLOCK_LINE3}</div>
        </>
      ) : (
        field.sample || '(puste)'
      )}
    </div>
  )
}

// ─── Strona konfiguratora ─────────────────────────────────────────────────────
export function CmrLayoutConfigPage() {
  const [positions, setPositions] = useState<CmrPositions>(() => mergeCmrPositions(null))
  const [goodsRowH, setGoodsRowH] = useState(CMR_GOODS_ROWH)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const fieldListRef = useRef<HTMLDivElement>(null)

  // Załaduj układ z backendu
  useEffect(() => {
    cmrApi.getLayout()
      .then(l => {
        setPositions(mergeCmrPositions(l))
        setGoodsRowH(getGoodsRowH(l as CmrPositions))
      })
      .catch(() => setPositions(mergeCmrPositions(null)))
  }, [])

  // Scrolla panel pól do wybranego
  useEffect(() => {
    if (!selectedKey || !fieldListRef.current) return
    const el = fieldListRef.current.querySelector(`[data-field="${selectedKey}"]`)
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }, [selectedKey])

  // ─── Drag handling ──────────────────────────────────────────────────────────
  const handleMarkerMouseDown = useCallback((e: React.MouseEvent, key: string) => {
    e.preventDefault()
    setSelectedKey(key)
    setDraggingKey(key)
  }, [])

  useEffect(() => {
    if (!draggingKey) return

    function onMouseMove(e: MouseEvent) {
      if (!canvasRef.current) return
      const rect = canvasRef.current.getBoundingClientRect()
      const x = Math.min(100, Math.max(0, ((e.clientX - rect.left) / rect.width) * 100))
      const y = Math.min(100, Math.max(0, ((e.clientY - rect.top) / rect.height) * 100))
      setPositions(prev => ({
        ...prev,
        [draggingKey]: { ...prev[draggingKey], x, y },
      }))
    }

    function onMouseUp() {
      setDraggingKey(null)
    }

    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [draggingKey])

  // ─── Modyfikacje pola ─────────────────────────────────────────────────────────
  function patch(key: string, p: Partial<FieldPos>) {
    setPositions(prev => ({ ...prev, [key]: { ...prev[key], ...p } }))
  }

  function changeSize(key: string, delta: number) {
    const cur = positions[key]
    if (!cur) return
    patch(key, { size: Math.min(24, Math.max(6, cur.size + delta)) })
  }

  function addCustomField() {
    const key = newCustomKey()
    setPositions(prev => ({
      ...prev,
      [key]: { x: 45, y: 45, size: 11, custom: true, text: 'NOWY TEKST', label: 'Pole własne' },
    }))
    setSelectedKey(key)
  }

  // Usuń pole: własne → kasuj; predefiniowane → ukryj (można przywrócić).
  function removeField(key: string) {
    const cur = positions[key]
    if (!cur) return
    if (cur.custom) {
      setPositions(prev => {
        const out = { ...prev }
        delete out[key]
        return out
      })
      setSelectedKey(null)
    } else {
      patch(key, { hidden: true })
    }
  }

  // ─── Nudge strzałkami ───────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!selectedKey) return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const arrows: Record<string, [number, number]> = {
        ArrowLeft:  [-0.1, 0],
        ArrowRight: [0.1, 0],
        ArrowUp:    [0, -0.1],
        ArrowDown:  [0, 0.1],
      }
      const delta = arrows[e.key]
      if (!delta) return
      e.preventDefault()
      setPositions(prev => {
        const cur = prev[selectedKey]
        return {
          ...prev,
          [selectedKey]: {
            ...cur,
            x: Math.min(100, Math.max(0, cur.x + delta[0])),
            y: Math.min(100, Math.max(0, cur.y + delta[1])),
          },
        }
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedKey])

  // ─── Zapis ──────────────────────────────────────────────────────────────────
  async function handleSave() {
    setSaving(true)
    try {
      await cmrApi.saveLayout({ ...positions, _goodsRowH: goodsRowH } as any)
      alert('Zapisano')
    } catch (err: any) {
      alert('Błąd zapisu: ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (window.confirm('Przywrócić domyślne pozycje pól? (usunie też pola własne)')) {
      setPositions(mergeCmrPositions(null))
      setGoodsRowH(CMR_GOODS_ROWH)
      setSelectedKey(null)
    }
  }

  // ─── Listy pól ────────────────────────────────────────────────────────────────
  const customKeys = customFieldKeys(positions)
  // Field-meta dla pola własnego (do markera i listy).
  const customMeta = (key: string): FieldMeta => ({
    key,
    label: positions[key]?.label || 'Pole własne',
    sample: positions[key]?.text || '',
  })
  // Markery na kanwie: predefiniowane nieukryte + wszystkie własne.
  const canvasMarkers: { meta: FieldMeta; custom: boolean }[] = [
    ...CMR_FIELDS.filter(f => !positions[f.key]?.hidden).map(meta => ({ meta, custom: false })),
    ...customKeys.map(k => ({ meta: customMeta(k), custom: true })),
  ]

  const selPos = selectedKey ? positions[selectedKey] : null
  const selCustom = !!selPos?.custom
  const selMeta = selectedKey
    ? (selCustom ? customMeta(selectedKey) : CMR_FIELDS.find(f => f.key === selectedKey))
    : null

  return (
    <div style={{ background: '#fff' }}>
      {/* Font-face Roboto Condensed — taki sam jak w CmrPrintPage */}
      <style>{`
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 400;
          src: url('/fonts/robotocondensed-400-latin-ext.woff2') format('woff2');
          unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 400;
          src: url('/fonts/robotocondensed-400-latin.woff2') format('woff2');
          unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 700;
          src: url('/fonts/robotocondensed-700-latin-ext.woff2') format('woff2');
          unicode-range: U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF; }
        @font-face { font-family: 'Roboto Condensed'; font-style: normal; font-weight: 700;
          src: url('/fonts/robotocondensed-700-latin.woff2') format('woff2');
          unicode-range: U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD; }
        .cmr-marker-hover:hover {
          outline: 1px dashed #94a3b8 !important;
          background: rgba(148,163,184,.06) !important;
        }
      `}</style>

      {/* Nagłówek */}
      <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-200 bg-white sticky top-0 z-30">
        <Settings size={16} className="text-gray-500" />
        <h1 className="text-sm font-semibold text-gray-800">Konfigurator CMR — pozycje pól</h1>
        <span className="text-xs text-gray-400 ml-2">Przeciągnij markery · Strzałki = ±0.1% · Kliknij = wybierz</span>
      </div>

      {/* Główny układ: lewa = kanwa, prawa = panel */}
      <div className="flex gap-4 p-4 items-start">

        {/* ── KANWA ── */}
        <div
          ref={canvasRef}
          style={{
            position: 'relative',
            width: CW,
            height: CH,
            flexShrink: 0,
            userSelect: draggingKey ? 'none' : undefined,
            cursor: draggingKey ? 'grabbing' : 'default',
            boxShadow: '0 2px 12px rgba(0,0,0,.18)',
            border: '1px solid #d1d5db',
          }}
          onMouseDown={e => {
            // kliknięcie na tło (nie marker) = odznacz
            if (e.target === canvasRef.current || (e.target as HTMLElement).tagName === 'IMG') {
              setSelectedKey(null)
            }
          }}
        >
          {/* Tło formularza CMR */}
          <img
            src="/cmr/cmr-1.png"
            alt="Formularz CMR"
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', display: 'block', pointerEvents: 'none' }}
            draggable={false}
          />

          {/* Markery pól */}
          {canvasMarkers.map(({ meta, custom }) => {
            const pos = positions[meta.key]
            if (!pos) return null
            return (
              <FieldMarker
                key={meta.key}
                field={meta}
                pos={pos}
                custom={custom}
                selected={selectedKey === meta.key}
                dragging={draggingKey === meta.key}
                onMouseDown={handleMarkerMouseDown}
                onClick={setSelectedKey}
              />
            )
          })}
        </div>

        {/* ── PANEL BOCZNY ── */}
        <div className="flex flex-col gap-3 flex-1 min-w-[240px] max-w-[300px]">

          {/* Przyciski akcji */}
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white rounded disabled:opacity-50"
            >
              {saving ? 'Zapisywanie…' : 'Zapisz'}
            </button>
            <button
              onClick={handleReset}
              className="flex-1 px-3 py-1.5 text-xs font-medium bg-gray-100 hover:bg-gray-200 text-gray-700 rounded"
            >
              Przywróć domyślne
            </button>
          </div>

          <button
            onClick={addCustomField}
            className="flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-600 hover:bg-green-700 text-white rounded"
          >
            <Plus size={14} /> Dodaj pole tekstowe
          </button>

          {/* Odstęp wierszy towarów */}
          <div className="border border-gray-200 rounded-lg p-3 text-xs space-y-1.5">
            <div className="font-semibold text-gray-700">Odstęp wierszy towarów</div>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={1.0} max={5.0} step={0.1}
                value={goodsRowH}
                onChange={e => setGoodsRowH(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="font-mono text-[12px] w-8 text-center">{goodsRowH.toFixed(1)}</span>
            </div>
            <div className="text-[10px] text-gray-400">Zapisz by zastosować na wydruku</div>
          </div>

          {/* Szczegóły wybranego pola */}
          {selectedKey && selPos && (
            <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 text-xs space-y-2">
              <div className="font-semibold text-blue-800 truncate">
                {selMeta?.label ?? selectedKey}
              </div>

              {/* Treść + etykieta — tylko pola własne */}
              {selCustom && (
                <>
                  <label className="block">
                    <span className="text-[11px] text-gray-500">Treść:</span>
                    <input
                      type="text"
                      value={selPos.text ?? ''}
                      onChange={e => patch(selectedKey, { text: e.target.value })}
                      className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]"
                      placeholder="Tekst na druku"
                    />
                  </label>
                  <label className="block">
                    <span className="text-[11px] text-gray-500">Nazwa (na liście):</span>
                    <input
                      type="text"
                      value={selPos.label ?? ''}
                      onChange={e => patch(selectedKey, { label: e.target.value })}
                      className="mt-0.5 w-full rounded border border-gray-300 px-2 py-1 text-[12px]"
                      placeholder="Pole własne"
                    />
                  </label>
                </>
              )}

              <div className="flex gap-3 text-gray-600 font-mono text-[11px]">
                <span>x: {selPos.x.toFixed(1)}%</span>
                <span>y: {selPos.y.toFixed(1)}%</span>
              </div>

              {/* Rozmiar */}
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[11px] w-12">Rozmiar:</span>
                <button
                  onClick={() => changeSize(selectedKey, -0.5)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-bold leading-none"
                >−</button>
                <span className="text-[12px] font-mono w-8 text-center">{selPos.size.toFixed(1)}</span>
                <button
                  onClick={() => changeSize(selectedKey, 0.5)}
                  className="w-6 h-6 flex items-center justify-center rounded bg-white border border-gray-300 hover:bg-gray-100 text-gray-700 text-sm font-bold leading-none"
                >+</button>
              </div>

              {/* Czcionka */}
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[11px] w-12">Czcionka:</span>
                <select
                  value={selPos.font ?? 'condensed'}
                  onChange={e => patch(selectedKey, { font: e.target.value })}
                  className="flex-1 rounded border border-gray-300 px-1.5 py-1 text-[12px] bg-white"
                >
                  {CMR_FONTS.map(f => (
                    <option key={f.key} value={f.key}>{f.label}</option>
                  ))}
                </select>
              </div>

              {/* Pogrubienie / kursywa */}
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[11px] w-12">Styl:</span>
                <button
                  onClick={() => patch(selectedKey, { bold: !selPos.bold })}
                  className={[
                    'w-7 h-7 flex items-center justify-center rounded border text-gray-700',
                    selPos.bold ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 hover:bg-gray-100',
                  ].join(' ')}
                  title="Pogrubienie"
                ><Bold size={14} /></button>
                <button
                  onClick={() => patch(selectedKey, { italic: !selPos.italic })}
                  className={[
                    'w-7 h-7 flex items-center justify-center rounded border text-gray-700',
                    selPos.italic ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-gray-300 hover:bg-gray-100',
                  ].join(' ')}
                  title="Kursywa"
                ><Italic size={14} /></button>
              </div>

              {/* Usuń / ukryj */}
              <button
                onClick={() => removeField(selectedKey)}
                className="flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-medium bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded"
              >
                <Trash2 size={13} /> {selCustom ? 'Usuń pole' : 'Ukryj pole (nie drukuj)'}
              </button>

              <div className="text-[10px] text-gray-400">Strzałki klawiatury = ±0.1%</div>
            </div>
          )}

          {/* Lista pól */}
          <div
            ref={fieldListRef}
            className="border border-gray-200 rounded-lg overflow-y-auto"
            style={{ maxHeight: CH - 220 }}
          >
            <div className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
              Pola formularza
            </div>
            {CMR_FIELDS.map(field => {
              const pos = positions[field.key]
              const isSelected = selectedKey === field.key
              const hidden = !!pos?.hidden
              return (
                <div
                  key={field.key}
                  data-field={field.key}
                  className={[
                    'flex items-center border-b border-gray-50 last:border-0',
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50',
                  ].join(' ')}
                >
                  <button
                    onClick={() => setSelectedKey(field.key)}
                    className={[
                      'flex-1 text-left px-3 py-1.5 text-xs',
                      isSelected ? 'text-blue-800 font-medium' : 'text-gray-700',
                      hidden ? 'opacity-40' : '',
                    ].join(' ')}
                  >
                    <div className="truncate">{field.label}{hidden ? ' (ukryte)' : ''}</div>
                    {pos && (
                      <div className="text-[10px] font-mono text-gray-400 mt-0.5">
                        {pos.x.toFixed(1)}% / {pos.y.toFixed(1)}% · {pos.size}px
                      </div>
                    )}
                  </button>
                  {hidden && (
                    <button
                      onClick={() => patch(field.key, { hidden: false })}
                      className="px-2 text-gray-400 hover:text-green-600"
                      title="Pokaż pole"
                    ><Eye size={14} /></button>
                  )}
                </div>
              )
            })}

            {customKeys.length > 0 && (
              <div className="px-3 py-2 text-[10px] font-semibold text-green-600 uppercase tracking-wide border-b border-t border-gray-100">
                Pola własne
              </div>
            )}
            {customKeys.map(key => {
              const pos = positions[key]
              const isSelected = selectedKey === key
              return (
                <div
                  key={key}
                  data-field={key}
                  className={[
                    'flex items-center border-b border-gray-50 last:border-0',
                    isSelected ? 'bg-blue-50' : 'hover:bg-gray-50',
                  ].join(' ')}
                >
                  <button
                    onClick={() => setSelectedKey(key)}
                    className={[
                      'flex-1 text-left px-3 py-1.5 text-xs',
                      isSelected ? 'text-blue-800 font-medium' : 'text-gray-700',
                    ].join(' ')}
                  >
                    <div className="truncate">{pos?.label || 'Pole własne'}</div>
                    <div className="text-[10px] font-mono text-gray-400 mt-0.5 truncate">
                      „{pos?.text || ''}"
                    </div>
                  </button>
                  <button
                    onClick={() => removeField(key)}
                    className="px-2 text-gray-400 hover:text-red-600"
                    title="Usuń pole"
                  ><Trash2 size={14} /></button>
                </div>
              )
            })}
          </div>

        </div>
      </div>
    </div>
  )
}
