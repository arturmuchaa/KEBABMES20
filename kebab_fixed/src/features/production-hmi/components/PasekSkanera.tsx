/**
 * Stały pasek skanera na GŁÓWNYM ekranie produkcji (03.10.2026).
 *
 * Skan sztuki nie wymaga wyboru pozycji ani okna: etykieta sama wskazuje
 * pozycję, a pasek mówi, co się z nią stało. Jedna linia, bez modala:
 *   - stan skanera: „Skaner gotowy" albo „Skaner wstrzymany: powód",
 *   - ostatnio rozpoznany produkt — z ODPOWIEDZI serwera (nazwa, kg,
 *     klient/partia, pozycja), nie z zaznaczonego wiersza,
 *   - Zapisane / Oczekujące / Błędy. Oczekujące są neutralne; alarm dopiero
 *     przy dłuższym braku postępu albo bardzo dużej kolejce,
 *   - lista błędów rozwijana pod paskiem, przewijana, z kodem i powodem;
 *     NIE zatrzymuje skanowania.
 *
 * Pole skanu jest dla wklejenia / ręcznego skanu z fokusem; nie zabiera
 * fokusu nikomu. Skaner działa i bez niego (nasłuch na dokumencie).
 * Pole jest niekontrolowane — treść należy do bufora ramek (`usePoleSkanu`).
 */
import {
  useState, type ChangeEventHandler, type ClipboardEventHandler, type CompositionEventHandler,
  type KeyboardEventHandler, type RefObject,
} from 'react'
import type { ScanProducedResult } from '@/lib/api'
import type { StanKolejki } from '../useKolejkaSkanow'

export interface PoleSkanuHandlers {
  onChange: ChangeEventHandler<HTMLInputElement>
  onKeyDown: KeyboardEventHandler<HTMLInputElement>
  onPaste: ClipboardEventHandler<HTMLInputElement>
  onCompositionStart: CompositionEventHandler<HTMLInputElement>
  onCompositionEnd: CompositionEventHandler<HTMLInputElement>
  zakoncz: () => void
}

export interface PasekSkaneraProps {
  /** null = gotowy; tekst = powód wstrzymania. */
  wstrzymany: string | null
  stan: StanKolejki
  /** Kolejka stoi za długo albo jest bardzo duża. */
  alarm: boolean
  /** Numer pozycji na liście dla ostatniego produktu (0 = nie ma jej na liście). */
  lpOstatniego: number
  pole: RefObject<HTMLInputElement | null>
  handlers: PoleSkanuHandlers
  onPrzeczytane: () => void
}

export const nazwaProduktu = (w: ScanProducedResult | null | undefined): string =>
  (w?.recipeName || w?.productTypeName || '').trim()

export function PasekSkanera({ wstrzymany, stan, alarm, lpOstatniego, pole, handlers, onPrzeczytane }: PasekSkaneraProps) {
  const [listaOtwarta, setListaOtwarta] = useState(false)
  const gotowy = wstrzymany === null
  const p = stan.ostatniProdukt
  const bledy = stan.bledy.length

  const kolor = gotowy
    ? { bg: 'var(--successSoft)', line: 'var(--successLine)', fg: 'var(--success)' }
    : { bg: 'var(--ambSoft)', line: 'var(--ambLine)', fg: 'var(--amb)' }

  return (
    <div data-testid="pasek-skanera" className="phmi-skaner flex-shrink-0 relative flex items-center gap-3"
      style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 10, padding: '0 3px 0 3px' }}>
      <span data-testid="skaner-stan" data-gotowy={gotowy ? 'true' : 'false'} role="status" aria-live="polite"
        title={gotowy ? undefined : `Skaner wstrzymany: ${wstrzymany}`}
        className="flex-shrink-0 text-[14px] font-extrabold whitespace-nowrap truncate"
        style={{ maxWidth: 340, padding: '8px 12px', borderRadius: 8, background: kolor.bg,
                 border: `1px solid ${kolor.line}`, color: kolor.fg }}>
        {gotowy ? '▥ Skaner gotowy' : `⏸ Skaner wstrzymany: ${wstrzymany}`}
      </span>

      <span data-testid="skaner-ostatni" className="flex-1 min-w-0 truncate text-[15px] font-bold"
        title={stan.ostatni && !stan.ostatni.ok ? `${stan.ostatni.kod} — ${stan.ostatni.tytul}` : undefined}>
        {stan.ostatni && !stan.ostatni.ok ? (
          <span style={{ color: 'var(--red)' }}>✕ {stan.ostatni.tytul}
            <span className="hmi-v10-mono font-semibold"> · {stan.ostatni.kod}</span></span>
        ) : p ? (
          <>
            <span style={{ color: 'var(--success)' }}>✓ </span>
            {lpOstatniego > 0 && <span className="hmi-v10-mono" style={{ color: 'var(--accent)' }}>poz. {lpOstatniego} · </span>}
            {nazwaProduktu(p) || 'sztuka'}
            {p.weightKg ? <span className="hmi-v10-mono"> · {p.weightKg} kg</span> : null}
            <span style={{ color: 'var(--mut)', fontWeight: 600 }}>
              {' · '}{p.clientName || 'na magazyn'}{p.batchNo ? ` / ${p.batchNo}` : ''}
            </span>
          </>
        ) : (
          <span style={{ color: 'var(--mut)', fontWeight: 600 }}>
            Skanuj sztuki dowolnej pozycji — bez wybierania z listy
          </span>
        )}
      </span>

      <Licznik testId="skaner-zapisane" etykieta="Zapisane" wartosc={stan.zapisane} kolor="var(--success)" />
      <Licznik testId="skaner-oczekujace" etykieta="Oczekujące" wartosc={stan.oczekujace}
        kolor={alarm ? 'var(--red)' : 'var(--ink)'} alarm={alarm} />

      <button type="button" data-testid="skaner-bledy" aria-expanded={listaOtwarta}
        onClick={() => setListaOtwarta(o => !o)} disabled={!bledy}
        className="phmi-btn phmi-touch flex-shrink-0 flex items-center gap-2 text-[13px] font-bold"
        style={{ height: 38, padding: '0 12px', borderRadius: 8,
                 border: `1px solid ${bledy ? 'var(--redLine)' : 'var(--line)'}`,
                 background: bledy ? 'var(--redSoft)' : 'var(--panel)', color: bledy ? 'var(--red)' : 'var(--mut)',
                 opacity: bledy ? 1 : .6 }}>
        Błędy <b data-testid="skaner-bledy-licznik" className="hmi-v10-mono text-[17px]">{bledy}</b>
        {bledy ? <span aria-hidden="true">{listaOtwarta ? '▴' : '▾'}</span> : null}
      </button>

      <form className="flex-shrink-0" onSubmit={e => { e.preventDefault(); handlers.zakoncz() }}>
        {/* Bez autofokusu: skaner działa przez nasłuch na dokumencie. */}
        <input ref={pole} data-testid="pole-skanu-glowne" aria-label="Pole skanu sztuki"
          disabled={!gotowy}
          onChange={handlers.onChange} onKeyDown={handlers.onKeyDown} onPaste={handlers.onPaste}
          onCompositionStart={handlers.onCompositionStart} onCompositionEnd={handlers.onCompositionEnd}
          placeholder="pole skanu" autoComplete="off" spellCheck={false}
          className="hmi-v10-mono text-[14px] font-bold"
          style={{ width: 150, height: 38, padding: '0 10px', borderRadius: 8, background: 'var(--bg)',
                   border: '1.5px solid var(--line)', color: 'var(--ink)', opacity: gotowy ? 1 : .5 }} />
      </form>

      {listaOtwarta && bledy > 0 && (
        <div data-testid="skaner-bledy-lista" role="log" aria-label="Skany z błędem"
          className="absolute right-0 z-40 flex flex-col"
          style={{ top: '100%', marginTop: 4, width: 'min(640px, calc(100% - 32px))', maxHeight: 280,
                   background: 'var(--panel)', border: '1px solid var(--redLine)', borderRadius: 10,
                   boxShadow: '0 12px 32px -12px rgba(0,0,0,.35)' }}>
          <div className="flex items-center gap-3 px-3 py-2 flex-shrink-0" style={{ borderBottom: '1px solid var(--redLine)' }}>
            <span className="text-[14px] font-extrabold" style={{ color: 'var(--red)' }}>
              Skany z błędem: {bledy}
            </span>
            <button type="button" data-testid="skaner-bledy-wyczysc"
              onClick={() => { onPrzeczytane(); setListaOtwarta(false) }}
              className="phmi-btn ml-auto text-[13px] font-bold"
              style={{ height: 40, padding: '0 14px', borderRadius: 8, border: '1px solid var(--redLine)',
                       color: 'var(--red)', background: 'var(--panel)' }}>
              Przeczytane
            </button>
            <button type="button" onClick={() => setListaOtwarta(false)} aria-label="Zwiń listę błędów"
              className="phmi-btn text-[13px] font-bold"
              style={{ height: 40, padding: '0 14px', borderRadius: 8, border: '1px solid var(--line)',
                       color: 'var(--ink)', background: 'var(--panel)' }}>
              Zwiń
            </button>
          </div>
          <ul className="m-0 p-0 list-none overflow-y-auto px-3 py-2">
            {stan.bledy.map(b => (
              <li key={b.nr} data-testid="blad-skanu" data-niepewny={b.niepewny ? 'true' : undefined}
                className="text-[13px] break-words py-1" style={{ color: 'var(--ink)', borderBottom: '1px solid var(--lineSoft)' }}>
                <span className="hmi-v10-mono font-bold">{b.kod}</span> — <b>{b.tytul}</b>{b.tekst ? `: ${b.tekst}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function Licznik({ testId, etykieta, wartosc, kolor, alarm = false }: {
  testId: string; etykieta: string; wartosc: number; kolor: string; alarm?: boolean
}) {
  return (
    <span data-testid={testId} data-alarm={alarm ? 'true' : undefined}
      className="flex-shrink-0 flex items-baseline gap-1.5 whitespace-nowrap"
      style={alarm ? { padding: '3px 8px', borderRadius: 8, background: 'var(--redSoft)', border: '1px solid var(--redLine)' } : undefined}>
      <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>{etykieta}</span>
      <b data-testid={`${testId}-liczba`} className="hmi-v10-mono text-[18px] font-extrabold" style={{ color: kolor }}>{wartosc}</b>
    </span>
  )
}
