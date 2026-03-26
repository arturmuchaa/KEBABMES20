import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRecipes } from '@/api/index'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronDown, ChevronRight } from 'lucide-react'

export function RecipesPage() {
  const [expanded, setExpanded] = useState<string | null>(null)

  const { data: recipes = [], isLoading } = useQuery({
    queryKey: ['recipes'],
    queryFn: fetchRecipes,
  })

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-base font-semibold text-slate-200">Receptury</h2>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Nazwa receptury', 'Rodzaj produktu', 'Składniki', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 4 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : (recipes as any[]).length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Brak receptur</td></tr>
            ) : (recipes as any[]).map((r: any) => (
              <>
                <tr
                  key={r.id}
                  className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors cursor-pointer"
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                >
                  <td className="px-4 py-3 text-slate-200 font-medium">
                    <div className="flex items-center gap-2">
                      {expanded === r.id ? <ChevronDown size={14} className="text-slate-400" /> : <ChevronRight size={14} className="text-slate-400" />}
                      {r.name}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-400">{r.product_type_name || r.product_type_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-400">{(r.ingredients || []).length} szt.</td>
                  <td className="px-4 py-3">
                    <Badge variant={r.active !== false ? 'green' : 'default'}>
                      {r.active !== false ? 'Aktywna' : 'Nieaktywna'}
                    </Badge>
                  </td>
                </tr>
                {expanded === r.id && (r.ingredients || []).length > 0 && (
                  <tr key={`${r.id}-expanded`} className="border-b border-mes-border/50 bg-mes-elevated/20">
                    <td colSpan={4} className="px-8 py-3">
                      <div className="text-xs text-slate-400 font-semibold uppercase tracking-wide mb-2">Składniki (na 100 kg mięsa)</div>
                      <div className="grid grid-cols-3 gap-2">
                        {(r.ingredients as any[]).map((ing: any) => (
                          <div key={ing.id || ing.ingredient_id} className="flex justify-between bg-mes-elevated rounded px-3 py-1.5">
                            <span className="text-slate-300">{ing.ingredient_name || ing.name}</span>
                            <span className="text-slate-400 font-mono">
                              {ing.is_unlimited ? '∞' : `${ing.qty_per_100kg} ${ing.unit}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
