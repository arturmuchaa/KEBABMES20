import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchProductTypes, createProductType } from '@/api/index'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const EMPTY = { code: '', name: '', unit: 'szt' }

export function ProductTypesPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const { data: types = [], isLoading } = useQuery({
    queryKey: ['product-types'],
    queryFn: fetchProductTypes,
  })

  const { mutate: addType, isPending } = useMutation({
    mutationFn: createProductType,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['product-types'] })
      setForm(EMPTY)
      setShowForm(false)
      toast.success('Rodzaj produktu dodany')
    },
    onError: () => toast.error('Błąd podczas dodawania'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nazwa jest wymagana'); return }
    addType(form)
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Rodzaje produktów</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Anuluj' : '+ Dodaj rodzaj produktu'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-mes-surface border border-mes-border rounded-xl p-4 grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Kod</label>
            <input className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nazwa *</label>
            <input className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Jednostka</label>
            <select className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.unit} onChange={e => setForm(p => ({ ...p, unit: e.target.value }))}>
              <option value="szt">szt</option>
              <option value="kg">kg</option>
              <option value="op">op</option>
            </select>
          </div>
          <div className="col-span-3 flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" size="sm" onClick={() => setShowForm(false)}>Anuluj</Button>
            <Button type="submit" size="sm" disabled={isPending}>Zapisz</Button>
          </div>
        </form>
      )}

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Kod', 'Nazwa', 'Jednostka', 'Status'].map(h => (
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
            ) : (types as any[]).length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-500 text-sm">Brak rodzajów produktów</td></tr>
            ) : (types as any[]).map((t: any) => (
              <tr key={t.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-400 font-mono">{t.code || '—'}</td>
                <td className="px-4 py-3 text-slate-200 font-medium">{t.name}</td>
                <td className="px-4 py-3 text-slate-400">{t.unit}</td>
                <td className="px-4 py-3">
                  <Badge variant={t.active !== false ? 'green' : 'default'}>
                    {t.active !== false ? 'Aktywny' : 'Nieaktywny'}
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
