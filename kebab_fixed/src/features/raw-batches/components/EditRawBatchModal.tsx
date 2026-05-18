/**
 * EditRawBatchModal — edycja partii ćwiartki (tylko gdy kgUsed = 0)
 */
import { useState, useEffect } from 'react'
import { Pencil } from 'lucide-react'
import type { RawBatch } from '@/types'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardDescription } from '@/components/ui/card'

export interface EditRawBatchFormData {
  supplierBatchNo: string
  slaughterDate:   string
  receivedDate:    string
  expiryDate:      string
  kgReceived:      number
  pricePerKg:      number
  invoiceNo:       string
  notes:           string
}

interface EditRawBatchModalProps {
  open:    boolean
  batch:   RawBatch | null
  loading: boolean
  error:   string | null
  onClose:  () => void
  onSubmit: (data: EditRawBatchFormData) => void
}

export function EditRawBatchModal({
  open, batch, loading, error, onClose, onSubmit,
}: EditRawBatchModalProps) {
  const [form, setForm] = useState<EditRawBatchFormData>({
    supplierBatchNo: '',
    slaughterDate:   '',
    receivedDate:    '',
    expiryDate:      '',
    kgReceived:      0,
    pricePerKg:      0,
    invoiceNo:       '',
    notes:           '',
  })

  useEffect(() => {
    if (batch && open) {
      setForm({
        supplierBatchNo: batch.supplierBatchNo ?? '',
        slaughterDate:   batch.slaughterDate   ?? '',
        receivedDate:    batch.receivedDate    ?? '',
        expiryDate:      batch.expiryDate      ?? '',
        kgReceived:      batch.kgReceived      ?? 0,
        pricePerKg:      batch.pricePerKg      ?? 0,
        invoiceNo:       batch.invoiceNo       ?? '',
        notes:           '',
      })
    }
  }, [batch, open])

  const set = (field: keyof EditRawBatchFormData, value: string | number) =>
    setForm(prev => ({ ...prev, [field]: value }))

  if (!batch) return null

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edytuj przyjęcie ćwiartki</DialogTitle>
          <DialogDescription>
            Partia <strong className="font-mono text-primary">{batch.internalBatchNo}</strong>
            {' · '}{batch.supplierName ?? '—'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Nr partii dostawcy */}
          <div className="space-y-1.5">
            <Label>Nr partii dostawcy</Label>
            <Input
              value={form.supplierBatchNo}
              onChange={e => set('supplierBatchNo', e.target.value)}
              className="font-mono"
            />
          </div>

          {/* Daty */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Data uboju</Label>
              <Input
                type="date"
                value={form.slaughterDate}
                onChange={e => set('slaughterDate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data przyjęcia</Label>
              <Input
                type="date"
                value={form.receivedDate}
                onChange={e => set('receivedDate', e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Data ważności</Label>
              <Input
                type="date"
                value={form.expiryDate}
                onChange={e => set('expiryDate', e.target.value)}
              />
            </div>
          </div>

          {/* Kg + Cena */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Kg przyjęto</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.kgReceived || ''}
                onChange={e => set('kgReceived', parseFloat(e.target.value) || 0)}
                className="font-bold text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Cena / kg (zł)</Label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={form.pricePerKg || ''}
                onChange={e => set('pricePerKg', parseFloat(e.target.value) || 0)}
                className="text-right [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
            </div>
          </div>

          {/* Nr faktury */}
          <div className="space-y-1.5">
            <Label>Nr faktury / PZ</Label>
            <Input
              value={form.invoiceNo}
              onChange={e => set('invoiceNo', e.target.value)}
              placeholder="np. PZ 739/MDU/03/2026"
            />
          </div>

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
            onClick={() => onSubmit(form)}
            disabled={loading || !form.kgReceived || form.kgReceived <= 0}
            className="gap-2"
          >
            {loading
              ? <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              : <Pencil size={14} />
            }
            Zapisz zmiany
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
