/**
 * CreateRawBatchModal
 *
 * Formularz przyjęcia ćwiartki z możliwością łączenia wielu partii dostawcy:
 * - Dodawanie pozycji z HDI (nr partii, kg, data uboju, data ważności)
 * - Łączenie wielu pozycji w jedną naszą partię
 * - Pełna traceability - śledzenie z jakiej partii dostawcy pochodzi mięso
 */
import { useState, useEffect, useMemo } from 'react'
import { Modal } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtPln, fmtKg } from '@/lib/utils'
import { Plus, Package, Edit2, Check, Trash2, X, Link2 } from 'lucide-react'
import type { CreateRawBatchDto, SupplierBatchItem } from '@/features/raw-batches/types'

const KG_PER_CONTAINER = 15 // kg na pojemnik

interface SupplierOption {
  value: string
  label: string
}

interface CreateRawBatchModalProps {
  open:            boolean
  onClose:         () => void
  onSubmit:        () => void
  form:            CreateRawBatchDto
  suggestedBatchNo: string
  suggestedNote:    string
  expiryPreview?:   { level: string; label: string; colorCls: string } | null
  totalValue:      number
  supplierOptions: SupplierOption[]
  loading:         boolean
  error:           string | null
  onFieldChange:   <K extends keyof CreateRawBatchDto>(key: K, value: CreateRawBatchDto[K]) => void
}

// Pusty wiersz pozycji HDI
function emptyBatchItem(): SupplierBatchItem {
  const today = new Date().toISOString().slice(0, 10)
  const expiry = new Date()
  expiry.setDate(expiry.getDate() + 7)
  return {
    supplierBatchNo: '',
    kgReceived: 0,
    slaughterDate: today,
    expiryDate: expiry.toISOString().slice(0, 10),
  }
}

export function CreateRawBatchModal({
  open,
  onClose,
  onSubmit,
  form,
  suggestedBatchNo,
  suggestedNote,
  expiryPreview,
  totalValue,
  supplierOptions,
  loading,
  error,
  onFieldChange,
}: CreateRawBatchModalProps) {
  const [customBatchNo, setCustomBatchNo] = useState('')
  const [isEditingBatchNo, setIsEditingBatchNo] = useState(false)
  
  // Lista pozycji z HDI dostawcy
  const [batchItems, setBatchItems] = useState<SupplierBatchItem[]>([emptyBatchItem()])

  // Sync suggested batch number
  useEffect(() => {
    if (suggestedBatchNo && !customBatchNo) {
      setCustomBatchNo(suggestedBatchNo)
    }
  }, [suggestedBatchNo])

  // Reset when modal opens
  useEffect(() => {
    if (open) {
      setCustomBatchNo(suggestedBatchNo || '')
      setIsEditingBatchNo(false)
      setBatchItems([emptyBatchItem()])
    }
  }, [open, suggestedBatchNo])

  // Oblicz sumy
  const totalKg = useMemo(() => 
    batchItems.reduce((sum, item) => sum + (item.kgReceived || 0), 0)
  , [batchItems])

  const containers = useMemo(() => Math.floor(totalKg / KG_PER_CONTAINER), [totalKg])
  const remainderKg = useMemo(() => totalKg % KG_PER_CONTAINER, [totalKg])
  const calculatedValue = useMemo(() => totalKg * (form.pricePerKg || 0), [totalKg, form.pricePerKg])

  // Najwcześniejsza data ważności (FEFO)
  const earliestExpiry = useMemo(() => {
    const dates = batchItems.filter(b => b.expiryDate).map(b => b.expiryDate)
    return dates.length > 0 ? dates.sort()[0] : ''
  }, [batchItems])

  // Najwcześniejsza data uboju
  const earliestSlaughter = useMemo(() => {
    const dates = batchItems.filter(b => b.slaughterDate).map(b => b.slaughterDate)
    return dates.length > 0 ? dates.sort()[0] : ''
  }, [batchItems])

  // Aktualizuj form gdy zmieniają się pozycje
  useEffect(() => {
    onFieldChange('kgReceived', totalKg)
    onFieldChange('supplierBatches', batchItems.filter(b => b.supplierBatchNo && b.kgReceived > 0))
    
    // Ustaw główny numer partii dostawcy
    const validItems = batchItems.filter(b => b.supplierBatchNo)
    if (validItems.length === 1) {
      onFieldChange('supplierBatchNo', validItems[0].supplierBatchNo)
    } else if (validItems.length > 1) {
      onFieldChange('supplierBatchNo', validItems.map(b => b.supplierBatchNo).join(', '))
    }
    
    // Ustaw daty — każda zmiana pozycji propaguje aktualną wartość
    // earliestExpiry — najwcześniejsza data ważności (FEFO)
    if (earliestExpiry) onFieldChange('expiryDate', earliestExpiry)
    // earliestSlaughter — najwcześniejsza data uboju (zawsze propaguj, nie blokuj)
    if (earliestSlaughter) onFieldChange('slaughterDate', earliestSlaughter)
  }, [batchItems, totalKg]) // eslint-disable-line react-hooks/exhaustive-deps

  // Dodaj nową pozycję
  const addBatchItem = () => {
    setBatchItems([...batchItems, emptyBatchItem()])
  }

  // Usuń pozycję
  const removeBatchItem = (index: number) => {
    if (batchItems.length > 1) {
      setBatchItems(batchItems.filter((_, i) => i !== index))
    }
  }

  // Aktualizuj pozycję
  const updateBatchItem = (index: number, field: keyof SupplierBatchItem, value: string | number) => {
    setBatchItems(batchItems.map((item, i) => 
      i === index ? { ...item, [field]: value } : item
    ))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Przyjęcie ćwiartki"
      subtitle="Rejestracja partii surowca z dokumentu HDI"
      size="xl"
      preventClose
    >
      <div className="space-y-4">
        {/* NAGŁÓWEK: Nr partii + Dostawca */}
        <div className="grid grid-cols-2 gap-4">
          {/* Numer partii */}
          <div className="bg-brand-light border border-brand-border rounded-xl p-3">
            <div className="text-[10px] font-bold text-brand uppercase tracking-wide mb-1">
              Nasza partia
            </div>
            {isEditingBatchNo ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={customBatchNo}
                  onChange={e => setCustomBatchNo(e.target.value.toUpperCase())}
                  autoFocus
                  className="flex-1 h-10 px-3 text-xl font-black font-mono text-brand rounded-lg border-2 border-brand bg-white focus:outline-none"
                />
                <button
                  onClick={() => setIsEditingBatchNo(false)}
                  className="h-10 w-10 rounded-lg bg-brand text-white flex items-center justify-center"
                >
                  <Check size={18} />
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-2xl font-black font-mono text-brand">
                  {customBatchNo || suggestedBatchNo || '—'}
                </span>
                <button
                  onClick={() => setIsEditingBatchNo(true)}
                  className="p-2 rounded-lg hover:bg-brand/10 text-brand"
                  title="Zmień numer"
                >
                  <Edit2 size={14} />
                </button>
              </div>
            )}
          </div>

          {/* Dostawca */}
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">
              Dostawca *
            </label>
            <select
              value={form.supplierId}
              onChange={e => onFieldChange('supplierId', e.target.value)}
              className="w-full h-12 px-3 text-sm font-medium rounded-xl border-2 border-surface-4 bg-white focus:outline-none focus:border-brand"
            >
              <option value="">Wybierz dostawcę...</option>
              {supplierOptions.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* POZYCJE Z HDI */}
        <div className="border-2 border-surface-4 rounded-xl overflow-hidden">
          <div className="bg-surface-2 px-4 py-2 flex items-center justify-between border-b border-surface-4">
            <div className="flex items-center gap-2">
              <Link2 size={14} className="text-ink-3" />
              <span className="text-xs font-bold text-ink-3 uppercase tracking-wide">
                Pozycje z HDI dostawcy
              </span>
              <span className="text-xs text-ink-4">
                ({batchItems.length} {batchItems.length === 1 ? 'pozycja' : 'pozycji'})
              </span>
            </div>
            <button
              onClick={addBatchItem}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-brand text-white text-xs font-bold hover:bg-brand-dark transition-colors"
            >
              <Plus size={12} />
              Dodaj pozycję
            </button>
          </div>

          {/* Nagłówki tabeli */}
          <div className="grid grid-cols-[1fr_100px_120px_120px_40px] gap-2 px-4 py-2 bg-surface-2 text-[10px] font-bold text-ink-3 uppercase tracking-wide border-b border-surface-4">
            <span>Nr partii dostawcy</span>
            <span className="text-right">Kg</span>
            <span>Data uboju</span>
            <span>Data ważności</span>
            <span></span>
          </div>

          {/* Wiersze */}
          <div className="divide-y divide-slate-100">
            {batchItems.map((item, index) => (
              <div key={index} className="grid grid-cols-[1fr_100px_120px_120px_40px] gap-2 px-4 py-2 items-center">
                <input
                  type="text"
                  placeholder="np. 111634"
                  value={item.supplierBatchNo}
                  onChange={e => updateBatchItem(index, 'supplierBatchNo', e.target.value)}
                  className="h-9 px-3 text-sm font-mono font-semibold rounded-lg border border-surface-4 focus:outline-none focus:border-brand"
                />
                <input
                  type="number"
                  placeholder="0"
                  step="0.01"
                  min="0"
                  value={item.kgReceived || ''}
                  onChange={e => updateBatchItem(index, 'kgReceived', parseFloat(e.target.value) || 0)}
                  className="h-9 px-3 text-sm font-bold text-right rounded-lg border border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <input
                  type="date"
                  value={item.slaughterDate}
                  onChange={e => {
                    const slaughter = e.target.value
                    const expiry = slaughter
                      ? (() => { const d = new Date(slaughter); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10) })()
                      : item.expiryDate
                    // Jeden setState — obie daty razem, bez race condition
                    setBatchItems(prev => prev.map((it, i) =>
                      i === index ? { ...it, slaughterDate: slaughter, expiryDate: expiry } : it
                    ))
                  }}
                  className="h-9 px-2 text-xs rounded-lg border border-surface-4 focus:outline-none focus:border-brand"
                />
                <input
                  type="date"
                  value={item.expiryDate}
                  onChange={e => updateBatchItem(index, 'expiryDate', e.target.value)}
                  className="h-9 px-2 text-xs rounded-lg border border-surface-4 focus:outline-none focus:border-brand"
                />
                <button
                  onClick={() => removeBatchItem(index)}
                  disabled={batchItems.length <= 1}
                  className="h-9 w-9 rounded-lg flex items-center justify-center text-ink-4 hover:text-danger hover:bg-danger-light disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* PODSUMOWANIE */}
        <div className="grid grid-cols-4 gap-3">
          <div className="bg-brand-light border border-brand-border rounded-xl p-3 text-center">
            <Package size={16} className="text-brand mx-auto mb-1" />
            <div className="text-2xl font-black text-brand">{fmtKg(totalKg, 1)}</div>
            <div className="text-[9px] font-bold text-ink-3 uppercase">kg łącznie</div>
          </div>
          
          <div className="bg-surface-2 border border-surface-4 rounded-xl p-3 text-center">
            <div className="text-2xl font-black text-ink">{containers}</div>
            <div className="text-[9px] font-bold text-ink-3 uppercase">pojemników</div>
            {remainderKg > 0 && (
              <div className="text-[9px] text-warn font-bold">+{fmtKg(remainderKg,1)} reszty</div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">
              Cena / kg (zł)
            </label>
            <input
              type="number"
              placeholder="0.00"
              step="0.01"
              min="0"
              value={form.pricePerKg || ''}
              onChange={e => onFieldChange('pricePerKg', parseFloat(e.target.value) || 0)}
              className="w-full h-12 px-3 text-xl font-black rounded-xl border-2 border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            />
          </div>
          
          <div className="bg-success-light border border-success-border rounded-xl p-3 text-center">
            <div className="text-xl font-black text-success">{fmtPln(calculatedValue)}</div>
            <div className="text-[9px] font-bold text-ink-3 uppercase">wartość</div>
          </div>
        </div>

        {/* DODATKOWE DANE */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">
              Data przyjęcia
            </label>
            <input
              type="date"
              value={form.receivedDate}
              onChange={e => onFieldChange('receivedDate', e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-lg border-2 border-surface-4 focus:outline-none focus:border-brand"
            />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">
              Nr faktury / WZ
            </label>
            <input
              type="text"
              placeholder="np. WZ 739/MDU/03/2026"
              value={form.invoiceNo ?? ''}
              onChange={e => onFieldChange('invoiceNo', e.target.value)}
              className="w-full h-10 px-3 text-sm rounded-lg border-2 border-surface-4 focus:outline-none focus:border-brand"
            />
          </div>
        </div>

        {/* TRACEABILITY INFO */}
        {batchItems.filter(b => b.supplierBatchNo).length > 1 && (
          <div className="bg-brand-light border border-brand-border rounded-xl px-4 py-3 text-sm">
            <div className="font-bold text-brand mb-1">📦 Łączenie partii dostawcy</div>
            <div className="text-brand/80">
              Partia <strong>{customBatchNo || suggestedBatchNo}</strong> powstanie z połączenia{' '}
              <strong>{batchItems.filter(b => b.supplierBatchNo).length}</strong> pozycji HDI:{' '}
              {batchItems.filter(b => b.supplierBatchNo).map(b => b.supplierBatchNo).join(', ')}
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="text-sm text-danger bg-danger-light border border-danger-border rounded-xl px-4 py-2 font-medium">
            {error}
          </div>
        )}

        {/* Buttons */}
        <div className="flex gap-3 pt-2">
          <Button variant="ghost" fullWidth onClick={onClose} className="h-12">
            Anuluj
          </Button>
          <Button
            variant="primary"
            fullWidth
            loading={loading}
            onClick={onSubmit}
            icon={<Plus size={16} />}
            className="h-12"
            disabled={!form.supplierId || totalKg <= 0}
          >
            Przyjmij partię ({fmtKg(totalKg, 0)} kg)
          </Button>
        </div>
      </div>
    </Modal>
  )
}
