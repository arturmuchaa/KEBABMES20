/**
 * Karta kartonu — co w nim jest, gdzie stoi, z jakich partii.
 *
 * Właściciel 29.09.2026: skan kartonu, który stoi w mroźni, dawał duży
 * czerwony ekran „ten karton nie jest otwarty". Karton gotowy to nie błąd —
 * system ma do niego WEJŚĆ i pokazać status, skład, partie i ostatnie ważenie.
 * Z karty: wyjazd z mroźni (poprawki) i dodruk etykiety wagi.
 */
import type { KartonDoWazenia } from '@/lib/api'
import { dataGodzina } from './etykietaWagiZpl'
import { kgPl, opisPozycji, roznicaPl } from './wazenieMrozni'

const STATUS: Record<NonNullable<KartonDoWazenia['status']>, { t: string; kolor: string }> = {
  planned: { t: 'ROZPISANY — sztuki nie skanowane', kolor: 'var(--mut)' },
  packing: { t: 'W PAKOWANIU', kolor: 'var(--accent)' },
  full: { t: 'SPAKOWANY — czeka na mroźnię', kolor: '#166534' },
  cold_storage: { t: '❄ W MROŹNI', kolor: 'var(--accent)' },
  loaded: { t: 'NA AUCIE', kolor: '#92400e' },
  shipped: { t: 'WYDANY DO KLIENTA', kolor: 'var(--mut)' },
}

export function KartaKartonu({ karton, onZamknij, onWyjazd, onDodruk, onPakuj }: {
  karton: KartonDoWazenia
  onZamknij: () => void
  /** Tylko dla kartonu w mroźni. */
  onWyjazd?: () => void
  /** Tylko gdy karton był ważony. */
  onDodruk?: () => void
  /** Karton w pakowaniu — przejdź do pakowania. */
  onPakuj?: () => void
}) {
  const st = STATUS[karton.status ?? 'planned']
  const w = karton.lastWeighing
  return (
    <div role="dialog" aria-label="Karta kartonu" className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg)' }}>
      <header className="flex items-start gap-4 px-6 py-4" style={{ borderBottom: '1px solid var(--line)' }}>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>
            Karton {karton.cartonNo} · {karton.orderNo || 'MAGAZYN'}
          </div>
          <div className="truncate text-[30px] font-extrabold">{karton.clientName || 'na magazyn'}</div>
          <div data-testid="status-kartonu" className="text-[24px] font-extrabold" style={{ color: st.kolor }}>{st.t}</div>
        </div>
        <div className="text-right">
          <div className="text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>Netto ze sztuk</div>
          <div className="hmi-v10-mono text-[40px] font-bold leading-none">{kgPl(karton.netKg ?? 0)} kg</div>
          <div className="hmi-v10-mono text-[16px]" style={{ color: 'var(--mut)' }}>{karton.qty ?? 0} szt</div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto p-6" style={{ gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)' }}>
        <section className="rounded-2xl p-5" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>Skład</div>
          {(karton.lines ?? []).length ? (karton.lines ?? []).map((l, i) => (
            <div key={i} className="hmi-v10-mono text-[22px] font-bold">{opisPozycji(l)}</div>
          )) : <div className="text-[16px]" style={{ color: 'var(--mut)' }}>Brak zeskanowanych sztuk.</div>}

          <div className="mb-2 mt-5 text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>Partie</div>
          <table data-testid="partie-kartonu" className="hmi-v10-mono text-[20px]">
            <tbody>
              {(karton.batches ?? []).map(b => (
                <tr key={b.batchNo}>
                  <td className="pr-6 text-right font-bold">{b.qty} szt</td>
                  <td>{b.batchNo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl p-5" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
          <div className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.12em]" style={{ color: 'var(--mut)' }}>Ostatnie ważenie</div>
          {w ? (
            <>
              <div className="text-[28px] font-extrabold" style={{ color: w.ok ? '#166534' : '#991b1b' }}>
                {w.ok ? 'ZGODNA' : `NIEZGODNA ${roznicaPl(w.diffKg)}`}
              </div>
              <div className="hmi-v10-mono text-[18px]">brutto {kgPl(w.grossKg)} kg · paleta {w.palletTypeName}</div>
              <div className="hmi-v10-mono text-[16px]" style={{ color: 'var(--mut)' }}>
                {dataGodzina(w.weighedAt)}{w.operator ? ` · ${w.operator}` : ''}{w.weighMode === 'manual' ? ' · RĘCZNIE' : ''}
              </div>
            </>
          ) : (
            <div className="text-[18px] font-bold" style={{ color: 'var(--mut)' }}>
              {karton.status === 'cold_storage' ? 'Nie ważony — do zważenia' : 'Nie ważony'}
            </div>
          )}
        </section>
      </div>

      <footer className="flex gap-3 px-6 pb-6">
        <button type="button" onClick={onZamknij} className="rounded-2xl px-6 py-5 text-[18px] font-bold"
          style={{ border: '1px solid var(--line)' }}>Zamknij</button>
        {onDodruk ? (
          <button type="button" onClick={onDodruk} className="rounded-2xl px-6 py-5 text-[18px] font-bold"
            style={{ border: '1px solid var(--line)' }}>Etykieta wagi</button>
        ) : null}
        {onPakuj ? (
          <button type="button" onClick={onPakuj} className="flex-1 rounded-2xl px-6 py-5 text-[22px] font-extrabold text-white"
            style={{ background: 'var(--accent)' }}>Pakuj ten karton</button>
        ) : null}
        {onWyjazd ? (
          <button type="button" onClick={onWyjazd} className="flex-1 rounded-2xl px-6 py-5 text-[22px] font-extrabold text-white"
            style={{ background: 'var(--accent)' }}>Wyjedź z mroźni (poprawki)</button>
        ) : null}
      </footer>
    </div>
  )
}
