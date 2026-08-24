/**
 * BulkWeighingWizard — ważenie zbiorcze mięsa na równe palety i wózki.
 *
 * Po rozbiorze mięso jedzie do masowni w tym, co akurat stoi pod ręką: pięciu
 * ludzi odda po 100 kg, ktoś 40 kg, i operator masowania nie wie, ile bierze
 * ani z jakich partii. Ten ekran prowadzi budowanie RÓWNEJ palety (100 / 200 /
 * 400 / 600 / 800 kg), pilnuje wagi z tolerancją ±0,5 kg i drukuje etykietę
 * ze składem partii.
 *
 * NIC nie rusza stanu magazynowego — mięso jest na stanie od chwili rozbioru.
 * Zapisujemy wyłącznie OPIS: co na której palecie leży.
 *
 * Przepływ: cel → nośnik → słupki (paleta zostaje na wadze, operator taruje
 * między słupkami) → skład partii → zapis i druk.
 */
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  AlertTriangle, ArrowLeft, Check, Delete, Layers, ListChecks, Package, Printer, Trash2, X,
} from 'lucide-react'
import { fmtKg } from '@/lib/utils'
import { getDevices, sendZpl, probeBrowserPrint } from '@/lib/zebra'
import { byproductTareOptions, E2_TARE_KG } from '@/features/deboning/utils/weighing'
import { getProductionDate } from '@/features/deboning/utils'
import {
  PALLET_TARGETS, TOLERANCE_KG, overBudgetLots, proposeLotsFromActive, stackNetKg,
  lotProgress, targetGate,
  withinTolerance, type LotPick, type PalletTarget,
} from '@/features/deboning/meatPallet'
import { meatPalletLabelZpl } from '@/features/deboning/meatPalletLabelZpl'
import { meatPalletsApi, meatStockApi, type MeatPallet } from '@/lib/api'
import type { MeatStock } from '@/types'
import type { ScaleState } from '@/features/deboning/useScale'

type Phase = 'target' | 'carrier' | 'stack' | 'summary' | 'saving' | 'done'

interface Stack { netKg: number; containers: number }

const V: CSSProperties = {
  ['--bg' as string]: '#E7EAEE', ['--panel' as string]: '#FFFFFF', ['--ink' as string]: '#0F172A',
  ['--mut' as string]: '#5B6472', ['--line' as string]: '#D8DEE6', ['--accent' as string]: '#4F46E5',
  ['--accentSoft' as string]: '#EEF2FF', ['--success' as string]: '#16A34A',
  ['--successSoft' as string]: '#F0FDF4', ['--successLine' as string]: '#BBF0D3',
}
const MONO = '"SFMono-Regular",ui-monospace,"Cascadia Mono",Consolas,monospace'

const r1 = (n: number) => Math.round(n * 10) / 10

/**
 * Ile z partii można jeszcze wydać na paletę: wydajność partii minus to, co
 * już z niej na palety zeszło (backend liczy to jako `kgBulkFree`).
 *
 * Świadomie NIE `kgAvailable` — ono spada przy masowaniu, a mięso zmasowane
 * pojechało na masownię właśnie na palecie; odejmowalibyśmy je drugi raz.
 * Gdy backend limitu nie zna (starsza wersja), wracamy do stanu magazynu,
 * żeby ekran nie został z pustą pulą.
 */
const wolneNaPalety = (m: MeatStock): number =>
  Number(m.kgBulkFree ?? m.kgAvailable ?? 0)

export function BulkWeighingWizard({ scale, cartTares, operator, activeBatchNo, onClose }: {
  scale: ScaleState
  /** Tary wózków z ustawień firmy — ta sama lista co przy rozbiorze. */
  cartTares: number[]
  operator: string
  /** Partia zaznaczona na ekranie rozbioru — TA, którą hala właśnie waży.
   *
   *  Bez niej skład palety proponowało czyste FEFO po całej puli, więc na
   *  szczycie stawał najstarszy żywy lot i podpowiadał się przy KAŻDEJ
   *  palecie. 24.08.2026 pojechała tak na masownię paleta z etykietą „485",
   *  choć ważono 503. */
  activeBatchNo?: string
  onClose: () => void
}) {
  const [phase, setPhase] = useState<Phase>('target')
  const [target, setTarget] = useState<PalletTarget | null>(null)
  const [carrier, setCarrier] = useState<{ label: string; kg: number } | null>(null)
  const [stacks, setStacks] = useState<Stack[]>([])
  const [containersStr, setContainersStr] = useState('')
  const [lots, setLots] = useState<LotPick[]>([])
  const [picker, setPicker] = useState<{ mode: 'swap'; idx: number } | { mode: 'add' } | null>(null)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [printMsg, setPrintMsg] = useState<string | null>(null)
  const [palletNo, setPalletNo] = useState('')
  // Palety zważone dziś — lista do dodruku uszkodzonej etykiety. Ładowana od
  // razu, bo licznik na przycisku ma być widoczny bez wchodzenia w listę.
  const [zwazone, setZwazone] = useState<MeatPallet[]>([])
  const [listaOtwarta, setListaOtwarta] = useState(false)
  const [dodruk, setDodruk] = useState('')
  // Bufor tekstowy pola kg przy partii — bez niego kasowanie cyfry (pusty
  // string) natychmiast wracałoby jako 0 i nie dałoby się nic dopisać.
  const [kgEdit, setKgEdit] = useState<{ idx: number; text: string } | null>(null)
  // Ile kg weszło z partii INNEJ niż ta z ekranu i czy operator to potwierdził.
  const [dobraneZInnych, setDobraneZInnych] = useState(0)
  const [laczenieOk,     setLaczenieOk]     = useState(true)

  const odswiezZwazone = useCallback(() => {
    meatPalletsApi.list(getProductionDate())
      .then(setZwazone)
      .catch(() => setZwazone([]))
  }, [])
  useEffect(() => { odswiezZwazone() }, [odswiezZwazone])

  // Pula mięsa: loty z wolnymi kilogramami, posortowane po terminie (FEFO) —
  // dokładnie w kolejności, w jakiej hala je zdejmuje.
  const [pool, setPool] = useState<MeatStock[]>([])
  useEffect(() => {
    meatStockApi.list()
      .then(r => setPool(r.data.filter(m => wolneNaPalety(m) > 0)))
      .catch(() => setPool([]))
  }, [])

  // Postęp aktywnej partii — licznik nad wagą. Strażnik limitu istniał, ale
  // był niewidoczny: operator dowiadywał się o nim najwyżej przy odmowie
  // zapisu, a najczęściej wcale, bo dobieranie FEFO po cichu przerzucało
  // nadmiar na inną partię.
  const aktywna = useMemo(
    () => pool.find(m => m.lotNo === (activeBatchNo ?? '').trim()),
    [pool, activeBatchNo],
  )
  const postep = useMemo(
    () => (aktywna ? lotProgress({
      lotNo: aktywna.lotNo, kgInitial: aktywna.kgInitial, kgBulkFree: aktywna.kgBulkFree,
    }) : null),
    [aktywna],
  )
  const celeKg = useMemo(() => PALLET_TARGETS.map(t => t.totalKg), [])

  const containers = parseInt(containersStr || '0', 10) || 0
  const isFirst = stacks.length === 0
  const netto = target && carrier
    ? stackNetKg(scale.gross, carrier.kg, containers, isFirst)
    : 0
  const sumaKg = useMemo(() => r1(stacks.reduce((s, x) => s + x.netKg, 0)), [stacks])
  const sumaPojemnikow = useMemo(
    () => stacks.reduce((s, x) => s + x.containers, 0), [stacks])

  /** Cel bieżącego słupka: z kafelka albo „ile brakuje do celu łącznego". */
  const celSlupka = target
    ? (target.stackKg ?? r1(Math.max(0, target.totalKg - sumaKg)))
    : 0
  const brakuje = r1(Math.max(0, (target?.totalKg ?? 0) - sumaKg))
  const wNormie = withinTolerance(netto, celSlupka)
  const canAdd = scale.connected && scale.stable && netto > 0

  const kgLotu = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of pool) m.set(p.lotNo, wolneNaPalety(p))
    return m
  }, [pool])
  const sumaSkladu = useMemo(() => r1(lots.reduce((s, l) => s + l.kg, 0)), [lots])
  // Partie, z których paleta bierze więcej, niż w nich zostało.
  const przekroczenia = useMemo(() => overBudgetLots(lots, kgLotu), [lots, kgLotu])
  const doPrzypisania = r1(sumaKg - sumaSkladu)

  /** Ręczna korekta kilogramów z danej partii.
   *
   *  Propozycja FEFO liczy się z tego, co system WIE o partii, a hala widzi,
   *  ile fizycznie zostało: partia 478 miała w systemie 918,5 kg zapasu, gdy
   *  na chłodni leżały z niej 44 kg luzem do połączenia z nową dostawą.
   *  Bez tego pola operator mógł tylko usunąć wiersz albo przerzucić CAŁĄ
   *  resztę palety na inną partię — nie dało się złożyć palety z resztki
   *  i świeżego mięsa. */
  function zmienKgPartii(i: number, text: string) {
    setKgEdit({ idx: i, text })
    const v = parseFloat(text.replace(',', '.'))
    if (Number.isNaN(v) || v < 0) return
    setLots(ls => ls.map((l, k) => (k === i ? { ...l, kg: r1(v) } : l)))
  }

  function wybierzCel(t: PalletTarget) {
    setTarget(t)
    setStacks([])
    setContainersStr('')
    setPhase('carrier')
  }

  function wybierzNosnik(label: string, kg: number) {
    setCarrier({ label, kg })
    setPhase('stack')
  }

  function dodajSlupek() {
    if (!canAdd || !target) return
    const next = [...stacks, { netKg: netto, containers }]
    setStacks(next)
    setContainersStr('')
    const suma = r1(next.reduce((s, x) => s + x.netKg, 0))
    const komplet = target.stacks != null
      ? next.length >= target.stacks
      : withinTolerance(suma, target.totalKg) || suma >= target.totalKg
    if (komplet) przejdzDoSkladu(suma)
  }

  function przejdzDoSkladu(suma: number) {
    const dostepne = pool.map(m => ({ lotNo: m.lotNo, kgFree: wolneNaPalety(m) }))
    const r = proposeLotsFromActive(activeBatchNo, dostepne, suma)
    setLots(r.picks)
    // Dobranie z innej partii nie może przejść po cichu — operator ma to
    // potwierdzić świadomie, bo to ono zrobiło z palety 503 etykietę „485".
    setDobraneZInnych(r.fromOtherLotsKg)
    setLaczenieOk(r.fromOtherLotsKg <= 0)
    setPhase('summary')
  }

  function usunSlupek(i: number) {
    setStacks(s => s.filter((_, k) => k !== i))
  }

  /** Termin ważności palety = najkrótszy ze składu. */
  const expiryDate = useMemo(() => {
    const daty = lots
      .map(l => pool.find(p => p.lotNo === l.lotNo)?.expiryDate)
      .filter((d): d is string => !!d)
      .sort()
    return daty[0] ?? ''
  }, [lots, pool])

  async function zapiszIDrukuj() {
    if (!target || !carrier) return
    setPhase('saving')
    setSaveErr(null)
    try {
      const zapisana = await meatPalletsApi.create({
        targetKg: target.totalKg,
        stackKg: target.stackKg,
        kgNet: sumaKg,
        containers: sumaPojemnikow,
        carrierLabel: carrier.label,
        carrierKg: carrier.kg,
        operator,
        productionDate: getProductionDate(),
        expiryDate,
        lots,
      })
      setPalletNo(zapisana.palletNo)
      setPhase('done')
      odswiezZwazone()
      // Druk PO zapisie — numer palety nadaje backend i to on idzie na etykietę.
      await drukuj(zapisana.palletNo)
    } catch (e: any) {
      setSaveErr(e?.message || 'Nie udało się zapisać palety')
      setPhase('summary')
    }
  }

  /** Wyślij etykietę na drukarkę. Wspólne dla świeżej palety i dodruku —
   *  etykieta z listy MUSI być identyczna z tą, która wyjechała za pierwszym
   *  razem, więc nie odtwarzamy jej z bieżącego stanu ekranu. */
  async function drukujEtykiete(input: Parameters<typeof meatPalletLabelZpl>[0]) {
    try {
      const { default: def, list } = await getDevices()
      const dev = def ?? list[0]
      if (!dev) throw new Error('Nie znaleziono drukarki etykiet')
      await sendZpl(dev, meatPalletLabelZpl(input))
      setPrintMsg('Etykieta wysłana na drukarkę')
      return true
    } catch (e: any) {
      const probe = await probeBrowserPrint()
      setPrintMsg(probe.ok ? (e?.message || 'Nie udało się wydrukować') : (probe.reason ?? 'Brak drukarki'))
      return false
    }
  }

  async function drukuj(nr: string) {
    await drukujEtykiete({
      palletNo: nr,
      netKg: sumaKg,
      containers: sumaPojemnikow,
      productionDate: getProductionDate(),
      expiryDate,
      lots,
    })
  }

  /** Dodruk etykiety palety zważonej wcześniej — dane z zapisu, nie z ekranu. */
  async function dodrukuj(p: MeatPallet) {
    setDodruk(p.palletNo)
    await drukujEtykiete({
      palletNo: p.palletNo,
      netKg: p.kgNet,
      containers: p.containers,
      productionDate: p.productionDate,
      expiryDate: p.expiryDate,
      lots: p.lots,
    })
    setDodruk('')
  }

  const pressKey = (k: string) => setContainersStr(prev => {
    if (k === '⌫') return prev.slice(0, -1)
    const next = (prev + k).replace(/^0+(?=\d)/, '')
    return next.length > 2 ? prev : next
  })

  const tareOptions = useMemo(() => byproductTareOptions(cartTares), [cartTares])

  return (
    <div className="fixed inset-0 z-[56] flex items-center justify-center bg-black/50" style={V}>
      <div className="w-[900px] max-w-[96vw] flex flex-col" style={{ maxHeight: '94vh', borderRadius: 16, background: 'var(--bg)', color: 'var(--ink)', border: '1px solid var(--line)', boxShadow: '0 30px 80px -30px rgba(0,0,0,.5)' }}>
        {/* Nagłówek */}
        <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', borderTopLeftRadius: 16, borderTopRightRadius: 16 }}>
          <Layers size={22} style={{ color: 'var(--accent)' }} />
          <div className="flex-1 min-w-0">
            <div className="font-extrabold text-lg leading-tight">Ważenie zbiorcze mięsa</div>
            <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>
              {target ? `cel ${target.label} · ${target.hint}` : 'wybierz cel'}
              {carrier ? ` · ${carrier.label}` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: 'var(--mut)' }}><X size={18} /></button>
        </div>

        {phase === 'target' ? (
          <div className="flex flex-col gap-5 p-8">
            {/* Licznik partii — to ON jest „widocznym strażnikiem". Mówi wprost,
                ile z tej partii zważono, ile już pojechało na paletach i ile
                jeszcze wolno wydać. */}
            {postep && (
              <div className="flex items-center justify-between px-5 py-3"
                style={{ borderRadius: 12, background: 'var(--accentSoft)', border: '1.5px solid var(--accent)' }}>
                <div className="flex items-baseline gap-3">
                  <span className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>Partia</span>
                  <span className="text-3xl font-extrabold" style={{ fontFamily: MONO, color: 'var(--accent)' }} data-testid="bw-partia">
                    {postep.lotNo}
                  </span>
                </div>
                <div className="flex items-baseline gap-5 text-sm font-bold" style={{ fontFamily: MONO }} data-testid="bw-licznik">
                  <span style={{ color: 'var(--mut)' }}>zważone {postep.weighedKg} kg</span>
                  <span style={{ color: 'var(--mut)' }}>na paletach {postep.onPalletsKg} kg</span>
                  <span className="text-2xl" style={{ color: postep.leftKg > 0 ? 'var(--ink)' : '#B91C1C' }}>
                    zostało {postep.leftKg} kg
                  </span>
                </div>
              </div>
            )}
            <div className="text-center font-extrabold text-2xl">Ile ma ważyć?</div>
            <div className="grid grid-cols-3 gap-4">
              {PALLET_TARGETS.map(t => {
                // Partię wyczerpuje się CAŁYMI paletami; dopiero końcówkę wolno
                // dobić z następnej. Stąd trzy stany kafelka, nie dwa.
                const gate = targetGate(t.totalKg, postep?.leftKg ?? null, celeKg)
                const zablokowany = gate === 'blocked'
                return (
                  <button key={t.key} type="button"
                    disabled={zablokowany}
                    data-testid={`bw-cel-${t.key}`}
                    data-gate={gate}
                    onClick={() => { if (!zablokowany) wybierzCel(t) }}
                    className="h-32 flex flex-col items-center justify-center gap-1.5 font-extrabold"
                    style={{
                      borderRadius: 14,
                      background: zablokowany ? 'var(--bg)' : 'var(--panel)',
                      border: `2px solid ${zablokowany ? 'var(--line)' : 'var(--accent)'}`,
                      color: zablokowany ? 'var(--mut)' : 'var(--accent)',
                      opacity: zablokowany ? 0.55 : 1,
                    }}>
                    <span className="text-4xl" style={{ color: zablokowany ? 'var(--mut)' : 'var(--ink)' }}>{t.label}</span>
                    <span className="text-xs font-bold" style={{ color: 'var(--mut)' }}>{t.hint}</span>
                    {zablokowany && (
                      <span className="text-[11px] font-bold" style={{ color: '#B91C1C' }}>
                        z partii {postep?.lotNo} zostało {postep?.leftKg} kg
                      </span>
                    )}
                    {gate === 'combine' && postep && (
                      <span className="text-[11px] font-bold" style={{ color: 'var(--accent)' }}>
                        końcówka {postep.leftKg} kg + kolejna partia
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
            {/* Wejście do tego, co już zważono dziś — po to, żeby dało się
                dodrukować etykietę, gdy oryginał się rozmoczy albo urwie. */}
            <button type="button" onClick={() => setListaOtwarta(true)}
              className="h-14 font-bold flex items-center justify-center gap-3"
              style={{ borderRadius: 12, background: 'var(--panel)', border: '1.5px solid var(--line)', color: 'var(--ink)' }}>
              <ListChecks size={20} style={{ color: 'var(--accent)' }} />
              Zważone dziś
              <span className="hmi-v10-mono font-extrabold text-lg" style={{ color: 'var(--accent)' }}>{zwazone.length}</span>
              <span className="text-xs font-bold" style={{ color: 'var(--mut)' }}>· dodruk etykiety</span>
            </button>
          </div>
        ) : phase === 'carrier' ? (
          <div className="flex flex-col gap-5 p-8">
            <div className="text-center font-extrabold text-2xl">Na czym ważysz?</div>
            <div className="flex flex-wrap gap-3">
              {tareOptions.map(o => (
                <button key={o.key} type="button" onClick={() => wybierzNosnik(o.tareLabel, o.kg)}
                  className="flex flex-col items-center justify-center px-5 py-4"
                  style={{ flex: '1 1 0', minWidth: 120, borderRadius: 12, background: 'var(--panel)', border: '1.5px solid var(--line)' }}>
                  <span className="hmi-v10-mono font-extrabold text-2xl leading-none">{o.title}</span>
                  <span className="text-[11px] font-bold uppercase mt-1" style={{ color: 'var(--mut)' }}>{o.sub}</span>
                </button>
              ))}
            </div>
            <button type="button" onClick={() => setPhase('target')}
              className="h-12 font-bold flex items-center justify-center gap-2"
              style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              <ArrowLeft size={18} /> Wróć do celu
            </button>
          </div>
        ) : phase === 'stack' ? (
          <div className="flex gap-5 p-6 overflow-auto">
            {/* Lewa: postęp i słupki */}
            <div className="flex-1 flex flex-col gap-4 min-w-0">
              <div className="px-5 py-4" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>
                  {target?.stacks
                    ? `Słupek ${Math.min(stacks.length + 1, target.stacks)} z ${target.stacks}`
                    : 'Dokładaj do celu'}
                </div>
                <div className="flex items-baseline gap-3 mt-1">
                  <span className="hmi-v10-mono font-extrabold text-3xl">{fmtKg(sumaKg, 1)} kg</span>
                  <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>z {target?.label}</span>
                </div>
                <div className="text-sm font-bold mt-1" style={{ color: brakuje > 0 ? 'var(--accent)' : 'var(--success)' }}>
                  {brakuje > 0 ? `brakuje ${fmtKg(brakuje, 1)} kg` : 'cel osiągnięty'}
                </div>
              </div>

              {stacks.length > 0 && (
                <div className="flex flex-col gap-2 max-h-40 overflow-auto">
                  {stacks.map((s, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-2.5" style={{ borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                      <span className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', minWidth: 74 }}>słupek {i + 1}</span>
                      <span className="hmi-v10-mono font-extrabold text-lg flex-1" style={{ fontFamily: MONO }}>{fmtKg(s.netKg, 1)} kg</span>
                      <span className="text-xs font-bold" style={{ color: 'var(--mut)' }}>{s.containers} poj.</span>
                      <button type="button" onClick={() => usunSlupek(i)} aria-label="Usuń słupek"
                        className="w-9 h-9 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: '#B45309' }}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div>
                <div className="text-xs font-bold uppercase mb-2" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>
                  Liczba pojemników (× {fmtKg(E2_TARE_KG, 0)} kg)
                </div>
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

            {/* Prawa: waga */}
            <div className="w-[320px] flex-shrink-0 flex flex-col gap-3">
              <div className="p-4" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <div className="flex items-center gap-2">
                  <span className="w-[7px] h-[7px] rounded-full" style={{ background: scale.connected ? 'var(--success)' : '#DC2626' }} />
                  <span className="text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.1em' }}>Waga</span>
                </div>
                <div className="flex items-baseline gap-2 mt-2">
                  <span className="hmi-v10-mono font-extrabold leading-none" style={{ fontFamily: MONO, fontSize: 48 }}>{fmtKg(scale.gross, 1)}</span>
                  <span className="text-base font-bold" style={{ color: 'var(--mut)' }}>kg</span>
                </div>
                <div className="text-[11px] font-bold uppercase mt-1" style={{ color: scale.stable ? 'var(--success)' : 'var(--mut)' }}>
                  {!scale.connected ? 'BRAK WAGI' : scale.gross <= 0 ? 'PUSTA' : scale.stable ? 'STABILNA' : 'WAŻENIE…'}
                </div>
                <div className="mt-3 pt-3 flex flex-col gap-1" style={{ borderTop: '1px solid var(--line)' }}>
                  {isFirst && (
                    <div className="flex justify-between text-[12px] font-bold" style={{ color: 'var(--mut)' }}>
                      <span>− nośnik ({carrier?.label})</span>
                      <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>−{fmtKg(carrier?.kg ?? 0, 1)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-[12px] font-bold" style={{ color: 'var(--mut)' }}>
                    <span>− {containers} pojemn.</span>
                    <span className="hmi-v10-mono" style={{ color: 'var(--ink)' }}>{containers > 0 ? `−${fmtKg(containers * E2_TARE_KG, 0)}` : '—'}</span>
                  </div>
                  <div className="flex items-baseline justify-between px-3 py-2 mt-1"
                    style={{ borderRadius: 8, background: wNormie ? 'var(--successSoft)' : 'var(--accentSoft)' }}>
                    <span className="text-[11px] font-bold uppercase" style={{ color: wNormie ? 'var(--success)' : 'var(--accent)' }}>
                      Netto {wNormie ? '✓' : `cel ${fmtKg(celSlupka, 1)}`}
                    </span>
                    <span className="hmi-v10-mono font-extrabold text-2xl" style={{ color: wNormie ? 'var(--success)' : 'var(--accent)' }}>{fmtKg(netto, 1)} kg</span>
                  </div>
                </div>
              </div>

              <button type="button" onClick={dodajSlupek} disabled={!canAdd}
                className="h-16 font-extrabold text-lg flex items-center justify-center gap-2" style={{
                  borderRadius: 12,
                  background: canAdd ? (wNormie ? 'var(--success)' : 'var(--accent)') : 'var(--panel)',
                  color: canAdd ? '#fff' : 'var(--mut)', border: `1px solid ${canAdd ? 'transparent' : 'var(--line)'}`,
                }}>
                {canAdd ? <><Check size={22} /> Dodaj słupek</> : !scale.stable ? 'Czekam na wagę…' : 'Wjedź na wagę'}
              </button>

              {!wNormie && canAdd && (
                <div className="flex items-center gap-2 px-3 py-2 text-[11px] font-bold"
                  style={{ borderRadius: 8, background: '#FEF3C7', color: '#B45309' }}>
                  <AlertTriangle size={14} /> Poza tolerancją ±{TOLERANCE_KG} kg — możesz dodać, ale sprawdź
                </div>
              )}

              {/* Tarowanie robi się PRZYCISKIEM NA MIERNIKU. Przycisk w aplikacji
                  był tu wcześniej, ale most RS232 nie tarował wagi (hala,
                  14.08.2026) — martwy przycisk na ekranie hali jest gorszy niż
                  jego brak. Wróci, gdy komenda tary zadziała na mierniku. */}
              {stacks.length > 0 && (
                <div className="px-3 py-2 text-[11px] font-bold text-center"
                  style={{ borderRadius: 8, background: 'var(--accentSoft)', color: 'var(--accent)' }}>
                  Wytaruj wagę przyciskiem na mierniku i buduj kolejny słupek
                </div>
              )}
              <button type="button" onClick={() => przejdzDoSkladu(sumaKg)} disabled={stacks.length === 0}
                className="h-11 text-sm font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: stacks.length ? 'var(--ink)' : 'var(--mut)' }}>
                Koniec — przejdź do składu
              </button>
            </div>
          </div>
        ) : phase === 'summary' || phase === 'saving' ? (
          <div className="flex flex-col gap-4 p-6 overflow-auto">
            <div className="px-5 py-4 flex items-center justify-between" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
              <div>
                <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.08em' }}>Paleta gotowa</div>
                <div className="hmi-v10-mono font-extrabold text-3xl mt-1">{fmtKg(sumaKg, 1)} kg</div>
              </div>
              <div className="text-right text-sm font-bold" style={{ color: 'var(--mut)' }}>
                <div>{stacks.length} {stacks.length === 1 ? 'słupek' : 'słupki'} · {sumaPojemnikow} pojemników</div>
                <div className="text-[11px] mt-1">{carrier?.label}</div>
              </div>
            </div>

            <div className="text-sm font-bold" style={{ color: 'var(--mut)' }}>
              Z jakich partii jest to mięso? (propozycja od najstarszej)
            </div>
            <div className="flex flex-col gap-2">
              {lots.map((l, i) => (
                <div key={i} className="flex items-center gap-3 px-4 py-3" style={{ borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                  <span className="hmi-v10-mono font-extrabold text-xl" style={{ fontFamily: MONO, minWidth: 90 }}>{l.lotNo}</span>
                  <div className="flex items-center gap-2 flex-1">
                    <input type="number" inputMode="decimal" step="0.1" min="0"
                      value={kgEdit?.idx === i ? kgEdit.text : String(l.kg)}
                      onChange={ev => zmienKgPartii(i, ev.target.value)}
                      onFocus={ev => { setKgEdit({ idx: i, text: String(l.kg) }); ev.currentTarget.select() }}
                      onBlur={() => setKgEdit(null)}
                      aria-label={`Kilogramy z partii ${l.lotNo}`}
                      className="hmi-v10-mono font-extrabold text-lg h-12 px-3 text-right"
                      style={{ fontFamily: MONO, width: 116, borderRadius: 8, border: '1.5px solid var(--line)', background: 'var(--bg)', color: 'var(--ink)' }} />
                    <span className="text-sm font-bold" style={{ color: 'var(--mut)' }}>kg</span>
                  </div>
                  <span className="text-[11px] font-bold" style={{ color: 'var(--mut)' }}>
                    zostało {fmtKg(kgLotu.get(l.lotNo) ?? 0, 0)} kg
                  </span>
                  <button type="button" onClick={() => setPicker({ mode: 'swap', idx: i })}
                    className="h-10 px-3 text-sm font-bold" style={{ borderRadius: 8, border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                    Zmień partię
                  </button>
                  <button type="button" onClick={() => setLots(ls => ls.filter((_, k) => k !== i))} aria-label="Usuń pozycję"
                    className="w-10 h-10 flex items-center justify-center" style={{ borderRadius: 8, border: '1px solid var(--line)', color: '#B45309' }}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            {Math.abs(doPrzypisania) > 0.05 && (
              <div className="flex items-center justify-between gap-3 px-5 py-3.5" style={{ borderRadius: 12, background: '#FEE2E2', border: '1.5px solid #FCA5A5' }}>
                <div className="flex items-center gap-3 text-sm font-bold" style={{ color: '#B91C1C' }}>
                  <AlertTriangle size={20} />
                  {doPrzypisania > 0
                    ? `Do przypisania: ${fmtKg(doPrzypisania, 1)} kg — wskaż partię`
                    : `Skład przekracza wagę palety o ${fmtKg(-doPrzypisania, 1)} kg`}
                </div>
                {doPrzypisania > 0 && (
                  <button type="button" onClick={() => setPicker({ mode: 'add' })}
                    className="h-10 px-4 text-sm font-bold" style={{ borderRadius: 8, background: '#B91C1C', color: '#fff' }}>
                    Wskaż partię
                  </button>
                )}
              </div>
            )}

            {/* Strażnik partii — ten sam rachunek co na backendzie, tyle że
                widoczny, zanim operator dojdzie do zapisu. */}
            {/* Dobranie mięsa z INNEJ partii niż ta z ekranu. Dokładnie to
                zrobiło z palety 503 etykietę „485" — więc nie przechodzi po
                cichu: operator musi to potwierdzić palcem. */}
            {dobraneZInnych > 0.05 && (
              <div className="flex flex-col gap-3 px-4 py-3" data-testid="bw-laczenie"
                style={{ borderRadius: 12, background: '#FEF3C7', border: '1.5px solid #F59E0B' }}>
                <div className="text-sm font-bold" style={{ color: '#92400E' }}>
                  {postep
                    ? `Z partii ${postep.lotNo} zostało ${postep.leftKg} kg — brakujące ${fmtKg(dobraneZInnych, 1)} kg dobrano z kolejnej partii.`
                    : `${fmtKg(dobraneZInnych, 1)} kg dobrano z innej partii.`}
                  {' '}Sprawdź skład poniżej — wejdzie na etykietę.
                </div>
                {!laczenieOk && (
                  <button type="button" onClick={() => setLaczenieOk(true)}
                    data-testid="bw-laczenie-ok"
                    className="h-12 font-extrabold"
                    style={{ borderRadius: 10, background: '#F59E0B', color: '#fff' }}>
                    Tak, paleta jest z dwóch partii
                  </button>
                )}
              </div>
            )}

            {przekroczenia.length > 0 && (
              <div className="flex flex-col gap-1.5 px-5 py-3.5" style={{ borderRadius: 12, background: '#FEE2E2', border: '1.5px solid #FCA5A5' }}>
                {przekroczenia.map(x => (
                  <div key={x.lotNo} className="flex items-center gap-3 text-sm font-bold" style={{ color: '#B91C1C' }}>
                    <AlertTriangle size={20} />
                    Z partii {x.lotNo} zostało {fmtKg(x.freeKg, 1)} kg,
                    a paleta bierze {fmtKg(x.kg, 1)} kg — resztę wskaż z kolejnej partii.
                  </div>
                ))}
              </div>
            )}

            {saveErr && (
              <div className="px-4 py-3 text-sm font-bold" style={{ borderRadius: 10, background: '#FEE2E2', color: '#B91C1C' }}>{saveErr}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setPhase('stack')} disabled={phase === 'saving'}
                className="h-16 font-bold text-base flex items-center justify-center gap-2"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--mut)' }}>
                <ArrowLeft size={20} /> Wróć do ważenia
              </button>
              <button type="button" onClick={zapiszIDrukuj}
                disabled={phase === 'saving' || Math.abs(doPrzypisania) > 0.05 || lots.length === 0 || przekroczenia.length > 0 || !laczenieOk}
                className="h-16 font-extrabold text-lg flex items-center justify-center gap-2"
                style={{
                  borderRadius: 12,
                  background: Math.abs(doPrzypisania) > 0.05 || lots.length === 0 || przekroczenia.length > 0 || !laczenieOk ? 'var(--panel)' : 'var(--success)',
                  color: Math.abs(doPrzypisania) > 0.05 || lots.length === 0 || przekroczenia.length > 0 || !laczenieOk ? 'var(--mut)' : '#fff',
                  border: '1px solid var(--line)',
                }}>
                <Printer size={22} /> {phase === 'saving' ? 'Zapisuję…' : 'Zapisz i drukuj'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 p-12">
            <span className="w-20 h-20 rounded-full flex items-center justify-center" style={{ background: 'var(--success)', color: '#fff' }}><Check size={44} strokeWidth={3} /></span>
            <div className="text-center">
              <div className="font-extrabold text-2xl">Paleta zapisana</div>
              <div className="hmi-v10-mono font-extrabold text-3xl mt-2" style={{ color: 'var(--success)' }}>{palletNo}</div>
              <div className="text-sm font-bold mt-1" style={{ color: 'var(--mut)' }}>
                {fmtKg(sumaKg, 1)} kg · {sumaPojemnikow} pojemników
              </div>
              {printMsg && <div className="text-sm font-bold mt-3" style={{ color: 'var(--mut)' }}>{printMsg}</div>}
            </div>
            <div className="grid grid-cols-2 gap-3 w-full max-w-[460px]">
              <button type="button" onClick={() => void drukuj(palletNo)}
                className="h-14 font-bold flex items-center justify-center gap-2"
                style={{ borderRadius: 12, background: 'var(--panel)', border: '1.5px solid var(--accent)', color: 'var(--accent)' }}>
                <Printer size={20} /> Drukuj ponownie
              </button>
              <button type="button" onClick={onClose}
                className="h-14 font-extrabold flex items-center justify-center gap-2"
                style={{ borderRadius: 12, background: 'var(--accent)', color: '#fff' }}>
                <Package size={20} /> Gotowe
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Zważone dziś — dodruk etykiety do palety, która już pojechała. */}
      {listaOtwarta && (
        <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/50">
          <div className="w-[720px] max-w-[94vw] flex flex-col" style={{ maxHeight: '88vh', borderRadius: 14, background: 'var(--bg)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
            <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--line)', background: 'var(--panel)', borderTopLeftRadius: 14, borderTopRightRadius: 14 }}>
              <ListChecks size={20} style={{ color: 'var(--accent)' }} />
              <div className="flex-1">
                <div className="font-extrabold text-lg leading-tight">Zważone dziś</div>
                <div className="text-xs font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.06em' }}>
                  {zwazone.length} {zwazone.length === 1 ? 'paleta' : 'palet'} · dodruk etykiety
                </div>
              </div>
              <button type="button" onClick={() => setListaOtwarta(false)} aria-label="Zamknij"
                className="w-11 h-11 flex items-center justify-center" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
                <X size={20} />
              </button>
            </div>

            <div className="flex flex-col gap-2 p-5 overflow-auto">
              {zwazone.map(p => (
                <div key={p.id} className="flex items-center gap-4 px-4 py-3" style={{ borderRadius: 12, background: 'var(--panel)', border: '1px solid var(--line)' }}>
                  <div className="flex flex-col min-w-0" style={{ flex: '1 1 0' }}>
                    <span className="hmi-v10-mono font-extrabold text-lg leading-tight" style={{ fontFamily: MONO }}>{p.palletNo}</span>
                    <span className="text-[11px] font-bold truncate" style={{ color: 'var(--mut)' }}>
                      {p.lots.map(l => `${l.lotNo} · ${fmtKg(l.kg, 1)} kg`).join('  |  ') || 'bez składu'}
                    </span>
                  </div>
                  <div className="flex flex-col items-end" style={{ minWidth: 110 }}>
                    <span className="hmi-v10-mono font-extrabold text-xl leading-tight" style={{ fontFamily: MONO }}>{fmtKg(p.kgNet, 1)} kg</span>
                    <span className="text-[11px] font-bold" style={{ color: 'var(--mut)' }}>{p.containers} pojemników</span>
                  </div>
                  <button type="button" onClick={() => dodrukuj(p)} disabled={dodruk === p.palletNo}
                    className="h-12 px-4 font-bold flex items-center justify-center gap-2"
                    style={{ borderRadius: 10, background: 'var(--accent)', color: '#fff', minWidth: 150 }}>
                    <Printer size={18} /> {dodruk === p.palletNo ? 'Drukuję…' : 'Drukuj etykietę'}
                  </button>
                </div>
              ))}
              {zwazone.length === 0 && (
                <div className="text-sm font-bold px-2 py-10 text-center" style={{ color: 'var(--mut)' }}>
                  Dziś nie zważono jeszcze żadnej palety.
                </div>
              )}
            </div>

            {printMsg && (
              <div className="px-6 py-3 text-sm font-bold flex-shrink-0" style={{ borderTop: '1px solid var(--line)', color: 'var(--mut)' }}>{printMsg}</div>
            )}
          </div>
        </div>
      )}

      {/* Wybór partii — lista lotów z magazynu mięsa, od najstarszego. */}
      {picker && (
        <div className="fixed inset-0 z-[58] flex items-center justify-center bg-black/50">
          <div className="w-[560px] max-w-[92vw] p-6 flex flex-col gap-4" style={{ borderRadius: 14, background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}>
            <div className="font-extrabold text-xl">Wybierz partię</div>
            <div className="flex flex-col gap-2 max-h-[50vh] overflow-auto">
              {pool.map(m => (
                <button key={m.id} type="button"
                  onClick={() => {
                    if (picker.mode === 'swap') {
                      setLots(ls => ls.map((l, k) => k === picker.idx ? { ...l, lotNo: m.lotNo } : l))
                    } else {
                      // Nie wsypujemy całej reszty w jedną partię: tyle, ile
                      // w niej zostało — ogon idzie na kolejną (FEFO).
                      setLots(ls => [...ls, { lotNo: m.lotNo, kg: r1(Math.min(doPrzypisania, wolneNaPalety(m))) }])
                    }
                    setPicker(null)
                  }}
                  className="flex items-center gap-3 px-4 py-3 text-left" style={{ borderRadius: 10, border: '1px solid var(--line)' }}>
                  <span className="hmi-v10-mono font-extrabold text-lg" style={{ minWidth: 80 }}>{m.lotNo}</span>
                  <span className="text-sm font-bold flex-1" style={{ color: 'var(--mut)' }}>
                    zostało {fmtKg(wolneNaPalety(m), 1)} kg
                  </span>
                  <span className="text-xs font-bold" style={{ color: 'var(--mut)' }}>do {m.expiryDate || '—'}</span>
                </button>
              ))}
              {pool.length === 0 && (
                <div className="text-sm font-bold px-2 py-6 text-center" style={{ color: 'var(--mut)' }}>
                  Magazyn mięsa jest pusty — nie ma z czego złożyć palety.
                </div>
              )}
            </div>
            <button type="button" onClick={() => setPicker(null)}
              className="h-12 font-bold" style={{ borderRadius: 10, border: '1px solid var(--line)', color: 'var(--mut)' }}>
              Anuluj
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
