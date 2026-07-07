/**
 * AuditLogPage — Dziennik audytu (kto / co / kiedy). Tylko admin.
 *
 * Czysty odczyt z auditApi.list() — backend loguje wszystkie żądania
 * zmieniające stan (POST/PUT/PATCH/DELETE) z użytkownikiem, ścieżką i statusem.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { auditApi } from '@/lib/apiClient'
import { cn } from '@/lib/utils'
import { ShieldCheck, Search, User } from 'lucide-react'
import { StatusBadge, type StatusTone } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { DataTable } from '@/components/DataTable'

const METHOD_TONE: Record<string, StatusTone> = {
  POST: 'green', PUT: 'amber', PATCH: 'amber', DELETE: 'red',
}

function statusTone(code: number | null): StatusTone {
  if (code == null) return 'gray'
  if (code >= 500) return 'red'
  if (code >= 400) return 'amber'
  if (code >= 300) return 'blue'
  return 'green'
}

function fmtAt(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleString('pl-PL', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

export function AuditLogPage() {
  const { data, loading } = useApi<any[]>(() => auditApi.list(500))
  const rows: any[] = data || []

  return (
    <div className="min-h-full bg-surface-2">
      {/* Nagłówek */}
      <div className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur border-b border-surface-4 px-6 py-4">
        <div className="flex items-center gap-3 max-w-5xl mx-auto">
          <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
            <ShieldCheck size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold text-ink leading-tight">Dziennik audytu</h1>
            <p className="text-[12px] text-ink-3">Kto, co i kiedy zmienił — ostatnie 500 operacji</p>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : (
          <DataTable
            rows={rows} rowKey={r => r.id}
            searchText={r => `${r.subject ?? ''} ${r.method} ${r.path} ${r.status ?? ''} ${r.ip ?? ''}`}
            searchPlaceholder="Szukaj: użytkownik, ścieżka, IP…"
            initialSort={{ key: 'at', dir: 'desc' }}
            empty="Brak wpisów audytu"
            columns={[
              { key: 'at', header: 'Czas', sortable: true, sortValue: r => r.at || '',
                cell: r => <span className="font-mono text-ink-3 whitespace-nowrap">{fmtAt(r.at)}</span> },
              { key: 'subject', header: 'Użytkownik', sortable: true, sortValue: r => r.subject || '',
                cell: r => <span className="inline-flex items-center gap-1 font-semibold text-ink"><User size={12} className="text-ink-4" /> {r.subject || '—'}</span> },
              { key: 'method', header: 'Akcja', sortable: true, sortValue: r => r.method || '',
                cell: r => <StatusBadge tone={METHOD_TONE[r.method] ?? 'gray'} label={r.method} /> },
              { key: 'path', header: 'Ścieżka', sortable: true, sortValue: r => r.path || '',
                cell: r => <span className="font-mono text-ink-2 truncate block max-w-[280px]" title={r.path}>{r.path}</span> },
              { key: 'status', header: 'Status', sortable: true, sortValue: r => Number(r.status ?? 0),
                cell: r => <StatusBadge tone={statusTone(r.status)} label={String(r.status ?? '—')} /> },
              { key: 'ip', header: 'IP',
                cell: r => <span className="font-mono text-ink-4 whitespace-nowrap">{r.ip || '—'}</span> },
            ]}
          />
        )}
      </div>
    </div>
  )
}
