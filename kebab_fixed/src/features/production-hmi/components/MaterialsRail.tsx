/**
 * Szyna materiałów dnia — folia stretch.
 *
 * Operator pobiera rano rolki i dokłada w ciągu dnia; zwrot niewykorzystanego
 * robi się przy zamykaniu dnia. Zużycie to POBRANE − ZWRÓCONE, nie pamięć
 * operatora, więc stan magazynu zgadza się bez inwentaryzacji.
 */
import { useState } from 'react'
import type { DayMaterial } from '@/lib/api'

export interface MaterialsRailProps {
  material: DayMaterial | null
  onTake: (qty: number) => void
  /** Podpis zmiany: start, przerwy, czas pracy. */
  shiftLines: string[]
}

const KROKI = [5, 10, 20]

export function MaterialsRail({ material, onTake, shiftLines }: MaterialsRailProps) {
  const [otwarte, setOtwarte] = useState(false)
  const pobrane = material?.pobrane ?? 0

  return (
    <aside className="flex flex-col gap-3" style={{ width: 252, flexShrink: 0 }}>
      <div className="flex flex-col gap-2.5 p-3.5"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <h4 className="text-[11px] font-bold uppercase m-0" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
          Folia stretch
        </h4>
        <div>
          <span className="hmi-v10-mono text-[34px] font-extrabold leading-none">{pobrane}</span>{' '}
          <span className="text-[13px] font-bold" style={{ color: 'var(--mut)' }}>
            {material?.unit === 'rolka' ? 'rolek pobrane' : 'pobrane'}
          </span>
        </div>
        <div className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--mut)' }}>
          {(material?.moves ?? []).filter(m => m.kind === 'pobranie').map((m, i) => (
            <span key={i}>{String(m.at).slice(11, 16)} — pobrano {m.qty}</span>
          ))}
          {!material?.moves?.length && <span>Jeszcze nic nie pobrano</span>}
        </div>

        {otwarte ? (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              {KROKI.map(k => (
                <button key={k} type="button" onClick={() => { onTake(k); setOtwarte(false) }}
                  className="flex-1 text-[16px] font-bold"
                  style={{ height: 52, borderRadius: 10, border: '1.5px solid var(--accent)',
                           background: 'var(--accentSoft)', color: 'var(--accent)' }}>
                  +{k}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setOtwarte(false)} className="text-[14px] font-bold"
              style={{ height: 40, borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              Anuluj
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setOtwarte(true)} className="text-[16px] font-bold"
            style={{ height: 56, borderRadius: 10, border: '1.5px solid var(--accent)',
                     background: 'var(--accentSoft)', color: 'var(--accent)' }}>
            + Dołóż rolki
          </button>
        )}
      </div>

      <div className="flex flex-col gap-2.5 p-3.5"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <h4 className="text-[11px] font-bold uppercase m-0" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
          Zmiana
        </h4>
        <div className="flex flex-col gap-1 text-[13px]" style={{ color: 'var(--mut)' }}>
          {shiftLines.map((t, i) => <span key={i}>{t}</span>)}
        </div>
      </div>
    </aside>
  )
}
