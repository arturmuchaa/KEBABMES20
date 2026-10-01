/**
 * Skanowanie gotowych kebabów JEDNEJ pozycji — sztuka wchodzi na magazyn
 * wyrobu gotowego.
 *
 * Jedna droga (01.10.2026): pozycję wybiera się na głównej liście planu,
 * a „Skanuj tę pozycję" w panelu otwiera od razu pole czytnika. Okno nie ma
 * własnej listy pozycji ani „Zmień pozycję" — druga lista wyboru była drugim
 * miejscem na pomyłkę. Następny wózek = powrót do planu i dotknięcie pozycji.
 *
 * Skaner na hali zachowuje się jak klawiatura: wystukuje kod — i Entera
 * często NIE wciska (hala 25.09.2026). Pole wysyła kompletny kod samo, przez
 * wspólny `useSkanAutoSubmit`; Enter, jeśli przyjdzie, jest bezczynny.
 * Dźwięk po każdym skanie jest ważniejszy niż komunikat: operator patrzy
 * w wózek, nie w monitor.
 *
 * Kolejka: operator skanuje szybciej, niż wraca odpowiedź. Każdy kod dostaje
 * id pozycji W CHWILI PRZYJĘCIA i z nim idzie na serwer. Okna nie da się
 * zamknąć, dopóki kolejka nie jest rozliczona — inaczej skan wisiałby
 * w powietrzu, a operator myślałby, że wszedł.
 *
 * Sztuka z innej pozycji odbija się na serwerze z nazwą właściwej — tego NIE
 * nazywamy duplikatem, bo komunikat mówi operatorowi, gdzie odłożyć wózek.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { beepErr, beepOk } from '@/features/pwa/beep'
import { useSkanAutoSubmit } from '@/features/scan/useSkanAutoSubmit'
import { scanOf, type LineScan } from '../scanProgress'
import { useModalFocus } from '../useModalFocus'
import { sztukiRazyWaga, type PlanLineView } from './PlanList'

export interface ScanResult {
  clientName?: string
  batchNo?: string
  weightKg?: number
  done?: number
  total?: number
  onStock?: boolean
  planLineId?: string
}

export interface ScanPanelProps {
  /** Pozycja wybrana na liście planu — jedyna, którą to okno skanuje. */
  line: PlanLineView
  lp: number
  /** Postęp skanowania tej pozycji z serwera. */
  scan?: LineScan
  onScan: (code: string, lineId: string) => Promise<ScanResult>
  onClose: () => void
}

/** Sztuka z cudzej pozycji — serwer podaje, z której („Ta sztuka jest z pozycji 2 (KIRMIZI)"). */
const czyObcaPozycja = (e: any): boolean => {
  const t = String(e?.message ?? '').toLowerCase()
  return t.includes('z pozycji') || t.includes('innej pozycji')
}
/** Dubel poznajemy PO TREŚCI, nie po kodzie 409 — obca pozycja też jest 409. */
const czyDubel = (e: any): boolean => {
  const t = String(e?.message ?? '').toLowerCase()
  return t.includes('duplikat') || t.includes('already') || t.includes('zeskanowan')
}

type Wynik = { ok: boolean; tytul: string; tekst: string; wynik?: ScanResult }

export function ScanPanel({ line, lp, scan, onScan, onClose }: ScanPanelProps) {
  // Pozycja zamrożona przy otwarciu: odświeżenie planu może zmienić jej
  // dane, ale nie to, DOKĄD idą skany z tego okna.
  const [lineId] = useState(line.id)
  const [kod, setKod] = useState('')
  const [wKolejce, setWKolejce] = useState(0)
  const [ostatni, setOstatni] = useState<Wynik | null>(null)
  const [ile, setIle] = useState(0)
  const pole = useRef<HTMLInputElement | null>(null)
  const okno = useRef<HTMLDivElement | null>(null)
  // `true` w SETUP, `false` w sprzątaniu. Samo `useRef(true)` + sprzątanie
  // psuło się w React.StrictMode (setup → cleanup → setup): flaga zostawała
  // na `false` i wynik skanu, dźwięk ani zdjęcie „zapisuję…" nigdy nie
  // przychodziły — a prawdziwy entry kiosku (`produkcja.tsx`) ma StrictMode.
  const zamontowany = useRef(false)
  const timerFokusu = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    zamontowany.current = true
    return () => {
      zamontowany.current = false
      if (timerFokusu.current) clearTimeout(timerFokusu.current)
      timerFokusu.current = null
    }
  }, [])
  useModalFocus(okno, pole)

  // Po wyniku skaner ma być gotowy na następną sztukę — ale fokus NIE jest
  // zabierany przyciskowi, w który operator właśnie celuje (np. „Wróć").
  const wroc = () => {
    if (timerFokusu.current) clearTimeout(timerFokusu.current)
    timerFokusu.current = setTimeout(() => {
      timerFokusu.current = null
      if (!zamontowany.current) return
      const a = document.activeElement as HTMLElement | null
      const naPrzycisku = !!a && a !== pole.current && !!okno.current?.contains(a)
        && a.tagName === 'BUTTON' && !(a as HTMLButtonElement).disabled
      if (!naPrzycisku) pole.current?.focus()
    }, 30)
  }

  const kolejka = useRef<{ code: string; lineId: string }[]>([])
  const wTrakcie = useRef(false)

  const przetworz = async () => {
    if (wTrakcie.current) return
    wTrakcie.current = true
    try {
      while (kolejka.current.length) {
        const { code, lineId: doPozycji } = kolejka.current[0]
        try {
          const wynik = await onScan(code, doPozycji)
          if (!zamontowany.current) continue
          const komplet = line.qty > 0 && (wynik.done ?? 0) >= line.qty
          setOstatni({
            ok: true,
            tytul: komplet ? 'Pozycja potwierdzona' : wynik.onStock === false ? 'Zeskanowano' : 'Na magazynie',
            tekst: [wynik.clientName, wynik.batchNo, wynik.weightKg != null ? `${wynik.weightKg} kg` : '']
              .filter(Boolean).join(' · '),
            wynik,
          })
          setIle(n => n + 1)
          beepOk()
        } catch (e: any) {
          if (!zamontowany.current) continue
          setOstatni(czyObcaPozycja(e)
            ? { ok: false, tytul: 'Sztuka z innej pozycji — odłóż ją', tekst: e?.message || '' }
            : czyDubel(e)
              ? { ok: false, tytul: 'Ta sztuka jest już zeskanowana', tekst: 'Drugi raz nie wchodzi na magazyn.' }
              : { ok: false, tytul: 'Nie weszła', tekst: e?.message || 'Nie udało się zeskanować' })
          beepErr()
        } finally {
          kolejka.current.shift()
          if (zamontowany.current) setWKolejce(kolejka.current.length)
        }
      }
    } finally {
      wTrakcie.current = false
      if (zamontowany.current) wroc()
    }
  }

  const wyslij = (surowy: string) => {
    const code = surowy.trim()
    // Okno zamknięte: kod, który dojrzewał do auto-wysyłki, przepada — nie
    // może trafić na pozycję, której operator już nie ogląda.
    if (!zamontowany.current) return
    setKod('')
    if (!code) return
    kolejka.current.push({ code, lineId })
    setWKolejce(kolejka.current.length)
    void przetworz()
  }

  const { zatwierdz } = useSkanAutoSubmit(kod, wyslij)

  const zajety = wKolejce > 0
  const sprobujZamknac = useCallback(() => {
    if (kolejka.current.length || wTrakcie.current) return
    setKod('')
    onClose()
  }, [onClose])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); sprobujZamknac() } }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [sprobujZamknac])

  // Licznik pozycji z serwera; odpowiedź skanu niesie świeższą liczbę niż
  // odświeżenie planu, więc bierzemy większą z dwóch serwerowych wartości.
  const s = scanOf(scan ? { [lineId]: scan } : {}, lineId)
  const naPozycji = Math.max(s.scanned, ostatni?.ok ? (ostatni.wynik?.done ?? 0) : 0)
  const ramka = ostatni
    ? (ostatni.ok
        ? { background: 'var(--successSoft)', border: '1px solid var(--successLine)', color: 'var(--success)' }
        : { background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' })
    : { background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--mut)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6" style={{ background: 'rgba(15,23,42,.38)' }}>
      <div ref={okno} role="dialog" aria-modal="true" aria-labelledby="skan-tytul" data-testid="okno-skanu"
        className="flex flex-col gap-4 overflow-y-auto" style={{
          width: 880, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)', padding: 22,
          border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
        }}>
        <div className="flex items-center gap-4 flex-shrink-0">
          <span className="hmi-v10-mono text-[22px] font-extrabold flex-shrink-0"
            style={{ background: 'var(--accent)', color: '#fff', borderRadius: 9, padding: '6px 13px' }}>{lp}</span>
          <div className="min-w-0 flex-1">
            <h3 id="skan-tytul" className="m-0 text-[13px] font-bold uppercase" style={{ letterSpacing: '.12em', color: 'var(--mut)' }}>
              Skanowanie pozycji
            </h3>
            <p data-testid="wybrana-pozycja" className="m-0 text-[24px] font-extrabold truncate">
              <span className="hmi-v10-mono">{sztukiRazyWaga(line)}</span> · {line.recipeName}
              <span style={{ color: 'var(--mut)', fontWeight: 600 }}> · {line.clientName || 'na magazyn'}</span>
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <div data-testid="postep-pozycji" className="hmi-v10-mono text-[28px] font-extrabold leading-none">
              {naPozycji} / {line.qty}
            </div>
            <div className="text-[10px] font-bold uppercase mt-1" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>zeskanowane na pozycji</div>
          </div>
        </div>

        <form onSubmit={e => { e.preventDefault(); zatwierdz(kod) }}>
          <input ref={pole} data-testid="pole-skanu" aria-label="Pole skanowania" value={kod}
            onChange={e => setKod(e.target.value)}
            placeholder="Zeskanuj kod QR sztuki" autoComplete="off" spellCheck={false}
            className="w-full hmi-v10-mono text-[22px] font-bold"
            style={{ padding: '18px 20px', borderRadius: 10, background: 'var(--panel)',
                     border: '2px solid var(--accent)', color: 'var(--ink)' }} />
        </form>

        <div data-testid="ostatni-skan" role="status" aria-live="polite" className="flex items-center gap-4"
          style={{ ...ramka, borderRadius: 12, padding: '16px 20px', minHeight: 88 }}>
          <span className="text-[30px] leading-none" aria-hidden="true">{ostatni ? (ostatni.ok ? '✓' : '✕') : '·'}</span>
          <div className="min-w-0 flex-1">
            <div className="text-[20px] font-extrabold">{ostatni ? ostatni.tytul : 'Czekam na skan'}</div>
            <div className="text-[15px] font-semibold mt-0.5">{ostatni?.tekst || (ostatni ? '' : 'Przyłóż czytnik do etykiety')}</div>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--mut)' }}>Zeskanowano teraz</span>
          <b data-testid="zeskanowano-teraz" className="hmi-v10-mono text-[24px] font-extrabold" style={{ color: 'var(--accent)' }}>{ile}</b>
          {zajety && (
            <span data-testid="kolejka-skanow" className="text-[14px] font-bold" style={{ color: 'var(--amb)' }}>
              · zapisuję {wKolejce} {wKolejce === 1 ? 'skan' : 'skany'}…
            </span>
          )}
          <button type="button" data-testid="zamknij-skan" onClick={sprobujZamknac} disabled={zajety}
            className="phmi-btn ml-auto text-base font-bold"
            style={{ height: 56, padding: '0 26px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)',
                     background: 'var(--bg)', opacity: zajety ? .5 : 1 }}>
            {zajety ? 'Czekaj — zapisuję' : '← Wróć do planu'}
          </button>
        </div>
      </div>
    </div>
  )
}
