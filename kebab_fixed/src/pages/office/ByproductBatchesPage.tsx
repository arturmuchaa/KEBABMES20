/**
 * ByproductBatchesPage — lista i statystyki produktów ubocznych (kości / grzbiety)
 * /office/magazyn/produkty-uboczne
 */
import { useState, useEffect } from 'react'
import { RefreshCw } from 'lucide-react'

const API = (import.meta as any).env?.VITE_API_URL || ''

async function fetchByproducts(type = '') {
  const q = type ? `?type=${encodeURIComponent(type)}` : ''
  const res = await fetch(`${API}/api/byproducts${q}`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

async function fetchSummary() {
  const res = await fetch(`${API}/api/byproducts/summary`)
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function fmtKg(v: any) {
  if (v == null) return '—'
  return `${Number(v).toFixed(3)} kg`
}

function fmtDate(v: any) {
  if (!v) return '—'
  return String(v).substring(0, 10)
}

export function ByproductBatchesPage() {
  const [rows, setRows]       = useState<any[]>([])
  const [summary, setSummary] = useState<any[]>([])
  const [filter, setFilter]   = useState<'ALL' | 'BONES' | 'BACKS'>('ALL')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  function load() {
    setLoading(true)
    setError(null)
    Promise.all([
      fetchByproducts(filter === 'ALL' ? '' : filter),
      fetchSummary(),
    ])
      .then(([data, sumData]) => {
        setRows(data)
        setSummary(sumData)
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(load, [filter])

  // Sumy
  const totalBones = rows
    .filter(r => r.type === 'BONES')
    .reduce((s, r) => s + Number(r.weight || 0), 0)
  const totalBacks = rows
    .filter(r => r.type === 'BACKS')
    .reduce((s, r) => s + Number(r.weight || 0), 0)

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <h1 className="text-[15px] font-semibold text-ink">Produkty uboczne — Kości / Grzbiety</h1>
        <button
          onClick={load}
          className="text-ink-4 hover:text-ink p-1 rounded transition-colors"
          title="Odśwież"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-surface border border-surface-4 rounded-xl p-4 text-center shadow-card">
          <div className="text-2xl font-bold text-ink">{rows.length}</div>
          <div className="text-xs text-ink-4 mt-1">Łączna liczba partii</div>
        </div>
        <div className="bg-surface border border-surface-4 rounded-xl p-4 text-center shadow-card">
          <div className="text-2xl font-bold text-ink">{fmtKg(totalBones)}</div>
          <div className="text-xs text-ink-4 mt-1">Kości ogółem</div>
        </div>
        <div className="bg-surface border border-surface-4 rounded-xl p-4 text-center shadow-card">
          <div className="text-2xl font-bold text-amber-600">{fmtKg(totalBacks)}</div>
          <div className="text-xs text-ink-4 mt-1">Grzbiety ogółem</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['ALL', 'BONES', 'BACKS'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === t
                ? 'bg-brand text-white shadow-sm'
                : 'bg-surface border border-surface-4 text-ink-3 hover:bg-surface-3 hover:text-ink'
            }`}
          >
            {t === 'ALL' ? 'Wszystkie' : t === 'BONES' ? 'Kości' : 'Grzbiety'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 text-danger text-sm">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-ink-4 text-sm py-8 text-center flex items-center justify-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> Ładowanie…
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-ink-4 text-center py-12 text-sm">
          Brak wpisów produktów ubocznych.
          <br />
          <span className="text-xs text-ink-5">Uzupełnij kg kości / grzbietów w tabletce rozbioru.</span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-surface border border-surface-4 rounded-xl overflow-hidden shadow-card">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-3 border-b border-surface-4 text-[10px] font-bold uppercase tracking-wider text-ink-3">
                <th className="text-left py-2.5 px-4">Typ</th>
                <th className="text-right py-2.5 px-4">Masa</th>
                <th className="text-left py-2.5 px-4">Partia surowca</th>
                <th className="text-left py-2.5 px-4">Pracownik</th>
                <th className="text-left py-2.5 px-4">Dostawca</th>
                <th className="text-left py-2.5 px-4">Data uboju</th>
                <th className="text-left py-2.5 px-4">Data wpisu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {rows.map((r: any, i) => (
                <tr key={r.id || i} className={`transition-colors hover:bg-brand-light ${i % 2 === 1 ? 'bg-surface-2/40' : ''}`}>
                  <td className="py-2.5 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ring-1 ${
                      r.type === 'BONES'
                        ? 'bg-slate-100 text-slate-600 ring-slate-200'
                        : 'bg-amber-50 text-amber-700 ring-amber-200'
                    }`}>
                      {r.type === 'BONES' ? 'Kości' : 'Grzbiety'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono text-ink">{fmtKg(r.weight)}</td>
                  <td className="py-2.5 px-4 font-mono text-brand font-semibold">{r.raw_batch_no || '—'}</td>
                  <td className="py-2.5 px-4 text-ink-2">{r.worker_name || '—'}</td>
                  <td className="py-2.5 px-4 text-ink-3">{r.supplier_name || '—'}</td>
                  <td className="py-2.5 px-4 text-ink-3">{fmtDate(r.slaughter_date)}</td>
                  <td className="py-2.5 px-4 text-ink-3">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary by day */}
      {summary.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-ink mb-3">Podsumowanie per dzień</h2>
          <div className="bg-surface border border-surface-4 rounded-xl overflow-hidden shadow-card">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="bg-surface-3 border-b border-surface-4 text-[10px] font-bold uppercase tracking-wider text-ink-3">
                  <th className="text-left py-2.5 px-4">Data</th>
                  <th className="text-left py-2.5 px-4">Typ</th>
                  <th className="text-right py-2.5 px-4">Liczba partii</th>
                  <th className="text-right py-2.5 px-4">Masa łączna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-4">
                {summary.map((s: any, i) => (
                  <tr key={i} className={`text-ink-2 ${i % 2 === 1 ? 'bg-surface-2/40' : ''}`}>
                    <td className="py-2 px-4">{fmtDate(s.date)}</td>
                    <td className="py-2 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ring-1 ${
                        s.type === 'BONES'
                          ? 'bg-slate-100 text-slate-600 ring-slate-200'
                          : 'bg-amber-50 text-amber-700 ring-amber-200'
                      }`}>
                        {s.type === 'BONES' ? 'Kości' : 'Grzbiety'}
                      </span>
                    </td>
                    <td className="py-2 px-4 text-right">{s.count}</td>
                    <td className="py-2 px-4 text-right font-mono">{fmtKg(s.total_kg)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
