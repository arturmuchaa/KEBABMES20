import { useQuery } from '@tanstack/react-query'
import { UserCog } from 'lucide-react'
import { fetchWorkers } from '@/api'
import { SkeletonTable } from '@/components/ui/skeleton'

export function UsersPage() {
  const { data: workers = [], isLoading } = useQuery({ queryKey: ['workers'], queryFn: fetchWorkers })
  const admins = workers.filter(w => w.role === 'administrator' || w.role === 'kierownik')

  return (
    <div className="space-y-4 max-w-4xl animate-fade-in">
      <div className="flex items-center gap-2 mb-1">
        <UserCog size={16} className="text-mes-accent" />
        <h1 className="text-base font-semibold text-slate-200">Użytkownicy systemu</h1>
      </div>
      <p className="text-sm text-slate-500">
        Użytkownicy z dostępem do panelu biurowego. Zarządzanie hasłami odbywa się przez administratora systemu na serwerze.
      </p>

      <div className="bg-mes-surface border border-mes-border rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-mes-border">
          <span className="text-xs font-semibold uppercase tracking-widest text-slate-500">Pracownicy z rolami zarządzającymi</span>
        </div>
        {isLoading ? <SkeletonTable rows={3} /> : admins.length === 0 ? (
          <div className="py-10 text-center text-slate-500 text-sm">
            Brak użytkowników z rolą kierownika/administratora.<br />
            Dodaj pracownika z rolą "kierownik" lub "administrator" w sekcji Pracownicy.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-mes-border text-slate-500 text-xs">
                {['Imię i nazwisko', 'Rola', 'Status'].map(h => (
                  <th key={h} className="px-4 py-2.5 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-mes-border/50">
              {admins.map(w => (
                <tr key={w.id} className="hover:bg-mes-elevated/40">
                  <td className="px-4 py-3 font-semibold text-slate-200">{w.name}</td>
                  <td className="px-4 py-3 capitalize text-slate-400">{w.role}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400">Aktywny</span>
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
