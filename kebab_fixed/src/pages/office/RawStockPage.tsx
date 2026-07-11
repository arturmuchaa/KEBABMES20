/**
 * RawStockPage — Magazyn surowca: ŻYWY stan wszystkiego przed produkcją.
 *
 * Pięć zakładek na wspólnym DataTable (styl Subiekt):
 *   Ćwiartka (raw_batches kg>0) · Mięso z/s · Filet i inne (meat_stock
 *   rozdzielone po material_type_id — filet to INNY składnik, nie może się
 *   mieszać z z/s) · Grzbiety · Kości (otwarte loty ABP).
 * Jedno źródło danych: GET /wz/stock/raw (to samo co picker WZ — stan,
 * pojemniki, daty, rezerwacje). Klik wiersza → kartoteka partii
 * (RawStockBatchCard: łańcuch śledzenia + historia ruchów).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { wzApi } from '@/lib/apiClient'
import { fmtKg, fmtDatePl, cn } from '@/lib/utils'
import { getExpiryStatus } from '@/lib/utils/fefo'
import { Drumstick, Beef, Layers, Package, Bone, FileOutput } from 'lucide-react'

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
type Tab = 'raw' | 'meat' | 'other' | 'backs' | 'bones'

const ZS = 'mat-mieso-zs'

export function RawStockPage() {
  const navigate = useNavigate()
  const { data: stockData, loading } = useApi<StockRow[]>(() => (wzApi as any).stockRaw())
  const [activeTab, setActiveTab] = useState<Tab>('raw')
  const [trace, setTrace] = useState<StockRow | null>(null)

  const stock = useMemo(() => (stockData ?? []) as StockRow[], [stockData])

  const byTab = useMemo(() => ({
    raw:   stock.filter(r => r.stock_type === 'raw'),
    // Filet/indyk przyjęte bez rozbioru to INNE składniki niż mięso z/s
    // z rozbioru — osobna zakładka, żeby się nie mieszały (magazyn i plan).
    meat:  stock.filter(r => r.stock_type === 'meat' && (r.material_type_id ?? ZS) === ZS),
    other: stock.filter(r => r.stock_type === 'meat' && (r.material_type_id ?? ZS) !== ZS),
    backs: stock.filter(r => r.stock_type === 'byproduct' && r.name === 'Grzbiety'),
    bones: stock.filter(r => r.stock_type === 'byproduct' && r.name === 'Kości'),
  }), [stock])

  const sumKg = (rows: StockRow[]) => rows.reduce((s, r) => s + Number(r.kg_available), 0)

  const TABS: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: 'raw',   label: 'Ćwiartka',     icon: <Drumstick size={13} /> },
    { key: 'meat',  label: 'Mięso z/s',    icon: <Beef size={13} /> },
    { key: 'other', label: 'Filet i inne', icon: <Layers size={13} /> },
    { key: 'backs', label: 'Grzbiety',     icon: <Package size={13} /> },
    { key: 'bones', label: 'Kości',        icon: <Bone size={13} /> },
  ]

  const rows = byTab[activeTab]

  // ── Kolumny per zakładka ──
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

  const columns: DataColumn<StockRow>[] =
    activeTab === 'raw'
      ? [colPartia, colDostawca, colDostepne, colPojemniki, colUboj, colProdukcja('Przyjęcie'), colWaznosc]
      : activeTab === 'meat'
        ? [colPartia, colDostawca, colDostepne, colZarezerwowane, colPoczatkowe, colProdukcja('Produkcja'), colWaznosc]
        : activeTab === 'other'
          ? [colRodzaj, colPartia, colDostawca, colDostepne, colZarezerwowane, colPoczatkowe, colProdukcja('Przyjęcie'), colWaznosc]
          : [colPartia, colDostawca, colDostepne, colPojemniki, colProdukcja('Ważenie'), colUboj, colWaznosc]

  return (
    <div className="space-y-3 animate-fade-in">
      <DataTable<StockRow>
        key={activeTab}
        rows={rows}
        columns={columns}
        rowKey={r => r.id}
        initialSort={{ key: 'expiry', dir: 'asc' }}
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
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => navigate('/office/wz/nowy')}>
            <FileOutput size={14} />
            Wystaw WZ
          </Button>
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
