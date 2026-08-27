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
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Spinner } from '@/components/ui/widgets'
import { useApi } from '@/hooks/useApi'
import { useLiveRefresh } from '@/hooks/useLiveRefresh'
import { useAuth } from '@/features/auth/AuthContext'
import { dayMaterialsApi, finishedUnitsApi, packagingApi, productionPlansApi, usersApi, wrappingApi } from '@/lib/api'
import { getProductionDate } from '@/features/deboning/utils'
import { HMI_VARS, HMI_FONT } from '@/features/hmi-theme/vars'
import '@/features/hmi-theme/hmi-font.css'
import { planDiff, snapshotPlanu, type PlanChange, type PlanSnapshotLine } from '@/features/production-hmi/planDiff'
import { planTotals } from '@/features/production-hmi/planProgress'
import { removablePieces, type ScanMap } from '@/features/production-hmi/scanProgress'
import { shiftStats, type ShiftEntry } from '@/features/production-hmi/shiftStats'
import {
  BRAK_PRZERW, breakEnded, breakStarted, canSave, onBreak, pausedMs, type BreakState,
} from '@/features/production-hmi/breakState'
import { PlanList, type PlanLineView } from '@/features/production-hmi/components/PlanList'
import { LineCounter } from '@/features/production-hmi/components/LineCounter'
import { PlanChangedBanner } from '@/features/production-hmi/components/PlanChangedBanner'
import { BreakOverlay } from '@/features/production-hmi/components/BreakOverlay'
import { ShiftStats } from '@/features/production-hmi/components/ShiftStats'
import { DaySummary } from '@/features/production-hmi/components/DaySummary'
import { WrappingModal } from '@/features/production-hmi/components/WrappingModal'
import { PackagingPicker } from '@/features/production-hmi/components/PackagingPicker'
import { MovePiecesModal } from '@/features/production-hmi/components/MovePiecesModal'
import { ScanPanel } from '@/features/production-hmi/components/ScanPanel'
import { wrappedTotal } from '@/features/production-hmi/wrapping'
import { productionCrew, wrappingCrew } from '@/features/production-hmi/crew'

declare const __PRODUKCJA_VERSION__: string

const DZIAL = 'produkcja'
/** Kartoteka folii w opakowaniach — rozpoznajemy ją po nazwie, jak reszta MES. */
const FOLIA = 'folia'

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

export function ProductionHmiPage({ buildLabel = `Produkcja · ${__PRODUKCJA_VERSION__}` }: { buildLabel?: string }) {
  const { user, logout } = useAuth()
  const [dzien] = useState(() => getProductionDate())

  const planData = useApi(() => productionPlansApi.list())
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
  const [przepisywany, setPrzepisywany] = useState<string | null>(null)
  /** `null` — panel skanowania zamknięty; `''` — otwarty na wyborze pozycji;
   *  id — otwarty od razu na tej pozycji (wejście z licznika). */
  const [skanowanie, setSkanowanie] = useState<string | null>(null)
  const [pracownik, setPracownik] = useState('')
  const [przerwy, setPrzerwy] = useState<BreakState>(BRAK_PRZERW)
  const [statystykiOtwarte, setStatystykiOtwarte] = useState(false)
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
  const scanData = useApi(
    () => (plan?.id ? finishedUnitsApi.planScanProgress(plan.id) : Promise.resolve([])),
    [plan?.id],
  )
  const skany: ScanMap = useMemo(() => {
    const out: ScanMap = {}
    for (const s of scanData.data ?? []) out[s.planLineId] = { total: s.total, scanned: s.scanned }
    return out
  }, [scanData.data])
  const zeskanowaneRazem = useMemo(
    () => (scanData.data ?? []).reduce((a, s) => a + s.scanned, 0),
    [scanData.data],
  )

  // Jeden rejestr źródeł — dopisanie kolejnego nie wymaga pamiętania o drugim
  // miejscu (patrz incydent zamrożonego licznika na rozbiorze). Stoi TU,
  // a nie przy deklaracjach źródeł, bo `scanData` zależy od wyliczonego planu.
  useLiveRefresh({ planData, opsData, matData, wrapData, pkgData, scanData })

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

  const folia = useMemo(
    () => (matData.data ?? []).find(m => m.name.toLowerCase().includes(FOLIA)) ?? null,
    [matData.data],
  )
  const foliaId = useMemo(() => folia?.packagingId ?? '', [folia])

  const operatorzy = useMemo(() => productionCrew(opsData.data as any), [opsData.data])
  const foliowczycy = useMemo(() => wrappingCrew(opsData.data as any), [opsData.data])
  const pozycja = linie.find(l => l.id === wybranaPozycja) ?? null
  const pozycjaTulei = linie.find(l => l.id === tulejaPozycji) ?? null

  const foliowanie = wrapData.data ?? []
  const zafoliowane = useMemo(() => wrappedTotal(foliowanie), [foliowanie])
  // Tuleja idzie jedna na sztukę — zużycie dnia to po prostu zrobione sztuki.
  const tulejeZuzyte = totals.sztDone

  const pokazToast = (t: string) => { setToast(t); setTimeout(() => setToast(''), 3000) }

  // ── Zapis sztuk (w obie strony) ──
  //
  // Dodatnie `sztuk` dopisuje pracę, ujemne ją zdejmuje. Odejmowanie zawsze
  // schodzi WYBRANEJ osobie — sztuki idą do wypłaty, więc nie wolno ich
  // zabierać „z pozycji" komukolwiek. Serwer trzyma próg skanu (zeskanowanej
  // sztuki nie da się odjąć, bo leży już na magazynie wyrobu gotowego);
  // LineCounter gasi przycisk wcześniej, ale to tylko uprzejmość dla operatora.
  const zapisz = useCallback(async (sztuk: number) => {
    if (!plan || !pozycja || sztuk === 0) return
    // Strażnik autorytatywny. Operator i tak nie kliknie — LineCounter gasi
    // przycisk — więc ta linia jest nieosiągalna z DOM-u i świadomie nieobjęta
    // testem; trzyma zapis, gdyby kiedyś pojawiła się druga droga wywołania.
    if (!canSave(przerwy)) return
    const kto = operatorzy.find(o => o.id === pracownik) ?? operatorzy[0]
    if (!kto) { pokazToast('Wybierz, kto liczy'); return }

    const dotad = pozycja.workerEntries ?? []
    const maja = dotad.filter(e => e.workerId === kto.id).reduce((a, e) => a + (e.pieces ?? 0), 0)
    // Ile realnie schodzi: nie więcej, niż osoba ma na pozycji i nie poniżej
    // progu skanu. Bez tego zapis poleciałby na serwer po 409.
    const zmiana = sztuk < 0
      ? -Math.min(-sztuk, maja, removablePieces(pozycja, skany))
      : sztuk
    if (zmiana === 0) { pokazToast('Tych sztuk nie da się już odjąć'); return }

    const idx = dotad.findIndex(e => e.workerId === kto.id)
    const wpisy = (idx >= 0
      ? dotad.map((e, i) => (i === idx ? { ...e, pieces: e.pieces + zmiana } : e))
      : [...dotad, { workerId: kto.id, workerName: kto.name, pieces: zmiana,
                     addedAt: new Date().toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' }) }]
    // Wpis na zero to nie wpis — zostawiony straszyłby w statystykach zmiany
    // jako osoba z zerem sztuk (tak samo jak przy przepisywaniu na serwerze).
    ).filter(e => (e.pieces ?? 0) > 0)
    const zrobione = Math.max(0, Math.min(pozycja.qty, pozycja.qtyDone + zmiana))
    const stan = zrobione >= pozycja.qty ? 'DONE' : zrobione > 0 ? 'IN_PROGRESS' : 'PLANNED'

    try {
      await productionPlansApi.updateLineProgress(plan.id, pozycja.id,
        { qtyDone: zrobione, lineStatus: stan as any, workerEntries: wpisy })
      planData.refetch()
      if (zmiana < 0) {
        pokazToast(`Odjęto ${-zmiana} szt. · ${kto.name.split(' ')[0]}`)
      } else if (zrobione >= pozycja.qty) {
        // Zamknięta pozycja wraca na listę, ale NIE jest zamknięta na klucz —
        // wchodzi się w nią z powrotem i poprawia, dopóki nic nie zeskanowane.
        setWybranaPozycja(null); pokazToast('Pozycja gotowa — zeskanuj sztuki, żeby ją potwierdzić')
      }
    } catch (e: any) {
      pokazToast(e?.message || 'Nie udało się zapisać — spróbuj jeszcze raz')
    }
  }, [plan, pozycja, przerwy, operatorzy, pracownik, planData, skany])

  // ── Skanowanie gotowych kebabów ──
  //
  // Skan księguje sztukę na magazynie wyrobu gotowego po stronie backendu;
  // tu odświeżamy plan, żeby postęp pozycji nadążał za wózkiem.
  const zeskanuj = useCallback(async (code: string, lineId: string) => {
    const wynik = await finishedUnitsApi.scanProduced(code, undefined, lineId)
    planData.refetch()
    scanData.refetch()
    return wynik
  }, [planData, scanData])

  // ── Poprawka „nie ta osoba" ──
  //
  // Sztuki są zrobione i tuleje zeszły — przenosimy wyłącznie przypisanie
  // pracy, bo to ono idzie do wypłaty. Działa też na pozycji gotowej: pomyłka
  // wychodzi zwykle dopiero, gdy pozycja jest zamknięta.
  const przeniesSztuki = useCallback(async (
    ruch: { toWorkerId: string; toWorkerName: string; pieces: number },
  ) => {
    if (!plan || !pozycja || !przepisywany) return
    setZajety(true)
    try {
      await productionPlansApi.moveLinePieces(plan.id, pozycja.id, {
        fromWorkerId: przepisywany, toWorkerId: ruch.toWorkerId,
        toWorkerName: ruch.toWorkerName, pieces: ruch.pieces, by: user?.name ?? '',
      })
      setPrzepisywany(null)
      planData.refetch()
      pokazToast(`Przepisano ${ruch.pieces} szt. na ${ruch.toWorkerName.split(' ')[0]}`)
    } catch (e: any) {
      setPrzepisywany(null)
      pokazToast(e?.message ? `Nie udało się przenieść — ${e.message}` : 'Nie udało się przenieść sztuk')
    } finally {
      setZajety(false)
    }
  }, [plan, pozycja, przepisywany, user, planData])

  // ── Zmiana tulei pozycji ──
  //
  // Metalowe potrafią skończyć się w połowie dnia. Zamykamy okno DOPIERO po
  // udanym zapisie: gdyby zamykało się od razu, operator nie wiedziałby, czy
  // zmiana weszła, i klikałby drugi raz (a każde kliknięcie przerzuca tuleje
  // na magazynie).
  const zmienTuleje = useCallback(async (packagingId: string) => {
    const linia = linie.find(l => l.id === tulejaPozycji)
    if (!plan || !linia) return
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
      setZajety(false)
    }
  }, [plan, linie, tulejaPozycji, planData, pkgData])

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
  const zakonczDzien = useCallback(async (zwrot: number) => {
    if (!plan) return
    setZajety(true)
    try {
      if (zwrot > 0 && foliaId) {
        await dayMaterialsApi.giveBack(dzien, foliaId, zwrot, user?.name ?? '')
      }
      const entries = (plan.lines ?? [])
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
      await productionPlansApi.tabletFinish(plan.id, entries)
      setPodsumowanie(false)
      planData.refetch(); matData.refetch()
      pokazToast('Wysłano do potwierdzenia biura')
    } catch (e: any) {
      pokazToast(e?.message || 'Nie udało się zamknąć dnia')
    } finally {
      setZajety(false)
    }
  }, [plan, foliaId, dzien, user, planData, matData])

  if (planData.loading && !planData.data) {
    return (
      <div className="h-full w-full flex items-center justify-center" style={{ ...HMI_VARS, background: 'var(--bg)' }}>
        <Spinner size={48} />
      </div>
    )
  }

  const wPrzerwie = onBreak(przerwy)
  const trwajacaOd = przerwy.pauses.find(p => p.to === null)?.from ?? teraz
  const przerwyMs = pausedMs(przerwy, teraz)

  return (
    <div className="h-full w-full overflow-hidden flex flex-col"
      style={{ ...HMI_VARS, background: 'var(--bg)', color: 'var(--ink)', fontFamily: HMI_FONT }}>

      <header className="flex-shrink-0 flex items-center gap-5 px-6"
        style={{ height: 76, background: 'var(--barBg)', borderBottom: '1px solid var(--line)' }}>
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
        <div className="flex-1" />
        <button type="button" onClick={() => setPrzerwy(s => breakStarted(s, new Date().toISOString()))}
          disabled={wPrzerwie} className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
          style={{ border: '1px solid var(--ambLine)', color: 'var(--amb)', borderRadius: 8,
                   background: 'var(--ambSoft)', opacity: wPrzerwie ? .4 : 1 }}>
          Przerwa
        </button>
        <button type="button" onClick={() => setPodsumowanie(true)} disabled={!plan}
          className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
          style={{ border: '1px solid var(--line)', color: 'var(--ink)', borderRadius: 8, background: 'var(--panel)', opacity: plan ? 1 : .4 }}>
          Zakończ dzień
        </button>
        <button type="button" onClick={() => logout()}
          className="h-9 px-4 text-[13px] font-bold flex-shrink-0"
          style={{ border: '1px solid var(--line)', color: 'var(--mut)', borderRadius: 8, background: 'var(--panel)' }}>
          Wyloguj
        </button>
      </header>

      <div className="flex-1 overflow-hidden flex flex-col gap-3.5 p-4.5" style={{ padding: 18 }}>
        <PlanChangedBanner changes={zmiany} onAck={potwierdzZmiany} />

        {plan?.tabletFinishedAt && !plan?.officeConfirmedAt && (
          <div className="text-[15px] font-bold" style={{
            background: 'var(--successSoft)', border: '1px solid var(--successLine)',
            borderRadius: 12, padding: '12px 16px', color: 'var(--success)',
          }}>
            Dzień wysłany do biura — czeka na potwierdzenie.
          </div>
        )}

        <div className="flex-1 flex gap-3.5 overflow-hidden" style={{ gap: 14 }}>
          {pozycja ? (
            <LineCounter
              line={pozycja}
              workers={operatorzy}
              selectedWorkerId={pracownik || operatorzy[0]?.id || ''}
              onSelectWorker={setPracownik}
              onSave={zapisz}
              onBack={() => setWybranaPozycja(null)}
              canSave={canSave(przerwy)}
              onMoveFrom={setPrzepisywany}
              scan={skany[pozycja.id]}
              onScanLine={setSkanowanie}
            />
          ) : (
            <PlanList lines={linie} onPick={setWybranaPozycja} onPickPackaging={setTulejaPozycji}
              scans={skany} />
          )}
        </div>
      </div>

      {/* Pasek dnia — ten sam wzorzec co w rozbiorze: 76 px, --barBg, kafle
          z liczbą i podpisem, część klikalna (▸). Liczby dnia mają stać cały
          czas na oku, a nie chować się w oknach. */}
      <div className="flex-shrink-0 grid grid-cols-7" style={{ height: 76, background: 'var(--barBg)', borderTop: '1px solid var(--line)' }}>
        {([
          { label: 'Zrobione',   val: `${totals.kgDone} kg` },
          { label: 'Postęp',     val: `${totals.pct}%`, color: 'var(--accent)' },
          { label: 'Tempo',      val: `${stats.total.kgPerHour} kg/h` },
          { label: 'Sztuki',     val: `${totals.sztDone} / ${totals.sztPlan}` },
          { label: 'Foliowanie', val: `${zafoliowane} kg`, onTap: () => setFoliowanieOtwarte(true) },
          { label: 'Skanowanie', val: `${zeskanowaneRazem} / ${totals.sztPlan}`, onTap: () => setSkanowanie('') },
        ] as { label: string; val: string; color?: string; onTap?: () => void }[]).map(c => c.onTap ? (
          <button key={c.label} type="button" onClick={c.onTap}
            className="flex flex-col items-center justify-center px-1 text-center active:scale-95 transition-transform"
            style={{ borderRight: '1px solid var(--lineSoft)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none">{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--accent)' }}>{c.label} ▸</span>
          </button>
        ) : (
          <div key={c.label} className="flex flex-col items-center justify-center px-1 text-center"
            style={{ borderRight: '1px solid var(--lineSoft)' }}>
            <span className="hmi-v10-mono text-xl font-bold leading-none" style={{ color: c.color ?? 'var(--ink)' }}>{c.val}</span>
            <span className="text-[10px] font-bold uppercase mt-1.5 leading-tight" style={{ color: 'var(--mut)' }}>{c.label}</span>
          </div>
        ))}
        <button type="button" onClick={() => setStatystykiOtwarte(true)}
          className="flex flex-col items-center justify-center gap-1.5 active:scale-95 transition-transform"
          style={{ color: 'var(--accent)' }}>
          <span className="text-xl leading-none">▤</span>
          <span className="text-[10px] font-bold uppercase">Statystyki</span>
        </button>
      </div>

      {wPrzerwie && (
        <BreakOverlay startedAt={trwajacaOd} now={teraz}
          onEnd={() => setPrzerwy(s => breakEnded(s, new Date().toISOString()))} />
      )}

      {foliowanieOtwarte && (
        <WrappingModal workers={foliowczycy as any} saved={foliowanie} kgToday={totals.kgDone}
          material={folia} onTakeMaterial={pobierzFolie}
          busy={zajety} onSave={zapiszFoliowanie} onClose={() => setFoliowanieOtwarte(false)} />
      )}

      {skanowanie !== null && (
        <ScanPanel lines={linie} scans={skany} initialLineId={skanowanie}
          onScan={zeskanuj} onClose={() => setSkanowanie(null)} />
      )}

      {pozycja && przepisywany && (
        <MovePiecesModal
          line={pozycja}
          fromWorkerId={przepisywany}
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
          pausedMs={przerwyMs} busy={zajety}
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
