// src/features/products/components/MeatLotPicker.tsx
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { CheckCircle } from 'lucide-react'

export interface PickerLot {
  id: string
  lotNo: string
  rawBatchNo?: string
  /** PULA DNIA: kg_free z API + rezerwacje wczytanego planu tego dnia */
  kgAvailable: number
  expiryDate: string
  materialName?: string
  materialTypeId?: string
  /** Krótka nazwa dostawcy (display_name) — planista rozpoznaje pochodzenie */
  supplierName?: string
}

export interface SelLot {
  meatLotId: string
  kgPlanned: number
  /** Faktycznie zużyte kg (z finish-session). Dla pozycji GOTOWYCH kg_planned
   * schodzi do 0, a przydzielone mięso zostaje tu — do wyświetlenia planu
   * historycznego. Nie używane w gatingu/pickerze (tam liczy się kg_planned). */
  kgActual?: number
  /** Numer partii zapamiętany z planu — fallback do wyświetlenia, gdy partia
   * jest w całości zarezerwowana i znika z listy pickera (kgAvailable=0). */
  lotNo?: string
}

/**
 * Lista partii FEFO z zaznaczaniem + auto-FEFO dla tego wiersza.
 *
 * Saldo NA ŻYWO: `liveFree` = pula dnia − kg wzięte przez CAŁY szkic planu
 * (wszystkie wiersze, łącznie z tym). Zaznaczenie partii natychmiast schodzi
 * z wolnego, odznaczenie wraca — spójnie z panelem „Magazyn do rozplanowania".
 */
export function MeatLotPicker({
  lots, value, targetKg, liveFree, onChange, onAutoFefo,
}: {
  lots: PickerLot[]
  value: SelLot[]
  targetKg: number
  liveFree: Map<string, number>
  onChange: (next: SelLot[]) => void
  onAutoFefo: () => void
}) {
  const selectedKg = value.reduce((s, l) => s + (l.kgPlanned || 0), 0)
  const idx = (id: string) => value.findIndex(v => v.meatLotId === id)
  const pct = targetKg > 0 ? Math.min(100, (selectedKg / targetKg) * 100) : 0
  const covered = selectedKg >= targetKg - 0.5 && targetKg > 0

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
      <div className="border rounded max-h-56 overflow-y-auto divide-y">
        {sections.map(sec => [
          sec.header != null && sec.items.length > 0 && (
            <div key={`h-${sec.header}`} className="px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-muted-foreground bg-muted/60">
              {sec.header}
            </div>
          ),
          ...sec.items.map(lot => {
          const i = idx(lot.id)
          const isSel = i >= 0
          const own = isSel ? (value[i].kgPlanned || 0) : 0
          // Wolne NA ŻYWO (po całym szkicu); ten wiersz może wziąć live + własne
          const live = liveFree.get(lot.id) ?? lot.kgAvailable
          const rowCap = Math.max(0, live + own)
          const plannedHere = Math.max(0, lot.kgAvailable - live)
          const fullyUsed = rowCap <= 0.001 && !isSel
          return (
            <div key={lot.id} className={cn(
              'flex items-center gap-2 px-3 py-2 text-[12px] transition-colors',
              isSel ? 'bg-surface-3' : fullyUsed ? 'bg-muted/40 opacity-60' : 'hover:bg-muted/50',
            )}>
              <input type="checkbox" checked={isSel} disabled={fullyUsed}
                onChange={e => {
                  if (e.target.checked) {
                    // Dopełnij BRAKUJĄCE kg do celu (nie cały cel) — przy 2200 kg
                    // i ręcznie wpisanych 854 kg z pierwszej partii kolejna ma
                    // podpowiedzieć 1346, żeby nie liczyć tego w pamięci.
                    const missing = Math.max(0, targetKg - selectedKg)
                    onChange([...value, { meatLotId: lot.id, kgPlanned: Math.min(rowCap, missing || targetKg) }])
                  } else {
                    onChange(value.filter(v => v.meatLotId !== lot.id))
                  }
                }}
                className="w-4 h-4 flex-shrink-0 accent-primary" />
              <span className="font-mono font-bold flex-shrink-0 w-14">{lot.lotNo}</span>
              <span className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded border flex-shrink-0',
                isZs(lot)
                  ? 'bg-surface-2 text-ink-3 border-surface-4'
                  : 'bg-sky-50 text-sky-700 border-sky-200',
              )}>
                {lot.materialName || (isZs(lot) ? 'Mięso z/s' : '—')}
              </span>
              {lot.supplierName && (
                <span className="text-[11px] text-ink-3 flex-shrink-0 max-w-[110px] truncate" title={lot.supplierName}>
                  {lot.supplierName}
                </span>
              )}
              {/* Saldo na żywo: pula − wzięte przez plan = zostaje */}
              <span className="flex-shrink-0 tabular-nums text-right ml-auto whitespace-nowrap"
                title={plannedHere > 0.001
                  ? `Pula ${fmtKg(lot.kgAvailable)} kg − w planie ${fmtKg(plannedHere)} kg = zostaje ${fmtKg(live)} kg`
                  : `Wolne ${fmtKg(live)} kg`}>
                {plannedHere > 0.001 && (
                  <span className="text-[11px] text-ink-4">{fmtKg(lot.kgAvailable, 0)}−{fmtKg(plannedHere, 0)}=</span>
                )}
                <b className={cn(
                  live > 0.001 ? 'text-emerald-700' : live < -0.001 ? 'text-red-600' : 'text-ink-4',
                )}>{fmtKg(live)}</b>
                <span className="text-[10px] text-ink-4"> kg</span>
              </span>
              <span className="text-muted-foreground text-[11px] flex-shrink-0 w-20">do {fmtDatePl(lot.expiryDate)}</span>
              {isSel && (
                <Input type="number" min="0.1" step="0.1" value={value[i].kgPlanned}
                  onChange={e => {
                    const v = Math.min(parseFloat(e.target.value) || 0, rowCap)
                    onChange(value.map((l, j) => j === i ? { ...l, kgPlanned: v } : l))
                  }}
                  className="w-20 h-7 text-sm font-bold text-right flex-shrink-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
              )}
            </div>
          )
        }),
        ])}
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[12px]">
          <CheckCircle size={13} className={covered ? 'text-green-600' : 'text-muted-foreground'} />
          <span className={covered ? 'text-green-700 font-semibold' : 'text-amber-700 font-semibold'}>
            Wybrano {fmtKg(selectedKg)} / {fmtKg(targetKg)} kg
          </span>
        </div>
        <div className="h-1.5 rounded bg-surface-3 overflow-hidden">
          <div
            className={cn('h-full rounded transition-all', covered ? 'bg-emerald-500' : 'bg-amber-400')}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  )
}
