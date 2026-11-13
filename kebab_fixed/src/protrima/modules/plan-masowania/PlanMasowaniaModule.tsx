import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Layers, Save, Plus, Printer, RefreshCw, ChevronLeft, ChevronRight, Zap, ArrowUp, ArrowDown, X, CheckCheck, RotateCcw,
  MoreHorizontal, CalendarClock, XCircle, MessageSquareText, ShoppingCart, Beef, FlaskConical,
} from 'lucide-react'
import { useApp, CommandBar, Dialog, Menu, type Cmd } from '../../shell/context'
import { FlagIcon } from '../../ui/Glyphs'
import { Pusto } from '../../ui/Pusto'
import { SzkieletWierszy } from '../../ui/Szkielet'
import { Wybor, type WyborItem } from '../../ui/Wybor'
import { useApi } from '@/hooks/useApi'
import { ingredientsApi, meatStockApi, mixingOrdersApi, recipesApi, type MixingDemandRow, type StaleMixingOrder } from '@/lib/api'
import type { IngredientStock, Recipe } from '@/features/ingredients/types'
import { autoFefoDistribute } from '@/features/products/lib/autoFefo'
import { liveFreeByLot, reservedByLot, withDayPool } from '@/features/products/lib/planLiveBalance'
import { fefoLotCompare } from '@/lib/utils/fefo'
import { AnulujDialog, CofnijDialog, DrukPlanuDialog, PotwierdzDialog, PrzeniesDialog } from './Okna'
import {
  ETYKIETA_STATUSU, bilans, bledy, dataPl, doZapisu, dzisIso, fmt, fmt2, kgPartii, kgWiersza, liczba, nazwaDnia, nietykalny, odcisk, opisWsadow,
  pierwszyBlad, polprodukt, potrzebyNaZywo, wsady, przesun, przesunDzien, przyprawyPlanu, rodzajDnia, stanPartii, sumaPartii, toZs, wypelniony, zOgonem, zPlanu,
  nowyKlucz, type LotPlanu, type PartiaMiesa, type PozycjaSerwera, type Potrzeba, type Przyprawa, type Wiersz,
} from './model'

type Zakladka = 'potrzeby' | 'partie' | 'przyprawy'
type Okno =
  | { rodzaj: 'potwierdz' | 'cofnij' | 'anuluj' | 'przenies'; w: Wiersz; zDnia?: string }
  | { rodzaj: 'druk' } | { rodzaj: 'dzien'; cel: string } | null

const KOLUMN = 7

/**
 * Plan masowania — kolejka dnia dla masowni (port ze starego MES, ulepszony):
 * potrzeby z zamówień dodawane jednym kliknięciem, zaległe zlecenia z minionych
 * dni do przeniesienia albo anulowania, wpisywanie z klawiatury, partie mięsa
 * z żywym saldem i FEFO, przyprawy z brakami, podział na wsady, uwagi dla
 * operatora, potwierdzanie wykonania z podziałem na partie. Rezerwacje i
 * księgowania robi serwer tymi samymi ścieżkami co dotąd.
 */
export function PlanMasowaniaModule({ active, setCtx, setCmds }: { active: boolean; setCtx: (n: React.ReactNode) => void; setCmds: (c: Cmd[]) => void }) {
  const app = useApp()
  const dzis = dzisIso()
  const [dzien, setDzien] = useState(dzis)
  const rodzaj = rodzajDnia(dzien, dzis)
  const tylkoPodglad = rodzaj === 'miniony'

  const recepturyRes = useApi(() => recipesApi.list())
  const stanyRes = useApi(() => ingredientsApi.stock())
  const potrzebyRes = useApi(() => mixingOrdersApi.demand(dzien), [dzien])
  const zalegleRes = useApi(() => mixingOrdersApi.stale())

  const [wiersze, setWiersze] = useState<Wiersz[]>([])
  const [zapisany, setZapisany] = useState('[]')
  const [mieso, setMieso] = useState<Array<Record<string, unknown>>>([])
  const [wlasne, setWlasne] = useState<Map<string, number>>(new Map())
  const [wczytano, setWczytano] = useState<string | null>(null)
  const [bladPlanu, setBladPlanu] = useState<string | null>(null)
  const [zapisuje, setZapisuje] = useState(false)
  const [bladZapisu, setBladZapisu] = useState<string | null>(null)
  const [pokazBledy, setPokazBledy] = useState(false)
  const [sel, setSel] = useState<string | null>(null)
  const [zakladka, setZakladka] = useState<Zakladka>('potrzeby')
  const [okno, setOkno] = useState<Okno>(null)
  const [menu, setMenu] = useState<{ el: Element; w: Wiersz } | null>(null)

  const zmieniony = odcisk(wiersze) !== zapisany
  const zmienionyRef = useRef(false); zmienionyRef.current = zmieniony
  const oknoRef = useRef(false); oknoRef.current = !!okno || zapisuje
  const dzienRef = useRef(dzien); dzienRef.current = dzien

  const receptury = useMemo(() => new Map(((recepturyRes.data ?? []) as Recipe[]).map(r => [r.id, r])), [recepturyRes.data])
  const stany = (stanyRes.data ?? null) as IngredientStock[] | null

  // Plan i magazyn mięsa w PARZE, z jednej chwili: pula dnia = wolne z API + rezerwacje wczytanego planu.
  const wczytaj = useCallback(async (d: string) => {
    try {
      const [plan, ms] = await Promise.all([mixingOrdersApi.dayPlan(d), meatStockApi.list(true)])
      if (dzienRef.current !== d) return
      const w = zPlanu(plan.items as unknown as PozycjaSerwera[])
      setWiersze(rodzajDnia(d) === 'miniony' ? w : zOgonem(w))
      setZapisany(odcisk(w))
      setWlasne(reservedByLot(w))
      setMieso((ms.data ?? []) as unknown as Array<Record<string, unknown>>)
      setBladPlanu(null); setWczytano(d)
    } catch (e) {
      if (dzienRef.current === d) { setBladPlanu(e instanceof Error ? e.message : 'Nie udało się pobrać planu'); setWczytano(d) }
    }
  }, [])
  useEffect(() => {
    setWczytano(null); setSel(null); setPokazBledy(false); setBladZapisu(null)
    void wczytaj(dzien)
    // Panel masowni zmienia statusy w ciągu dnia — odświeżamy, ale nigdy pod ręką piszącego.
    const t = window.setInterval(() => { if (!zmienionyRef.current && !oknoRef.current) void wczytaj(dzienRef.current) }, 15000)
    return () => window.clearInterval(t)
  }, [dzien, wczytaj])

  const odswiez = useCallback(() => {
    void potrzebyRes.refetch(); void zalegleRes.refetch(); void stanyRes.refetch()
    if (!zmienionyRef.current) void wczytaj(dzienRef.current)
  }, [potrzebyRes, zalegleRes, stanyRes, wczytaj])

  const partie = useMemo<PartiaMiesa[]>(() => withDayPool(
    mieso.filter(m => m.status !== 'DEPLETED' && m.status !== 'IN_PRODUCTION').map(m => ({
      id: String(m.id), lotNo: String(m.lotNo ?? ''), kgAvailable: Math.max(0, Number(m.kgAvailable) || 0), expiryDate: String(m.expiryDate ?? ''),
      materialName: m.materialName ? String(m.materialName) : undefined, materialTypeId: m.materialTypeId ? String(m.materialTypeId) : undefined,
      supplierName: m.supplierName ? String(m.supplierName) : undefined,
    })), wlasne,
  ).sort((a, b) => fefoLotCompare({ expiryDate: a.expiryDate, no: a.lotNo, id: a.id }, { expiryDate: b.expiryDate, no: b.lotNo, id: b.id })), [mieso, wlasne])
  const wPlanie = useMemo(() => reservedByLot(wiersze), [wiersze])
  const wolne = useMemo(() => liveFreeByLot(partie, wPlanie), [partie, wPlanie])
  const b = useMemo(() => bilans(wiersze, receptury, partie), [wiersze, receptury, partie])
  const przyprawy = useMemo(() => przyprawyPlanu(wiersze, receptury, stany), [wiersze, receptury, stany])
  const brakiPrzypraw = przyprawy.filter(p => p.brak > 0.0005)
  const potrzeby = useMemo(() => potrzebyNaZywo(wiersze, (potrzebyRes.data?.items ?? []) as MixingDemandRow[], receptury), [wiersze, potrzebyRes.data, receptury])
  const doZamasowania = potrzeby.filter(p => p.brakKg > 0).length
  const zalegle = ((zalegleRes.data ?? []) as StaleMixingOrder[]).filter(z => z.planDate !== dzien)
  const bl = useMemo(() => bledy(wiersze), [wiersze])
  const brak = pierwszyBlad(wiersze, bl)
  const pelne = wiersze.filter(wypelniony)
  const wybrany = wiersze.find(w => w.klucz === sel) ?? null
  const recItems = useMemo<WyborItem[]>(() => [...receptury.values()].sort((x, y) => x.name.localeCompare(y.name, 'pl'))
    .map(r => ({ id: r.id, label: r.name, sub: `${fmt(r.totalOutputPer100kg)} kg / 100 kg` })), [receptury])
  const nazwa = (w: Wiersz) => receptury.get(w.recipeId)?.name ?? ''

  // ── Edycja szkicu ──
  const fokus = (id: string) => {
    const el = document.getElementById(id) as HTMLInputElement | null
    if (el) { el.focus(); el.select?.() } else requestAnimationFrame(() => (document.getElementById(id) as HTMLInputElement | null)?.focus())
  }
  const ustaw = (klucz: string, p: Partial<Wiersz>) => { setWiersze(s => zOgonem(s.map(w => w.klucz === klucz ? { ...w, ...p } : w))); setBladZapisu(null) }
  const usun = (klucz: string) => { setWiersze(s => zOgonem(s.filter(w => w.klucz !== klucz))); if (sel === klucz) setSel(null) }
  const dodaj = useCallback(() => {
    const ogon = wiersze[wiersze.length - 1]
    if (ogon && !wypelniony(ogon)) { setSel(ogon.klucz); fokus(`pm-rec-${ogon.klucz}`) }
  }, [wiersze])
  const zPotrzeby = (p: Potrzeba) => {
    const klucz = nowyKlucz()
    setWiersze(s => zOgonem([...s.filter(wypelniony), { klucz, recipeId: p.recipeId, kg: String(p.proponowaneMiesoKg), uwagi: '', status: 'new', lots: [] }]))
    setSel(klucz)
    app.toast({ kind: 'ok', title: `${p.recipeName}: ${fmt(p.proponowaneMiesoKg)} kg mięsa w planie`, detail: `pokrywa brak ${fmt(p.brakKg)} kg półproduktu — zapisz plan, żeby trafił na masownię` })
    requestAnimationFrame(() => fokus(`pm-kg-${klucz}`))
  }
  // FEFO: partie z/s po wierszach w kolejności; pozycje w masownicy trzymają swoje.
  const fefo = useCallback((tylko?: string) => {
    setWiersze(s => {
      const cele = s.filter(w => wypelniony(w) && !nietykalny(w) && kgWiersza(w) > 0 && (!tylko || w.klucz === tylko))
      const zajete = new Map<string, number>()
      s.forEach(w => { if (cele.includes(w)) return; w.lots.forEach(l => zajete.set(l.meatLotId, (zajete.get(l.meatLotId) ?? 0) + (l.kgPlanned || 0))) })
      // Filet i inne dobrane ręcznie zostają przy pozycji — automat rozdaje tylko mięso z/s.
      const inne = new Set(partie.filter(p => !toZs(p)).map(p => p.id))
      cele.forEach(w => w.lots.filter(l => inne.has(l.meatLotId)).forEach(l => zajete.set(l.meatLotId, (zajete.get(l.meatLotId) ?? 0) + (l.kgPlanned || 0))))
      const dist = autoFefoDistribute(
        cele.map(w => ({ rowKey: w.klucz, kg: Math.max(0, kgWiersza(w) - w.lots.filter(l => inne.has(l.meatLotId)).reduce((a, l) => a + (l.kgPlanned || 0), 0)) })),
        partie.filter(toZs).map(p => ({ id: p.id, expiryDate: p.expiryDate, kgFree: Math.max(0, p.kgAvailable - (zajete.get(p.id) ?? 0)) })),
      )
      return s.map(w => cele.includes(w) ? { ...w, lots: [...w.lots.filter(l => inne.has(l.meatLotId)), ...(dist[w.klucz] ?? []).map(l => opisz(l, partie))] } : w)
    })
  }, [partie])

  const zapisz = useCallback(async (): Promise<boolean> => {
    if (zapisuje || tylkoPodglad) return false
    if (brak) { setPokazBledy(true); fokus(brak.pole); return false }
    if (!zmieniony) return true
    setZapisuje(true); setBladZapisu(null)
    try {
      await mixingOrdersApi.saveDayPlan(doZapisu(wiersze), dzien)
      await wczytaj(dzien)
      setPokazBledy(false)
      app.toast({ kind: 'ok', title: `Plan masowania na ${nazwaDnia(dzien, dzis)} zapisany`, detail: `${b.pozycji} poz. · ${fmt(b.miesoKg)} kg mięsa → ${fmt(b.polproduktKg)} kg półproduktu${b.bezPartiiKg > 0.5 ? ` · ${fmt(b.bezPartiiKg)} kg bez partii` : ''}` })
      void potrzebyRes.refetch()
      return true
    } catch (e) { setBladZapisu(e instanceof Error ? e.message : 'Nie udało się zapisać planu'); return false } finally { setZapisuje(false) }
  }, [zapisuje, tylkoPodglad, brak, zmieniony, wiersze, dzien, dzis, wczytaj, app, b, potrzebyRes])

  const zmienDzien = (cel: string) => { if (cel === dzien) return; if (zmieniony) setOkno({ rodzaj: 'dzien', cel }); else setDzien(cel) }
  const poOperacji = (tytul: string, detail?: string) => {
    app.toast({ kind: 'ok', title: tytul, detail }); setOkno(null)
    void wczytaj(dzien); void potrzebyRes.refetch(); void zalegleRes.refetch(); void stanyRes.refetch()
  }

  // ── Polecenia i klawisze ──
  const cmds = useMemo<Cmd[]>(() => [
    ...(tylkoPodglad ? [] : [
      { id: 'save', group: 1, label: zmieniony ? 'Zapisz plan' : 'Plan zapisany', icon: <Save size={17} />, kbd: 'Ctrl+S', primary: true, disabled: !zmieniony || zapisuje,
        tip: zmieniony ? (brak ? brak.tekst : undefined) : 'brak zmian do zapisania', run: () => void zapisz(), onDisabledClick: () => { if (brak) { setPokazBledy(true); fokus(brak.pole) } } },
      { id: 'new', group: 2, label: 'Dodaj pozycję', icon: <Plus size={17} />, kbd: 'Ctrl+N', run: dodaj },
      { id: 'fefo', group: 2, label: 'Dobierz partie (FEFO)', icon: <Zap size={17} />, disabled: !pelne.some(w => !nietykalny(w)), tip: 'Rozdziela wolne mięso z/s po pozycjach w kolejności, od najkrótszego terminu', run: () => fefo() },
    ] as Cmd[]),
    { id: 'print', group: 3, label: 'Plan dla operatora', icon: <Printer size={17} />, kbd: 'Ctrl+P', disabled: zmieniony || !pelne.some(w => w.id), tip: zmieniony ? 'najpierw zapisz plan — drukuje się zapisany' : 'plan jest pusty',
      run: () => setOkno({ rodzaj: 'druk' }) },
    { id: 'reload', group: 4, label: 'Odśwież', icon: <RefreshCw size={17} />, opt: true, run: odswiez },
  ], [tylkoPodglad, zmieniony, zapisuje, brak, zapisz, dodaj, fefo, pelne, odswiez])
  useEffect(() => { if (active) setCmds(cmds) }, [active, cmds, setCmds])
  useEffect(() => {
    if (!active) return
    setCtx(<span>Plan na <b>{nazwaDnia(dzien, dzis)}</b> · {b.pozycji} poz. · mięso <b>{fmt(b.miesoKg)} kg</b>{zmieniony ? <> · <b className="warn-ink">niezapisane zmiany</b></> : null}
      {zalegle.length ? <> · zaległe <b>{zalegle.length}</b></> : null}</span>)
  }, [active, dzien, dzis, b.pozycji, b.miesoKg, zmieniony, zalegle.length, setCtx])
  useEffect(() => {
    if (!active || okno) return
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); void zapisz() }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [active, okno, zapisz])
  // Zamknięcie programu z niezapisanym planem — przeglądarka/okno pyta, zanim szkic przepadnie.
  useEffect(() => {
    if (!zmieniony) return
    const f = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [zmieniony])

  const laduje = wczytano !== dzien
  const wierszMenu = (w: Wiersz): Array<Record<string, unknown>> => [
    { header: `${nazwa(w) || 'Pozycja'} · ${fmt(kgWiersza(w))} kg` },
    ...(!tylkoPodglad && !nietykalny(w) ? [{ label: 'Dobierz partie FEFO dla tej pozycji', icon: <Zap size={15} />, onSelect: () => { fefo(w.klucz); setSel(w.klucz); setZakladka('partie') } }] : []),
    ...(w.id && !nietykalny(w) ? [
      { label: 'Przenieś na inny dzień…', icon: <CalendarClock size={15} />, disabled: zmieniony, onSelect: () => setOkno({ rodzaj: 'przenies', w, zDnia: dzien }) },
      { label: 'Anuluj zlecenie…', icon: <XCircle size={15} />, disabled: zmieniony, onSelect: () => setOkno({ rodzaj: 'anuluj', w }) },
    ] : []),
    ...(zmieniony && w.id && !nietykalny(w) ? [{ header: 'Przenoszenie i anulowanie — po zapisaniu planu' }] : []),
  ]

  return (
    <>
      <CommandBar title="Plan masowania" count={`${nazwaDnia(dzien, dzis)}, ${dataPl(dzien)}`} cmds={cmds} showKbd={false} />
      <div className="toolbar pm-toolbar" role="toolbar" aria-label="Dzień planu">
        <div className="pm-dni">
          <button className="btn icon ghost" onClick={() => zmienDzien(przesunDzien(dzien, -1))} aria-label="Dzień wcześniej" data-tip="Dzień wcześniej"><ChevronLeft size={17} /></button>
          <input type="date" className="field" value={dzien} onChange={e => e.target.value && zmienDzien(e.target.value)} aria-label="Dzień planu" />
          <button className="btn icon ghost" onClick={() => zmienDzien(przesunDzien(dzien, 1))} aria-label="Dzień później" data-tip="Dzień później"><ChevronRight size={17} /></button>
        </div>
        <div className="seg" role="group" aria-label="Szybki wybór dnia">
          <button type="button" aria-pressed={dzien === dzis} onClick={() => zmienDzien(dzis)}>Dziś</button>
          <button type="button" aria-pressed={dzien === przesunDzien(dzis, 1)} onClick={() => zmienDzien(przesunDzien(dzis, 1))}>Jutro</button>
        </div>
        {rodzaj === 'miniony' && <span className="tag neutral" data-tip="Plan z minionego dnia jest tylko do podglądu i druku. Niewykonane zlecenia można przenieść albo anulować.">plan miniony — tylko podgląd</span>}
        {rodzaj === 'przyszly' && <span className="tag outline" data-tip="Partie mięsa można dobrać później, gdy mięso zejdzie z rozbioru">plan na przyszłość — partie opcjonalne</span>}
        {zmieniony && <span className="tag warn">niezapisane zmiany</span>}
        <span className="grow" />
        <div className="pm-figi" aria-label="Bilans planu">
          <div><span className="k">Mięso w planie</span><span className="v">{fmt(b.miesoKg)} kg</span></div>
          <div><span className="k">Półprodukt</span><span className="v">{fmt(b.polproduktKg)} kg</span></div>
          {!tylkoPodglad && <div className={b.zostanieZs < -0.5 ? 'crit' : ''} data-tip={`Wolne mięso z/s ${fmt(b.pulaZs)} kg − potrzeba planu ${fmt(b.potrzebaZs)} kg`}>
            <span className="k">Z/s po planie</span><span className="v">{fmt(b.zostanieZs)} kg</span></div>}
        </div>
      </div>

      <div className="pm-uklad">
        <div className="pm-lewa">
          {!tylkoPodglad && zalegle.length > 0 && (
            <div className="note warn pm-zalegle" role="status"><FlagIcon level="warn" size={15} />
              <div><b>Zaległe zlecenia z poprzednich dni: {zalegle.length}</b> — nikt ich nie zmasował, a trzymają {fmt(zalegle.reduce((s, z) => s + z.reservedKg, 0))} kg mięsa.
                <ul>{zalegle.map(z => {
                  const w = zPlanu([z as unknown as PozycjaSerwera])[0]
                  return <li key={z.id}><span><b>{z.recipeName}</b> · {fmt(z.meatKg)} kg · plan na {dataPl(z.planDate)}{z.reservedKg > 0 ? ` · partie ${z.meatLots.filter(l => l.kgPlanned > 0).map(l => l.meatLotNo).join(', ')}` : ''}</span>
                    <span className="pm-zal-akcje">
                      {z.status !== 'in_progress' && <button className="btn sm" disabled={zmieniony} data-tip={zmieniony ? 'najpierw zapisz plan' : undefined} onClick={() => setOkno({ rodzaj: 'przenies', w, zDnia: z.planDate })}><CalendarClock size={14} />Przenieś…</button>}
                      <button className="btn sm ghost danger" onClick={() => setOkno({ rodzaj: 'anuluj', w, zDnia: z.planDate })}><XCircle size={14} />Anuluj…</button>
                      <button className="btn sm ghost" onClick={() => zmienDzien(z.planDate)}>Pokaż dzień</button>
                    </span></li>
                })}</ul></div></div>
          )}
          {bladPlanu && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Nie udało się pobrać planu:</b> {bladPlanu} <button className="btn sm" onClick={() => void wczytaj(dzien)}>Spróbuj ponownie</button></div></div>}
          {bladZapisu && <div className="note crit" role="alert"><FlagIcon level="crit" size={15} /><div><b>Plan nie został zapisany:</b> {bladZapisu}</div></div>}

          <div className="tbl-wrap pm-tbl-wrap">
            <table className="tbl pm-tbl" aria-label="Pozycje planu masowania">
              <thead><tr>
                <th style={{ width: 62 }}>Lp.</th><th>Receptura</th><th className="num" style={{ width: 118 }} data-tip="Kilogramy mięsa; pod spodem podział na wsady masownic 600 i 200 kg">Mięso · wsady</th>
                <th className="num" style={{ width: 104 }}>Półprodukt</th><th>Partie mięsa</th><th style={{ width: 150 }}>Stan</th><th style={{ width: 176 }} />
              </tr></thead>
              <tbody>
                {laduje && <SzkieletWierszy kolumny={KOLUMN} wiersze={5} />}
                {!laduje && !bladPlanu && tylkoPodglad && pelne.length === 0 && <tr><td colSpan={KOLUMN}><Pusto ikona={<Layers size={20} />} tytul={`Na ${dataPl(dzien)} nie było planu masowania`}
                  akcja={<button className="btn sm" onClick={() => zmienDzien(dzis)}>Przejdź do dziś</button>} /></td></tr>}
                {!laduje && wiersze.map((w, i) => {
                  const ogon = !wypelniony(w)
                  const stale = nietykalny(w) || tylkoPodglad
                  const e = pokazBledy ? bl[w.klucz] : undefined
                  const kg = kgWiersza(w), r = receptury.get(w.recipeId)
                  const sp = stanPartii(w)
                  const poz = pelne.findIndex(x => x.klucz === w.klucz)
                  const mozePotwierdzic = rodzaj === 'dzis' && !!w.id && (w.status === 'planned' || w.status === 'confirmed')
                  const tipPotw = zmieniony ? 'najpierw zapisz plan' : sp !== 'komplet' ? 'dobierz partie mięsa na całą pozycję' : undefined
                  return (
                    <tr key={w.klucz} className={`row${sel === w.klucz ? ' sel' : ''}${ogon ? ' pm-ogon' : ''}${w.status === 'done' ? ' pm-gotowe' : ''}`} aria-selected={sel === w.klucz}
                      onClick={() => setSel(w.klucz)} onFocusCapture={() => setSel(w.klucz)}
                      onKeyDown={ev => { if (ev.altKey && (ev.key === 'ArrowUp' || ev.key === 'ArrowDown') && !ogon && !tylkoPodglad) { ev.preventDefault(); setWiersze(s => przesun(s, w.klucz, ev.key === 'ArrowUp' ? -1 : 1)) } }}>
                      <td className="tnum pm-lp" onClick={ev => ev.stopPropagation()}>{ogon ? <Plus size={14} aria-hidden /> : <span className="pm-lp-w"><b>{i + 1}</b>{!tylkoPodglad && <span className="pm-kolej">
                        <button type="button" tabIndex={-1} disabled={poz <= 0} onClick={() => setWiersze(s => przesun(s, w.klucz, -1))} aria-label={`Wcześniej: pozycja ${i + 1}`} data-tip="Wcześniej w kolejce (Alt+↑)"><ArrowUp size={13} /></button>
                        <button type="button" tabIndex={-1} disabled={poz >= pelne.length - 1} onClick={() => setWiersze(s => przesun(s, w.klucz, 1))} aria-label={`Później: pozycja ${i + 1}`} data-tip="Później w kolejce (Alt+↓)"><ArrowDown size={13} /></button></span>}</span>}</td>
                      <td className={e?.receptura ? 'pm-blad' : undefined}>
                        {stale ? <><b>{r?.name ?? '—'}</b>{w.orderNo && <span className="sub code">{w.orderNo}</span>}</>
                          : <Wybor id={`pm-rec-${w.klucz}`} label={`Receptura ${i + 1}`} items={recItems} value={w.recipeId} invalid={!!e?.receptura}
                            onChange={v => ustaw(w.klucz, { recipeId: v })} onDalej={() => fokus(`pm-kg-${w.klucz}`)}
                            placeholder={ogon ? (pelne.length ? 'Następna receptura…' : 'Wpisz recepturę…') : 'Wybierz recepturę…'} pusto="Nie ma takiej receptury" />}
                        {e?.receptura && <span className="fld-err">{e.receptura}</span>}
                        {w.uwagi.trim() && <span className="pm-uwaga" data-tip="Uwaga dla operatora — będzie na wydruku"><MessageSquareText size={12} aria-hidden />{w.uwagi}</span>}
                      </td>
                      <td className={`num${e?.kg || e?.partie ? ' pm-blad' : ''}`}>
                        {stale ? <><b>{fmt(kg)}</b> <span className="sub">kg</span></>
                          : <span className="pm-kg"><input id={`pm-kg-${w.klucz}`} className={`field num${e?.kg || e?.partie ? ' invalid' : ''}`} inputMode="decimal" value={w.kg} aria-label={`Mięso kg ${i + 1}`}
                            onChange={ev => ustaw(w.klucz, { kg: ev.target.value.replace(/[^\d.,]/g, '') })} onFocus={ev => ev.target.select()}
                            onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); const n = wiersze[i + 1]; if (n) fokus(`pm-rec-${n.klucz}`) } }} /><span>kg</span></span>}
                        {(e?.kg || e?.partie) ? <span className="fld-err">{e.kg ?? e.partie}</span> : wsady(kg).length > 1 && <span className="pm-wsady tnum" data-tip="Podział na wsady masownic">{opisWsadow(kg)}</span>}
                      </td>
                      <td className="num">{kg > 0 && r ? <>{fmt(polprodukt(r, kg))} <span className="sub">kg</span></> : ''}</td>
                      <td>{!ogon && <PartieWiersza w={w} kg={kg} stan={sp} stale={stale} onClick={() => { setSel(w.klucz); setZakladka('partie') }} />}</td>
                      <td>{!ogon && <StanWiersza w={w} kg={kg} />}</td>
                      <td className="r pm-akcje" onClick={ev => ev.stopPropagation()}>{!ogon && <>
                        {mozePotwierdzic && <button className="btn sm" disabled={!!tipPotw} data-tip={tipPotw ?? 'Masowanie zrobione — przyjmij półprodukt na magazyn'} onClick={() => setOkno({ rodzaj: 'potwierdz', w })}><CheckCheck size={14} />Potwierdź…</button>}
                        {rodzaj === 'dzis' && w.status === 'done' && <button className="btn sm ghost" data-tip="Cofnij potwierdzenie — gdy nic nie poszło jeszcze na produkcję" onClick={() => setOkno({ rodzaj: 'cofnij', w })}><RotateCcw size={14} />Cofnij…</button>}
                        {tylkoPodglad && w.id && (w.status === 'planned' || w.status === 'confirmed') && !w.kgDone && <>
                          <button className="btn sm" onClick={() => setOkno({ rodzaj: 'przenies', w, zDnia: dzien })}><CalendarClock size={14} />Przenieś…</button>
                          <button className="btn sm ghost danger" onClick={() => setOkno({ rodzaj: 'anuluj', w, zDnia: dzien })}><XCircle size={14} />Anuluj…</button></>}
                        {!tylkoPodglad && <>
                          <button className="btn ghost icon sm" tabIndex={-1} onClick={ev => setMenu({ el: ev.currentTarget, w })} aria-label={`Więcej: pozycja ${i + 1}`} aria-haspopup="menu"><MoreHorizontal size={15} /></button>
                          <button className="btn ghost icon sm danger" tabIndex={-1} disabled={nietykalny(w)} onClick={() => usun(w.klucz)} aria-label={`Usuń pozycję ${i + 1}`}
                            data-tip={nietykalny(w) ? 'Pozycja w masownicy albo gotowa' : w.id ? 'Usuń z planu — zlecenie zostanie anulowane przy zapisie, mięso wróci do puli' : 'Usuń pozycję'}><X size={15} /></button>
                        </>}
                      </>}</td>
                    </tr>
                  )
                })}
              </tbody>
              {!laduje && pelne.length > 0 && <tfoot><tr>
                <td /><td>Razem — {pelne.length} poz.</td><td className="num">{fmt(b.miesoKg)} <span className="sub">kg</span></td>
                <td className="num">{fmt(b.polproduktKg)} <span className="sub">kg</span></td>
                <td colSpan={3}>{!tylkoPodglad && b.bezPartiiKg > 0.5 ? <span className="warn-ink">{fmt(b.bezPartiiKg)} kg bez przypisanej partii</span> : null}</td>
              </tr></tfoot>}
            </table>
          </div>
          {!tylkoPodglad && !laduje && <p className="pm-skroty muted">Enter — dalej · Alt+↑↓ — kolejność · Ctrl+S — zapisz · klik w partie — dobór mięsa po prawej</p>}
        </div>

        <aside className="pm-panel" aria-label="Magazyn i potrzeby">
          <div className="dock-tabs" role="tablist">
            <button role="tab" className="dock-tab" aria-selected={zakladka === 'potrzeby'} onClick={() => setZakladka('potrzeby')}><ShoppingCart size={14} />Z zamówień{doZamasowania > 0 && <span className="badge warn">{doZamasowania}</span>}</button>
            <button role="tab" className="dock-tab" aria-selected={zakladka === 'partie'} onClick={() => setZakladka('partie')}><Beef size={14} />Partie mięsa</button>
            <button role="tab" className="dock-tab" aria-selected={zakladka === 'przyprawy'} onClick={() => setZakladka('przyprawy')}><FlaskConical size={14} />Przyprawy{brakiPrzypraw.length > 0 && <span className="badge crit">{brakiPrzypraw.length}</span>}</button>
          </div>
          <div className="pm-panel-body" role="tabpanel">
            {zakladka === 'potrzeby' && <Potrzeby lista={potrzeby} laduje={potrzebyRes.loading && !potrzebyRes.data} blad={potrzebyRes.error} tylkoPodglad={tylkoPodglad} onDodaj={zPotrzeby} onZamowienie={id => app.openOrder(id)} />}
            {zakladka === 'partie' && <PartiePanel partie={partie} wPlanie={wPlanie} wolne={wolne} wybrany={wybrany && wypelniony(wybrany) && !nietykalny(wybrany) && !tylkoPodglad ? wybrany : null}
              nazwa={wybrany ? nazwa(wybrany) : ''} b={b} tylkoPodglad={tylkoPodglad}
              onLots={(klucz, lots) => ustaw(klucz, { lots })} onUwagi={(klucz, uwagi) => ustaw(klucz, { uwagi })} onFefo={klucz => fefo(klucz)} />}
            {zakladka === 'przyprawy' && <PrzyprawyPanel lista={przyprawy} />}
          </div>
        </aside>
      </div>

      {menu && <Menu anchor={menu.el} align="right" onClose={() => setMenu(null)} items={wierszMenu(menu.w) as never} />}
      {okno?.rodzaj === 'potwierdz' && <PotwierdzDialog w={okno.w} receptura={receptury.get(okno.w.recipeId)} onClose={() => setOkno(null)}
        braki={przyprawyPlanu([okno.w], receptury, stany).filter(p => p.brak > 0.0005)}
        onDone={n => poOperacji('Wykonanie potwierdzone', `${nazwa(okno.w)} — półprodukt na magazynie${n > 1 ? ` w ${n} partiach` : ''}`)} />}
      {okno?.rodzaj === 'cofnij' && <CofnijDialog w={okno.w} nazwa={nazwa(okno.w)} onClose={() => setOkno(null)} onDone={() => poOperacji('Potwierdzenie cofnięte', `${nazwa(okno.w)} wróciło do kolejki`)} />}
      {okno?.rodzaj === 'anuluj' && <AnulujDialog w={okno.w} nazwa={nazwa(okno.w)} dzien={okno.zDnia} onClose={() => setOkno(null)} onDone={() => poOperacji('Zlecenie anulowane', 'mięso wróciło do puli')} />}
      {okno?.rodzaj === 'przenies' && <PrzeniesDialog w={okno.w} nazwa={nazwa(okno.w)} zDnia={okno.zDnia ?? dzien} onClose={() => setOkno(null)}
        onDone={cel => { poOperacji(`Zlecenie przeniesione na ${nazwaDnia(cel, dzis)}`, `${nazwa(okno.w)} · ${fmt(kgWiersza(okno.w))} kg — z partiami mięsa`); if (cel !== dzien && !zmieniony) setDzien(cel) }} />}
      {okno?.rodzaj === 'druk' && <DrukPlanuDialog dzien={dzien} receptury={receptury} onClose={() => setOkno(null)} />}
      {okno?.rodzaj === 'dzien' && <NiezapisaneDialog cel={okno.cel} dzis={dzis} zapisuje={zapisuje} mozna={!brak}
        onZostan={() => setOkno(null)} onPorzuc={() => { const c = okno.cel; setOkno(null); setDzien(c) }}
        onZapisz={async () => { const c = okno.cel; setOkno(null); if (await zapisz()) setDzien(c) }} />}
    </>
  )
}

const opisz = (l: { meatLotId: string; kgPlanned: number }, partie: PartiaMiesa[]): LotPlanu => {
  const p = partie.find(x => x.id === l.meatLotId)
  return { ...l, lotNo: p?.lotNo, materialTypeId: p?.materialTypeId, materialName: p?.materialName, supplierName: p?.supplierName }
}

function NiezapisaneDialog({ cel, dzis, zapisuje, mozna, onZostan, onPorzuc, onZapisz }: { cel: string; dzis: string; zapisuje: boolean; mozna: boolean; onZostan: () => void; onPorzuc: () => void; onZapisz: () => void }) {
  return (
    <Dialog title="Plan ma niezapisane zmiany" icon={<Save size={20} />} onClose={onZostan}
      footer={<><button className="btn" onClick={onZostan}>Zostań</button><button className="btn danger" onClick={onPorzuc}>Porzuć zmiany</button>
        <button className="btn primary" data-autofocus disabled={zapisuje || !mozna} data-tip={mozna ? undefined : 'plan ma błędy — popraw je albo porzuć zmiany'} onClick={onZapisz}>Zapisz i przejdź</button></>}>
      <p className="muted" style={{ margin: 0 }}>Chcesz przejść na {nazwaDnia(cel, dzis)} ({dataPl(cel)}). Masownia zobaczy zmiany dopiero po zapisaniu planu.</p>
    </Dialog>
  )
}

function PartieWiersza({ w, kg, stan, stale, onClick }: { w: Wiersz; kg: number; stan: ReturnType<typeof stanPartii>; stale: boolean; onClick: () => void }) {
  const lots = w.lots.filter(l => kgPartii(l) > 0)
  const tresc = <>
    {lots.slice(0, 3).map(l => <span key={l.meatLotId} className={`pm-chip${!toZs(l) ? ' inne' : ''}`} data-tip={[l.materialName, l.supplierName].filter(Boolean).join(' · ') || undefined}>
      <b>{l.lotNo ?? '?'}</b>{fmt(kgPartii(l))}</span>)}
    {lots.length > 3 && <span className="muted">+{lots.length - 3}</span>}
    {!stale && (stan === 'brak' ? <span className="pm-dobierz">dobierz partie</span>
      : stan === 'czesc' ? <span className="warn-ink tnum">{fmt(sumaPartii(w))} / {fmt(kg)} kg</span>
        : stan === 'nadmiar' ? <span className="crit-ink tnum">{fmt(sumaPartii(w))} / {fmt(kg)} kg</span> : null)}
    {stale && !lots.length && <span className="faint">—</span>}
  </>
  return stale ? <span className="pm-partie">{tresc}</span>
    : <button type="button" className="pm-partie" onClick={e => { e.stopPropagation(); onClick() }} aria-label={`Partie mięsa: ${lots.length ? lots.map(l => l.lotNo).join(', ') : 'brak'}`}>{tresc}</button>
}

function StanWiersza({ w, kg }: { w: Wiersz; kg: number }) {
  if (w.status === 'in_progress') {
    const proc = kg > 0 ? Math.min(100, ((w.kgDone ?? 0) / kg) * 100) : 0
    return <span className="pm-stan"><span className="tag warn">W masownicy</span><span className="pm-pasek" aria-label={`Zmasowano ${fmt(w.kgDone ?? 0)} z ${fmt(kg)} kg`}><i style={{ width: `${proc}%` }} /></span>
      <span className="sub tnum">{fmt(w.kgDone ?? 0)} / {fmt(kg)} kg</span></span>
  }
  if (w.status === 'done') return <span className="pm-stan"><span className="tag ok">Gotowe</span>{w.partie?.length ? <span className="sub" data-tip="Partie mięsa przyprawionego">partia {[...new Set(w.partie.map(p => p.batchNo))].join(', ')}</span> : null}</span>
  return <span className={`tag ${w.status === 'new' ? 'outline' : 'neutral'}`}>{ETYKIETA_STATUSU[w.status]}</span>
}

function Potrzeby({ lista, laduje, blad, tylkoPodglad, onDodaj, onZamowienie }: {
  lista: Potrzeba[]; laduje: boolean; blad: string | null; tylkoPodglad: boolean; onDodaj: (p: Potrzeba) => void; onZamowienie: (id: string) => void
}) {
  const [otwarta, setOtwarta] = useState<string | null>(null)
  if (laduje) return <p className="muted pm-pad">Liczę potrzeby z otwartych zamówień…</p>
  if (blad) return <div className="note crit pm-pad" role="alert"><FlagIcon level="crit" size={15} /><div>Nie udało się policzyć potrzeb: {blad}</div></div>
  if (!lista.length) return <Pusto ikona={<ShoppingCart size={20} />} tytul="Brak otwartych zamówień">Gdy biuro przyjmie zamówienie, tutaj pojawi się, ile mięsa trzeba zamasować.</Pusto>
  const brakuje = lista.filter(p => p.brakKg > 0), pokryte = lista.filter(p => p.brakKg <= 0)
  return (
    <div className="pm-potrzeby">
      <p className="pm-opis muted">Ile półproduktu brakuje pod otwarte zamówienia — po odjęciu stanu, planu produkcji i masowań już zaplanowanych (także w tym szkicu).</p>
      {brakuje.map(p => (
        <div key={p.recipeId} className="pm-potrzeba">
          <div className="l1"><b>{p.recipeName}</b>{p.nearestDelivery && <span className="sub">wyjazd {dataPl(p.nearestDelivery)}</span>}</div>
          <div className="l2"><span className="pm-brak">brakuje <b>{fmt(p.brakKg)} kg</b> półproduktu</span>
            {!tylkoPodglad && <button className="btn sm primary" onClick={() => onDodaj(p)} data-tip={`Doda pozycję ${fmt(p.proponowaneMiesoKg)} kg mięsa (${opisWsadow(p.proponowaneMiesoKg)}) na koniec planu`}><Plus size={14} />{fmt(p.proponowaneMiesoKg)} kg mięsa</button>}</div>
          <button type="button" className="pm-rozwin" aria-expanded={otwarta === p.recipeId} onClick={() => setOtwarta(o => o === p.recipeId ? null : p.recipeId)}>
            zamówione {fmt(p.orderedKg)} · na stanie {fmt(p.seasonedFreeKg)}{p.productionPlanKg > 0 ? ` · w produkcji ${fmt(p.productionPlanKg)}` : ''} · w planach masowania {fmt(Math.max(0, p.plannedMixingKg - p.plannedMixingThisDayKg) + p.wSzkicuKg)} kg</button>
          {otwarta === p.recipeId && <ul className="pm-zam">{p.orders.map(z => <li key={z.id}><button type="button" className="accent-ink" onClick={() => onZamowienie(z.id)}>{z.orderNo}</button>
            <span className="ell">{z.clientName}</span><span className="tnum">{dataPl(z.deliveryDate)}</span><span className="tnum num">{fmt(z.kg)} kg</span></li>)}</ul>}
        </div>
      ))}
      {brakuje.length === 0 && <div className="note ok"><CheckCheck size={15} /><div><b>Zamówienia mają pokrycie.</b> Stan półproduktu i zaplanowane masowania wystarczą na wszystkie otwarte zamówienia.</div></div>}
      {pokryte.length > 0 && <details className="pm-pokryte"><summary>Pokryte receptury ({pokryte.length})</summary>
        {pokryte.map(p => <div key={p.recipeId} className="pm-pokryta"><span>{p.recipeName}</span><span className="muted tnum">zamówione {fmt(p.orderedKg)} kg</span></div>)}</details>}
    </div>
  )
}

function PartiePanel({ partie, wPlanie, wolne, wybrany, nazwa, b, tylkoPodglad, onLots, onUwagi, onFefo }: {
  partie: PartiaMiesa[]; wPlanie: Map<string, number>; wolne: Map<string, number>; wybrany: Wiersz | null; nazwa: string; b: ReturnType<typeof bilans>; tylkoPodglad: boolean
  onLots: (klucz: string, lots: LotPlanu[]) => void; onUwagi: (klucz: string, uwagi: string) => void; onFefo: (klucz: string) => void
}) {
  const zs = partie.filter(toZs), inne = partie.filter(p => !toZs(p))
  const cel = wybrany ? kgWiersza(wybrany) : 0
  const wybrane = wybrany ? wybrany.lots.reduce((s, l) => s + (l.kgPlanned || 0), 0) : 0
  const przelacz = (p: PartiaMiesa, on: boolean) => {
    if (!wybrany) return
    if (!on) { onLots(wybrany.klucz, wybrany.lots.filter(l => l.meatLotId !== p.id)); return }
    // Dopełnij BRAKUJĄCE kg do pozycji, nie całą pozycję — przy 2200 kg i 854 kg z pierwszej partii druga dostaje 1346.
    const limit = Math.max(0, wolne.get(p.id) ?? p.kgAvailable)
    const brak = Math.max(0, cel - wybrane)
    onLots(wybrany.klucz, [...wybrany.lots, opisz({ meatLotId: p.id, kgPlanned: Math.round(Math.min(limit, brak || limit) * 100) / 100 }, partie)])
  }
  const zmienKg = (p: PartiaMiesa, tekst: string) => {
    if (!wybrany) return
    const wlasne = wybrany.lots.find(l => l.meatLotId === p.id)?.kgPlanned ?? 0
    const limit = Math.max(0, (wolne.get(p.id) ?? p.kgAvailable) + wlasne)
    const v = Math.min(liczba(tekst) || 0, limit)
    onLots(wybrany.klucz, wybrany.lots.map(l => l.meatLotId === p.id ? { ...l, kgPlanned: v } : l))
  }
  const sekcja = (tytul: string, lista: PartiaMiesa[]) => lista.length === 0 ? null : (
    <section>
      <h3 className="pm-h">{tytul}<span className="muted">{lista.length} {lista.length === 1 ? 'partia' : 'partii'} · {fmt(lista.reduce((s, p) => s + p.kgAvailable, 0))} kg</span></h3>
      <table className="tbl pm-partie-tbl"><tbody>{lista.map(p => {
        const plan = wPlanie.get(p.id) ?? 0, zostaje = wolne.get(p.id) ?? p.kgAvailable
        const lot = wybrany?.lots.find(l => l.meatLotId === p.id)
        const pelna = !lot && zostaje <= 0.001
        return (
          <tr key={p.id} className={`row${lot ? ' sel' : ''}${pelna ? ' pm-zajeta' : ''}`}>
            {wybrany && <td className="cb"><input type="checkbox" className="cbx" checked={!!lot} disabled={pelna} onChange={e => przelacz(p, e.target.checked)} aria-label={`Partia ${p.lotNo}`} /></td>}
            <td><b className="code">{p.lotNo}</b><span className="sub">{[toZs(p) ? null : p.materialName, p.supplierName].filter(Boolean).join(' · ') || (toZs(p) ? 'mięso z/s' : '')}</span></td>
            <td className="tnum pm-termin">do {dataPl(p.expiryDate).slice(0, 5)}</td>
            <td className="num tnum" data-tip={plan > 0.001 ? `Pula ${fmt(p.kgAvailable)} kg − w planie ${fmt(plan)} kg = zostaje ${fmt(zostaje)} kg` : `Wolne ${fmt(zostaje)} kg`}>
              {plan > 0.001 && <span className="muted">{fmt(p.kgAvailable)} − {fmt(plan)} = </span>}<b className={zostaje < -0.01 ? 'crit-ink' : undefined}>{fmt(zostaje)}</b> <span className="sub">kg</span></td>
            {wybrany && <td className="num" style={{ width: 84 }}>{lot && <input className="field num" inputMode="decimal" value={String(lot.kgPlanned).replace('.', ',')} aria-label={`Kg z partii ${p.lotNo}`}
              onFocus={e => e.target.select()} onChange={e => zmienKg(p, e.target.value.replace(/[^\d.,]/g, ''))} />}</td>}
          </tr>
        )
      })}</tbody></table>
    </section>
  )
  return (
    <div className="pm-partie-panel">
      {wybrany ? (
        <div className="pm-wybrana">
          <div className="l1"><b>{nazwa || 'Pozycja bez receptury'}</b><span className="tnum">{fmt(cel)} kg mięsa</span></div>
          <div className="pm-pokrycie"><span className="pm-pasek"><i className={wybrane > cel + 0.5 ? 'crit' : wybrane >= cel - 0.5 && cel > 0 ? 'ok' : ''} style={{ width: `${cel > 0 ? Math.min(100, (wybrane / cel) * 100) : 0}%` }} /></span>
            <span className="tnum">{fmt(wybrane)} / {fmt(cel)} kg</span>
            <button className="btn sm" onClick={() => onFefo(wybrany.klucz)} disabled={!(cel > 0)} data-tip="Dobierz mięso z/s od najkrótszego terminu"><Zap size={14} />FEFO</button></div>
          <label className="fld"><span className="label">Uwaga dla operatora (na wydruk)</span>
            <input className="field" value={wybrany.uwagi} maxLength={300} onChange={e => onUwagi(wybrany.klucz, e.target.value)} placeholder="np. najpierw wsad 600, filet osobno" aria-label="Uwaga dla operatora" /></label>
        </div>
      ) : !tylkoPodglad ? <p className="pm-opis muted">Kliknij pozycję planu, żeby dobrać do niej partie. Poniżej cała pula mięsa na ten dzień z saldem na żywo.</p> : null}
      {!tylkoPodglad && <div className="pm-bilans"><div><span className="k">Wolne z/s</span><span className="v">{fmt(b.pulaZs)}</span></div><div><span className="k">Potrzeba planu</span><span className="v">{fmt(b.potrzebaZs)}</span></div>
        <div className={b.zostanieZs < -0.5 ? 'crit' : ''}><span className="k">Zostanie</span><span className="v">{fmt(b.zostanieZs)}</span></div></div>}
      {!tylkoPodglad && b.zostanieZs < -0.5 && <div className="note crit"><FlagIcon level="crit" size={15} /><div>Plan potrzebuje {fmt(-b.zostanieZs)} kg mięsa z/s więcej, niż jest wolne. Zmniejsz pozycje albo poczekaj na rozbiór.</div></div>}
      {partie.length === 0 ? <Pusto ikona={<Beef size={20} />} tytul="Brak wolnego mięsa">Mięso pojawi się po rozbiorze albo przyjęciu.</Pusto> : <>
        {sekcja('Mięso z/s', zs)}
        {sekcja('Filet i inne — dobierane ręcznie', inne)}
      </>}
    </div>
  )
}

function PrzyprawyPanel({ lista }: { lista: Przyprawa[] }) {
  const liczone = lista.filter(p => !p.bezStanu), braki = liczone.filter(p => p.brak > 0.0005)
  if (!lista.length) return <Pusto ikona={<FlaskConical size={20} />} tytul="Plan jest pusty">Dodaj pozycje, żeby zobaczyć, ile przypraw trzeba przygotować.</Pusto>
  return (
    <div className="pm-przyprawy">
      {braki.length > 0 ? <div className="note crit"><FlagIcon level="crit" size={15} /><div><b>Brakuje {braki.length === 1 ? 'jednej przyprawy' : `${braki.length} przypraw`}</b> na niewykonaną część planu — zamów albo przyjmij przed masowaniem.</div></div>
        : <p className="pm-opis muted">Przyprawy na niewykonaną część planu, w kolejności receptur. Stan z magazynu przypraw i dodatków.</p>}
      <table className="tbl pm-partie-tbl">
        <thead><tr><th>Składnik</th><th className="num">Potrzeba</th><th className="num">Na stanie</th></tr></thead>
        <tbody>{lista.map(p => (
          <tr key={p.ingredientId} className="row">
            <td>{p.brak > 0.0005 ? <b className="crit-ink">{p.nazwa}</b> : p.nazwa}{p.brak > 0.0005 && <span className="sub crit-ink">brakuje {fmt2(p.brak)} {p.jedn}</span>}</td>
            <td className="num tnum"><b>{fmt2(p.potrzeba)}</b> <span className="sub">{p.jedn}</span></td>
            <td className="num tnum">{p.bezStanu ? <span className="faint">bez stanu</span> : p.stan == null ? '…' : <>{fmt2(p.stan)} <span className="sub">{p.jedn}</span></>}</td>
          </tr>))}</tbody>
      </table>
    </div>
  )
}
