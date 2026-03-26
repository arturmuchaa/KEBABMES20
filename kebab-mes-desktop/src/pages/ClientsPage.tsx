import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchClients, createClient } from '@/api/index'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

const EMPTY = { name: '', nip: '', regon: '', address: '', city: '', contact_name: '', phone: '', email: '' }

export function ClientsPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const { data: clients = [], isLoading } = useQuery({
    queryKey: ['clients'],
    queryFn: fetchClients,
  })

  const { mutate: addClient, isPending } = useMutation({
    mutationFn: createClient,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['clients'] })
      setForm(EMPTY)
      setShowForm(false)
      toast.success('Kontrahent dodany')
    },
    onError: () => toast.error('Błąd podczas dodawania kontrahenta'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.name.trim()) { toast.error('Nazwa jest wymagana'); return }
    addClient(form)
  }

  const fields = [
    { key: 'name', label: 'Nazwa *' },
    { key: 'nip', label: 'NIP' },
    { key: 'regon', label: 'REGON' },
    { key: 'address', label: 'Adres' },
    { key: 'city', label: 'Miasto' },
    { key: 'contact_name', label: 'Osoba kontaktowa' },
    { key: 'phone', label: 'Telefon' },
    { key: 'email', label: 'Email' },
  ]

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Kontrahenci</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Anuluj' : '+ Dodaj kontrahenta'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-mes-surface border border-mes-border rounded-xl p-4 grid grid-cols-2 gap-3">
          {fields.map(f => (
            <div key={f.key}>
              <label className="block text-xs text-slate-400 mb-1">{f.label}</label>
              <input
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
              {['Nazwa', 'NIP', 'Miasto', 'Kontakt', 'Telefon'].map(h => (
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
            ) : clients.length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500 text-sm">Brak kontrahentów</td></tr>
            ) : clients.map((c: any) => (
              <tr key={c.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-200 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-slate-400">{c.nip || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.city || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.contact_name || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{c.phone || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
