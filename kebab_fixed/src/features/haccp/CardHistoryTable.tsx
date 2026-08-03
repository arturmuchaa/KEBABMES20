/**
 * CardHistoryTable — wspólna lista kart HACCP do pobrania.
 *
 * Karty HACCP (arkusz kontroli sanitarnej, kontrola temperatury) to PUSTE
 * formularze papierowe — MES ich nie przechowuje, tylko numeruje. „Historia"
 * jest więc listą kart, które w danym okresie POWINNY istnieć: biuro wybiera
 * dzień i pobiera gotową, ponumerowaną kartę do wypełnienia albo dodruku.
 *
 * Kliknięcie wiersza otwiera PODGLĄD (bez okna drukowania) — druk jest
 * osobnym, świadomym przyciskiem.
 */
import { DataTable } from '@/components/DataTable'
import { downloadDocPdf } from '@/lib/api'
import type { HaccpCardRow } from '@/lib/haccpCardHistory'
import { FileDown, Printer, ExternalLink } from 'lucide-react'

/** Przełącznik zakresu listy — ten sam w obu historiach. */
export function RangePicker({ ranges, value, onChange, unit }: {
  ranges: number[]; value: number; onChange: (n: number) => void; unit: string
}) {
  return (
    <div className="mb-2 inline-flex items-center gap-1">
      <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3 mr-1">Zakres</span>
      {ranges.map(r => (
        <button
          key={r}
          onClick={() => onChange(r)}
          className={`px-2 h-6 rounded text-[11px] font-semibold border ${
            value === r
              ? 'bg-ink text-white border-ink'
              : 'bg-white text-ink-3 border-surface-4 hover:text-ink'
          }`}
        >{r} {unit}</button>
      ))}
    </div>
  )
}

interface Props {
  rows: HaccpCardRow[]
  /** URL backendowego renderu PDF dla danego dnia. */
  pdfUrl: (day: string) => string
  /** Ścieżka strony wydruku (bez query) — np. '/office/arkusz-kontroli/druk'. */
  printPath: string
  /** Nazwa parametru dnia w URL wydruku ('data' albo 'od'). */
  dayParam: string
  searchPlaceholder: string
  periodHeader: string
}

function openTab(url: string) {
  const win = window.open(url, '_blank')
  // popup zablokowany — nie gubimy akcji, tylko nawigujemy w tej karcie
  if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
}

export function CardHistoryTable({ rows, pdfUrl, printPath, dayParam, searchPlaceholder, periodHeader }: Props) {
  const printHref = (day: string) => `${printPath}?${dayParam}=${day}`
  // ?pdf=1 wyłącza auto-print — podgląd nie ma otwierać okna drukarki
  const previewHref = (day: string) => `${printHref(day)}&pdf=1`

  const download = (row: HaccpCardRow) => {
    // Pobranie z sesją (fetch+blob) — goły <a href> szedł bez Authorization → 401.
    void downloadDocPdf(pdfUrl(row.day), `karta-${row.day}.pdf`)
      .catch(e => alert(e?.message || 'Nie udało się pobrać PDF'))
  }

  return (
    <DataTable
      rows={rows}
      rowKey={r => r.day}
      searchText={r => `${r.no} ${r.when} ${r.note || ''} ${r.day}`}
      searchPlaceholder={searchPlaceholder}
      onRowClick={r => openTab(previewHref(r.day))}
      columns={[
        {
          key: 'no', header: 'Nr karty', sortable: true, sortValue: r => r.day,
          cell: r => (
            <span className="font-bold text-ink whitespace-nowrap tabular-nums">
              {r.no}
              {r.current && (
                <span className="ml-1.5 inline-block px-1 py-px rounded text-[9px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 align-middle">
                  bieżąca
                </span>
              )}
            </span>
          ),
        },
        {
          key: 'when', header: periodHeader, sortable: true, sortValue: r => r.day,
          cell: r => (
            <span className="whitespace-nowrap">
              <span className="font-medium">{r.when}</span>
              {r.note && <span className="ml-2 text-[11px] uppercase tracking-wide text-ink-3">{r.note}</span>}
            </span>
          ),
        },
        {
          key: 'act', header: 'Akcje', align: 'right',
          cell: r => (
            <div className="inline-flex items-center gap-0.5">
              <button
                onClick={e => { e.stopPropagation(); download(r) }}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                title="Pobierz PDF"
              ><FileDown size={13} /></button>
              <button
                onClick={e => { e.stopPropagation(); openTab(printHref(r.day)) }}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                title="Drukuj"
              ><Printer size={13} /></button>
              <button
                onClick={e => { e.stopPropagation(); openTab(previewHref(r.day)) }}
                className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                title="Podgląd karty"
              ><ExternalLink size={13} /></button>
            </div>
          ),
        },
      ]}
      initialSort={{ key: 'no', dir: 'desc' }}
    />
  )
}
