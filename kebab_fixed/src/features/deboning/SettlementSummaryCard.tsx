import { Check } from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { SETTLEMENT_LABEL, toleranceLabel, type SettlementKind, type TakeSettlement } from './settlement'

const KINDS: SettlementKind[] = ['meat', 'backs', 'bones']
const ORDER = ['meat', 'backs', 'bones', 'balance', 'done']

/** Right-hand take summary while the tile settles meat → backs → bones. */
export function SettlementSummaryCard({ s, liveKg, onFix, fixing = null }: {
  s: TakeSettlement
  /** Stable net on the scale for the current fraction, not yet saved. */
  liveKg: number
  /** Popraw: frakcję poprawia się w tym samym kafelku (także bieżącą). */
  onFix?: (kind: SettlementKind) => void
  /** Frakcja, którą operator właśnie poprawia. */
  fixing?: SettlementKind | null
}) {
  const kgOf = (k: SettlementKind) => (k === 'meat' ? s.meatKg : k === 'backs' ? s.backsKg : s.bonesKg)
  const at = ORDER.indexOf(s.stage)
  const diff = s.differenceKg
  const ok = s.withinTolerance
  const balance = s.stage === 'balance' || s.stage === 'done'
  return (
    <div className="flex-1 min-h-0 p-4 flex flex-col gap-3" aria-label="Podsumowanie pobrania"
      style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Pobranie</div>
          <div className="font-extrabold text-xl truncate">{s.workerName} · partia {s.rawBatchNo}</div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Pobrano</div>
          <div className="hmi-v10-mono font-extrabold text-2xl">{fmtKg(Number(s.kgTaken), 1)} kg</div>
        </div>
      </div>

      <div className="flex flex-col" style={{ borderTop: '1px solid var(--lineSoft)' }}>
        {KINDS.map((k, i) => {
          const current = s.stage === k
          const done = at > i
          const saved = kgOf(k)
          return (
            <div key={k} className="flex items-center gap-3 py-2.5" style={{ borderBottom: '1px solid var(--lineSoft)' }}>
              <span className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-sm font-extrabold"
                style={done ? { background: 'var(--success)', color: '#fff' }
                  : current ? { background: 'var(--accent)', color: '#fff' }
                  : { background: 'var(--bg)', color: 'var(--mut)' }}>
                {done ? <Check size={18} strokeWidth={3} /> : i + 1}
              </span>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-[17px]" style={{ color: current || done ? 'var(--ink)' : 'var(--mut)' }}>{SETTLEMENT_LABEL[k]}</div>
                {fixing === k && (
                  <div className="text-[12px] font-bold" style={{ color: 'var(--amb)' }}>poprawiasz — zważ wózek jeszcze raz</div>
                )}
                {current && fixing !== k && liveKg > 0 && (
                  <div className="text-[12px] font-bold" style={{ color: 'var(--accent)' }}>na wadze {fmtKg(liveKg, 1)} kg — zapisz</div>
                )}
              </div>
              <span className="hmi-v10-mono font-extrabold text-xl" style={{ color: saved > 0 ? 'var(--ink)' : 'var(--mut)' }}>
                {saved > 0 ? `${fmtKg(saved, 1)} kg` : '—'}
              </span>
              {onFix && fixing !== k && saved > 0 && (done || current || balance) && (
                <button type="button" onClick={() => onFix(k)}
                  className="h-9 px-3 text-[12px] font-bold uppercase flex-shrink-0"
                  style={{ borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--mut)' }}>
                  Popraw
                </button>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex items-baseline justify-between">
        <span className="font-bold text-[17px]">Razem</span>
        <span className="hmi-v10-mono font-extrabold text-2xl">{fmtKg(s.totalKg, 1)} kg</span>
      </div>

      <div className="mt-auto p-3.5 flex flex-col gap-1" role="status"
        style={{ borderRadius: 12,
          background: balance ? (ok ? '#F0FDF4' : 'var(--redSoft)') : 'var(--accentSoft)',
          border: `1.5px solid ${balance ? (ok ? '#BBF0D3' : 'var(--redLine)') : 'var(--accentLine)'}` }}>
        <div className="font-extrabold text-xl" style={{ color: balance ? (ok ? 'var(--success)' : 'var(--red)') : 'var(--ink)' }}>
          {!balance ? (diff < 0 ? `Do zważenia jeszcze ok. ${fmtKg(-diff, 1)} kg` : `Zważono ${fmtKg(s.totalKg, 1)} kg`)
            : ok ? `W tolerancji · ${diff === 0 ? 'bilans równy' : diff < 0 ? `brakuje ${fmtKg(-diff, 1)} kg` : `nadmiar ${fmtKg(diff, 1)} kg`}`
            : diff < 0 ? `Brakuje ${fmtKg(-diff, 1)} kg` : `Nadmiar ${fmtKg(diff, 1)} kg`}
        </div>
        <div className="text-[13px] font-semibold" style={{ color: 'var(--mut)' }}>
          Dopuszczalne {toleranceLabel(s)} = {fmtKg(s.minKg, 1)}–{fmtKg(s.maxKg, 1)} kg
          {balance && !ok ? ' · sprawdź ważenia i tary' : ''}
        </div>
      </div>
    </div>
  )
}
