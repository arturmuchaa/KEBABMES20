/**
 * BatchMeatPanel — mięso zakończonej partii: ile dała, gdzie pojechało,
 * ile jeszcze zostało do rozważenia.
 *
 * Po zakończeniu rozbioru kafel partii prowadził WYŁĄCZNIE do ubocznych.
 * Nie dało się ani sprawdzić palet tej partii, ani dokończyć końcówki:
 * z 503 zostały 24.08.2026 422 kg, których nie było jak zważyć.
 *
 * Panel jest „głupi" — liczby przychodzą policzone z `buildBatchMeatSummary`.
 */
import { fmtKg } from '@/lib/utils'
import { Layers, Printer, Scale } from 'lucide-react'
import type { BatchMeatSummary } from './batchMeatSummary'

export function BatchMeatPanel({ summary, onWeighRest, onReprint }: {
  summary:      BatchMeatSummary
  /** Zważ końcówkę — otwiera ważenie zbiorcze z TĄ partią jako aktywną. */
  onWeighRest:  () => void
  onReprint?:   (palletNo: string) => void
}) {
  const zostalo = summary.leftKg

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2" data-testid="bmp-liczby">
        {[
          { etykieta: 'Zważone', kg: summary.weighedKg, kolor: 'var(--ink)' },
          { etykieta: 'Na paletach', kg: summary.onPalletsKg, kolor: 'var(--mut)' },
          { etykieta: 'Zostało', kg: zostalo, kolor: zostalo > 0 ? '#B45309' : '#15803D' },
        ].map(k => (
          <div key={k.etykieta} className="px-3 py-2 text-center"
            style={{ borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--mut)' }}>
              {k.etykieta}
            </div>
            <div className="text-[22px] font-extrabold leading-tight" style={{ color: k.kolor }}>
              {fmtKg(k.kg, 0)}<span className="ml-1 text-[11px] font-bold">kg</span>
            </div>
          </div>
        ))}
      </div>

      {zostalo > 0 && (
        <button type="button" onClick={onWeighRest} data-testid="bmp-zwaz-reszte"
          className="h-14 font-extrabold flex items-center justify-center gap-2"
          style={{ borderRadius: 12, background: 'var(--accent)', color: '#fff' }}>
          <Scale size={20} />
          Zważ końcówkę — {fmtKg(zostalo, 0)} kg
        </button>
      )}

      <div className="flex flex-col gap-1">
        <div className="text-[11px] font-bold uppercase tracking-widest" style={{ color: 'var(--mut)' }}>
          Palety z tej partii
        </div>
        {summary.pallets.length === 0 && (
          <div className="py-4 text-center text-[12px]" style={{ color: 'var(--mut)' }}>
            Z tej partii nie zważono jeszcze żadnej palety.
          </div>
        )}
        {summary.pallets.map(p => (
          <div key={p.palletNo} data-testid="bmp-paleta"
            className="flex items-center gap-2 px-3 py-2 text-[12.5px]"
            style={{ borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <span className="hmi-v10-mono font-bold" style={{ color: 'var(--ink)' }}>{p.palletNo}</span>
            {/* Przy palecie łączonej pokazujemy, ile poszło Z TEJ partii —
                inaczej końcówka 60 kg wyglądałaby na całe 200. */}
            {p.mixed && (
              <span className="flex items-center gap-1 text-[10px] font-bold uppercase px-1.5 py-0.5"
                style={{ borderRadius: 6, background: 'var(--accentSoft)', color: 'var(--accent)' }}>
                <Layers size={10} /> łączona
              </span>
            )}
            <span className="ml-auto hmi-v10-mono font-bold" style={{ color: 'var(--ink)' }}>
              {fmtKg(p.kgFromBatch, 0)} kg
            </span>
            {p.mixed && (
              <span className="hmi-v10-mono text-[11px]" style={{ color: 'var(--mut)' }}>
                z {fmtKg(p.kgNet, 0)}
              </span>
            )}
            <span className="text-[11px]" style={{ color: 'var(--mut)' }}>{p.containers} poj.</span>
            {onReprint && (
              <button type="button" title={`Przedrukuj etykietę ${p.palletNo}`}
                onClick={() => onReprint(p.palletNo)}
                className="grid h-8 w-8 place-items-center" style={{ color: 'var(--accent)' }}>
                <Printer size={16} />
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
