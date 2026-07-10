// src/features/products/components/MeatLotPicker.tsx
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { CheckCircle } from 'lucide-react'

export interface PickerLot {
  id: string
  lotNo: string
  rawBatchNo?: string
  kgAvailable: number     // wolne kg (po odjęciu rezerwacji spoza tego wiersza)
  expiryDate: string
  materialName?: string
  materialTypeId?: string
}

export interface SelLot { meatLotId: string; kgPlanned: number }

/** Lista partii FEFO z zaznaczaniem + auto-FEFO dla tego wiersza. */
export function MeatLotPicker({
  lots, value, targetKg, onChange, onAutoFefo,
}: {
  lots: PickerLot[]
  value: SelLot[]
  targetKg: number
  onChange: (next: SelLot[]) => void
  onAutoFefo: () => void
}) {
  const selectedKg = value.reduce((s, l) => s + (l.kgPlanned || 0), 0)
  const idx = (id: string) => value.findIndex(v => v.meatLotId === id)

  // Sekcje po materiale: mięso z/s (podstawa masowania, Auto-FEFO) najpierw,
  // potem filet/indyk — inny składnik, dobierany wyłącznie ręcznie.
  const isZs = (l: PickerLot) => (l.materialTypeId ?? 'mat-mieso-zs') === 'mat-mieso-zs'
  const zs = lots.filter(isZs)
  const others = lots.filter(l => !isZs(l))
  const sections: { header: string | null; items: PickerLot[] }[] = others.length > 0
    ? [{ header: 'Mięso z/s', items: zs }, { header: 'Filet i inne — tylko ręcznie', items: others }]
    : [{ header: null, items: zs }]

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Partie mięsa (FEFO) — zaznacz i wpisz kg
        </span>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onAutoFefo}>
          Auto-FEFO ten wiersz
        </Button>
      </div>
      <div className="border rounded max-h-48 overflow-y-auto divide-y">
        {sections.map(sec => [
          sec.header != null && sec.items.length > 0 && (
            <div key={`h-${sec.header}`} className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground bg-muted/60">
              {sec.header}
            </div>
          ),
          ...sec.items.map(lot => {
          const i = idx(lot.id)
          const isSel = i >= 0
          const free = lot.kgAvailable
          const fullyUsed = free <= 0 && !isSel
          return (
            <div key={lot.id} className={cn(
              'flex items-center gap-2 px-3 py-2 text-[12px] transition-colors',
              isSel ? 'bg-blue-50' : fullyUsed ? 'bg-muted/40 opacity-60' : 'hover:bg-muted/50',
            )}>
              <input type="checkbox" checked={isSel} disabled={fullyUsed}
                onChange={e => {
                  if (e.target.checked) {
                    onChange([...value, { meatLotId: lot.id, kgPlanned: Math.min(free, targetKg) }])
                  } else {
                    onChange(value.filter(v => v.meatLotId !== lot.id))
                  }
                }}
                className="w-4 h-4 flex-shrink-0 accent-primary" />
              <span className="font-mono font-bold flex-shrink-0 w-24">{lot.lotNo}</span>
              {lot.materialName && !isZs(lot) && (
                <span className="text-[10px] font-semibold bg-sky-50 text-sky-700 border border-sky-200 px-1.5 py-0.5 rounded flex-shrink-0">
                  {lot.materialName}
                </span>
              )}
              <span className="text-muted-foreground flex-shrink-0 w-16 truncate">{lot.rawBatchNo}</span>
              <span className="font-semibold text-green-700 flex-shrink-0 w-20 tabular-nums">{fmtKg(free)} kg</span>
              <span className="text-muted-foreground text-[11px] flex-1">do: {fmtDatePl(lot.expiryDate)}</span>
              {isSel && (
                <Input type="number" min="0.1" step="0.1" value={value[i].kgPlanned}
                  onChange={e => {
                    const v = Math.min(parseFloat(e.target.value) || 0, free)
                    onChange(value.map((l, j) => j === i ? { ...l, kgPlanned: v } : l))
                  }}
                  className="w-20 h-7 text-sm font-bold text-right flex-shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              )}
            </div>
          )
        }),
        ])}
      </div>
      <div className="flex items-center gap-2 text-[12px]">
        <CheckCircle size={13} className={selectedKg >= targetKg - 0.5 ? 'text-green-600' : 'text-muted-foreground'} />
        <span className={selectedKg >= targetKg - 0.5 ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
          Wybrano {fmtKg(selectedKg)} / {fmtKg(targetKg)} kg
        </span>
      </div>
    </div>
  )
}
