/**
 * CmrLayoutConfigPage — Wizualny konfigurator pozycji pól CMR.
 * Drag & drop markerów na tle oficjalnego formularza CMR.
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { Settings } from 'lucide-react'
import { cmrApi } from '@/lib/api'
import {
  CMR_FIELDS,
  CMR_LINE_GAP,
  mergeCmrPositions,
  type CmrPositions,
  type FieldPos,
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
  field: typeof CMR_FIELDS[number]
  pos: FieldPos
  selected: boolean
  dragging: boolean
  onMouseDown: (e: React.MouseEvent, key: string) => void
  onClick: (key: string) => void
}

function FieldMarker({ field, pos, selected, dragging, onMouseDown, onClick }: MarkerProps) {
  const lineGapPx = (CMR_LINE_GAP / 100) * CH
  const fontSize = pos.size * SCALE
  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${pos.x}%`,
    top: `${pos.y}%`,
    cursor: dragging ? 'grabbing' : 'grab',
    fontFamily: "'Roboto Condensed', Arial, sans-serif",
    fontSize: `${fontSize}px`,
    fontWeight: 400,
    lineHeight: 1.1,
    textTransform: 'uppercase',
    color: '#000',
    whiteSpace: 'nowrap',
    userSelect: 'none',
    outline: selected
      ? '1.5px solid #2563eb'
      : undefined,
    background: selected
      ? 'rgba(37,99,235,.08)'
      : undefined,
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
        field.sample
      )}
    </div>
  )
}

// ─── Strona konfiguratora ─────────────────────────────────────────────────────
export function CmrLayoutConfigPage() {
  const [positions, setPositions] = useState<CmrPositions>(() => mergeCmrPositions(null))
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [draggingKey, setDraggingKey] = useState<string | null>(null)

  const canvasRef = useRef<HTMLDivElement>(null)
  const fieldListRef = useRef<HTMLDivElement>(null)

  // Załaduj układ z backendu
  useEffect(() => {
    cmrApi.getLayout()
      .then(l => setPositions(mergeCmrPositions(l)))
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

  // ─── Zmiana rozmiaru ────────────────────────────────────────────────────────
  function changeSize(key: string, delta: number) {
    setPositions(prev => {
      const cur = prev[key]
      const size = Math.min(24, Math.max(6, cur.size + delta))
      return { ...prev, [key]: { ...cur, size } }
    })
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
      await cmrApi.saveLayout(positions)
      alert('Zapisano')
    } catch (err: any) {
      alert('Błąd zapisu: ' + (err?.message || err))
    } finally {
      setSaving(false)
    }
  }

  function handleReset() {
    if (window.confirm('Przywrócić domyślne pozycje pól?')) {
      setPositions(mergeCmrPositions(null))
    }
  }

  const selPos = selectedKey ? positions[selectedKey] : null

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
        <span className="text-xs text-gray-400 ml-2">Przeciągnij markery na tle formularza · Strzałki = ±0.1% · Kliknij pole = wybierz</span>
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
          {CMR_FIELDS.map(field => {
            const pos = positions[field.key]
            if (!pos) return null
            return (
              <FieldMarker
                key={field.key}
                field={field}
                pos={pos}
                selected={selectedKey === field.key}
                dragging={draggingKey === field.key}
                onMouseDown={handleMarkerMouseDown}
                onClick={setSelectedKey}
              />
            )
          })}
        </div>

        {/* ── PANEL BOCZNY ── */}
        <div className="flex flex-col gap-3 flex-1 min-w-[220px] max-w-[280px]">

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

          {/* Szczegóły wybranego pola */}
          {selectedKey && selPos && (
            <div className="border border-blue-200 rounded-lg p-3 bg-blue-50 text-xs">
              <div className="font-semibold text-blue-800 mb-2 truncate">
                {CMR_FIELDS.find(f => f.key === selectedKey)?.label ?? selectedKey}
              </div>
              <div className="flex gap-3 mb-2 text-gray-600 font-mono text-[11px]">
                <span>x: {selPos.x.toFixed(1)}%</span>
                <span>y: {selPos.y.toFixed(1)}%</span>
                <span>{selPos.size.toFixed(1)} px</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-gray-500 text-[11px]">Rozmiar:</span>
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
              <div className="mt-2 text-[10px] text-gray-400">Strzałki klawiatury = ±0.1%</div>
            </div>
          )}

          {/* Lista pól */}
          <div
            ref={fieldListRef}
            className="border border-gray-200 rounded-lg overflow-y-auto"
            style={{ maxHeight: CH - 140 }}
          >
            <div className="px-3 py-2 text-[10px] font-semibold text-gray-400 uppercase tracking-wide border-b border-gray-100">
              Pola formularza
            </div>
            {CMR_FIELDS.map(field => {
              const pos = positions[field.key]
              const isSelected = selectedKey === field.key
              return (
                <button
                  key={field.key}
                  data-field={field.key}
                  onClick={() => setSelectedKey(field.key)}
                  className={[
                    'w-full text-left px-3 py-1.5 text-xs border-b border-gray-50 last:border-0 transition-colors',
                    isSelected
                      ? 'bg-blue-50 text-blue-800 font-medium'
                      : 'hover:bg-gray-50 text-gray-700',
                  ].join(' ')}
                >
                  <div className="truncate">{field.label}</div>
                  {pos && (
                    <div className="text-[10px] font-mono text-gray-400 mt-0.5">
                      {pos.x.toFixed(1)}% / {pos.y.toFixed(1)}% · {pos.size}px
                    </div>
                  )}
                </button>
              )
            })}
          </div>

        </div>
      </div>
    </div>
  )
}
