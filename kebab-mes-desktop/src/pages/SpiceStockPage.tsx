import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchIngredientStock, fetchIngredients, createIngredientReceipt } from '@/api/index'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Package, AlertTriangle } from 'lucide-react'

const EMPTY = { ingredient_id: '', qty: '', invoice_no: '', notes: '' }

export function SpiceStockPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const { data: stock = [], isLoading } = useQuery({
    queryKey: ['ingredient-stock'],
    queryFn: fetchIngredientStock,
  })

  const { data: ingredients = [] } = useQuery({
    queryKey: ['ingredients'],
    queryFn: fetchIngredients,
  })

  const { mutate: addReceipt, isPending } = useMutation({
    mutationFn: createIngredientReceipt,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ingredient-stock'] })
      setForm(EMPTY)
      setShowForm(false)
      toast.success('Przyjęcie składnika zapisane')
    },
    onError: () => toast.error('Błąd podczas przyjęcia składnika'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.ingredient_id || !form.qty) { toast.error('Wybierz składnik i podaj ilość'); return }
    addReceipt({ ...form, qty: Number(form.qty) })
  }

  const stockArr = stock as any[]
  const lowStockCount = stockArr.filter((s: any) => Number(s.qty_available ?? s.stock ?? 0) < 5).length

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Przyprawy i dodatki</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Anuluj' : '+ Przyjęcie składnika'}
        </Button>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 gap-4">
        <KpiCard
          label="Składniki w magazynie"
          value={stockArr.length}
          icon={<Package size={16} />}
          accent="blue"
        />
        <KpiCard
          label="Niski stan"
          value={lowStockCount}
          icon={<AlertTriangle size={16} />}
          accent={lowStockCount > 0 ? 'red' : 'green'}
        />
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-mes-surface border border-mes-border rounded-xl p-4 grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Składnik *</label>
            <select
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.ingredient_id}
              onChange={e => setForm(p => ({ ...p, ingredient_id: e.target.value }))}
            >
              <option value="">— wybierz —</option>
              {(ingredients as any[]).map((ing: any) => (
                <option key={ing.id} value={ing.id}>{ing.name} ({ing.unit})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Ilość *</label>
            <input type="number" step="0.001"
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.qty} onChange={e => setForm(p => ({ ...p, qty: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nr faktury</label>
            <input className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.invoice_no} onChange={e => setForm(p => ({ ...p, invoice_no: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Uwagi</label>
            <input className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" size="sm" onClick={() => setShowForm(false)}>Anuluj</Button>
            <Button type="submit" size="sm" disabled={isPending}>Przyjmij</Button>
          </div>
        </form>
      )}

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Składnik', 'Jednostka', 'Stan magazynowy', 'Ostatnie przyjęcie'].map(h => (
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
            ) : stockArr.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Brak danych o składnikach</td></tr>
            ) : stockArr.map((s: any) => {
              const qty = Number(s.qty_available ?? s.stock ?? 0)
              const isLow = qty < 5
              return (
                <tr key={s.id || s.ingredient_id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                  <td className="px-4 py-3 text-slate-200 font-medium">{s.name || s.ingredient_name}</td>
                  <td className="px-4 py-3 text-slate-400">{s.unit}</td>
                  <td className={`px-4 py-3 font-mono font-semibold ${isLow ? 'text-red-400' : 'text-slate-200'}`}>
                    {qty.toFixed(3)}
                  </td>
                  <td className="px-4 py-3 text-slate-400">{s.last_receipt_date ? s.last_receipt_date.substring(0, 10) : '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
