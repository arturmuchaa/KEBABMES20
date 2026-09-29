/**
 * Karta kartonu — co w nim jest, gdzie stoi, z jakich partii.
 *
 * Właściciel 29.09.2026: skan kartonu, który stoi w mroźni, dawał duży
 * czerwony ekran „ten karton nie jest otwarty". Karton gotowy to nie błąd —
 * system ma do niego WEJŚĆ i pokazać status, skład, partie i ostatnie ważenie.
 *
 * Wygląd jak ekran pakowania (właściciel, tego samego dnia: „dużo wolnej
 * przestrzeni, napisy nachodzą na siebie — chcę jak przy pakowaniu"): zielony
 * karton, pozycje „15 × 50 kg ZAGROS" wierszami, pod spodem partie wierszami
 * PEŁNYM numerem („290926 591"). Nazwy się zawijają, nic nie jest ucinane.
 */
import type { KartonDoWazenia } from '@/lib/api'
import { dataGodzina } from './etykietaWagiZpl'
import { kgPl, roznicaPl } from './wazenieMrozni'
import { Znacznik } from './components/Karta'

const STATUS: Record<NonNullable<KartonDoWazenia['status']>, { t: string; zielony: boolean }> = {
  planned: { t: 'ROZPISANY — sztuki nie skanowane', zielony: false },
  packing: { t: 'W PAKOWANIU', zielony: false },
  full: { t: '✓ SPAKOWANY', zielony: true },
  cold_storage: { t: '❄ W MROŹNI', zielony: true },
  loaded: { t: 'NA AUCIE', zielony: true },
  shipped: { t: 'WYDANY DO KLIENTA', zielony: true },
}

const naglowekSekcji = 'text-[12px] font-extrabold uppercase tracking-[0.12em]'

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
  const kolor = st.zielony ? 'var(--success)' : 'var(--accent)'
  const pozycje = karton.lines ?? []
  const partie = karton.batches ?? []

  return (
    <div role="dialog" aria-label="Karta kartonu" className="fixed inset-0 z-40 flex flex-col"
      style={{ background: 'var(--bg)' }}>
      <div className="grid min-h-0 flex-1 gap-3 p-3 px-4 lg:gap-4 lg:px-5"
        style={{ gridTemplateColumns: 'minmax(0, 2fr) minmax(260px, 1fr)' }}>

        {/* ── Karton: status, skład, partie ───────────────────────────── */}
        <div className="flex min-h-0 flex-col overflow-y-auto rounded-2xl">
          <section className="flex flex-col gap-3 rounded-2xl p-4 lg:p-5"
            style={st.zielony
              ? { background: 'var(--successSoft)', border: '2px solid var(--success)' }
              : { background: 'var(--panel)', border: '2px solid var(--accentLine)' }}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <span className={naglowekSekcji} style={{ color: 'var(--mut)' }}>Karton</span>
              <Znacznik ton={karton.kind === 'order' ? 'akcja' : 'szary'}>
                {karton.orderNo ? `ZAMÓWIENIE ${karton.orderNo}` : 'MAGAZYN'}
              </Znacznik>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span className="hmi-v10-mono font-bold leading-none"
                style={{ color: kolor, fontSize: 'clamp(36px, 4.4vw, 60px)' }}>
                {karton.cartonNo || '—'}
              </span>
              <span className="min-w-0 break-words font-extrabold leading-tight"
                style={{ fontSize: 'clamp(28px, 3.2vw, 48px)' }}>
                {karton.clientName || 'na magazyn'}
              </span>
            </div>
            <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
              <span data-testid="status-kartonu" className="font-extrabold leading-none"
                style={{ color: kolor, fontSize: 'clamp(30px, 3.4vw, 52px)' }}>
                {st.t}
              </span>
              <span className="hmi-v10-mono text-[22px] font-bold" style={{ color: st.zielony ? '#166534' : 'var(--ink)' }}>
                {karton.qty ?? 0} szt · {kgPl(karton.netKg ?? 0)} kg
              </span>
            </div>

            {/* SKŁAD — jak na ekranie pakowania: „15 × 50 kg ZAGROS" */}
            <div data-testid="sklad-kartonu" className="overflow-hidden rounded-xl"
              style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
              {pozycje.length ? pozycje.map((p, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3"
                  style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined,
                           background: st.zielony ? 'var(--successSoft)' : undefined }}>
                  <span className="hmi-v10-mono shrink-0 font-bold leading-none"
                    style={{ fontSize: 'clamp(22px, 2.3vw, 34px)', color: st.zielony ? 'var(--success)' : 'var(--ink)' }}>
                    {p.qty}<span style={{ color: 'var(--mut)' }}> × </span>{kgPl(p.kgPerUnit, 3)}
                    <span style={{ fontSize: '.55em', color: 'var(--mut)' }}> kg</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words font-extrabold uppercase leading-tight"
                      style={{ fontSize: 'clamp(19px, 1.9vw, 28px)' }}>{p.recipeName || '—'}</span>
                    {p.productTypeName ? (
                      <span className="block break-words text-[14px]" style={{ color: 'var(--mut)' }}>{p.productTypeName}</span>
                    ) : null}
                  </span>
                  {st.zielony ? (
                    <span className="shrink-0 text-right">
                      <span className="hmi-v10-mono block text-[22px] font-bold leading-none" style={{ color: 'var(--success)' }}>
                        ✓ {p.qty}/{p.qty}
                      </span>
                      <span className="mt-1 block text-[13px] font-bold" style={{ color: 'var(--success)' }}>spakowane</span>
                    </span>
                  ) : null}
                </div>
              )) : (
                <div className="px-4 py-3 text-[16px]" style={{ color: 'var(--mut)' }}>Brak zeskanowanych sztuk.</div>
              )}
            </div>

            {/* PARTIE — pełny numer, ile sztuk z której */}
            {partie.length ? (
              <div className="flex flex-col gap-1.5">
                <span className={naglowekSekcji} style={{ color: 'var(--mut)' }}>Partie w kartonie</span>
                <div data-testid="partie-kartonu" className="overflow-hidden rounded-xl"
                  style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                  {partie.map((b, i) => (
                    <div key={b.batchNo} className="flex items-center gap-4 px-4 py-2.5"
                      style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined }}>
                      <span className="hmi-v10-mono min-w-0 flex-1 break-words font-bold leading-tight"
                        style={{ fontSize: 'clamp(20px, 2vw, 30px)' }}>{b.batchNo}</span>
                      <span className="hmi-v10-mono shrink-0 font-bold leading-none"
                        style={{ fontSize: 'clamp(20px, 2vw, 30px)' }}>
                        {b.qty}<span style={{ fontSize: '.6em', color: 'var(--mut)' }}> szt</span>
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>
        </div>

        {/* ── Boczny panel: ważenie i akcje ────────────────────────────── */}
        <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto">
          <section className="rounded-2xl p-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className={`${naglowekSekcji} mb-2`} style={{ color: 'var(--mut)' }}>Ostatnie ważenie</div>
            {w ? (
              <>
                <div className="text-[26px] font-extrabold leading-tight" style={{ color: w.ok ? '#166534' : '#991b1b' }}>
                  {w.ok ? '✓ ZGODNA' : `NIEZGODNA ${roznicaPl(w.diffKg)}`}
                </div>
                <div className="hmi-v10-mono mt-1 text-[18px] font-bold">brutto {kgPl(w.grossKg)} kg</div>
                <div className="text-[15px]" style={{ color: 'var(--mut)' }}>paleta {w.palletTypeName}</div>
                <div className="hmi-v10-mono mt-1 text-[15px]" style={{ color: 'var(--mut)' }}>
                  {dataGodzina(w.weighedAt)}
                </div>
                {w.operator || w.weighMode === 'manual' ? (
                  <div className="text-[14px]" style={{ color: 'var(--mut)' }}>
                    {[w.operator, w.weighMode === 'manual' ? 'RĘCZNIE' : ''].filter(Boolean).join(' · ')}
                  </div>
                ) : null}
              </>
            ) : (
              <div className="text-[18px] font-bold" style={{ color: karton.status === 'cold_storage' ? '#92400e' : 'var(--mut)' }}>
                {karton.status === 'cold_storage' ? 'Nie ważony — do zważenia' : 'Nie ważony'}
              </div>
            )}
          </section>

          <div className="mt-auto flex flex-col gap-2">
            {onPakuj ? (
              <button type="button" onClick={onPakuj} className="rounded-2xl px-5 py-4 text-[20px] font-extrabold text-white"
                style={{ background: 'var(--accent)' }}>Pakuj ten karton</button>
            ) : null}
            {onWyjazd ? (
              <button type="button" onClick={onWyjazd} className="rounded-2xl px-5 py-4 text-[20px] font-extrabold text-white"
                style={{ background: 'var(--accent)' }}>Wyjedź z mroźni (poprawki)</button>
            ) : null}
            {onDodruk ? (
              <button type="button" onClick={onDodruk} className="rounded-2xl px-5 py-4 text-[18px] font-bold"
                style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Etykieta wagi</button>
            ) : null}
            <button type="button" onClick={onZamknij} className="rounded-2xl px-5 py-4 text-[18px] font-bold"
              style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Zamknij</button>
          </div>
        </aside>
      </div>
    </div>
  )
}
