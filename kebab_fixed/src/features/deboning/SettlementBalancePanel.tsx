import { Check, AlertTriangle } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { SETTLEMENT_LABEL, toleranceLabel, type SettlementKind, type TakeSettlement } from './settlement'

const KINDS: SettlementKind[] = ['meat', 'backs', 'bones']

/** Final step on the main screen: the whole take at a glance, every fraction fixable in place. */
export function SettlementBalancePanel({ s, onFix, busy }: {
  s: TakeSettlement
  onFix: (kind: SettlementKind) => void
  busy?: boolean
}) {
  const kgOf = (k: SettlementKind) => (k === 'meat' ? s.meatKg : k === 'backs' ? s.backsKg : s.bonesKg)
  const pctOf = (kg: number) => (Number(s.kgTaken) > 0 ? (kg / Number(s.kgTaken)) * 100 : 0)
  const ok = s.withinTolerance
  const diff = s.differenceKg
  return (
    <div className="flex-1 min-h-0 flex flex-col gap-3 p-4" aria-label="Bilans pobrania"
      style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Bilans pobrania</span>
        <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>pobrano {fmtKg(Number(s.kgTaken), 1)} kg</span>
      </div>
      {KINDS.map(k => (
        <div key={k} className="flex items-center gap-4 px-4 py-3" style={{ borderRadius: 12, background: 'var(--bg)' }}>
          <span className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'var(--success)', color: '#fff' }}>
            <Check size={20} strokeWidth={3} />
          </span>
          <span className="flex-1 font-bold text-xl">{SETTLEMENT_LABEL[k]}</span>
          <span className="text-[14px] font-bold w-16 text-right" style={{ color: 'var(--mut)' }}>{fmtPct(pctOf(kgOf(k)), 1)}</span>
          <span className="hmi-v10-mono font-extrabold text-3xl w-40 text-right">{fmtKg(kgOf(k), 1)}</span>
          <button type="button" onClick={() => onFix(k)} disabled={busy}
            className="h-12 px-4 text-[13px] font-bold uppercase flex-shrink-0"
            style={{ borderRadius: 10, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
            Popraw
          </button>
        </div>
      ))}
      <div className="flex items-baseline justify-between px-4 pt-1">
        <span className="font-extrabold text-xl">Razem</span>
        <span className="hmi-v10-mono font-extrabold text-4xl">{fmtKg(s.totalKg, 1)} kg</span>
      </div>
      {/* Wydajność mięsa z pobrania — duża, na środku (hala 2026-11-06). */}
      <div className="mt-auto flex flex-col items-center leading-none py-1" aria-label="Procent z pobrania">
        <span className="text-[12px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Procent z pobrania</span>
        <span className="hmi-v10-mono font-extrabold mt-1" style={{ fontSize: 56, color: 'var(--accent)' }}>{fmtPct(pctOf(s.meatKg), 1)}</span>
      </div>
      <div className="flex items-center gap-4 p-4" role="status"
        style={{ borderRadius: 12, background: ok ? '#F0FDF4' : 'var(--redSoft)', border: `1.5px solid ${ok ? '#BBF0D3' : 'var(--redLine)'}` }}>
        <span className="w-12 h-12 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: ok ? 'var(--success)' : 'var(--red)', color: '#fff' }}>
          {ok ? <Check size={28} strokeWidth={3} /> : <AlertTriangle size={26} />}
        </span>
        <div className="min-w-0">
          <div className="font-extrabold text-2xl" style={{ color: ok ? 'var(--success)' : 'var(--red)' }}>
            {ok ? (diff === 0 ? 'W tolerancji — bilans równy' : `W tolerancji — ${diff < 0 ? 'brakuje' : 'nadmiar'} ${fmtKg(Math.abs(diff), 1)} kg`)
              : `${diff < 0 ? 'Brakuje' : 'Nadmiar'} ${fmtKg(Math.abs(diff), 1)} kg`}
          </div>
          <div className="text-[14px] font-semibold" style={{ color: 'var(--mut)' }}>
            Bilans {fmtPct(s.balancePct, 1)} · dopuszczalne {toleranceLabel(s)} = {fmtKg(s.minKg, 1)}–{fmtKg(s.maxKg, 1)} kg
            {ok ? '' : ' · sprawdź tary i liczbę pojemników, popraw ważenie albo zatwierdź z wyjątkiem'}
          </div>
        </div>
      </div>
    </div>
  )
}
