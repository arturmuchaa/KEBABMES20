import { Link } from 'react-router-dom'
import { ArrowLeft, Truck, Building2, Users } from 'lucide-react'
import { useApi } from '@/hooks/useApi'
import { vehiclesApi, type Vehicle } from '@/lib/api'

function VehicleTile({ v }: { v: Vehicle }) {
  const isOwn = v.kind === 'own'
  const color = isOwn ? 'bg-emerald-500 hover:bg-emerald-600' : 'bg-indigo-500 hover:bg-indigo-600'
  return (
    <Link
      to={`/mobile/zaladunek/${v.id}`}
      className={`flex flex-col gap-2 rounded-2xl ${color} px-5 py-5 text-left text-white shadow-lg active:scale-[0.99]`}
    >
      <div className="flex items-center justify-between text-white/95">
        <div className="inline-flex items-center gap-1 rounded-full bg-white/25 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide">
          {isOwn ? <Building2 size={12} /> : <Users size={12} />}
          {isOwn ? 'Firmowy' : 'Spedycja'}
        </div>
        <Truck size={20} className="opacity-90" />
      </div>
      <div className="text-xl font-bold leading-tight">{v.name}</div>
      {v.plate && (
        <div className="font-mono text-base font-semibold uppercase tracking-wider text-white/95">
          {v.plate}
        </div>
      )}
      {v.notes && <div className="text-xs text-white/85">{v.notes}</div>}
    </Link>
  )
}

export function MobileVehiclePickerPage() {
  const res = useApi(() => vehiclesApi.list(false), [])
  const items = (res.data ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder)

  return (
    <div className="flex min-h-screen flex-col bg-slate-50 text-slate-900">
      <header className="flex items-center justify-between border-b border-amber-200 bg-amber-500 px-4 py-3 text-white shadow-sm">
        <Link to="/mobile" className="flex items-center gap-1 text-sm font-semibold text-amber-50 hover:text-white">
          <ArrowLeft size={16} /> Wstecz
        </Link>
        <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
          <Truck size={18} /> Wybierz samochód
        </div>
        <div className="w-12" />
      </header>

      <main className="flex flex-1 flex-col gap-3 p-3">
        {res.loading && <div className="py-10 text-center text-sm text-slate-500">Ładowanie…</div>}
        {!res.loading && items.length === 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-600 shadow-sm">
            Brak zdefiniowanych samochodów.<br />
            Dodaj je w panelu biuro → <span className="font-semibold">Administracja → Samochody</span>.
          </div>
        )}
        {items.map((v) => <VehicleTile key={v.id} v={v} />)}
      </main>

      <footer className="border-t border-slate-200 bg-white px-4 py-2 text-center text-xs text-slate-500">
        Kebab MES · skan QR
      </footer>
    </div>
  )
}
