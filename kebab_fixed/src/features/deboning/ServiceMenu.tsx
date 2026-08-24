/**
 * ServiceMenu — wejście serwisowe kiosku Rozbiór (HMI v10 + ekran logowania).
 *
 * Przytrzymanie „sekretnego" elementu (klawisz "." numpada wagi albo tytuł
 * ekranu) przez SERVICE_HOLD_MS otwiera modal z WŁASNYM polem kodu — dopiero
 * tam wpisuje się SERVICE_CODE. Kod celowo NIE jest wykrywany w polach wagi:
 * cyfry lądowały w ramce mięsa, a detekcja przez side-effect w updaterze
 * setState była zawodna (React nie gwarantuje momentu wykonania updatera).
 *
 * Po poprawnym kodzie modal pokazuje akcję wylogowania z Windows — konto
 * operatora ma jako powłokę ten kiosk (per-user Shell w rejestrze), więc to
 * jedyna droga powrotu do pulpitu / logowania na konto Administrator bez
 * fizycznego dostępu do BIOS-u.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { Delete, History, LogOut, Printer, Wrench } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { BASE } from '@/lib/api'
import { getDevices, sendZpl } from '@/lib/zebra'
import { byproductLabelZpl } from '@/features/deboning/byproductLabelZpl'
import {
  CALIBRATE_ZPL, TEAR_OFF_STORAGE_KEY, tearOffMaxMm, tearOffZpl,
} from '@/features/deboning/labelPrinterSetup'

export const SERVICE_CODE = '0099'
export const SERVICE_HOLD_MS = 3000

declare const __ROZBIOR_V10_VERSION__: string

async function triggerServiceLogoff() {
  if (!('__TAURI_INTERNALS__' in window)) return // web (nie-kiosk) — brak Tauri, nic nie rób
  try {
    await invoke('windows_logoff')
  } catch (e) {
    console.error('windows_logoff failed', e)
  }
}

/** Przytrzymanie elementu SERVICE_HOLD_MS → onTrigger. Zwraca props do rozsmarowania
 *  na elemencie oraz firedAtRef (guard przed „duchowym" clickiem po zwolnieniu). */
export function useServiceHold(onTrigger: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firedAtRef = useRef(0)
  const onHoldStart = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      firedAtRef.current = Date.now()
      onTrigger()
    }, SERVICE_HOLD_MS)
  }, [onTrigger])
  const onHoldEnd = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [])
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
  const holdProps = {
    onPointerDown: onHoldStart,
    onPointerUp: onHoldEnd,
    onPointerLeave: onHoldEnd,
    onPointerCancel: onHoldEnd,
  } as const
  return { holdProps, onHoldStart, onHoldEnd, firedAtRef }
}

// Własne tokeny — modal musi wyglądać tak samo niezależnie od tego, czy strona
// pod spodem zdefiniowała zmienne HMI (ekran logowania ma inny zestaw).
const SVC_VARS: CSSProperties = {
  ['--svcBg' as string]:      '#E7EAEE',
  ['--svcPanel' as string]:   '#FFFFFF',
  ['--svcInk' as string]:     '#0F172A',
  ['--svcMut' as string]:     '#5B6472',
  ['--svcLine' as string]:    '#D8DEE6',
  ['--svcRed' as string]:     '#DC2626',
  ['--svcRedLine' as string]: '#FECACA',
}
const MONO = '"JetBrains Mono", "Cascadia Mono", Consolas, monospace'

/**
 * Menu serwisowe stanowiska.
 *
 * `channel` i `version` MUSZĄ pochodzić z tego kiosku, w którym menu stoi —
 * inaczej serwisant przy jednym panelu cofnąłby wersję drugiego (menu jest
 * współdzielone przez stanowiska od czasu wydzielenia wspólnej ramy kiosku).
 */
export function ServiceMenuModal({
  open,
  onClose,
  channel = 'rozbior-v10',
  version = __ROZBIOR_V10_VERSION__,
  buildLabel = `HMI v10 · ${version}`,
}: {
  open: boolean
  onClose: () => void
  channel?: string
  version?: string
  buildLabel?: string
}) {
  const [code, setCode] = useState('')
  const [ok,   setOk]   = useState(false)
  const [err,  setErr]  = useState(false)
  const [scaleDiag, setScaleDiag] = useState<string | null>(null)
  // Rollback wersji: poprzednia wersja z serwera + status operacji.
  const [prevVersion, setPrevVersion] = useState<string | null>(null)
  const [rollbackMsg, setRollbackMsg] = useState<string | null>(null)
  const [rollbackBusy, setRollbackBusy] = useState(false)

  useEffect(() => { if (open) { setCode(''); setOk(false); setErr(false); setScaleDiag(null); setRollbackMsg(null); setRollbackBusy(false) } }, [open])

  // Po poprawnym kodzie pobierz listę wersji — „poprzednia" = pierwsza inna
  // niż aktualnie uruchomiona (rollback po złej aktualizacji).
  useEffect(() => {
    if (!ok) return
    setPrevVersion(null)
    fetch(`${BASE}/desktop-updates/${channel}/versions`)
      .then(r => r.json())
      .then((d: { versions?: { version: string }[] }) => {
        const prev = (d.versions ?? []).find(v => v.version !== version)
        setPrevVersion(prev?.version ?? null)
      })
      .catch(() => setPrevVersion(null))
  }, [ok, channel, version])

  const doRollback = useCallback(async () => {
    if (!prevVersion || rollbackBusy) return
    setRollbackBusy(true)
    setRollbackMsg(`Przywracam ${prevVersion}…`)
    try {
      const res = await fetch(`${BASE}/desktop-updates/${channel}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: SERVICE_CODE, version: prevVersion }),
      })
      if (!res.ok) {
        const e = await res.json().catch(() => ({}))
        throw new Error((e as any).detail || `HTTP ${res.status}`)
      }
      if ('__TAURI_INTERNALS__' in window) {
        setRollbackMsg(`Serwer przywrócony na ${prevVersion}. Instaluję — kiosk zrestartuje się sam…`)
        // Instalacja + restart robi się sama; jeśli wróci z komunikatem, pokaż go.
        const msg = await invoke<string>('apply_update_now')
        setRollbackMsg(String(msg))
      } else {
        setRollbackMsg(`Serwer przywrócony na ${prevVersion}. Kioski pobiorą ją przy najbliższym sprawdzeniu (do 1 h) lub po restarcie aplikacji.`)
      }
    } catch (e: any) {
      setRollbackMsg(`Błąd: ${e?.message || e}`)
    } finally {
      setRollbackBusy(false)
    }
  }, [prevVersion, rollbackBusy, channel])

  // Po poprawnym kodzie pobierz diagnostykę wagi (jaki port HMI otwiera, czy
  // scale.json jest czytany) — najczęstszy problem serwisowy na hali.
  useEffect(() => {
    if (!ok) return
    if (!('__TAURI_INTERNALS__' in window)) { setScaleDiag('Diagnostyka wagi tylko w kiosku.'); return }
    setScaleDiag('Sprawdzam…')
    invoke<string>('scale_diagnose')
      .then(setScaleDiag)
      .catch(e => setScaleDiag(`Błąd diagnostyki: ${e}`))
  }, [ok])

  // ── Drukarka etykiet ──────────────────────────────────────────────────────
  //
  // Punkt zatrzymania taśmy po wydruku to cecha KONKRETNEJ drukarki i rolki,
  // nie układu etykiety — hala ustawia go tutaj raz, a drukarka zapamiętuje
  // wartość u siebie (hala 14.08.2026: „przerywa w złym miejscu").
  const [tearOffMm, setTearOffMm] = useState(() => {
    const zapisane = Number(localStorage.getItem(TEAR_OFF_STORAGE_KEY) ?? '0')
    return Number.isFinite(zapisane) ? zapisane : 0
  })
  const [printerMsg, setPrinterMsg] = useState<string | null>(null)
  const [printerBusy, setPrinterBusy] = useState(false)
  const maxMm = tearOffMaxMm()

  const sendToPrinter = useCallback(async (zpl: string, komunikat: string) => {
    setPrinterBusy(true)
    setPrinterMsg(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet')
      await sendZpl(dev, zpl)
      setPrinterMsg(komunikat)
    } catch (e: any) {
      setPrinterMsg(`Błąd: ${e?.message || e}`)
    } finally {
      setPrinterBusy(false)
    }
  }, [])

  /** Przesuń punkt odrywania o `krok` mm i zapamiętaj nastawę. */
  const nudgeTearOff = useCallback((krok: number) => {
    const nowa = Math.round(Math.min(maxMm, Math.max(-maxMm, tearOffMm + krok)) * 10) / 10
    setTearOffMm(nowa)
    localStorage.setItem(TEAR_OFF_STORAGE_KEY, String(nowa))
    void sendToPrinter(tearOffZpl(nowa), `Punkt odrywania: ${nowa > 0 ? '+' : ''}${nowa} mm`)
  }, [maxMm, tearOffMm, sendToPrinter])

  const printTestLabel = useCallback(() => {
    const dzis = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    const iso = `${dzis.getFullYear()}-${p(dzis.getMonth() + 1)}-${p(dzis.getDate())}`
    void sendToPrinter(
      byproductLabelZpl({
        kind: 'backs', batchNo: '000', netKg: 123.4,
        productionDate: iso, expiryDate: iso,
      }),
      'Wydruk testowy wysłany',
    )
  }, [sendToPrinter])

  const pressKey = useCallback((k: string) => {
    setErr(false)
    setCode(prev => k === '⌫' ? prev.slice(0, -1) : (prev + k).slice(0, 4))
  }, [])
  // Walidacja w efekcie, nie w updaterze setState — side-effect w updaterze był
  // przyczyną zawodności starego wykrywania 0099 w polu wagi.
  useEffect(() => {
    if (code.length < 4) return
    if (code === SERVICE_CODE) { setOk(true); setCode('') }
    else { setErr(true); setCode('') }
  }, [code])

  if (!open) return null
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" style={SVC_VARS}>
      <div className="w-[380px] p-8 flex flex-col gap-6" style={{ borderRadius: 14, background: 'var(--svcPanel)', border: '1px solid var(--svcLine)', color: 'var(--svcInk)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.3)' }}>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 flex items-center justify-center flex-shrink-0" style={{ borderRadius: 12, background: 'var(--svcBg)', border: '1px solid var(--svcLine)', color: 'var(--svcMut)' }}><Wrench size={26} /></div>
          <div>
            <h3 className="font-extrabold text-xl">Menu serwisowe</h3>
            <p className="text-sm" style={{ color: err ? 'var(--svcRed)' : 'var(--svcMut)' }}>
              {ok ? buildLabel : err ? 'Błędny kod' : 'Podaj kod serwisowy'}
            </p>
          </div>
        </div>
        {!ok ? (
          <>
            <div className="flex justify-center gap-3">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="w-12 h-14 flex items-center justify-center text-2xl font-bold"
                  style={{ fontFamily: MONO, borderRadius: 10, background: 'var(--svcBg)', border: `1px solid ${err ? 'var(--svcRedLine)' : 'var(--svcLine)'}` }}>
                  {code[i] ? '•' : ''}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-3 gap-2">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'].map((k, i) => k === ''
                ? <div key={i} />
                : <button key={i} type="button" onClick={() => pressKey(k)}
                    className="h-14 flex items-center justify-center text-2xl font-bold select-none transition-colors active:bg-[var(--svcInk)] active:text-white"
                    style={{ fontFamily: MONO, borderRadius: 10, background: 'var(--svcPanel)', border: '1px solid var(--svcLine)' }}>
                    {k === '⌫' ? <Delete size={22} /> : k}
                  </button>)}
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-bold uppercase" style={{ color: 'var(--svcMut)', letterSpacing: '.1em' }}>Diagnostyka wagi</span>
              <pre className="text-xs whitespace-pre-wrap p-3 max-h-52 overflow-auto"
                style={{ fontFamily: MONO, borderRadius: 10, background: 'var(--svcBg)', border: '1px solid var(--svcLine)', color: 'var(--svcInk)' }}>
                {scaleDiag ?? '…'}
              </pre>
            </div>
            {/* Regulacja drukarki etykiet — wprost na ekranie hali, bo tu stoi
                drukarka i tu widać efekt każdego kroku. */}
            <div className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase flex items-center gap-2"
                style={{ color: 'var(--svcMut)', letterSpacing: '.1em' }}>
                <Printer size={14} /> Drukarka etykiet
              </span>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => nudgeTearOff(-1)} disabled={printerBusy}
                  className="h-12 flex-1 text-lg font-bold"
                  style={{ borderRadius: 10, border: '1px solid var(--svcLine)', background: 'var(--svcBg)' }}>
                  − 1 mm
                </button>
                <div className="w-24 text-center font-extrabold text-lg" style={{ fontFamily: MONO }}>
                  {tearOffMm > 0 ? '+' : ''}{tearOffMm} mm
                </div>
                <button type="button" onClick={() => nudgeTearOff(1)} disabled={printerBusy}
                  className="h-12 flex-1 text-lg font-bold"
                  style={{ borderRadius: 10, border: '1px solid var(--svcLine)', background: 'var(--svcBg)' }}>
                  + 1 mm
                </button>
              </div>
              <p className="text-[11px] leading-snug" style={{ color: 'var(--svcMut)' }}>
                Plus wysuwa taśmę dalej, minus cofa. Ustaw tak, żeby oderwanie wypadało
                na przerwie między naklejkami.
              </p>
              <div className="flex gap-2">
                <button type="button" onClick={() => void sendToPrinter(CALIBRATE_ZPL, 'Kalibracja uruchomiona — drukarka wypuści kilka etykiet')}
                  disabled={printerBusy}
                  className="h-12 flex-1 text-sm font-bold"
                  style={{ borderRadius: 10, border: '1px solid var(--svcLine)', background: 'var(--svcBg)' }}>
                  Kalibruj etykiety
                </button>
                <button type="button" onClick={printTestLabel} disabled={printerBusy}
                  className="h-12 flex-1 text-sm font-bold"
                  style={{ borderRadius: 10, border: '1px solid var(--svcLine)', background: 'var(--svcBg)' }}>
                  Wydruk testowy
                </button>
              </div>
              {printerMsg && (
                <div className="text-xs font-semibold px-3 py-2"
                  style={{ borderRadius: 8, background: 'var(--svcBg)', border: '1px solid var(--svcLine)' }}>
                  {printerMsg}
                </div>
              )}
            </div>

            <button type="button" onClick={() => void doRollback()} disabled={!prevVersion || rollbackBusy}
              className="h-14 text-base font-bold flex items-center justify-center gap-3"
              style={{
                borderRadius: 10, border: '1px solid var(--svcLine)',
                background: 'var(--svcBg)', color: prevVersion && !rollbackBusy ? 'var(--svcInk)' : 'var(--svcMut)',
              }}>
              <History size={20} />
              {prevVersion ? `Przywróć poprzednią wersję (${prevVersion})` : 'Brak wersji do przywrócenia'}
            </button>
            {rollbackMsg && (
              <div className="text-xs font-semibold px-3 py-2" style={{ borderRadius: 8, background: 'var(--svcBg)', border: '1px solid var(--svcLine)', color: 'var(--svcInk)' }}>
                {rollbackMsg}
              </div>
            )}
            <button type="button" onClick={() => void triggerServiceLogoff()}
              className="h-14 text-base font-bold flex items-center justify-center gap-3"
              style={{ borderRadius: 10, background: 'var(--svcRed)', color: '#fff' }}>
              <LogOut size={20} /> Wyjdź do Windows (wyloguj)
            </button>
          </>
        )}
        <button type="button" onClick={onClose}
          className="h-12 text-base font-bold" style={{ borderRadius: 10, border: '1px solid var(--svcLine)', color: 'var(--svcMut)' }}>
          Anuluj
        </button>
      </div>
    </div>
  )
}
