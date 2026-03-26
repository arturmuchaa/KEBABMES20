import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Users, Plus, UserCheck } from 'lucide-react'
import { fetchWorkers, createWorker } from '@/api'
import { Button } from '@/components/ui/button'
import { KpiCard } from '@/components/ui/card'
import { SkeletonTable } from '@/components/ui/skeleton'
import { toast } from 'sonner'

const ROLES = ['rozbiór', 'masownia', 'produkcja', 'magazyn', 'kierownik', 'administrator']

export function WorkersPage() {
  const qc = useQueryClient()
  const { data: workers = [], isLoading } = useQuery({ queryKey: ['workers'], queryFn: fetchWorkers })
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [role, setRole] = useState(ROLES[0])
  const [pin, setPin] = useState('')

  const add = useMutation({
    mutationFn: () => createWorker({ name, role, pin: pin || undefined }),
    onSuccess: () => {
      toast.success('Pracownik dodany')
      qc.invalidateQueries({ queryKey: ['workers'] })
      setName(''); setRole(ROLES[0]); setPin(''); setShowForm(false)
    },
    onError: (e: any) => toast.error(e?.response?.data?.detail || 'Błąd'),
  })

  return (
    <div className="space-y-6 max-w-5xl animate-fade-in">
      <div className="grid grid-cols-2 gap-4">
        <KpiCard label="Pracownicy łącznie" value={workers.length} icon={<Users size={18} />} accent="blue" />
        <KpiCard label="Aktywni" value={workers.filter(w => w.active).length} icon={<UserCheck size={18} />} accent="green" />
      </div>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3 border-b border-mes-border">
          <h2 className="text-sm font-semibold text-slate-300">Lista pracowników</h2>
          <Button size="sm" onClick={() => setShowForm(s => !s)}>
            <Plus size={14} /> Dodaj
          </Button>
        </div>

        {showForm && (
          <div className="px-5 py-4 border-b border-mes-border bg-mes-elevated/40 flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Imię i nazwisko *</label>
              <input value={name} onChange={e => setName(e.target.value)}
                className="h-9 px-3 text-sm bg-mes-bg border border-mes-border rounded-lg text-slate-200 focus:outline-none focus:border-mes-accent w-52"
                placeholder="Jan Kowalski" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">Rola</label>
              <select value={role} onChange={e => setRole(e.target.value)}
                className="h-9 px-3 text-sm bg-mes-bg border border-mes-border rounded-lg text-slate-200 focus:outline-none focus:border-mes-accent">
                {ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500">PIN (opcjonalny)</label>
              <input value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="h-9 px-3 text-sm bg-mes-bg border border-mes-border rounded-lg text-slate-200 focus:outline-none focus:border-mes-accent w-28"
                placeholder="123456" />
            </div>
            <Button size="sm" onClick={() => add.mutate()} disabled={!name.trim()} loading={add.isPending}>Zapisz</Button>
            <Button size="sm" variant="ghost" onClick={() => setShowForm(false)}>Anuluj</Button>
          </div>
        )}

        {isLoading ? <SkeletonTable rows={5} /> : workers.length === 0 ? (
          <div className="py-12 text-center text-slate-500 text-sm">Brak pracowników</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mes-border text-slate-500 text-xs">
                {['Imię i nazwisko', 'Rola', 'PIN', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-mes-border/50">
              {workers.map(w => (
                <tr key={w.id} className="hover:bg-mes-elevated/40 transition-colors">
                  <td className="px-4 py-3 font-semibold text-slate-200">{w.name}</td>
                  <td className="px-4 py-3 text-slate-400 capitalize">{w.role}</td>
                  <td className="px-4 py-3 font-mono text-slate-500">{w.pin ? '••••••' : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${w.active ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-500/10 text-slate-500'}`}>
                      {w.active ? 'Aktywny' : 'Nieaktywny'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
