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
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Save, Upload, ImageIcon, Tag, ZoomIn, ZoomOut } from 'lucide-react'
import QRCode from 'qrcode'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, labelTemplatesApi } from '@/lib/apiClient'
import { pdfFirstPageToPng } from '@/lib/pdfToImage'
import type { LabelFieldPos, LabelSlotOffset } from '@/lib/api'
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
  { key: 'qr',          label: 'Kod QR',           defaultSize: 20 },
  { key: 'prod_date',   label: 'Data produkcji',    defaultSize: 8  },
  { key: 'freeze_date', label: 'Zamrożone dnia',    defaultSize: 8  },
  { key: 'best_before', label: 'Należy spożyć do',  defaultSize: 8  },
  { key: 'batch_no',    label: 'Nr partii',          defaultSize: 8  },
  { key: 'weight',      label: 'Waga',               defaultSize: 10 },
]

const FIELD_COLORS: Record<string, string> = {
  qr:          '#2563eb',
  prod_date:   '#16a34a',
  freeze_date: '#0891b2',
  best_before: '#d97706',
  batch_no:    '#7c3aed',
  weight:      '#db2777',
}

// Przykładowe wartości do podglądu WYSIWYG
const SAMPLE_VALUES: Record<string, string> = {
  prod_date:   '03.06.2026',
  freeze_date: '03.06.2026',
  best_before: '03.06.2027',
  batch_no:    '030625 346',
  weight:      '50 kg',
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
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
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
  const [selectedField,   setSelectedField]   = useState<string | null>(null)
  const [pdfNote,         setPdfNote]         = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [templateLoaded,  setTemplateLoaded]  = useState(false)
  const [zoom,            setZoom]            = useState(1)
  const [sampleQrUrl,     setSampleQrUrl]     = useState('')

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
      } else {
        setBackgroundData('')
        setBackgroundPdf('')
        setFieldPositions({})
        setLabelsPerSheet(2)
        setSlotOffsets(defaultSlotOffsets(2))
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

  // Kliknięcie na podgląd — ustaw pozycję wybranego pola
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selectedField || !backgroundData) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const defaultSize = FIELDS.find(f => f.key === selectedField)?.defaultSize ?? 8
    const existing = fieldPositions[selectedField]
    setFieldPositions(prev => ({
      ...prev,
      [selectedField]: {
        x: Math.round(x * 10) / 10,
        y: Math.round(y * 10) / 10,
        size: existing?.size ?? defaultSize,
        fontFamily: existing?.fontFamily,
        bold: existing?.bold,
      },
    }))
  }

  function handleSizeChange(fieldKey: string, size: number) {
    setFieldPositions(prev => {
      if (!prev[fieldKey]) {
        return { ...prev, [fieldKey]: { x: 50, y: 50, size } }
      }
      return { ...prev, [fieldKey]: { ...prev[fieldKey], size } }
    })
  }

  function handleFontFamilyChange(fieldKey: string, fontFamily: string) {
    setFieldPositions(prev => {
      if (!prev[fieldKey]) {
        const defaultSize = FIELDS.find(f => f.key === fieldKey)?.defaultSize ?? 8
        return { ...prev, [fieldKey]: { x: 50, y: 50, size: defaultSize, fontFamily } }
      }
      return { ...prev, [fieldKey]: { ...prev[fieldKey], fontFamily } }
    })
  }

  function handleBoldChange(fieldKey: string, bold: boolean) {
    setFieldPositions(prev => {
      if (!prev[fieldKey]) {
        const defaultSize = FIELDS.find(f => f.key === fieldKey)?.defaultSize ?? 8
        return { ...prev, [fieldKey]: { x: 50, y: 50, size: defaultSize, bold } }
      }
      return { ...prev, [fieldKey]: { ...prev[fieldKey], bold } }
    })
  }

  function handleClearField(fieldKey: string) {
    setFieldPositions(prev => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
    })
  }

  // Precyzyjne dosuwanie pola o 0.1% w osi x lub y
  function handleNudge(fieldKey: string, axis: 'x' | 'y', delta: number) {
    setFieldPositions(prev => {
      const pos = prev[fieldKey]
      if (!pos) return prev
      const newVal = Math.max(0, Math.min(100, Math.round((pos[axis] + delta) * 10) / 10))
      return { ...prev, [fieldKey]: { ...pos, [axis]: newVal } }
    })
  }

  // Bezpośrednie ustawienie pozycji pola (X/Y input)
  function handlePositionChange(fieldKey: string, axis: 'x' | 'y', value: number) {
    setFieldPositions(prev => {
      const pos = prev[fieldKey]
      if (!pos) return prev
      return { ...prev, [fieldKey]: { ...pos, [axis]: value } }
    })
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
        kind: 'overlay',
        backgroundData,
        backgroundPdf,
        fieldPositions,
        pageSize: 'a4',
        labelsPerSheet,
        slotOffsets,
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
    <div className="space-y-5 animate-fade-in max-w-5xl">

      {/* Nagłówek */}
      <Card>
        <CardHeader className="flex-row items-center gap-3 space-y-0">
          <div className="w-10 h-10 rounded-xl bg-violet-50 text-violet-600 flex items-center justify-center">
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
                        <SelectItem key={c.id} value={c.name}>{c.name}</SelectItem>
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

      {isReady && (
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
                  <span className="ml-auto text-[11px] text-blue-600 font-semibold bg-blue-50 border border-blue-200 rounded-full px-3 py-0.5">
                    Wybrano: {FIELDS.find(f => f.key === selectedField)?.label} — kliknij na podgląd
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_minmax(0,600px)] gap-5">

                {/* Lista pól */}
                <div className="space-y-2 order-2 lg:order-1">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Wybierz pole → kliknij na podgląd
                  </div>
                  {FIELDS.map(f => (
                    <FieldRow
                      key={f.key}
                      fieldKey={f.key}
                      label={f.label}
                      pos={fieldPositions[f.key]}
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
                    Ustaw pola na <strong>LEWEJ etykiecie</strong> — system powieli je na pozostałe (po prawej).
                    Tło to cały arkusz A4 z wszystkimi etykietami.
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

                          {/* WYSIWYG markery pól (lewy slot) */}
                          {FIELDS.map(f => {
                            const pos = fieldPositions[f.key]
                            if (!pos) return null
                            if (f.key === 'qr') {
                              if (!sampleQrUrl) return null
                              return (
                                <WysiwygQrMarker
                                  key={f.key}
                                  pos={pos}
                                  qrDataUrl={sampleQrUrl}
                                  previewW={previewW}
                                  isSelected={selectedField === f.key}
                                  onClick={() => setSelectedField(prev => prev === f.key ? null : f.key)}
                                />
                              )
                            }
                            return (
                              <WysiwygTextMarker
                                key={f.key}
                                fieldKey={f.key}
                                pos={pos}
                                sampleText={SAMPLE_VALUES[f.key] ?? f.label}
                                previewW={previewW}
                                isSelected={selectedField === f.key}
                                onClick={() => setSelectedField(prev => prev === f.key ? null : f.key)}
                              />
                            )
                          })}

                          {/* Duchy — pozostałe sloty (i=1..labelsPerSheet-1) */}
                          {FIELDS.map(f => {
                            const pos = fieldPositions[f.key]
                            if (!pos) return null
                            return Array.from({ length: labelsPerSheet - 1 }, (_, i) => {
                              const slotIdx = i + 1
                              const ghostOffset = slotOffsets[slotIdx] ?? { dx: slotIdx * (100 / labelsPerSheet), dy: 0 }
                              if (f.key === 'qr') {
                                if (!sampleQrUrl) return null
                                return (
                                  <WysiwygQrMarker
                                    key={`${f.key}-ghost-${slotIdx}`}
                                    pos={pos}
                                    qrDataUrl={sampleQrUrl}
                                    previewW={previewW}
                                    isSelected={false}
                                    isGhost
                                    offsetX={ghostOffset.dx}
                                    offsetY={ghostOffset.dy}
                                  />
                                )
                              }
                              return (
                                <WysiwygTextMarker
                                  key={`${f.key}-ghost-${slotIdx}`}
                                  fieldKey={f.key}
                                  pos={pos}
                                  sampleText={SAMPLE_VALUES[f.key] ?? f.label}
                                  previewW={previewW}
                                  isSelected={false}
                                  isGhost
                                  offsetX={ghostOffset.dx}
                                  offsetY={ghostOffset.dy}
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
                <div className="text-[11px] text-muted-foreground bg-blue-50 border border-blue-200 rounded-lg px-3 py-1.5 mb-3">
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
                              className="text-[10px] text-blue-600 hover:underline ml-1"
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

          {/* Zapis */}
          <div className="flex items-center justify-end gap-3 pb-6">
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
  )
}
