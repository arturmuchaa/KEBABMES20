import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { fetchInvoices, createInvoice, fetchSuppliers } from '@/api/index'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { fmtDate, fmtCurrency } from '@/lib/utils'

const EMPTY = {
  invoice_no: '', supplier_id: '', issue_date: '', net_amount: '', vat_rate: '23', gross_amount: '',
}

export function InvoicesPage() {
  const qc = useQueryClient()
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(EMPTY)

  const { data: invoices = [], isLoading } = useQuery({
    queryKey: ['invoices'],
    queryFn: fetchInvoices,
  })

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn: fetchSuppliers,
  })

  const { mutate: addInvoice, isPending } = useMutation({
    mutationFn: createInvoice,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] })
      setForm(EMPTY)
      setShowForm(false)
      toast.success('Faktura dodana')
    },
    onError: () => toast.error('Błąd podczas dodawania faktury'),
  })

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!form.invoice_no.trim()) { toast.error('Nr faktury jest wymagany'); return }
    addInvoice({
      ...form,
      net_amount: Number(form.net_amount),
      vat_rate: Number(form.vat_rate),
      gross_amount: Number(form.gross_amount),
    })
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-200">Faktury zakupowe</h2>
        <Button size="sm" onClick={() => setShowForm(v => !v)}>
          {showForm ? 'Anuluj' : '+ Dodaj fakturę'}
        </Button>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="bg-mes-surface border border-mes-border rounded-xl p-4 grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">Nr faktury *</label>
            <input
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.invoice_no}
              onChange={e => setForm(p => ({ ...p, invoice_no: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Dostawca</label>
            <select
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.supplier_id}
              onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value }))}
            >
              <option value="">— wybierz —</option>
              {(suppliers as any[]).map((s: any) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Data wystawienia</label>
            <input
              type="date"
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.issue_date}
              onChange={e => setForm(p => ({ ...p, issue_date: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Kwota netto</label>
            <input
              type="number" step="0.01"
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.net_amount}
              onChange={e => setForm(p => ({ ...p, net_amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">VAT %</label>
            <input
              type="number"
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.vat_rate}
              onChange={e => setForm(p => ({ ...p, vat_rate: e.target.value }))}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Kwota brutto</label>
            <input
              type="number" step="0.01"
              className="w-full bg-mes-elevated border border-mes-border rounded-lg px-3 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-mes-accent"
              value={form.gross_amount}
              onChange={e => setForm(p => ({ ...p, gross_amount: e.target.value }))}
            />
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
              {['Nr faktury', 'Dostawca', 'Data', 'Kwota netto', 'VAT', 'Kwota brutto', 'Status'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <tr key={i} className="border-b border-mes-border/50">
                  {Array.from({ length: 7 }).map((_, j) => (
                    <td key={j} className="px-4 py-3"><Skeleton className="h-4 w-full" /></td>
                  ))}
                </tr>
              ))
            ) : invoices.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 text-sm">Brak faktur</td></tr>
            ) : (invoices as any[]).map((inv: any) => (
              <tr key={inv.id} className="border-b border-mes-border/50 hover:bg-mes-elevated/50 transition-colors">
                <td className="px-4 py-3 text-slate-200 font-medium font-mono">{inv.invoice_no}</td>
                <td className="px-4 py-3 text-slate-400">{inv.supplier_name || inv.supplier_id || '—'}</td>
                <td className="px-4 py-3 text-slate-400">{fmtDate(inv.issue_date)}</td>
                <td className="px-4 py-3 text-slate-400">{fmtCurrency(inv.net_amount)}</td>
                <td className="px-4 py-3 text-slate-400">{inv.vat_rate != null ? `${inv.vat_rate}%` : '—'}</td>
                <td className="px-4 py-3 text-slate-200">{fmtCurrency(inv.gross_amount)}</td>
                <td className="px-4 py-3 text-slate-400">{inv.status || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
