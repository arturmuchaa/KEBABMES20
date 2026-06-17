/**
 * AnalitykaPage — trendy KPI: uzysk masowania %, wolumen (kg/szt), koszt mięsa/kg.
 * Zakres dat + granulacja dzień/tydzień/miesiąc. Wykresy: recharts.
 */
import { useMemo, useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { analyticsApi } from '@/lib/apiClient'
import { fmtKg, cn } from '@/lib/utils'
import { BarChart3, TrendingUp, Coins, Layers } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  ResponsiveContainer, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, Tooltip, CartesianGrid, Legend,
} from 'recharts'

type Gran = 'day' | 'week' | 'month'
const GRANS: { key: Gran; label: string }[] = [
  { key: 'day', label: 'Dzień' }, { key: 'week', label: 'Tydzień' }, { key: 'month', label: 'Miesiąc' },
]

function isoDaysAgo(n: number): string {
  const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10)
}
function sum(rows: any[], key: string): number {
  return (rows || []).reduce((s, r) => s + Number(r[key] || 0), 0)
}

function KpiCard({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-surface-4 bg-white p-4 shadow-card">
      <div className="flex items-center gap-2 text-ink-3 text-[12px] font-semibold">
        <span className="text-brand">{icon}</span>{label}
      </div>
      <div className="mt-1 text-2xl font-extrabold text-ink tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-ink-3 mt-0.5">{sub}</div>}
    </div>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-surface-4 bg-white p-4 shadow-card">
      <div className="text-[13px] font-bold text-ink mb-3">{title}</div>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>{children as any}</ResponsiveContainer>
      </div>
    </div>
  )
}

export function AnalitykaPage() {
  const [from, setFrom] = useState(isoDaysAgo(30))
  const [to, setTo] = useState(isoDaysAgo(0))
  const [g, setG] = useState<Gran>('day')

  const yieldQ = useApi<any[]>(() => analyticsApi.mixingYield(from, to, g), [from, to, g])
  const volQ = useApi<any[]>(() => analyticsApi.volume(from, to, g), [from, to, g])
  const costQ = useApi<any[]>(() => analyticsApi.costTrend(from, to, g), [from, to, g])

  const yieldRows = yieldQ.data || []
  const volRows = volQ.data || []
  const costRows = costQ.data || []

  const avgYield = useMemo(() => {
    const m = sum(yieldRows, 'kgMeat'); const o = sum(yieldRows, 'kgOutput')
    return m > 0 ? (o / m) * 100 : 0
  }, [yieldRows])
  const totalSeasoned = sum(volRows, 'kgSeasoned')
  const totalUnits = sum(volRows, 'unitsProduced')
  const lastCost = costRows.length ? Number(costRows[costRows.length - 1].rawCostPerKg) : 0

  return (
    <div className="min-h-full bg-surface-2">
      <div className="sticky top-0 z-10 bg-surface-2/90 backdrop-blur border-b border-surface-4 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-sm">
              <BarChart3 size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-xl font-extrabold text-ink leading-tight">Analityka</h1>
              <p className="text-[12px] text-ink-3">Trendy: uzysk masowania, wolumen, koszt mięsa/kg</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Data od" className="h-8 w-36 bg-white text-[12px]" />
            <span className="text-ink-4">—</span>
            <Input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Data do" className="h-8 w-36 bg-white text-[12px]" />
            <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-surface-3 border border-surface-4">
              {GRANS.map(t => (
                <button key={t.key} type="button" aria-pressed={g === t.key} onClick={() => setG(t.key)}
                  className={cn('h-7 px-3 rounded-md text-[12px] font-semibold cursor-pointer transition-colors',
                    g === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-3 hover:text-ink')}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-6 py-6 space-y-5">
        {/* Karty KPI */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <KpiCard icon={<TrendingUp size={15} />} label="Śr. uzysk masowania" value={`${avgYield.toFixed(1)} %`} sub="w wybranym zakresie" />
          <KpiCard icon={<Layers size={15} />} label="Wyprodukowane" value={`${fmtKg(totalSeasoned, 0)} kg`} sub={`${totalUnits} szt wyrobu`} />
          <KpiCard icon={<Coins size={15} />} label="Koszt mięsa/kg (ost.)" value={`${lastCost.toFixed(2)} zł`} sub="ważona cena surowca" />
        </div>

        {/* Wykresy */}
        <ChartCard title="Uzysk masowania % w czasie">
          <LineChart data={yieldRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit="%" />
            <Tooltip />
            <Line type="monotone" dataKey="yieldPct" name="Uzysk %" stroke="#1D4ED8" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>

        <ChartCard title="Wolumen — kg przyprawionego / szt wyrobu">
          <BarChart data={volRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            <Bar dataKey="kgSeasoned" name="kg przyprawione" fill="#1D4ED8" radius={[3, 3, 0, 0]} />
            <Bar dataKey="unitsProduced" name="szt wyrobu" fill="#D97706" radius={[3, 3, 0, 0]} />
          </BarChart>
        </ChartCard>

        <ChartCard title="Koszt mięsa/kg (ważona cena surowca)">
          <LineChart data={costRows} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
            <XAxis dataKey="period" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} unit=" zł" />
            <Tooltip />
            <Line type="monotone" dataKey="rawCostPerKg" name="zł/kg" stroke="#059669" strokeWidth={2} dot={false} />
          </LineChart>
        </ChartCard>
      </div>
    </div>
  )
}
