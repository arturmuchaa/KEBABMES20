/**
 * CreateRawBatchModal — shadcn/ui Dialog
 * Formularz przyjęcia ćwiartki z obsługą wielu pozycji HDI
 */
import { useState, useEffect, useMemo } from 'react'
import { fmtPln, fmtKg } from '@/lib/utils'
import { Plus, Package, Edit2, Check, X, Link2 } from 'lucide-react'
import type { CreateRawBatchDto, SupplierBatchItem } from '@/features/raw-batches/types'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Badge } from '@/components/ui/badge'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

const KG_PER_CONTAINER = 15

interface SupplierOption { value: string; label: string }

interface CreateRawBatchModalProps {
  open:              boolean
  onClose:           () => void
  onSubmit:          () => void
  form:              CreateRawBatchDto
  suggestedBatchNo:  string
  suggestedNote:     string
  expiryPreview?:    { level: string; label: string; colorCls: string } | null
  totalValue:        number
  supplierOptions:   SupplierOption[]
  loading:           boolean
  error:             string | null
  onFieldChange:     <K extends keyof CreateRawBatchDto>(key: K, value: CreateRawBatchDto[K]) => void
}

function emptyBatchItem(): SupplierBatchItem {
  const today = new Date().toISOString().slice(0, 10)
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 7)
  return { supplierBatchNo: '', kgReceived: 0, slaughterDate: today, expiryDate: expiry.toISOString().slice(0, 10) }
}

export function CreateRawBatchModal({
  open, onClose, onSubmit, form, suggestedBatchNo, expiryPreview,
  supplierOptions, loading, error, onFieldChange,
}: CreateRawBatchModalProps) {
  const [customBatchNo, setCustomBatchNo] = useState('')
  const [isEditingBatchNo, setIsEditingBatchNo] = useState(false)
  const [batchItems, setBatchItems] = useState<SupplierBatchItem[]>([emptyBatchItem()])

  useEffect(() => {
    if (suggestedBatchNo && !customBatchNo) setCustomBatchNo(suggestedBatchNo)
  }, [suggestedBatchNo])

  useEffect(() => {
    if (open) {
      setCustomBatchNo(suggestedBatchNo || '')
      setIsEditingBatchNo(false)
      setBatchItems([emptyBatchItem()])
    }
  }, [open, suggestedBatchNo])

  const totalKg       = useMemo(() => batchItems.reduce((s, i) => s + (i.kgReceived || 0), 0), [batchItems])
  const containers    = useMemo(() => Math.floor(totalKg / KG_PER_CONTAINER), [totalKg])
  const remainderKg   = useMemo(() => totalKg % KG_PER_CONTAINER, [totalKg])
  const calcValue     = useMemo(() => totalKg * (form.pricePerKg || 0), [totalKg, form.pricePerKg])
  const earliestExpiry   = useMemo(() => {
    const ds = batchItems.filter(b => b.expiryDate).map(b => b.expiryDate)
    return ds.length > 0 ? ds.sort()[0] : ''
  }, [batchItems])
  const earliestSlaughter = useMemo(() => {
    const ds = batchItems.filter(b => b.slaughterDate).map(b => b.slaughterDate)
    return ds.length > 0 ? ds.sort()[0] : ''
  }, [batchItems])

  useEffect(() => {
    onFieldChange('kgReceived', totalKg)
    onFieldChange('supplierBatches', batchItems.filter(b => b.supplierBatchNo && b.kgReceived > 0))
    const valid = batchItems.filter(b => b.supplierBatchNo)
    if (valid.length === 1) onFieldChange('supplierBatchNo', valid[0].supplierBatchNo)
    else if (valid.length > 1) onFieldChange('supplierBatchNo', valid.map(b => b.supplierBatchNo).join(', '))
    if (earliestExpiry) onFieldChange('expiryDate', earliestExpiry)
    if (earliestSlaughter) onFieldChange('slaughterDate', earliestSlaughter)
  }, [batchItems, totalKg]) // eslint-disable-line react-hooks/exhaustive-deps

  const addItem    = () => setBatchItems(p => [...p, emptyBatchItem()])
  const removeItem = (i: number) => { if (batchItems.length > 1) setBatchItems(p => p.filter((_, j) => j !== i)) }
  const updateItem = (i: number, field: keyof SupplierBatchItem, val: string | number) =>
    setBatchItems(p => p.map((it, j) => j === i ? { ...it, [field]: val } : it))

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Przyjęcie ćwiartki</DialogTitle>
          <DialogDescription>Rejestracja partii surowca z dokumentu HDI</DialogDescription>
        </DialogHeader>

        <div className="space-y-5">

          {/* Numer partii + Dostawca */}
          <div className="grid grid-cols-2 gap-4">
            {/* Numer partii */}
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3">
                <Label className="text-[10px] font-bold text-primary uppercase tracking-wide mb-1 block">
                  Nasza partia
                </Label>
                {isEditingBatchNo ? (
                  <div className="flex items-center gap-2 mt-1">
                    <Input
                      value={customBatchNo}
                      onChange={e => setCustomBatchNo(e.target.value.toUpperCase())}
                      autoFocus
                      className="font-mono font-black text-xl text-primary h-11"
                    />
                    <Button size="icon" onClick={() => setIsEditingBatchNo(false)} className="h-11 w-11">
                      <Check size={16} />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mt-1">
                    <CardTitle className="text-2xl font-black font-mono text-primary">
                      {customBatchNo || suggestedBatchNo || '—'}
                    </CardTitle>
                    <Button variant="ghost" size="icon" onClick={() => setIsEditingBatchNo(true)}
                      className="h-8 w-8 text-primary hover:bg-primary/10">
                      <Edit2 size={13} />
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Dostawca */}
            <div className="space-y-1.5">
              <Label>Dostawca *</Label>
              <Select value={form.supplierId} onValueChange={v => onFieldChange('supplierId', v)}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Wybierz dostawcę..." />
                </SelectTrigger>
                <SelectContent>
                  {supplierOptions.map(o => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <Separator />

          {/* Pozycje HDI */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Link2 size={14} className="text-muted-foreground" />
                <Label className="text-sm font-semibold">Pozycje z HDI dostawcy</Label>
                <Badge variant="secondary">{batchItems.length}</Badge>
              </div>
              <Button variant="outline" size="sm" onClick={addItem}>
                <Plus size={13} className="mr-1.5" /> Dodaj pozycję
              </Button>
            </div>

            <Card>
              <CardContent className="p-0">
                {/* Nagłówki */}
                <div className="grid grid-cols-[1fr_100px_130px_130px_40px] gap-2 px-4 py-2 border-b bg-muted/30">
                  {['Nr partii dostawcy', 'Kg', 'Data uboju', 'Data ważności', ''].map((h, i) => (
                    <CardDescription key={i} className={`text-[10px] font-bold uppercase tracking-wide ${i === 1 ? 'text-right' : ''}`}>
                      {h}
                    </CardDescription>
                  ))}
                </div>
                {/* Wiersze */}
                <div className="divide-y">
                  {batchItems.map((item, idx) => (
                    <div key={idx} className="grid grid-cols-[1fr_100px_130px_130px_40px] gap-2 px-4 py-2 items-center">
                      <Input
                        placeholder="np. 111634"
                        value={item.supplierBatchNo}
                        onChange={e => updateItem(idx, 'supplierBatchNo', e.target.value)}
                        className="h-9 font-mono font-semibold text-sm"
                      />
                      <Input
                        type="number"
                        placeholder="0"
                        step="0.01"
                        min="0"
                        value={item.kgReceived || ''}
                        onChange={e => updateItem(idx, 'kgReceived', parseFloat(e.target.value) || 0)}
                        className="h-9 text-right font-bold [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <Input
                        type="date"
                        value={item.slaughterDate}
                        onChange={e => {
                          const slaughter = e.target.value
                          const exp = slaughter
                            ? (() => { const d = new Date(slaughter); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
                            : item.expiryDate
                          setBatchItems(p => p.map((it, i) =>
                            i === idx ? { ...it, slaughterDate: slaughter, expiryDate: exp } : it
                          ))
                        }}
                        className="h-9 text-xs"
                      />
                      <Input
                        type="date"
                        value={item.expiryDate}
                        onChange={e => updateItem(idx, 'expiryDate', e.target.value)}
                        className="h-9 text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeItem(idx)}
                        disabled={batchItems.length <= 1}
                        className="h-9 w-9 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <X size={13} />
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          {/* Podsumowanie */}
          <div className="grid grid-cols-4 gap-3">
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="p-3 text-center">
                <Package size={15} className="text-primary mx-auto mb-1" />
                <CardTitle className="text-2xl font-black text-primary tabular-nums">
                  {fmtKg(totalKg, 1)}
                </CardTitle>
                <CardDescription className="text-[10px] uppercase font-bold">kg łącznie</CardDescription>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-3 text-center">
                <CardTitle className="text-2xl font-black tabular-nums">{containers}</CardTitle>
                <CardDescription className="text-[10px] uppercase font-bold">pojemników</CardDescription>
                {remainderKg > 0 && (
                  <CardDescription className="text-[10px] text-amber-600 font-bold">
                    +{fmtKg(remainderKg, 1)} reszty
                  </CardDescription>
                )}
              </CardContent>
            </Card>

            <div className="space-y-1.5">
              <Label>Cena / kg (zł)</Label>
              <Input
                type="number"
                placeholder="0.00"
                step="0.01"
                min="0"
                value={form.pricePerKg || ''}
                onChange={e => onFieldChange('pricePerKg', parseFloat(e.target.value) || 0)}
                className="h-11 text-lg font-black [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>

            <Card className="border-green-200 bg-green-50">
              <CardContent className="p-3 text-center">
                <CardTitle className="text-lg font-black text-green-700 tabular-nums">
                  {fmtPln(calcValue)}
                </CardTitle>
                <CardDescription className="text-[10px] uppercase font-bold text-green-600">wartość</CardDescription>
              </CardContent>
            </Card>
          </div>

          {/* Dodatkowe dane */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label>Data przyjęcia</Label>
              <Input
                type="date"
                value={form.receivedDate}
                onChange={e => onFieldChange('receivedDate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Nr faktury / PZ</Label>
              <Input
                type="text"
                placeholder="np. PZ 739/MDU/03/2026"
                value={form.invoiceNo ?? ''}
                onChange={e => onFieldChange('invoiceNo', e.target.value)}
              />
            </div>
          </div>

          {/* Traceability info */}
          {batchItems.filter(b => b.supplierBatchNo).length > 1 && (
            <Card className="border-primary/20 bg-primary/5">
              <CardContent className="px-4 py-3">
                <CardTitle className="text-sm text-primary mb-1">Łączenie partii dostawcy</CardTitle>
                <CardDescription className="text-sm">
                  Partia{' '}
                  <strong className="text-primary font-mono">{customBatchNo || suggestedBatchNo}</strong>
                  {' '}powstanie z połączenia{' '}
                  <strong>{batchItems.filter(b => b.supplierBatchNo).length}</strong> pozycji HDI:{' '}
                  <span className="font-mono">
                    {batchItems.filter(b => b.supplierBatchNo).map(b => b.supplierBatchNo).join(', ')}
                  </span>
                </CardDescription>
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {error && (
            <Card className="border-destructive/50 bg-destructive/5">
              <CardContent className="px-4 py-2">
                <CardDescription className="text-destructive font-medium">{error}</CardDescription>
              </CardContent>
            </Card>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Anuluj
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!form.supplierId || totalKg <= 0}
            className="gap-2"
          >
            {loading ? (
              <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <Plus size={15} />
            )}
            Przyjmij partię ({fmtKg(totalKg, 0)} kg)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
