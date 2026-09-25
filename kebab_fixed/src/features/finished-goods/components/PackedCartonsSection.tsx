/**
 * Sekcja „Spakowane kebaby" — lista wszystkich utworzonych kartonów ze statusem
 * (do zapakowania / spakowany). Karton znika z listy gdy jego sztuki wyjadą.
 *
 * Kosz stoi WYŁĄCZNIE przy kartonie bez żadnej sztuki (25.09.2026: stary pusty
 * karton wisiał na panelu magazynu jako otwarty). Karton z choćby jedną
 * sztuką niesie traceability — tego serwer i tak nie pozwoli usunąć.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApi } from '@/hooks/useApi'
import { stockCartonsApi } from '@/lib/api'
import { formatCartonNo } from '@/lib/unitLocation'
import { useClientNames } from '@/lib/clientNames'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Box, Printer, Trash2 } from 'lucide-react'

export function PackedCartonsSection({ refreshKey = 0 }: { refreshKey?: number }) {
  const clientDisplay = useClientNames()
  const { data, loading, refetch } = useApi(() => stockCartonsApi.list(), [refreshKey])
  const cartons = data ?? []
  const [blad, setBlad] = useState('')

  async function usun(id: string, nr: string) {
    if (!confirm(`Usunąć pusty karton ${nr}? Zniknie też z panelu magazynu.`)) return
    setBlad('')
    try { await stockCartonsApi.removeEmpty(id); refetch() }
    catch (e) { setBlad(e instanceof Error ? e.message : 'Nie udało się usunąć kartonu') }
  }

  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
        <Box size={16} className="text-teal-600" /> Spakowane kebaby — kartony ({cartons.length})
      </div>
      {blad ? <div className="mb-2 rounded border border-red-200 bg-red-50 px-2 py-1 text-sm text-red-700">{blad}</div> : null}
      {loading ? (
        <div className="space-y-2">{[1, 2].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
      ) : cartons.length === 0 ? (
        <div className="py-4 text-center text-sm text-muted-foreground">Brak kartonów</div>
      ) : (
        <div className="divide-y">
          {cartons.map(c => {
            const full = c.packedQty >= c.targetQty
            const mixed = c.lines.length > 1
            // Skład: jednorodny → „Rodzaj · waga"; mieszany → „30×10kg + 20×15kg".
            const composition = mixed
              ? c.lines.map(l => `${l.targetQty}×${l.kgPerUnit}kg`).join(' + ')
              : `${c.productTypeName || c.recipeName} · ${c.kgPerUnit} kg`
            return (
              <div key={c.id} className="flex items-center gap-3 py-2">
                <span className="font-mono text-sm font-black text-teal-800">Karton {formatCartonNo(c.cartonNo)}</span>
                {mixed && (
                  <span className="shrink-0 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-violet-700">mix</span>
                )}
                <span className="min-w-0 truncate text-sm text-slate-700" title={composition}>
                  {clientDisplay(c.clientName)} · {composition}
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
                {c.packedQty === 0 ? (
                  <button type="button" onClick={() => usun(c.id, formatCartonNo(c.cartonNo))}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    title="Usuń pusty karton" aria-label={`Usuń pusty karton ${formatCartonNo(c.cartonNo)}`}>
                    <Trash2 size={15} />
                  </button>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
