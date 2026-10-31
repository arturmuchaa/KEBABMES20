import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronDown, Minus, Plus, Printer, RefreshCw } from 'lucide-react'
import { Dialog } from '../shell/context'
import { FlagIcon } from '../ui/Glyphs'
import { PROBA } from '../proba'
import {
  LABEL_LENGTH_MAX_MM, LABEL_LENGTH_MIN_MM, OFFSET_MAX_MM, loadCalibration, saveCalibration, tearOffMaxMm,
  type TagPrinterCalibration,
} from '@/features/raw-batches/tagPrinterCalibration'
import { drukujTest, opisBledu, stanDrukarki, trybSerii, ustawOdrywanie, ustawTrybSerii, wybierzDrukarke, zmienRolke, type StanDrukarki, type TrybSerii } from './drukarka'

const mm = (v: number, znak = true) => `${znak && v > 0 ? '+' : ''}${String(v).replace('.', ',')} mm`

/** Krok w milimetrach: − wartość + (nastawa stanowiska). */
function Dosuw({ label, hint, value, step, min, max, znak = true, disabled, onChange }: {
  label: string; hint: string; value: number; step: number; min: number; max: number; znak?: boolean; disabled?: boolean; onChange: (v: number) => void
}) {
  const krok = (d: number) => onChange(Math.round(Math.min(max, Math.max(min, value + d)) * 10) / 10)
  return (
    <div className="dosuw">
      <span className="label">{label}</span>
      <div className="dosuw-c">
        <button type="button" className="btn sm icon" disabled={disabled || value <= min} onClick={() => krok(-step)} aria-label={`${label}: mniej`}><Minus size={14} /></button>
        <span className="dosuw-v" aria-live="polite">{mm(value, znak)}</span>
        <button type="button" className="btn sm icon" disabled={disabled || value >= max} onClick={() => krok(step)} aria-label={`${label}: więcej`}><Plus size={14} /></button>
      </div>
      <span className="dosuw-h">{hint}</span>
    </div>
  )
}

function opisStanu(s: StanDrukarki | null, sprawdzam: boolean): { kropka: 'ok' | 'warn' | 'crit' | 'off'; nazwa: string; opis: string } {
  if (PROBA) return { kropka: 'off', nazwa: 'Drukarka etykiet', opis: 'Wersja próbna — druk etykiet jest wyłączony.' }
  if (!s) return { kropka: 'off', nazwa: 'Drukarka etykiet', opis: sprawdzam ? 'Sprawdzam…' : '' }
  if (!s.nazwa) return { kropka: 'crit', nazwa: 'Nie widzę drukarki', opis: s.powod ?? '' }
  const nazwa = s.model ? `${s.nazwa} · ${s.model}` : s.nazwa
  if (s.problemy.length) return { kropka: 'warn', nazwa, opis: s.problemy.join(' ') }
  if (s.powod) return { kropka: s.gotowa ? 'ok' : 'warn', nazwa, opis: s.powod }
  const rolka = s.rolka ? `rolka ${s.rolka.split(' — ')[0]}` : 'rolka zmierzy się przy pierwszym druku'
  return { kropka: 'ok', nazwa, opis: ['Gotowa', rolka, s.skokMm ? `skok ${mm(s.skokMm, false)}` : ''].filter(Boolean).join(' · ') }
}

/**
 * Ustawienia drukarki etykiet — celowo schowane (menu Narzędzia, cichy link
 * przy zawieszkach). Zwykle nic tu nie trzeba robić: PROTRIMA po zmianie rolki
 * kalibruje drukarkę sama przy pierwszym druku. Panel jest na „zmieniam rolkę”,
 * wydruk testowy i — zwinięte — milimetrowe dosunięcia stanowiska.
 */
export function PanelDrukarki() {
  const [stan, setStan] = useState<StanDrukarki | null>(null)
  const [sprawdzam, setSprawdzam] = useState(false)
  const [zajete, setZajete] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [cal, setCal] = useState<TagPrinterCalibration>(loadCalibration)
  const [precyzyjne, setPrecyzyjne] = useState(false)
  const [seria, setSeria] = useState<TrybSerii>(trybSerii)

  const sprawdz = useCallback(async () => {
    if (PROBA) return
    setSprawdzam(true)
    try { setStan(await stanDrukarki()) } finally { setSprawdzam(false) }
  }, [])
  useEffect(() => { void sprawdz() }, [sprawdz])

  const akcja = async (nazwa: string, f: () => Promise<string>) => {
    if (zajete || PROBA) return
    setZajete(nazwa); setMsg(null)
    try { setMsg({ ok: true, text: await f() }) } catch (e) { setMsg({ ok: false, text: await opisBledu(e) }) } finally {
      setZajete(null); setCal(loadCalibration()); void sprawdz()
    }
  }
  const zmien = (patch: Partial<TagPrinterCalibration>) => {
    const nowa = saveCalibration({ ...cal, ...patch })
    const odrywanie = nowa.tearOffMm !== cal.tearOffMm
    setCal(nowa)
    // Punkt odrywania mieszka w drukarce — idzie od razu, żeby było widać efekt na następnej etykiecie.
    if (odrywanie) void akcja('odrywanie', async () => { await ustawOdrywanie(nowa.tearOffMm); return `Punkt odrywania: ${mm(nowa.tearOffMm)}.` })
  }

  const s = opisStanu(stan, sprawdzam)
  const off = PROBA || !!zajete
  return (
    <div className="prn">
      <div className="prn-card" role="status" aria-live="polite">
        <span className={`prn-dot ${s.kropka}`} aria-hidden />
        <div className="prn-main"><div className="prn-name">{s.nazwa}</div>{s.opis && <div className="prn-sub">{s.opis}</div>}</div>
        <button className="btn sm ghost" disabled={PROBA || sprawdzam} onClick={() => void sprawdz()}><RefreshCw size={14} className={sprawdzam ? 'spin' : undefined} />Sprawdź</button>
      </div>
      {stan && stan.inne.length > 1 && <label className="prn-wybor"><span className="label">Drukarka na tym komputerze</span>
        <select className="field" value={stan.uid ?? ''} disabled={off} onChange={e => { wybierzDrukarke(e.target.value); void sprawdz() }}>
          {!stan.uid && <option value="">Wybierz drukarkę…</option>}
          {stan.inne.map(d => <option key={d.uid} value={d.uid}>{d.nazwa}</option>)}
        </select></label>}

      <div className="prn-acts">
        <div className="prn-act">
          <div><b>Zmieniam rolkę</b><span>Po założeniu nowej rolki drukarka sama zmierzy etykietę. Bez tego zrobi to przy pierwszym druku.</span></div>
          <button className="btn" disabled={off} onClick={() => void akcja('rolka', () => zmienRolke({ onStatus: text => setMsg({ ok: true, text }) }))}>{zajete === 'rolka' ? 'Mierzę…' : 'Zmieniam rolkę'}</button>
        </div>
        <div className="prn-act">
          <div><b>Zawieszka testowa</b><span>Ramka po krawędzi etykiety — widać, czy wydruk mieści się w całości.</span></div>
          <button className="btn" disabled={off} onClick={() => void akcja('test', async () => { await drukujTest(); return 'Wysłano zawieszkę testową.' })}><Printer size={15} />Drukuj test</button>
        </div>
      </div>

      {msg && (msg.ok
        ? <p className="print-line ok" role="status"><Check size={14} />{msg.text}</p>
        : <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div>{msg.text}</div></div>)}

      <button type="button" className="prn-more" aria-expanded={precyzyjne} onClick={() => setPrecyzyjne(p => !p)}>
        <ChevronDown size={15} className={precyzyjne ? 'rot' : undefined} />Precyzyjne ustawienia
      </button>
      {precyzyjne && <div className="prn-seria">
        <span className="label">Seria zawieszek</span>
        <div className="seg" role="group" aria-label="Seria zawieszek">
          <button type="button" aria-pressed={seria === 'ciagiem'} onClick={() => { ustawTrybSerii('ciagiem'); setSeria('ciagiem') }}>Ciągiem — szybko</button>
          <button type="button" aria-pressed={seria === 'pojedynczo'} onClick={() => { ustawTrybSerii('pojedynczo'); setSeria('pojedynczo') }}>Po jednej</button>
        </div>
        <span className="dosuw-h">{seria === 'ciagiem' ? 'cała seria bez przerw, taśma staje do oderwania po ostatniej' : 'każda zawieszka staje do oderwania osobno — wolniej'}</span>
      </div>}
      {precyzyjne && <div className="dosuwy">
        <Dosuw label="Przesunięcie w poziomie" hint="+ w prawo" value={cal.offsetXMm} step={0.5} min={-OFFSET_MAX_MM} max={OFFSET_MAX_MM} disabled={off} onChange={v => zmien({ offsetXMm: v })} />
        <Dosuw label="Przesunięcie w pionie" hint="+ w dół" value={cal.offsetYMm} step={0.5} min={-OFFSET_MAX_MM} max={OFFSET_MAX_MM} disabled={off} onChange={v => zmien({ offsetYMm: v })} />
        <Dosuw label="Punkt odrywania" hint="zapisuje się w drukarce" value={cal.tearOffMm} step={0.5} min={-tearOffMaxMm()} max={tearOffMaxMm()} disabled={off} onChange={v => zmien({ tearOffMm: v })} />
        <Dosuw label="Skok taśmy" hint="ustawia go drukarka po zmianie rolki" znak={false} value={cal.labelLengthMm} step={0.1} min={LABEL_LENGTH_MIN_MM} max={LABEL_LENGTH_MAX_MM} disabled={off} onChange={v => zmien({ labelLengthMm: v })} />
      </div>}
      <p className="prn-foot">Nastawy dotyczą tego komputera i tej drukarki.</p>
    </div>
  )
}

/** Samodzielne okno ustawień — z menu Narzędzia. */
export function DrukarkaDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog title="Drukarka etykiet" icon={<Printer size={20} />} onClose={onClose}
      footer={<button className="btn" onClick={onClose} data-autofocus>Zamknij</button>}>
      <PanelDrukarki />
    </Dialog>
  )
}
