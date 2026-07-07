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
import { useMemo, useState, type CSSProperties } from 'react'
import { Check, Delete, Package, ArrowRight, X } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { E2_TARE_KG } from '@/features/deboning/utils/weighing'
import type { ScaleState } from '@/features/deboning/useScale'
import type { BatchByproducts } from '@/lib/api'

// Tary palet (na start zaszyte; ekran w biurze dorobimy później).
export const PALLET_TARES: { label: string; kg: number }[] = [
  { label: 'H1', kg: 18 },
  { label: 'H7', kg: 20 },
  { label: 'Euro', kg: 25 },
]

type Frac = 'backs' | 'bones'
interface Pallet { tareLabel: string; tareKg: number; containers: number; gross: number; net: number }

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
  // Pierwsza niezważona frakcja: grzbiety, potem kości.
  const firstFrac: Frac = !record.backsDone ? 'backs' : 'bones'
  const [frac, setFrac] = useState<Frac>(firstFrac)
  const [pallets, setPallets] = useState<Pallet[]>([])
  const [phase, setPhase] = useState<'setup' | 'ask' | 'saving'>('setup')
  const [tareKg, setTareKg] = useState<number | null>(null)
  const [tareLabel, setTareLabel] = useState<string>('')
  const [containersStr, setContainersStr] = useState<string>('')
  const [savedPct, setSavedPct] = useState<number | null>(null)

  const containers = parseInt(containersStr || '0', 10) || 0
  const gross = scale.gross
  const tareTotal = (tareKg ?? 0) + containers * E2_TARE_KG
  const net = Math.max(0, gross - tareTotal)
  const fracTotal = useMemo(() => pallets.reduce((s, p) => s + p.net, 0), [pallets])
  const canAdd = tareKg != null && scale.connected && scale.stable && gross > 0 && net > 0

  const resetInputs = () => { setTareKg(null); setTareLabel(''); setContainersStr('') }

  function addPallet() {
    if (!canAdd || tareKg == null) return
    setPallets(prev => [...prev, { tareLabel, tareKg, containers, gross, net: Math.round(net * 10) / 10 }])
    resetInputs()
    setPhase('ask')
  }

  async function finishFraction() {
    setPhase('saving')
    const total = Math.round(fracTotal * 10) / 10
    await onWeigh(frac, total, pallets)
    const pct = record.quarterKg > 0 ? (total / record.quarterKg) * 100 : 0
    setSavedPct(pct)
    // Kolejna frakcja (kości) jeśli jeszcze niezważona.
    const needBones = frac === 'backs' && !record.bonesDone
    if (needBones) {
      setTimeout(() => {
        setSavedPct(null); setFrac('bones'); setPallets([]); resetInputs(); setPhase('setup')
      }, 1800)
    } else {
      setTimeout(onClose, 1800)
    }
  }

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
          <button type="button" onClick={onClose} className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={18} /></button>
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
        ) : phase === 'ask' ? (
          <div className="flex flex-col gap-5 p-6">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div>
                <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>{FRAC_LABEL[frac]} — suma dotąd</div>
                <div className="hmi-v10-mono font-extrabold text-3xl mt-1">{fmtKg(fracTotal, 1)} kg</div>
              </div>
              <div className="text-right text-sm font-bold" style={{ color: 'var(--mut)' }}>{pallets.length} {pallets.length === 1 ? 'paleta' : 'palet'}</div>
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
              <div className="font-extrabold text-xl">{FRAC_TITLE[frac]}</div>

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
                <div className="text-[11px] font-bold uppercase mt-1" style={{ color: scale.stable ? 'var(--success)' : 'var(--mut)' }}>
                  {!scale.connected ? 'BRAK WAGI' : gross <= 0 ? 'PUSTA' : scale.stable ? 'STABILNA' : 'WAŻENIE…'}
                </div>
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
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
