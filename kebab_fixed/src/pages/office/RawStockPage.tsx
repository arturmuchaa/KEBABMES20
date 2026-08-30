/**
 * RawStockPage — Magazyn surowca: ŻYWY stan wszystkiego przed produkcją.
 *
 * Siedem zakładek na wspólnym DataTable (styl Subiekt):
 *   Ćwiartka (raw_batches kg>0) · Mięso z/s · Mięso b/s · Mięso czerwone ·
 *   Filet i inne (meat_stock rozdzielone po material_type_id — filet to INNY
 *   składnik, nie może się mieszać z z/s) · Grzbiety · Kości (otwarte loty ABP).
 *
 * „Mięso czerwone" ma dodatkową kolumnę STANU: wołowina i łój przyjeżdżają
 * chłodzone albo w blokach, a od tego zależy, w którym magazynie leżą —
 * pom. 3 (+3 °C) czy pom. 6 (−18 °C).
 * Jedno źródło danych: GET /wz/stock/raw (to samo co picker WZ — stan,
 * pojemniki, daty, rezerwacje). Klik wiersza → kartoteka partii
 * (RawStockBatchCard: łańcuch śledzenia + historia ruchów).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { rawBatchesApi, wzApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Drumstick, Beef, Layers, Package, Bone, FileOutput, Snowflake } from 'lucide-react'
import {
  czyCzerwone, etykietaStanu, magazynStanu, normalizeStan,
} from '@/features/raw-batches/storageState'

import { DataTable, type DataColumn } from '@/components/DataTable'
import { Button } from '@/components/ui/button'
import { RawStockBatchCard, ExpiryBadge } from './RawStockBatchCard'

// ─── Wiersz z GET /wz/stock/raw ──────────────────────────────
interface StockRow {
  id: string
  stock_type: 'raw' | 'meat' | 'byproduct'
  internal_batch_no: string
  supplier_name?: string | null
  name: string
  doc_name?: string
  material_type_id?: string
  /** 'chlodzony' | 'mrozony' — decyduje, w którym magazynie lot leży. */
  storage_state?: string
  kg_available: number | string
  kg_reserved?: number | string
  kg_initial?: number | string
  containers?: number | null
  slaughter_date?: string | null
  expiry_date?: string | null
  production_date?: string | null
}

function isExpiredRow(r: StockRow): boolean {
  return !!r.expiry_date && getExpiryStatus(r.expiry_date).daysLeft < 0
}

// ─── Strona ─────────────────────────────────────────────────
type Tab = 'raw' | 'meat' | 'bs' | 'red' | 'other' | 'backs' | 'bones'

const ZS = 'mat-mieso-zs'
const BS = 'mat-mieso-bs'

export function RawStockPage() {
  const navigate = useNavigate()
  const { data: stockData, loading } = useApi<StockRow[]>(() => (wzApi as any).stockRaw())
  // Słownik rodzajów — tylko po to, żeby wiedzieć, które id-ki są wołowiną.
  // Bez niego wołowina wpadałaby do „Filet i inne" razem z drobiem.
  //
  // Filtrujemy po samej KATEGORII, bez `receivable`: magazyn pokazuje to, co
  // fizycznie leży. Rodzaj wycofany z przyjmowania (receivable=false) ma
  // dokończyć życie w swojej zakładce, a nie wpaść nagle między filety.
  const { data: typesData } = useApi(() => (rawBatchesApi as any).materialTypes())
  const czerwoneIds = useMemo(
    () => new Set(((typesData as any[]) ?? [])
      .filter(m => czyCzerwone(m.category)).map(m => m.id)),
    [typesData])
  const [activeTab, setActiveTab] = useState<Tab>('raw')
  const [trace, setTrace] = useState<StockRow | null>(null)

  // Zaznaczenie do zbiorczej WZ. Trzymane PONAD zakładkami (klucz = id
  // pozycji magazynowej), bo jeden dokument bierze i kości, i grzbiety —
  // przełączenie zakładki nie może gubić tego, co już zaznaczone.
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const togglePick = (id: string) => setPicked(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const stock = useMemo(() => (stockData ?? []) as StockRow[], [stockData])

  const byTab = useMemo(() => ({
    raw:   stock.filter(r => r.stock_type === 'raw'),
    // Filet/indyk przyjęte bez rozbioru to INNE składniki niż mięso z/s
    // z rozbioru — osobna zakładka, żeby się nie mieszały (magazyn i plan).
    meat:  stock.filter(r => r.stock_type === 'meat' && (r.material_type_id ?? ZS) === ZS),
    // Mięso b/s (bez skóry) z rozbioru — robione rzadko, ale MUSI stać osobno:
    // inny uzysk, inna receptura, Auto-FEFO masowania bierze tylko z/s.
    bs:    stock.filter(r => r.stock_type === 'meat' && r.material_type_id === BS),
    // Mięso czerwone — jedna zakładka na pięć rodzajów (80/20, zrazowa,
    // mostek, dwa łoje). Instrukcja 1.1 oPRP traktuje je jednakowo, a rozbicie
    // na pięć zakładek zasypałoby drób.
    red: stock.filter(r => r.stock_type === 'meat' && czerwoneIds.has(r.material_type_id ?? '')),
    other: stock.filter(r => r.stock_type === 'meat'
      && (r.material_type_id ?? ZS) !== ZS && r.material_type_id !== BS
      && !czerwoneIds.has(r.material_type_id ?? '')),
    backs: stock.filter(r => r.stock_type === 'byproduct' && r.name === 'Grzbiety'),
    bones: stock.filter(r => r.stock_type === 'byproduct' && r.name === 'Kości'),
  }), [stock, czerwoneIds])

  const sumKg = (rows: StockRow[]) => rows.reduce((s, r) => s + Number(r.kg_available), 0)

  const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: 'raw',   label: 'Ćwiartka',     icon: <Drumstick size={13} /> },
    { key: 'meat',  label: 'Mięso z/s',    icon: <Beef size={13} /> },
    { key: 'bs',    label: 'Mięso b/s',    icon: <Beef size={13} /> },
    { key: 'red',   label: 'Mięso czerwone', icon: <Beef size={13} /> },
    { key: 'other', label: 'Filet i inne', icon: <Layers size={13} /> },
    { key: 'backs', label: 'Grzbiety',     icon: <Package size={13} /> },
    { key: 'bones', label: 'Kości',        icon: <Bone size={13} /> },
  ]

  const rows = byTab[activeTab]

  // ── Kolumny per zakładka ──
  const allPicked = rows.length > 0 && rows.every(r => picked.has(r.id))
  const colZaznacz: DataColumn<StockRow> = {
    key: 'pick', width: 40,
    headClassName: 'text-center', className: 'text-center',
    header: (
      <input type="checkbox" aria-label="Zaznacz wszystkie w zakładce"
        className="h-3.5 w-3.5 cursor-pointer align-middle accent-[var(--brand,#171717)]"
        checked={allPicked}
        onChange={() => setPicked(prev => {
          const next = new Set(prev)
          // Działa na CAŁEJ zakładce (nie na przefiltrowanym widoku) — licznik
          // przy przycisku WZ zawsze pokazuje, ile realnie jest zaznaczone.
          if (allPicked) rows.forEach(r => next.delete(r.id))
          else rows.forEach(r => next.add(r.id))
          return next
        })}
      />
    ),
    // stopPropagation: klik w checkbox nie może otwierać kartoteki partii
    cell: r => (
      <input type="checkbox" aria-label={`Zaznacz partię ${r.internal_batch_no}`}
        className="h-3.5 w-3.5 cursor-pointer align-middle accent-[var(--brand,#171717)]"
        checked={picked.has(r.id)}
        onClick={e => e.stopPropagation()}
        onChange={() => togglePick(r.id)}
      />
    ),
  }
  const colPartia: DataColumn<StockRow> = {
    key: 'batch', header: activeTab === 'backs' || activeTab === 'bones' ? 'Partia ćwiartki' : 'Partia',
    sortable: true, sortValue: r => r.internal_batch_no, width: 130,
    cell: r => <code className="font-mono font-bold text-primary text-[12px]">{r.internal_batch_no || '—'}</code>,
  }
  const colDostawca: DataColumn<StockRow> = {
    key: 'supplier', header: 'Dostawca', sortable: true, sortValue: r => r.supplier_name ?? '',
    cell: r => r.supplier_name
      ? <span className="text-ink-2 truncate block max-w-[240px]" title={r.supplier_name}>{r.supplier_name}</span>
      : <span className="text-muted-foreground">—</span>,
  }
  const colDostepne: DataColumn<StockRow> = {
    key: 'kg', header: 'Dostępne [kg]', align: 'right', sortable: true, sortValue: r => Number(r.kg_available),
    cell: r => <span className="font-bold tabular-nums text-emerald-700">{fmtKg(Number(r.kg_available), 1)}</span>,
  }
  const colZarezerwowane: DataColumn<StockRow> = {
    key: 'reserved', header: 'Zarezerwowane [kg]', align: 'right', sortable: true, sortValue: r => Number(r.kg_reserved ?? 0),
    cell: r => Number(r.kg_reserved ?? 0) > 0
      ? <span className="font-semibold tabular-nums text-amber-700" title="Zarezerwowane przez plan masowania">{fmtKg(Number(r.kg_reserved), 1)}</span>
      : <span className="text-muted-foreground tabular-nums">—</span>,
  }
  const colPoczatkowe: DataColumn<StockRow> = {
    key: 'initial', header: 'Początkowe [kg]', align: 'right', sortable: true, sortValue: r => Number(r.kg_initial ?? 0),
    cell: r => r.kg_initial != null
      ? <span className="tabular-nums text-ink-2">{fmtKg(Number(r.kg_initial), 1)}</span>
      : <span className="text-muted-foreground">—</span>,
  }
  const colPojemniki: DataColumn<StockRow> = {
    key: 'containers', header: 'Pojemniki~', align: 'right', sortable: true, sortValue: r => r.containers ?? 0,
    cell: r => r.containers
      ? <span className="tabular-nums text-ink-2" title="Orientacyjnie, z ważenia na hali">{r.containers}</span>
      : <span className="text-muted-foreground">—</span>,
  }
  const colUboj: DataColumn<StockRow> = {
    key: 'slaughter', header: 'Ubój', sortable: true, sortValue: r => r.slaughter_date ?? '',
    cell: r => r.slaughter_date ? <span className="text-ink-2">{fmtDatePl(r.slaughter_date)}</span> : <span className="text-muted-foreground">—</span>,
  }
  const colProdukcja = (header: string): DataColumn<StockRow> => ({
    key: 'production', header, sortable: true, sortValue: r => r.production_date ?? '',
    cell: r => r.production_date ? <span className="text-ink-2">{fmtDatePl(r.production_date)}</span> : <span className="text-muted-foreground">—</span>,
  })
  const colWaznosc: DataColumn<StockRow> = {
    key: 'expiry', header: 'Ważność', sortable: true, sortValue: r => r.expiry_date ?? '',
    cell: r => r.expiry_date
      ? <span className="flex items-center gap-1.5"><span className="text-ink-2">{fmtDatePl(r.expiry_date)}</span><ExpiryBadge date={r.expiry_date} /></span>
      : <span className="text-muted-foreground">—</span>,
  }
  const colRodzaj: DataColumn<StockRow> = {
    key: 'material', header: 'Rodzaj', sortable: true, sortValue: r => r.name,
    cell: r => <span className="font-semibold text-ink">{r.name}</span>,
  }
  // Stan + magazyn w jednej kolumnie: numer pomieszczenia jest tym, czego
  // magazynier naprawdę szuka, a sam napis „Mrożony" jeszcze go tam nie prowadzi.
  const colStan: DataColumn<StockRow> = {
    key: 'state', header: 'Stan', sortable: true, width: 150,
    sortValue: r => normalizeStan(r.storage_state),
    cell: r => {
      const mrozony = normalizeStan(r.storage_state) === 'mrozony'
      const mag = magazynStanu(r.storage_state)
      return (
        <span className="flex items-center gap-1.5">
          {mrozony && <Snowflake size={12} className="text-sky-600 shrink-0" />}
          <span className={mrozony ? 'font-semibold text-sky-700' : 'text-ink-2'}>
            {etykietaStanu(r.storage_state)}
          </span>
          <span className="text-[11px] text-muted-foreground">mag. {mag.nr}</span>
        </span>
      )
    },
  }

  const columns: DataColumn<StockRow>[] = [
    colZaznacz,
    ...(activeTab === 'raw'
      ? [colPartia, colDostawca, colDostepne, colPojemniki, colUboj, colProdukcja('Przyjęcie'), colWaznosc]
      : activeTab === 'meat' || activeTab === 'bs'
        ? [colPartia, colDostawca, colDostepne, colZarezerwowane, colPoczatkowe, colProdukcja('Produkcja'), colWaznosc]
        : activeTab === 'red'
          ? [colRodzaj, colStan, colPartia, colDostawca, colDostepne, colZarezerwowane, colPoczatkowe, colProdukcja('Przyjęcie'), colWaznosc]
        : activeTab === 'other'
          ? [colRodzaj, colPartia, colDostawca, colDostepne, colZarezerwowane, colPoczatkowe, colProdukcja('Przyjęcie'), colWaznosc]
          : [colPartia, colDostawca, colDostepne, colPojemniki, colProdukcja('Ważenie'), colUboj, colWaznosc]),
  ]

  const pickedRows = stock.filter(r => picked.has(r.id))
  const pickedKg = sumKg(pickedRows)

  return (
    <div className="space-y-3 animate-fade-in">
      <DataTable<StockRow>
        key={activeTab}
        rows={rows}
        columns={columns}
        rowKey={r => r.id}
        // Najświeższe dostawy na górze (decyzja właściciela 20.08.2026).
        // Numer partii jest tekstem, ale DataTable porównuje go numerycznie,
        // więc 501 stoi nad 99. Terminy dalej pilnują same siebie: wygasłe
        // wiersze świecą na czerwono, a kolumna „Ważność" sortuje jednym
        // kliknięciem, gdy trzeba spojrzeć po FEFO.
        initialSort={{ key: 'batch', dir: 'desc' }}
        searchText={r => `${r.internal_batch_no} ${r.supplier_name ?? ''} ${r.name}`}
        searchPlaceholder="Filtruj: nr partii, dostawca…"
        initialQuery={new URLSearchParams(window.location.search).get('q') ?? undefined}
        onRowClick={r => setTrace(r)}
        rowClassName={r => isExpiredRow(r) ? 'bg-red-50/60' : ''}
        empty={loading ? 'Ładowanie…' : (
          <div className="flex flex-col items-center gap-1 py-8">
            <span className="text-sm font-semibold text-ink-3">Brak stanu w tej zakładce</span>
            <span className="text-xs text-ink-4">
              {activeTab === 'raw' ? 'Ćwiartka pojawia się po przyjęciu dostawy.'
                : activeTab === 'meat' ? 'Mięso z/s pojawia się po ważeniu na rozbiorze.'
                : activeTab === 'bs' ? 'Mięso b/s pojawia się, gdy operator przełączy wagę na B/S przy rozbiorze.'
                : activeTab === 'red' ? 'Wołowina i łój pojawiają się po przyjęciu w zakładce „Mięso czerwone".'
                : activeTab === 'other' ? 'Filet/indyk pojawia się po przyjęciu surowca bez rozbioru.'
                : 'Grzbiety i kości pojawiają się po ważeniu zbiorczym na rozbiorze.'}
            </span>
          </div>
        )}
        toolbarLeft={
          <div className="flex items-center gap-1 flex-wrap">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold border transition-colors',
                  activeTab === t.key
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-white text-ink-2 border-surface-4 hover:bg-surface-2',
                )}
              >
                {t.icon}
                {t.label}
                <span className={cn(
                  'ml-1 text-[10px] tabular-nums',
                  activeTab === t.key ? 'text-primary-foreground/80' : 'text-muted-foreground',
                )}>
                  {fmtKg(sumKg(byTab[t.key]), 0)} kg
                </span>
              </button>
            ))}
          </div>
        }
        actions={
          pickedRows.length > 0 ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-3 whitespace-nowrap">
                zaznaczone: <b className="text-ink">{pickedRows.length}</b> · {fmtKg(pickedKg, 1)} kg
              </span>
              <Button size="sm" variant="ghost" className="text-xs" onClick={() => setPicked(new Set())}>
                Wyczyść
              </Button>
              <Button size="sm" className="gap-1.5"
                onClick={() => navigate(`/office/wz/nowy?stock=${pickedRows.map(r => r.id).join(',')}`)}>
                <FileOutput size={14} />
                Wystaw WZ z zaznaczonych
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/office/wz/nowy')}>
              <FileOutput size={14} />
              Wystaw WZ
            </Button>
          )
        }
        footer={filtered => {
          const kg = sumKg(filtered)
          const res = filtered.reduce((s, r) => s + Number(r.kg_reserved ?? 0), 0)
          return (
            <>
              <span>Suma · {filtered.length} {filtered.length === 1 ? 'partia' : 'partii'}</span>
              <span className="ml-auto">Dostępne: <b className="text-emerald-700">{fmtKg(kg, 1)} kg</b></span>
              {res > 0 && <span>w tym zarezerwowane: <b className="text-amber-700">{fmtKg(res, 1)} kg</b></span>}
            </>
          )
        }}
      />

      {trace && (
        <RawStockBatchCard
          stockType={trace.stock_type}
          stockId={trace.id}
          onClose={() => setTrace(null)}
        />
      )}
    </div>
  )
}
