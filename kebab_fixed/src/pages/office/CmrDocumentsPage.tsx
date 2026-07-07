/**
 * CmrDocumentsPage — Dokumenty CMR (lista, styl Subiekt GT).
 *
 * Gęsta tabela ze sticky-headerem, sortowaniem i szybkim filtrem. Każdy
 * wiersz → otwarcie wydruku CMR (podgląd + drukowanie / zapis do PDF).
 * Domyślnie sortowanie po numerze, od najnowszego (numerycznie malejąco).
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { cmrApi, type CmrListRow } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import { CmrEditModal } from '@/components/cmr/CmrEditModal'
import {
  Search, ChevronDown, ChevronUp, ChevronsUpDown, X, Printer, FileText, ExternalLink, FileDown, Pencil,
} from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge, type StatusTone } from '@/components/ui/badge'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'

// ─── Sort ────────────────────────────────────────────────────
type SortCol = 'number' | 'issueDate' | 'clientName' | 'status' | 'createdAt'

// Numer CMR to zwykła liczba całkowita ("1","2",...) — sortujemy numerycznie.
function numberKey(no: string): number {
  return parseInt(no || '0', 10)
}

function compareRows(col: SortCol) {
  return (a: CmrListRow, b: CmrListRow) => {
    switch (col) {
      case 'number':     return numberKey(a.number) - numberKey(b.number)
      case 'issueDate':  return (a.issueDate || '').localeCompare(b.issueDate || '')
      case 'clientName': return (a.clientName || '').localeCompare(b.clientName || '')
      case 'status':     return (a.status || '').localeCompare(b.status || '')
      case 'createdAt':  return (a.createdAt || '').localeCompare(b.createdAt || '')
    }
  }
}

const STATUS_LABEL: Record<string, string> = {
  wstepny: 'Wstępny', potwierdzony: 'Potwierdzony', korekta: 'Korekta',
}
const DOC_TONE: Record<string, StatusTone> = {
  wstepny: 'amber', potwierdzony: 'green', korekta: 'red',
}

function openPrint(id: string) {
  const url = `/office/cmr/${id}/druk`
  const win = window.open(url, '_blank')
  if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
}

function downloadPdf(id: string) {
  // Endpoint zwraca PDF jako attachment → przeglądarka pobiera plik.
  const a = document.createElement('a')
  a.href = cmrApi.pdfUrl(id)
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
}

// ─── Strona ─────────────────────────────────────────────────
export function CmrDocumentsPage() {
  const { data: rows, loading, refetch } = useApi(() => cmrApi.listDocs())
  const [editId, setEditId] = useState<string | null>(null)
  const rawList = rows ?? []

  usePageHeaderActions(
    <span className="text-[11px] font-bold uppercase tracking-wide text-ink-3 tabular-nums">Dokumentów: <span className="text-ink font-bold">{rawList.length}</span></span>,
    [rawList.length]
  )

  return (
    <div className="animate-fade-in">
      {loading ? (
        <div className="rounded-lg border border-surface-4 bg-white p-4 space-y-2">
          {[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-8 w-full" />)}
        </div>
      ) : rawList.length === 0 ? (
        <div className="rounded-lg border border-surface-4 bg-white flex flex-col items-center justify-center py-16 gap-2">
          <FileText size={36} className="text-muted-foreground opacity-20" />
          <div className="text-sm font-medium text-muted-foreground">Brak dokumentów CMR</div>
          <div className="text-xs text-muted-foreground">CMR wystawisz z listy zamówień (przycisk „CMR").</div>
        </div>
      ) : (
        <DataTable
          rows={rawList} rowKey={r => r.id}
          searchText={r => `${r.number || ''} ${r.clientName || ''} ${r.status || ''} ${r.issueDate || ''}`}
          searchPlaceholder="Filtruj: numer, klient, status…"
          initialSort={{ key: 'number', dir: 'desc' }}
          onRowClick={r => openPrint(r.id)}
          columns={[
            { key: 'number', header: 'Nr CMR', sortable: true, sortValue: r => r.number || '',
              cell: r => <span className="font-bold text-ink whitespace-nowrap">{r.number}</span> },
            { key: 'issueDate', header: 'Data wystawienia', sortable: true, sortValue: r => r.issueDate || '',
              cell: r => r.issueDate || '—' },
            { key: 'clientName', header: 'Klient', sortable: true, sortValue: r => r.clientName || '',
              cell: r => <span className="font-medium">{r.clientName || '—'}</span> },
            { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status || '',
              cell: r => <StatusBadge tone={DOC_TONE[r.status] ?? 'gray'} label={STATUS_LABEL[r.status] || r.status || '—'} /> },
            { key: 'act', header: 'Akcje', align: 'right',
              cell: r => (
                <div className="inline-flex items-center gap-0.5">
                  <button onClick={e => { e.stopPropagation(); setEditId(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50" title="Edytuj CMR"><Pencil size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); downloadPdf(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50" title="Pobierz PDF"><FileDown size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); openPrint(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Drukuj"><Printer size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); openPrint(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Otwórz dokument"><ExternalLink size={13}/></button>
                </div>
              ) },
          ]}
        />
      )}
      {editId && (
        <CmrEditModal
          cmrId={editId}
          onClose={() => setEditId(null)}
          onSaved={() => refetch?.()}
        />
      )}
    </div>
  )
}
