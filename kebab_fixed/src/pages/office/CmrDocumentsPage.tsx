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
  const [filter,  setFilter]  = useState('')
  const [editId, setEditId] = useState<string | null>(null)
  // Domyślnie: po numerze, od najnowszego (numerycznie malejąco).
  const [sortCol, setSortCol] = useState<SortCol>('number')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const rawList = rows ?? []

  const list = useMemo(() => {
    const q = filter.toLowerCase().trim()
    let result = rawList
    if (q) {
      result = rawList.filter(r =>
        (r.number     || '').toLowerCase().includes(q) ||
        (r.clientName || '').toLowerCase().includes(q) ||
        (r.status     || '').toLowerCase().includes(q) ||
        (r.issueDate  || '').toLowerCase().includes(q)
      )
    }
    const cmp = compareRows(sortCol)
    return [...result].sort((a, b) => sortDir === 'asc' ? cmp(a, b) : -cmp(a, b))
  }, [rawList, filter, sortCol, sortDir])

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir(col === 'number' || col === 'createdAt' ? 'desc' : 'asc') }
  }

  const SortIcon = ({ col }: { col: SortCol }) =>
    sortCol === col
      ? (sortDir === 'asc' ? <ChevronUp size={11}/> : <ChevronDown size={11}/>)
      : <ChevronsUpDown size={11} className="opacity-30 group-hover:opacity-60"/>

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
                placeholder="Filtruj: numer, klient, status…"
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
          </div>

          {/* Inline KPI (Subiekt GT style) */}
          <div className="flex items-center gap-4 text-xs tabular-nums">
            <div className="flex items-center gap-1.5">
              <CardDescription className="text-[11px] font-bold uppercase tracking-wide">Dokumentów:</CardDescription>
              <span className="font-bold">{list.length}{list.length !== rawList.length && <span className="text-muted-foreground">/{rawList.length}</span>}</span>
            </div>
          </div>
        </div>
      </Card>

      {/* ── Tabela ─────────────────────────────────────── */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {[0,1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-8 w-full" />)}
          </div>
        ) : rawList.length === 0 ? (
          <CardContent className="flex flex-col items-center justify-center py-16 gap-2">
            <FileText size={36} className="text-muted-foreground opacity-20" />
            <CardTitle className="text-sm font-medium text-muted-foreground">Brak dokumentów CMR</CardTitle>
            <CardDescription>CMR wystawisz z listy zamówień (przycisk „CMR").</CardDescription>
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
                  {[
                    { col: 'number'     as SortCol, label: 'Nr CMR',           align: 'left'  },
                    { col: 'issueDate'  as SortCol, label: 'Data wystawienia',  align: 'left'  },
                    { col: 'clientName' as SortCol, label: 'Klient',            align: 'left'  },
                    { col: 'status'     as SortCol, label: 'Status',            align: 'left'  },
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
                  <th className="px-2.5 py-2 text-right text-[11px] font-bold uppercase tracking-wider text-ink-2 whitespace-nowrap">Akcje</th>
                </tr>
              </thead>
              <tbody>
                {list.map((r, idx) => (
                  <tr
                    key={r.id}
                    onClick={() => openPrint(r.id)}
                    className={cn(
                      'cursor-pointer border-b border-surface-3 transition-colors',
                      idx % 2 === 0 ? 'bg-white' : 'bg-surface-2/40',
                      'hover:bg-blue-50/60'
                    )}
                  >
                    <td className="px-2.5 py-2 whitespace-nowrap font-bold text-ink">
                      {r.number}
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap">{r.issueDate || '—'}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap font-medium">{r.clientName || '—'}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap">
                      <StatusBadge tone={DOC_TONE[r.status] ?? 'gray'} label={STATUS_LABEL[r.status] || r.status || '—'} />
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-right">
                      <div className="inline-flex items-center gap-0.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); setEditId(r.id) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-amber-600 hover:bg-amber-50"
                          title="Edytuj CMR"
                        >
                          <Pencil size={13}/>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); downloadPdf(r.id) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                          title="Pobierz PDF"
                        >
                          <FileDown size={13}/>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openPrint(r.id) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Drukuj"
                        >
                          <Printer size={13}/>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); openPrint(r.id) }}
                          className="inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:text-primary hover:bg-primary/10"
                          title="Otwórz dokument"
                        >
                          <ExternalLink size={13}/>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
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
