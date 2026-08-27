/**
 * Skanowanie gotowych kebabów — sztuka wchodzi na magazyn wyrobu gotowego.
 *
 * Skaner na hali zachowuje się jak klawiatura: wystukuje kod i wciska Enter.
 * Dlatego całe wejście to jedno pole, które samo trzyma kursor i samo się
 * czyści — operator ma zajęte ręce i nie będzie klikał w ekran między
 * sztukami. Dźwięk po każdym skanie jest ważniejszy niż komunikat: kebab
 * zwykle patrzy w wózek, nie w monitor.
 *
 * Skan jest zamknięty na JEDNĄ pozycję planu (27.08.2026). Hala przekłada
 * wózek pozycja po pozycji, więc operator najpierw wskazuje „poz. 1 · 20×40 kg",
 * a dopiero potem skanuje. Sztuka z innej pozycji odbija się na serwerze —
 * pilnowanie tego wyłącznie w UI byłoby pozorne, bo skaner wystukuje, co ma
 * pod ręką.
 */
import { useEffect, useRef, useState } from 'react'
import { beepErr, beepOk } from '@/features/pwa/beep'
import { scanOf, type ScanMap } from '../scanProgress'
import type { PlanLineView } from './PlanList'

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
  /** Pozycje planu dnia — operator wybiera, którą teraz skanuje. */
  lines: PlanLineView[]
  /** Postęp skanowania per pozycja (ile wygenerowano / ile zeskanowano). */
  scans?: ScanMap
  /** Pozycja wskazana z licznika („Skanuj tę pozycję") — omija wybór. */
  initialLineId?: string
  onScan: (code: string, lineId: string) => Promise<ScanResult>
  onClose: () => void
}

/** Dubel poznajemy PO TREŚCI, nie po kodzie 409.
 *  Odbicie sztuki z obcej pozycji też jest 409, a jego komunikat mówi
 *  operatorowi, gdzie odłożyć wózek — nie wolno go zamienić na „już jest". */
const czyDubel = (e: any): boolean => {
  const t = String(e?.message ?? '').toLowerCase()
  return t.includes('duplikat') || t.includes('already') || t.includes('zeskanowan')
}

const kg = (n: number) => `${Math.round(n * 100) / 100} kg`

export function ScanPanel({ lines, scans, initialLineId, onScan, onClose }: ScanPanelProps) {
  const [pozycjaId, setPozycjaId] = useState(initialLineId ?? '')
  const [kod, setKod] = useState('')
  const [zajety, setZajety] = useState(false)
  const [ostatni, setOstatni] = useState<{ ok: boolean; tekst: string; wynik?: ScanResult } | null>(null)
  const [ile, setIle] = useState(0)
  const pole = useRef<HTMLInputElement | null>(null)

  const pozycja = lines.find(l => l.id === pozycjaId) ?? null
  const lp = pozycja ? lines.findIndex(l => l.id === pozycja.id) + 1 : 0

  const wroc = () => setTimeout(() => pole.current?.focus(), 30)
  // Kursor wraca do pola także po WYBORZE pozycji — inaczej pierwszy skan
  // z czytnika po wejściu w tryb skanu poszedłby w próżnię.
  useEffect(() => { if (pozycja) wroc() }, [pozycjaId])

  const wybierz = (id: string) => {
    setPozycjaId(id)
    // Nowy wózek — licznik sesji z poprzedniej pozycji wprowadzałby w błąd.
    setIle(0)
    setOstatni(null)
  }

  const wyslij = async (surowy: string) => {
    const code = surowy.trim()
    if (!code || zajety || !pozycja) return
    setZajety(true)
    try {
      const wynik = await onScan(code, pozycja.id)
      setOstatni({
        ok: true,
        tekst: [wynik.clientName, wynik.batchNo, wynik.weightKg != null ? `${wynik.weightKg} kg` : '']
          .filter(Boolean).join(' · '),
        wynik,
      })
      setIle(n => n + 1)
      beepOk()
    } catch (e: any) {
      setOstatni({
        ok: false,
        tekst: czyDubel(e) ? 'Ta sztuka jest już zeskanowana' : (e?.message || 'Nie udało się zeskanować'),
      })
      beepErr()
    } finally {
      setZajety(false)
      setKod('')
      wroc()
    }
  }

  const ramka = ostatni
    ? (ostatni.ok
        ? { background: 'var(--successSoft)', border: '1px solid var(--successLine)', color: 'var(--success)' }
        : { background: 'var(--redSoft)', border: '1px solid var(--redLine)', color: 'var(--red)' })
    : { background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--mut)' }

  const komplet = !!ostatni?.ok && ostatni.wynik?.total != null
    && (ostatni.wynik.done ?? 0) >= (ostatni.wynik.total ?? 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-8" style={{ background: 'rgba(15,23,42,.34)' }}>
      <div className="flex flex-col gap-5 p-6" style={{
        width: 900, maxWidth: '100%', maxHeight: '100%', borderRadius: 14, background: 'var(--panel)',
        border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)',
      }}>
        <div className="flex items-center gap-4 flex-shrink-0">
          <div className="flex items-center justify-center flex-shrink-0 text-[26px]" style={{
            width: 56, height: 56, borderRadius: 12,
            background: 'var(--accentSoft)', border: '1px solid #C7CCFB', color: 'var(--accent)',
          }}>▥</div>
          <div className="min-w-0">
            <h3 className="m-0 text-[22px] font-extrabold" style={{ letterSpacing: '-.01em' }}>Skanowanie kebabów</h3>
            {pozycja ? (
              <p data-testid="wybrana-pozycja" className="m-0 mt-0.5 text-sm font-bold truncate" style={{ color: 'var(--accent)' }}>
                Poz. {lp} · {pozycja.qty} szt. × {kg(pozycja.kgPerUnit)} · {pozycja.recipeName}
                {pozycja.clientName ? ` · ${pozycja.clientName}` : ' · na magazyn'}
              </p>
            ) : (
              <p className="m-0 mt-0.5 text-sm font-bold" style={{ color: 'var(--mut)' }}>
                Wybierz pozycję, którą teraz skanujesz
              </p>
            )}
          </div>
          {pozycja && (
            <button type="button" data-testid="zmien-pozycje" onClick={() => wybierz('')}
              className="ml-auto text-[14px] font-bold flex-shrink-0"
              style={{ height: 44, padding: '0 18px', borderRadius: 9,
                       border: '1px solid var(--line)', color: 'var(--ink)', background: 'var(--bg)' }}>
              Zmień pozycję
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="Zamknij"
            className={`text-[20px] flex-shrink-0 ${pozycja ? '' : 'ml-auto'}`} style={{ color: 'var(--mut)' }}>✕</button>
        </div>

        {!pozycja ? (
          <div className="flex flex-col gap-2.5 overflow-auto" style={{ minHeight: 120 }}>
            {lines.length === 0 ? (
              <div className="text-center py-10">
                <div className="text-xl font-extrabold">Biuro nie zaplanowało dziś produkcji</div>
                <div className="text-base mt-2" style={{ color: 'var(--mut)' }}>Nie ma czego skanować.</div>
              </div>
            ) : lines.map((l, i) => {
              const s = scanOf(scans, l.id)
              const gotowa = s.total > 0 && s.scanned >= l.qty
              return (
                <button key={l.id} type="button" data-testid={`pozycja-${l.id}`} onClick={() => wybierz(l.id)}
                  className="flex items-center gap-4 text-left active:scale-[.99] transition-transform"
                  style={{
                    padding: '16px 18px', borderRadius: 12, background: gotowa ? 'var(--successSoft)' : 'var(--bg)',
                    border: `1.5px solid ${gotowa ? 'var(--successLine)' : 'var(--line)'}`,
                  }}>
                  <span className="hmi-v10-mono text-[22px] font-extrabold flex-shrink-0"
                    style={{ width: 40, color: 'var(--mut)' }}>{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[19px] font-extrabold truncate">
                      {l.qty} szt. × {kg(l.kgPerUnit)} · {l.recipeName}
                    </span>
                    <span className="block text-[14px] font-semibold mt-0.5" style={{ color: 'var(--mut)' }}>
                      {l.clientName || '— na magazyn —'}{l.packagingName ? ` · ${l.packagingName}` : ''}
                    </span>
                  </span>
                  {s.total === 0 ? (
                    <span className="text-[13px] font-bold flex-shrink-0" style={{ color: 'var(--amb)' }}>
                      Brak etykiet
                    </span>
                  ) : (
                    <span className="text-right flex-shrink-0">
                      <span className="hmi-v10-mono text-[22px] font-extrabold block"
                        style={{ color: gotowa ? 'var(--success)' : 'var(--ink)' }}>
                        {s.scanned} / {s.total}
                      </span>
                      <span className="text-[10px] font-bold uppercase" style={{ letterSpacing: '.1em', color: 'var(--mut)' }}>
                        {gotowa ? 'potwierdzona' : 'zeskanowane'}
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        ) : (
          <>
            <form onSubmit={e => { e.preventDefault(); wyslij(kod) }}>
              <input ref={pole} data-testid="pole-skanu" value={kod} onChange={e => setKod(e.target.value)}
                placeholder="Zeskanuj kod QR sztuki" autoFocus autoComplete="off" spellCheck={false}
                className="w-full hmi-v10-mono text-[22px] font-bold"
                style={{ padding: '18px 20px', borderRadius: 10, background: 'var(--panel)',
                         border: '2px solid var(--accent)', color: 'var(--ink)' }} />
            </form>

            <div data-testid="ostatni-skan" className="flex items-center gap-4" style={{ ...ramka, borderRadius: 12, padding: '18px 20px', minHeight: 92 }}>
              <span className="text-[30px] leading-none">{ostatni ? (ostatni.ok ? '✓' : '✕') : '·'}</span>
              <div className="min-w-0 flex-1">
                <div className="text-[19px] font-extrabold">
                  {ostatni
                    ? (ostatni.ok
                        ? (komplet ? 'Pozycja potwierdzona'
                                   : ostatni.wynik?.onStock === false ? 'Zeskanowano' : 'Na magazynie')
                        : 'Nie weszła')
                    : 'Czekam na skan'}
                </div>
                <div className="text-[15px] font-semibold mt-0.5">{ostatni?.tekst || 'Przyłóż czytnik do etykiety'}</div>
              </div>
              {ostatni?.ok && ostatni.wynik?.total != null && (
                <div className="text-right flex-shrink-0">
                  <div data-testid="postep-pozycji" className="hmi-v10-mono text-[26px] font-extrabold">
                    {ostatni.wynik.done} / {ostatni.wynik.total}
                  </div>
                  <div className="text-[10px] font-bold uppercase" style={{ letterSpacing: '.1em' }}>na pozycji</div>
                </div>
              )}
            </div>
          </>
        )}

        <div className="flex items-center gap-3 pt-3 flex-shrink-0" style={{ borderTop: '1px solid var(--line)' }}>
          <span style={{ color: 'var(--mut)' }}>Zeskanowano teraz</span>
          <b data-testid="zeskanowano-teraz" className="hmi-v10-mono text-[24px] font-extrabold" style={{ color: 'var(--accent)' }}>{ile}</b>
          <button type="button" onClick={onClose} className="ml-auto text-base font-bold"
            style={{ height: 56, padding: '0 28px', borderRadius: 10, border: '1px solid var(--line)', color: 'var(--ink)' }}>
            Zamknij
          </button>
        </div>
      </div>
    </div>
  )
}
