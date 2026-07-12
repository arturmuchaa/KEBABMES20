/**
 * ConfirmMixingSplitDialog — potwierdzenie masowania z podziałem na partie źródłowe
 * (bez HMI). Biuro widzi proponowany podział (czyste per partia + jedna mieszana),
 * edytuje kg mieszane per partia; czyste przeliczają się automatycznie. Na potwierdzenie
 * zwraca sekwencję sesji do finishSession. Patrz spec 2026-07-12-masowanie-podzial-partii.
 */
import { useMemo, useState } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { fmtKg } from '@/lib/utils'
import {
  proposeMixingSplit, buildSplit, validateMixingSplit, splitToBatches,
  type SplitLotInput, type FinishBatch,
} from '../lib/mixingSplit'

export function ConfirmMixingSplitDialog({
  open, recipeName, meatKg, lots, loading, onCancel, onConfirm,
}: {
  open: boolean
  recipeName: string
  meatKg: number
  lots: SplitLotInput[]
  loading: boolean
  onCancel: () => void
  onConfirm: (batches: FinishBatch[]) => void
}) {
  // Startowa propozycja (mod 200) → mapa kg mieszanych per partia; edytowalna.
  const initialMixed = useMemo(() => {
    const p = proposeMixingSplit(lots)
    const m: Record<string, string> = {}
    for (const l of lots) m[l.meatLotId] = '0'
    for (const e of p.mixed) m[e.meatLotId] = String(e.kg)
    return m
  }, [lots])

  const [mixedStr, setMixedStr] = useState<Record<string, string>>(initialMixed)

  const split = useMemo(() => {
    const byLot: Record<string, number> = {}
    for (const l of lots) byLot[l.meatLotId] = parseFloat(mixedStr[l.meatLotId] || '0') || 0
    return buildSplit(lots, byLot)
  }, [lots, mixedStr])

  const v = useMemo(() => validateMixingSplit(split, lots, meatKg), [split, lots, meatKg])
  const batches = useMemo(() => splitToBatches(split), [split])

  return (
    <Dialog open={open} onOpenChange={o => { if (!o && !loading) onCancel() }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Potwierdź masowanie — {recipeName}</DialogTitle>
          <DialogDescription>
            Podział {fmtKg(meatKg, 0)} kg na partie. „Mieszane" = kg z danej partii, które
            trafiły do wspólnego ostatniego wsadu; reszta zostaje partią czystą. Mieszane
            tworzą JEDNĄ partię PP tylko gdy ≥2 partie mają kg &gt; 0.
          </DialogDescription>
        </DialogHeader>

        <table className="w-full text-[13px] border-collapse">
          <thead>
            <tr className="text-ink-4 text-[11px] uppercase">
              <th className="text-left py-1">Partia</th>
              <th className="text-right py-1">Dostępne</th>
              <th className="text-right py-1">Mieszane [kg]</th>
              <th className="text-right py-1">Czyste [kg]</th>
            </tr>
          </thead>
          <tbody>
            {lots.map(l => {
              const m = parseFloat(mixedStr[l.meatLotId] || '0') || 0
              const pure = Math.round((l.kgPlanned - m) * 1000) / 1000
              return (
                <tr key={l.meatLotId} className="border-t border-surface-3">
                  <td className="py-1 font-mono font-bold">{l.lotNo}</td>
                  <td className="py-1 text-right tabular-nums">{fmtKg(l.kgPlanned, 0)}</td>
                  <td className="py-1 text-right">
                    <Input type="number" min="0" step="1" value={mixedStr[l.meatLotId] ?? '0'}
                      disabled={loading}
                      onChange={e => setMixedStr(s => ({ ...s, [l.meatLotId]: e.target.value }))}
                      className="h-7 w-20 text-right text-[13px] tabular-nums inline-block [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                  </td>
                  <td className="py-1 text-right tabular-nums font-semibold">{fmtKg(pure, 0)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="text-[12px] text-ink-3">
          Wynik: {batches.length} {batches.length === 1 ? 'partia' : 'partie'} —{' '}
          {split.pure.map(p => `${p.lotNo} (${fmtKg(p.kg, 0)})`).join(', ')}
          {split.mixed.length > 0 &&
            `, mieszana PP (${fmtKg(split.mixed.reduce((s, e) => s + e.kg, 0), 0)}: ` +
            split.mixed.map(m => `${fmtKg(m.kg, 0)}×${m.lotNo}`).join(' + ') + ')'}
        </div>

        {v.error && <div className="text-[12px] font-semibold text-red-600">{v.error}</div>}
        {v.warning && <div className="text-[12px] font-semibold text-amber-700">{v.warning}</div>}

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={loading}>Anuluj</Button>
          <Button onClick={() => onConfirm(batches)} disabled={loading || !v.ok}>
            {loading ? 'Potwierdzam…' : 'Potwierdź i zapisz partie'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
