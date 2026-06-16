/**
 * BatchPickerSheet — wybór zastępczej partii mięsa (HMI v2 masowania).
 * Pokazuje partie FEFO ze stanu, blokuje pozycje bez wystarczających kg.
 * Po wyborze zwraca BatchCandidate do MeatScreenV2 (podmiana wiersza).
 */
import { fmtKg, fmtDatePl } from '@/lib/utils'
import { X, AlertTriangle, Timer } from 'lucide-react'
import { buildBatchCandidates, type BatchCandidate, type RawMeatStock } from './batchCandidates'

export function BatchPickerSheet({
  rawStock, requiredMaterialTypeId, neededKg, excludeStockIds, onPick, onClose,
}: {
  rawStock: RawMeatStock[]
  requiredMaterialTypeId?: string | null
  neededKg: number
  excludeStockIds: string[]
  onPick: (c: BatchCandidate) => void
  onClose: () => void
}) {
  const candidates = buildBatchCandidates(rawStock, requiredMaterialTypeId, excludeStockIds)

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      style={{ background: 'rgba(15,23,42,.45)' }} onClick={onClose}>
      <div className="w-full sm:max-w-xl max-h-[85vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5"
        style={{ background: 'var(--panel)' }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <div className="text-2xl font-black" style={{ color: 'var(--ink)' }}>Zmień partię</div>
          <button onClick={onClose} className="p-2 rounded-xl" style={{ background: 'var(--bd)' }}>
            <X size={22} style={{ color: 'var(--ink)' }} />
          </button>
        </div>
        <div className="text-[14px] mb-4" style={{ color: 'var(--mut)' }}>
          Potrzeba ok. <strong style={{ color: 'var(--amb)' }}>{fmtKg(neededKg)} kg</strong> · partie wg terminu (FEFO)
        </div>

        {candidates.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-10" style={{ color: 'var(--mut)' }}>
            <AlertTriangle size={40} style={{ color: 'var(--amb)' }} />
            <div className="text-lg font-bold">Brak dostępnych partii na stanie</div>
          </div>
        )}

        <div className="space-y-3">
          {candidates.map(c => {
            const tooLittle = c.kgFree < neededKg - 0.1
            return (
              <button key={c.meatStockId}
                onClick={() => !tooLittle && onPick(c)}
                disabled={tooLittle}
                className="w-full text-left rounded-2xl border-[3px] p-4 transition-all active:scale-[.99] disabled:opacity-50"
                style={{ borderColor: tooLittle ? 'var(--red)' : 'var(--bd)', background: 'var(--panel)' }}>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[18px] font-black" style={{ color: 'var(--blu)' }}>{c.lotNo}</span>
                  <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>{c.rawBatchNo}</span>
                </div>
                <div className="text-[15px] font-bold mt-0.5" style={{ color: 'var(--ink)' }}>{c.materialName}</div>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-2xl font-black tabular-nums"
                    style={{ color: tooLittle ? 'var(--red)' : 'var(--grn)' }}>
                    {fmtKg(c.kgFree)} kg
                  </span>
                  <span className="inline-flex items-center gap-1 text-[13px] font-bold" style={{ color: 'var(--mut)' }}>
                    <Timer size={13} /> do: {fmtDatePl(c.expiryDate)}
                  </span>
                </div>
                {tooLittle && (
                  <div className="text-[13px] font-bold mt-1 flex items-center gap-1" style={{ color: 'var(--red)' }}>
                    <AlertTriangle size={13} /> Za mało na stanie (potrzeba {fmtKg(neededKg)} kg)
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
