import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, ChevronLeft, ChevronRight, ClipboardList, FileText, TrendingDown, ListChecks, PanelBottom, PanelRight, Plus, RefreshCw, Save, Search, Send, ShoppingCart, Boxes, Tags, Wand2, X } from 'lucide-react'
import { useApp, CommandBar, type Cmd } from '../../shell/context'
import { useDock } from '../../shell/useDock'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { Wybor, type WyborItem } from '../../ui/Wybor'
import { useApi } from '@/hooks/useApi'
import { clientOrdersApi, finishedUnitsApi, packagingApi, productionPlansApi, productTypesApi, recipesApi, seasonedPalletsApi, type PlanSummary } from '@/lib/api'
import { lineComponents } from '@/features/production-plan/planComponents'
import { pullableLines, type OrderLite, type ProgressByLine } from '@/features/production-plan/pullFromOrders'
import { dataPl, dzisIso, nazwaDnia, przesunDzien } from '../plan-masowania/model'
import { PanelPalet } from './PanelPalet'
import { OknoEtykiet } from './OknoEtykiet'
import { KartaProdukcjiDialog, type PlanKarty } from './KartaProdukcji'
import { BilansPlanu, StratyOkno } from './Bilans'
import {
  ETYKIETA_STANU, bledyPozycji, doDto, grupujZamowienia, podpowiedzPalet, prognozaKoncowki, stanPlanu, sumaKoncowek, sztukZPalety,
  type Paleta, type Pozycja, type Skladnik,
} from './model'

/** Ile palet widać w wierszu — reszta jako „+N” z podpowiedzią, żeby wiersz się nie zawijał. */
const MAX_CHIPOW = 2
const fmt = (n: number) => new Intl.NumberFormat('pl-PL', { maximumFractionDigits: 1 }).format(n)
const liczba = (s: string) => { const v = parseFloat(s.replace(',', '.')); return Number.isFinite(v) ? v : 0 }
let licznik = 0
const nowyKlucz = () => `n${Date.now().toString(36)}${(licznik++).toString(36)}`

interface PlanSerwera {
  id: string; planNo: string; planDate: string; status: string; summary: PlanSummary | null
  lines: Array<Record<string, any> & { pallets: Paleta[] }>
}

type Zakladka = 'palety' | 'zamowienia' | 'plany' | 'bilans'
type Wyrzuc = Array<{ qrSeq: number; linePosition: number; batchNo: string }>
type Okno = { rodzaj: 'etykiety'; przedruk?: string[]; wyrzuc?: Wyrzuc } | { rodzaj: 'karta' } | { rodzaj: 'straty' } | null

function zPlanu(plan: PlanSerwera | null): Pozycja[] {
  return (plan?.lines ?? []).map(l => {
    const klucze = Object.keys(l.batchAllocation ?? {})
    const palety = (l.pallets ?? []) as Paleta[]
    return {
      klucz: l.id, id: l.id, qty: Number(l.qty) || 0, kgPerUnit: Number(l.kgPerUnit) || 0, recipeId: l.recipeId ?? '',
      productTypeId: l.productTypeId ?? '', packagingId: l.packagingId ?? undefined, klient: l.clientName ?? undefined,
      zamowienieId: l.clientOrderId ?? undefined, zamowienieNo: l.clientOrderNo ?? undefined, zamowienieLiniaId: l.clientOrderLineId ?? undefined,
      palety: palety.map(p => p.id),
      zamrozona: Number(l.qtyDone) > 0,
      zKoncowek: palety.length > 1 && palety.every(p => p.isRemainder) && klucze.some(k => k === '__MIXED__' || /^PM\d+$/.test(k)),
    }
  })
}

const odcisk = (w: Pozycja[]) => JSON.stringify(w.map(({ klucz: _k, ...r }) => r))

/** Kg palet zajęte przez INNE pozycje planu — po kolei, jak pobiera hala. */
function zajeteKg(pozycje: Pozycja[], pominKlucz: string, palety: Map<string, Paleta>, sklad: (p: Pozycja) => Skladnik[]): Map<string, number> {
  const zaj = new Map<string, number>()
  for (const poz of pozycje) {
    if (poz.klucz === pominKlucz) continue
    const grupy: Array<Skladnik | undefined> = sklad(poz).length ? sklad(poz) : [undefined]
    for (const s of grupy) {
      let potrzeba = poz.qty * poz.kgPerUnit * (s ? s.pct / 100 : 1)
      for (const id of poz.palety) {
        const p = palety.get(id)
        if (!p || (s && (p.materialTypeId ?? '') !== s.materialTypeId) || potrzeba <= 0) continue
        const wolne = p.kgWeighed - (zaj.get(id) ?? 0)
        const bierze = Math.max(0, Math.min(wolne, potrzeba))
        zaj.set(id, (zaj.get(id) ?? 0) + bierze)
        potrzeba -= bierze
      }
    }
  }
  return zaj
}

/**
 * Plan produkcji w PROTRIMA (spec 2026-11-26-plan-produkcji-partie-design.md).
 * Biuro wieczorem układa dzień z KONKRETNYCH palet z chłodni: pozycje z
 * zamówień (z odliczeniem zrobionego) albo z klawiatury, do każdej palety
 * (podpowiedź: końcówki, potem leżące najdłużej), kebab mix — palety każdego
 * składnika, pozycja z końcówek — sztuki PM. Plan z PROTRIMA ma zawsze
 * blokadę palet: hala bierze tylko palety z planu.
 */
export function PlanProdukcjiModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const dzis = dzisIso()
  const [dzien, setDzien] = useState(przesunDzien(dzis, 1))
  const [plany, setPlany] = useState<PlanSerwera[]>([])
  const [planId, setPlanId] = useState<string | null>(null)
  const [palety, setPalety] = useState<Paleta[]>([])
  const [pozycje, setPozycje] = useState<Pozycja[]>([])
  const [zapisany, setZapisany] = useState('[]')
  const [sel, setSel] = useState<string | null>(null)
  const [zakladka, setZakladka] = useState<Zakladka>('palety')
  const [wczytano, setWczytano] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [bladZapisu, setBladZapisu] = useState<string | null>(null)
  const [pokazBledy, setPokazBledy] = useState(false)
  const [zapisuje, setZapisuje] = useState(false)
  const [postep, setPostep] = useState<ProgressByLine>({})
  const [okno, setOkno] = useState<Okno>(null)
  const [wysyla, setWysyla] = useState(false)
  const [szukajZam, setSzukajZam] = useState('')
  const workRef = useRef<HTMLDivElement>(null)
  const dock = useDock(workRef, 'plan-produkcji', { bok: 0.3, dol: 0.42 })

  const recepturyRes = useApi(() => recipesApi.list())
  const rodzajeRes = useApi(() => productTypesApi.list())
  const tulejeRes = useApi(() => packagingApi.list())
  const zamowieniaRes = useApi(() => clientOrdersApi.list('confirmed'))
  const receptury = (recepturyRes.data ?? []) as Array<{ id: string; name: string; components?: unknown }>
  const rodzaje = (rodzajeRes.data ?? []) as Array<{ id: string; name: string; components?: unknown }>
  const tuleje = (tulejeRes.data ?? []) as Array<{ id: string; name: string }>
  const zamowienia = (zamowieniaRes.data ?? []) as unknown as OrderLite[]

  const dzienRef = useRef(dzien); dzienRef.current = dzien
  const zmieniony = odcisk(pozycje) !== zapisany

  const wczytaj = useCallback(async (d: string, wybierz?: string | null): Promise<PlanSerwera | null> => {
    try {
      const [ps, pal] = await Promise.all([productionPlansApi.list(), seasonedPalletsApi.list('in_cold')])
      if (dzienRef.current !== d) return
      const lista = ps as unknown as PlanSerwera[]
      setPlany(lista)
      const dnia = lista.filter(p => p.planDate?.slice(0, 10) === d && p.status !== 'cancelled')
      const plan = dnia.find(p => p.id === wybierz) ?? dnia[0] ?? null
      setPlanId(plan?.id ?? null)
      const w = zPlanu(plan)
      setPozycje(w); setZapisany(odcisk(w))
      // Palety pozycji, które już wyjechały na halę, nie są „w chłodni” — dokładamy je z planu.
      const zPlanuPal = (plan?.lines ?? []).flatMap(l => l.pallets ?? [])
      const mapa = new Map<string, Paleta>((pal as Paleta[]).map(p => [p.id, p]))
      zPlanuPal.forEach(p => { if (!mapa.has(p.id)) mapa.set(p.id, p) })
      setPalety([...mapa.values()])
      setBlad(null)
      return plan
    } catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się pobrać planu'); return null } finally { setWczytano(true) }
  }, [])
  useEffect(() => { setWczytano(false); setSel(null); setPokazBledy(false); setBladZapisu(null); void wczytaj(dzien) }, [dzien, wczytaj])

  const plan = plany.find(p => p.id === planId) ?? null
  const tylkoPodglad = !!plan && plan.status !== 'draft' && plan.status !== 'active'
  const mapaPalet = useMemo(() => new Map(palety.map(p => [p.id, p])), [palety])
  const katalog = useMemo(() => ({ productTypes: rodzaje, recipes: receptury }), [rodzaje, receptury])
  const sklad = useCallback((p: Pozycja): Skladnik[] => lineComponents({ productTypeId: p.productTypeId, recipeId: p.recipeId }, katalog)
    .map(c => ({ materialTypeId: c.materialTypeId, nazwa: (c.materialName || c.materialTypeId).toUpperCase(), pct: c.pct })), [katalog])
  const wybrana = pozycje.find(p => p.klucz === sel) ?? null
  const nazwyPlanow = useMemo(() => new Map(plany.map(p => [p.id, p.planNo])), [plany])
  const recItems = useMemo<WyborItem[]>(() => receptury.map(r => ({ id: r.id, label: r.name })).sort((a, b) => a.label.localeCompare(b.label, 'pl')), [receptury])
  const ptItems = useMemo<WyborItem[]>(() => rodzaje.map(r => ({ id: r.id, label: r.name })), [rodzaje])
  const tulItems = useMemo<WyborItem[]>(() => tuleje.map(t => ({ id: t.id, label: t.name })), [tuleje])
  const nazwaRec = (id: string) => receptury.find(r => r.id === id)?.name ?? ''
  const bledy = useMemo(() => new Map(pozycje.map(p => [p.klucz, bledyPozycji(p, sklad(p), mapaPalet, planId)])), [pozycje, sklad, mapaPalet, planId])
  const pierwszyBlad = pozycje.find(p => (bledy.get(p.klucz) ?? []).length)
  const razem = useMemo(() => ({ szt: pozycje.reduce((a, p) => a + p.qty, 0), kg: pozycje.reduce((a, p) => a + p.qty * p.kgPerUnit, 0) }), [pozycje])

  const ustaw = (klucz: string, zm: Partial<Pozycja>) => { setPozycje(s => s.map(p => p.klucz === klucz ? { ...p, ...zm } : p)); setBladZapisu(null) }
  const dodajPusta = useCallback(() => {
    if (tylkoPodglad) return
    const klucz = nowyKlucz()
    setPozycje(s => [...s, { klucz, qty: 0, kgPerUnit: 0, recipeId: '', productTypeId: '', palety: [], zKoncowek: false }])
    setSel(klucz)
  }, [tylkoPodglad])
  const przelacz = (paletaId: string) => {
    if (!wybrana) return
    ustaw(wybrana.klucz, { palety: wybrana.palety.includes(paletaId) ? wybrana.palety.filter(x => x !== paletaId) : [...wybrana.palety, paletaId] })
  }
  const podpowiedz = (poz: Pozycja | null) => {
    if (!poz) return
    const ids = podpowiedzPalet(poz, sklad(poz), palety, zajeteKg(pozycje, poz.klucz, mapaPalet, sklad))
    ustaw(poz.klucz, { palety: ids })
    if (!ids.length) app.toast({ kind: 'warn', title: 'Brak palet dla tej pozycji', detail: 'W chłodni nie ma wolnych palet tej receptury' })
  }
  const podpowiedzWszystkie = () => {
    setPozycje(s => {
      let wynik = s
      for (const poz of s) {
        if (poz.palety.length || !poz.recipeId || poz.zKoncowek) continue
        const ids = podpowiedzPalet(poz, sklad(poz), palety, zajeteKg(wynik, poz.klucz, mapaPalet, sklad))
        wynik = wynik.map(x => x.klucz === poz.klucz ? { ...x, palety: ids } : x)
      }
      return wynik
    })
  }
  const zKoncowek = (ids: string[]) => {
    const pierwsza = mapaPalet.get(ids[0])
    const klucz = nowyKlucz()
    setPozycje(s => [...s, { klucz, qty: 0, kgPerUnit: 0, recipeId: pierwsza?.recipeId ?? '', productTypeId: '', palety: ids, zKoncowek: true }])
    setSel(klucz)
    requestAnimationFrame(() => (document.getElementById(`pp-kg-${klucz}`) as HTMLInputElement | null)?.focus())
  }
  const zZamowienia = (...linie: ReturnType<typeof pullableLines>) => {
    const nowe: Pozycja[] = linie.map(l => ({
      klucz: nowyKlucz(), qty: l.qtyRemaining, kgPerUnit: l.kgPerUnit, recipeId: l.recipeId, productTypeId: l.productTypeId, packagingId: l.packagingId || undefined,
      klient: l.clientName, zamowienieId: l.orderId, zamowienieNo: l.orderNo, zamowienieLiniaId: l.lineId, palety: [], zKoncowek: false,
    }))
    if (!nowe.length) return
    setPozycje(s => [...s, ...nowe])
    setSel(nowe[0].klucz)
  }

  // Postęp zamówień (ile już zrobione) — przy otwarciu zakładki, jak w starym edytorze.
  useEffect(() => {
    if (zakladka !== 'zamowienia' || !zamowienia.length) return
    let stop = false
    void (async () => {
      const zebrane: ProgressByLine = {}
      await Promise.all(zamowienia.map(async o => {
        try { const p = await clientOrdersApi.productionProgress(o.id); for (const pl of p.lines ?? []) zebrane[pl.lineId] = { qtyRemaining: pl.qtyRemaining } } catch { /* całość */ }
      }))
      if (!stop) setPostep(zebrane)
    })()
    return () => { stop = true }
  }, [zakladka, zamowienia])
  const doWciagniecia = useMemo(() => {
    const juz = new Set(pozycje.map(p => p.zamowienieLiniaId).filter(Boolean))
    return pullableLines(zamowienia, postep).filter(l => !juz.has(l.lineId))
  }, [zamowienia, postep, pozycje])
  const grupyZam = grupujZamowienia(doWciagniecia, szukajZam, id => receptury.find(r => r.id === id)?.name ?? '')
  const nazwaRodz = (id: string) => rodzaje.find(r => r.id === id)?.name ?? ''

  const zapisz = useCallback(async (): Promise<boolean> => {
    if (zapisuje || tylkoPodglad) return false
    const doZapisu = pozycje.filter(p => p.qty > 0 || p.kgPerUnit > 0 || p.recipeId || p.palety.length)
    if (doZapisu.some(p => (bledy.get(p.klucz) ?? []).length || !p.recipeId || !(p.qty > 0) || !(p.kgPerUnit > 0))) {
      setPokazBledy(true); return false
    }
    setZapisuje(true); setBladZapisu(null)
    try {
      const dto = doDto(doZapisu, dzien)
      const wynik = plan ? await productionPlansApi.update(plan.id, dto) : await productionPlansApi.create(dto)
      await wczytaj(dzien, (wynik as { id?: string })?.id ?? plan?.id)
      setPokazBledy(false)
      // Plan już wysłany: serwer w tej samej transakcji dopasował sztuki i mówi,
      // które etykiety są do przedruku, a które do wyrzucenia.
      const sync = (wynik as { unitsSync?: { reprint?: string[]; invalidated?: Wyrzuc; added?: number } | null })?.unitsSync
      if (sync && ((sync.reprint?.length ?? 0) || (sync.invalidated?.length ?? 0) || (sync.added ?? 0))) {
        setOkno({ rodzaj: 'etykiety', przedruk: sync.reprint ?? [], wyrzuc: sync.invalidated ?? [] })
      }
      app.toast({ kind: 'ok', title: `Plan produkcji na ${nazwaDnia(dzien, dzis)} zapisany`, detail: `${doZapisu.length} poz. · ${fmt(razem.szt)} szt. · ${fmt(razem.kg)} kg` })
      return true
    } catch (e) { setBladZapisu(e instanceof Error ? e.message : 'Nie udało się zapisać planu'); return false } finally { setZapisuje(false) }
  }, [zapisuje, tylkoPodglad, pozycje, bledy, dzien, plan, wczytaj, app, dzis, razem])

  const wyslij = useCallback(async () => {
    if (!plan || plan.status !== 'draft' || zmieniony || wysyla) return
    setWysyla(true); setBladZapisu(null)
    try {
      await productionPlansApi.updateStatus(plan.id, 'active')
      // Sztuki z QR w kolejności pozycji i palet — w tej kolejności drukują się etykiety.
      for (const l of [...plan.lines].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))) await finishedUnitsApi.generateFromPlanLine(l.id)
      await wczytaj(dzien, plan.id)
      app.toast({ kind: 'ok', title: `Plan ${plan.planNo} wysłany do produkcji`, detail: 'mięso zarezerwowane, sztuki gotowe do druku etykiet' })
      setOkno({ rodzaj: 'etykiety' })
    } catch (e) { setBladZapisu(e instanceof Error ? e.message : 'Nie udało się wysłać planu') } finally { setWysyla(false) }
  }, [plan, zmieniony, wysyla, wczytaj, dzien, app])

  const zmienDzien = (cel: string) => {
    if (cel === dzien) return
    if (zmieniony) { app.toast({ kind: 'warn', title: 'Plan ma niezapisane zmiany', detail: 'Zapisz plan (Ctrl+S) albo odśwież, zanim zmienisz dzień' }); return }
    setDzien(cel)
  }

  const cmds = useMemo<Cmd[]>(() => [
    ...(tylkoPodglad ? [] : [
      { id: 'save', group: 1, label: zmieniony ? 'Zapisz plan' : 'Plan zapisany', icon: <Save size={17} />, kbd: 'Ctrl+S', primary: true, disabled: !zmieniony || zapisuje,
        tip: zmieniony ? (pierwszyBlad ? (bledy.get(pierwszyBlad.klucz) ?? [])[0] : undefined) : 'brak zmian do zapisania', run: () => void zapisz(),
        onDisabledClick: () => setPokazBledy(true) },
      { id: 'new', group: 2, label: 'Dodaj pozycję', icon: <Plus size={17} />, kbd: 'Ctrl+N', run: dodajPusta },
      { id: 'podpowiedz', group: 2, label: 'Podpowiedz palety', icon: <Wand2 size={17} />, disabled: !pozycje.some(p => !p.palety.length && p.recipeId),
        tip: 'Dla pozycji bez palet: końcówki, potem palety leżące najdłużej', run: podpowiedzWszystkie },
    ] as Cmd[]),
    { id: 'send', group: 3, label: 'Wyślij do produkcji', icon: <Send size={17} />, disabled: !plan || plan.status !== 'draft' || zmieniony || wysyla,
      tip: !plan ? 'najpierw zapisz plan' : zmieniony ? 'najpierw zapisz zmiany' : plan.status !== 'draft' ? 'plan jest już w produkcji' : 'Rezerwuje mięso i tworzy sztuki z QR — potem druk etykiet', run: () => void wyslij() },
    { id: 'labels', group: 3, label: 'Etykiety sztuk', icon: <Tags size={17} />, disabled: !plan || plan.status === 'draft',
      tip: !plan || plan.status === 'draft' ? 'etykiety drukuje się po wysłaniu planu do produkcji' : undefined, run: () => setOkno({ rodzaj: 'etykiety' }) },
    { id: 'print', group: 3, label: 'Karta dla kierownika', icon: <FileText size={17} />, kbd: 'Ctrl+P', disabled: !plan || zmieniony,
      tip: !plan ? 'najpierw zapisz plan' : zmieniony ? 'najpierw zapisz zmiany — drukuje się zapisany plan' : 'Pozycje z paletami w kolejności i miejscem na wagę końcówek', run: () => setOkno({ rodzaj: 'karta' }) },
    { id: 'straty', group: 4, label: 'Straty mięsa', icon: <TrendingDown size={17} />, tip: 'Straty z bilansu palet za zakres dat — dni i receptury', run: () => setOkno({ rodzaj: 'straty' }) },
    { id: 'reload', group: 4, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: () => void wczytaj(dzien, planId) },
  ], [tylkoPodglad, zmieniony, zapisuje, pierwszyBlad, bledy, zapisz, dodajPusta, pozycje, wczytaj, dzien, planId, plan, wysyla, wyslij]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Plan na <b>{nazwaDnia(dzien, dzis)}</b> · {pozycje.length} poz. · <b>{fmt(razem.szt)} szt.</b> · {fmt(razem.kg)} kg{zmieniony ? <> · <b className="warn-ink">niezapisane zmiany</b></> : null}</span>)
  }, [active, dzien, dzis, pozycje.length, razem, zmieniony, setCtx])
  useEffect(() => {
    if (!active) return
    const key = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void zapisz() } }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, zapisz])

  const stan = plan ? stanPlanu(plan) : null
  const ostatnie = useMemo(() => [...plany].sort((a, b) => (b.planDate ?? '').localeCompare(a.planDate ?? '')).slice(0, 30), [plany])

  return (
    <>
      <CommandBar title="Plan produkcji" count={`${nazwaDnia(dzien, dzis)}, ${dataPl(dzien)}`} cmds={cmds} showKbd={false} />
      <div className="toolbar pm-toolbar" role="toolbar" aria-label="Dzień planu">
        <div className="pm-dni">
          <button className="btn icon ghost" onClick={() => zmienDzien(przesunDzien(dzien, -1))} aria-label="Dzień wcześniej"><ChevronLeft size={17} /></button>
          <input type="date" className="field" value={dzien} onChange={e => e.target.value && zmienDzien(e.target.value)} aria-label="Dzień planu" />
          <button className="btn icon ghost" onClick={() => zmienDzien(przesunDzien(dzien, 1))} aria-label="Dzień później"><ChevronRight size={17} /></button>
        </div>
        <div className="seg" role="group" aria-label="Szybki wybór dnia">
          <button type="button" aria-pressed={dzien === dzis} onClick={() => zmienDzien(dzis)}>Dziś</button>
          <button type="button" aria-pressed={dzien === przesunDzien(dzis, 1)} onClick={() => zmienDzien(przesunDzien(dzis, 1))}>Jutro</button>
        </div>
        {plan ? <span className="tag neutral"><b className="code">{plan.planNo}</b>&nbsp;· {ETYKIETA_STANU[stan!]}</span> : <span className="tag outline">nowy plan</span>}
        <span className="tag outline" data-tip="Hala bierze tylko palety z tego planu — skan przy wywozie z chłodni">kontrola palet</span>
        {zmieniony && <span className="tag warn">niezapisane zmiany</span>}
        <span className="grow" />
        <div className="pm-figi" aria-label="Razem w planie">
          <div><span className="k">Sztuk</span><span className="v">{fmt(razem.szt)}</span></div>
          <div><span className="k">Masa</span><span className="v">{fmt(razem.kg)} kg</span></div>
        </div>
      </div>

      <div className={`workarea pp-work${dock.side ? ' side' : ''}`} ref={workRef}>
        <div className="list-pane pm-lewa" style={dock.listStyle(true, false)}>
          {blad && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie udało się pobrać planu:</b> {blad}</div></div>}
          {bladZapisu && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Plan nie został zapisany:</b> {bladZapisu}</div></div>}
          <div className="tbl-wrap pm-tbl-wrap">
            <table className="tbl pp-tbl" aria-label="Pozycje planu produkcji">
              <colgroup>
                <col style={{ width: 48 }} /><col className="pp-c-klient" /><col className="pp-c-rec" /><col className="pp-c-rodz" />
                <col style={{ width: 80 }} /><col style={{ width: 104 }} /><col className="pp-c-tul" /><col className="pp-c-pal" /><col className="pp-c-z" /><col style={{ width: 40 }} />
              </colgroup>
              <thead><tr>
                <th>Lp.</th><th>Klient</th><th>Receptura</th><th>Rodzaj</th><th className="num">Sztuk</th><th className="num">kg/szt</th>
                <th>Tuleja</th><th>Palety</th><th className="num">Z palet</th><th aria-label="Usuń" />
              </tr></thead>
              <tbody>
                {wczytano && !pozycje.length && <tr><td colSpan={10}><Pusto ikona={<ClipboardList size={20} />} tytul={`Na ${dataPl(dzien)} nie ma jeszcze planu`}>
                  Dodaj pozycje z zamówień (zakładka Zamówienia) albo z klawiatury (Ctrl+N), a potem palety z chłodni.</Pusto></td></tr>}
                {pozycje.map((p, i) => {
                  const e = pokazBledy ? (bledy.get(p.klucz) ?? []) : []
                  const sk = sklad(p)
                  const pal = p.palety.map(id => mapaPalet.get(id)).filter((x): x is Paleta => !!x)
                  const stale = tylkoPodglad || !!p.zamrozona
                  const zPalet = !pal.length || !(p.kgPerUnit > 0) ? null
                    : p.zKoncowek ? { txt: `${sumaKoncowek(pal).sztuk(p.kgPerUnit)} szt.`, tip: `${fmt(sumaKoncowek(pal).kg)} kg końcówek` }
                      : sk.length ? { txt: sk.map(s => `${s.nazwa} ${pal.filter(x => (x.materialTypeId ?? '') === s.materialTypeId).reduce((a, x) => a + sztukZPalety(x.kgWeighed, p.kgPerUnit * s.pct / 100), 0)}`).join(' · '), tip: 'Sztuk z palet każdego składnika' }
                        : { txt: `${pal.reduce((a, x) => a + sztukZPalety(x.kgWeighed, p.kgPerUnit), 0)} szt.`, tip: `Końcówka ~${fmt(prognozaKoncowki(pal, p.qty, p.kgPerUnit))} kg` }
                  return (
                    <React.Fragment key={p.klucz}>
                    <tr className={`row${sel === p.klucz ? ' sel' : ''}${e.length ? ' blad' : ''}`} aria-selected={sel === p.klucz} onClick={() => setSel(p.klucz)} onFocusCapture={() => setSel(p.klucz)}>
                      <td className="tnum"><b>{i + 1}</b></td>
                      <td className="pp-klient" data-tip={p.zamowienieNo ? `zamówienie ${p.zamowienieNo}` : undefined}>
                        {p.klient ? <><b>{p.klient}</b>{p.zamowienieNo && <span className="sub code"> {p.zamowienieNo}</span>}</> : <span className="muted">—</span>}
                      </td>
                      <td>{stale ? <b className="pp-txt">{nazwaRec(p.recipeId) || '—'}</b>
                        : <Wybor id={`pp-rec-${p.klucz}`} label={`Receptura, pozycja ${i + 1}`} items={recItems} value={p.recipeId} onChange={v => ustaw(p.klucz, { recipeId: v, palety: p.zKoncowek ? p.palety : [] })} placeholder="Receptura…" />}</td>
                      <td>{stale ? <span className="pp-txt">{nazwaRodz(p.productTypeId) || '—'}</span>
                        : <Wybor id={`pp-pt-${p.klucz}`} label={`Rodzaj, pozycja ${i + 1}`} items={ptItems} value={p.productTypeId} onChange={v => ustaw(p.klucz, { productTypeId: v })} placeholder="Rodzaj…" />}</td>
                      <td className="num">{stale ? <b>{p.qty}</b> : <input className="field num" inputMode="numeric" aria-label={`Sztuk, pozycja ${i + 1}`} value={p.qty || ''}
                        onChange={ev => ustaw(p.klucz, { qty: Math.max(0, Math.floor(liczba(ev.target.value))) })} onFocus={ev => ev.target.select()} />}</td>
                      <td className="num">{stale ? <>× {fmt(p.kgPerUnit)} kg</> : <span className="pm-kg"><input id={`pp-kg-${p.klucz}`} className="field num" inputMode="decimal" aria-label={`kg/szt, pozycja ${i + 1}`} value={p.kgPerUnit || ''}
                        onChange={ev => {
                          const kg = liczba(ev.target.value)
                          ustaw(p.klucz, p.zKoncowek ? { kgPerUnit: kg, qty: sumaKoncowek(pal).sztuk(kg) } : { kgPerUnit: kg })
                        }} onFocus={ev => ev.target.select()} /><span>kg</span></span>}</td>
                      <td>{stale ? <span className="pp-txt muted">{tuleje.find(t => t.id === p.packagingId)?.name ?? '—'}</span>
                        : <Wybor id={`pp-tul-${p.klucz}`} label={`Tuleja, pozycja ${i + 1}`} items={tulItems} value={p.packagingId ?? ''} noneLabel="(bez tulei)" onChange={v => ustaw(p.klucz, { packagingId: v || undefined })} />}</td>
                      <td>
                        <span className="pp-palety">
                          {p.zKoncowek && <span className="tag warn" data-tip="Sztuki z kilku końcówek — numer PM nadaje się przy wysłaniu do produkcji">PM</span>}
                          {pal.slice(0, MAX_CHIPOW).map(x => <span key={x.id} className={`pm-chip${x.isRemainder ? ' inne' : ''}`} data-tip={`partia ${x.batchNo}${x.materialName ? ` · ${x.materialName}` : ''} · ${fmt(x.kgWeighed)} kg`}>
                            <b>P{x.palletNo}</b>{x.batchNo}{!stale && <button type="button" className="pp-chip-x" tabIndex={-1} aria-label={`Zdejmij paletę ${x.palletNo}`} onClick={ev => { ev.stopPropagation(); przelacz(x.id) }}><X size={11} /></button>}</span>)}
                          {pal.length > MAX_CHIPOW && <span className="tag outline" data-tip={pal.slice(MAX_CHIPOW).map(x => `P${x.palletNo} · ${x.batchNo}`).join(', ')}>+{pal.length - MAX_CHIPOW}</span>}
                          {!pal.length && !stale && <button type="button" className="pm-dobierz" onClick={ev => { ev.stopPropagation(); setSel(p.klucz); setZakladka('palety') }}>dobierz palety</button>}
                        </span>
                      </td>
                      <td className="num tnum pp-z" data-tip={zPalet?.tip}>{zPalet ? zPalet.txt : <span className="muted">—</span>}</td>
                      <td>{!stale && <button className="btn ghost icon sm danger" tabIndex={-1} aria-label={`Usuń pozycję ${i + 1}`} onClick={ev => { ev.stopPropagation(); setPozycje(s => s.filter(x => x.klucz !== p.klucz)) }}><X size={15} /></button>}</td>
                    </tr>
                    {e.length > 0 && <tr className="pp-err-row"><td /><td colSpan={9}><span className="fld-err">{e.join(' · ')}</span></td></tr>}
                    </React.Fragment>
                  )
                })}
              </tbody>
              {pozycje.length > 0 && <tfoot><tr><td /><td colSpan={3}>Razem — {pozycje.length} poz.</td><td className="num">{fmt(razem.szt)}</td><td className="num">{fmt(razem.kg)} kg</td><td colSpan={4} /></tr></tfoot>}
            </table>
          </div>
          {!tylkoPodglad && <p className="pm-skroty muted">Zaznacz pozycję, potem klikaj palety w panelu · Ctrl+N — nowa pozycja · Ctrl+S — zapisz</p>}
        </div>

        <div className={`splitter${dock.drag ? ' drag' : ''}`} role="separator" aria-orientation={dock.side ? 'vertical' : 'horizontal'} aria-label="Zmień rozmiar panelu"
          onMouseDown={dock.startDrag} onDoubleClick={dock.reset} data-tip="Przeciągnij, aby zmienić rozmiar. Dwuklik — domyślnie." />
        <aside className="dock pm-panel" aria-label="Palety i zamówienia">
          <div className="dock-tabs pp-tabs" role="tablist">
            <button role="tab" className="dock-tab" aria-selected={zakladka === 'palety'} onClick={() => setZakladka('palety')} aria-label="Palety w chłodni"><Boxes size={14} />Palety</button>
            <button role="tab" className="dock-tab" aria-selected={zakladka === 'zamowienia'} onClick={() => setZakladka('zamowienia')} aria-label="Z zamówień"><ShoppingCart size={14} />Zamówienia
              {doWciagniecia.length > 0 && <span className="badge">{doWciagniecia.length}</span>}</button>
            <button role="tab" className="dock-tab" aria-selected={zakladka === 'plany'} onClick={() => setZakladka('plany')}><ListChecks size={14} />Plany</button>
            {plan?.status === 'done' && <button role="tab" className="dock-tab" aria-selected={zakladka === 'bilans'} onClick={() => setZakladka('bilans')}><Calculator size={14} />Bilans
              {stan === 'do-bilansu' && <span className="badge warn">!</span>}</button>}
            <span className="grow" />
            <button className="btn ghost icon sm pp-dock-btn" onClick={() => app.setPanel?.(app.panel === 'bok' ? 'dol' : 'bok')}
              aria-label={app.panel === 'bok' ? 'Panel na dole' : 'Panel z boku'} data-tip={app.panel === 'bok' ? 'Przenieś panel na dół' : 'Przenieś panel na bok'}>
              {app.panel === 'bok' ? <PanelBottom size={16} /> : <PanelRight size={16} />}</button>
          </div>
          <div className="pm-panel-body" role="tabpanel">
            {zakladka === 'palety' && <PanelPalet palety={palety} wybrana={wybrana} sklad={wybrana ? sklad(wybrana) : []} nazwyPlanow={nazwyPlanow} biezacyPlanId={planId}
              tylkoPodglad={tylkoPodglad} onPrzelacz={przelacz} onPodpowiedz={() => podpowiedz(wybrana)} onZKoncowek={zKoncowek} />}
            {zakladka === 'bilans' && plan?.status === 'done' && <BilansPlanu key={plan.id} planId={plan.id} />}
            {zakladka === 'zamowienia' && <div className="pp-zam">
              {doWciagniecia.length > 0 && <label className="pp-szukaj"><Search size={14} />
                <input className="field" type="search" placeholder="Klient, zamówienie, receptura…" value={szukajZam} onChange={e => setSzukajZam(e.target.value)} aria-label="Szukaj w zamówieniach" /></label>}
              {!doWciagniecia.length && <Pusto ikona={<ShoppingCart size={20} />} tytul="Nic do wciągnięcia">Potwierdzone zamówienia są już w planie albo zrobione.</Pusto>}
              {doWciagniecia.length > 0 && !grupyZam.length && <p className="muted pp-pad">Nic nie pasuje do „{szukajZam}”.</p>}
              {grupyZam.map(k => (
                <section key={k.clientName} className="pp-zk">
                  <h4><span>{k.clientName}</span><span className="grow" /><span className="sub tnum">{k.szt} szt. · {fmt(k.kg)} kg</span></h4>
                  {k.zamowienia.map(z => (
                    <div key={z.orderId} className="pp-zz">
                      <div className="pp-zz-h"><b className="code">{z.orderNo}</b><span className="sub tnum">{z.szt} szt. · {fmt(z.kg)} kg</span><span className="grow" />
                        {z.linie.length > 1 && <button type="button" className="btn sm ghost" disabled={tylkoPodglad} onClick={() => zZamowienia(...z.linie)}
                          aria-label={`Dodaj całe zamówienie ${z.orderNo}`}><Plus size={13} />Dodaj całe</button>}</div>
                      <table className="tbl pp-zz-t"><tbody>
                        {z.linie.map(l => (
                          <tr key={l.lineId} className="row">
                            <td className="num tnum"><b>{l.qtyRemaining} × {fmt(l.kgPerUnit)} kg</b></td>
                            <td className="pp-txt" title={nazwaRec(l.recipeId)}>{nazwaRec(l.recipeId)}</td>
                            <td className="pp-txt muted" title={nazwaRodz(l.productTypeId)}>{nazwaRodz(l.productTypeId)}</td>
                            <td className="num tnum">{fmt(l.kg)} kg</td>
                            <td className="r"><button type="button" className="btn sm" disabled={tylkoPodglad} onClick={() => zZamowienia(l)}
                              aria-label={`${l.clientName} · ${l.orderNo} · ${l.qtyRemaining} × ${fmt(l.kgPerUnit)} kg ${nazwaRec(l.recipeId)}`}><Plus size={13} />Dodaj</button></td>
                          </tr>
                        ))}
                      </tbody></table>
                    </div>
                  ))}
                </section>
              ))}
            </div>}
            {zakladka === 'plany' && <div className="pp-plany">
              {ostatnie.map(p => {
                const s = stanPlanu(p)
                return (
                  <button key={p.id} type="button" className={`pp-plan${p.id === planId ? ' sel' : ''}`} onClick={() => { if (zmieniony) return; setDzien(p.planDate.slice(0, 10)); void wczytaj(p.planDate.slice(0, 10), p.id) }}>
                    <span className="l1"><b className="code">{p.planNo}</b><span className="sub">{dataPl(p.planDate)}</span><span className="grow" /><span className={`tag ${s === 'do-druku' || s === 'do-bilansu' ? 'warn' : s === 'zamkniety' ? 'neutral' : 'outline'}`}>{ETYKIETA_STANU[s]}</span></span>
                    {p.summary && <span className="l2 muted tnum">etykiety {p.summary.labelsPrinted}/{p.summary.units} · palety {p.summary.palletsTaken}/{p.summary.pallets} wywiezione · {p.summary.palletsReturned} zwrócone</span>}
                  </button>
                )
              })}
            </div>}
          </div>
        </aside>
      </div>
      {okno?.rodzaj === 'straty' && <StratyOkno onClose={() => setOkno(null)} />}
      {okno?.rodzaj === 'karta' && plan && <KartaProdukcjiDialog plan={{
        id: plan.id, planNo: plan.planNo, planDate: plan.planDate,
        lines: plan.lines.map(l => ({
          id: l.id, position: l.position, qty: Number(l.qty) || 0, kgPerUnit: Number(l.kgPerUnit) || 0,
          recipeName: l.recipeName || nazwaRec(l.recipeId), productTypeName: l.productTypeName, packagingName: l.packagingName, clientName: l.clientName,
          pallets: l.pallets ?? [], sklad: sklad({ klucz: l.id, qty: 0, kgPerUnit: 0, recipeId: l.recipeId ?? '', productTypeId: l.productTypeId ?? '', palety: [], zKoncowek: false }),
        })),
      } as PlanKarty} onClose={() => setOkno(null)} />}
      {okno?.rodzaj === 'etykiety' && plan && <OknoEtykiet planId={plan.id} planNo={plan.planNo} przedruk={okno.przedruk} wyrzuc={okno.wyrzuc}
        pozycje={plan.lines.map(l => ({ id: l.id, position: Number(l.position) || 0 }))} onClose={() => { setOkno(null); void wczytaj(dzien, plan.id) }} />}
    </>
  )
}
