import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchPackagingAll, createPackaging, usePackaging as apiUsePackaging } from '@/api/index'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const EMPTY = { name: '', type: '', description: '', qty: '' }

export function PackagingPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [useQty, setUseQty] = useState<Record<string, string>>({})

  const { data: packaging = [], isLoading } = useQuery({
    queryKey: ['packaging'],
    queryFn: fetchPackagingAll,
  })

  const { mutate: addPkg, isPending } = useMutation({
    mutationFn: createPackaging,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packaging'] })
      setForm(EMPTY)
      setShowForm(false)
      toast.success('Opakowanie dodane')
    },
    onError: () => toast.error('Błąd dodawania opakowania'),
  })

  const { mutate: usePkg } = useMutation({
    mutationFn: ({ id, qty }: { id: string; qty: number }) => apiUsePackaging(id, qty),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['packaging'] })
      toast.success('Użyto opakowań')
    },
    onError: () => toast.error('Błąd podczas użycia opakowań'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nazwa jest wymagana'); return }
    addPkg({ ...form, qty: form.qty ? Number(form.qty) : 0 })
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Opakowania / Tuleje</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Anuluj' : '+ Dodaj opakowanie'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-mes-surface border border-mes-border rounded-xl p-4 grid grid-cols-2 gap-3">
          {[
            { key: 'name', label: 'Nazwa *' },
            { key: 'type', label: 'Typ' },
            { key: 'description', label: 'Opis' },
            { key: 'qty', label: 'Stan początkowy' },
          ].map(f => (
            <div key={f.key}>
              <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
              <input
                type={f.key === 'qty' ? 'number' : 'text'}
                className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
                value={(form as any)[f.key]}
                onChange={e => setForm(p => ({ ...p, [f.key]: e.target.value }))}
              />
            </div>
          ))}
          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button variant="ghost" type="button" size="sm" onClick={() => setShowForm(false)}>Anuluj</Button>
            <Button type="submit" size="sm" disabled={isPending}>Zapisz</Button>
          </div>
        </form>
      )}

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-mes-border bg-mes-elevated">
              {['Nazwa', 'Typ', 'Opis', 'Stan', 'Akcje'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : (packaging as any[]).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Brak opakowań</td></tr>
            ) : (packaging as any[]).map((p: any) => (
              <tr key={p.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-200 font-medium">{p.name}</td>
                <td className="px-4 py-3 text-slate-400">{p.type || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{p.description || '—'}</td>
                <td className="px-4 py-3 text-slate-200 font-mono">{p.qty_available ?? p.qty ?? 0}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      className="w-16 bg-mes-elevated border border-mes-border rounded px-2 py-1 text-xs text-slate-200"
                      placeholder="ile"
                      value={useQty[p.id] || ''}
                      onChange={e => setUseQty(prev => ({ ...prev, [p.id]: e.target.value }))}
                    />
                    <button
                      className="text-xs px-2 py-1 rounded bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                      onClick={() => {
                        const qty = Number(useQty[p.id])
                        if (!qty) { toast.error('Podaj ilość'); return }
                        usePkg({ id: p.id, qty })
                        setUseQty(prev => ({ ...prev, [p.id]: '' }))
                      }}
                    >Użyj</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
