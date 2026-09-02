/**
 * FinishedGoodsPage — Magazyn wyrobów gotowych (lista, styl Subiekt GT).
 *
 * Gęsta tabela z stickyheader, sortowaniem i szybkim filtrem. Klik wiersza
 * → modal ze szczegółami per SKU + rozbiciem wg partii + łańcuchem traceability.
 */
import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { finishedGoodsApi } from '@/lib/apiClient'
import { useClientNames } from '@/lib/clientNames'
import { fmtKg, cn } from '@/lib/utils'
import {
  Eye, Search, ChevronDown, ChevronUp, ChevronsUpDown, X, Download, ShoppingBag, Plus,
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
import { dopasujTowar } from '@/features/finished-goods/finishedGoodsSearch'
import {
  dataFefo, ograniczIlosc, podsumowanieZaznaczenia, podzialStanu, przydzialNaMape,
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

export function groupBySku(items: FinishedGoodsItem[]): SkuGroup[] {
  const map = new Map<string, SkuGroup>()
  // Klucz po ID (rodzaj, receptura, tuleja) + znormalizowanym kliencie i wadze —
  // klucz po nazwach dublował pozycje przy różnicach w pustych polach /
  // wielkości liter (np. dwa wiersze „Zagros 20×40 kg" zamiast jednego).
  //
  // RODZAJ jest częścią SKU, nie ozdobą: KEBAB UDO 100% i KEBAB MIX 95/5 mają
  // ten sam przepis, tuleję, klienta i wagę, a różnią się składem mięsa, ceną
  // i deklaracją dla klienta. Bez niego w kluczu magazyn pokazywał jeden wiersz
  // „Truva 25 kg" na 98 sztuk z rodzajem tego wiersza, który akurat wpadł
  // pierwszy — stan, którego nie ma na regale (zgłoszone z produkcji 28.08.2026).
  const norm = (s?: string) => (s ?? '').trim().toLowerCase()
  for (const it of items) {
    const key = [
      it.productTypeId || norm(it.productTypeName),
      it.recipeId || norm(it.recipeName),
      it.packagingId || norm(it.packagingName),
      norm(it.clientName),
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

// ─── Strona ─────────────────────────────────────────────────
export function FinishedGoodsPage() {
  const navigate = useNavigate()
  const clientDisplay = useClientNames()
  const { data: items, loading, refetch } = useApi(() => finishedGoodsApi.list())
  const [dodawanie, setDodawanie] = useState(false)
  const [detailGroup, setDetailGroup] = useState<SkuGroup | null>(null)
  const [cartonRefresh, setCartonRefresh] = useState(0)
  const [filter,   setFilter]   = useState('')
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
  allGroupsRef.current = useMemo(() => groupBySku(rawList), [rawList])

  const list = useMemo(() => {
    // Wyszukiwarka: każde SŁOWO musi trafić w jakiekolwiek pole. Dawny filtr
    // robił includes na całej frazie naraz, więc „kirmizi 30" nie znajdowało
    // nic. Szuka też po SKRÓCONEJ nazwie klienta — tej, którą widać na ekranie.
    const result = groupBySku(rawList)
      .filter(g => g.qty > 0)
      .filter(g => dopasujTowar(g, filter, clientDisplay))
    const cmp = compareRows(sortCol)
    return [...result].sort((a, b) => sortDir === 'asc' ? cmp(a, b) : -cmp(a, b))
  }, [rawList, filter, sortCol, sortDir, clientDisplay])

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

      {/* ── Toolbar ─────────────────────────────────────── */}
      <Card>
        <div className="px-4 py-2.5 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-1 min-w-[260px]">
            <div className="relative flex-1 max-w-md">
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
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground"
            >
              <Plus size={14}/> Dodaj wyrób
            </button>
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
      </Card>

      {/* ── Pasek zaznaczenia ───────────────────────────
          Widoczny dopiero, gdy coś zaznaczono — pusty pasek zabierałby
          miejsce listy, a to ona jest tu najważniejsza. */}
      {podsumZaznaczenia.pozycji > 0 && (
        <Card className="border-ink bg-surface-2">
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
            <CardDescription>Brak wyników dla „{filter}"</CardDescription>
          </CardContent>
        ) : (
          <div className="overflow-auto max-h-[calc(100vh-12rem)]">
            <table className="w-full text-xs tabular-nums">
              <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur-sm border-b-2 border-surface-4">
                <tr>
                  <th className="w-8 px-2" />
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
                      onClick={() => toggleSort(h.col)}
                      className={cn(
                        'group cursor-pointer select-none px-2.5 py-2 text-[11px] font-bold uppercase tracking-wider text-ink-2 hover:text-ink whitespace-nowrap',
                        h.align === 'right' && 'text-right',
                      )}
                    >
                      <span className={cn('inline-flex items-center gap-1', h.align === 'right' && 'flex-row-reverse')}>
                        {h.label}
                        <SortIcon col={h.col} />
                      </span>
                    </th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {list.flatMap((g, idx) => [
                  (
                  <tr
                    key={g.key}
                    onClick={() => setDetailGroup(g)}
                    className={cn(
                      'cursor-pointer border-b border-surface-3 transition-colors',
                      idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                      'hover:bg-surface-3/60'
                    )}
                  >
                    <td className="px-2 py-2" onClick={e => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Zaznacz ${g.productTypeName} ${g.recipeName} ${g.kgPerUnit}kg`}
                        checked={wybor[g.key] !== undefined}
                        disabled={podzialStanu(g).wolne <= 0}
                        onChange={e => setWybor(w => {
                          const n = { ...w }
                          // Zaznaczenie bierze CAŁY wolny stan, rozpisany FEFO —
                          // to tylko PROPOZYCJA, partie da się poprawić po
                          // rozwinięciu wiersza.
                          if (e.target.checked) {
                            n[g.key] = przydzialNaMape(
                              rozpiszNaPartie(g as any, podzialStanu(g).wolne))
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
                          {sumaPrzydzialu(wybor[g.key])} z {podzialStanu(g).wolne}
                        </button>
                      ) : g.qty}
                      <span className="text-muted-foreground font-normal text-[11px]"> szt</span>
                      {/* Kolumna pokazuje CAŁY stan (właściciel, 02.09.2026):
                          magazyn ma odpowiadać na pytanie „ile tego mam", a nie
                          „ile mogę zabrać". Co jest zarezerwowane i pod jakie
                          zamówienie — w szczegółach pod kliknięciem. */}
                      {podzialStanu(g).podZamowienia > 0 && (
                        <span
                          className="ml-1 font-normal text-[11px] text-ink-4"
                          title="część zajęta pod zamówienia — szczegóły po kliknięciu"
                        >
                          ●
                        </span>
                      )}
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
                    <td className="px-2 py-2 text-right">
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
                  <tr key={`${g.key}-partie`} className="bg-surface-2/60">
                    <td />
                    <td colSpan={8} className="px-2.5 py-2">
                      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mb-1.5">
                        Partie — poprawiaj, jeśli bierzesz z innej
                      </div>
                      <div className="space-y-1">
                        {[...g.batches]
                          .filter(b => !(b.clientOrderNo || '').trim())
                          .sort((a, b) => (dataFefo(a) || '~').localeCompare(dataFefo(b) || '~'))
                          .map(b => (
                          <div key={b.id} className="flex items-center gap-2 text-xs">
                            <span className="font-mono font-bold w-32">{b.batchNo || '—'}</span>
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

      {/* Spakowane kebaby — lista utworzonych kartonów ze statusem */}
      <PackedCartonsSection refreshKey={cartonRefresh} />

      {detailGroup && <DetailModal group={detailGroup} onClose={() => setDetailGroup(null)}
                                   onChanged={() => refetch()} />}
      {dodawanie && (
        <AddFinishedGoodModal onClose={() => setDodawanie(false)} onSaved={() => refetch()} />
      )}
    </div>
  )
}
