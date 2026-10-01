/**
 * Plan dnia — stała lista po lewej stronie ekranu produkcji.
 *
 * Od 01.10.2026 lista NIE znika po wybraniu pozycji: stoi cały czas, a liczenie
 * sztuk dzieje się w panelu obok. Wiersz niesie tylko to, czego operator
 * potrzebuje z dwóch metrów: numer, „15 × 50 kg", rodzaj, klient/tuleja (jeśli
 * się zmieszczą), zrobione/plan i — osobno — skan. Partie, alokacje i sumy
 * kilogramów są w szczegółach pozycji (przytrzymanie wiersza albo przycisk
 * „Szczegóły" w panelu), bo na liście zabierały miejsce 30 pozycjom.
 *
 * Kolejność jest kolejnością planu i nie zmienia się po zapisie — zaznaczenie
 * nie przeskakuje samo na następną pozycję.
 *
 * Stan POTWIERDZONE (27.08.2026): policzona pozycja to jeszcze deklaracja
 * operatora, dopiero zeskanowana sztuka leży na magazynie wyrobu gotowego.
 */
import { useEffect, useState } from 'react'
import { linePct, type WorkerEntry } from '../planProgress'
import { lineScanState, scanOf, type LineScanState, type ScanMap } from '../scanProgress'
import { planLayout, ROW_GAP, type Density } from '../planLayout'
import { useLongPress } from '../useLongPress'

export interface PlanLineView {
  id: string
  qty: number
  kgPerUnit: number
  totalKg: number
  recipeName: string
  packagingName: string
  clientName: string
  qtyDone: number
  workerEntries?: WorkerEntry[]
  /** Wsad, z którego robi się pozycję — w szczegółach pozycji. */
  seasonedBatchNos?: string[]
  batchAllocation?: Record<string, any>
  /** Kartoteka tulei pozycji — potrzebna przy zmianie rodzaju z hali. */
  packagingId?: string
  /** Ile tulei zeszło już ze stanu na tej pozycji. */
  packagingUsed?: number
}

export const ETYKIETA_STANU: Record<LineScanState, { text: string; stripe: string; bg: string; fg: string }> = {
  PLANNED:     { text: 'Zaplanowane', stripe: 'var(--line)',    bg: 'var(--panel)',       fg: 'var(--mut)' },
  IN_PROGRESS: { text: 'W trakcie',   stripe: 'var(--accent)',  bg: 'var(--panel)',       fg: 'var(--accent)' },
  DONE:        { text: 'Gotowe',      stripe: 'var(--amb)',     bg: 'var(--ambSoft)',     fg: 'var(--amb)' },
  CONFIRMED:   { text: 'Potwierdzone', stripe: 'var(--success)', bg: 'var(--successSoft)', fg: 'var(--success)' },
}

export const kgTxt = (n: number) => `${Math.round(n * 100) / 100} kg`
/** „15 × 50 kg" — tak hala mówi o pozycji. */
export const sztukiRazyWaga = (l: { qty: number; kgPerUnit: number }) => `${l.qty} × ${kgTxt(l.kgPerUnit)}`

/** Wysokość listy mierzona na żywo — od niej zależy gęstość wierszy.
 *  Ref zwrotny, bo element pojawia się dopiero, gdy plan ma pozycje. */
function useWysokosc<T extends HTMLElement>() {
  const [el, setEl] = useState<T | null>(null)
  const [h, setH] = useState<number | null>(null)
  useEffect(() => {
    if (!el || typeof ResizeObserver === 'undefined') return
    const zmierz = () => setH(el.clientHeight || null)
    zmierz()
    const ro = new ResizeObserver(zmierz)
    ro.observe(el)
    return () => ro.disconnect()
  }, [el])
  return [setEl, h] as const
}

export function PlanList({ lines, selectedId, onPick, onDetails, scans }: {
  lines: PlanLineView[]
  selectedId?: string | null
  onPick: (lineId: string) => void
  /** Przytrzymanie wiersza — szczegóły pozycji (partie, tuleja, rozliczenie). */
  onDetails?: (lineId: string) => void
  /** Postęp skanowania per pozycja — źródło stanu POTWIERDZONE. */
  scans?: ScanMap
}) {
  const [ref, wysokosc] = useWysokosc<HTMLDivElement>()

  if (!lines.length) {
    return (
      <div className="flex-1 min-w-0 flex items-center justify-center"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', borderRadius: 12 }}>
        <div className="text-center px-6">
          <div className="text-xl font-extrabold">Biuro nie zaplanowało dziś produkcji</div>
          <div className="text-base mt-2" style={{ color: 'var(--mut)' }}>
            Plan pojawi się tu sam, gdy tylko biuro go zapisze.
          </div>
        </div>
      </div>
    )
  }

  const uklad = planLayout(lines.length, wysokosc)

  return (
    <div className="flex-1 min-w-0 min-h-0 flex flex-col" data-testid="plan-lista"
      data-cols={uklad.cols} data-density={uklad.density} data-scroll={uklad.scroll ? '1' : '0'}>
      {/* Widoczna CAŁY czas, także po zaznaczeniu pozycji — przytrzymanie nie
          jest gestem, który ktoś odgadnie sam. Czytnik dostaje pełne zdanie. */}
      <div data-testid="plan-wskazowka-widoczna" aria-hidden="true"
        className="phmi-plan-hint flex-shrink-0 px-1 font-semibold truncate" style={{ color: 'var(--mut)' }}>
        Dotknij — wybierz · <b style={{ color: 'var(--ink)' }}>Przytrzymaj → szczegóły</b> (partie, tuleja, klient)
      </div>
      <span id="plan-wskazowka" className="sr-only">
        Dotknij, aby wybrać pozycję. Przytrzymaj, aby zobaczyć szczegóły: partie, tuleję i rozliczenie.
      </span>
      {uklad.scroll && (
        <div role="status" className="flex-shrink-0 text-[13px] font-bold mb-1.5 px-3 py-1.5"
          style={{ background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', color: 'var(--amb)', borderRadius: 8 }}>
          Plan ma {lines.length} pozycji — nie mieści się na tym ekranie, przewiń listę ↓
        </div>
      )}
      <div ref={ref} className="flex-1 min-h-0" data-testid="plan-przewijanie"
        style={{ overflowY: uklad.scroll ? 'auto' : 'hidden', overflowX: 'hidden' }}>
        <ol aria-label="Plan dnia" className="m-0 p-0 list-none grid" style={{
          gridTemplateColumns: `repeat(${uklad.cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${uklad.rows}, ${uklad.rowH}px)`,
          gridAutoFlow: 'column',
          rowGap: ROW_GAP, columnGap: 10, alignContent: 'start',
        }}>
          {lines.map((l, i) => (
            <li key={l.id} className="phmi-cell min-w-0">
              <PlanRow line={l} lp={i + 1} density={uklad.density} selected={l.id === selectedId}
                scans={scans} onPick={onPick} onDetails={onDetails} />
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

function PlanRow({ line: l, lp, density, selected, scans, onPick, onDetails }: {
  line: PlanLineView; lp: number; density: Density; selected: boolean; scans?: ScanMap
  onPick: (id: string) => void; onDetails?: (id: string) => void
}) {
  const { pressing, handlers } = useLongPress(
    () => onDetails?.(l.id),
    () => onPick(l.id),
  )
  const stan = lineScanState(l, scans)
  const s = ETYKIETA_STANU[stan]
  const skan = scanOf(scans, l.id)
  const pct = linePct(l)
  const duzy = density !== 'S'
  const podpis = [l.clientName || 'na magazyn', l.packagingName].filter(Boolean).join(' · ')
  const fs = density === 'L' ? { main: 24, sub: 15, lp: 18 } : density === 'M' ? { main: 20, sub: 13, lp: 16 } : { main: 17, sub: 13, lp: 14 }

  return (
    <button type="button" data-testid={`pozycja-planu-${l.id}`} data-state={stan}
      aria-pressed={selected} aria-describedby="plan-wskazowka"
      {...(onDetails ? handlers : { onClick: () => onPick(l.id) })}
      className={`phmi-row phmi-touch w-full h-full text-left flex items-stretch ${duzy ? 'phmi-row--big' : ''} ${pressing ? 'phmi-row--pressing' : ''}`}
      style={{
        borderRadius: 10,
        background: selected ? 'var(--accentSoft)' : s.bg,
        border: selected ? '3px solid var(--accent)' : '1px solid var(--line)',
        boxShadow: selected ? '0 4px 14px -6px rgba(79,70,229,.55)' : undefined,
        color: 'var(--ink)',
      }}>
      <span aria-hidden="true" className="phmi-row__hold" />
      <span aria-hidden="true" className="flex-shrink-0" style={{ width: selected ? 4 : 6, background: s.stripe }} />
      <span className="hmi-v10-mono flex-shrink-0 flex items-center justify-center font-extrabold"
        style={{ width: fs.lp * 2.4, fontSize: fs.lp, color: selected ? 'var(--accent)' : 'var(--mut)' }}>
        <span style={selected ? { background: 'var(--accent)', color: '#fff', borderRadius: 7, padding: '1px 7px' } : undefined}>{lp}</span>
      </span>
      <span className="min-w-0 flex-1 flex flex-col justify-center pr-2">
        {/* Wąska kolumna (< 520 px) i duży wiersz: „15 × 50 kg" w pierwszej
            linii, rodzaj w drugiej, klient/tuleja się chowa — CSS. */}
        <span className="phmi-row__head flex items-baseline gap-2.5 min-w-0">
          <span className="hmi-v10-mono font-extrabold whitespace-nowrap flex-shrink-0" style={{ fontSize: fs.main, lineHeight: 1.1 }}>
            {sztukiRazyWaga(l)}
          </span>
          {/* Rodzaj bierze całą resztę wiersza; klient ustępuje pierwszy
              (flex-shrink 50, a w gęstym wierszu < 520 px znika — CSS). */}
          <span className="font-bold truncate" title={l.recipeName}
            style={{ fontSize: fs.main - 3, lineHeight: 1.15, flex: '1 1 auto', minWidth: 0 }}>{l.recipeName}</span>
          {!duzy && (
            <span className="phmi-row__client truncate font-semibold"
              style={{ fontSize: fs.sub, color: 'var(--mut)', flexShrink: 50, minWidth: 0 }}>{l.clientName || 'na magazyn'}</span>
          )}
        </span>
        {duzy && (
          <span className="phmi-row__sub truncate font-semibold" style={{ fontSize: fs.sub, color: 'var(--mut)', marginTop: 2 }}>{podpis}</span>
        )}
      </span>
      <span className="flex-shrink-0 flex flex-col items-end justify-center pr-2.5" style={{ minWidth: density === 'S' ? 58 : 76 }}>
        <span data-testid={`postep-${l.id}`} className="hmi-v10-mono font-extrabold whitespace-nowrap"
          style={{ fontSize: fs.main - 2, lineHeight: 1.1, color: stan === 'PLANNED' ? 'var(--mut)' : 'var(--ink)' }}>
          {l.qtyDone}<span style={{ color: 'var(--mut)', fontWeight: 700 }}>/{l.qty}</span>
        </span>
        <span className={duzy ? 'text-[10px] font-bold uppercase whitespace-nowrap' : 'sr-only'}
          style={{ letterSpacing: '.06em', color: s.fg, marginTop: 2 }}>
          {s.text}
        </span>
      </span>
      {/* Skan osobno: „—", gdy biuro nie wydrukowało etykiet (nie ma czego
          skanować), a nie „0 / 20" — to dwie różne sytuacje. */}
      <span data-testid={`skan-${l.id}`} title="Zeskanowane na magazyn / plan"
        className="hmi-v10-mono flex-shrink-0 flex items-center justify-center font-bold whitespace-nowrap"
        style={{
          minWidth: density === 'S' ? 62 : 74, fontSize: density === 'S' ? 13 : 15,
          borderLeft: '1px solid var(--lineSoft)', padding: '0 8px',
          color: stan === 'CONFIRMED' ? 'var(--success)' : skan.total === 0 ? 'var(--mut)' : 'var(--ink)',
        }}>
        <span aria-hidden="true" style={{ marginRight: 4, opacity: .7 }}>▥</span>
        {skan.total === 0 ? '—' : `${skan.scanned}/${l.qty}`}
      </span>
      <span aria-hidden="true" className="absolute left-0 bottom-0" style={{
        height: 3, width: `${pct}%`, background: stan === 'PLANNED' ? 'transparent'
          : stan === 'IN_PROGRESS' ? 'var(--accent)' : s.stripe,
      }} />
    </button>
  )
}
