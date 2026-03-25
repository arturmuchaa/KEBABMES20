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
    <div className="p-6 max-w-5xl">
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-white">Produkty uboczne — Kości / Grzbiety</h1>
        <button
          onClick={load}
          className="text-gray-400 hover:text-white p-1"
          title="Odśwież"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-white">{rows.length}</div>
          <div className="text-xs text-gray-400 mt-1">Łączna liczba partii</div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-gray-200">{fmtKg(totalBones)}</div>
          <div className="text-xs text-gray-400 mt-1">Kości ogółem</div>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-amber-300">{fmtKg(totalBacks)}</div>
          <div className="text-xs text-gray-400 mt-1">Grzbiety ogółem</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-4">
        {(['ALL', 'BONES', 'BACKS'] as const).map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
              filter === t
                ? 'bg-blue-600 text-white'
                : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
            }`}
          >
            {t === 'ALL' ? 'Wszystkie' : t === 'BONES' ? 'Kości' : 'Grzbiety'}
          </button>
        ))}
      </div>

      {error && (
        <div className="bg-red-900/40 border border-red-700 rounded p-3 text-red-200 text-sm mb-4">
          {error}
        </div>
      )}

      {loading && (
        <div className="text-gray-400 text-sm py-8 text-center flex items-center justify-center gap-2">
          <RefreshCw size={14} className="animate-spin" /> Ładowanie…
        </div>
      )}

      {!loading && rows.length === 0 && !error && (
        <div className="text-gray-500 text-center py-12 text-sm">
          Brak wpisów produktów ubocznych.
          <br />
          <span className="text-xs">Uzupełnij kg kości / grzbietów w tabletce rozbioru.</span>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-gray-400 text-xs border-b border-gray-700">
                <th className="text-left py-2.5 px-4">Typ</th>
                <th className="text-right py-2.5 px-4">Masa</th>
                <th className="text-left py-2.5 px-4">Partia surowca</th>
                <th className="text-left py-2.5 px-4">Pracownik</th>
                <th className="text-left py-2.5 px-4">Dostawca</th>
                <th className="text-left py-2.5 px-4">Data uboju</th>
                <th className="text-left py-2.5 px-4">Data wpisu</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700">
              {rows.map((r: any, i) => (
                <tr key={r.id || i} className="text-gray-200 hover:bg-gray-750">
                  <td className="py-2.5 px-4">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                      r.type === 'BONES'
                        ? 'bg-gray-600 text-gray-200'
                        : 'bg-amber-800 text-amber-100'
                    }`}>
                      {r.type === 'BONES' ? 'Kości' : 'Grzbiety'}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-right font-mono">{fmtKg(r.weight)}</td>
                  <td className="py-2.5 px-4 font-mono text-blue-300">{r.raw_batch_no || '—'}</td>
                  <td className="py-2.5 px-4">{r.worker_name || '—'}</td>
                  <td className="py-2.5 px-4 text-gray-300">{r.supplier_name || '—'}</td>
                  <td className="py-2.5 px-4 text-gray-400">{fmtDate(r.slaughter_date)}</td>
                  <td className="py-2.5 px-4 text-gray-400">{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary by day */}
      {summary.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-gray-300 mb-3">Podsumowanie per dzień</h2>
          <div className="bg-gray-800 border border-gray-700 rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 text-xs border-b border-gray-700">
                  <th className="text-left py-2 px-4">Data</th>
                  <th className="text-left py-2 px-4">Typ</th>
                  <th className="text-right py-2 px-4">Liczba partii</th>
                  <th className="text-right py-2 px-4">Masa łączna</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {summary.map((s: any, i) => (
                  <tr key={i} className="text-gray-200">
                    <td className="py-2 px-4">{fmtDate(s.date)}</td>
                    <td className="py-2 px-4">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                        s.type === 'BONES' ? 'bg-gray-600 text-gray-200' : 'bg-amber-800 text-amber-100'
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
