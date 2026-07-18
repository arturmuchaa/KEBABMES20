/**
 * LabelTemplateSetupPage — Konfiguracja szablonu etykiety (tło + pozycje pól)
 *
 * Workflow:
 *   1. Wybierz klienta i recepturę (lub wczytaj z query params ?clientId=&recipeId=)
 *   2. Wgraj tło etykiety (obraz PNG/JPG)
 *   3. Kliknij pole → kliknij na podgląd → ustaw pozycję
 *   4. Zapisz szablon
 */
import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Save, Upload, ImageIcon, Tag, ZoomIn, ZoomOut, ArrowLeft } from 'lucide-react'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, labelTemplatesApi } from '@/lib/apiClient'
import { pdfFirstPageToPng } from '@/lib/pdfToImage'
import type { LabelFieldPos, LabelSlotOffset, LabelPrintCalib } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ─── Stałe ─────────────────────────────────────────────────────
const FIELDS: { key: string; label: string; defaultSize: number }[] = [
  { key: 'qr',          label: 'Kod QR',           defaultSize: 25 },
  { key: 'prod_date',   label: 'Data produkcji',    defaultSize: 8  },
  { key: 'freeze_date', label: 'Zamrożone dnia',    defaultSize: 8  },
  { key: 'best_before', label: 'Należy spożyć do',  defaultSize: 8  },
  { key: 'batch_no',    label: 'Nr partii',          defaultSize: 8  },
  { key: 'weight',      label: 'Waga',               defaultSize: 10 },
  { key: 'org_code',    label: 'Kod nadzoru HALAL',  defaultSize: 8  },
]

const FIELD_COLORS: Record<string, string> = {
  qr:          '#2563eb',
  prod_date:   '#16a34a',
  freeze_date: '#0891b2',
  best_before: '#d97706',
  batch_no:    '#7c3aed',
  weight:      '#db2777',
  org_code:    '#0d9488',
}

// Przykładowe wartości do podglądu WYSIWYG
const SAMPLE_VALUES: Record<string, string> = {
  prod_date:   '03.06.2026',
  freeze_date: '03.06.2026',
  best_before: '03.06.2027',
  batch_no:    '030625 346',
  weight:      '50 kg',
  org_code:    '7J8EX',
}

// Dostępne rodziny czcionek
const FONT_FAMILIES = [
  'Arial',
  'Arial Narrow',
  'Helvetica',
  'Times New Roman',
  'Courier New',
  'Verdana',
  'Tahoma',
  'Calibri',
]

// A4 width in pt (210mm = 595.276pt)
const A4_WIDTH_PT = 595.276
// A4 width in mm
const A4_WIDTH_MM = 210

type FieldPositions = Record<string, LabelFieldPos>

// ─── WysiwygTextMarker ─────────────────────────────────────────
interface WysiwygTextMarkerProps {
  fieldKey: string
  pos: LabelFieldPos
  sampleText: string
  previewW: number
  isSelected: boolean
  isGhost?: boolean
  offsetX?: number
  offsetY?: number
  onClick?: () => void
}

function WysiwygTextMarker({
  fieldKey, pos, sampleText, previewW, isSelected, isGhost = false, offsetX = 0, offsetY = 0, onClick,
}: WysiwygTextMarkerProps) {
  const fontPx = pos.size * previewW / A4_WIDTH_PT
  const color = FIELD_COLORS[fieldKey] ?? '#666'
  const opacity = isGhost ? 0.3 : 1
  const isWeight = fieldKey === 'weight'

  // For weight: split number + " kg"
  const spaceIdx = isWeight ? sampleText.indexOf(' ') : -1
  const numberPart = isWeight && spaceIdx >= 0 ? sampleText.slice(0, spaceIdx) : sampleText
  const unitPart = isWeight && spaceIdx >= 0 ? sampleText.slice(spaceIdx) : ''

  return (
    <span
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      style={{
        position: 'absolute',
        left: `${pos.x + offsetX}%`,
        top: `${pos.y + offsetY}%`,
        fontFamily: pos.fontFamily || 'Arial',
        fontSize: `${fontPx}px`,
        lineHeight: 1.1,
        whiteSpace: 'nowrap',
        color,
        opacity,
        cursor: isGhost ? 'default' : 'pointer',
        pointerEvents: isGhost ? 'none' : 'auto',
        outline: isSelected ? `1px dashed ${color}` : 'none',
        outlineOffset: '1px',
        zIndex: isGhost ? 8 : 10,
        userSelect: 'none',
        textShadow: '0 0 3px rgba(255,255,255,0.85)',
      }}
    >
      {isWeight ? (
        <>
          <span style={{ fontWeight: pos.bold ? 700 : 400 }}>{numberPart}</span>
          {unitPart && <span style={{ fontWeight: 400 }}>{unitPart}</span>}
        </>
      ) : (
        <span style={{ fontWeight: pos.bold ? 700 : 400 }}>{sampleText}</span>
      )}
    </span>
  )
}

// ─── WysiwygQrMarker ──────────────────────────────────────────
interface WysiwygQrMarkerProps {
  pos: LabelFieldPos
  qrDataUrl: string
  previewW: number
  isSelected: boolean
  isGhost?: boolean
  offsetX?: number
  offsetY?: number
  onClick?: () => void
}

function WysiwygQrMarker({
  pos, qrDataUrl, previewW, isSelected, isGhost = false, offsetX = 0, offsetY = 0, onClick,
}: WysiwygQrMarkerProps) {
  const qrPx = pos.size / A4_WIDTH_MM * previewW
  const color = FIELD_COLORS['qr']
  const opacity = isGhost ? 0.3 : 1

  return (
    <img
      src={qrDataUrl}
      alt="QR"
      onClick={onClick ? (e) => { e.stopPropagation(); onClick() } : undefined}
      draggable={false}
      style={{
        position: 'absolute',
        left: `${pos.x + offsetX}%`,
        top: `${pos.y + offsetY}%`,
        width: `${qrPx}px`,
        height: `${qrPx}px`,
        imageRendering: 'pixelated',
        opacity,
        cursor: isGhost ? 'default' : 'pointer',
        pointerEvents: isGhost ? 'none' : 'auto',
        outline: isSelected ? `1px dashed ${color}` : 'none',
        outlineOffset: '1px',
        zIndex: isGhost ? 8 : 10,
        userSelect: 'none',
      }}
    />
  )
}

// ─── FieldRow — wiersz pola w panelu bocznym ──────────────────
interface FieldRowProps {
  fieldKey: string
  label: string
  pos: LabelFieldPos | undefined
  isSelected: boolean
  onSelect: () => void
  onSizeChange: (size: number) => void
  onFontFamilyChange: (family: string) => void
  onBoldChange: (bold: boolean) => void
  onClear: () => void
  onNudge: (fieldKey: string, axis: 'x' | 'y', delta: number) => void
  onPositionChange: (fieldKey: string, axis: 'x' | 'y', value: number) => void
}

function FieldRow({
  fieldKey, label, pos, isSelected, onSelect, onSizeChange,
  onFontFamilyChange, onBoldChange, onClear, onNudge, onPositionChange,
}: FieldRowProps) {
  const color = FIELD_COLORS[fieldKey] ?? '#666'
  const isQr = fieldKey === 'qr'
  const currentFamily = pos?.fontFamily || 'Arial'
  const currentBold = pos?.bold ?? false

  return (
    <div
      className={`flex flex-col gap-1 p-2 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-ink-4 bg-surface-3 ring-1 ring-ink-5'
          : 'border-border hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <div
          style={{ width: 10, height: 10, borderRadius: '50%', background: color, flexShrink: 0 }}
        />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-semibold truncate">{label}</div>
          {pos ? (
            <div className="text-[10px] text-muted-foreground">
              x: {pos.x.toFixed(1)}% y: {pos.y.toFixed(1)}%
            </div>
          ) : (
            <div className="text-[10px] text-amber-600 font-medium">Kliknij na podgląd →</div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0" onClick={e => e.stopPropagation()}>
          <Input
            type="number"
            min={4}
            max={60}
            value={pos?.size ?? (FIELDS.find(f => f.key === fieldKey)?.defaultSize ?? 8)}
            onChange={e => onSizeChange(Number(e.target.value))}
            className="h-6 w-14 text-[11px] px-1.5 py-0"
            title={isQr ? 'Rozmiar (mm)' : 'Rozmiar (pt)'}
          />
          <span className="text-[10px] text-muted-foreground">{isQr ? 'mm' : 'pt'}</span>
          {pos && (
            <button
              onClick={onClear}
              className="ml-1 text-muted-foreground hover:text-destructive text-[11px] font-bold leading-none px-1"
              title="Usuń pozycję"
            >
              ×
            </button>
          )}
        </div>
      </div>

      {/* Kontrolki czcionki — tylko dla pól tekstowych */}
      {!isQr && (
        <div
          className="flex items-center gap-2 pl-5"
          onClick={e => e.stopPropagation()}
        >
          <select
            value={currentFamily}
            onChange={e => onFontFamilyChange(e.target.value)}
            className="h-6 text-[10px] border border-border rounded px-1 bg-background flex-1 min-w-0"
            title="Rodzina czcionki"
          >
            {FONT_FAMILIES.map(f => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 cursor-pointer select-none shrink-0">
            <input
              type="checkbox"
              checked={currentBold}
              onChange={e => onBoldChange(e.target.checked)}
              className="w-3 h-3"
            />
            <span className="text-[10px] font-bold">B</span>
          </label>
        </div>
      )}

      {/* Nudge controls — only when selected and placed */}
      {isSelected && pos && (
        <div
          className="flex flex-col gap-1 pt-1 pl-5"
          onClick={e => e.stopPropagation()}
        >
          <div className="flex items-center gap-3">
            {/* X nudge */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-muted-foreground w-3">X</span>
              <button
                className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center leading-none"
                title="X −0.1%"
                onClick={() => onNudge(fieldKey, 'x', -0.1)}
              >◀</button>
              <span className="text-[10px] font-mono w-10 text-center select-none">{pos.x.toFixed(1)}%</span>
              <button
                className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center leading-none"
                title="X +0.1%"
                onClick={() => onNudge(fieldKey, 'x', 0.1)}
              >▶</button>
            </div>
            {/* Y nudge */}
            <div className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-muted-foreground w-3">Y</span>
              <button
                className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center leading-none"
                title="Y −0.1%"
                onClick={() => onNudge(fieldKey, 'y', -0.1)}
              >▲</button>
              <span className="text-[10px] font-mono w-10 text-center select-none">{pos.y.toFixed(1)}%</span>
              <button
                className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center leading-none"
                title="Y +0.1%"
                onClick={() => onNudge(fieldKey, 'y', 0.1)}
              >▼</button>
            </div>
          </div>
          {/* Direct X/Y numeric inputs */}
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-muted-foreground">X (%)</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={pos.x.toFixed(1)}
                onChange={e => {
                  const v = Math.round(Math.min(100, Math.max(0, Number(e.target.value))) * 10) / 10
                  onPositionChange(fieldKey, 'x', v)
                }}
                className="h-6 w-16 text-[10px] px-1.5 py-0 font-mono"
              />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-[9px] font-bold text-muted-foreground">Y (%)</span>
              <Input
                type="number"
                min={0}
                max={100}
                step={0.1}
                value={pos.y.toFixed(1)}
                onChange={e => {
                  const v = Math.round(Math.min(100, Math.max(0, Number(e.target.value))) * 10) / 10
                  onPositionChange(fieldKey, 'y', v)
                }}
                className="h-6 w-16 text-[10px] px-1.5 py-0 font-mono"
              />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Pomocnicze ─────────────────────────────────────────────────
function defaultSlotOffsets(count: number): LabelSlotOffset[] {
  return Array.from({ length: count }, (_, i) => ({ dx: i * (100 / count), dy: 0 }))
}

// ─── Strona główna ─────────────────────────────────────────────
export function LabelTemplateSetupPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const goBack = () => navigate('/office/szablony-etykiet')

  // Dane z URL
  const urlClientId  = searchParams.get('clientId')  ?? ''
  const urlRecipeId  = searchParams.get('recipeId')  ?? ''

  // Stan formularza
  const [clientId,        setClientId]        = useState(urlClientId)
  const [recipeId,        setRecipeId]        = useState(urlRecipeId)
  const [backgroundData,  setBackgroundData]  = useState('')
  const [backgroundPdf,   setBackgroundPdf]   = useState('')
  const [fieldPositions,  setFieldPositions]  = useState<FieldPositions>({})
  const [labelsPerSheet,  setLabelsPerSheet]  = useState(2)
  const [slotOffsets,     setSlotOffsets]     = useState<LabelSlotOffset[]>(() => defaultSlotOffsets(2))
  const [printCalib,      setPrintCalib]      = useState<LabelPrintCalib>({ dxMm: 0, dyMm: 0, scale: 100 })
  // Która etykieta na arkuszu jest właśnie edytowana (0 = pierwsza/bazowa).
  const [editingSlot,     setEditingSlot]     = useState(0)
  // Ręczne pozycje pól per slot 2+ (nadpisują globalny offset). { "1": { qr: {...}, ... } }
  const [slotFieldPositions, setSlotFieldPositions] = useState<Record<string, FieldPositions>>({})
  const [selectedField,   setSelectedField]   = useState<string | null>(null)
  const [pdfNote,         setPdfNote]         = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [templateLoaded,  setTemplateLoaded]  = useState(false)
  const [zoom,            setZoom]            = useState(1)
  const [sampleQrUrl,     setSampleQrUrl]     = useState('')
  const [kind,            setKind]            = useState<'overlay' | 'zpl'>('overlay')
  const [zpl,             setZpl]             = useState('')

  const previewRef = useRef<HTMLDivElement>(null)

  // Podstawowa szerokość podglądu w px — zoom mnoży tę wartość (nie scale CSS)
  const BASE_PREVIEW_WIDTH = 520

  // Szerokość podglądu w px (używana do przeliczania rozmiarów WYSIWYG)
  const previewW = BASE_PREVIEW_WIDTH * zoom

  // Wygeneruj przykładowy QR raz przy montowaniu
  useEffect(() => {
    QRCode.toDataURL('U|PODGLAD', { width: 240, margin: 0 })
      .then(url => setSampleQrUrl(url))
      .catch(() => {})
  }, [])

  // Dane list
  const { data: clients, loading: clientsLoading } = useApi(() => clientsApi.list())
  const { data: recipes, loading: recipesLoading }  = useApi(() => recipesApi.list())

  // Załaduj szablon gdy klient + receptura wybrane
  const loadTemplate = useCallback(async () => {
    if (!clientId || !recipeId) return
    setTemplateLoaded(false)
    try {
      const res = await labelTemplatesApi.get(clientId, recipeId)
      if (res.exists && res.template) {
        const tpl = res.template
        const perSheet = tpl.labelsPerSheet ?? 2
        setKind(tpl.kind === 'zpl' ? 'zpl' : 'overlay')
        setZpl(tpl.zpl ?? '')
        setBackgroundData(tpl.backgroundData ?? '')
        setBackgroundPdf(tpl.backgroundPdf ?? '')
        setFieldPositions(tpl.fieldPositions ?? {})
        setLabelsPerSheet(perSheet)
        // Użyj zapisanych offsetów lub wygeneruj domyślne
        if (tpl.slotOffsets && tpl.slotOffsets.length > 0) {
          // Upewnij się że mamy dokładnie perSheet elementów
          const loaded = tpl.slotOffsets
          if (loaded.length >= perSheet) {
            setSlotOffsets(loaded.slice(0, perSheet))
          } else {
            const defaults = defaultSlotOffsets(perSheet)
            setSlotOffsets(defaults.map((d, i) => loaded[i] ?? d))
          }
        } else {
          setSlotOffsets(defaultSlotOffsets(perSheet))
        }
        const c = tpl.printCalib ?? {}
        setPrintCalib({ dxMm: c.dxMm ?? 0, dyMm: c.dyMm ?? 0, scale: c.scale ?? 100, fit: !!c.fit, fitStretch: !!c.fitStretch })
        setSlotFieldPositions(tpl.slotFieldPositions ?? {})
        setEditingSlot(0)
      } else {
        setKind('overlay')
        setZpl('')
        setBackgroundData('')
        setBackgroundPdf('')
        setFieldPositions({})
        setLabelsPerSheet(2)
        setSlotOffsets(defaultSlotOffsets(2))
        setPrintCalib({ dxMm: 0, dyMm: 0, scale: 100 })
        setSlotFieldPositions({})
        setEditingSlot(0)
      }
    } catch {
      // Brak szablonu — to OK
    }
    setTemplateLoaded(true)
  }, [clientId, recipeId])

  useEffect(() => { loadTemplate() }, [loadTemplate])

  // Obsługa wgrania pliku
  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setPdfNote(false)
    if (file.type === 'application/pdf') {
      // Równolegle: rasteryzuj do PNG (podgląd) ORAZ zachowaj oryginalny PDF (druk wektorowy)
      const pdfDataUrlPromise = new Promise<string>((resolve) => {
        const r = new FileReader()
        r.onload = ev => resolve((ev.target?.result as string) ?? '')
        r.readAsDataURL(file)
      })
      try {
        const [png, pdfDataUrl] = await Promise.all([pdfFirstPageToPng(file), pdfDataUrlPromise])
        setBackgroundData(png)
        setBackgroundPdf(pdfDataUrl)
      } catch {
        setPdfNote(true)  // pokaż wskazówkę gdy rasteryzacja się nie uda
        // Mimo to spróbuj załadować PDF do podglądu
        const pdfDataUrl = await new Promise<string>((resolve) => {
          const r = new FileReader()
          r.onload = ev => resolve((ev.target?.result as string) ?? '')
          r.readAsDataURL(file)
        })
        setBackgroundPdf(pdfDataUrl)
      }
      return
    }
    // Obraz (PNG/JPG/WebP) — brak wektorowego PDF
    setBackgroundPdf('')
    const reader = new FileReader()
    reader.onload = ev => setBackgroundData((ev.target?.result as string) ?? '')
    reader.readAsDataURL(file)
  }

  // ── Edycja z uwzględnieniem aktywnej etykiety (slotu) ──
  // editingSlot 0 → pozycje bazowe (pierwsza etykieta). slot>0 → ręczne nadpisania
  // (slotFieldPositions), które ignorują globalny offset (do nierównych etykiet).
  const slotKey = String(editingSlot)

  // Pozycja „dziedziczona" pola na aktywnym slocie = baza + globalny offset slotu.
  function inheritedPos(fieldKey: string): LabelFieldPos | undefined {
    const base = fieldPositions[fieldKey]
    if (!base) return undefined
    if (editingSlot === 0) return base
    const off = slotOffsets[editingSlot] ?? { dx: editingSlot * (100 / labelsPerSheet), dy: 0 }
    return { ...base, x: Math.round((base.x + off.dx) * 10) / 10, y: Math.round((base.y + off.dy) * 10) / 10 }
  }

  // Czy pole ma RĘCZNE nadpisanie na aktywnym slocie (>0).
  function hasOverride(fieldKey: string): boolean {
    return editingSlot > 0 && !!slotFieldPositions[slotKey]?.[fieldKey]
  }

  // Pozycja do wyświetlenia/edycji na aktywnym slocie.
  function activePos(fieldKey: string): LabelFieldPos | undefined {
    if (editingSlot === 0) return fieldPositions[fieldKey]
    return slotFieldPositions[slotKey]?.[fieldKey] ?? inheritedPos(fieldKey)
  }

  // Zapis pozycji pola na aktywnym slocie (slot 0 → baza; slot>0 → nadpisanie).
  function writePos(fieldKey: string, next: LabelFieldPos) {
    if (editingSlot === 0) {
      setFieldPositions(prev => ({ ...prev, [fieldKey]: next }))
    } else {
      setSlotFieldPositions(prev => ({
        ...prev,
        [slotKey]: { ...(prev[slotKey] ?? {}), [fieldKey]: next },
      }))
    }
  }

  // Kliknięcie na podgląd — ustaw pozycję wybranego pola na aktywnej etykiecie
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selectedField || !backgroundData) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const defaultSize = FIELDS.find(f => f.key === selectedField)?.defaultSize ?? 8
    const existing = activePos(selectedField)
    writePos(selectedField, {
      x: Math.round(x * 10) / 10,
      y: Math.round(y * 10) / 10,
      size: existing?.size ?? defaultSize,
      fontFamily: existing?.fontFamily,
      bold: existing?.bold,
    })
  }

  function handleSizeChange(fieldKey: string, size: number) {
    const cur = activePos(fieldKey)
    if (cur) { writePos(fieldKey, { ...cur, size }); return }
    setFieldPositions(prev => ({ ...prev, [fieldKey]: { x: 50, y: 50, size } }))
  }

  function handleFontFamilyChange(fieldKey: string, fontFamily: string) {
    const cur = activePos(fieldKey)
    if (cur) { writePos(fieldKey, { ...cur, fontFamily }); return }
    const defaultSize = FIELDS.find(f => f.key === fieldKey)?.defaultSize ?? 8
    setFieldPositions(prev => ({ ...prev, [fieldKey]: { x: 50, y: 50, size: defaultSize, fontFamily } }))
  }

  function handleBoldChange(fieldKey: string, bold: boolean) {
    const cur = activePos(fieldKey)
    if (cur) { writePos(fieldKey, { ...cur, bold }); return }
    const defaultSize = FIELDS.find(f => f.key === fieldKey)?.defaultSize ?? 8
    setFieldPositions(prev => ({ ...prev, [fieldKey]: { x: 50, y: 50, size: defaultSize, bold } }))
  }

  function handleClearField(fieldKey: string) {
    if (editingSlot === 0) {
      setFieldPositions(prev => {
        const next = { ...prev }
        delete next[fieldKey]
        return next
      })
    } else {
      // slot>0 → usuń ręczne nadpisanie, wróć do dziedziczenia z globalnego offsetu
      setSlotFieldPositions(prev => {
        const slotMap = { ...(prev[slotKey] ?? {}) }
        delete slotMap[fieldKey]
        const next = { ...prev }
        if (Object.keys(slotMap).length === 0) delete next[slotKey]
        else next[slotKey] = slotMap
        return next
      })
    }
  }

  // Precyzyjne dosuwanie pola o 0.1% w osi x lub y (na aktywnym slocie)
  function handleNudge(fieldKey: string, axis: 'x' | 'y', delta: number) {
    const cur = activePos(fieldKey)
    if (!cur) return
    const newVal = Math.max(0, Math.min(100, Math.round((cur[axis] + delta) * 10) / 10))
    writePos(fieldKey, { ...cur, [axis]: newVal })
  }

  // Bezpośrednie ustawienie pozycji pola (X/Y input) na aktywnym slocie
  function handlePositionChange(fieldKey: string, axis: 'x' | 'y', value: number) {
    const cur = activePos(fieldKey)
    if (!cur) return
    writePos(fieldKey, { ...cur, [axis]: value })
  }

  async function handleSave() {
    if (!clientId || !recipeId) {
      toast.error('Wybierz klienta i recepturę')
      return
    }
    setSaving(true)
    try {
      await labelTemplatesApi.save({
        clientId,
        recipeId,
        kind,
        zpl,
        backgroundData,
        backgroundPdf,
        fieldPositions,
        pageSize: 'a4',
        labelsPerSheet,
        slotOffsets,
        printCalib,
        slotFieldPositions,
      })
      toast.success('Szablon zapisany')
    } catch (err) {
      toast.error(`Błąd zapisu: ${err instanceof Error ? err.message : 'Nieznany błąd'}`)
    } finally {
      setSaving(false)
    }
  }

  // BUG 2 FIX: clientId now holds the client NAME (Select value={c.name}),
  // so clientName === clientId; fallback to clientId is correct for both new and legacy.
  const clientName = clientId
  const recipeName = (recipes ?? []).find((r: any) => r.id === recipeId)?.name ?? recipeId
  const isReady    = Boolean(clientId && recipeId)

  return (
    <div className="min-h-screen w-full bg-slate-50 animate-fade-in">
      {/* Pasek nawigacji — zawsze widoczny, łatwy powrót do dalszej pracy */}
      <div className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur lg:px-8">
        <button
          onClick={goBack}
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          <ArrowLeft size={16} /> Szablony etykiet
        </button>
        <Button
          onClick={handleSave}
          disabled={saving || !clientId || !recipeId}
          size="sm"
          className="gap-2"
        >
          {saving
            ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            : <Save size={14} />}
          Zapisz szablon
        </Button>
      </div>

      <div className="mx-auto max-w-6xl space-y-5 px-4 py-5 lg:px-8">

      {/* Nagłówek */}
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <div className="w-10 h-10 rounded-xl bg-surface-3 text-ink-2 flex items-center justify-center">
            <Tag size={18} />
          </div>
          <div>
            <CardTitle>Konfiguracja szablonu etykiety</CardTitle>
            <CardDescription>
              Ustaw tło etykiety i pozycje pól dla kombinacji klient + receptura.
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      {/* Wybór klienta + receptury */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label className="text-xs">Klient *</Label>
              {clientsLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select
                  value={clientId || '__none'}
                  onValueChange={v => setClientId(v === '__none' ? '' : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Wybierz klienta..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— wybierz —</SelectItem>
                    {(clients ?? [])
                      .filter((c: any) => c.active !== false)
                      .map((c: any) => (
                        // BUG 2 FIX: value={c.name} — key by NAME so save and print use the same key
                        <SelectItem key={c.id} value={c.name}>{c.displayName || c.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Receptura *</Label>
              {recipesLoading ? (
                <Skeleton className="h-9 w-full" />
              ) : (
                <Select
                  value={recipeId || '__none'}
                  onValueChange={v => setRecipeId(v === '__none' ? '' : v)}
                >
                  <SelectTrigger className="h-9 text-sm">
                    <SelectValue placeholder="Wybierz recepturę..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">— wybierz —</SelectItem>
                    {(recipes ?? []).map((r: any) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {isReady && (
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground bg-muted/50 rounded-lg px-3 py-2">
              <span className="font-semibold text-foreground">{clientName}</span>
              <span>·</span>
              <span>{recipeName}</span>
              {templateLoaded && (
                <span className="ml-auto text-[11px] text-green-700 font-semibold">
                  {backgroundData ? '✓ Szablon załadowany' : 'Brak szablonu — możesz go teraz skonfigurować'}
                </span>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Typ etykiety: nakładka PDF (A4) lub Zebra (ZPL) */}
      <Card>
        <CardContent className="pt-5 space-y-3">
          <Label className="text-xs">Typ etykiety</Label>
          <div className="flex gap-2">
            <Button type="button" variant={kind === 'overlay' ? 'default' : 'outline'} size="sm" onClick={() => setKind('overlay')}>Nakładka PDF</Button>
            <Button type="button" variant={kind === 'zpl' ? 'default' : 'outline'} size="sm" onClick={() => setKind('zpl')}>Zebra (ZPL)</Button>
          </div>

          {kind === 'zpl' && (
            <div className="space-y-2">
              <input type="file" accept=".prn,.zpl,.txt" onChange={async (e) => {
                const f = e.target.files?.[0]; if (f) setZpl(await f.text())
              }} className="block text-sm" />
              <textarea value={zpl} onChange={e => setZpl(e.target.value)} rows={8}
                placeholder="Wklej lub wgraj ZPL z ZebraDesigner (.prn)…"
                className="w-full rounded-lg border-2 border-slate-300 p-2 font-mono text-xs" />
              <div className="text-[11px] text-slate-500">
                Placeholdery: <code>[[QR]] [[PARTIA]] [[DATA_PROD]] [[DATA_MROZ]] [[BEST_BEFORE]] [[WAGA]] [[NETTO]] [[KLIENT]] [[RECEPTURA]] [[PRODUKT]]</code>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {isReady && kind === 'overlay' && (
        <>
          {/* Wgranie tła */}
          <Card>
            <CardContent className="pt-5 space-y-3">
              <div className="flex items-center gap-2 mb-1">
                <ImageIcon size={15} className="text-muted-foreground" />
                <span className="text-[13px] font-semibold">Tło etykiety</span>
              </div>

              <label className="flex flex-col items-center justify-center border-2 border-dashed border-border rounded-xl p-6 cursor-pointer hover:bg-muted/30 transition-colors gap-2">
                <Upload size={22} className="text-muted-foreground" />
                <span className="text-sm text-muted-foreground">
                  Kliknij, aby wgrać obraz (PNG, JPG, WebP)
                </span>
                <span className="text-[11px] text-muted-foreground/70">lub przeciągnij plik tutaj</span>
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  className="hidden"
                  onChange={handleFileChange}
                />
              </label>

              {pdfNote && (
                <div className="text-[12px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  PDF jest obsługiwany — wgrywany jako tło (renderowana 1. strona). Jeśli etykieta to A4 z 2 sztukami, wytnij wcześniej do jednej etykiety.
                </div>
              )}

              {backgroundData && !pdfNote && (
                <div className="text-[12px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  {backgroundPdf
                    ? '✓ PDF wektorowy (ostry druk)'
                    : '⚠ tło rastrowe — druk mniej ostry'}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Panel pozycjonowania */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 mb-3">
                <Tag size={15} className="text-muted-foreground" />
                <span className="text-[13px] font-semibold">Pozycje pól</span>
                {selectedField && (
                  <span className="ml-auto text-[11px] text-ink-2 font-semibold bg-surface-3 border border-surface-4 rounded-full px-3 py-0.5">
                    Wybrano: {FIELDS.find(f => f.key === selectedField)?.label} — kliknij na podgląd
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,600px)] gap-5">

                {/* Lista pól */}
                <div className="space-y-2 order-2 lg:order-1">
                  {/* Wybór edytowanej etykiety — pozwala ustawić KAŻDE pole osobno na 2. etykiecie */}
                  {labelsPerSheet > 1 && (
                    <div className="rounded-lg border border-border bg-muted/30 p-2 mb-2">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-1.5">
                        Edytujesz etykietę
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: labelsPerSheet }, (_, s) => (
                          <button
                            key={s}
                            onClick={() => setEditingSlot(s)}
                            className={`rounded px-2.5 py-1 text-[11px] font-semibold border ${
                              editingSlot === s
                                ? 'bg-brand text-white border-brand'
                                : 'bg-background text-slate-700 border-border hover:bg-muted'
                            }`}
                          >
                            Etykieta {s + 1}
                          </button>
                        ))}
                      </div>
                      {editingSlot > 0 && (
                        <div className="text-[11px] text-muted-foreground mt-1.5">
                          Ręcznie ustawione pola na tej etykiecie mają <b>własną pozycję</b> (ignorują
                          globalny offset). „Wyczyść" pole = powrót do dziedziczenia.
                        </div>
                      )}
                    </div>
                  )}
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Wybierz pole → kliknij na podgląd
                  </div>
                  {FIELDS.map(f => (
                    <FieldRow
                      key={f.key}
                      fieldKey={f.key}
                      label={hasOverride(f.key) ? `${f.label} ✋` : f.label}
                      pos={activePos(f.key)}
                      isSelected={selectedField === f.key}
                      onSelect={() => setSelectedField(prev => prev === f.key ? null : f.key)}
                      onSizeChange={size => handleSizeChange(f.key, size)}
                      onFontFamilyChange={family => handleFontFamilyChange(f.key, family)}
                      onBoldChange={bold => handleBoldChange(f.key, bold)}
                      onClear={() => handleClearField(f.key)}
                      onNudge={handleNudge}
                      onPositionChange={handlePositionChange}
                    />
                  ))}

                  <Separator className="my-3" />

                  <div className="space-y-1.5">
                    <Label className="text-xs">Etykiet na arkuszu A4</Label>
                    <Input
                      type="number"
                      min={1}
                      max={20}
                      value={labelsPerSheet}
                      onChange={e => {
                        const n = Math.max(1, Math.min(20, Number(e.target.value)))
                        setLabelsPerSheet(n)
                        // Aktualizuj slotOffsets: zachowaj istniejące, dopełnij domyślnymi
                        setSlotOffsets(prev => {
                          const defaults = defaultSlotOffsets(n)
                          return defaults.map((d, i) => prev[i] ?? d)
                        })
                      }}
                      className="h-9 w-24 text-sm"
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Domyślnie 2 (A4 cięty na pół — format Zagros)
                    </div>
                  </div>
                </div>

                {/* Podgląd A4 z zoomem i duchami */}
                <div className="order-1 lg:order-2">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground flex-1">
                      Podgląd arkusza A4
                    </span>
                    {/* Kontrolka powiększenia */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-muted-foreground font-semibold">Powiększenie</span>
                      <button
                        className="w-6 h-6 rounded border border-border bg-background hover:bg-muted flex items-center justify-center disabled:opacity-40"
                        title="Zmniejsz"
                        disabled={zoom <= 1}
                        onClick={() => setZoom(z => Math.max(1, Math.round((z - 0.25) * 100) / 100))}
                      >
                        <ZoomOut size={12} />
                      </button>
                      <span className="text-[11px] font-mono w-8 text-center select-none">{zoom.toFixed(2)}×</span>
                      <button
                        className="w-6 h-6 rounded border border-border bg-background hover:bg-muted flex items-center justify-center disabled:opacity-40"
                        title="Powiększ"
                        disabled={zoom >= 4}
                        onClick={() => setZoom(z => Math.min(4, Math.round((z + 0.25) * 100) / 100))}
                      >
                        <ZoomIn size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Notatka pomocnicza */}
                  <div className="text-[11px] text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-2">
                    Ustaw pola na <strong>1. etykiecie</strong> — system powieli je na pozostałe.
                    Jeśli któraś etykieta jest nierówna, przełącz „Edytujesz etykietę" na 2 i ustaw
                    każde pole osobno (kliknij na podgląd) — będzie miało własną pozycję.
                  </div>

                  {/* Przewijany kontener — scroll przy zoom>1 */}
                  <div
                    style={{
                      overflow: 'auto',
                      maxHeight: '70vh',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 8,
                      background: backgroundData ? undefined : '#f8fafc',
                    }}
                  >
                    {/* Element podglądu — szerokość = BASE * zoom, wysokość wynika z aspect-ratio A4 */}
                    <div
                      ref={previewRef}
                      onClick={handlePreviewClick}
                      style={{
                        width: `${previewW}px`,
                        aspectRatio: '210 / 297',
                        position: 'relative',
                        cursor: selectedField && backgroundData ? 'crosshair' : 'default',
                        flexShrink: 0,
                      }}
                    >
                      {backgroundData ? (
                        <>
                          <img
                            src={backgroundData}
                            alt="Tło etykiety"
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'fill',
                              display: 'block',
                              userSelect: 'none',
                              pointerEvents: 'none',
                            }}
                            draggable={false}
                          />

                          {/* WYSIWYG markery pól — wszystkie sloty. Aktywna etykieta = solidne,
                              klikalne markery; pozostałe to półprzezroczyste duchy. Pola z ręcznym
                              nadpisaniem (slot>0) mają pozycję bezwzględną, reszta = baza + offset. */}
                          {Array.from({ length: labelsPerSheet }, (_, s) => {
                            const off = slotOffsets[s] ?? { dx: s * (100 / labelsPerSheet), dy: 0 }
                            const active = s === editingSlot
                            return FIELDS.map(f => {
                              const base = fieldPositions[f.key]
                              const override = slotFieldPositions[String(s)]?.[f.key]
                              const pos = s === 0
                                ? base
                                : (override ?? (base ? { ...base, x: base.x + off.dx, y: base.y + off.dy } : undefined))
                              if (!pos) return null
                              const onClick = active
                                ? () => setSelectedField(prev => prev === f.key ? null : f.key)
                                : undefined
                              if (f.key === 'qr') {
                                if (!sampleQrUrl) return null
                                return (
                                  <WysiwygQrMarker
                                    key={`${f.key}-${s}`}
                                    pos={pos}
                                    qrDataUrl={sampleQrUrl}
                                    previewW={previewW}
                                    isSelected={active && selectedField === f.key}
                                    isGhost={!active}
                                    onClick={onClick}
                                  />
                                )
                              }
                              return (
                                <WysiwygTextMarker
                                  key={`${f.key}-${s}`}
                                  fieldKey={f.key}
                                  pos={pos}
                                  sampleText={SAMPLE_VALUES[f.key] ?? f.label}
                                  previewW={previewW}
                                  isSelected={active && selectedField === f.key}
                                  isGhost={!active}
                                  onClick={onClick}
                                />
                              )
                            })
                          })}

                          {/* Instrukcja nakładki */}
                          {selectedField && (
                            <div style={{
                              position: 'absolute',
                              bottom: 0,
                              left: 0,
                              right: 0,
                              background: 'rgba(37,99,235,0.85)',
                              color: 'white',
                              fontSize: 11,
                              fontWeight: 600,
                              padding: '4px 8px',
                              pointerEvents: 'none',
                            }}>
                              Kliknij, aby ustawić pozycję: {FIELDS.find(f => f.key === selectedField)?.label}
                            </div>
                          )}
                        </>
                      ) : (
                        <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
                          <ImageIcon size={28} />
                          <span className="text-sm">Wgraj tło etykiety, aby zobaczyć podgląd</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Korekta położenia etykiet 2+ */}
          {labelsPerSheet > 1 && (
            <Card>
              <CardContent className="pt-5">
                <div className="flex items-center gap-2 mb-2">
                  <Tag size={15} className="text-muted-foreground" />
                  <span className="text-[13px] font-semibold">Korekta położenia etykiet 2+</span>
                </div>
                <div className="text-[11px] text-muted-foreground bg-surface-3 border border-surface-4 rounded-lg px-3 py-1.5 mb-3">
                  Domyślnie kolejna etykieta jest auto-przesunięta; tu możesz delikatnie skorygować jeśli tło nie jest idealnie symetryczne.
                </div>
                <div className="space-y-3">
                  {Array.from({ length: labelsPerSheet - 1 }, (_, i) => {
                    const slotIdx = i + 1
                    const offset = slotOffsets[slotIdx] ?? { dx: slotIdx * (100 / labelsPerSheet), dy: 0 }
                    const defaultOffset = { dx: slotIdx * (100 / labelsPerSheet), dy: 0 }
                    const isDirty = Math.abs(offset.dx - defaultOffset.dx) > 0.001 || Math.abs(offset.dy - defaultOffset.dy) > 0.001
                    return (
                      <div key={slotIdx} className="flex flex-col gap-1.5 p-2 rounded-lg border border-border bg-muted/20">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold">Etykieta {slotIdx + 1}</span>
                          {isDirty && (
                            <button
                              className="text-[10px] text-ink-2 hover:underline ml-1"
                              onClick={() => {
                                setSlotOffsets(prev => {
                                  const next = [...prev]
                                  next[slotIdx] = { dx: slotIdx * (100 / labelsPerSheet), dy: 0 }
                                  return next
                                })
                              }}
                            >
                              resetuj
                            </button>
                          )}
                        </div>
                        <div className="flex items-center gap-4 flex-wrap">
                          {/* X offset */}
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-muted-foreground w-4">X</span>
                            <button
                              className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center"
                              title="X −0.1%"
                              onClick={() => setSlotOffsets(prev => {
                                const next = [...prev]
                                next[slotIdx] = { ...offset, dx: Math.round((offset.dx - 0.1) * 10) / 10 }
                                return next
                              })}
                            >◀</button>
                            <Input
                              type="number"
                              step={0.1}
                              value={offset.dx.toFixed(1)}
                              onChange={e => {
                                const v = Math.round(Number(e.target.value) * 10) / 10
                                setSlotOffsets(prev => {
                                  const next = [...prev]
                                  next[slotIdx] = { ...offset, dx: v }
                                  return next
                                })
                              }}
                              className="h-6 w-20 text-[10px] px-1.5 py-0 font-mono"
                            />
                            <span className="text-[9px] text-muted-foreground">%</span>
                            <button
                              className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center"
                              title="X +0.1%"
                              onClick={() => setSlotOffsets(prev => {
                                const next = [...prev]
                                next[slotIdx] = { ...offset, dx: Math.round((offset.dx + 0.1) * 10) / 10 }
                                return next
                              })}
                            >▶</button>
                          </div>
                          {/* Y offset */}
                          <div className="flex items-center gap-1">
                            <span className="text-[10px] font-bold text-muted-foreground w-4">Y</span>
                            <button
                              className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center"
                              title="Y −0.1%"
                              onClick={() => setSlotOffsets(prev => {
                                const next = [...prev]
                                next[slotIdx] = { ...offset, dy: Math.round((offset.dy - 0.1) * 10) / 10 }
                                return next
                              })}
                            >▲</button>
                            <Input
                              type="number"
                              step={0.1}
                              value={offset.dy.toFixed(1)}
                              onChange={e => {
                                const v = Math.round(Number(e.target.value) * 10) / 10
                                setSlotOffsets(prev => {
                                  const next = [...prev]
                                  next[slotIdx] = { ...offset, dy: v }
                                  return next
                                })
                              }}
                              className="h-6 w-20 text-[10px] px-1.5 py-0 font-mono"
                            />
                            <span className="text-[9px] text-muted-foreground">%</span>
                            <button
                              className="w-5 h-5 rounded border border-border bg-background hover:bg-muted text-[10px] font-bold flex items-center justify-center"
                              title="Y +0.1%"
                              onClick={() => setSlotOffsets(prev => {
                                const next = [...prev]
                                next[slotIdx] = { ...offset, dy: Math.round((offset.dy + 0.1) * 10) / 10 }
                                return next
                              })}
                            >▼</button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Kalibracja druku — kompensacja ucinanego paska */}
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 mb-2">
                <Tag size={15} className="text-muted-foreground" />
                <span className="text-[13px] font-semibold">Kalibracja druku (ucinany pasek / marginesy)</span>
              </div>
              <div className="text-[11px] text-muted-foreground bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 mb-3">
                Jeśli drukarka ucina pasek z brzegu — przesuń całą etykietę (tło + pola razem)
                do środka. <b>X+</b> = w prawo, <b>Y+</b> = w dół (w mm). <b>Skala</b>: 98% gdy treść
                się nie mieści, &gt;100% gdy chcesz powiększyć etykietę i wypełnić arkusz. Działa dla
                druku PDF i obrazu.
              </div>
              <div className="flex items-center gap-5 flex-wrap">
                {/* Przesunięcie X w mm */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-muted-foreground">Przesuń X</span>
                  <Input
                    type="number" step={0.5}
                    value={printCalib.dxMm ?? 0}
                    onChange={e => setPrintCalib(p => ({ ...p, dxMm: Math.round(Number(e.target.value) * 10) / 10 }))}
                    className="h-7 w-20 text-[11px] px-1.5 py-0 font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">mm</span>
                </div>
                {/* Przesunięcie Y w mm */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-muted-foreground">Przesuń Y</span>
                  <Input
                    type="number" step={0.5}
                    value={printCalib.dyMm ?? 0}
                    onChange={e => setPrintCalib(p => ({ ...p, dyMm: Math.round(Number(e.target.value) * 10) / 10 }))}
                    className="h-7 w-20 text-[11px] px-1.5 py-0 font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">mm</span>
                </div>
                {/* Skala */}
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-bold text-muted-foreground">Skala</span>
                  <Input
                    type="number" step={0.5} min={50} max={130}
                    value={printCalib.scale ?? 100}
                    onChange={e => setPrintCalib(p => ({ ...p, scale: Math.round(Number(e.target.value) * 10) / 10 }))}
                    className="h-7 w-20 text-[11px] px-1.5 py-0 font-mono"
                  />
                  <span className="text-[10px] text-muted-foreground">%</span>
                </div>
                {(printCalib.dxMm || printCalib.dyMm || (printCalib.scale ?? 100) !== 100) ? (
                  <button
                    className="text-[10px] text-ink-2 hover:underline"
                    onClick={() => setPrintCalib(p => ({ dxMm: 0, dyMm: 0, scale: 100, fit: p.fit, fitStretch: p.fitStretch }))}
                  >resetuj</button>
                ) : null}
              </div>
              {/* Dopasowanie tła do A4 — usuwa puste marginesy gdy źródłowy PDF nie jest pełnym A4 */}
              <label className="flex items-start gap-2 mt-3 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={!!printCalib.fit}
                  onChange={e => setPrintCalib(p => ({ ...p, fit: e.target.checked }))}
                />
                <span className="text-[12px] text-slate-700">
                  <b>Dopasuj tło do A4 (przytnij białe marginesy)</b> — wykrywa rzeczywistą treść
                  etykiety i przybliża ją do brzegów (bez deformacji). Dotyczy tła PDF.
                </span>
              </label>
              {printCalib.fit && (
                <label className="flex items-start gap-2 mt-2 ml-6 cursor-pointer">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={!!printCalib.fitStretch}
                    onChange={e => setPrintCalib(p => ({ ...p, fitStretch: e.target.checked }))}
                  />
                  <span className="text-[12px] text-slate-700">
                    <b>Rozciągnij na całą wysokość (usuń pasek u dołu)</b> — wypełnia cały arkusz;
                    dopuszcza lekkie pionowe rozciągnięcie etykiety. QR zostaje kwadratowy.
                  </span>
                </label>
              )}
            </CardContent>
          </Card>

          {/* Zapis */}
          <div className="flex items-center justify-end gap-3 pb-6">
            <Button variant="outline" onClick={goBack} className="gap-2">
              <ArrowLeft size={14} /> Wstecz
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !clientId || !recipeId}
              className="gap-2"
            >
              {saving
                ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                : <Save size={14} />
              }
              Zapisz szablon
            </Button>
          </div>
        </>
      )}
      </div>
    </div>
  )
}
