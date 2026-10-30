import React from 'react'
import { OctagonAlert, TriangleAlert, Info } from 'lucide-react'
import type { Level, OrderStatus, PalletStatus } from '../data/model'
import { ORDER_STATUS, PALLET_FLOW, PALLET_STATUS } from '../data/model'

/**
 * Status cyklu życia zamówienia kodowany WYPEŁNIENIEM znacznika
 * (pusty → połowa → pełny), a nie kolorem — czytelny także w skali szarości.
 */
export function StatusGlyph({ status, size = 12 }: { status: OrderStatus; size?: number }) {
  const r = size / 2 - 1.25
  const c = size / 2
  const stroke = status === 'done' ? 'var(--ok)' : status === 'draft' || status === 'cancelled' ? 'var(--ink-4)' : 'var(--accent)'
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {status === 'draft' && <circle cx={c} cy={c} r={r} fill="none" stroke={stroke} strokeWidth="1.5" strokeDasharray="2.2 1.8" />}
      {status === 'confirmed' && <circle cx={c} cy={c} r={r} fill="none" stroke={stroke} strokeWidth="1.75" />}
      {status === 'in_production' && (<>
        <circle cx={c} cy={c} r={r} fill="none" stroke={stroke} strokeWidth="1.75" />
        <path d={`M${c} ${c - r} A${r} ${r} 0 0 0 ${c} ${c + r} Z`} fill={stroke} />
      </>)}
      {status === 'done' && <circle cx={c} cy={c} r={r + .5} fill={stroke} />}
      {status === 'cancelled' && (<>
        <circle cx={c} cy={c} r={r} fill="none" stroke={stroke} strokeWidth="1.5" />
        <line x1={c - r * .7} y1={c + r * .7} x2={c + r * .7} y2={c - r * .7} stroke={stroke} strokeWidth="1.5" />
      </>)}
    </svg>
  )
}

export function OrderStatusLabel({ status }: { status: OrderStatus }) {
  return <span className="status"><StatusGlyph status={status} />{ORDER_STATUS[status]}</span>
}

/** Węzeł linii procesu: ● w normie · ▲ uwaga · ◆ krytyczne · ○ brak aktywności. */
export function StageNode({ level, size = 14 }: { level: 'ok' | 'warn' | 'crit' | 'idle'; size?: number }) {
  const c = size / 2
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      {level === 'ok' && <circle cx={c} cy={c} r={c - 1.5} fill="var(--ok)" />}
      {level === 'idle' && <circle cx={c} cy={c} r={c - 2} fill="var(--surface)" stroke="var(--ink-4)" strokeWidth="1.75" />}
      {level === 'warn' && <path d={`M${c} 1.2 L${size - .8} ${size - 1.6} L.8 ${size - 1.6} Z`} fill="var(--warn)" />}
      {level === 'crit' && <rect x={c - 4.6} y={c - 4.6} width={9.2} height={9.2} transform={`rotate(45 ${c} ${c})`} fill="var(--crit)" />}
    </svg>
  )
}
export const LEVEL_WORD = { ok: 'w normie', warn: 'wymaga uwagi', crit: 'krytyczne', idle: 'brak aktywności' } as const

export function FlagIcon({ level, size = 16 }: { level: Level; size?: number }) {
  if (level === 'crit') return <OctagonAlert size={size} strokeWidth={2.1} aria-label="Krytyczne" />
  if (level === 'warn') return <TriangleAlert size={size} strokeWidth={2.1} aria-label="Uwaga" />
  return <Info size={size} strokeWidth={2} aria-label="Informacja" />
}

export function PalletFlow({ status }: { status: PalletStatus }) {
  const idx = PALLET_FLOW.indexOf(status)
  return (
    <span className="pflow" aria-label={`Etap ${idx + 1} z ${PALLET_FLOW.length}: ${PALLET_STATUS[status]}`}>
      {PALLET_FLOW.map((s, i) => <i key={s} className={i < idx ? 'done' : i === idx ? (status === 'shipped' ? 'done' : 'on') : ''} />)}
    </span>
  )
}

export function PalletStatusLabel({ status }: { status: PalletStatus }) {
  return <span className={`pst ${status}`}>{PALLET_STATUS[status]}</span>
}
