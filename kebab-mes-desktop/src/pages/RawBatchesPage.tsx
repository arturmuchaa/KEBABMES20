import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchRawBatchesAll, createRawBatch, fetchSuppliers } from '@/api/index'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtKg } from '@/lib/utils'

const EMPTY = {
  supplier_id: '',
  supplier_batch_no: '',
  slaughter_date: '',
  received_date: new Date().toISOString().substring(0, 10),
  expiry_date: '',
  kg_received: '',
  price_per_kg: '',
  invoice_no: '',
  notes: '',
}

export function RawBatchesPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const { data: batches = [], isLoading } = useQuery({
    queryKey: ['raw-batches-all'],
    queryFn: fetchRawBatchesAll,
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: fetchSuppliers,
  })

  const { mutate: addBatch, isPending } = useMutation({
    mutationFn: createRawBatch,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['raw-batches-all'] })
      qc.invalidateQueries({ queryKey: ['raw-batches'] })
      setForm(EMPTY)
      setShowForm(false)
      toast.success('Partia przyjęta')
    },
    onError: () => toast.error('Błąd przyjęcia partii'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.kg_received) { toast.error('Podaj wagę'); return }
    addBatch({
      ...form,
      kg_received: Number(form.kg_received),
      price_per_kg: form.price_per_kg ? Number(form.price_per_kg) : undefined,
    })
  }

  // Sort FEFO
  const sorted = [...(batches as any[])].sort((a, b) =>
    (a.expiry_date || '').localeCompare(b.expiry_date || '')
  )

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Przyjęcie ćwiartek (surowiec)</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Anuluj' : '+ Przyjmij partię'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-mes-surface border border-mes-border rounded-xl p-4 grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Dostawca</label>
            <select
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.supplier_id}
              onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value }))}
            >
              <option value="">— wybierz —</option>
              {(suppliers as any[]).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nr partii dostawcy</label>
            <input className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.supplier_batch_no} onChange={e => setForm(p => ({ ...p, supplier_batch_no: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Data uboju</label>
            <input type="date" className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.slaughter_date} onChange={e => setForm(p => ({ ...p, slaughter_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Data przyjęcia</label>
            <input type="date" className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.received_date} onChange={e => setForm(p => ({ ...p, received_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Data ważności</label>
            <input type="date" className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.expiry_date} onChange={e => setForm(p => ({ ...p, expiry_date: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Kg przyjęte *</label>
            <input type="number" step="0.001" className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.kg_received} onChange={e => setForm(p => ({ ...p, kg_received: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cena/kg</label>
            <input type="number" step="0.01" className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.price_per_kg} onChange={e => setForm(p => ({ ...p, price_per_kg: e.target.value }))} />
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
          <div className="col-span-3 flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" size="sm" onClick={() => setShowForm(false)}>Anuluj</Button>
            <Button type="submit" size="sm" disabled={isPending}>Przyjmij</Button>
          </div>
        </form>
      )}

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Nr partii', 'Dostawca', 'Data uboju', 'Data przyjęcia', 'Data ważności', 'Kg przyjęte', 'Kg dostępne', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 8 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : sorted.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-500 text-sm">Brak partii surowca</td></tr>
            ) : sorted.map((b: any) => (
              <tr key={b.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-200 font-medium font-mono">{b.internal_batch_no || b.id}</td>
                <td className="px-4 py-3 text-slate-400">{b.supplier_name || b.supplier_id || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(b.slaughter_date)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(b.received_date)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(b.expiry_date)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtKg(b.kg_received)}</td>
                <td className="px-4 py-3 text-slate-200">{fmtKg(b.kg_available)}</td>
                <td className="px-4 py-3">
                  <Badge variant={b.status === 'AVAILABLE' ? 'green' : b.status === 'USED' ? 'default' : 'amber'}>
                    {b.status}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
