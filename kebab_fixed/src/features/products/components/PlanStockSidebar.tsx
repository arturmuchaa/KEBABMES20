/**
 * PlanStockSidebar — „Magazyn do rozplanowania" przy planie dnia masowania.
 *
 * Stały panel obok planu: planista widzi loty mięsa (z/s i filet/inne)
 * z wolnymi kg, ile bieżący szkic planu z nich bierze i ile ZOSTANIE,
 * oraz zbiorcze zapotrzebowanie przypraw wg planu vs stan magazynu
 * (braki podświetlone zanim plan trafi do operatora).
 */
import { useState } from 'react'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { ExpiryBadge } from '@/components/ui/badge'
import { Warehouse, FlaskConical, ChevronDown, ChevronRight } from 'lucide-react'
import type { PickerLot } from './MeatLotPicker'

export interface SpiceNeed {
  ingredientId: string
  name: string
  unit: string
  need: number
  stock: number
  isUnlimited: boolean
}

function LotRows({ lots, plannedByLot }: {
  lots: PickerLot[]
  plannedByLot: Map<string, number>
}) {
  return (
    <>
      {lots.map(l => {
        const planned = plannedByLot.get(l.id) ?? 0
        const left = l.kgAvailable - planned
        return (
          <div key={l.id} className="px-3 py-1.5 grid grid-cols-[64px_1fr_auto] items-center gap-x-2 border-b border-surface-3 last:border-b-0 text-[12px] [font-variant-numeric:tabular-nums]">
            <span className="font-mono font-bold text-ink">{l.lotNo}</span>
            <span className="flex items-center gap-1.5 min-w-0">
              {l.materialName && (l.materialTypeId ?? 'mat-mieso-zs') !== 'mat-mieso-zs' && (
                <span className="text-[10px] text-ink-3 uppercase truncate">{l.materialName}</span>
              )}
              <span className="text-[10px] text-ink-4 whitespace-nowrap">do {fmtDatePl(l.expiryDate)}</span>
              <ExpiryBadge dateStr={l.expiryDate} compact />
            </span>
            <span className="text-right whitespace-nowrap">
              {planned > 0 ? (
                <>
                  <span className="text-ink-4">{fmtKg(l.kgAvailable, 0)}−</span>
                  <span className="text-amber-700 font-semibold">{fmtKg(planned, 0)}</span>
                  <span className="text-ink-4">=</span>
                  <b className={left < -0.01 ? 'text-red-600' : 'text-emerald-700'}>{fmtKg(left, 0)}</b>
                </>
              ) : (
                <b className="text-emerald-700">{fmtKg(l.kgAvailable, 0)}</b>
              )}
              <span className="text-[10px] text-ink-4"> kg</span>
            </span>
          </div>
        )
      })}
    </>
  )
}

function SectionHeader({ label, sumLabel }: { label: string; sumLabel: string }) {
  return (
    <div className="px-3 py-1.5 bg-surface-2 border-y border-surface-3 first:border-t-0 flex items-center justify-between">
      <span className="text-[10px] font-bold uppercase tracking-widest text-ink-4">{label}</span>
      <span className="text-[11px] font-bold text-ink-2 [font-variant-numeric:tabular-nums]">{sumLabel}</span>
    </div>
  )
}

export function PlanStockSidebar({ zsLots, otherLots, plannedByLot, spiceNeeds, planTotalKg }: {
  zsLots: PickerLot[]
  otherLots: PickerLot[]
  plannedByLot: Map<string, number>
  spiceNeeds: SpiceNeed[]
  /** Suma kg mięsa CAŁEGO szkicu planu (też pozycje bez przypisanych partii). */
  planTotalKg: number
}) {
  const sum = (ls: PickerLot[]) => ls.reduce((s, l) => s + l.kgAvailable, 0)
  const plannedSum = (ls: PickerLot[]) => ls.reduce((s, l) => s + (plannedByLot.get(l.id) ?? 0), 0)
  const zsPool = sum(zsLots)
  // Zapotrzebowanie na z/s = cały plan − kg przypisane do fileta/innych;
  // kg bez partii liczą się jako z/s (tak rozdziela Auto-FEFO) — saldo
  // schodzi na żywo już przy wpisaniu kg pozycji.
  const zsDemand = Math.max(0, planTotalKg - plannedSum(otherLots))
  const zsLeft = zsPool - zsDemand
  const unassigned = Math.max(0, planTotalKg - plannedSum(zsLots) - plannedSum(otherLots))
  const needs = spiceNeeds.filter(n => n.need > 0.0005 && !n.isUnlimited)
  const shortages = needs.filter(n => n.need > n.stock + 0.0005)
  const [open, setOpen] = useState(false)   // rozwinięcie na mobile; na lg+ zawsze widoczne

  return (
    <div className="bg-white border border-surface-4 rounded-lg overflow-hidden lg:sticky lg:top-3">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="w-full px-3 py-2.5 bg-surface-2 border-b border-surface-4 flex items-center gap-2 lg:cursor-default">
        <Warehouse size={14} className="text-brand" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-ink-2">Magazyn do rozplanowania</span>
        <span className="ml-auto lg:hidden text-ink-4">
          {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        </span>
      </button>

      <div className={cn(open ? 'block' : 'hidden', 'lg:block')}>

      {/* Żywy bilans z/s: schodzi przy zaznaczaniu partii / wpisywaniu kg, wraca przy odznaczeniu */}
      <div className="grid grid-cols-3 divide-x divide-surface-3 border-b border-surface-3 text-center [font-variant-numeric:tabular-nums]">
        <div className="px-2 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-ink-4">Wolne z/s</div>
          <div className="text-[15px] font-black text-ink leading-tight">{fmtKg(zsPool, 0)}</div>
        </div>
        <div className="px-2 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-ink-4">W planie</div>
          <div className={cn('text-[15px] font-black leading-tight', zsDemand > 0 ? 'text-amber-700' : 'text-ink-3')}>
            {fmtKg(zsDemand, 0)}
          </div>
        </div>
        <div className="px-2 py-2">
          <div className="text-[9px] font-bold uppercase tracking-widest text-ink-4">Zostanie</div>
          <div className={cn('text-[15px] font-black leading-tight', zsLeft < -0.01 ? 'text-red-600' : 'text-emerald-700')}>
            {fmtKg(zsLeft, 0)}
          </div>
        </div>
      </div>
      {unassigned > 0.5 && (
        <div className="px-3 py-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border-b border-amber-100">
          w planie {fmtKg(unassigned, 0)} kg bez przypisanej partii — dograj Auto-FEFO przed potwierdzeniem
        </div>
      )}

      <SectionHeader
        label="Mięso z/s (Auto-FEFO)"
        sumLabel={`${zsLots.length} partii · ${fmtKg(zsPool, 0)} kg`}
      />
      {zsLots.length === 0
        ? <div className="px-3 py-2 text-[11px] text-ink-4">Brak wolnych partii z/s</div>
        : <LotRows lots={zsLots} plannedByLot={plannedByLot} />}

      {otherLots.length > 0 && (
        <>
          <SectionHeader label="Filet i inne (ręcznie)" sumLabel={`wolne ${fmtKg(sum(otherLots), 0)} kg`} />
          <LotRows lots={otherLots} plannedByLot={plannedByLot} />
        </>
      )}

      <div className="px-3 py-1.5 bg-surface-2 border-y border-surface-3 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-ink-4">
          <FlaskConical size={11} /> Przyprawy wg planu
        </span>
        {shortages.length > 0 && (
          <span className="text-[10px] font-bold text-red-600 uppercase">braki: {shortages.length}</span>
        )}
      </div>
      {needs.length === 0 ? (
        <div className="px-3 py-2 text-[11px] text-ink-4">Dodaj pozycje planu, aby zobaczyć zapotrzebowanie</div>
      ) : (
        needs.map(n => {
          const short = n.need > n.stock + 0.0005
          return (
            <div key={n.ingredientId} className="px-3 py-1.5 flex items-center justify-between gap-2 border-b border-surface-3 last:border-b-0 text-[12px] [font-variant-numeric:tabular-nums]">
              <span className={cn('truncate', short ? 'text-red-700 font-semibold' : 'text-ink-2')} title={n.name}>{n.name}</span>
              <span className="whitespace-nowrap">
                <b className={short ? 'text-red-600' : 'text-ink'}>{fmtKg(n.need, 2)}</b>
                <span className="text-ink-4"> / {fmtKg(n.stock, 2)} {n.unit}</span>
              </span>
            </div>
          )
        })
      )}
      </div>
    </div>
  )
}
