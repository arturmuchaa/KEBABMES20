import type { VehicleStatePallet } from '@/lib/api'
import { roznicaPl } from '../wazenieMrozni'

/** Ciemna zieleń czytelna także dla małego tekstu na bieli i na przycisku. */
export const ZALADUNEK_OK = '#166534'
export const kgZaladunku = (kg: number) => kg.toLocaleString('pl-PL', { maximumFractionDigits: 3 })
export const nazwaKartonu = (p: VehicleStatePallet) => p.cartonNo ? `Karton ${p.cartonNo}` : `Paleta ${p.palletNo}`

export function WierszZaladunku({ paleta: p, ostatni, cofana, blokada, onCofnij }: {
  paleta: VehicleStatePallet
  ostatni: boolean
  cofana: boolean
  blokada: boolean
  onCofnij: () => void
}) {
  const w = p.weighing
  const kolorWagi = w ? (w.ok ? ZALADUNEK_OK : 'var(--red)') : w === null ? 'var(--amb)' : 'var(--mut)'
  return (
    <li data-testid="kafel-zaladunku" data-pallet-id={p.id}
      className="grid min-w-0 grid-cols-2 items-center gap-x-4 gap-y-2 rounded-xl border border-l-4 px-3 py-2 lg:grid-cols-[140px_minmax(0,1fr)_180px_132px] lg:px-4"
      style={{ background: p.onThisVehicle ? 'var(--successSoft)' : 'var(--panel)',
        borderColor: ostatni ? 'var(--accent)' : p.onThisVehicle ? ZALADUNEK_OK : 'var(--line)' }}>
      <div className="min-w-0 self-start">
        <h3 className="hmi-v10-mono break-words text-[22px] font-extrabold leading-tight">{nazwaKartonu(p)}</h3>
        <div className="mt-1 text-sm font-semibold" style={{ color: 'var(--mut)' }}>{p.totalQty} szt.</div>
        {ostatni ? <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Ostatni skan</span> : null}
      </div>
      <div className="col-span-2 row-start-2 min-w-0 lg:col-span-1 lg:row-start-auto">
        {p.items.length ? <ul aria-label={`Zawartość: ${nazwaKartonu(p)}`} className="space-y-1">
          {p.items.map((it, index) => <li key={index} className="flex flex-wrap items-baseline gap-x-3 break-words leading-snug">
            <span className="block min-w-0 max-w-full text-[18px] font-bold">
              {it.qty} × {kgZaladunku(it.kgPerUnit)} kg {it.recipeName || 'receptura niepodana'}
            </span>
            {(it.packagingName || it.productTypeName) ? <span className="block min-w-0 max-w-full text-[15px]" style={{ color: 'var(--mut)' }}>
              {[it.packagingName, it.productTypeName].filter(Boolean).join(' · ')}
            </span> : null}
          </li>)}
        </ul> : <span style={{ color: 'var(--mut)' }}>Brak szczegółów rozpisu</span>}
        <div className="mt-1 text-sm" style={{ color: 'var(--mut)' }}>Z rozpisu: <b>{kgZaladunku(p.totalKg)} kg</b></div>
      </div>
      <div className="col-span-2 min-w-0 rounded-lg border px-3 py-2 lg:col-span-1"
        data-testid="status-wazenia" aria-label="Ważenie kartonu"
        style={{ color: kolorWagi, borderColor: w && !w.ok ? 'var(--redLine)' : 'var(--line)',
          background: w && !w.ok ? 'var(--redSoft)' : w === null ? 'var(--ambSoft)' : 'var(--panel)' }}>
        <strong className="block text-base">{w ? 'Zważony' : w === null ? 'Nie zważony' : 'Brak danych ważenia'}</strong>
        {w ? <>
          <span className="block text-[15px] font-semibold">{kgZaladunku(w.grossKg)} kg brutto</span>
          {!w.ok ? <span className="block text-sm">Waga niezgodna{w.diffKg !== null ? ` · ${roznicaPl(w.diffKg)}` : ''}</span> : null}
        </> : null}
      </div>
      <div className="col-start-2 row-start-1 flex min-w-0 flex-col items-end gap-2 lg:col-start-auto lg:row-start-auto">
        <span className="rounded-lg px-2 py-1 text-base font-extrabold"
          style={{ color: p.onThisVehicle ? ZALADUNEK_OK : p.status === 'loaded' ? 'var(--amb)' : 'var(--mut)',
            background: p.onThisVehicle ? 'var(--successSoft)' : p.status === 'loaded' ? 'var(--ambSoft)' : 'var(--bg)' }}>
          {p.onThisVehicle ? '✓ Na aucie' : p.status === 'loaded' ? 'Inne auto' : 'Czeka'}
        </span>
        {p.onThisVehicle ? <button type="button" disabled={blokada} onClick={onCofnij}
          aria-label={`Cofnij ${nazwaKartonu(p)}`}
          className="min-h-11 rounded-lg border px-4 text-sm font-bold disabled:opacity-50"
          style={{ borderColor: 'var(--line)', color: 'var(--ink)', background: 'var(--panel)' }}>
          {cofana ? 'Cofam…' : 'Cofnij'}
        </button> : null}
      </div>
    </li>
  )
}
