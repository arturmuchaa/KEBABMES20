/**
 * Zakończenie dnia — podsumowanie i zwrot folii.
 *
 * Kolejność liczb jest ta sama, co wszędzie na tym ekranie i wynika z tego,
 * czym mierzy się produkcję: KILOGRAMY → SZTUKI → TEMPO (kg/godz.).
 *
 * Zużycie folii liczymy jako pobrane − zwrócone, a nie z pamięci operatora:
 * zwrot to ruch magazynowy w drugą stronę, więc stan zgadza się bez ręcznej
 * inwentaryzacji, a koszt dnia opiera się na liczbie policzonej fizycznie.
 */
import { useState } from 'react'
import { returnIssues } from '../filmUsage'
import type { PlanTotals } from '../planProgress'
import type { ShiftStats } from '../shiftStats'
import type { DayMaterial } from '@/lib/api'

const czas = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const g = Math.floor(m / 60)
  return g ? `${g} godz. ${m % 60} min` : `${m} min`
}

export interface DaySummaryProps {
  date: string
  totals: PlanTotals
  stats: ShiftStats
  material: DayMaterial | null
  pausedMs: number
  onFinish: (zwrot: number) => void
  onClose: () => void
  busy?: boolean
}

export function DaySummary({ date, totals, stats, material, pausedMs, onFinish, onClose, busy }: DaySummaryProps) {
  const pobrane = material?.pobrane ?? 0
  const [zwrot, setZwrot] = useState(0)
  const bledy = returnIssues(pobrane, zwrot)
  const zuzyte = Math.max(0, pobrane - zwrot)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-4 p-6" style={{
        width: 720, maxWidth: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-3">
          <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Zakończ dzień · {date}</h3>
          <button type="button" onClick={onClose} aria-label="Zamknij" className="ml-auto text-[20px]" style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        <Wiersz etykieta="Wyprodukowano">
          <b className="hmi-v10-mono font-extrabold" style={{ fontSize: 26 }}>{totals.kgDone} kg</b>
        </Wiersz>
        <Wiersz etykieta="Sztuk">
          <b className="hmi-v10-mono font-extrabold text-[20px]">{totals.sztDone} szt.</b>
          <span style={{ color: 'var(--mut)' }}>· {totals.pct}% planu</span>
        </Wiersz>
        <Wiersz etykieta="Tempo">
          <b className="hmi-v10-mono font-extrabold text-[20px]">{stats.total.kgPerHour} kg/godz.</b>
          <span style={{ color: 'var(--mut)' }}>
            · {czas(stats.total.workedMs)} pracy{pausedMs > 0 ? ` · ${czas(pausedMs)} przerw` : ''}
          </span>
        </Wiersz>

        <Wiersz etykieta="Folia stretch pobrana z magazynu">
          <b className="hmi-v10-mono font-extrabold text-[20px]">{pobrane} {material?.unit ?? ''}</b>
        </Wiersz>

        <div className="flex items-center gap-3 flex-wrap" style={{
          background: 'var(--accentSoft)', border: '1.5px solid #C7CCFB', borderRadius: 12, padding: '12px 16px',
        }}>
          <span className="font-bold">Ile rolek zostało? Wróci na magazyn.</span>
          <button type="button" aria-label="mniej rolek" disabled={zwrot <= 0} onClick={() => setZwrot(n => Math.max(0, n - 1))}
            className="text-[24px] font-extrabold leading-none"
            style={{ width: 56, height: 56, borderRadius: 10, border: '1.5px solid var(--line)', background: 'var(--panel)', opacity: zwrot <= 0 ? .35 : 1 }}>−</button>
          <b data-testid="zwrot" className="hmi-v10-mono text-[24px] font-extrabold"
            style={{ background: '#fff', border: '1.5px solid var(--accent)', borderRadius: 10, padding: '8px 20px', minWidth: 76, textAlign: 'center' }}>
            {zwrot}
          </b>
          <button type="button" aria-label="więcej rolek" disabled={zwrot >= pobrane} onClick={() => setZwrot(n => Math.min(pobrane, n + 1))}
            className="text-[24px] font-extrabold leading-none"
            style={{ width: 56, height: 56, borderRadius: 10, border: '1.5px solid var(--accent)', background: 'var(--accent)', color: '#fff', opacity: zwrot >= pobrane ? .35 : 1 }}>+</button>
          <span style={{ color: 'var(--mut)' }}>{material?.unit ?? 'rolek'}</span>
        </div>

        <div className="flex items-baseline gap-3 pt-3" style={{ borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--mut)', minWidth: 310 }}>Zużyto na produkcję</span>
          <b className="hmi-v10-mono font-extrabold text-[20px]" style={{ color: 'var(--accent)' }}>{zuzyte} {material?.unit ?? ''}</b>
          <span style={{ color: 'var(--mut)' }}>· tyle wejdzie w koszt dnia</span>
        </div>

        {bledy.length > 0 && (
          <div className="text-[15px] font-semibold" style={{ color: 'var(--red)' }}>{bledy[0]}</div>
        )}

        <div className="flex gap-3">
          <button type="button" data-testid="zakoncz" disabled={bledy.length > 0 || !!busy}
            onClick={() => onFinish(zwrot)} className="flex-1 text-base font-bold"
            style={{ height: 56, borderRadius: 10, border: 0, background: 'var(--accent)', color: '#fff',
                     opacity: bledy.length > 0 || busy ? .4 : 1 }}>
            {busy ? 'Zamykam dzień…' : 'Zakończ dzień'}
          </button>
          <button type="button" onClick={onClose} className="text-base font-bold"
            style={{ height: 56, padding: '0 24px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Jeszcze nie
          </button>
        </div>
      </div>
    </div>
  )
}

function Wiersz({ etykieta, children }: { etykieta: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-[17px]">
      <span style={{ color: 'var(--mut)', minWidth: 310 }}>{etykieta}</span>
      {children}
    </div>
  )
}
