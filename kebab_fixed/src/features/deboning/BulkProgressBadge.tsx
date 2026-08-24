/**
 * BulkProgressBadge — ile z zaznaczonej partii zostało do rozważenia.
 *
 * Strażnik ważenia zbiorczego mieszkał wyłącznie w kreatorze palet, a zielony
 * przycisk szybkiej etykiety na panelu głównym idzie inną drogą: zapisuje
 * paletę od razu. Operator drukujący stamtąd nie widział ani stanu partii,
 * ani tego, że właśnie przekracza limit — dowiadywał się dopiero błędem
 * zapisu, PO zważeniu (hala, 24.08.2026, partia 504).
 *
 * Ten sam rachunek co w kreatorze, ta sama tolerancja wagi.
 */
import { fmtKg } from '@/lib/utils'
import { targetFitsLot, type LotProgress } from './meatPallet'

/** Czy ta waga zmieści się jeszcze w partii. Brak danych = nie blokujemy. */
export function bulkOverLot(netKg: number, progress: LotProgress | null): boolean {
  if (!progress) return false
  return netKg > 0 && !targetFitsLot(netKg, progress.leftKg)
}

export function BulkProgressBadge({ progress, netKg }: {
  progress: LotProgress | null
  netKg: number
}) {
  if (!progress) return null
  const over = bulkOverLot(netKg, progress)

  return (
    <div className="flex flex-col gap-1">
      <div
        data-testid="bulk-progress"
        className="flex items-center justify-between px-3 py-2 text-[12px] font-bold"
        style={{
          borderRadius: 10,
          background: over ? '#FEF3C7' : 'var(--panel)',
          border: `1.5px solid ${over ? '#F59E0B' : 'var(--line)'}`,
        }}
      >
        <span style={{ color: 'var(--mut)' }}>
          Partia <span className="text-[15px]" style={{ color: 'var(--ink)' }}>{progress.lotNo}</span>
        </span>
        <span className="flex items-baseline gap-3" style={{ color: 'var(--mut)' }}>
          <span>zważone {fmtKg(progress.weighedKg, 0)}</span>
          <span>na paletach {fmtKg(progress.onPalletsKg, 0)}</span>
          <span className="text-[15px]" style={{ color: progress.leftKg > 0 ? 'var(--ink)' : '#B91C1C' }}>
            zostało {fmtKg(progress.leftKg, 0)} kg
          </span>
        </span>
      </div>

      {over && (
        <div data-testid="bulk-over" className="text-[11px] font-bold text-center" style={{ color: '#92400E' }}>
          Z partii {progress.lotNo} zostało {fmtKg(progress.leftKg, 0)} kg,
          a na wadze jest {fmtKg(netKg, 1)} kg — zważ mniej albo złóż paletę
          z dwóch partii w „Ważeniu zbiorczym".
        </div>
      )}
    </div>
  )
}
