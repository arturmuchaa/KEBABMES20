/**
 * Sekcja „Spakowane kebaby" — lista wszystkich utworzonych kartonów ze statusem
 * (do zapakowania / spakowany). Karton znika z listy gdy jego sztuki wyjadą.
 */
import { Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { stockCartonsApi } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { useClientNames } from '@/lib/clientNames'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Box, Printer } from 'lucide-react'

export function PackedCartonsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const clientDisplay = useClientNames()
  const { data, loading } = useApi(() => stockCartonsApi.list(), [refreshKey])
  const cartons = data ?? []

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
        <Box size={16} className="text-teal-600" /> Spakowane kebaby — kartony ({cartons.length})
      </div>
      {loading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : cartons.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">Brak kartonów</div>
      ) : (
        <div className="divide-y">
          {cartons.map(c => {
            const full = c.packedQty >= c.targetQty
            return (
              <div key={c.id} className="flex items-center gap-3 py-2">
                <span className="font-mono text-sm font-black text-teal-800">Karton {formatCartonNo(c.cartonNo)}</span>
                <span className="min-w-0 truncate text-sm text-slate-700">
                  {clientDisplay(c.clientName)} · {c.productTypeName || c.recipeName} · {c.kgPerUnit} kg
                </span>
                <span className="ml-auto text-sm font-bold tabular-nums text-slate-600">
                  {c.packedQty}/{c.targetQty}
                </span>
                <span className={`rounded-md px-2 py-0.5 text-[11px] font-semibold ${
                  full ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>
                  {full ? 'Spakowany' : 'Do zapakowania'}
                </span>
                <Link
                  to={`/etykiety/karton/${c.id}`}
                  target="_blank"
                  className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                  title="Drukuj etykietę"
                >
                  <Printer size={15} />
                </Link>
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
