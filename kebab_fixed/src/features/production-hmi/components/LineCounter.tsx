/**
 * Panel liczenia sztuk wybranej pozycji — stoi OBOK planu, nie zamiast niego.
 *
 * Rytm hali (01.10.2026): „pozycja 15 × 50 kg: 3 szt. Jan, 5 Anar". Operator
 * dotyka pozycję na liście, potem osobę, ilość i jeden duży przycisk
 * „Dodaj N szt. · IMIĘ". Panel nie zamyka się po zapisie ani po zrobieniu
 * planu — tę samą pozycję trzeba jeszcze zeskanować albo poprawić.
 *
 * BEZ KLAWIATURY — w rękawicy trafia się w duży przycisk, nie w cyfry
 * (decyzja właściciela 24.08.2026). Szybkie ilości 1/3/5 plus minus/plus.
 *
 * Ilość wraca do 1 przy zmianie osoby (panel jest montowany od nowa przy
 * zmianie pozycji), żeby „5 szt." nie przeszło przypadkiem na następną osobę.
 * Wybrana osoba ZOSTAJE na czas serii zapisów na tej pozycji.
 *
 * Sztuki idą w OBIE strony, ale odejmowanie jest KOREKTĄ: schowane za
 * przełącznikiem, zawsze schodzi wybranej osobie i tylko z niezeskanowanych
 * (zeskanowana sztuka leży na magazynie wyrobu gotowego). Zostaje też
 * przepisanie pracy na inną osobę (`onMoveFrom`).
 */
import { useEffect, useMemo, useState } from 'react'
import { byWorker } from '../planProgress'
import { removablePieces, scanOf, type LineScan } from '../scanProgress'
import { crewLabels } from '../crew'
import { sztukiRazyWaga, type PlanLineView } from './PlanList'

/** Jeden zapis = jedna pozycja i jedna osoba, zamrożone w chwili dotknięcia. */
export interface SaveRequest { lineId: string; workerId: string; pieces: number }

export interface SaveFeedback {
  /** Rośnie z każdym wynikiem — restartuje błysk potwierdzenia. */
  seq: number
  lineId: string
  ok: boolean
  text: string
}

export interface LineCounterProps {
  line: PlanLineView
  /** Numer pozycji na liście planu. */
  lp?: number
  workers: { id: string; name: string }[]
  selectedWorkerId: string
  onSelectWorker: (id: string) => void
  /** Dodatnio — dopisz sztuki, ujemnie — zdejmij je wybranej osobie. */
  onSave: (req: SaveRequest) => void
  /** `false` w trakcie przerwy — zapis jest wtedy odmawiany. */
  canSave: boolean
  /** Zapis w locie (dowolnej pozycji) — kolejny czeka. */
  busy?: boolean
  /** Serwer jeszcze nie oddał stanu po ostatnim zapisie tej pozycji. */
  syncing?: boolean
  /** Przepisanie sztuk wybranej osoby na kogoś innego. */
  onMoveFrom?: (workerId: string) => void
  /** Ile sztuk pozycji wygenerowano i zeskanowano — próg odejmowania. */
  scan?: LineScan
  /** Skanowanie TEJ pozycji — jedyna droga do skanu. */
  onScanLine?: (lineId: string) => void
  onDetails?: (lineId: string) => void
  feedback?: SaveFeedback | null
}

const PRESETY = [1, 3, 5] as const

export function LineCounter({
  line, lp, workers, selectedWorkerId, onSelectWorker, onSave, canSave, busy = false, syncing = false,
  onMoveFrom, scan, onScanLine, onDetails, feedback,
}: LineCounterProps) {
  const zostalo = Math.max(0, line.qty - line.qtyDone)
  const [ile, setIle] = useState(1)
  const [korekta, setKorekta] = useState(false)

  // Po zapisie zostaje mniej do zrobienia — licznik nie może wisieć nad limitem.
  // Pozycja domknięta zostawia licznik na 1: korekta wciąż z niego korzysta.
  useEffect(() => { setIle(n => Math.min(Math.max(1, n), Math.max(1, zostalo))) }, [zostalo])
  // Udana korekta wraca do dodawania — odejmowanie nie może zostać „trybem".
  useEffect(() => { if (feedback?.ok) setKorekta(false) }, [feedback?.seq, feedback?.ok])

  const etykiety = useMemo(() => crewLabels(workers), [workers])
  const wybrany = workers.find(w => w.id === selectedWorkerId) ?? null
  const imie = wybrany ? (etykiety.get(wybrany.id)?.short ?? wybrany.name) : ''
  const dorobek = new Map(byWorker(line).map(w => [w.workerId, w.pieces]))
  const skan = scanOf(scan ? { [line.id]: scan } : {}, line.id)

  const moje = wybrany ? (dorobek.get(wybrany.id) ?? 0) : 0
  const doOdjecia = Math.min(ile, moje, removablePieces(line, { [line.id]: skan }))

  const blokada = !canSave ? 'Przerwa — zapis wstrzymany'
    : busy ? 'Zapisuję…'
    : syncing ? 'Odświeżam stan pozycji…'
    : null
  const dodanie = blokada ?? (!workers.length ? 'Brak pracowników na liście'
    : !wybrany ? 'Wybierz osobę ↑'
    : zostalo === 0 ? 'Pozycja ma komplet sztuk'
    : null)
  const odjecie = blokada ?? (!wybrany ? 'Wybierz osobę ↑' : doOdjecia <= 0 ? 'Nie ma czego odjąć' : null)

  // Zmiana osoby kasuje też korektę: tryb odejmowania zostawiony po
  // poprzedniej osobie zdjąłby sztuki następnej, która nic nie poprawiała.
  const wybierzOsobe = (id: string) => {
    if (id !== selectedWorkerId) { setIle(1); setKorekta(false) }
    onSelectWorker(id)
  }
  const przepisanie = blokada ?? (!wybrany || moje <= 0 || !onMoveFrom ? 'brak' : null)
  const dodaj = () => { if (!dodanie && wybrany) onSave({ lineId: line.id, workerId: wybrany.id, pieces: ile }) }
  const odejmij = () => { if (!odjecie && wybrany) onSave({ lineId: line.id, workerId: wybrany.id, pieces: -doOdjecia }) }

  // Górna granica ilości: przy dodawaniu reszta planu, przy korekcie dorobek osoby.
  const limit = korekta ? Math.max(1, moje) : zostalo
  const fb = feedback && feedback.lineId === line.id ? feedback : null
  const kafleKolumny = workers.length <= 4 ? 2 : 3

  return (
    <div data-testid="panel-pozycji" className="phmi-panel h-full flex flex-col overflow-hidden"
      style={{ background: 'var(--panel)', border: '2px solid var(--accent)', borderRadius: 12 }}>

      {/* Nagłówek — ta sama „15 × 50 kg", co na liście, żeby oko złapało parę. */}
      <div className="flex-shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          {lp != null && (
            <span className="hmi-v10-mono text-[15px] font-extrabold flex-shrink-0"
              style={{ background: 'var(--accent)', color: '#fff', borderRadius: 7, padding: '2px 8px' }}>
              {lp}
            </span>
          )}
          <span data-testid="pozycja-naglowek" className="phmi-panel__big hmi-v10-mono font-extrabold whitespace-nowrap" style={{ letterSpacing: '-.02em' }}>
            {sztukiRazyWaga(line)}
          </span>
          <span className="phmi-panel__big ml-auto hmi-v10-mono font-extrabold whitespace-nowrap" data-testid="wykonano"
            aria-label={`Wykonano ${line.qtyDone} z ${line.qty}`}>
            {line.qtyDone}<span style={{ color: 'var(--mut)' }}>/{line.qty}</span>
          </span>
        </div>
        <div className="flex items-center gap-2 min-w-0 mt-1">
          <span className="text-[15px] font-bold truncate min-w-0">
            {line.recipeName}
            <span style={{ color: 'var(--mut)', fontWeight: 600 }}> · {line.clientName || 'na magazyn'}</span>
          </span>
          <span data-testid="skan-pozycji" className="ml-auto flex-shrink-0 hmi-v10-mono text-[13px] font-bold whitespace-nowrap"
            style={{
              padding: '3px 8px', borderRadius: 7,
              background: skan.scanned >= line.qty && line.qty > 0 ? 'var(--successSoft)' : 'var(--bg)',
              border: `1px solid ${skan.scanned >= line.qty && line.qty > 0 ? 'var(--successLine)' : 'var(--line)'}`,
              color: skan.scanned >= line.qty && line.qty > 0 ? 'var(--success)' : 'var(--mut)',
            }}>
            ▥ skan {skan.scanned} / {line.qty}
          </span>
        </div>
      </div>

      <div className="flex items-baseline justify-between flex-shrink-0">
        <span className="text-[11px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
          {korekta ? 'Korekta — czyje sztuki?' : 'Kto zrobił?'}
        </span>
        <span className="text-[12px] font-semibold" style={{ color: 'var(--mut)' }}>
          pozostało <b className="hmi-v10-mono" style={{ color: zostalo ? 'var(--amb)' : 'var(--success)' }}>{zostalo}</b> szt.
        </span>
      </div>

      {/* Kafelki załogi — 10–15 osób, dorobek osoby NA TEJ pozycji. Gdy załoga
          nie mieści się w panelu (wyjątkowo duża zmiana), siatka przewija się
          jawnie, zamiast ucinać ludzi. Rzędy rosną do 68 px, gdy jest miejsce,
          i kurczą się do 40 px — na 1280×720 mieści się 15 osób, także z paskiem
          zmian (niski panel dostaje kompaktowe odstępy, production-hmi.css). */}
      {workers.length === 0 ? (
        <div data-testid="brak-pracownikow" className="flex-1 min-h-0 flex items-center justify-center text-center px-4"
          style={{ background: 'var(--ambSoft)', border: '1px solid var(--ambLine)', borderRadius: 10, color: 'var(--amb)' }}>
          <div>
            <div className="text-[17px] font-extrabold">Brak pracowników produkcji</div>
            <div className="text-[14px] font-semibold mt-1">Biuro musi dodać ludzi z rolą „pracownik produkcji". Do tego czasu zapis jest wyłączony.</div>
          </div>
        </div>
      ) : (
        <div role="group" aria-label="Kto teraz liczy" className="phmi-panel__zaloga flex-1 min-h-0 grid overflow-y-auto"
          style={{ gridTemplateColumns: `repeat(${kafleKolumny}, minmax(0, 1fr))`,
                   gridTemplateRows: `repeat(${Math.ceil(workers.length / kafleKolumny)}, minmax(40px, 68px))`,
                   alignContent: 'start' }}>
          {workers.map(w => {
            const aktywny = w.id === selectedWorkerId
            const ma = dorobek.get(w.id) ?? 0
            const et = etykiety.get(w.id)
            return (
              <button key={w.id} type="button" data-testid={`pracownik-${w.id}`} aria-pressed={aktywny}
                aria-label={`${w.name}${ma ? `, ${ma} szt. na tej pozycji` : ''}`}
                onClick={() => wybierzOsobe(w.id)}
                className="phmi-touch phmi-btn flex flex-col justify-center min-w-0 px-2.5 active:scale-[.98] transition-transform"
                style={{
                  borderRadius: 9, textAlign: 'left',
                  background: aktywny ? (korekta ? 'var(--red)' : 'var(--accent)') : 'var(--panel)',
                  border: `${aktywny ? 2 : 1.5}px solid ${aktywny ? (korekta ? 'var(--red)' : 'var(--accent)') : 'var(--line)'}`,
                  color: aktywny ? '#fff' : 'var(--ink)',
                }}>
                <span className="text-[16px] font-extrabold leading-tight truncate w-full">{et?.first ?? w.name}</span>
                <span className="flex items-baseline gap-1 w-full min-w-0 leading-tight">
                  <span className="text-[11px] font-semibold truncate flex-1 min-w-0"
                    style={{ color: aktywny ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>{et?.rest}</span>
                  {ma > 0 && (
                    <span className="hmi-v10-mono text-[12px] font-extrabold flex-shrink-0"
                      style={{ color: aktywny ? '#fff' : 'var(--accent)' }}>{ma} szt.</span>
                  )}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {/* Ilość: szybkie 1/3/5, potem minus/plus do reszty. */}
      <div className="phmi-panel__ile flex items-stretch gap-1.5 flex-shrink-0">
        {PRESETY.map(n => {
          const off = n > Math.max(1, limit)
          return (
            <button key={n} type="button" data-testid={`ile-${n}`} aria-pressed={ile === n} disabled={off}
              onClick={() => setIle(n)} aria-label={`${n} szt.`}
              className="phmi-touch phmi-btn hmi-v10-mono text-[20px] font-extrabold"
              style={{ width: 52, borderRadius: 9,
                       background: ile === n ? 'var(--ink)' : 'var(--bg)', color: ile === n ? '#fff' : 'var(--ink)',
                       border: '1.5px solid var(--line)', opacity: off ? .35 : 1 }}>
              {n}
            </button>
          )
        })}
        <span className="flex-1" />
        <button type="button" aria-label="mniej" disabled={ile <= 1} onClick={() => setIle(n => Math.max(1, n - 1))}
          className="phmi-touch phmi-btn text-[28px] font-extrabold leading-none"
          style={{ width: 52, borderRadius: 9, background: 'var(--bg)', border: '1.5px solid var(--line)', opacity: ile <= 1 ? .35 : 1 }}>
          −
        </button>
        <div className="flex flex-col items-center justify-center" style={{ minWidth: 58 }}>
          <b data-testid="licznik" className="hmi-v10-mono text-[28px] font-extrabold leading-none">{ile}</b>
          <span className="hmi-v10-mono text-[11px] font-bold" style={{ color: 'var(--mut)' }}>= {kgSuma(ile, line.kgPerUnit)} kg</span>
        </div>
        {/* Granicę trzyma `disabled`; strona i tak przycina zapis do reszty planu. */}
        <button type="button" aria-label="więcej" disabled={ile >= limit} onClick={() => setIle(n => Math.min(n + 1, Math.max(1, limit)))}
          className="phmi-touch phmi-btn text-[28px] font-extrabold leading-none"
          style={{ width: 52, borderRadius: 9, background: 'var(--accent)', color: '#fff', border: 0,
                   opacity: ile >= limit ? .35 : 1 }}>
          +
        </button>
      </div>

      {/* Potwierdzenie zapisu na miejscu — bez modala sukcesu. Stała wysokość:
          komunikat nie może przesuwać przycisku pod kciukiem. */}
      <div key={fb?.seq ?? 0} role="status" aria-live="polite" data-testid="wynik-zapisu"
        className={`phmi-panel__wynik flex-shrink-0 flex items-center px-3 text-[14px] font-bold truncate ${fb?.ok ? 'phmi-flash' : ''}`}
        style={{
          borderRadius: 8,
          background: fb ? (fb.ok ? 'var(--successSoft)' : 'var(--redSoft)') : 'transparent',
          border: `1px solid ${fb ? (fb.ok ? 'var(--successLine)' : 'var(--redLine)') : 'transparent'}`,
          color: fb ? (fb.ok ? 'var(--success)' : 'var(--red)') : 'var(--mut)',
        }}>
        {fb ? `${fb.ok ? '✓' : '✕'} ${fb.text}` : (wybrany ? `Liczy: ${wybrany.name}` : 'Wybierz osobę, ilość i dodaj')}
      </div>

      {korekta ? (
        <div className="phmi-panel__glowny flex gap-2 flex-shrink-0">
          <button type="button" data-testid="odejmij" onClick={odejmij} disabled={!!odjecie}
            className="phmi-touch phmi-btn flex-1 min-w-0 text-[18px] font-extrabold truncate px-2"
            style={{ borderRadius: 10, background: 'var(--redSoft)', border: '2px solid var(--red)', color: 'var(--red)',
                     opacity: odjecie ? .45 : 1 }}>
            {odjecie ?? `Odejmij ${doOdjecia} szt. · ${imie}`}
          </button>
          <button type="button" data-testid="przepisz" disabled={!!przepisanie}
            onClick={() => { if (!przepisanie && wybrany) onMoveFrom?.(wybrany.id) }}
            className="phmi-touch phmi-btn text-[15px] font-bold px-3"
            style={{ borderRadius: 10, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)',
                     opacity: przepisanie ? .45 : 1 }}>
            Przepisz na…
          </button>
        </div>
      ) : (
        <button type="button" data-testid="zapisz" onClick={dodaj} disabled={!!dodanie}
          className="phmi-panel__glowny phmi-touch phmi-btn flex-shrink-0 text-[21px] font-extrabold truncate px-3"
          style={{ borderRadius: 10, border: 0, background: dodanie ? 'var(--barBg)' : 'var(--accent)',
                   color: dodanie ? 'var(--ink)' : '#fff', opacity: dodanie ? .75 : 1 }}>
          {dodanie ?? `Dodaj ${ile} szt. · ${imie}`}
        </button>
      )}

      <div className="phmi-panel__akcje flex gap-2 flex-shrink-0">
        {onScanLine && (
          // Skan czeka na koniec zapisu sztuk — inaczej odświeżenie po skanie
          // i zapis tej samej pozycji ścigałyby się o jej stan.
          // Krótki napis: to GŁÓWNA droga skanu i nie może kończyć się „…".
          <button type="button" data-testid="skanuj-pozycje" disabled={busy || syncing}
            aria-label="Skanuj tę pozycję"
            onClick={() => { if (!busy && !syncing) onScanLine(line.id) }}
            className="phmi-touch phmi-btn flex-1 min-w-0 text-[15px] font-bold whitespace-nowrap px-2"
            style={{ borderRadius: 9, border: '1.5px solid var(--accent)', color: 'var(--accent)', background: 'var(--accentSoft)',
                     opacity: busy || syncing ? .45 : 1 }}>
            <span aria-hidden="true">▥</span> Skanuj pozycję
          </button>
        )}
        <button type="button" data-testid="korekta" aria-pressed={korekta} onClick={() => { setKorekta(k => !k); setIle(1) }}
          className="phmi-touch phmi-btn text-[14px] font-bold px-3"
          style={{ borderRadius: 9, border: `1.5px solid ${korekta ? 'var(--red)' : 'var(--line)'}`,
                   background: korekta ? 'var(--red)' : 'var(--panel)', color: korekta ? '#fff' : 'var(--ink)' }}>
          {/* Oba napisy tej samej długości — przełączenie nie zwęża skanu. */}
          {korekta ? '← Dodaj' : 'Korekta'}
        </button>
        {onDetails && (
          <button type="button" data-testid="szczegoly" onClick={() => onDetails(line.id)}
            className="phmi-touch phmi-btn text-[14px] font-bold px-3"
            style={{ borderRadius: 9, border: '1.5px solid var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}>
            Szczegóły
          </button>
        )}
      </div>
    </div>
  )
}

const kgSuma = (n: number, kg: number) => Math.round(n * kg * 100) / 100

/** Panel przed wybraniem pozycji — mówi, co zrobić, zamiast stać pusty. */
export function LineCounterEmpty({ hasLines }: { hasLines: boolean }) {
  return (
    <div data-testid="panel-pusty" className="h-full flex flex-col items-center justify-center text-center px-6"
      style={{ background: 'var(--panel)', border: '1.5px dashed var(--line)', borderRadius: 12 }}>
      {hasLines ? (
        <>
          <div className="text-[44px] leading-none" aria-hidden="true" style={{ color: 'var(--accent)' }}>←</div>
          <div className="text-[21px] font-extrabold mt-3">Dotknij pozycję planu</div>
          <ol className="text-[15px] font-semibold mt-3 text-left" style={{ color: 'var(--mut)', lineHeight: 1.7 }}>
            <li>1. pozycja z listy</li>
            <li>2. osoba, która zrobiła sztuki</li>
            <li>3. ilość i „Dodaj"</li>
          </ol>
          <div className="text-[13px] font-semibold mt-4" style={{ color: 'var(--mut)' }}>
            Przytrzymaj pozycję — partie, tuleja i rozliczenie.
          </div>
        </>
      ) : (
        <div className="text-[17px] font-bold" style={{ color: 'var(--mut)' }}>Nie ma czego liczyć — czekamy na plan z biura.</div>
      )}
    </div>
  )
}
