/**
 * Karta kartonu — co w nim jest, gdzie stoi, z jakich partii i czy ważony.
 *
 * Właściciel 29.09.2026: skan kartonu, który stoi w mroźni, dawał duży
 * czerwony ekran „ten karton nie jest otwarty". Karton gotowy to nie błąd —
 * system ma do niego WEJŚĆ i pokazać status, skład, partie i ostatnie ważenie.
 *
 * Układ (właściciel 30.09.2026): „styl HMI z informacjami na górze normalnie,
 * a nie na pełnym ekranie". Karta NIE zasłania nagłówka panelu (operator,
 * godzina, wersja, Wstecz) — leży pod nim. U góry pasek danych kartonu jak
 * nagłówek HMI, pod nim pierwsze pytanie magazyniera: CZY ZWAŻONY — kiedy,
 * kto, zgodna czy nie; a jak nie ważony, to wprost „NIE WAŻONY". Dalej skład
 * i partie, przyciski na dole.
 */
import type { ReactNode } from 'react'
import type { KartonDoWazenia } from '@/lib/api'
import { dataGodzina } from './etykietaWagiZpl'
import { kgPl, roznicaPl } from './wazenieMrozni'
import { Karta, Znacznik } from './components/Karta'

const STATUS: Record<NonNullable<KartonDoWazenia['status']>, { t: string; zielony: boolean }> = {
  planned: { t: 'ROZPISANY — sztuki nie skanowane', zielony: false },
  packing: { t: 'W PAKOWANIU', zielony: false },
  full: { t: '✓ SPAKOWANY', zielony: true },
  cold_storage: { t: '❄ W MROŹNI', zielony: true },
  loaded: { t: 'NA AUCIE', zielony: true },
  shipped: { t: 'WYDANY DO KLIENTA', zielony: true },
}

/** Komórka paska danych — jak „Chip" w nagłówku HMI: etykieta nad wartością. */
function Pole({ etykieta, children, szeroka = false }: { etykieta: string; children: ReactNode; szeroka?: boolean }) {
  return (
    <div className={`flex min-w-0 flex-col justify-center pl-5 ${szeroka ? 'flex-1' : 'shrink-0'}`}
      style={{ borderLeft: '1px solid var(--lineSoft)' }}>
      <span className="mb-1 text-[10px] font-bold uppercase leading-none tracking-[0.14em]" style={{ color: 'var(--mut)' }}>
        {etykieta}
      </span>
      {children}
    </div>
  )
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
  const pozycje = karton.lines ?? []
  const partie = karton.batches ?? []
  const pelny = !!karton.full || st.zielony

  // Werdykt ważenia: zielony zgodna, czerwony niezgodna, bursztyn „nie ważony"
  // (w mroźni to zaległość do nadrobienia), szary — jeszcze nie ma czego ważyć.
  const doWazenia = !w && (karton.status === 'cold_storage' || karton.status === 'full')
  const wag = w
    ? w.ok
      ? { tlo: 'var(--successSoft)', ramka: 'var(--success)', kolor: '#166534', ikona: '✓',
          tytul: 'ZWAŻONY — WAGA ZGODNA' }
      : { tlo: 'var(--redSoft)', ramka: 'var(--red)', kolor: '#991b1b', ikona: '!',
          tytul: `ZWAŻONY — WAGA NIEZGODNA ${roznicaPl(w.diffKg)}` }
    : doWazenia
      ? { tlo: 'var(--ambSoft)', ramka: 'var(--amb)', kolor: '#92400e', ikona: '⚖',
          tytul: 'NIE WAŻONY — DO ZWAŻENIA' }
      : { tlo: 'var(--panel)', ramka: 'var(--line)', kolor: 'var(--mut)', ikona: '⚖',
          tytul: 'NIE WAŻONY' }

  return (
    <div role="dialog" aria-label="Karta kartonu"
      className="absolute inset-x-0 bottom-0 top-[76px] z-40 flex flex-col"
      style={{ background: 'var(--bg)' }}>

      {/* ── Pasek danych kartonu (jak nagłówek HMI) ─────────────────────── */}
      <div className="flex shrink-0 items-stretch gap-5 px-6 py-3"
        style={{ background: 'var(--panel)', borderBottom: '1px solid var(--line)' }}>
        <div className="flex shrink-0 flex-col justify-center">
          <span className="mb-1 text-[10px] font-bold uppercase leading-none tracking-[0.14em]" style={{ color: 'var(--mut)' }}>
            Karton
          </span>
          <span className="hmi-v10-mono text-[40px] font-bold leading-none"
            style={{ color: pelny ? 'var(--success)' : 'var(--ink)' }}>
            {karton.cartonNo || '—'}
          </span>
        </div>
        <Pole etykieta="Klient" szeroka>
          <span className="break-words text-[24px] font-extrabold leading-tight">{karton.clientName || 'na magazyn'}</span>
        </Pole>
        <Pole etykieta="Zamówienie">
          <Znacznik ton={karton.kind === 'order' ? 'akcja' : 'szary'}>
            {karton.orderNo || 'MAGAZYN'}
          </Znacznik>
        </Pole>
        <Pole etykieta="Status">
          <span data-testid="status-kartonu" className="rounded-lg px-3 py-1 text-[17px] font-extrabold"
            style={st.zielony
              ? { background: 'var(--successSoft)', color: '#166534', border: '1px solid var(--successLine)' }
              : { background: 'var(--bg)', color: 'var(--mut)', border: '1px solid var(--line)' }}>
            {st.t}
          </span>
        </Pole>
        <Pole etykieta="Zawartość">
          <span className="hmi-v10-mono text-[22px] font-bold leading-none">
            {karton.qty ?? 0} szt · {kgPl(karton.netKg ?? 0)} kg
          </span>
        </Pole>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 px-6">
        {/* ── Ważenie — pierwsze pytanie przy kartonie ──────────────────── */}
        <section data-testid="wazenie-kartonu" className="flex shrink-0 items-center gap-5 rounded-2xl px-5 py-4"
          style={{ background: wag.tlo, border: `2px solid ${wag.ramka}` }}>
          <span aria-hidden className="grid shrink-0 place-items-center rounded-full text-[26px] font-extrabold"
            style={{ width: 56, height: 56, background: 'var(--panel)', color: wag.kolor, border: `2px solid ${wag.ramka}` }}>
            {wag.ikona}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[26px] font-extrabold leading-tight" style={{ color: wag.kolor }}>{wag.tytul}</div>
            {w ? (
              <div className="mt-2 grid gap-x-8 gap-y-1" style={{ gridTemplateColumns: 'repeat(4, minmax(0, auto))', justifyContent: 'start' }}>
                <Dana etykieta="Kiedy">{dataGodzina(w.weighedAt) || '—'}</Dana>
                <Dana etykieta="Kto">
                  {w.operator || '—'}{w.weighMode === 'manual' ? ' · RĘCZNIE' : ''}
                </Dana>
                <Dana etykieta="Brutto">{kgPl(w.grossKg)} kg</Dana>
                <Dana etykieta="Paleta">{w.palletTypeName || '—'}</Dana>
              </div>
            ) : (
              <div className="mt-1 text-[16px]" style={{ color: 'var(--mut)' }}>
                {doWazenia
                  ? 'Karton nie przeszedł przez wagę. Zważ go na ekranie MROŹNIA („Zważ” przy kartonie).'
                  : 'Waży się pełny karton przy wjeździe do mroźni.'}
              </div>
            )}
          </div>
        </section>

        {/* ── Skład i partie ─────────────────────────────────────────────── */}
        <div className="grid min-h-0 gap-3" style={{ gridTemplateColumns: partie.length ? 'minmax(0, 3fr) minmax(0, 2fr)' : '1fr' }}>
          <Karta tytul="Skład kartonu" tresc={false}
            prawo={pelny ? <span style={{ color: '#166534', fontWeight: 800 }}>✓ spakowane</span> : undefined}>
            <div data-testid="sklad-kartonu">
              {pozycje.length ? pozycje.map((p, i) => (
                <div key={i} className="flex items-center gap-4 px-4 py-3"
                  style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined }}>
                  <span className="hmi-v10-mono shrink-0 text-[26px] font-bold leading-none"
                    style={{ color: pelny ? 'var(--success)' : 'var(--ink)' }}>
                    {p.qty}<span style={{ color: 'var(--mut)' }}> × </span>{kgPl(p.kgPerUnit, 3)}
                    <span style={{ fontSize: '.55em', color: 'var(--mut)' }}> kg</span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block break-words text-[20px] font-extrabold uppercase leading-tight">{p.recipeName || '—'}</span>
                    {p.productTypeName ? (
                      <span className="block break-words text-[14px]" style={{ color: 'var(--mut)' }}>{p.productTypeName}</span>
                    ) : null}
                  </span>
                </div>
              )) : (
                <div className="px-4 py-3 text-[16px]" style={{ color: 'var(--mut)' }}>Brak zeskanowanych sztuk.</div>
              )}
            </div>
          </Karta>

          {partie.length ? (
            <Karta tytul="Partie w kartonie" tresc={false}>
              <div data-testid="partie-kartonu">
                {partie.map((b, i) => (
                  <div key={b.batchNo} className="flex items-center gap-4 px-4 py-3"
                    style={{ borderTop: i ? '1px solid var(--lineSoft)' : undefined }}>
                    <span className="hmi-v10-mono min-w-0 flex-1 break-words text-[22px] font-bold leading-tight">{b.batchNo}</span>
                    <span className="hmi-v10-mono shrink-0 text-[22px] font-bold leading-none">
                      {b.qty}<span style={{ fontSize: '.6em', color: 'var(--mut)' }}> szt</span>
                    </span>
                  </div>
                ))}
              </div>
            </Karta>
          ) : null}
        </div>
      </div>

      {/* ── Akcje ────────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 flex-wrap gap-2 px-6 py-3"
        style={{ background: 'var(--panel)', borderTop: '1px solid var(--line)' }}>
        {onPakuj ? (
          <button type="button" onClick={onPakuj} className="rounded-xl px-6 py-3.5 text-[18px] font-extrabold text-white"
            style={{ background: 'var(--accent)' }}>Pakuj ten karton</button>
        ) : null}
        {onWyjazd ? (
          <button type="button" onClick={onWyjazd} className="rounded-xl px-6 py-3.5 text-[18px] font-extrabold text-white"
            style={{ background: 'var(--accent)' }}>Wyjedź z mroźni (poprawki)</button>
        ) : null}
        {onDodruk ? (
          <button type="button" onClick={onDodruk} className="rounded-xl px-6 py-3.5 text-[17px] font-bold"
            style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Etykieta wagi</button>
        ) : null}
        <div className="flex-1" />
        <button type="button" onClick={onZamknij} className="rounded-xl px-8 py-3.5 text-[17px] font-bold"
          style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>Zamknij</button>
      </div>
    </div>
  )
}

function Dana({ etykieta, children }: { etykieta: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--mut)' }}>{etykieta}</div>
      <div className="hmi-v10-mono text-[18px] font-bold leading-tight" style={{ color: 'var(--ink)' }}>{children}</div>
    </div>
  )
}
