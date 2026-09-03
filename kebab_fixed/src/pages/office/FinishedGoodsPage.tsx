/**
 * FinishedGoodsPage — Magazyn wyrobów gotowych (lista, styl Subiekt GT).
 *
 * Gęsta tabela z stickyheader, sortowaniem i szybkim filtrem. Klik wiersza
 * → modal ze szczegółami per SKU + rozbiciem wg partii + łańcuchem traceability.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { useClientNames } from '@/lib/clientNames'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { CopyButton } from '@/features/finished-goods/components/CopyButton'
import {
  Eye, Search, ChevronDown, ChevronUp, ChevronsUpDown, X, Download, ShoppingBag, Plus, Printer,
} from 'lucide-react'
import type { FinishedGoodsItem } from '@/lib/mockApi'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'
import { DetailModal } from '@/features/finished-goods/components/DetailModal'
import { OfficeUnitLookup } from '@/features/finished-goods/components/OfficeUnitLookup'
import { StockCartonModal } from '@/features/finished-goods/components/StockCartonModal'
import { AddFinishedGoodModal } from '@/features/finished-goods/components/AddFinishedGoodModal'
import { dopasujTowar, pasujeOpcja, unikalneOpcje } from '@/features/finished-goods/finishedGoodsSearch'
import {
  dataFefo, ograniczIlosc, podsumowanieZaznaczenia, przydzialNaMape,
  rozpiszNaPartie, sumaPrzydzialu,
} from '@/features/finished-goods/finishedGoodsSelection'
import { PackedCartonsSection } from '@/features/finished-goods/components/PackedCartonsSection'

// ─── Grupowanie po SKU (łączymy partie/daty w jeden wiersz magazynu) ──────────
export interface SkuGroup {
  key: string
  productTypeName: string
  recipeName: string
  packagingName: string
  clientName: string
  kgPerUnit: number
  qty: number
  totalKg: number
  batches: FinishedGoodsItem[]
}

export function groupBySku(
  items: FinishedGoodsItem[],
  // Nazwa klienta, jaką WIDAĆ na ekranie (skrót z kartoteki). Dwie różne
  // pełne nazwy ze wspólnym skrótem („ISSA …" + „ISSA …" → „ISSA") to na
  // magazynie jeden klient — klucz po pełnej nazwie robił dwa identyczne
  // wiersze (YALCIN 20×30 + 10×30, 09.2026). Domyślnie tożsamość (testy).
  wyswietlKlienta: (pelna: string) => string = (s) => s,
): SkuGroup[] {
  const map = new Map<string, SkuGroup>()
  // Klucz po NAZWACH (znormalizowanych), nie po ID.
  //
  // RODZAJ jest częścią SKU, nie ozdobą: KEBAB UDO 100% i KEBAB MIX 95/5 mają
  // ten sam przepis, tuleję, klienta i wagę, a różnią się składem mięsa, ceną
  // i deklaracją dla klienta. Bez rodzaju w kluczu magazyn pokazywał jeden
  // wiersz „Truva 25 kg" na 98 sztuk z rodzajem tego wiersza, który akurat
  // wpadł pierwszy — stan, którego nie ma na regale (produkcja 28.08.2026).
  //
  // ID celowo NIE biorą udziału: ten sam widoczny towar wpada raz z ID
  // (plan, tablet), raz bez (wpis ręczny „Dodaj wyrób"), a w kartotekach
  // bywają duplikaty o identycznych nazwach — i robiły się dwa wiersze
  // „tego samego" (YALCIN 30 kg KIRMIZI, 09.2026). Skoro nazwy, klient
  // i waga są identyczne, ekran nie odróżni tych pozycji tak czy owak,
  // więc pokazuje je jako jedną.
  const norm = (s?: string) => (s ?? '').trim().toLowerCase()
  for (const it of items) {
    const key = [
      norm(it.productTypeName),
      norm(it.recipeName),
      norm(it.packagingName),
      norm(wyswietlKlienta(it.clientName || '') || ''),
      Math.round(Number(it.kgPerUnit) * 1000),
    ].join('|')
    let g = map.get(key)
    if (!g) {
      g = { key, productTypeName: it.productTypeName, recipeName: it.recipeName,
            packagingName: it.packagingName, clientName: it.clientName,
            kgPerUnit: it.kgPerUnit, qty: 0, totalKg: 0, batches: [] }
      map.set(key, g)
    }
    // Wyświetlane nazwy: pierwsza niepusta wartość z grupy
    if (!g.productTypeName && it.productTypeName) g.productTypeName = it.productTypeName
    if (!g.packagingName && it.packagingName)     g.packagingName   = it.packagingName
    if (!g.clientName && it.clientName)           g.clientName      = it.clientName
    g.qty += it.qtyAvailable
    g.totalKg += it.qtyAvailable * it.kgPerUnit
    g.batches.push(it)
  }
  // Partie w podglądzie: najstarsza data produkcji pierwsza (FEFO)
  for (const g of map.values()) {
    g.batches.sort((a, b) => (a.producedDate || '').localeCompare(b.producedDate || ''))
  }
  return [...map.values()]
}

// ─── Sort ────────────────────────────────────────────────────
type SortCol =
  | 'qty' | 'kgPerUnit' | 'totalKg'
  | 'productTypeName' | 'recipeName' | 'packagingName' | 'clientName'

function compareRows(col: SortCol) {
  return (a: SkuGroup, b: SkuGroup) => {
    switch (col) {
      case 'qty':             return a.qty - b.qty
      case 'kgPerUnit':       return a.kgPerUnit - b.kgPerUnit
      case 'totalKg':         return a.totalKg - b.totalKg
      case 'productTypeName': return (a.productTypeName || '').localeCompare(b.productTypeName || '')
      case 'recipeName':      return (a.recipeName      || '').localeCompare(b.recipeName      || '')
      case 'packagingName':   return (a.packagingName   || '').localeCompare(b.packagingName   || '')
      case 'clientName':      return (a.clientName      || '').localeCompare(b.clientName      || '')
    }
  }
}

// ─── CSV export ──────────────────────────────────────────────
function exportCsv(rows: SkuGroup[]) {
  const headers = ['Rodzaj', 'Receptura', 'Tuleja', 'Klient', 'kg/szt', 'Ilość (szt)', 'Razem kg', 'Partie']
  const csv = [headers.join(';')]
    .concat(rows.map(g => [
      g.productTypeName || '',
      g.recipeName || '',
      g.packagingName || '',
      g.clientName || '',
      String(g.kgPerUnit).replace('.', ','),
      g.qty,
      String(g.totalKg).replace('.', ','),
      g.batches.map(b => b.batchNo || '').filter(Boolean).join(' / '),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')))
    .join('\n')
  const blob = new Blob([new TextEncoder().encode('﻿' + csv)], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  const today = new Date().toISOString().slice(0, 10)
  a.href = url
  a.download = `magazyn-wyrobow-gotowych-${today}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

// ─── Chip aktywnego filtra (kasowanie jednym klikiem) ───────
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      title={`Usuń filtr: ${label}`}
      className="inline-flex items-center gap-1 rounded-full border border-ink-4 bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-surface-3/60"
    >
      <span className="max-w-48 truncate">{label}</span>
      <X size={11} />
    </button>
  )
}

// ─── Strona ─────────────────────────────────────────────────
export function FinishedGoodsPage() {
  const navigate = useNavigate()
  const clientDisplay = useClientNames()
  const { data: items, loading, refetch } = useApi(() => finishedGoodsApi.list())
  const [dodawanie, setDodawanie] = useState(false)
  const [detailGroup, setDetailGroup] = useState<SkuGroup | null>(null)
  const [cartonRefresh, setCartonRefresh] = useState(0)
  const [filter,   setFilter]   = useState('')
  const [klient,   setKlient]   = useState('')
  const [produkt,  setProdukt]  = useState('')
  const [receptura, setReceptura] = useState('')
  const [odDaty,   setOdDaty]   = useState('')
  const [doDaty,   setDoDaty]   = useState('')
  // Gęstość wierszy (hala: zwarty, biuro: wygodny). Pamiętana w przeglądarce.
  const [gestosc, setGestosc] = useState<'zwarty' | 'wygodny'>(() => {
    try { return localStorage.getItem('wg-gestosc') === 'wygodny' ? 'wygodny' : 'zwarty' }
    catch { return 'zwarty' }
  })
  useEffect(() => {
    try { localStorage.setItem('wg-gestosc', gestosc) } catch { /* tryb prywatny */ }
  }, [gestosc])
  const zwarty = gestosc === 'zwarty'
  const [sortCol,  setSortCol]  = useState<SortCol>('productTypeName')
  const [sortDir,  setSortDir]  = useState<'asc' | 'desc'>('asc')
  /** key SKU → { id partii: sztuki }. Brak wpisu = pozycja niezaznaczona.
   *  Trzymamy PER PARTIA, bo FEFO tylko proponuje — magazynier może wziąć
   *  z innej partii, jeśli tak stoi w chłodni. */
  const [wybor,    setWybor]    = useState<Record<string, Record<string, number>>>({})
  const [rozwiniete, setRozwiniete] = useState<Record<string, boolean>>({})

  const rawList = items ?? []
  // Wszystkie grupy (nie tylko przefiltrowane) — zaznaczenie ma przeżyć
  // zawężenie filtra, inaczej wpisanie litery gubi koszyk.
  const allGroupsRef = useRef<SkuGroup[]>([])
  allGroupsRef.current = useMemo(() => groupBySku(rawList, clientDisplay), [rawList, clientDisplay])

  // Opcje selectów z CAŁEGO magazynu (nie zawężają się podczas pisania).
  // Warianty nazw („Truva", „TRUVA ") schodzą się do jednej pozycji.
  // Klientów kluczymy po NAZWIE WYŚWIETLANEJ (skrót z kartoteki), nie po
  // pełnej z KRS — dwie różne pełne nazwy ze wspólnym skrótem („ISSA …"
  // + „ISSA …") dublowały się na liście, choć na ekranie widać je tak samo.
  const klienci = useMemo(
    () => unikalneOpcje(rawList.map(i => clientDisplay(i.clientName || ''))),
    [rawList, clientDisplay])
  const produkty = useMemo(
    () => unikalneOpcje(rawList.map(i => i.productTypeName)), [rawList])
  const receptury = useMemo(
    () => unikalneOpcje(rawList.map(i => i.recipeName)), [rawList])
  const klientEtykieta = klienci.find(o => o.klucz === klient)?.etykieta || ''
  const produktEtykieta = produkty.find(o => o.klucz === produkt)?.etykieta || ''
  const recepturaEtykieta = receptury.find(o => o.klucz === receptura)?.etykieta || ''

  const aktywneFiltry =
    (klient ? 1 : 0) + (produkt ? 1 : 0) + (receptura ? 1 : 0) + (odDaty ? 1 : 0) + (doDaty ? 1 : 0)

  // Opis do nagłówka wydruku i czytelnego podsumowania.
  const opisFiltrow = [
    filter.trim() && `szukaj: „${filter.trim()}”`,
    klient && `klient: ${klientEtykieta || klient}`,
    produkt && `rodzaj: ${produktEtykieta || produkt}`,
    receptura && `receptura: ${recepturaEtykieta || receptura}`,
    odDaty && `prod. od ${fmtDatePl(odDaty)}`,
    doDaty && `prod. do ${fmtDatePl(doDaty)}`,
  ].filter(Boolean).join(' · ') || 'brak'

  const wyczyscFiltry = () => {
    setFilter('')
    setKlient('')
    setProdukt('')
    setReceptura('')
    setOdDaty('')
    setDoDaty('')
  }

  const list = useMemo(() => {
    // Wyszukiwarka: każde SŁOWO musi trafić w jakiekolwiek pole. Dawny filtr
    // robił includes na całej frazie naraz, więc „kirmizi 30" nie znajdowało
    // nic. Szuka też po SKRÓCONEJ nazwie klienta — tej, którą widać na ekranie.
    const result = groupBySku(rawList, clientDisplay)
      .filter(g => g.qty > 0)
      .filter(g => dopasujTowar(g, filter, clientDisplay))
      .filter(g => pasujeOpcja(clientDisplay(g.clientName || ''), klient))
      .filter(g => pasujeOpcja(g.productTypeName, produkt))
      .filter(g => pasujeOpcja(g.recipeName, receptura))
      // Zakres dat trzyma pozycje, które mają KTÓRĄKOLWIEK partię
      // wyprodukowaną w zakresie — tak samo jak szukajka tekstowa trzyma
      // całą pozycję po trafieniu w jedną partię. Ilości w wierszu i stopce
      // to nadal pełne stany SKU, nie przycięte do zakresu.
      .filter(g => {
        if (!odDaty && !doDaty) return true
        return g.batches.some(b => {
          const d = (b.producedDate || '').slice(0, 10)
          return d && (!odDaty || d >= odDaty) && (!doDaty || d <= doDaty)
        })
      })
    const cmp = compareRows(sortCol)
    return [...result].sort((a, b) => sortDir === 'asc' ? cmp(a, b) : -cmp(a, b))
  }, [rawList, filter, klient, produkt, receptura, odDaty, doDaty, sortCol, sortDir, clientDisplay])

  /** Suma zaznaczenia dla paska akcji. Liczona z AKTUALNEJ listy, więc
   *  zawężenie filtra nie gubi tego, co zaznaczono gdzie indziej. */
  const podsumZaznaczenia = useMemo(() => podsumowanieZaznaczenia(
    allGroupsRef.current
      .filter(g => wybor[g.key] !== undefined)
      .map(g => ({ towar: g, ilosc: sumaPrzydzialu(wybor[g.key]) }))),
  [wybor])

  /** Zaznaczone pozycje → okno WZ z gotowym koszykiem.
   *
   *  Adresem, tym samym wzorcem co „Wystaw WZ z zaznaczonych" w Magazynie
   *  surowca (`?stock=`) — jeden mechanizm na oba magazyny zamiast dwóch.
   *  Okno WZ operuje POZYCJAMI MAGAZYNOWYMI, więc zaznaczoną ilość
   *  rozpisujemy tutaj na konkretne partie wg FEFO. */
  const wystawWz = () => {
    const pary = Object.values(wybor)
      .flatMap(mapa => Object.entries(mapa))
      .filter(([, szt]) => szt > 0)
      .map(([id, szt]) => `${id}:${szt}`)
    if (!pary.length) return
    navigate(`/office/wz/nowy?fg=${pary.join(',')}`)
  }

  const totalQty = list.reduce((s, g) => s + g.qty, 0)
  const totalKg  = list.reduce((s, g) => s + g.totalKg, 0)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

  const allGroups = allGroupsRef.current

  return (
    <div className="space-y-3 animate-fade-in">

      {/* ── Toolbar (nie drukujemy — na papierze tylko tabela) ── */}
      <Card className="print:hidden">
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 min-w-0 max-w-md">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-9 pl-9 pr-8 text-sm"
                placeholder="Szukaj: klient, receptura, rodzaj, tuleja, kg, partia, nr zamówienia…"
                value={filter}
                onChange={e => setFilter(e.target.value)}
                autoFocus
              />
              {filter && (
                <button
                  onClick={() => setFilter('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink"
                  title="Wyczyść"
                >
                  <X size={14}/>
                </button>
              )}
            </div>
            {/* Akcje drugorzędne trzymają się razem przy zawijaniu paska. */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {/* Wyszukiwarka pojedynczej sztuki po QR — lokalizacja kebaba */}
              <OfficeUnitLookup />
              {/* Karton magazynowy „z ręki" */}
              <StockCartonModal onCreated={() => { refetch(); setCartonRefresh(k => k + 1) }} />
              {/* Ręczne dodanie wyrobu — dopóki produkcja i masownia nie mają
                  komputerów, tędy wchodzi cała produkcja dnia. */}
              <button
                type="button"
                data-testid="dodaj-wyrob"
                onClick={() => setDodawanie(true)}
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground whitespace-nowrap"
              >
                <Plus size={14}/> Dodaj wyrób
              </button>
            </div>
          </div>

          {/* Inline KPI — kompaktowe, magazynowo (Subiekt GT style) */}
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Pozycji:</CardDescription>
              <span className="font-bold">
                {list.length}
                {list.length !== allGroups.length && (
                  <span className="text-muted-foreground">/{allGroups.length}</span>
                )}
              </span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Szt:</CardDescription>
              <span className="font-bold">{totalQty}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Kg:</CardDescription>
              <span className="font-bold text-emerald-700">{fmtKg(totalKg, 0)}</span>
            </div>
            <div className="w-px h-4 bg-surface-4" />
          </div>
        </div>

        {/* ── Wiersz filtrów ──────────────────────────────── */}
        <div className="px-4 py-2 border-t border-surface-3 flex items-center gap-2 flex-wrap">
          <select
            aria-label="Filtr klienta"
            title={klientEtykieta || 'Klient: wszyscy'}
            className="h-8 text-xs border border-ink-4 rounded-md px-2 bg-white max-w-48"
            value={klient}
            onChange={e => setKlient(e.target.value)}
          >
            <option value="">Klient: wszyscy</option>
            {klienci.map(o => (
              <option key={o.klucz} value={o.klucz}>{o.etykieta}</option>
            ))}
          </select>
          <select
            aria-label="Filtr rodzaju"
            title={produktEtykieta || 'Rodzaj: wszystkie'}
            className="h-8 text-xs border border-ink-4 rounded-md px-2 bg-white max-w-48"
            value={produkt}
            onChange={e => setProdukt(e.target.value)}
          >
            <option value="">Rodzaj: wszystkie</option>
            {produkty.map(o => <option key={o.klucz} value={o.klucz}>{o.etykieta}</option>)}
          </select>
          <select
            aria-label="Filtr receptury"
            title={recepturaEtykieta || 'Receptura: wszystkie'}
            className="h-8 text-xs border border-ink-4 rounded-md px-2 bg-white max-w-48"
            value={receptura}
            onChange={e => setReceptura(e.target.value)}
          >
            <option value="">Receptura: wszystkie</option>
            {receptury.map(o => <option key={o.klucz} value={o.klucz}>{o.etykieta}</option>)}
          </select>
          <label className="flex items-center gap-1 text-xs text-ink-2">
            prod. od
            <input
              type="date"
              aria-label="Data produkcji od"
              className="h-8 text-xs border border-ink-4 rounded-md px-1.5 bg-white"
              value={odDaty}
              onChange={e => setOdDaty(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1 text-xs text-ink-2">
            do
            <input
              type="date"
              aria-label="Data produkcji do"
              className="h-8 text-xs border border-ink-4 rounded-md px-1.5 bg-white"
              value={doDaty}
              onChange={e => setDoDaty(e.target.value)}
            />
          </label>
          <div className="flex items-center rounded-md border border-ink-4 overflow-hidden" role="group" aria-label="Gęstość wierszy">
            <button
              type="button"
              onClick={() => setGestosc('zwarty')}
              aria-pressed={zwarty}
              title="Wiersze zwarte (hala)"
              className={cn('px-2.5 h-8 text-xs font-bold', zwarty ? 'bg-black text-white' : 'text-ink-2 hover:bg-surface-3/60')}
            >
              Zwarty
            </button>
            <button
              type="button"
              onClick={() => setGestosc('wygodny')}
              aria-pressed={!zwarty}
              title="Wiersze wygodne (biuro)"
              className={cn('px-2.5 h-8 text-xs font-bold', !zwarty ? 'bg-black text-white' : 'text-ink-2 hover:bg-surface-3/60')}
            >
              Wygodny
            </button>
          </div>
          <button
            type="button"
            onClick={() => window.print()}
            title="Wydrukuj aktualny stan listy"
            className="flex items-center gap-1.5 rounded-md border border-ink-4 px-3 h-8 text-xs font-bold hover:bg-surface-3/60 whitespace-nowrap"
          >
            <Printer size={13} /> Drukuj
          </button>
        </div>

        {/* ── Pasek aktywnych filtrów ─────────────────────── */}
        {(filter.trim() || aktywneFiltry > 0) && (
          <div className="px-4 py-1.5 border-t border-surface-3 flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              {list.length} z {allGroups.length} pozycji
            </span>
            {filter.trim() && <Chip label={`Szukaj: ${filter.trim()}`} onClear={() => setFilter('')} />}
            {klient && <Chip label={klientEtykieta || klient} onClear={() => setKlient('')} />}
            {produkt && <Chip label={produktEtykieta || produkt} onClear={() => setProdukt('')} />}
            {receptura && <Chip label={recepturaEtykieta || receptura} onClear={() => setReceptura('')} />}
            {odDaty && <Chip label={`od ${fmtDatePl(odDaty)}`} onClear={() => setOdDaty('')} />}
            {doDaty && <Chip label={`do ${fmtDatePl(doDaty)}`} onClear={() => setDoDaty('')} />}
            <button
              type="button"
              onClick={wyczyscFiltry}
              className="text-[11px] font-bold underline underline-offset-2 text-ink-2 hover:text-ink"
            >
              Wyczyść wszystko
            </button>
          </div>
        )}
      </Card>

      {/* ── Pasek zaznaczenia ───────────────────────────
          Widoczny dopiero, gdy coś zaznaczono — pusty pasek zabierałby
          miejsce listy, a to ona jest tu najważniejsza. */}
      {podsumZaznaczenia.pozycji > 0 && (
        <Card className="border-ink bg-surface-2 print:hidden">
          <div className="px-4 py-2.5 flex items-center justify-between gap-4 flex-wrap">
            <div className="text-sm tabular-nums">
              <strong>{podsumZaznaczenia.pozycji}</strong> poz. ·{' '}
              <strong>{podsumZaznaczenia.sztuk}</strong> szt ·{' '}
              <strong>{fmtKg(podsumZaznaczenia.kg, 0)}</strong> kg
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setWybor({})}
                className="rounded-md border border-ink-5 px-3 py-1.5 text-xs font-bold"
              >
                Wyczyść zaznaczenie
              </button>
              <button
                type="button"
                data-testid="wystaw-wz"
                onClick={wystawWz}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
              >
                Wystaw WZ
              </button>
            </div>
          </div>
        </Card>
      )}

      {/* ── Tabela ─────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {/* Nagłówek wydruku — tylko na papierze. */}
        <div className="hidden print:block px-4 py-3 border-b border-black">
          <div className="text-sm font-bold">
            Magazyn wyrobów gotowych — stan na {new Date().toLocaleDateString('pl-PL')}
          </div>
          <div className="text-xs text-gray-700">
            Filtry: {opisFiltrow} · Pozycji: {list.length} · Szt: {totalQty} · Kg: {fmtKg(totalKg, 0)}
          </div>
        </div>
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <ShoppingBag size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak wyrobów gotowych</CardTitle>
            <CardDescription>Wyroby pojawią się po potwierdzeniu produkcji przez biuro.</CardDescription>
          </CardContent>
        ) : list.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-10 gap-2">
            <Search size={28} className="text-muted-foreground opacity-20" />
            <CardDescription>
              {filter.trim()
                ? <>Brak wyników dla „{filter.trim()}”</>
                : 'Brak wyników dla aktywnych filtrów'}
            </CardDescription>
            {(filter || aktywneFiltry > 0) && (
              <button
                type="button"
                onClick={wyczyscFiltry}
                className="mt-1 rounded-md border border-ink-5 px-3 py-1.5 text-xs font-bold hover:bg-surface-3/60"
              >
                Wyczyść filtry
              </button>
            )}
          </CardContent>
        ) : (
          <div className={cn('overflow-auto max-h-[calc(100vh-12rem)] print:max-h-none print:overflow-visible', !zwarty && 'wg-wygodny')}>
            {!zwarty && (
              <style>{'.wg-wygodny tbody td{padding-top:.8rem;padding-bottom:.8rem}.wg-wygodny thead th{padding-top:.7rem;padding-bottom:.7rem}.wg-wygodny table{font-size:13px}'}</style>
            )}
            <table className="w-full text-xs tabular-nums print:text-black">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4 print:bg-white">
                <tr>
                  <th className="w-8 px-2 print:hidden" aria-hidden="true" />
                  {[
                    { col: 'qty'             as SortCol, label: 'Ilość',     align: 'right' },
                    { col: 'kgPerUnit'       as SortCol, label: 'kg',        align: 'right' },
                    { col: 'productTypeName' as SortCol, label: 'Rodzaj',    align: 'left'  },
                    { col: 'recipeName'      as SortCol, label: 'Receptura', align: 'left'  },
                    { col: 'packagingName'   as SortCol, label: 'Tuleja',    align: 'left'  },
                    { col: 'clientName'      as SortCol, label: 'Klient',    align: 'left'  },
                    { col: 'totalKg'         as SortCol, label: 'Razem kg',  align: 'right' },
                  ].map(h => (
                    <th
                      key={h.col}
                      aria-sort={sortCol === h.col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                      className={cn(
                        'group select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 whitespace-nowrap print:text-black print:bg-white',
                        h.align === 'right' && 'text-right',
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(h.col)}
                        aria-label={`Sortuj: ${h.label}`}
                        className={cn('inline-flex items-center gap-1 uppercase tracking-wider hover:text-ink cursor-pointer', h.align === 'right' && 'flex-row-reverse')}
                      >
                        {h.label}
                        <SortIcon col={h.col} />
                      </button>
                    </th>
                  ))}
                  <th className="w-8 print:hidden" aria-hidden="true" />
                </tr>
              </thead>
              <tbody>
                {list.flatMap((g, idx) => [
                  (
                  <tr
                    key={g.key}
                    onClick={() => setDetailGroup(g)}
                    className={cn(
                      'cursor-pointer border-b border-surface-3 transition-colors print:bg-white',
                      idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                      'hover:bg-surface-3/60'
                    )}
                  >
                    <td className="px-2 py-2 print:hidden" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Zaznacz ${g.productTypeName} ${g.recipeName} ${g.kgPerUnit}kg`}
                        checked={wybor[g.key] !== undefined}
                        disabled={g.qty <= 0}
                        onChange={e => setWybor(w => {
                          const n = { ...w }
                          // Zaznaczenie bierze CAŁY stan (także spod zamówień —
                          // zamówienie rezerwuje towar, ale NIE blokuje WZ),
                          // rozpisany FEFO. To tylko PROPOZYCJA, partie da się
                          // poprawić po rozwinięciu wiersza.
                          if (e.target.checked) {
                            n[g.key] = przydzialNaMape(
                              rozpiszNaPartie(g as any, g.qty, 'wszystkie'))
                            setRozwiniete(r => ({ ...r, [g.key]: true }))
                          } else delete n[g.key]
                          return n
                        })}
                      />
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold">
                      {wybor[g.key] !== undefined ? (
                        <button
                          type="button"
                          onClick={e => { e.stopPropagation(); setRozwiniete(r => ({ ...r, [g.key]: !r[g.key] })) }}
                          className="rounded border border-ink px-1.5 py-0.5 font-bold tabular-nums"
                          title="Rozwiń, żeby poprawić partie"
                        >
                          {sumaPrzydzialu(wybor[g.key])} z {g.qty}
                        </button>
                      ) : g.qty}
                      <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                      {/* Kolumna pokazuje CAŁY stan (właściciel, 02.09.2026):
                          magazyn ma odpowiadać na pytanie „ile tego mam", a nie
                          „ile mogę zabrać". */}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-right text-ink-2">
                      {g.kgPerUnit}<span className="text-muted-foreground font-normal text-[11px]"> kg</span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink">
                      {g.productTypeName || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[200px] truncate" title={g.recipeName}>
                      {g.recipeName || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2">
                      {g.packagingName || <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-ink-2 max-w-[220px]">
                      {g.clientName ? (
                        <span className="truncate inline-block max-w-full align-bottom" title={g.clientName}>
                          {clientDisplay(g.clientName)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-right font-bold text-emerald-700">
                      {fmtKg(g.totalKg, 0)}<span className="font-normal text-[11px]"> kg</span>
                    </td>
                    <td className="px-2 py-2 text-right print:hidden">
                      <button
                        onClick={(e) => { e.stopPropagation(); setDetailGroup(g) }}
                        className="inline-flex items-center justify-center w-6 h-6 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                        title="Szczegóły / łańcuch partii"
                      >
                        <Eye size={13} />
                      </button>
                    </td>
                  </tr>
                  ),
                  /* Rozwinięcie: partie tej pozycji z ilościami wypełnionymi
                     przez FEFO. Magazynier poprawia je ręcznie, gdy w chłodni
                     wygodniej sięgnąć po inną partię — automat ma proponować,
                     nie decydować. */
                  wybor[g.key] !== undefined && rozwiniete[g.key] && (
                  <tr key={`${g.key}-partie`} className="bg-surface-2/60 print:hidden">
                    <td />
                    <td colSpan={8} className="px-2.5 py-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                        Partie — poprawiaj, jeśli bierzesz z innej
                      </div>
                      <div className="space-y-1">
                        {[...g.batches]
                          // Wszystkie partie ze stanem — także spod zamówień:
                          // zamówienie nie blokuje WZ, magazynier widzi i poprawia pełny rozkład.
                          .filter(b => Math.floor(Number(b.qtyAvailable ?? 0)) > 0)
                          .sort((a, b) => (dataFefo(a) || '~').localeCompare(dataFefo(b) || '~'))
                          .map(b => (
                          <div key={b.id} className="flex items-center gap-2 text-xs">
                            <span className="font-mono font-bold w-32">{b.batchNo || '—'}</span>
                            {b.batchNo && (
                              <CopyButton text={b.batchNo} title={`Kopiuj partię ${b.batchNo}`} className="w-5 h-5" />
                            )}
                            <span className="text-ink-3 w-28">
                              {dataFefo(b) ? `prod. ${dataFefo(b)}` : 'bez daty'}
                            </span>
                            <span className="text-ink-3 w-20 text-right">{b.qtyAvailable} szt</span>
                            <input
                              type="text"
                              inputMode="numeric"
                              aria-label={`Sztuki z partii ${b.batchNo}`}
                              value={wybor[g.key]?.[b.id] ?? 0}
                              onClick={e => e.stopPropagation()}
                              onChange={e => {
                                const v = ograniczIlosc(
                                  Number(e.target.value.replace(/[^0-9]/g, '')),
                                  Number(b.qtyAvailable || 0))
                                setWybor(w => ({ ...w, [g.key]: { ...w[g.key], [b.id]: v } }))
                              }}
                              className="w-16 rounded border border-ink-5 px-1 py-0.5 text-right font-bold tabular-nums"
                            />
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                  )]
                )}
              </tbody>
              <tfoot className="sticky bottom-0 bg-surface-2/95 backdrop-blur-sm border-t-2 border-surface-4">
                <tr>
                  <td className="px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2">
                    Suma · {list.length} {list.length === 1 ? 'pozycja' : 'pozycji'}
                  </td>
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-ink">
                    {totalQty}
                    <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                  </td>
                  <td colSpan={4} />
                  <td className="px-2.5 py-2 text-right font-bold tabular-nums text-emerald-700">
                    {fmtKg(totalKg, 0)} kg
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>

      {/* Spakowane kebaby — lista utworzonych kartonów ze statusem.
          Na wydruku tylko stan magazynu. */}
      <div className="print:hidden">
        <PackedCartonsSection refreshKey={cartonRefresh} />
      </div>

      {detailGroup && <DetailModal group={detailGroup} onClose={() => setDetailGroup(null)}
                                   onChanged={() => refetch()} />}
      {dodawanie && (
        <AddFinishedGoodModal onClose={() => setDodawanie(false)} onSaved={() => refetch()} />
      )}
    </div>
  )
}
