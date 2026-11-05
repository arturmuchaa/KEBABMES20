import { useEffect, useRef, useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { ArrowRight, Check, Scale, X, Delete, AlertTriangle } from 'lucide-react'
import { takeSettlementApi } from '@/lib/api'
import { fmtKg } from '@/lib/utils'
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import type { ScaleState } from './useScale'
import { E2_TARE_KG, byproductTareOptions } from './utils/weighing'
import { SERVICE_CODE } from './ServiceMenu'
import {
  SETTLEMENT_LABEL, SETTLEMENT_STAGES, settlementPendingKey,
  type TakeSettlement, type SettlementKind, type SettlementInitial,
  type SettlementMeasurement, type SettlementWeighing, type PendingSettlementWrite,
} from './settlement'
import './take-settlement.css'

const kinds: SettlementKind[] = ['meat', 'backs', 'bones']
const nextLabel = { meat: 'Mięso gotowe — przejdź do grzbietów', backs: 'Grzbiety gotowe — przejdź do kości', bones: 'Kości gotowe — sprawdź bilans' }
const newId = () => globalThis.crypto?.randomUUID?.() ?? `weigh-${Date.now()}-${Math.random().toString(36).slice(2)}`

export function TakeSettlementWizard({ initialState, initialMeasurement, scale, cartTares, onClose, onChange }: {
  initialState: TakeSettlement
  initialMeasurement?: SettlementInitial
  scale: ScaleState
  cartTares: number[]
  onClose: (completed: boolean) => void
  onChange: () => void
}) {
  const [state, setState] = useState(initialState)
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [manual, setManual] = useState(initialMeasurement?.weighMode === 'manual' || !scale.available)
  const [manualKg, setManualKg] = useState(initialMeasurement?.weighMode === 'manual' ? String(initialMeasurement.kgNet) : '')
  const [tare, setTare] = useState<number | null>(null)
  const [containers, setContainers] = useState('')
  const [reason, setReason] = useState('')
  const [field, setField] = useState<'containers' | 'manual' | 'code'>(initialMeasurement?.weighMode === 'manual' || !scale.available ? 'manual' : 'containers')
  const [captured, setCaptured] = useState<SettlementInitial | null>(initialMeasurement?.weighMode === 'auto' ? initialMeasurement : null)
  const lastStable = useRef<SettlementInitial | null>(null)
  const [mustUnload, setMustUnload] = useState(false)
  const [correcting, setCorrecting] = useState<SettlementWeighing | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [yieldWarning, setYieldWarning] = useState('')
  const [code, setCode] = useState('')
  const [pending, setPending] = useState<PendingSettlementWrite | null>(() => {
    try { return JSON.parse(localStorage.getItem(settlementPendingKey(initialState.id)) || 'null') }
    catch { return null }
  })
  const step = SETTLEMENT_STAGES.indexOf(state.stage)
  const kind = correcting?.kind ?? (step < 3 ? state.stage as SettlementKind : null)
  const count = Number(containers)
  const validCount = containers !== '' && Number.isInteger(count) && count >= 0 && count <= 1000
  const liveNet = Math.round((scale.gross - (tare ?? 0) - count * E2_TARE_KG) * 100) / 100
  const liveReady = !manual && !mustUnload && tare !== null && validCount && scale.connected && scale.stable && !scale.error && liveNet > 0
  const net = manual ? Number(manualKg.replace(',', '.')) : captured?.kgNet ?? liveNet
  const currentMeasurement: SettlementInitial | null = manual
    ? Number.isFinite(net) && net > 0 ? { kgNet: net, weighMode: 'manual' } : null
    : captured ?? (liveReady ? { kgNet: liveNet, weighMode: 'auto', kgGross: scale.gross, tareCartKg: tare!, tareE2Kg: count * E2_TARE_KG, e2Count: count } : null)
  const canSave = !!kind && !!currentMeasurement && (!manual && !correcting || reason.length >= 3) && !busy && !pending
  const editable = !busy && !pending

  // The next fraction must NOT record the same cart again. Preserve the last
  // stable snapshot on drive-off, but require explicit operator confirmation.
  useEffect(() => {
    if (scale.connected && scale.gross <= 1) {
      setMustUnload(false)
      if (lastStable.current && !manual && !captured && !pending && !busy) {
        setCaptured(lastStable.current)
        setNotice('Wózek zjechał z wagi — potwierdź zapamiętany pomiar.')
        lastStable.current = null
      }
    } else if (liveReady && !captured && !pending && !busy && !correcting) {
      lastStable.current = { kgNet: liveNet, weighMode: 'auto', kgGross: scale.gross, tareCartKg: tare!, tareE2Kg: count * E2_TARE_KG, e2Count: count }
    }
  }, [scale.connected, scale.gross, liveReady, liveNet, tare, count, manual, captured, pending, busy, correcting])

  function resetInputs() {
    setManualKg(''); setTare(null); setContainers(''); setReason(''); setCaptured(null)
    setCorrecting(null); setField(manual ? 'manual' : 'containers'); lastStable.current = null
  }

  async function run(action: () => Promise<TakeSettlement>, after?: (s: TakeSettlement) => void) {
    if (busyRef.current) return
    busyRef.current = true; setBusy(true); setError('')
    try {
      const updated = await action()
      setState(updated); onChange(); after?.(updated)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Nie udało się zapisać. Spróbuj ponownie.')
    } finally { busyRef.current = false; setBusy(false) }
  }

  async function submit(write?: PendingSettlementWrite) {
    if (busyRef.current) return
    const operation = write ?? (currentMeasurement && kind ? {
      measurement: { ...currentMeasurement, requestId: newId(), kind, reason } as SettlementMeasurement,
      ...(correcting ? { correctingId: correcting.id } : {}),
    } : null)
    if (!operation) return
    // If durable local storage is unavailable, do NOT send an unrepeatable write.
    try { localStorage.setItem(settlementPendingKey(state.id), JSON.stringify(operation)) }
    catch { setError('Nie można zabezpieczyć pomiaru w pamięci stanowiska. Nie wysłano zapisu.'); return }
    setPending(operation)
    await run(async () => {
      try {
        const updated = operation.correctingId
          ? await takeSettlementApi.correct(state.id, operation.correctingId, operation.measurement)
          : await takeSettlementApi.weigh(state.id, operation.measurement)
        localStorage.removeItem(settlementPendingKey(state.id)); setPending(null)
        resetInputs()
        setMustUnload(operation.measurement.weighMode === 'auto' && scale.gross > 1)
        setNotice(`Zapisano ${SETTLEMENT_LABEL[operation.measurement.kind].toLowerCase()}: ${fmtKg(operation.measurement.kgNet, 2)} kg`)
        return updated
      } catch (e) {
        const status = (e as { status?: number }).status
        // A definitive rejection may be corrected. A timeout/5xx is uncertain:
        // retain the exact operation; never generate a second measurement id.
        if (status && status >= 400 && status < 500) {
          localStorage.removeItem(settlementPendingKey(state.id)); setPending(null)
        }
        throw e
      }
    })
  }

  async function advance(override = false) {
    if (!kind || correcting) return
    await run(async () => {
      try { return await takeSettlementApi.advance(state.id, kind, override) }
      catch (e) {
        const msg = e instanceof Error ? e.message : ''
        if (kind === 'meat' && msg.includes('kodu serwisowego')) { setYieldWarning(msg); setField('code') }
        throw e
      }
    }, () => { resetInputs(); setYieldWarning(''); setCode(''); setNotice('') })
  }

  function press(key: string) {
    const update = (old: string) => key === '⌫' ? old.slice(0, -1) : key === 'C' ? '' : (old + key).slice(0, 9)
    if (field === 'code') setCode(old => update(old).slice(0, 4))
    else if (field === 'manual') setManualKg(old => key === '.' && old.includes('.') ? old : update(old))
    else if (key !== '.') setContainers(update)
  }

  function requestClose() {
    if (busy) return
    if (!pending && currentMeasurement) { setConfirmClose(true); return }
    onClose(state.stage === 'done')
  }

  function edit(w: SettlementWeighing) {
    lastStable.current = null; setCaptured(null); setCorrecting(w); setManual(true)
    setManualKg(String(w.kgNet)); setReason(''); setField('manual'); setError(''); setNotice('')
  }

  return <Dialog.Root open onOpenChange={open => { if (!open) requestClose() }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-[60] bg-black/40" />
      <Dialog.Content className="take-settlement fixed inset-3 z-[61] flex flex-col rounded-2xl shadow-xl"
        style={{ ...HMI_VARS, fontFamily: HMI_FONT, background: 'var(--bg)', color: 'var(--ink)' }}
        onInteractOutside={e => e.preventDefault()} onEscapeKeyDown={e => { e.preventDefault(); requestClose() }}>
        <header className="flex flex-wrap items-center gap-4 border-b p-5" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <div className="flex-1">
            <Dialog.Title className="text-2xl font-extrabold">Rozliczenie pobrania · {state.workerName}</Dialog.Title>
            <Dialog.Description className="mt-1 text-lg" style={{ color: 'var(--mut)' }}>
              Partia {state.rawBatchNo} · {state.meatType === 'bs' ? 'B/S' : 'Z/S'} · Pobrano <strong>{fmtKg(state.kgTaken, 2)} kg</strong> nominalnie
            </Dialog.Description>
          </div>
          <button className="ts-button" onClick={requestClose} disabled={busy} aria-label="Zapisane ważenia zostają — dokończ później"><X aria-hidden size={22} /> Dokończ później</button>
        </header>
        <ol aria-label="Etapy rozliczenia" className="grid grid-cols-4 gap-2 px-5 py-3">
          {[...kinds, 'balance' as const].map((s, i) => <li key={s} aria-current={s === state.stage ? 'step' : undefined}
            className="flex items-center gap-2 rounded-xl border px-3 py-3 font-bold"
            style={{ background: step === i ? 'var(--accent)' : 'var(--panel)', color: step === i ? '#fff' : 'var(--ink)', borderColor: 'var(--line)' }}>
            {step > i ? <Check aria-hidden size={22} /> : <span>{i + 1}.</span>}{s === 'balance' ? 'Bilans' : SETTLEMENT_LABEL[s]}
          </li>)}
        </ol>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 pb-5 lg:grid-cols-[minmax(0,1.25fr)_minmax(330px,0.75fr)]">
          <section className="rounded-xl p-5" style={{ background: 'var(--panel)' }}>
            {error && <div role="alert" className="mb-4 rounded-lg border p-3 font-semibold" style={{ background: 'var(--redSoft)', color: 'var(--red)', borderColor: 'var(--redLine)' }}>{error}</div>}
            {notice && <p role="status" className="mb-3 font-semibold">{notice}</p>}
            {pending ? <div className="flex flex-col gap-4">
              <h2 className="text-2xl font-bold">Sprawdź ostatni zapis</h2>
              <p>Oczekuje pomiar: {SETTLEMENT_LABEL[pending.measurement.kind]} — {fmtKg(pending.measurement.kgNet, 2)} kg. Ponowienie nie doda go drugi raz.</p>
              <button className="ts-button ts-primary" disabled={busy} onClick={() => void submit(pending)}>Sprawdź / ponów zapis</button>
            </div> : kind ? <>
              <h2 className="text-2xl font-extrabold">{correcting ? 'Popraw pomiar' : `KROK ${step + 1}/3 — Zważ ${SETTLEMENT_LABEL[kind].toLowerCase()}`}</h2>
              <p className="mb-4 mt-1" style={{ color: 'var(--mut)' }}>Tylko od pracownika: <strong>{state.workerName}</strong>. Każdy wózek zapisz osobno.</p>
              <fieldset disabled={!editable} className="grid gap-4 xl:grid-cols-[1fr_220px]">
                <div className="flex flex-col gap-3">
                  <div className="flex gap-2">
                    <button className="ts-button" aria-pressed={!manual} disabled={!!correcting || !scale.available} onClick={() => { setManual(false); setManualKg(''); setReason(''); setField('containers') }}><Scale aria-hidden size={20} /> Z wagi</button>
                    <button className="ts-button" aria-pressed={manual} onClick={() => { setManual(true); setCaptured(null); lastStable.current = null; setField('manual') }}>Ręcznie</button>
                  </div>
                  {manual ? <>
                    <label className="font-bold">Masa netto (kg)
                      <input aria-label="Masa netto (kg)" inputMode="decimal" value={manualKg} onFocus={() => setField('manual')} onChange={e => setManualKg(e.target.value)} className="ts-input" />
                    </label>
                    <p className="font-semibold">{correcting ? 'Powód korekty' : 'Powód ręcznego pomiaru'} — wybierz:</p>
                    <div className="flex flex-wrap gap-2">{(correcting ? ['Korekta tary', 'Błędnie wpisana masa', 'Ponowne ważenie'] : ['Waga niedostępna', 'Pomiar z innej wagi']).map(r =>
                      <button key={r} className="ts-button" aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}</div>
                  </> : captured ? <div className="rounded-xl border p-4" style={{ borderColor: 'var(--accent)' }}>
                    <p className="font-bold">Zapamiętany stabilny pomiar — jeszcze niezapisany</p>
                    <p>Brutto {fmtKg(captured.kgGross ?? 0, 2)} − tara {fmtKg((captured.tareCartKg ?? 0) + (captured.tareE2Kg ?? 0), 2)} kg</p>
                    <button className="ts-button mt-3" onClick={() => { setCaptured(null); lastStable.current = null; setNotice(''); setMustUnload(scale.gross > 1) }}>Odrzuć pomiar i zważ ponownie</button>
                  </div> : <>
                    <p className="font-bold">1. Wybierz nośnik — tara</p>
                    <div className="flex flex-wrap gap-2">{byproductTareOptions(cartTares).map(t =>
                      <button key={t.key} className="ts-button" aria-pressed={tare === t.kg} onClick={() => { setTare(t.kg); lastStable.current = null }}>{t.tareLabel} · {fmtKg(t.kg, 1)} kg</button>)}</div>
                    <label className="font-bold">2. Liczba pojemników E2 (0 = bez pojemników)
                      <input aria-label="Liczba pojemników E2" inputMode="numeric" value={containers} onFocus={() => setField('containers')} onChange={e => { setContainers(e.target.value); lastStable.current = null }} className="ts-input" />
                    </label>
                    <p>Brutto: {fmtKg(scale.gross, 2)} kg · Tara: {fmtKg((tare ?? 0) + (validCount ? count * E2_TARE_KG : 0), 2)} kg</p>
                    <p className="font-bold" role="status">{mustUnload ? 'Zjedź z wagi przed kolejnym pomiarem.' : !scale.connected ? 'Brak połączenia z wagą' : scale.error ? 'Błąd odczytu wagi' : !scale.stable ? 'Czekam na stabilną wagę…' : !liveReady ? 'Wybierz tarę i liczbę pojemników, następnie wjedź na wagę.' : 'Pomiar stabilny — można zapisać'}</p>
                  </>}
                  <div className="rounded-xl px-4 py-3" style={{ background: 'var(--accentSoft)' }}>
                    <div className="font-bold">{SETTLEMENT_LABEL[kind]} — bieżące netto</div>
                    <div className="text-5xl font-extrabold tabular-nums">{currentMeasurement ? fmtKg(net, 2) : '—'} <span className="text-xl">kg</span></div>
                  </div>
                </div>
                <div className="grid content-start grid-cols-3 gap-2" aria-label="Klawiatura numeryczna">
                  {['7','8','9','4','5','6','1','2','3','C','0','⌫', '.'].map(k => <button key={k} className="ts-button justify-center text-2xl" disabled={k === '.' && field !== 'manual'} onClick={() => press(k)} aria-label={k === '⌫' ? 'Usuń cyfrę' : k === 'C' ? 'Wyczyść pole' : k}>{k === '⌫' ? <Delete aria-hidden /> : k}</button>)}
                </div>
              </fieldset>
              {yieldWarning && <div className="mt-4 rounded-xl border p-4" style={{ borderColor: 'var(--amb)', background: 'var(--ambSoft)' }}>
                <p>{yieldWarning}</p>
                <label className="font-bold">Kod serwisowy (tylko uzysk mięsa)
                  <input className="ts-input" aria-label="Kod serwisowy" type="password" inputMode="numeric" value={code} onFocus={() => setField('code')} onChange={e => setCode(e.target.value)} />
                </label>
                <button className="ts-button" disabled={busy || code !== SERVICE_CODE} onClick={() => void advance(true)}>Potwierdź uzysk ze śladem w historii</button>
                <p className="mt-2">Kod nie omija tolerancji bilansu całego pobrania.</p>
              </div>}
              <div className="mt-4 flex flex-wrap gap-3">
                <button className="ts-button ts-primary flex-1" disabled={!canSave} onClick={() => void submit()}>{busy ? 'Zapisuję…' : correcting ? 'Zapisz korektę' : 'Zapisz ważenie'}</button>
                {correcting && <button className="ts-button" disabled={busy} onClick={resetInputs}>Anuluj korektę</button>}
              </div>
              {!correcting && <button className="ts-button mt-3 w-full justify-center" disabled={busy || state[`${kind}Kg`] <= 0 || !!currentMeasurement} onClick={() => void advance()}>{nextLabel[kind]} <ArrowRight aria-hidden size={22} /></button>}
              {!!currentMeasurement && <p className="mt-2 text-sm">Najpierw zapisz lub odrzuć bieżący pomiar.</p>}
            </> : <div className="flex flex-col gap-5">
              <h2 className="text-3xl font-extrabold">{state.stage === 'done' ? 'Pobranie rozliczone' : 'Sprawdź pełny bilans'}</h2>
              <p>Wszystkie trzy frakcje zapisane. Tolerancja nominalnej masy pobrania: <strong>±{state.tolerancePct}%</strong>, czyli <strong>±{fmtKg(state.toleranceKg, 2)} kg</strong>.</p>
              <p className="text-xl font-bold">Akceptowany zakres: {fmtKg(state.minKg, 2)}–{fmtKg(state.maxKg, 2)} kg</p>
              {!state.withinTolerance && <p className="font-bold" style={{ color: 'var(--red)' }}>Nie można zamknąć pobrania. Sprawdź wszystkie ważenia i tary. Nie dopisuj brakujących kilogramów bez pomiaru.</p>}
              {state.stage === 'done' ? <button className="ts-button ts-primary" onClick={() => onClose(true)}>Gotowe — następny pracownik</button>
                : <button className="ts-button ts-primary" disabled={busy || !state.withinTolerance} onClick={() => void run(() => takeSettlementApi.finish(state.id))}>{busy ? 'Zatwierdzam…' : 'Zatwierdź rozliczenie'}</button>}
            </div>}
          </section>
          <aside className="flex flex-col gap-4">
            <section className="rounded-xl p-5" style={{ background: 'var(--panel)' }}>
              <h2 className="mb-4 text-xl font-bold">Bilans zapisanych ważeń</h2>
              {kinds.map((k, i) => <div key={k} className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b pb-3" style={{ borderColor: 'var(--line)' }}>
                <span className="text-lg font-bold">{step > i ? '✓ ' : ''}{SETTLEMENT_LABEL[k]}</span>
                <strong className="text-2xl tabular-nums">{fmtKg(state[`${k}Kg`], 2)} kg</strong>
                {step >= i && state.stage !== 'done' && <button className="ts-button" disabled={!editable || !!currentMeasurement || !!correcting} onClick={() => void run(() => takeSettlementApi.reopen(state.id, k), () => { resetInputs(); setNotice('') })}>Doważ / popraw {SETTLEMENT_LABEL[k].toLowerCase()}</button>}
              </div>)}
              <div className="flex justify-between text-xl font-bold"><span>Razem</span><span>{fmtKg(state.totalKg, 2)} kg</span></div>
              <div className="mt-2 flex justify-between"><span>Bilans pobrania</span><strong>{fmtKg(state.balancePct, 2)}%</strong></div>
              <div className="mt-1 flex justify-between" style={{ color: 'var(--mut)' }}><span>Uzysk samego mięsa</span><span>{fmtKg(state.meatKg / state.kgTaken * 100, 2)}%</span></div>
              <div className="mt-4 rounded-xl border p-4" role="status" style={{
                background: step < 3 ? 'var(--accentSoft)' : state.withinTolerance ? 'var(--successSoft)' : 'var(--redSoft)',
                borderColor: step < 3 ? 'var(--accentLine)' : state.withinTolerance ? 'var(--successLine)' : 'var(--redLine)',
              }}>
                <p className="text-2xl font-extrabold">{state.differenceKg < 0 ? 'Brakuje' : state.differenceKg > 0 ? 'Nadmiar' : 'Różnica'} {fmtKg(Math.abs(state.differenceKg), 2)} kg</p>
                <p className="mt-1 font-bold">{step < 3 ? 'Rozliczenie w toku — zważ wszystkie frakcje' : state.withinTolerance ? `✓ W tolerancji ±${state.tolerancePct}%` : `Poza tolerancją ±${state.tolerancePct}%`}</p>
              </div>
            </section>
            <section className="rounded-xl p-5" style={{ background: 'var(--panel)' }}>
              <h2 className="mb-3 font-bold">Zapisane pomiary</h2>
              {state.weighings.length === 0 && <p>Brak nowych pomiarów. Wcześniejsze porcje mięsa są uwzględnione w bilansie.</p>}
              {state.weighings.map(w => <div key={w.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-2" style={{ borderColor: 'var(--line)' }}>
                <span>{SETTLEMENT_LABEL[w.kind]} · <strong>{fmtKg(w.kgNet, 2)} kg</strong><small className="block" style={{ color: 'var(--mut)' }}>{w.weighMode === 'manual' ? 'Ręcznie' : `Brutto ${fmtKg(w.kgGross ?? 0, 2)} · E2: ${w.e2Count}`}</small></span>
                {state.stage !== 'done' && <button className="ts-button" aria-label={`Popraw ${SETTLEMENT_LABEL[w.kind].toLowerCase()} ${fmtKg(w.kgNet, 2)} kg`} disabled={!editable || !!currentMeasurement || !!correcting} onClick={() => edit(w)}>Popraw</button>}
              </div>)}
            </section>
          </aside>
        </div>
        {confirmClose && <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-black/40 p-5">
          <div role="alertdialog" aria-label="Niezapisany pomiar" className="flex max-w-xl flex-col gap-4 rounded-xl p-6" style={{ background: 'var(--panel)' }}>
            <AlertTriangle aria-hidden /><h2 className="text-xl font-bold">Bieżący pomiar nie został zapisany</h2>
            <p>Wcześniej zapisane ważenia pozostaną w pobraniu. Czy odrzucić tylko bieżący pomiar?</p>
            <button className="ts-button ts-primary" onClick={() => setConfirmClose(false)}>Zostań i zapisz pomiar</button>
            <button className="ts-button" onClick={() => onClose(false)}>Odrzuć bieżący pomiar i wyjdź</button>
          </div>
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}
