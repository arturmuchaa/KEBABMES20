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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'

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
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const all = data || []
    if (!q.trim()) return all
    const needle = q.trim().toLowerCase()
    return all.filter(r =>
      `${r.subject ?? ''} ${r.method} ${r.path} ${r.status ?? ''} ${r.ip ?? ''}`.toLowerCase().includes(needle),
    )
  }, [data, q])

  return (
    <div className="min-h-full bg-surface-2">
      {/* Nagłówek */}
      <div className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur border-b border-surface-4 px-6 py-4">
        <div className="flex items-center justify-between gap-4 max-w-5xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
              <ShieldCheck size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-ink leading-tight">Dziennik audytu</h1>
              <p className="text-[12px] text-ink-3">Kto, co i kiedy zmienił — ostatnie 500 operacji</p>
            </div>
          </div>
          <div className="relative w-64">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-4" />
            <Input value={q} onChange={e => setQ(e.target.value)} aria-label="Szukaj w dzienniku audytu"
              placeholder="Szukaj: użytkownik, ścieżka, IP…" className="pl-9 h-9 bg-white" />
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6">
        {loading ? (
          <div className="space-y-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10 rounded-lg" />)}
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-14 h-14 rounded-2xl bg-surface-3 flex items-center justify-center mb-3">
              <ShieldCheck size={26} className="text-ink-4" />
            </div>
            <div className="text-lg font-bold text-ink-2">{q ? 'Brak wyników' : 'Brak wpisów audytu'}</div>
          </div>
        ) : (
          <div className="rounded-xl border border-surface-4 bg-white overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead className="bg-surface-2 border-b border-surface-4">
                <tr className="text-[11px] uppercase tracking-wider text-ink-4 font-bold">
                  <th className="text-left px-3 py-2 whitespace-nowrap">Czas</th>
                  <th className="text-left px-3 py-2">Użytkownik</th>
                  <th className="text-left px-3 py-2">Akcja</th>
                  <th className="text-left px-3 py-2">Ścieżka</th>
                  <th className="text-left px-3 py-2">Status</th>
                  <th className="text-left px-3 py-2 whitespace-nowrap">IP</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className={cn('border-b border-surface-3 last:border-0', i % 2 ? 'bg-surface-2/40' : 'bg-white')}>
                    <td className="px-3 py-1.5 font-mono text-ink-3 tabular-nums whitespace-nowrap">{fmtAt(r.at)}</td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1 font-semibold text-ink">
                        <User size={12} className="text-ink-4" /> {r.subject || '—'}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={METHOD_TONE[r.method] ?? 'gray'} label={r.method} />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-ink-2 truncate max-w-[280px]" title={r.path}>{r.path}</td>
                    <td className="px-3 py-1.5">
                      <StatusBadge tone={statusTone(r.status)} label={String(r.status ?? '—')} />
                    </td>
                    <td className="px-3 py-1.5 font-mono text-ink-4 tabular-nums whitespace-nowrap">{r.ip || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
