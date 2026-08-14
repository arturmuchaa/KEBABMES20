/**
 * ByproductsWizard — prowadzone ważenie zbiorcze produktów ubocznych partii:
 * najpierw GRZBIETY, potem KOŚCI. Dla każdej frakcji operator dokłada kolejne
 * ważenia:
 *   wybierz nośnik — paleta H1 / wózek z systemu / bez (tara) → wpisz liczbę
 *   pojemników → wjedź na wagę → system liczy netto = brutto − tara nośnika −
 *   pojemniki×2 kg → „To wszystko / Kolejna paleta / Tylko pojemniki".
 * Wózki to TA SAMA lista co przy ważeniu mięsa (biuro edytuje ją w
 * Ustawieniach firmy) — uboczne jeżdżą na wagę i na palecie, i na wózku.
 * Na końcu frakcji zapis (onWeigh) + % względem ćwiartki tej partii.
 *
 * Dotyczy wyłącznie ZAKOŃCZONEJ partii. Stan trwały (backsDone/bonesDone) jest
 * w backendzie — wizard startuje od pierwszej niezważonej frakcji.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, Check, Delete, Package, ArrowRight, Printer, Trash2, X } from 'lucide-react'
import { fmtKg, fmtPct } from '@/lib/utils'
import { getDevices, sendZpl, probeBrowserPrint } from '@/lib/zebra'
import { byproductLabelZpl } from '@/features/deboning/byproductLabelZpl'
import {
  E2_TARE_KG, DRIVE_OFF_IDLE, driveOffStep, isByproductBelowNorm, TYPICAL_BYPRODUCT_PCT_MIN,
  byproductTareOptions, BALANCE_WARN_PCT,
  type DriveOffTracker, type PalletSnapshot,
} from '@/features/deboning/utils/weighing'
import { getProductionDate } from '@/features/deboning/utils'
import type { ScaleState } from '@/features/deboning/useScale'
import type { BatchByproducts } from '@/lib/api'

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

/** „Data produkcji" palety = dzień PRODUKCYJNY rozbioru (getProductionDate:
 *  zmiana przed 04:00 należy jeszcze do poprzedniego dnia), a nie surowa data
 *  kalendarzowa — etykieta ma mówić to samo, co reszta kiosku i raporty. */
function palletProductionDate(weighedAt?: string): string {
  const parsed = weighedAt ? new Date(weighedAt) : null
  return getProductionDate(parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date())
}

// Pasmo normy i sprawdzenie odchylenia: isByproductBelowNorm / TYPICAL_BYPRODUCT_PCT_MIN
// (utils/weighing.ts) — patrz tam komentarz o audycie partii 428, 2026-07-23.

const V: CSSProperties = {
  ['--bg' as string]: '#E7EAEE', ['--panel' as string]: '#FFFFFF', ['--ink' as string]: '#0F172A',
  ['--mut' as string]: '#5B6472', ['--line' as string]: '#D8DEE6', ['--accent' as string]: '#4F46E5',
  ['--accentSoft' as string]: '#EEF2FF', ['--success' as string]: '#16A34A',
  ['--successSoft' as string]: '#F0FDF4', ['--successLine' as string]: '#BBF0D3',
}
const MONO = '"SFMono-Regular",ui-monospace,"Cascadia Mono",Consolas,monospace'

export function ByproductsWizard({ batch, record, scale, cartTares, onWeigh, onClose }: {
  /** expiryDate — data ważności ćwiartki; jedzie 1:1 na etykietę palety. */
  batch: { id: string; internalBatchNo: string; expiryDate?: string }
  record: BatchByproducts
  scale: ScaleState
  /** Tary wózków z systemu (ta sama lista co przy ważeniu mięsa) — uboczne
   *  jadą na wagę i na palecie, i na wózku. */
  cartTares: number[]
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
  // Paleta czekająca na potwierdzenie „mimo nadmiaru" (ostrzeżenie, NIE
  // blokada — uboczne waży się po fakcie i nadmiar bywa prawdziwy: ociek,
  // mokre grzbiety).
  const [balancePrompt, setBalancePrompt] = useState<{ pallet: Pallet; pct: number } | null>(null)
  // Ostatni stabilny odczyt palety + prompt po zjeździe z wagi bez „Dodaj".
  const [driveOff, setDriveOff] = useState<DriveOffTracker<PalletSnapshot>>(DRIVE_OFF_IDLE)
  // Druk etykiety palety: indeks palety w druku + komunikat po próbie.
  const [printingIdx, setPrintingIdx] = useState<number | null>(null)
  const [printMsg, setPrintMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const tareOptions = useMemo(() => byproductTareOptions(cartTares), [cartTares])
  const containers = parseInt(containersStr || '0', 10) || 0
  const manualKg = parseFloat((manualStr || '0').replace(',', '.')) || 0
  const gross = scale.gross
  const tareTotal = (tareKg ?? 0) + containers * E2_TARE_KG
  const net = Math.max(0, gross - tareTotal)
  const fracTotal = useMemo(() => pallets.reduce((s, p) => s + p.net, 0), [pallets])
  const canAdd = tareKg != null && scale.connected && scale.stable && gross > 0 && net > 0

  // Alarm odchylenia od normy — liczony na bieżąco z sumy dotychczasowych
  // palet, więc ostrzega PRZED „To wszystko", nie po fakcie.
  const fracPct = record.quarterKg > 0 ? (fracTotal / record.quarterKg) * 100 : 0
  const belowNorm = isByproductBelowNorm(frac, fracTotal, record.quarterKg)

  // ── Bilans masy partii (górna granica) ────────────────────────────────────
  //
  // Dotąd kreator ostrzegał WYŁĄCZNIE o frakcji za małej. Partia 445 (30.07)
  // doszła do 108,3% przy normie ~101%, bo ta sama paleta trafiła pod obie
  // frakcje — i nic tego nie zauważyło aż do audytu.
  //
  // Samo mięso wyliczamy z bilansu serwera minus obie frakcje: dzięki temu
  // liczba jest poprawna niezależnie od tego, czy `record` zdążył się odświeżyć
  // po ostatnim zapisie (persist odsyła całą frakcję, więc podwójne liczenie
  // byłoby łatwe do przeoczenia).
  const warnPct = record.balanceWarnPct ?? BALANCE_WARN_PCT
  const meatKg = record.massBalancePct != null && record.quarterKg > 0
    ? (record.massBalancePct / 100) * record.quarterKg - (record.backsKg ?? 0) - (record.bonesKg ?? 0)
    : null
  const otherFracKg = (frac === 'backs' ? record.bonesKg : record.backsKg) ?? 0
  /** Bilans po doliczeniu `extraKg` — do pytania PRZED zapisem palety. */
  const balanceWith = (extraKg: number): number | null =>
    meatKg == null || record.quarterKg <= 0
      ? null
      : ((meatKg + otherFracKg + fracTotal + extraKg) / record.quarterKg) * 100
  const liveBalance = balanceWith(0)
  const aboveBalance = liveBalance != null && liveBalance > warnPct

  const resetInputs = () => { setTareKg(null); setTareLabel(''); setContainersStr('') }

  // Śledź odczyt palety na wadze; zjazd bez „Dodaj do sumy" → driveOff.prompt
  // (pytanie o dodanie). Ratuje najczęstszy błąd: zważył, policzył i zjechał.
  useEffect(() => {
    if (phase !== 'setup') return
    const snap: PalletSnapshot | null = tareKg != null && net > 0
      ? { tareLabel, tareKg, containers, gross, net: Math.round(net * 10) / 10 }
      : null
    setDriveOff(s => driveOffStep(
      s,
      { connected: scale.connected, stable: scale.stable, gross },
      snap,
    ))
  }, [phase, scale.connected, scale.stable, gross, tareKg, tareLabel, containers, net])

  // Komunikat druku znika sam; błąd trzyma się dłużej — operator ma zdążyć
  // przeczytać, co zrobić z drukarką.
  useEffect(() => {
    if (!printMsg) return
    const t = setTimeout(() => setPrintMsg(null), printMsg.ok ? 3500 : 12000)
    return () => clearTimeout(t)
  }, [printMsg])

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

  /** Wspólne dołożenie palety: przy przekroczeniu bilansu masy pytamy, zamiast
   *  zapisywać po cichu. Najczęstsza przyczyna nadmiaru to ta sama paleta pod
   *  drugą frakcją (445) — pytanie łapie ją, zanim wejdzie do lotu ABP. */
  function commitPallet(p: Pallet) {
    const next = [...pallets, p]
    setPallets(next)
    setDriveOff(DRIVE_OFF_IDLE)
    resetInputs()
    void persist(next)
  }

  function tryAddPallet(p: Pallet) {
    const pct = balanceWith(p.net)
    if (pct != null && pct > warnPct) {
      // Pytanie o bilans zastępuje pytanie o zjazd z wagi — dwa okna naraz
      // przykrywałyby się nawzajem.
      setDriveOff(DRIVE_OFF_IDLE)
      setBalancePrompt({ pallet: p, pct })
      return
    }
    commitPallet(p)
  }

  function addPallet() {
    if (!canAdd || tareKg == null) return
    tryAddPallet({ tareLabel, tareKg, containers, gross, net: Math.round(net * 10) / 10 })
  }

  /** Zdejmij pojedynczą paletę z frakcji. Dotąd był tylko „Wyczyść sumę" na
   *  całość — operator, który pomylił frakcję, musiałby przeważyć wszystko od
   *  nowa, więc tego nie robił i zostawał dubel. Backend nadpisuje frakcję
   *  całą listą, więc zapis nowej listy wystarczy; pusta lista wraca frakcję
   *  na kafel jako niezważoną. */
  function removePallet(idx: number) {
    const next = pallets.filter((_, i) => i !== idx)
    setPallets(next)
    void persist(next)
  }

  /** Druk etykiety palety (80×50) na drukarce Zebra podpiętej do panelu —
   *  ten sam most co w biurze: usługa Zebra BrowserPrint na localhost:9100.
   *  Druk NIC nie zapisuje; to wydruk tego, co już jest w sumie, więc można
   *  go powtórzyć (etykieta zgubiona / rozmazana) bez ważenia od nowa. */
  async function printPalletLabel(p: Pallet, idx: number) {
    setPrintingIdx(idx)
    setPrintMsg(null)
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet — sprawdź, czy Zebra jest włączona i podłączona do panelu.')
      await sendZpl(dev, byproductLabelZpl({
        kind: frac,
        batchNo: batch.internalBatchNo,
        netKg: p.net,
        productionDate: palletProductionDate(p.weighedAt),
        // Data ważności NIE jest liczona z normy — przepisujemy ją z ćwiartki.
        expiryDate: (batch.expiryDate ?? '').slice(0, 10),
      }))
      setPrintMsg({ ok: true, text: `Etykieta ${FRAC_LABEL[frac]} ${fmtKg(p.net, 1)} kg — wysłana na drukarkę` })
    } catch (e: any) {
      // Zwykle to nie błąd druku, tylko brak/zablokowana usługa BrowserPrint —
      // sonda mówi operatorowi wprost, co jest nie tak.
      const probe = await probeBrowserPrint()
      setPrintMsg({
        ok: false,
        text: probe.ok ? (e?.message || 'Nie udało się wydrukować etykiety') : (probe.reason ?? 'Brak połączenia z drukarką etykiet'),
      })
    } finally {
      setPrintingIdx(null)
    }
  }

  // Operator zjechał z wagi bez „Dodaj do sumy" — potwierdził dodanie odczytu.
  function acceptDriveOff() {
    const c = driveOff.prompt
    if (!c) return
    tryAddPallet({ tareLabel: c.tareLabel, tareKg: c.tareKg, containers: c.containers, gross: c.gross, net: c.net })
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
                const pctSoFar = record.quarterKg > 0 ? ((kgSoFar ?? 0) / record.quarterKg) * 100 : 0
                const tileLow = done && isByproductBelowNorm(f, kgSoFar ?? 0, record.quarterKg)
                return (
                  <button key={f} type="button" onClick={() => chooseFraction(f)}
                    className="h-40 flex flex-col items-center justify-center gap-2 font-extrabold" style={{
                      borderRadius: 14, background: tileLow ? '#FEF3C7' : done ? 'var(--successSoft)' : 'var(--panel)',
                      border: `2px solid ${tileLow ? '#F3D9AE' : done ? 'var(--successLine)' : 'var(--accent)'}`,
                      color: tileLow ? '#B45309' : done ? 'var(--success)' : 'var(--accent)',
                    }}>
                    <Package size={40} />
                    <span className="text-3xl uppercase" style={{ color: 'var(--ink)', letterSpacing: '.02em' }}>{FRAC_LABEL[f]}</span>
                    {tileLow ? (
                      <span className="text-sm font-bold flex items-center gap-1"><AlertTriangle size={16} /> {fmtKg(kgSoFar ?? 0, 1)} kg ({fmtPct(pctSoFar, 1)}) — poniżej normy, sprawdź paletę</span>
                    ) : done ? (
                      <span className="text-sm font-bold flex items-center gap-1"><Check size={16} /> dotąd {fmtKg(kgSoFar ?? 0, 1)} kg · doważ / popraw</span>
                    ) : (
                      <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>dotknij, aby zważyć</span>
                    )}
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
            {/* Alarm odchylenia od normy — złapać brakującą/pomieszaną paletę
                TERAZ, zanim operator zamknie frakcję i pójdzie dalej (patrz
                TYPICAL_PCT: audyt partii 428, 2026-07-23). */}
            {belowNorm && (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderRadius: 12, background: '#FEF3C7', border: '1.5px solid #F3D9AE' }}>
                <AlertTriangle size={22} style={{ color: '#B45309', flexShrink: 0 }} />
                <div className="text-sm font-bold" style={{ color: '#B45309' }}>
                  {FRAC_LABEL[frac] === 'kości' ? 'Kości' : 'Grzbiety'} — {fmtPct(fracPct, 1)} ćwiartki, poniżej typowej normy
                  (~{fmtPct(TYPICAL_BYPRODUCT_PCT_MIN[frac], 0)}+). Sprawdź, czy w hali nie stoi jeszcze niezważona
                  paleta {FRAC_LABEL[frac]} — także z INNEJ partii pomieszana z tą.
                </div>
              </div>
            )}
            {/* Nadmiar bilansu masy — druga strona tego samego pytania co
                belowNorm. 445 (30.07): 108,3% przy normie ~101%, bo ta sama
                paleta poszła pod obie frakcje. */}
            {aboveBalance && (
              <div className="flex items-center gap-3 px-5 py-3.5" style={{ borderRadius: 12, background: '#FEF3C7', border: '1.5px solid #F3D9AE' }}>
                <AlertTriangle size={22} style={{ color: '#B45309', flexShrink: 0 }} />
                <div className="text-sm font-bold" style={{ color: '#B45309' }}>
                  Bilans masy partii {fmtPct(liveBalance!, 1)} — powyżej normy (~101%).
                  Sprawdź, czy któraś paleta nie jest zapisana także pod drugą frakcją.
                </div>
              </div>
            )}

            {/* Lista palet: druk etykiety (także dodruk) + zdjęcie pojedynczej. */}
            {pallets.length > 0 && (
              <div className="flex flex-col gap-2 max-h-52 overflow-auto">
                {pallets.map((p, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                    <span className="hmi-v10-mono font-extrabold text-lg" style={{ fontFamily: MONO, minWidth: 86 }}>{fmtKg(p.net, 1)} kg</span>
                    <span className="text-xs font-bold uppercase flex-1 min-w-0 truncate" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>
                      {p.tareLabel} · {p.containers} poj. · brutto {fmtKg(p.gross, 1)} kg
                    </span>
                    <button type="button" onClick={() => printPalletLabel(p, i)} disabled={printingIdx != null}
                      aria-label="Drukuj etykietę palety"
                      className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                      style={{ borderRadius: 8, border: '1px solid var(--line)', color: printingIdx === i ? 'var(--mut)' : 'var(--accent)' }}>
                      <Printer size={18} />
                    </button>
                    <button type="button" onClick={() => removePallet(i)} aria-label="Usuń paletę"
                      className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                      style={{ borderRadius: 8, border: '1px solid var(--line)', color: '#B45309' }}>
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Druk etykiety ostatnio zważonej palety — główna ścieżka: operator
                zjeżdża z wagi, dotyka „Drukuj etykietę" i nakleja ją na paletę. */}
            {pallets.length > 0 && (
              <button type="button" onClick={() => printPalletLabel(pallets[pallets.length - 1], pallets.length - 1)}
                disabled={printingIdx != null}
                className="h-16 font-extrabold text-lg flex items-center justify-center gap-2"
                style={{
                  borderRadius: 12, background: 'var(--panel)',
                  border: '1.5px solid var(--accent)', color: 'var(--accent)',
                  opacity: printingIdx != null ? .6 : 1,
                }}>
                <Printer size={24} />
                {printingIdx != null ? 'Drukuję…' : `Drukuj etykietę — ${FRAC_LABEL[frac]} ${fmtKg(pallets[pallets.length - 1].net, 1)} kg`}
              </button>
            )}
            {printMsg && (
              <div className="px-5 py-3 text-sm font-bold" style={{
                borderRadius: 12,
                background: printMsg.ok ? 'var(--successSoft)' : '#FEE2E2',
                border: `1.5px solid ${printMsg.ok ? 'var(--successLine)' : '#FCA5A5'}`,
                color: printMsg.ok ? 'var(--success)' : '#B91C1C',
              }}>
                {printMsg.text}
              </div>
            )}

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
                <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>1. Na czym ważysz (tara)</div>
                <div className="flex flex-wrap gap-2">
                  {tareOptions.map(o => {
                    const sel = tareLabel === o.tareLabel
                    return (
                      <button key={o.key} type="button" onClick={() => { setTareKg(o.kg); setTareLabel(o.tareLabel) }}
                        className="flex flex-col items-center justify-center px-4 py-2.5" style={{
                          flex: '1 1 0', minWidth: 92, borderRadius: 10,
                          background: sel ? 'var(--accent)' : 'var(--panel)',
                          border: `1.5px solid ${sel ? 'var(--accent)' : 'var(--line)'}`,
                          color: sel ? '#fff' : 'var(--ink)',
                        }}>
                        <span className="hmi-v10-mono font-extrabold text-lg leading-none">{o.title}</span>
                        <span className="text-[11px] font-bold uppercase whitespace-nowrap"
                          style={{ color: sel ? 'rgba(255,255,255,.8)' : 'var(--mut)' }}>{o.sub}</span>
                      </button>
                    )
                  })}
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
                  <div className="flex justify-between text-[12px] font-bold" style={{ color: 'var(--mut)' }}><span>− tara {tareLabel ? `(${tareLabel})` : 'nośnika'}</span><span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{tareKg != null ? `−${fmtKg(tareKg, 1)}` : '—'}</span></div>
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
                {canAdd ? <><Check size={22} /> Dodaj do sumy</> : tareKg == null ? 'Wybierz paletę / wózek' : !scale.stable ? 'Czekam na wagę…' : 'Wjedź na wagę'}
              </button>
              {/* Wejście do listy palet (druk etykiety / dodruk / zdjęcie palety).
                  Bez tego przy ważeniu wznowionym z kafla lista była nieosiągalna
                  — pokazywała się dopiero PO dołożeniu kolejnej palety. */}
              {pallets.length > 0 && (
                <button type="button" onClick={() => setPhase('ask')}
                  className="text-center text-sm font-bold py-2 flex items-center justify-center gap-2"
                  style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
                  <Printer size={16} />
                  {FRAC_LABEL[frac]} dotąd: <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{fmtKg(fracTotal, 1)} kg</span> ({pallets.length})
                </button>
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
      {/* Paleta wypycha partię ponad próg bilansu — pytamy PRZED zapisem.
          Ostrzeżenie, nie blokada: nadmiar bywa prawdziwy (ociek, mokre
          grzbiety), a nadpisywanie zmierzonych wag to incydent 424. */}
      {balancePrompt && (
        <div className="fixed inset-0 z-[62] flex items-center justify-center bg-black/50">
          <div className="w-[560px] max-w-[92vw] p-7 flex flex-col gap-5" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)', boxShadow: '0 20px 60px -20px rgba(0,0,0,.4)' }}>
            <div className="flex items-center gap-3">
              <span className="w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: '#FEF3C7', color: '#B45309' }}><AlertTriangle size={24} /></span>
              <div>
                <div className="font-extrabold text-xl leading-tight">Ta partia wyjdzie na {fmtPct(balancePrompt.pct, 1)} bilansu</div>
                <div className="text-sm font-bold mt-0.5" style={{ color: 'var(--mut)' }}>
                  Norma to ~101%. Sprawdź, czy ta paleta nie jest już zapisana pod drugą frakcją.
                </div>
              </div>
            </div>
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1px solid var(--accent)' }}>
              <div className="text-sm font-bold" style={{ color: 'var(--mut)' }}>
                {balancePrompt.pallet.tareLabel || 'bez palety'} · {balancePrompt.pallet.containers} pojemn. · brutto {fmtKg(balancePrompt.pallet.gross, 1)} kg
              </div>
              <div className="hmi-v10-mono font-extrabold text-3xl" style={{ color: 'var(--accent)' }}>{fmtKg(balancePrompt.pallet.net, 1)} kg</div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => { const p = balancePrompt.pallet; setBalancePrompt(null); commitPallet(p) }}
                className="h-16 font-extrabold text-lg flex items-center justify-center gap-2"
                style={{ borderRadius: 12, background: 'var(--success)', color: '#fff' }}>
                <Check size={22} /> Zapisz mimo to
              </button>
              <button type="button" onClick={() => setBalancePrompt(null)}
                className="h-16 font-bold text-base"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--mut)' }}>
                Anuluj
              </button>
            </div>
          </div>
        </div>
      )}

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
