/**
 * ByproductsWizard — prowadzone ważenie zbiorcze produktów ubocznych partii:
 * najpierw GRZBIETY, potem KOŚCI. Dla każdej frakcji operator dokłada palety:
 *   wybierz paletę (tara) → wpisz liczbę pojemników → wjedź na wagę →
 *   system liczy netto = brutto − tara palety − pojemniki×2 kg →
 *   „To wszystko / Kolejna paleta / Tylko pojemniki".
 * Na końcu frakcji zapis (onWeigh) + % względem ćwiartki tej partii.
 *
 * Dotyczy wyłącznie ZAKOŃCZONEJ partii. Stan trwały (backsDone/bonesDone) jest
 * w backendzie — wizard startuje od pierwszej niezważonej frakcji.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, Check, Delete, Package, ArrowRight, X } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import {
  E2_TARE_KG, DRIVE_OFF_IDLE, driveOffStep, type DriveOffTracker,
} from '@/features/deboning/utils/weighing'
import type { ScaleState } from '@/features/deboning/useScale'
import type { BatchByproducts } from '@/lib/api'

// Tary palet — tylko H1 18 kg (plus opcja „bez palety" w widoku).
export const PALLET_TARES: { label: string; kg: number }[] = [
  { label: 'H1', kg: 18 },
]

type Frac = 'backs' | 'bones'
// weighedAt stempluje backend przy zapisie; kreator doładowuje palety
// poprzednich ważeń i odsyła je ZE stemplem, żeby partia ważona przez kilka
// dni rozliczała każdą paletę w jej dniu (raport per dzień).
interface Pallet {
  tareLabel: string; tareKg: number; containers: number; gross: number; net: number
  weighedAt?: string
}

const FRAC_LABEL: Record<Frac, string> = { backs: 'grzbiety', bones: 'kości' }
const FRAC_TITLE: Record<Frac, string> = { backs: 'Zważ grzbiety', bones: 'Zważ kości' }

const V: CSSProperties = {
  ['--bg' as string]: '#E7EAEE', ['--panel' as string]: '#FFFFFF', ['--ink' as string]: '#0F172A',
  ['--mut' as string]: '#5B6472', ['--line' as string]: '#D8DEE6', ['--accent' as string]: '#4F46E5',
  ['--accentSoft' as string]: '#EEF2FF', ['--success' as string]: '#16A34A',
  ['--successSoft' as string]: '#F0FDF4', ['--successLine' as string]: '#BBF0D3',
}
const MONO = '"SFMono-Regular",ui-monospace,"Cascadia Mono",Consolas,monospace'

export function ByproductsWizard({ batch, record, scale, onWeigh, onClose }: {
  batch: { id: string; internalBatchNo: string }
  record: BatchByproducts
  scale: ScaleState
  onWeigh: (kind: Frac, kg: number, pallets: Pallet[]) => Promise<void>
  onClose: () => void
}) {
  // Operator sam wybiera, którą frakcję waży (grzbiety/kości) — ekran wyboru.
  const [frac, setFrac] = useState<Frac>('backs')
  const [pallets, setPallets] = useState<Pallet[]>([])
  const [phase, setPhase] = useState<'choose' | 'setup' | 'ask' | 'manual' | 'saving'>('choose')
  const [tareKg, setTareKg] = useState<number | null>(null)
  const [tareLabel, setTareLabel] = useState<string>('')
  const [containersStr, setContainersStr] = useState<string>('')
  const [savedPct, setSavedPct] = useState<number | null>(null)
  const [manualStr, setManualStr] = useState<string>('') // ręczne kg (awaria wagi)
  // Suma lokalna ≠ zapisana na serwerze (padnięty zapis / „Wyczyść sumę").
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  // Ostatni stabilny odczyt palety + prompt po zjeździe z wagi bez „Dodaj".
  const [driveOff, setDriveOff] = useState<DriveOffTracker>(DRIVE_OFF_IDLE)

  const containers = parseInt(containersStr || '0', 10) || 0
  const manualKg = parseFloat((manualStr || '0').replace(',', '.')) || 0
  const gross = scale.gross
  const tareTotal = (tareKg ?? 0) + containers * E2_TARE_KG
  const net = Math.max(0, gross - tareTotal)
  const fracTotal = useMemo(() => pallets.reduce((s, p) => s + p.net, 0), [pallets])
  const canAdd = tareKg != null && scale.connected && scale.stable && gross > 0 && net > 0

  const resetInputs = () => { setTareKg(null); setTareLabel(''); setContainersStr('') }

  // Śledź odczyt palety na wadze; zjazd bez „Dodaj do sumy" → driveOff.prompt
  // (pytanie o dodanie). Ratuje najczęstszy błąd: zważył, policzył i zjechał.
  useEffect(() => {
    if (phase !== 'setup') return
    setDriveOff(s => driveOffStep(
      s,
      { connected: scale.connected, stable: scale.stable, gross },
      { tareKg, tareLabel, containers, net },
    ))
  }, [phase, scale.connected, scale.stable, gross, tareKg, tareLabel, containers, net])

  /** Zapis frakcji na serwer po KAŻDEJ dodanej palecie — zamknięcie/reload
   * kiosku nie gubi już zważonych palet (kości 417: 783 kg przepadło, bo
   * zapis szedł dopiero przy „To wszystko", prod 2026-07-16). Backend
   * nadpisuje frakcję całą listą palet, więc kolejne zapisy są bezpieczne. */
  async function persist(next: Pallet[]) {
    setPhase('saving')
    const total = Math.round(next.reduce((s, p) => s + p.net, 0) * 10) / 10
    try {
      await onWeigh(frac, total, next)
      setDirty(false)
    } catch {
      setDirty(true) // toast pokazuje strona — suma zostaje, zapis ponowi „To wszystko"
    }
    setPhase('ask')
  }

  function addPallet() {
    if (!canAdd || tareKg == null) return
    const next = [...pallets, { tareLabel, tareKg, containers, gross, net: Math.round(net * 10) / 10 }]
    setPallets(next)
    setDriveOff(DRIVE_OFF_IDLE)
    resetInputs()
    void persist(next)
  }

  // Operator zjechał z wagi bez „Dodaj do sumy" — potwierdził dodanie odczytu.
  function acceptDriveOff() {
    const c = driveOff.prompt
    if (!c) return
    const next = [...pallets, { tareLabel: c.tareLabel, tareKg: c.tareKg, containers: c.containers, gross: c.gross, net: c.net }]
    setPallets(next)
    setDriveOff(DRIVE_OFF_IDLE)
    resetInputs()
    void persist(next)
  }

  async function finishFraction() {
    const total = Math.round(fracTotal * 10) / 10
    // Palety schodzą na serwer na bieżąco (persist) — ponowny zapis tylko,
    // gdy coś się nie zapisało (dirty).
    if (dirty) {
      setPhase('saving')
      try {
        await onWeigh(frac, total, pallets)
        setDirty(false)
      } catch {
        setPhase('ask') // zapis padł (toast pokazuje strona) — suma zostaje, operator ponawia
        return
      }
    }
    const pct = record.quarterKg > 0 ? (total / record.quarterKg) * 100 : 0
    setSavedPct(pct)
    // Po zapisie wracamy do wyboru — operator sam decyduje o drugiej frakcji.
    setTimeout(() => { setSavedPct(null); setPallets([]); resetInputs(); setPhase('choose') }, 1800)
  }

  function chooseFraction(f: Frac) {
    // Doładuj palety poprzednich ważeń tej frakcji (ważenie w trakcie
    // rozbioru) — kolejna paleta DOLICZA się do sumy, zapis nadpisuje
    // całość poprawnym totalem. „Wyczyść" w kroku ważenia zeruje sumę.
    const prev = (f === 'backs' ? record.backsPallets : record.bonesPallets) ?? []
    setFrac(f); setPallets(prev as Pallet[]); resetInputs(); setDirty(false); setDriveOff(DRIVE_OFF_IDLE); setPhase('setup')
  }

  // Zamknięcie z niezapisanym ważeniem (padnięty zapis, wyczyszczona suma,
  // paleta na wadze / prompt bez decyzji) wymaga potwierdzenia — dotąd X
  // zamykał bez słowa i suma przepadała.
  const hasUnsaved = dirty || driveOff.prompt != null || driveOff.armed != null
  function requestClose() {
    if (hasUnsaved) { setConfirmClose(true); return }
    onClose()
  }

  // Ręczne wpisanie ŁĄCZNYCH kg frakcji (awaria wagi).
  // Palety z poprzednich ważeń ZOSTAJĄ — dopisujemy tylko RÓŻNICĘ jako paletę
  // „ręcznie". Wcześniej ręczny wpis zastępował całą listę palet: partia 411
  // straciła tak realne palety grzbietów (13–14.07) i ich podział na dni —
  // operator widział „ważenie się nie zapisało". Korekta W DÓŁ (mniej niż już
  // zważono) to świadome zastąpienie sumy, więc czyści palety.
  async function saveManual() {
    const kg = parseFloat((manualStr || '0').replace(',', '.')) || 0
    if (kg <= 0) return
    const mk = (net: number) => ({ tareLabel: 'ręcznie', tareKg: 0, containers: 0, gross: net, net })
    const delta = Math.round((kg - fracTotal) * 10) / 10
    const next = delta > 0 ? [...pallets, mk(delta)] : [mk(Math.round(kg * 10) / 10)]
    setPhase('saving')
    try {
      await onWeigh(frac, Math.round(kg * 10) / 10, next)
      setDirty(false)
      setDriveOff(DRIVE_OFF_IDLE)
    } catch {
      setPhase('manual') // zapis padł — wpisane kg zostaje, operator ponawia
      return
    }
    const pct = record.quarterKg > 0 ? (kg / record.quarterKg) * 100 : 0
    setSavedPct(pct)
    setTimeout(() => { setSavedPct(null); setManualStr(''); setPhase('choose') }, 1800)
  }
  const pressManual = (k: string) => setManualStr(prev =>
    k === '⌫' ? prev.slice(0, -1)
    : k === '.' ? (prev.includes('.') ? prev : (prev === '' ? '0.' : prev + '.'))
    : (prev + k).replace(/^0+(?=\d)/, '').slice(0, 6))

  const pressKey = (k: string) => {
    setContainersStr(prev => {
      if (k === '⌫') return prev.slice(0, -1)
      const next = (prev + k).replace(/^0+(?=\d)/, '')
      return next.length > 2 ? prev : next // maks 99 pojemników
    })
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/50" style={V}>
      <div className="w-[860px] max-w-[96vw] flex flex-col" style={{ maxHeight: '94vh', borderRadius: 16, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', boxShadow: '0 30px 80px -30px rgba(0,0,0,.5)' }}>
        {/* Nagłówek */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <Package size={22} style={{ color: 'var(--accent)' }} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-lg leading-tight">Ważenie ubocznych — partia {batch.internalBatchNo}</div>
            <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>
              ćwiartka {fmtKg(record.quarterKg, 0)} kg · teraz: {FRAC_LABEL[frac]}
            </div>
          </div>
          <button type="button" onClick={requestClose} className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={18} /></button>
        </div>

        {savedPct != null ? (
          <div className="flex flex-col items-center justify-center gap-4 p-12">
            <span className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--success)', color: '#fff' }}><Check size={44} strokeWidth={3} /></span>
            <div className="text-center">
              <div className="font-extrabold text-2xl">Zapisano {FRAC_LABEL[frac]}</div>
              <div className="hmi-v10-mono text-4xl font-extrabold mt-2" style={{ color: 'var(--success)' }}>{fmtPct(savedPct, 1)}</div>
              <div className="text-sm font-bold mt-1" style={{ color: 'var(--mut)' }}>{fmtKg(fracTotal, 1)} kg z ćwiartki {fmtKg(record.quarterKg, 0)} kg</div>
            </div>
          </div>
        ) : phase === 'choose' ? (
          <div className="flex flex-col gap-5 p-8">
            <div className="text-center font-extrabold text-2xl">Co ważysz?</div>
            <div className="grid grid-cols-2 gap-4">
              {(['backs', 'bones'] as Frac[]).map(f => {
                const done = f === 'backs' ? record.backsDone : record.bonesDone
                const kgSoFar = f === 'backs' ? record.backsKg : record.bonesKg
                return (
                  <button key={f} type="button" onClick={() => chooseFraction(f)}
                    className="h-40 flex flex-col items-center justify-center gap-2 font-extrabold" style={{
                      borderRadius: 14, background: done ? 'var(--successSoft)' : 'var(--panel)',
                      border: `2px solid ${done ? 'var(--successLine)' : 'var(--accent)'}`,
                      color: done ? 'var(--success)' : 'var(--accent)',
                    }}>
                    <Package size={40} />
                    <span className="text-3xl uppercase" style={{ color: 'var(--ink)', letterSpacing: '.02em' }}>{FRAC_LABEL[f]}</span>
                    {done
                      ? <span className="text-sm font-bold flex items-center gap-1"><Check size={16} /> dotąd {fmtKg(kgSoFar ?? 0, 1)} kg · doważ / popraw</span>
                      : <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>dotknij, aby zważyć</span>}
                  </button>
                )
              })}
            </div>
            <button type="button" onClick={requestClose} className="h-12 font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              Zamknij (dokończę później)
            </button>
          </div>
        ) : phase === 'manual' ? (
          <div className="flex flex-col gap-5 p-6">
            <div className="flex items-center justify-between">
              <div className="font-extrabold text-xl">Ręczne wpisanie — {FRAC_LABEL[frac]}</div>
              <button type="button" onClick={() => { setManualStr(''); setPhase('setup') }} className="text-sm font-bold px-3 py-1.5" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}>← Waga</button>
            </div>
            <div className="text-sm font-bold" style={{ color: 'var(--mut)' }}>
              Wpisz ŁĄCZNĄ wagę {FRAC_LABEL[frac]} w kg — razem z tym, co już zważone.
            </div>
            {/* Co jest już zapisane w systemie: bez tego operator wpisywał sumę
                „na pamięć" i kasował realne palety (partia 411). */}
            {fracTotal > 0 && (
              <div className="px-5 py-3 flex items-center justify-between" style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1px solid var(--accent)' }}>
                <div>
                  <div className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)', letterSpacing: '.08em' }}>
                    Już zważone — {pallets.length} {pallets.length === 1 ? 'paleta' : 'palet'}
                  </div>
                  <div className="hmi-v10-mono font-extrabold text-2xl mt-0.5">{fmtKg(fracTotal, 1)} kg</div>
                </div>
                {manualKg > 0 && (
                  <div className="text-right text-sm font-bold" style={{ color: 'var(--mut)' }}>
                    {manualKg - fracTotal > 0.05 ? (
                      <>dopiszemy <span className="hmi-v10-mono font-extrabold" style={{ color: 'var(--success)' }}>+{fmtKg(manualKg - fracTotal, 1)} kg</span></>
                    ) : (
                      <span style={{ color: '#DC2626' }}>mniej niż zważono —<br />zastąpi całą sumę</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="flex items-baseline gap-3 justify-center py-2">
              <span className="hmi-v10-mono font-extrabold" style={{ fontFamily: MONO, fontSize: 56 }}>{manualStr || '0'}</span>
              <span className="text-2xl font-bold" style={{ color: 'var(--mut)' }}>kg</span>
            </div>
            <div className="grid grid-cols-3 gap-2 max-w-[360px] mx-auto w-full">
              {['7','8','9','4','5','6','1','2','3','.','0','⌫'].map(k => (
                <button key={k} type="button" onClick={() => pressManual(k)}
                  className="h-14 flex items-center justify-center text-2xl font-bold" style={{ fontFamily: MONO, borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                  {k === '⌫' ? <Delete size={22} /> : k}
                </button>
              ))}
            </div>
            <button type="button" onClick={saveManual} disabled={!(parseFloat((manualStr || '0').replace(',', '.')) > 0)}
              className="h-16 font-extrabold text-lg flex items-center justify-center gap-2 mx-auto w-full max-w-[360px]" style={{
                borderRadius: 12, background: parseFloat((manualStr || '0').replace(',', '.')) > 0 ? 'var(--accent)' : 'var(--panel)',
                color: parseFloat((manualStr || '0').replace(',', '.')) > 0 ? '#fff' : 'var(--mut)', border: '1px solid var(--line)',
              }}>
              <Check size={22} /> Zapisz {FRAC_LABEL[frac]}
            </button>
          </div>
        ) : phase === 'ask' ? (
          <div className="flex flex-col gap-5 p-6">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div>
                <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>{FRAC_LABEL[frac]} — suma dotąd</div>
                <div className="hmi-v10-mono font-extrabold text-3xl mt-1">{fmtKg(fracTotal, 1)} kg</div>
              </div>
              <div className="text-right text-sm font-bold" style={{ color: 'var(--mut)' }}>
                <div>{pallets.length} {pallets.length === 1 ? 'paleta' : 'palet'}</div>
                <div className="text-[11px] font-bold mt-1" style={{ color: dirty ? '#DC2626' : 'var(--success)' }}>
                  {dirty ? 'niezapisane — dotknij „To wszystko"' : '✓ zapisane w systemie'}
                </div>
              </div>
            </div>
            <div className="text-center font-extrabold text-xl">To wszystko, czy dokładamy?</div>
            <div className="grid grid-cols-3 gap-3">
              <button type="button" onClick={finishFraction}
                className="h-24 flex flex-col items-center justify-center gap-2 font-extrabold text-lg"
                style={{ borderRadius: 12, background: 'var(--success)', color: '#fff' }}>
                <Check size={26} /> To wszystko
              </button>
              <button type="button" onClick={() => setPhase('setup')}
                className="h-24 flex flex-col items-center justify-center gap-2 font-bold text-base"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1.5px solid var(--accent)', color: 'var(--accent)' }}>
                <Package size={24} /> Kolejna paleta
              </button>
              <button type="button" onClick={() => { setTareKg(0); setTareLabel('bez palety'); setPhase('setup') }}
                className="h-24 flex flex-col items-center justify-center gap-2 font-bold text-base"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
                <ArrowRight size={22} /> Tylko pojemniki
              </button>
            </div>
          </div>
        ) : (
          <div className="flex gap-5 p-6 overflow-auto">
            {/* Lewa: kroki — paleta + pojemniki */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <div className="flex items-center justify-between gap-3">
                <div className="font-extrabold text-xl">{FRAC_TITLE[frac]}</div>
                {pallets.length > 0 && (
                  <button type="button" onClick={() => { setPallets([]); setDirty(true) }}
                    className="text-sm font-bold px-3 py-1.5 flex-shrink-0"
                    style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}>
                    Wyczyść sumę ({fmtKg(fracTotal, 1)} kg)
                  </button>
                )}
              </div>

              <div>
                <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>1. Wybierz paletę (tara)</div>
                <div className="flex flex-wrap gap-2">
                  {PALLET_TARES.map(p => (
                    <button key={p.label} type="button" onClick={() => { setTareKg(p.kg); setTareLabel(p.label) }}
                      className="flex flex-col items-center justify-center px-4 py-2.5 flex-1" style={{
                        minWidth: 92, borderRadius: 10,
                        background: tareLabel === p.label ? 'var(--accent)' : 'var(--panel)',
                        border: `1.5px solid ${tareLabel === p.label ? 'var(--accent)' : 'var(--line)'}`,
                        color: tareLabel === p.label ? '#fff' : 'var(--ink)',
                      }}>
                      <span className="font-extrabold text-lg leading-none">{p.label}</span>
                      <span className="text-[11px] font-bold uppercase" style={{ color: tareLabel === p.label ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>{fmtKg(p.kg, 0)} kg</span>
                    </button>
                  ))}
                  <button type="button" onClick={() => { setTareKg(0); setTareLabel('bez palety') }}
                    className="flex flex-col items-center justify-center px-4 py-2.5 flex-1" style={{
                      minWidth: 92, borderRadius: 10,
                      background: tareLabel === 'bez palety' ? 'var(--accent)' : 'var(--panel)',
                      border: `1.5px solid ${tareLabel === 'bez palety' ? 'var(--accent)' : 'var(--line)'}`,
                      color: tareLabel === 'bez palety' ? '#fff' : 'var(--ink)',
                    }}>
                    <span className="font-extrabold text-base leading-none">Bez</span>
                    <span className="text-[11px] font-bold uppercase" style={{ color: tareLabel === 'bez palety' ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>0 kg</span>
                  </button>
                </div>
              </div>

              <div>
                <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>2. Liczba pojemników (× {fmtKg(E2_TARE_KG, 0)} kg)</div>
                <div className="flex items-center gap-3">
                  <div className="hmi-v10-mono font-extrabold text-4xl w-16 text-center" style={{ fontFamily: MONO }}>{containers}</div>
                  <div className="grid grid-cols-3 gap-2 flex-1">
                    {['1','2','3','4','5','6','7','8','9','⌫','0',''].map((k, i) => k === '' ? <div key={i} />
                      : <button key={i} type="button" onClick={() => pressKey(k)}
                          className="h-11 flex items-center justify-center text-xl font-bold" style={{ fontFamily: MONO, borderRadius: 8, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                          {k === '⌫' ? <Delete size={18} /> : k}
                        </button>)}
                  </div>
                </div>
              </div>
            </div>

            {/* Prawa: waga na żywo + oblicz */}
            <div className="w-[300px] flex-shrink-0 flex flex-col gap-3">
              <div className="p-4" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: scale.connected ? 'var(--success)' : '#DC2626' }} />
                  <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>3. Wjedź na wagę</span>
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="hmi-v10-mono font-extrabold leading-none" style={{ fontFamily: MONO, fontSize: 48 }}>{fmtKg(gross, 1)}</span>
                  <span className="text-base font-bold" style={{ color: 'var(--mut)' }}>kg</span>
                </div>
                <div className="text-[11px] font-bold uppercase mt-1" style={{ color: scale.error ? '#DC2626' : scale.stable ? 'var(--success)' : 'var(--mut)' }}>
                  {!scale.connected ? 'BRAK WAGI' : scale.error ? 'POZA ZAKRESEM WAGI' : gross <= 0 ? 'PUSTA' : scale.stable ? 'STABILNA' : 'WAŻENIE…'}
                </div>
                {scale.error && (
                  <div className="text-[11px] font-bold mt-1" style={{ color: '#DC2626' }}>
                    Za ciężko dla wagi (maks 1 t) — rozdziel na 2 palety albo „Wpisz ręcznie".
                  </div>
                )}
                <div className="mt-3 pt-3 flex flex-col gap-1" style={{ borderTop: '1px solid var(--line)' }}>
                  <div className="flex justify-between text-[12px] font-bold" style={{ color: 'var(--mut)' }}><span>− tara palety {tareLabel ? `(${tareLabel})` : ''}</span><span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{tareKg != null ? `−${fmtKg(tareKg, 0)}` : '—'}</span></div>
                  <div className="flex justify-between text-[12px] font-bold" style={{ color: 'var(--mut)' }}><span>− {containers} pojemn. × {fmtKg(E2_TARE_KG, 0)}</span><span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{containers > 0 ? `−${fmtKg(containers * E2_TARE_KG, 0)}` : '—'}</span></div>
                  <div className="flex items-baseline justify-between px-3 py-2 mt-1" style={{ borderRadius: 8, background: 'var(--accentSoft)' }}>
                    <span className="text-[11px] font-bold uppercase" style={{ color: 'var(--accent)' }}>Netto</span>
                    <span className="hmi-v10-mono font-extrabold text-2xl" style={{ color: 'var(--accent)' }}>{fmtKg(net, 1)} kg</span>
                  </div>
                </div>
              </div>
              <button type="button" onClick={addPallet} disabled={!canAdd}
                className="h-16 font-extrabold text-lg flex items-center justify-center gap-2" style={{
                  borderRadius: 12, background: canAdd ? 'var(--accent)' : 'var(--panel)',
                  color: canAdd ? '#fff' : 'var(--mut)', border: `1px solid ${canAdd ? 'var(--accent)' : 'var(--line)'}`,
                }}>
                {canAdd ? <><Check size={22} /> Dodaj do sumy</> : tareKg == null ? 'Wybierz paletę' : !scale.stable ? 'Czekam na wagę…' : 'Wjedź na wagę'}
              </button>
              {pallets.length > 0 && (
                <div className="text-center text-sm font-bold" style={{ color: 'var(--mut)' }}>
                  {FRAC_LABEL[frac]} dotąd: <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{fmtKg(fracTotal, 1)} kg</span> ({pallets.length})
                </div>
              )}
              {/* Zawsze dostępne ręczne wpisanie kg. */}
              <button type="button" onClick={() => setPhase('manual')}
                className="h-11 text-sm font-bold" style={{ borderRadius: 10, border: '1px dashed var(--mut)', color: 'var(--mut)' }}>
                Wpisz ręcznie
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zjazd z wagi bez „Dodaj do sumy" — odczyt uratowany, operator decyduje. */}
      {driveOff.prompt && savedPct == null && !confirmClose && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50">
          <div className="w-[560px] max-w-[92vw] p-7 flex flex-col gap-5" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.4)' }}>
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#FEF3C7', color: '#B45309' }}><AlertTriangle size={24} /></span>
              <div>
                <div className="font-extrabold text-xl leading-tight">Zjechano z wagi bez „Dodaj do sumy"</div>
                <div className="text-sm font-bold mt-0.5" style={{ color: 'var(--mut)' }}>Odczyt zapamiętany — dodać tę paletę do sumy {FRAC_LABEL[frac]}?</div>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1px solid var(--accent)' }}>
              <div className="text-sm font-bold" style={{ color: 'var(--mut)' }}>
                {driveOff.prompt.tareLabel || 'bez palety'} · {driveOff.prompt.containers} pojemn. · brutto {fmtKg(driveOff.prompt.gross, 1)} kg
              </div>
              <div className="hmi-v10-mono font-extrabold text-3xl" style={{ color: 'var(--accent)' }}>{fmtKg(driveOff.prompt.net, 1)} kg</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={acceptDriveOff}
                className="h-16 font-extrabold text-lg flex items-center justify-center gap-2"
                style={{ borderRadius: 12, background: 'var(--success)', color: '#fff' }}>
                <Check size={22} /> Dodaj do sumy
              </button>
              <button type="button" onClick={() => setDriveOff(DRIVE_OFF_IDLE)}
                className="h-16 font-bold text-base"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--mut)' }}>
                Odrzuć odczyt
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Zamknięcie z niezapisanym ważeniem — dotąd X gubił sumę bez słowa. */}
      {confirmClose && (
        <div className="fixed inset-0 z-[61] flex items-center justify-center bg-black/50">
          <div className="w-[520px] max-w-[92vw] p-7 flex flex-col gap-5" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.4)' }}>
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#FEE2E2', color: '#DC2626' }}><AlertTriangle size={24} /></span>
              <div>
                <div className="font-extrabold text-xl leading-tight">Niezapisane ważenie</div>
                <div className="text-sm font-bold mt-0.5" style={{ color: 'var(--mut)' }}>
                  {driveOff.prompt || driveOff.armed
                    ? `Odczyt ${fmtKg((driveOff.prompt ?? driveOff.armed)!.net, 1)} kg nie został dodany do sumy.`
                    : `Suma ${FRAC_LABEL[frac]} (${fmtKg(fracTotal, 1)} kg) nie jest zapisana w systemie.`}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setConfirmClose(false)}
                className="h-16 font-extrabold text-lg"
                style={{ borderRadius: 12, background: 'var(--accent)', color: '#fff' }}>
                Wróć do ważenia
              </button>
              <button type="button" onClick={onClose}
                className="h-16 font-bold text-base"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid #DC2626', color: '#DC2626' }}>
                Zamknij bez zapisu
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
