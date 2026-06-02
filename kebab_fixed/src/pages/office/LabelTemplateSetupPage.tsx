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
import { Save, Upload, ImageIcon, Tag } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { clientsApi, recipesApi, labelTemplatesApi } from '@/lib/apiClient'
import type { LabelFieldPos } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Separator } from '@/components/ui/separator'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

// ─── Typy ──────────────────────────────────────────────────────
const FIELDS: { key: string; label: string; defaultSize: number }[] = [
  { key: 'qr',          label: 'Kod QR',           defaultSize: 20 },
  { key: 'prod_date',   label: 'Data produkcji',    defaultSize: 8  },
  { key: 'freeze_date', label: 'Zamrożone dnia',    defaultSize: 8  },
  { key: 'best_before', label: 'Należy spożyć do',  defaultSize: 8  },
  { key: 'batch_no',    label: 'Nr partii',          defaultSize: 8  },
]

const FIELD_COLORS: Record<string, string> = {
  qr:          '#2563eb',
  prod_date:   '#16a34a',
  freeze_date: '#0891b2',
  best_before: '#d97706',
  batch_no:    '#7c3aed',
}

type FieldPositions = Record<string, LabelFieldPos>

// ─── FieldMarker — znacznik na podglądzie ──────────────────────
interface FieldMarkerProps {
  fieldKey: string
  label: string
  pos: LabelFieldPos
  isSelected: boolean
  onClick: () => void
}

function FieldMarker({ fieldKey, label, pos, isSelected, onClick }: FieldMarkerProps) {
  const color = FIELD_COLORS[fieldKey] ?? '#666'
  return (
    <div
      onClick={e => { e.stopPropagation(); onClick() }}
      style={{
        position: 'absolute',
        left: `${pos.x}%`,
        top: `${pos.y}%`,
        transform: 'translate(-50%, -50%)',
        cursor: 'pointer',
        zIndex: 10,
      }}
    >
      <div
        style={{
          width: isSelected ? 16 : 12,
          height: isSelected ? 16 : 12,
          borderRadius: '50%',
          background: color,
          border: isSelected ? '2px solid white' : '1.5px solid white',
          boxShadow: isSelected ? `0 0 0 2px ${color}` : `0 1px 3px rgba(0,0,0,0.4)`,
          transition: 'all 0.15s ease',
        }}
      />
      <div
        style={{
          position: 'absolute',
          top: '100%',
          left: '50%',
          transform: 'translateX(-50%)',
          marginTop: 2,
          fontSize: 9,
          fontWeight: 700,
          color,
          whiteSpace: 'nowrap',
          background: 'rgba(255,255,255,0.9)',
          padding: '1px 3px',
          borderRadius: 3,
          pointerEvents: 'none',
        }}
      >
        {label}
      </div>
    </div>
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
  onClear: () => void
}

function FieldRow({ fieldKey, label, pos, isSelected, onSelect, onSizeChange, onClear }: FieldRowProps) {
  const color = FIELD_COLORS[fieldKey] ?? '#666'
  return (
    <div
      className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-all ${
        isSelected
          ? 'border-blue-400 bg-blue-50 ring-1 ring-blue-300'
          : 'border-border hover:bg-muted/50'
      }`}
      onClick={onSelect}
    >
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
          title="Rozmiar (pt)"
        />
        <span className="text-[10px] text-muted-foreground">pt</span>
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
  )
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
  const [fieldPositions,  setFieldPositions]  = useState<FieldPositions>({})
  const [labelsPerSheet,  setLabelsPerSheet]  = useState(2)
  const [selectedField,   setSelectedField]   = useState<string | null>(null)
  const [pdfNote,         setPdfNote]         = useState(false)
  const [saving,          setSaving]          = useState(false)
  const [templateLoaded,  setTemplateLoaded]  = useState(false)

  const previewRef = useRef<HTMLDivElement>(null)

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
        setBackgroundData(res.template.backgroundData ?? '')
        setFieldPositions(res.template.fieldPositions ?? {})
        setLabelsPerSheet(res.template.labelsPerSheet ?? 2)
      } else {
        setBackgroundData('')
        setFieldPositions({})
        setLabelsPerSheet(2)
      }
    } catch {
      // Brak szablonu — to OK
    }
    setTemplateLoaded(true)
  }, [clientId, recipeId])

  useEffect(() => { loadTemplate() }, [loadTemplate])

  // Obsługa wgrania pliku
  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (file.type === 'application/pdf') {
      setPdfNote(true)
      setBackgroundData('')
      return
    }

    setPdfNote(false)
    const reader = new FileReader()
    reader.onload = ev => {
      setBackgroundData(ev.target?.result as string ?? '')
    }
    reader.readAsDataURL(file)
  }

  // Kliknięcie na podgląd — ustaw pozycję wybranego pola
  function handlePreviewClick(e: React.MouseEvent<HTMLDivElement>) {
    if (!selectedField || !backgroundData) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    const defaultSize = FIELDS.find(f => f.key === selectedField)?.defaultSize ?? 8
    const existingSize = fieldPositions[selectedField]?.size ?? defaultSize
    setFieldPositions(prev => ({
      ...prev,
      [selectedField]: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, size: existingSize },
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

  function handleClearField(fieldKey: string) {
    setFieldPositions(prev => {
      const next = { ...prev }
      delete next[fieldKey]
      return next
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
        fieldPositions,
        pageSize: 'a4',
        labelsPerSheet,
      })
      toast.success('Szablon zapisany')
    } catch (err) {
      toast.error(`Błąd zapisu: ${err instanceof Error ? err.message : 'Nieznany błąd'}`)
    } finally {
      setSaving(false)
    }
  }

  const clientName = (clients ?? []).find((c: any) => c.id === clientId)?.name ?? clientId
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
                        <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
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
                  Dla PDF wyeksportuj stronę jako PNG/JPG i wgraj obraz. Rasteryzacja PDF nie jest obsługiwana.
                </div>
              )}

              {backgroundData && !pdfNote && (
                <div className="text-[12px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-1.5">
                  ✓ Tło wgrane
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

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-5">

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
                      onClear={() => handleClearField(f.key)}
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
                      onChange={e => setLabelsPerSheet(Number(e.target.value))}
                      className="h-9 w-24 text-sm"
                    />
                    <div className="text-[11px] text-muted-foreground">
                      Domyślnie 2 (A4 cięty na pół — format Zagros)
                    </div>
                  </div>
                </div>

                {/* Podgląd */}
                <div className="order-1 lg:order-2">
                  <div className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground mb-2">
                    Podgląd etykiety
                  </div>
                  <div
                    ref={previewRef}
                    onClick={handlePreviewClick}
                    style={{
                      width: 360,
                      position: 'relative',
                      border: '1.5px solid #e2e8f0',
                      borderRadius: 8,
                      overflow: 'hidden',
                      cursor: selectedField && backgroundData ? 'crosshair' : 'default',
                      minHeight: backgroundData ? undefined : 180,
                      background: backgroundData ? undefined : '#f8fafc',
                    }}
                  >
                    {backgroundData ? (
                      <>
                        <img
                          src={backgroundData}
                          alt="Tło etykiety"
                          style={{ width: '100%', display: 'block', userSelect: 'none', pointerEvents: 'none' }}
                          draggable={false}
                        />
                        {/* Markery pól */}
                        {FIELDS.map(f => {
                          const pos = fieldPositions[f.key]
                          if (!pos) return null
                          return (
                            <FieldMarker
                              key={f.key}
                              fieldKey={f.key}
                              label={f.label}
                              pos={pos}
                              isSelected={selectedField === f.key}
                              onClick={() => setSelectedField(prev => prev === f.key ? null : f.key)}
                            />
                          )
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
                      <div className="flex flex-col items-center justify-center h-44 gap-2 text-muted-foreground">
                        <ImageIcon size={28} />
                        <span className="text-sm">Wgraj tło etykiety, aby zobaczyć podgląd</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

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
