import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Factory, Plus } from 'lucide-react'
import { fetchProductionPlans, createProductionPlan } from '@/api'
import { Button } from '@/components/ui/button'
import { SkeletonTable } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/badge'
import { fmtKg, fmtDate } from '@/lib/utils'
import { toast } from 'sonner'

export function ProductionPlanPage() {
  const qc = useQueryClient()
  const { data: plans = [], isLoading } = useQuery({ queryKey: ['production-plans'], queryFn: fetchProductionPlans })
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ plan_date: '', product_name: '', kg_planned: '', notes: '' })

  const add = useMutation({
    mutationFn: () => createProductionPlan({
      plan_date: form.plan_date,
      product_name: form.product_name,
      kg_planned: Number(form.kg_planned),
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      toast.success('Plan produkcji dodany')
      qc.invalidateQueries({ queryKey: ['production-plans'] })
      setForm({ plan_date: '', product_name: '', kg_planned: '', notes: '' })
      setShowForm(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Błąd'),
  })

  return (
    <div className="space-y-4 max-w-6xl animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Factory size={16} className="text-mes-accent" />
          <h1 className="text-base font-semibold text-slate-200">Planowanie produkcji</h1>
        </div>
        <Button size="sm" onClick={() => setShowForm(s => !s)}><Plus size={14} /> Nowy plan</Button>
      </div>

      {showForm && (
        <div className="bg-mes-surface border border-mes-border rounded-xl p-4 flex flex-wrap gap-3 items-end">
          {[
            { label: 'Data', type: 'date', key: 'plan_date', w: 'w-40' },
            { label: 'Produkt', type: 'text', key: 'product_name', w: 'w-52', ph: 'Kebab klasyczny' },
            { label: 'Kg planowane', type: 'number', key: 'kg_planned', w: 'w-32', ph: '1000' },
            { label: 'Uwagi', type: 'text', key: 'notes', w: 'w-52', ph: 'Opcjonalnie' },
          ].map(f => (
            <div key={f.key} className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">{f.label}</label>
              <input type={f.type} value={(form as any)[f.key]} placeholder={f.ph}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
                className={`h-9 px-3 text-sm bg-mes-bg border border-mes-border rounded-lg text-slate-200 focus:outline-none focus:border-mes-accent ${f.w}`} />
            </div>
          ))}
          <Button size="sm" onClick={() => add.mutate()} loading={add.isPending}
            disabled={!form.plan_date || !form.product_name || !form.kg_planned}>Zapisz</Button>
          <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Anuluj</Button>
        </div>
      )}

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        {isLoading ? <SkeletonTable rows={6} /> : plans.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">Brak planów produkcji</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mes-border text-slate-500 text-xs">
                {['Nr planu', 'Data', 'Produkt', 'Kg planowane', 'Status', 'Uwagi'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-mes-border/50">
              {plans.map((p: any) => (
                <tr key={p.id} className="hover:bg-mes-elevated/40 transition-colors">
                  <td className="px-4 py-3 font-mono text-mes-accent-l">{p.plan_no || p.id?.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-slate-300">{fmtDate(p.plan_date)}</td>
                  <td className="px-4 py-3 font-semibold text-slate-200">{p.product_name || p.productName || '—'}</td>
                  <td className="px-4 py-3 font-mono tabular-nums">{fmtKg(p.kg_planned || p.kgPlanned)}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.status || 'pending'} /></td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{p.notes || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
