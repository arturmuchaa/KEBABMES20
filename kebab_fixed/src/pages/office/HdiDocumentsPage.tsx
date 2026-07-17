/**
 * HdiDocumentsPage — Dokumenty HDI (lista, styl Subiekt GT).
 *
 * Gęsta tabela ze sticky-headerem, sortowaniem i szybkim filtrem. Każdy
 * wiersz → otwarcie wydruku HDI (podgląd + drukowanie / zapis do PDF).
 * Domyślnie sortowanie po numerze, od najnowszego.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { hdiApi, downloadDocPdf, type HdiListRow } from '@/lib/api'
import { cn } from '@/lib/utils'
import { DataTable } from '@/components/DataTable'
import { usePageHeaderActions } from '@/components/PageHeader'
import {
  Search, ChevronDown, ChevronUp, ChevronsUpDown, X, Printer, FileText, ExternalLink, FileDown,
} from 'lucide-react'

import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge, type StatusTone } from '@/components/ui/badge'
import {
  Card, CardContent, CardDescription, CardTitle,
} from '@/components/ui/card'

// ─── Sort ────────────────────────────────────────────────────
type SortCol = 'number' | 'issueDate' | 'clientName' | 'status' | 'createdAt'

// Numer HDI ma postać "NN/MM/RR" — porównujemy chronologicznie: RR, MM, NN.
function numberKey(no: string): number {
  const m = /^(\d+)\/(\d+)\/(\d+)$/.exec((no || '').trim())
  if (!m) return 0
  const seq = parseInt(m[1], 10), mm = parseInt(m[2], 10), yy = parseInt(m[3], 10)
  return yy * 1_000_000 + mm * 10_000 + seq
}

function compareRows(col: SortCol) {
  return (a: HdiListRow, b: HdiListRow) => {
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
  const url = `/office/hdi/${id}/druk`
  const win = window.open(url, '_blank')
  if (!win || win.closed || typeof win.closed === 'undefined') window.location.href = url
}

function downloadPdf(id: string) {
  // Pobranie z sesją (fetch+blob) — goły <a href> szedł bez Authorization → 401.
  void downloadDocPdf(hdiApi.pdfUrl(id)).catch(e => alert(e?.message || 'Nie udało się pobrać PDF'))
}

// ─── Strona ─────────────────────────────────────────────────
export function HdiDocumentsPage() {
  const { data: rows, loading } = useApi(() => hdiApi.listDocs())
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
          <div className="text-sm font-medium text-muted-foreground">Brak dokumentów HDI</div>
          <div className="text-xs text-muted-foreground">HDI wystawisz z listy zamówień (przycisk „HDI").</div>
        </div>
      ) : (
        <DataTable
          rows={rawList} rowKey={r => r.id}
          searchText={r => `${r.number || ''} ${r.clientName || ''} ${r.status || ''} ${r.issueDate || ''}`}
          searchPlaceholder="Filtruj: numer, klient, status…"
          initialSort={{ key: 'number', dir: 'desc' }}
          onRowClick={r => openPrint(r.id)}
          columns={[
            { key: 'number', header: 'Numer HDI', sortable: true, sortValue: r => r.number || '',
              cell: r => (
                <span className="font-bold text-ink whitespace-nowrap">
                  {r.number}
                  {r.incomplete && <span className="ml-1.5 inline-block px-1 py-px rounded text-[9px] font-semibold bg-orange-50 text-orange-700 border border-orange-200 align-middle" title="Wystawiony na stan faktyczny — niekompletny względem zamówienia">niekompletny</span>}
                </span>
              ) },
            { key: 'issueDate', header: 'Data wystawienia', sortable: true, sortValue: r => r.issueDate || '',
              cell: r => r.issueDate || '—' },
            { key: 'clientName', header: 'Klient', sortable: true, sortValue: r => r.clientName || '',
              cell: r => <span className="font-medium">{r.clientName || '—'}</span> },
            { key: 'status', header: 'Status', sortable: true, sortValue: r => r.status || '',
              cell: r => <StatusBadge tone={DOC_TONE[r.status] ?? 'gray'} label={STATUS_LABEL[r.status] || r.status || '—'} /> },
            { key: 'act', header: 'Akcje', align: 'right',
              cell: r => (
                <div className="inline-flex items-center gap-0.5">
                  <button onClick={e => { e.stopPropagation(); downloadPdf(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50" title="Pobierz PDF"><FileDown size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); openPrint(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Drukuj"><Printer size={13}/></button>
                  <button onClick={e => { e.stopPropagation(); openPrint(r.id) }} className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10" title="Otwórz dokument"><ExternalLink size={13}/></button>
                </div>
              ) },
          ]}
        />
      )}
    </div>
  )
}
