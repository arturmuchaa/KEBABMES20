/**
 * ProductionHmiPage — stanowisko produkcyjne hali.
 *
 * Wygląd i obsługa jak w HMI rozbiorowym (wspólny motyw, wspólna rama kiosku),
 * zasady działania jak w tablecie produkcji: plan dnia listą, liczenie sztuk,
 * zakończenie przez `tabletFinish`, biuro kwituje osobno. Backend bez zmian
 * poza materiałami dnia (folia stretch).
 *
 * Stan postępu bierzemy WYŁĄCZNIE z serwera (`qtyDone`, `workerEntries`), nie
 * z lokalnej kopii. Tablet trzyma własny `progress` seedowany z serwera i musi
 * pilnować, żeby odświeżenie go nie zdeptało; tutaj nie ma czego deptać —
 * a to dokładnie ta klasa błędów, która 24.08.2026 zamroziła licznik rozbioru.
 *
 * Układ (01.10.2026): plan dnia i panel liczenia stoją OBOK siebie, cały czas.
 * Wybrana pozycja nie zamyka się po zapisie ani po zrobieniu planu.
 *
 * Skanowanie (03.10.2026): sztuki skanuje się PROSTO z głównego ekranu — bez
 * wyboru pozycji i bez okna. Etykieta wskazuje pozycję, serwer ją rozpoznaje
 * (`expected_plan_id` = plan widoczny w chwili odczytu), a stały pasek
 * skanera mówi, co się stało. Skan nie rusza zaznaczenia, osoby, `qtyDone`
 * ani wpisów pracy — ręczne naliczanie żyje obok, niezależnie.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Spinner } from '@/components/ui/widgets'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { useAuth } from '@/features/auth/AuthContext'
import {
  dayMaterialsApi, finishedUnitsApi, packagingApi, productionPlansApi, productionRatesApi, usersApi, wrappingApi,
  type ScanProducedResult,
} from '@/lib/api'
import { getProductionDate } from '@/features/deboning/utils'
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'
import { planDiff, snapshotPlanu, type PlanChange, type PlanSnapshotLine } from '@/features/production-hmi/planDiff'
import { planTotals, type WorkerEntry } from '@/features/production-hmi/planProgress'
import { removablePieces, type ScanMap } from '@/features/production-hmi/scanProgress'
import { finishForecast, type Forecast } from '@/features/production-hmi/finishForecast'
import { shiftStats, type ShiftEntry } from '@/features/production-hmi/shiftStats'
import {
  BRAK_PRZERW, breakEnded, breakStarted, breaksFromServer, canSave, onBreak, pausedMs, type BreakState,
} from '@/features/production-hmi/breakState'
import { PlanList, type PlanLineView } from '@/features/production-hmi/components/PlanList'
import {
  LineCounter, LineCounterEmpty, type SaveFeedback, type SaveRequest,
} from '@/features/production-hmi/components/LineCounter'
import { LineDetails } from '@/features/production-hmi/components/LineDetails'
import '@/features/production-hmi/production-hmi.css'
import { PlanChangedBanner } from '@/features/production-hmi/components/PlanChangedBanner'
import { BreakOverlay } from '@/features/production-hmi/components/BreakOverlay'
import { ShiftStats } from '@/features/production-hmi/components/ShiftStats'
import { DaySummary } from '@/features/production-hmi/components/DaySummary'
import { WrappingModal } from '@/features/production-hmi/components/WrappingModal'
import { PackagingPicker } from '@/features/production-hmi/components/PackagingPicker'
import { MovePiecesModal } from '@/features/production-hmi/components/MovePiecesModal'
import { PasekSkanera } from '@/features/production-hmi/components/PasekSkanera'
import { useKolejkaSkanow, type RekordSkanu } from '@/features/production-hmi/useKolejkaSkanow'
import { utworzHarmonogramOdswiezania, type Harmonogram } from '@/features/production-hmi/harmonogramOdswiezania'
import { useSkanGlobalny } from '@/features/scan/useSkanGlobalny'
import { usePoleSkanu } from '@/features/scan/usePoleSkanu'
import { ForecastPanel } from '@/features/production-hmi/components/ForecastPanel'
import { wrappedTotal } from '@/features/production-hmi/wrapping'
import { crewLabels, productionCrew, wrappingCrew } from '@/features/production-hmi/crew'

declare const __PRODUKCJA_VERSION__: string

const DZIAL = 'produkcja'
/** Kartoteka folii w opakowaniach — rozpoznajemy ją po nazwie, jak reszta MES. */
const FOLIA = 'folia'
const BRAK_POZYCJI = 'Tej pozycji nie ma już w planie'
const CZEKAJA_SKANY = 'Poczekaj — zapisują się zeskanowane sztuki'
/** Kolejka bez postępu tak długo (albo tak duża) = alarm na pasku. */
const ALARM_MS = 5000
const ALARM_KOLEJKA = 100

/** Licznik skanu pozycji POTWIERDZONY odpowiedzią serwera (`done`/`total`). */
interface Potwierdzenie { scanned: number; total: number; seq: number }
interface MigawkaSkanow { planId: string; linie: Record<string, Potwierdzenie> }
interface OdczytSkanow {
  planId: string
  /** `skanSeq` w chwili WYJŚCIA odczytu — potwierdzenia ≤ od są w nim zawarte. */
  od: number
  rows: { planLineId: string; total: number; scanned: number }[]
}

const czasHM = (ms: number): string => {
  const m = Math.max(0, Math.round(ms / 60_000))
  const g = Math.floor(m / 60)
  return g ? `${g} godz. ${m % 60} min` : `${m} min`
}

const dzienPoPolsku = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00`)
  if (Number.isNaN(d.getTime())) return iso
  const dni = ['niedziela', 'poniedziałek', 'wtorek', 'środa', 'czwartek', 'piątek', 'sobota']
  return `${dni[d.getDay()]} ${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`
}

type Wpis = WorkerEntry

/**
 * Wpisy osób po zmianie o `zmiana` sztuk (już przyciętej) — rusza WYŁĄCZNIE
 * wpisy wskazanej osoby.
 *
 * Osoba bywa w kilku wpisach (np. A:2, A:3), a jej dorobek to ich suma.
 * Odejmowanie schodzi więc po wszystkich jej wpisach, od najnowszego —
 * zdjęcie wszystkiego z pierwszego wpisu i odfiltrowanie ujemnego zostawiało
 * A:3 zamiast A:1, czyli rozliczenie rozjeżdżało się z `qtyDone`.
 * Wpis na zero to nie wpis — zostawiony straszyłby w statystykach zmiany
 * jako osoba z zerem sztuk (tak samo jak przy przepisywaniu na serwerze).
 */
function zmienWpisy(dotad: Wpis[], kto: { id: string; name: string }, zmiana: number): Wpis[] {
  if (zmiana > 0) {
    const idx = dotad.findIndex(e => e.workerId === kto.id)
    return idx >= 0
      ? dotad.map((e, i) => (i === idx ? { ...e, pieces: (e.pieces ?? 0) + zmiana } : e))
      : [...dotad, { workerId: kto.id, workerName: kto.name, pieces: zmiana,
                     addedAt: new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) }]
  }
  let zostalo = -zmiana
  const out = [...dotad]
  for (let i = out.length - 1; i >= 0 && zostalo > 0; i--) {
    if (out[i].workerId !== kto.id) continue
    const zdejmij = Math.min(zostalo, Math.max(0, out[i].pieces ?? 0))
    out[i] = { ...out[i], pieces: (out[i].pieces ?? 0) - zdejmij }
    zostalo -= zdejmij
  }
  return out.filter(e => e.workerId !== kto.id || (e.pieces ?? 0) > 0)
}

export function ProductionHmiPage({ buildLabel = `Produkcja · ${__PRODUKCJA_VERSION__}` }: { buildLabel?: string }) {
  const { user, logout } = useAuth()
  const [dzien] = useState(() => getProductionDate())

  // Plan NIEAKTUALNY od nieudanego odczytu do NASTĘPNEGO UDANEGO. `useApi`
  // zeruje `error` już na STARCIE ponowienia, więc samo ruszenie odczytu
  // (wiszącego albo skazanego na błąd) udawałoby aktualny plan i wpuszczało
  // skany. Liczy się tylko ostatni wysłany odczyt — starszy, który wróci
  // później, niczego nie rozstrzyga (tak samo `useApi` go porzuca).
  const [planNieaktualny, setPlanNieaktualny] = useState(false)
  const odczytPlanuSeq = useRef(0)
  // Odmontowanie unieważnia odczyt w locie — `useApi` chroni tylko własny
  // stan, a ten wynik wróciłby do martwego komponentu. StrictMode po
  // ponownym zamontowaniu i tak rusza nowy odczyt z wyższym numerem.
  useEffect(() => () => { odczytPlanuSeq.current++ }, [])
  const planData = useApi(async () => {
    const seq = ++odczytPlanuSeq.current
    try {
      const plany = await productionPlansApi.list()
      if (seq === odczytPlanuSeq.current) setPlanNieaktualny(false)
      return plany
    } catch (e) {
      if (seq === odczytPlanuSeq.current) setPlanNieaktualny(true)
      throw e
    }
  })
  // Lista z ROLI pracownika, nie z działu.
  //
  // Dział mówi „kto ma dostęp do panelu" — po wdrożeniu 1.0.1 stał tam sam
  // kierownik, bo tylko on ma PIN, a sztuki liczy się ludziom z linii.
  // Rozbiór robi to tak samo (`WORKER_DEBONING`).
  const opsData = useApi(() => usersApi.list())
  const matData = useApi(() => dayMaterialsApi.forDay(dzien))
  const wrapData = useApi(() => wrappingApi.forDay(dzien))
  // `all`, nie `list`: kartoteka z zerowym stanem musi być widoczna w wyborze
  // tulei (tuleja pozycji potrafi zejść do zera w trakcie dnia).
  const pkgData = useApi(() => packagingApi.all())

  const [wybranaPozycja, setWybranaPozycja] = useState<string | null>(null)
  const [tulejaPozycji, setTulejaPozycji] = useState<string | null>(null)
  /** Szczegóły pozycji (przytrzymanie wiersza) — NIE zmieniają zaznaczenia. */
  const [szczegoly, setSzczegoly] = useState<string | null>(null)
  /** Przepisanie sztuk: pozycja i osoba zamrożone w chwili otwarcia okna. */
  const [przepisywany, setPrzepisywany] = useState<{ lineId: string; workerId: string } | null>(null)
  const [pracownik, setPracownik] = useState('')
  const [wynikZapisu, setWynikZapisu] = useState<SaveFeedback | null>(null)
  const [zapisuje, setZapisuje] = useState(false)
  const [przerwy, setPrzerwy] = useState<BreakState>(BRAK_PRZERW)
  const [statystykiOtwarte, setStatystykiOtwarte] = useState(false)
  const [prognozaOtwarta, setPrognozaOtwarta] = useState(false)
  const [foliowanieOtwarte, setFoliowanieOtwarte] = useState(false)
  const [podsumowanie, setPodsumowanie] = useState(false)
  const [zajety, setZajety] = useState(false)
  const [toast, setToast] = useState('')
  const [teraz, setTeraz] = useState(() => new Date().toISOString())

  // Zegar przerwy i tempa. MUSI być useEffect: useMemo liczy się w trakcie
  // renderu i nigdy nie wywoła sprzątania, więc timery zostałyby po odmontowaniu
  // (a w StrictMode powstałyby dwa).
  useEffect(() => {
    const t = setInterval(() => setTeraz(new Date().toISOString()), 1000)
    return () => clearInterval(t)
  }, [])

  const plan = useMemo(() => {
    const plany = planData.data ?? []
    return plany.find((p: any) => p.planDate === dzien && (p.status === 'active' || p.status === 'draft'))
        ?? plany.find((p: any) => p.status === 'active')
        ?? null
  }, [planData.data, dzien])

  const linie: PlanLineView[] = useMemo(() => (plan?.lines ?? []).map((l: any) => ({
    id: l.id, qty: l.qty, kgPerUnit: l.kgPerUnit, totalKg: l.totalKg,
    recipeName: l.recipeName || l.productTypeName || '',
    packagingId: l.packagingId ?? '', packagingName: l.packagingName ?? '',
    packagingUsed: l.packagingUsed ?? 0,
    seasonedBatchNos: l.seasonedBatchNos ?? (l.seasonedBatchNo ? [l.seasonedBatchNo] : []),
    batchAllocation: l.batchAllocation ?? {},
    clientName: l.clientName ?? '',
    qtyDone: l.qtyDone ?? 0, workerEntries: l.workerEntries ?? [],
  })), [plan])

  // Postęp skanowania per pozycja — osobne źródło, bo `list_plans` ciągnie
  // biuro dla WSZYSTKICH planów, a ten licznik dotyczy tylko planu dnia.
  // Odczyt niesie plan i numer ostatniego potwierdzenia skanu sprzed jego
  // wyjścia — starszy odczyt nie cofnie licznika potwierdzonego później.
  const skanSeq = useRef(0)
  const scanData = useApi<OdczytSkanow>(async () => {
    const planId = plan?.id ?? ''
    const od = skanSeq.current
    const rows = planId ? await finishedUnitsApi.planScanProgress(planId) : []
    return { planId, od, rows: rows ?? [] }
  }, [plan?.id])
  // Tempo uczone z zakończonych dni; przy pustej historii stoi na ziarnie
  // 120 kg/h na osobę, więc prognoza działa od pierwszej produkcji.
  const ratesData = useApi(() => productionRatesApi.current())
  // Przerwy z SERWERA. Do 27.08.2026 żyły tylko w pamięci ekranu i odświeżenie
  // kiosku (auto-update, zerwana sesja) kasowało je razem z blokadą zapisu
  // sztuk — hala liczyła wtedy w trakcie przerwy.
  // Odczyt niesie plan, którego dotyczy: przerwy poprzedniego planu nie mogą
  // udawać stanu nowego.
  const breaksData = useApi(async () => {
    const planId = plan?.id ?? ''
    const rows = planId ? await productionPlansApi.breaks(planId) : []
    return { planId, rows: rows ?? [] }
  }, [plan?.id])
  // Stan ekranu nadąża za serwerem, ale NIE depcze własnego zapisu w locie:
  // dotknięcie „Przerwa" zmienia stan lokalny natychmiast, a odpowiedź
  // odświeżenia potrafi jeszcze przez chwilę nieść poprzedni stan.
  // `przerwyPlanu` — dla którego planu stan przerw jest ZNANY. Dopóki nie
  // przyjdzie pierwszy odczyt dla aktualnego planu, skaner stoi: trwająca
  // przerwa z serwera nie może mieć okienka, w którym skany idą.
  const zapisPrzerwy = useRef(0)
  const zapisPrzerwyPlan = useRef('')
  const [przerwyPlanu, setPrzerwyPlanu] = useState<string | null>(null)
  useEffect(() => {
    const d = breaksData.data
    if (d === null) return
    setPrzerwyPlanu(d.planId)
    // Zapis w locie dotyczy TEGO planu — stan lokalny jest świeższy niż odczyt.
    if (zapisPrzerwy.current > 0 && zapisPrzerwyPlan.current === d.planId) return
    setPrzerwy(breaksFromServer(d.rows))
  }, [breaksData.data])

  // ── Liczniki skanu: odczyt serwera + potwierdzenia z odpowiedzi skanów ──
  //
  // Udany skan zwraca `done`/`total` swojej pozycji — to stan z serwera, nie
  // optymistyczne +1. Trzymamy je per plan i nakładamy na odczyt, dopóki nie
  // przyjdzie odczyt wysłany PO potwierdzeniu (wtedy rządzi już odczyt).
  // Dubel i błąd nic tu nie zmieniają; zmiana planu migawkę unieważnia.
  const [migawka, setMigawka] = useState<MigawkaSkanow>({ planId: '', linie: {} })
  const potwierdzSkan = useCallback((wynik: ScanProducedResult, planId: string) => {
    const lineId = wynik.planLineId
    if (!lineId) return
    const seq = ++skanSeq.current
    setMigawka(m => {
      const linie = m.planId === planId ? m.linie : {}
      const byl = linie[lineId]
      return { planId, linie: { ...linie, [lineId]: {
        scanned: Math.max(byl?.scanned ?? 0, Number(wynik.done) || 0),
        total: Math.max(byl?.total ?? 0, Number(wynik.total) || 0),
        seq,
      } } }
    })
  }, [])

  const skany: ScanMap = useMemo(() => {
    const out: ScanMap = {}
    const odczyt = scanData.data && scanData.data.planId === (plan?.id ?? '') ? scanData.data : null
    for (const s of odczyt?.rows ?? []) out[s.planLineId] = { total: s.total, scanned: s.scanned }
    if (plan?.id && migawka.planId === plan.id) {
      for (const [id, p] of Object.entries(migawka.linie)) {
        if (odczyt && p.seq <= odczyt.od) continue  // odczyt wyszedł po potwierdzeniu
        const s = out[id]
        out[id] = { total: Math.max(s?.total ?? 0, p.total), scanned: Math.max(s?.scanned ?? 0, p.scanned) }
      }
    }
    return out
  }, [scanData.data, plan?.id, migawka])
  const zeskanowaneRazem = useMemo(
    () => linie.reduce((a, l) => a + (skany[l.id]?.scanned ?? 0), 0),
    [linie, skany],
  )

  // Jeden rejestr źródeł — dopisanie kolejnego nie wymaga pamiętania o drugim
  // miejscu (patrz incydent zamrożonego licznika na rozbiorze). Plan i postęp
  // skanów NIE stoją tutaj: odświeża je harmonogram niżej (co 5 s bez skanów,
  // rzadziej niż co skan w trakcie serii, jeden odczyt naraz).
  useLiveRefresh({ opsData, matData, wrapData, pkgData, ratesData, breaksData })

  const { refetch: odswiezPlan } = planData
  const { refetch: odswiezSkany } = scanData
  const harmonogram = useRef<Harmonogram | null>(null)
  useEffect(() => {
    const h = utworzHarmonogramOdswiezania({ odswiez: () => Promise.all([odswiezPlan(), odswiezSkany()]) })
    harmonogram.current = h
    h.start()
    return () => { h.zatrzymaj(); if (harmonogram.current === h) harmonogram.current = null }
  }, [odswiezPlan, odswiezSkany])

  // ── Kolejka skanów (FIFO, jeden POST w locie, plan zamrożony w rekordzie) ──
  const wyslijSkan = useCallback((r: RekordSkanu) =>
    finishedUnitsApi.scanProduced(r.kod, undefined, undefined, { expectedPlanId: r.planId }), [])
  const poSkanie = useCallback((r: RekordSkanu, wynik: ScanProducedResult) => {
    potwierdzSkan(wynik, wynik.planId || r.planId)
    harmonogram.current?.poZapisie()
  }, [potwierdzSkan])
  const kolejka = useKolejkaSkanow({ wyslij: wyslijSkan, onSukces: poSkanie })
  const { czekaja: skanyCzekajaTeraz } = kolejka
  const skanyCzekaja = kolejka.stan.oczekujace > 0

  // Kody przyjęte, a niewysłane, przepadłyby z zamknięciem karty — natywne
  // ostrzeżenie przeglądarki, dopóki kolejka nie jest pusta.
  useEffect(() => {
    const ostrzez = (e: BeforeUnloadEvent) => {
      if (!skanyCzekajaTeraz()) return
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', ostrzez)
    return () => window.removeEventListener('beforeunload', ostrzez)
  }, [skanyCzekajaTeraz])

  const totals = useMemo(() => planTotals(linie), [linie])

  // ── Co biuro zmieniło od czasu, gdy operator ostatnio patrzył ──
  //
  // Trzymamy migawkę OSTATNIO POTWIERDZONĄ i liczymy różnicę od niej przy
  // każdym renderze. Dwie pułapki, obie złapane przez stelaż okablowania:
  //   • migawka wzięta przed wczytaniem planu jest pusta, więc CAŁA lista
  //     raportowała się jako „doszła pozycja" zaraz po wejściu na ekran;
  //   • trzymanie różnic w stanie („pokaż pierwszą, potem ignoruj") gubiło
  //     drugą zmianę, jeśli biuro poprawiło plan zanim operator potwierdził
  //     pierwszą — czyli dokładnie to, przed czym ten pasek ma chronić.
  const [potwierdzone, setPotwierdzone] = useState<PlanSnapshotLine[] | null>(null)
  useEffect(() => {
    if (potwierdzone === null && planData.data !== null) setPotwierdzone(snapshotPlanu(linie))
  }, [potwierdzone, planData.data, linie])
  const zmiany: PlanChange[] = useMemo(
    () => (potwierdzone ? planDiff(potwierdzone, snapshotPlanu(linie)) : []),
    [potwierdzone, linie],
  )
  const potwierdzZmiany = () => setPotwierdzone(snapshotPlanu(linie))

  // ── Statystyki zmiany — z wpisów pracowników na wszystkich pozycjach ──
  const wpisy: ShiftEntry[] = useMemo(() => {
    const out: ShiftEntry[] = []
    for (const l of linie) {
      for (const w of l.workerEntries ?? []) {
        out.push({ worker: w.workerName, pieces: w.pieces, kgPerPiece: l.kgPerUnit, at: w.addedAt })
      }
    }
    return out
  }, [linie])

  const startZmiany = useMemo(() => `${dzien}T06:00:00`, [dzien])
  const stats = useMemo(
    () => shiftStats(wpisy, { from: startZmiany, now: teraz, pauses: przerwy }),
    [wpisy, startZmiany, teraz, przerwy],
  )

  const przerwyMs = pausedMs(przerwy, teraz)

  // Ilu UKŁADA — z żywych wpisów, nie z kartoteki działu: załoga zmienia się
  // w ciągu dnia (ktoś odchodzi na foliowanie), a prognoza ma płynąć z nią.
  const uklada = useMemo(
    () => new Set(wpisy.filter(w => w.pieces > 0).map(w => w.worker)).size,
    [wpisy],
  )

  const prognoza: Forecast = useMemo(() => finishForecast({
    lines: linie.map(l => ({
      id: l.id, qty: l.qty, qtyDone: l.qtyDone, kgPerUnit: l.kgPerUnit,
      recipeId: (plan?.lines ?? []).find((x: any) => x.id === l.id)?.recipeId ?? '',
    })),
    crew: uklada,
    rates: ratesData.data ?? { seed: 120, global: 120, plannedBreakMinutes: 30, byRecipe: {} },
    todayKg: stats.total.kg,
    todayPersonHours: (stats.total.workedMs / 3_600_000) * uklada,
    todayWorkedMin: stats.total.workedMs / 60_000,
    breakUsedMin: przerwyMs / 60_000,
    now: teraz,
  }), [linie, plan, uklada, ratesData.data, stats, przerwyMs, teraz])

  const folia = useMemo(
    () => (matData.data ?? []).find(m => m.name.toLowerCase().includes(FOLIA)) ?? null,
    [matData.data],
  )
  const foliaId = useMemo(() => folia?.packagingId ?? '', [folia])

  const operatorzy = useMemo(() => productionCrew(opsData.data as any), [opsData.data])
  const foliowczycy = useMemo(() => wrappingCrew(opsData.data as any), [opsData.data])
  const etykietyZalogi = useMemo(() => crewLabels(operatorzy), [operatorzy])
  const pozycja = linie.find(l => l.id === wybranaPozycja) ?? null
  const pozycjaTulei = linie.find(l => l.id === tulejaPozycji) ?? null
  const lpPozycji = (id: string) => linie.findIndex(l => l.id === id) + 1

  // Zmiana pozycji zdejmuje wybór osoby — sztuki idą do wypłaty, więc osoba
  // z poprzedniej pozycji nie może „przejechać" na nową bez dotknięcia.
  // Ilość wraca do 1, bo panel montuje się od nowa (`key`).
  const wybranaRef = useRef(wybranaPozycja)
  wybranaRef.current = wybranaPozycja
  const wybierzPozycje = useCallback((id: string) => {
    if (wybranaRef.current !== id) { setPracownik(''); setWynikZapisu(null) }
    setWybranaPozycja(id)
  }, [])

  const foliowanie = wrapData.data ?? []
  const zafoliowane = useMemo(() => wrappedTotal(foliowanie), [foliowanie])
  // Tuleja idzie jedna na sztukę — zużycie dnia to po prostu zrobione sztuki.
  const tulejeZuzyte = totals.sztDone

  // Jeden timer dymka: nowy komunikat kasuje poprzedni (inaczej stary timer
  // gasiłby świeży dymek), a odmontowanie sprząta wszystko. Wynik zapisu
  // przychodzący PO odmontowaniu nie stawia już nowego timera.
  const zamontowany = useRef(true)
  const timerToastu = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    zamontowany.current = true
    return () => {
      zamontowany.current = false
      if (timerToastu.current) clearTimeout(timerToastu.current)
      timerToastu.current = null
    }
  }, [])
  const pokazToast = (t: string) => {
    if (!zamontowany.current) return
    if (timerToastu.current) clearTimeout(timerToastu.current)
    setToast(t)
    timerToastu.current = setTimeout(() => { timerToastu.current = null; setToast('') }, 3000)
  }

  // Najświeższy stan przerwy — dla zapisów, które czekają na odczyt serwera.
  // Callback zapisu ma w domknięciu `przerwy` z chwili dotknięcia; przerwa
  // rozpoczęta w trakcie odczytu musi zatrzymać PATCH mimo to.
  const przerwyRef = useRef(przerwy)
  przerwyRef.current = przerwy

  // ── Bezpieczeństwo kolejnych zapisów ──
  //
  // Zapis wysyła CAŁY stan pozycji (qtyDone + wpisy osób). Liczymy go NIE
  // z planu na ekranie, tylko ze ŚWIEŻEGO odczytu planu (`byId`) zrobionego
  // pod blokadą, tuż przed PATCH:
  //   • plan na ekranie bywa sprzed poprzedniego zapisu (odświeżenie w locie,
  //     zawieszone odpytywanie) — liczony z niego zapis zjadłby sztuki;
  //   • blokada `zapisWToku` jest synchroniczna i JEDNA dla wszystkich
  //     mutacji pozycji (sztuki, przepisanie, tuleja) — trzyma od odczytu do
  //     końca PATCH, więc następny zapis zawsze czyta stan po poprzednim,
  //     a podwójne dotknięcie nie wyśle drugiego żądania;
  //   • nieudany odczyt = zero PATCH i jasny komunikat. Nic nie udajemy.
  // `useApi.refetch` służy wyłącznie odświeżeniu ekranu — połyka błędy i bywa
  // anulowany, więc nigdy nie jest potwierdzeniem stanu.
  const zapisWToku = useRef(false)
  const zablokuj = () => {
    if (zapisWToku.current) return false
    zapisWToku.current = true
    setZapisuje(true)
    return true
  }
  const odblokuj = () => { zapisWToku.current = false; setZapisuje(false) }

  /** Świeża pozycja z serwera — albo powód, dla którego zapisu nie będzie. */
  const swiezaPozycja = async (planId: string, lineId: string): Promise<{ linia: PlanLineView } | { blad: string }> => {
    let swiezy: any
    try { swiezy = await productionPlansApi.byId(planId) }
    catch (e: any) {
      return { blad: `Nie zapisano — nie udało się pobrać stanu pozycji${e?.message ? ` (${e.message})` : ''}. Spróbuj jeszcze raz` }
    }
    if (!swiezy || swiezy.id !== planId) return { blad: 'Nie zapisano — serwer nie oddał tego planu' }
    if (swiezy.status !== 'active' && swiezy.status !== 'draft') return { blad: 'Nie zapisano — plan nie jest już aktywny' }
    const l = (swiezy.lines ?? []).find((x: any) => x.id === lineId)
    if (!l) return { blad: BRAK_POZYCJI }
    return { linia: {
      ...l, qty: Number(l.qty ?? 0), qtyDone: Math.max(0, Number(l.qtyDone ?? 0)),
      workerEntries: Array.isArray(l.workerEntries) ? l.workerEntries : [],
    } }
  }

  // Wynik zapisu stoi w panelu pozycji; gdy operator zdążył przejść na inną
  // pozycję, mówi o nim też dymek — żeby błąd nie przepadł po cichu.
  const seqWyniku = useRef(0)
  const pokazWynik = (lineId: string, ok: boolean, text: string) => {
    seqWyniku.current += 1
    setWynikZapisu({ seq: seqWyniku.current, lineId, ok, text })
    if (lineId !== wybranaRef.current) pokazToast(`Poz. ${lpPozycji(lineId)}: ${text}`)
  }

  // ── Zapis sztuk (w obie strony) ──
  //
  // Dodatnie `pieces` dopisuje pracę, ujemne ją zdejmuje. Pozycja i osoba
  // przychodzą z panelu zamrożone w chwili dotknięcia — zmiana zaznaczenia
  // w trakcie zapisu nie przelewa sztuk na inną pozycję ani osobę.
  // Odejmowanie zawsze schodzi WSKAZANEJ osobie, nigdy „z pozycji". Serwer
  // trzyma próg skanu; panel gasi przycisk wcześniej, to tylko uprzejmość.
  const zapisz = useCallback(async ({ lineId, workerId, pieces }: SaveRequest) => {
    if (zapisWToku.current) return
    if (!plan || !pieces) return
    // Strażnik autorytatywny — panel i tak gasi przycisk w przerwie.
    if (!canSave(przerwy)) return
    // Bez domyślnej osoby: sztuki idą do wypłaty, „pierwszy z listy" to pomyłka.
    const kto = operatorzy.find(o => o.id === workerId)
    if (!kto) { pokazWynik(lineId, false, 'Wybierz osobę, która zrobiła sztuki'); return }
    // Skany w locie najpierw — zapis i skan nie zazębiają się (przycisk i tak
    // jest wtedy zgaszony; to strażnik synchroniczny na podwójne dotknięcie).
    if (skanyCzekajaTeraz()) { pokazWynik(lineId, false, CZEKAJA_SKANY); return }
    if (!zablokuj()) return
    const planId = plan.id
    const imie = etykietyZalogi.get(kto.id)?.short ?? kto.name

    try {
      const odczyt = await swiezaPozycja(planId, lineId)
      if ('blad' in odczyt) {
        pokazWynik(lineId, false, odczyt.blad)
        // Zdjętej pozycji panel zaraz zniknie razem z komunikatem — dymek zostaje.
        if (odczyt.blad === BRAK_POZYCJI && lineId === wybranaRef.current) pokazToast(odczyt.blad)
        return
      }
      const linia = odczyt.linia

      const dotad = linia.workerEntries ?? []
      const maja = dotad.filter(e => e.workerId === kto.id).reduce((a, e) => a + (e.pieces ?? 0), 0)
      // JEDNA zmiana dla qtyDone i dla wpisu osoby, przycięta do planu
      // i do dorobku osoby. Dawniej qtyDone przycinało się osobno, a wpis
      // dostawał pełne `pieces` — rozliczenie ludzi rozjeżdżało się z postępem.
      // Próg skanu przy odejmowaniu trzyma też serwer.
      const zmiana = pieces > 0
        ? Math.min(pieces, Math.max(0, linia.qty - linia.qtyDone))
        : -Math.min(-pieces, maja, removablePieces(linia, skany), linia.qtyDone)
      if (zmiana === 0) {
        pokazWynik(lineId, false, pieces > 0 ? 'Pozycja ma już komplet sztuk' : 'Tych sztuk nie da się już odjąć')
        return
      }

      const wpisy = zmienWpisy(dotad, kto, zmiana)
      const zrobione = linia.qtyDone + zmiana
      const stan = zrobione >= linia.qty ? 'DONE' : zrobione > 0 ? 'IN_PROGRESS' : 'PLANNED'

      // Przerwa mogła ruszyć, gdy czekaliśmy na odczyt — sprawdzamy NAJŚWIEŻSZY
      // stan tuż przed PATCH, nie ten z chwili dotknięcia.
      if (!canSave(przerwyRef.current)) {
        pokazWynik(lineId, false, 'Przerwa — nie zapisano. Po przerwie dodaj sztuki jeszcze raz')
        return
      }

      try {
        await productionPlansApi.updateLineProgress(planId, lineId,
          { qtyDone: zrobione, lineStatus: stan as any, workerEntries: wpisy })
      } catch (e: any) {
        pokazWynik(lineId, false, e?.message ? `Nie zapisano — ${e.message}` : 'Nie zapisano — spróbuj jeszcze raz')
        return
      }
      // Pozycja ZOSTAJE wybrana także po dobiciu planu — teraz ją się skanuje.
      pokazWynik(lineId, true, zmiana > 0
        ? `Dodano ${zmiana} szt. · ${imie} — pozycja ${zrobione}/${linia.qty}`
        : `Odjęto ${-zmiana} szt. · ${imie} — pozycja ${zrobione}/${linia.qty}`)
    } finally {
      odblokuj()
      void planData.refetch()
    }
  }, [plan, przerwy, operatorzy, etykietyZalogi, planData, skany]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Poprawka „nie ta osoba" ──
  //
  // Sztuki są zrobione i tuleje zeszły — przenosimy wyłącznie przypisanie
  // pracy, bo to ono idzie do wypłaty. Działa też na pozycji gotowej: pomyłka
  // wychodzi zwykle dopiero, gdy pozycja jest zamknięta.
  const przeniesSztuki = useCallback(async (
    ruch: { toWorkerId: string; toWorkerName: string; pieces: number },
  ) => {
    const linia = przepisywany ? linie.find(l => l.id === przepisywany.lineId) : null
    if (!plan || !linia || !przepisywany) return
    // Ta sama blokada co zapis sztuk: przepisanie zmienia wpisy osób na
    // serwerze, więc nie może się zazębić z „Dodaj" tej samej pozycji.
    // Następny zapis sztuk i tak czyta świeży stan (`swiezaPozycja`).
    if (skanyCzekajaTeraz()) { pokazToast(CZEKAJA_SKANY); return }
    if (!zablokuj()) return
    setZajety(true)
    try {
      await productionPlansApi.moveLinePieces(plan.id, linia.id, {
        fromWorkerId: przepisywany.workerId, toWorkerId: ruch.toWorkerId,
        toWorkerName: ruch.toWorkerName, pieces: ruch.pieces, by: user?.name ?? '',
      })
      setPrzepisywany(null)
      void planData.refetch()
      pokazToast(`Przepisano ${ruch.pieces} szt. na ${ruch.toWorkerName.split(' ')[0]}`)
    } catch (e: any) {
      setPrzepisywany(null)
      pokazToast(e?.message ? `Nie udało się przenieść — ${e.message}` : 'Nie udało się przenieść sztuk')
    } finally {
      odblokuj()
      setZajety(false)
    }
  }, [plan, linie, przepisywany, user, planData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Zmiana tulei pozycji ──
  //
  // Metalowe potrafią skończyć się w połowie dnia. Zamykamy okno DOPIERO po
  // udanym zapisie: gdyby zamykało się od razu, operator nie wiedziałby, czy
  // zmiana weszła, i klikałby drugi raz (a każde kliknięcie przerzuca tuleje
  // na magazynie).
  const zmienTuleje = useCallback(async (packagingId: string) => {
    const linia = linie.find(l => l.id === tulejaPozycji)
    if (!plan || !linia) return
    if (skanyCzekajaTeraz()) { pokazToast(CZEKAJA_SKANY); return }
    if (!zablokuj()) return
    setZajety(true)
    try {
      await productionPlansApi.changeLinePackaging(plan.id, linia.id, packagingId)
      setTulejaPozycji(null)
      planData.refetch(); pkgData.refetch()
      pokazToast('Tuleja zmieniona')
    } catch (e: any) {
      setTulejaPozycji(null)
      pokazToast(e?.message ? `Nie udało się zmienić tulei — ${e.message}` : 'Nie udało się zmienić tulei')
    } finally {
      odblokuj()
      setZajety(false)
    }
  }, [plan, linie, tulejaPozycji, planData, pkgData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Przerwy ──
  //
  // Ekran reaguje NATYCHMIAST (stan lokalny), a serwer jest źródłem prawdy.
  // Nieudany zapis nie cofa ekranu: operator już stoi, a przerwa bez zapisu
  // jest mniejszym złem niż przerwa, która nie zablokowała liczenia sztuk.
  const zacznijPrzerwe = useCallback(async () => {
    const od = new Date().toISOString()
    // Ref od razu, nie dopiero po renderze: zapis czekający na odczyt
    // sprawdza go tuż przed PATCH.
    przerwyRef.current = breakStarted(przerwyRef.current, od)
    setPrzerwy(s => breakStarted(s, od))
    if (!plan?.id) return
    zapisPrzerwy.current += 1
    zapisPrzerwyPlan.current = plan.id
    try { await productionPlansApi.startBreak(plan.id); breaksData.refetch() }
    catch { /* ekran już stoi — przerwa bez zapisu jest mniejszym złem */ }
    finally { zapisPrzerwy.current -= 1 }
  }, [plan, breaksData])

  const zakonczPrzerwe = useCallback(async () => {
    setPrzerwy(s => breakEnded(s, new Date().toISOString()))
    if (!plan?.id) return
    zapisPrzerwy.current += 1
    zapisPrzerwyPlan.current = plan.id
    try { await productionPlansApi.endBreak(plan.id); breaksData.refetch() }
    catch { /* ekran już wrócił do pracy */ }
    finally { zapisPrzerwy.current -= 1 }
  }, [plan, breaksData])

  // ── Folia ──
  const pobierzFolie = useCallback(async (ile: number) => {
    if (!foliaId) { pokazToast('Brak kartoteki folii w opakowaniach'); return }
    try {
      await dayMaterialsApi.take(dzien, foliaId, ile, user?.name ?? '')
      matData.refetch()
    } catch (e: any) {
      pokazToast(e?.message || 'Nie udało się pobrać folii')
    }
  }, [foliaId, dzien, user, matData])

  // ── Foliowanie ──
  const zapiszFoliowanie = useCallback(async (shares: { workerId: string; workerName: string; kg: number }[]) => {
    setZajety(true)
    try {
      await wrappingApi.save(dzien, shares, user?.name ?? '')
      wrapData.refetch()
      setFoliowanieOtwarte(false)
      pokazToast('Foliowanie zapisane')
    } catch (e: any) {
      pokazToast(e?.message || 'Nie udało się zapisać foliowania')
    } finally {
      setZajety(false)
    }
  }, [dzien, user, wrapData])

  // ── Zakończenie dnia ──
  //
  // Ta sama blokada co zapis sztuk: zamknięcie nie może wystartować obok
  // zapisu w locie. Wpisy dla biura liczymy ze ŚWIEŻEGO odczytu planu —
  // lista na ekranie bywa sprzed ostatniego zapisu (stare odpytywanie),
  // a z niej `tabletFinish` zgubiłby sztuki. Nieudany odczyt = ani zwrotu
  // folii, ani wysłania do biura.
  const zakonczDzien = useCallback(async (zwrot: number) => {
    if (!plan || zapisWToku.current) return
    // Kody w kolejce należą do tego planu — po `tabletFinish` serwer by je
    // odrzucił. Najpierw kolejka, potem zamknięcie.
    if (skanyCzekajaTeraz()) { pokazToast(CZEKAJA_SKANY); return }
    if (!zablokuj()) return
    setZajety(true)
    const planId = plan.id
    try {
      let swiezy: any
      try { swiezy = await productionPlansApi.byId(planId) }
      catch (e: any) {
        pokazToast(`Nie zamknięto dnia — nie udało się pobrać planu${e?.message ? ` (${e.message})` : ''}. Spróbuj jeszcze raz`)
        return
      }
      if (!swiezy || swiezy.id !== planId) { pokazToast('Nie zamknięto dnia — serwer nie oddał tego planu'); return }
      if (zwrot > 0 && foliaId) {
        await dayMaterialsApi.giveBack(dzien, foliaId, zwrot, user?.name ?? '')
      }
      const entries = (swiezy.lines ?? [])
        .filter((l: any) => (l.qtyDone ?? 0) > 0)
        .map((l: any) => ({
          planLineId: l.id,
          qty: l.qtyDone ?? 0,
          workerNames: (l.workerEntries ?? []).map((e: any) => e.workerName),
          kgPerUnit: l.kgPerUnit,
          productTypeId: l.productTypeId,
          productTypeName: l.productTypeName,
          recipeId: l.recipeId,
          recipeName: l.recipeName,
          packagingId: l.packagingId,
          packagingName: l.packagingName,
          clientOrderId: l.clientOrderId,
          clientOrderNo: l.clientOrderNo,
          clientName: l.clientName,
          seasonedBatchNos: l.seasonedBatchNos ?? (l.seasonedBatchNo ? [l.seasonedBatchNo] : []),
        }))
      await productionPlansApi.tabletFinish(planId, entries)
      setPodsumowanie(false)
      planData.refetch(); matData.refetch()
      pokazToast('Wysłano do potwierdzenia biura')
    } catch (e: any) {
      pokazToast(e?.message || 'Nie udało się zamknąć dnia')
    } finally {
      odblokuj()
      setZajety(false)
    }
  }, [plan, foliaId, dzien, user, planData, matData]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Skaner na GŁÓWNYM ekranie ──
  //
  // Gotowy od wejścia, bez klikania: nasłuch na dokumencie (fokus na body,
  // wierszu, przycisku) i pole na pasku — oba kładą kody do tej samej
  // kolejki. Poza aktywnym głównym ekranem (okno, przerwa, ręczny zapis,
  // brak/nieaktualny plan, dzień wysłany do biura) skan NIE idzie na serwer:
  // trafia na listę błędów z powodem. Nasłuch działa też wtedy, żeby sufiks
  // Enter skanu nie kliknął przycisku z fokusem w oknie.
  const powodWstrzymania: string | null =
    !plan ? 'brak aktywnego planu'
    : planNieaktualny || planData.error ? 'plan nieaktualny (brak połączenia)'
    : plan.tabletFinishedAt || plan.officeConfirmedAt ? 'dzień wysłany do biura'
    : onBreak(przerwy) ? 'przerwa'
    : podsumowanie ? 'zakończenie dnia'
    : (szczegoly || przepisywany || tulejaPozycji || statystykiOtwarte || prognozaOtwarta || foliowanieOtwarte)
      ? 'otwarte okno'
    : zapisuje || zajety ? 'zapis sztuk w toku'
    // Przerwy tego planu jeszcze nie wczytane — trwająca przerwa z serwera
    // nie może mieć okienka, w którym skany idą.
    : przerwyPlanu !== plan.id ? 'wczytywanie przerw'
    : null
  // W renderze, nie w efekcie: kod, który dojrzał zaraz po otwarciu okna,
  // ma już widzieć blokadę.
  const powodRef = useRef(powodWstrzymania)
  powodRef.current = powodWstrzymania
  const planIdRef = useRef<string>(plan?.id ?? '')
  planIdRef.current = plan?.id ?? ''

  const { przyjmij: doKolejki, odrzuc: odrzucSkan } = kolejka
  const przyjmijSkan = useCallback((kod: string) => {
    const powod = zapisWToku.current ? 'zapis sztuk w toku' : powodRef.current
    const planId = planIdRef.current
    if (powod !== null || !planId) {
      odrzucSkan(kod.trim(), 'Nie wysłano — skaner wstrzymany', powod ?? 'brak aktywnego planu')
      return
    }
    // Plan z CHWILI ODCZYTU — zamrożony w rekordzie kolejki.
    doKolejki(kod, planId)
  }, [doKolejki, odrzucSkan])
  const nieczytelny = useCallback((komunikat: string, fragment: string) => {
    odrzucSkan(fragment, 'Nieczytelny skan — zeskanuj jeszcze raz', komunikat)
  }, [odrzucSkan])

  const { wyczysc: wyczyscGlobalny } = useSkanGlobalny(true, przyjmijSkan, nieczytelny)
  const poleSkanu = useRef<HTMLInputElement | null>(null)
  const pole = usePoleSkanu(poleSkanu, r => {
    if (r.rodzaj === 'kod') przyjmijSkan(r.kod)
    else nieczytelny(r.komunikat, r.fragment)
  }, { aktywny: powodWstrzymania === null })
  // KAŻDA zmiana kontekstu (plan, gotowy ↔ wstrzymany — w obie strony)
  // zrzuca niekompletny ogon OBU buforów. Nasłuch działa też w oknie (sufiks
  // nie może kliknąć przycisku), więc kod zaczęty w oknie albo na starym
  // planie nie może się dokończyć i polecieć po zmianie: jego ciąg dalszy
  // bufor oddaje jako błąd „przerwany", a Enter po nim połyka jak sufiks.
  // Kody już przyjęte do kolejki zostają ze swoim planem. Layout, nie zwykły
  // efekt: przed następnym klawiszem.
  const wstrzymany = powodWstrzymania !== null
  const { wyczysc: wyczyscPole } = pole
  useLayoutEffect(() => {
    wyczyscGlobalny()
    wyczyscPole()
  }, [plan?.id, wstrzymany, wyczyscGlobalny, wyczyscPole])

  // Okna (szczegóły pozycji — przycisk i przytrzymanie wiersza, foliowanie,
  // prognoza, statystyki) NIE otwierają się, dopóki kolejka skanów nie jest
  // pusta — tak jak zakończenie dnia, przerwa i wylogowanie. Sprawdzenie
  // synchroniczne (`disabled` dochodzi dopiero z renderem), zamiast okna
  // krótki dymek. Ręczny wybór pozycji i osoby działa dalej.
  const otworzOkno = (otworz: () => void) => {
    if (skanyCzekajaTeraz()) { pokazToast(CZEKAJA_SKANY); return }
    otworz()
  }
  const otworzSzczegoly = (lineId: string) => otworzOkno(() => setSzczegoly(lineId))

  const ostatniProdukt = kolejka.stan.ostatniProdukt
  const ostatniaLiniaSkanu = ostatniProdukt && plan?.id && (ostatniProdukt.planId || plan.id) === plan.id
    ? ostatniProdukt.planLineId ?? null : null
  const alarmKolejki = kolejka.stan.oczekujace >= ALARM_KOLEJKA
    || (kolejka.stan.oczekujace > 0 && Date.parse(teraz) - kolejka.stan.postepAt >= ALARM_MS)

  if (planData.loading && !planData.data) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ ...HMI_VARS, background: 'var(--bg)' }}>
        <Spinner size={48} />
      </div>
    )
  }

  const wPrzerwie = onBreak(przerwy)
  const liniaSzczegolow = szczegoly ? linie.find(l => l.id === szczegoly) ?? null : null
  const liniaPrzepisania = przepisywany ? linie.find(l => l.id === przepisywany.lineId) ?? null : null
  const trwajacaOd = przerwy.pauses.find(p => p.to === null)?.from ?? teraz

  return (
    <div className="phmi-root h-full w-full overflow-hidden flex flex-col"
      style={{ ...HMI_VARS, background: 'var(--bg)', color: 'var(--ink)', fontFamily: HMI_FONT }}>

      <header className="phmi-bar phmi-head flex-shrink-0 flex items-center gap-5 px-6"
        style={{ background: 'var(--barBg)', borderBottom: '1px solid var(--line)' }}>
        <div>
          <div className="font-extrabold text-xl leading-none uppercase" style={{ letterSpacing: '-.01em' }}>Produkcja</div>
          <div className="hmi-v10-mono text-[10px] font-bold uppercase" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>
            {dzien} · {buildLabel}
          </div>
        </div>
        {([
          { label: 'Plan',     val: `${totals.kgPlan} kg` },
          { label: 'Pozycje',  val: String(linie.length) },
          { label: 'Operator', val: (user?.name ?? '—').split(' ')[0], color: 'var(--accent)' },
        ] as const).map(c => (
          <div key={c.label} className="flex flex-col justify-center pl-5 flex-shrink-0"
            style={{ borderLeft: '1px solid var(--lineSoft)' }}>
            <span className="text-[9px] font-bold uppercase leading-none mb-1" style={{ color: 'var(--mut)', letterSpacing: '.14em' }}>{c.label}</span>
            <span className="hmi-v10-mono text-sm font-bold" style={{ color: (c as any).color ?? 'var(--ink)', lineHeight: 1.3 }}>{c.val}</span>
          </div>
        ))}
        <div className="flex-1 min-w-0 flex justify-center">
          {/* Zmiany biura w nagłówku: nad planem stoi pasek skanera, a na
              1280×720 nie ma wysokości na dwie belki. */}
          <PlanChangedBanner changes={zmiany} onAck={potwierdzZmiany} kompakt />
          {/* W nagłówku, nie osobną belką — belka zjadała wysokość planu. */}
          {plan?.tabletFinishedAt && !plan?.officeConfirmedAt && (
            <span role="status" className="text-[13px] font-bold truncate" style={{
              background: 'var(--successSoft)', border: '1px solid var(--successLine)',
              borderRadius: 8, padding: '6px 12px', color: 'var(--success)',
            }}>
              ✓ Dzień wysłany do biura — czeka na potwierdzenie
            </span>
          )}
        </div>
        {/* Skany w kolejce blokują przerwę, zamknięcie dnia i wylogowanie:
            przyjętych kodów nie wolno zgubić ani zostawić za `tabletFinish`.
            `disabled` dla oka, `skanyCzekajaTeraz()` synchronicznie. */}
        <button type="button" onClick={() => { if (!skanyCzekajaTeraz()) void zacznijPrzerwe() }}
          disabled={wPrzerwie || skanyCzekaja} className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
          style={{ border: '1px solid var(--ambLine)', color: 'var(--amb)', borderRadius: 8,
                   background: 'var(--ambSoft)', opacity: wPrzerwie || skanyCzekaja ? .4 : 1 }}>
          Przerwa
        </button>
        {/* Zapis w locie blokuje też zamknięcie dnia — wpisy dla biura liczą się
            ze stanu po zapisie, nie obok niego. */}
        <button type="button" onClick={() => { if (!zapisWToku.current && !skanyCzekajaTeraz()) setPodsumowanie(true) }}
          disabled={!plan || zapisuje || skanyCzekaja}
          className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
          style={{ border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 8, background: 'var(--panel)',
                   opacity: plan && !zapisuje && !skanyCzekaja ? 1 : .4 }}>
          Zakończ dzień
        </button>
        <button type="button" onClick={() => { if (!skanyCzekajaTeraz()) logout() }}
          disabled={skanyCzekaja}
          className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
          style={{ border: '1px solid var(--line)', color: 'var(--mut)', borderRadius: 8, background: 'var(--panel)',
                   opacity: skanyCzekaja ? .4 : 1 }}>
          Wyloguj
        </button>
      </header>

      <div data-testid="hmi-produkcja-glowny" className="phmi-main flex-1 min-h-0 overflow-hidden flex flex-col">
        <PasekSkanera wstrzymany={powodWstrzymania} stan={kolejka.stan} alarm={alarmKolejki}
          lpOstatniego={ostatniaLiniaSkanu ? lpPozycji(ostatniaLiniaSkanu) : 0}
          pole={poleSkanu} handlers={pole} onPrzeczytane={kolejka.wyczyscBledy} />

        {/* Plan i panel ZAWSZE razem: lista nie znika po wybraniu pozycji.
            Skan zaznacza swoją pozycję osobnym znacznikiem, nie `selectedId`. */}
        <div className="phmi-split flex-1 min-h-0 flex overflow-hidden">
          <PlanList lines={linie} selectedId={wybranaPozycja} onPick={wybierzPozycje}
            onDetails={otworzSzczegoly} scans={skany} lastScannedId={ostatniaLiniaSkanu} />
          <aside className="phmi-side flex-shrink-0 min-h-0" aria-label="Liczenie sztuk wybranej pozycji">
            {pozycja ? (
              <LineCounter
                key={pozycja.id}
                line={pozycja}
                lp={lpPozycji(pozycja.id)}
                workers={operatorzy}
                selectedWorkerId={pracownik}
                onSelectWorker={setPracownik}
                onSave={zapisz}
                canSave={canSave(przerwy)}
                busy={zapisuje || skanyCzekaja}
                onMoveFrom={workerId => {
                  if (!zapisWToku.current && !skanyCzekajaTeraz()) setPrzepisywany({ lineId: pozycja.id, workerId })
                }}
                scan={skany[pozycja.id]}
                onDetails={otworzSzczegoly}
                detailsDisabled={skanyCzekaja}
                feedback={wynikZapisu}
              />
            ) : (
              <LineCounterEmpty hasLines={linie.length > 0} />
            )}
          </aside>
        </div>
      </div>

      {/* Pasek dnia — ten sam wzorzec co w rozbiorze: 76 px, --barBg, kafle
          z liczbą i podpisem, część klikalna (▸). Liczby dnia mają stać cały
          czas na oku, a nie chować się w oknach. */}
      <div className="phmi-bar phmi-dzien flex-shrink-0 grid grid-cols-8" style={{ background: 'var(--barBg)', borderTop: '1px solid var(--line)' }}>
        {([
          { label: 'Zrobione',   val: `${totals.kgDone} kg` },
          { label: 'Postęp',     val: `${totals.pct}%`, color: 'var(--accent)' },
          { label: 'Tempo',      val: `${stats.total.kgPerHour} kg/h` },
          { label: 'Sztuki',     val: `${totals.sztDone} / ${totals.sztPlan}` },
          { label: 'Foliowanie', val: `${zafoliowane} kg`, testId: 'kafel-foliowanie',
            onTap: () => otworzOkno(() => setFoliowanieOtwarte(true)) },
          // Sam licznik — skan idzie z głównego ekranu (pasek skanera), bez
          // wyboru pozycji. Suma z potwierdzonych liczników pozycji.
          { label: 'Zeskanowane', val: `${zeskanowaneRazem} / ${totals.sztPlan}`, testId: 'kafel-skanowanie' },
          // Godzina, nie procent: kierownik podejmuje po niej decyzje (drugi
          // kurs auta, nadgodziny). Kreska, gdy prognoza byłaby zgadywaniem.
          { label: 'Koniec ok.', testId: 'kafel-prognoza',
            val: prognoza.kind === 'eta' ? prognoza.hhmm
               : prognoza.kind === 'ready' ? 'Zrobione' : '—',
            onTap: () => otworzOkno(() => setPrognozaOtwarta(true)) },
        ] as { label: string; val: string; color?: string; testId?: string; onTap?: () => void }[]).map(c => c.onTap ? (
          <button key={c.label} type="button" onClick={c.onTap} data-testid={c.testId} disabled={skanyCzekaja}
            className="flex flex-col items-center justify-center px-1 text-center active:scale-95 transition-transform"
            style={{ borderRight: '1px solid var(--lineSoft)', opacity: skanyCzekaja ? .4 : 1 }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none">{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--accent)' }}>{c.label} ▸</span>
          </button>
        ) : (
          <div key={c.label} data-testid={c.testId} className="flex flex-col items-center justify-center px-1 text-center"
            style={{ borderRight: '1px solid var(--lineSoft)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none" style={{ color: c.color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--mut)' }}>{c.label}</span>
          </div>
        ))}
        <button type="button" onClick={() => otworzOkno(() => setStatystykiOtwarte(true))} disabled={skanyCzekaja}
          className="flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-transform"
          style={{ color: 'var(--accent)', opacity: skanyCzekaja ? .4 : 1 }}>
          <span className="text-xl leading-none">▤</span>
          <span className="text-[10px] font-bold uppercase">Statystyki</span>
        </button>
      </div>

      {wPrzerwie && (
        <BreakOverlay startedAt={trwajacaOd} now={teraz}
          onEnd={zakonczPrzerwe} />
      )}

      {foliowanieOtwarte && (
        <WrappingModal workers={foliowczycy as any} saved={foliowanie} kgToday={totals.kgDone}
          material={folia} onTakeMaterial={pobierzFolie}
          busy={zajety} onSave={zapiszFoliowanie} onClose={() => setFoliowanieOtwarte(false)} />
      )}

      {liniaSzczegolow && (
        <LineDetails line={liniaSzczegolow} lp={lpPozycji(liniaSzczegolow.id)} scan={skany[liniaSzczegolow.id]}
          locked={zapisuje || zajety || wPrzerwie || skanyCzekaja}
          onClose={() => setSzczegoly(null)}
          onChangePackaging={id => {
            if (zapisWToku.current || skanyCzekajaTeraz()) return
            setSzczegoly(null); setTulejaPozycji(id)
          }}
          onMoveFrom={workerId => {
            if (zapisWToku.current || skanyCzekajaTeraz()) return
            setSzczegoly(null); setPrzepisywany({ lineId: liniaSzczegolow.id, workerId })
          }} />
      )}

      {liniaPrzepisania && przepisywany && (
        <MovePiecesModal
          line={liniaPrzepisania}
          fromWorkerId={przepisywany.workerId}
          workers={operatorzy}
          busy={zajety}
          onMove={przeniesSztuki}
          onClose={() => setPrzepisywany(null)}
        />
      )}

      {pozycjaTulei && (
        <PackagingPicker
          line={pozycjaTulei}
          packagingId={pozycjaTulei.packagingId ?? ''}
          packaging={pkgData.data ?? []}
          used={pozycjaTulei.packagingUsed ?? 0}
          busy={zajety}
          onPick={zmienTuleje}
          onClose={() => setTulejaPozycji(null)}
        />
      )}

      {prognozaOtwarta && (
        <ForecastPanel forecast={prognoza} crew={uklada} onClose={() => setPrognozaOtwarta(false)} />
      )}

      {statystykiOtwarte && (
        <ShiftStats stats={stats} date={dzienPoPolsku(dzien)} onClose={() => setStatystykiOtwarte(false)}
          lines={[
            `Start 06:00 · czas pracy ${czasHM(stats.total.workedMs)}`,
            przerwyMs > 0 ? `Przerwy: ${czasHM(przerwyMs)}` : 'Bez przerw',
            `Tuleje zużyte: ${tulejeZuzyte} szt.`,
          ]} />
      )}

      {podsumowanie && (
        <DaySummary date={dzienPoPolsku(dzien)} totals={totals} stats={stats} material={folia}
          pausedMs={przerwyMs} busy={zajety || zapisuje}
          onFinish={zakonczDzien} onClose={() => setPodsumowanie(false)} />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-5 py-3 text-[15px] font-bold z-[60]"
          style={{ borderRadius: 10, background: 'var(--panel)', border: '1px solid var(--line)',
                   boxShadow: '0 8px 24px -8px rgba(0,0,0,.15)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
