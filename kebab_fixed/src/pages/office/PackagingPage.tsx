/**
 * PackagingPage — Magazyn tulei i opakowań
 * Przyjęcie przez FV/WZ, lista stanów
 */
import { useState } from 'react'
import { useApi } from '@/hooks/useApi'
import { packagingApi, suppliersApi } from '@/lib/apiClient'
import { Spinner, EmptyState, Modal } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { fmtDatePl } from '@/lib/utils'
import {
  Archive,
  Package,
  Plus,
} from 'lucide-react'
import type { CreatePackagingDto, PackagingType } from '@/lib/mockApi'

const TYPE_LABELS: Record<PackagingType, string> = {
  tuleja: 'Tuleja', opakowanie: 'Opakowanie', inne: 'Inne',
}

function ReceiveForm({ onSave, onClose }: { onSave: (dto: CreatePackagingDto) => Promise<void>; onClose: () => void }) {
  const { data: suppliers } = useApi(() => suppliersApi.list())
  const [form, setForm] = useState<CreatePackagingDto>({
    name: '', type: 'tuleja', unit: 'szt', qty: 0, supplierId: '', expiryDate: '', notes: '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const set = (k: keyof CreatePackagingDto, v: any) => setForm(p => ({ ...p, [k]: v }))

  async function handleSave() {
    if (!form.name.trim() || form.qty <= 0) { setError('Podaj nazwę i ilość'); return }
    setSaving(true)
    try { await onSave(form); onClose() }
    catch(e) { setError(e instanceof Error ? e.message : 'Błąd') }
    finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Nazwa *</label>
          <input value={form.name} onChange={e => set('name', e.target.value)}
            placeholder="np. Tuleja metal 65cm" className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Typ</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
            {(['tuleja','opakowanie','inne'] as PackagingType[]).map(t => (
              <option key={t} value={t}>{TYPE_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Jednostka</label>
          <select value={form.unit} onChange={e => set('unit', e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
            {['szt','kg','rolka','karton'].map(u => <option key={u} value={u}>{u}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Ilość *</label>
          <input type="number" min="0" step="1" value={form.qty || ''}
            onChange={e => set('qty', parseFloat(e.target.value) || 0)}
            className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
        <div>
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Dostawca</label>
          <select value={form.supplierId} onChange={e => set('supplierId', e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50">
            <option value="">— bez dostawcy —</option>
            {(suppliers ?? []).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-[10px] font-bold text-ink-3 uppercase tracking-wide mb-1">Data ważności</label>
          <input type="date" value={form.expiryDate} onChange={e => set('expiryDate', e.target.value)}
            className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand bg-slate-50" />
        </div>
      </div>
      {error && <div className="text-[12px] text-danger bg-danger-light border border-danger-border px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onClose} className="flex-1">Anuluj</Button>
        <Button onClick={handleSave} loading={saving} className="flex-1">Przyjmij na magazyn</Button>
      </div>
    </div>
  )
}

export function PackagingPage() {
  const { data: items, loading, refetch } = useApi(() => packagingApi.all())
  const [modal, setModal] = useState(false)
  const [tab, setTab] = useState<'all'|'tuleja'|'opakowanie'>('all')

  const filtered = (items ?? []).filter(i => tab === 'all' || i.type === tab)
  const totalAvail = filtered.reduce((s, i) => s + i.kgAvailable, 0)

  async function handleReceive(dto: CreatePackagingDto) {
    await packagingApi.receive(dto)
    refetch()
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex gap-3 items-center">
        <div className="flex gap-1">
          {([['all','Wszystkie'],['tuleja','Tuleje'],['opakowanie','Opakowania']] as [string,string][]).map(([k,l]) => (
            <button key={k} onClick={() => setTab(k as any)}
              className={`px-3 py-1.5 rounded text-[12px] font-semibold border transition-all ${tab===k?'bg-brand text-white border-brand':'bg-surface-3 text-ink-3 border-surface-4 hover:border-brand/40'}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="ml-auto">
          <Button icon={<Plus size={14} />} onClick={() => setModal(true)}>Przyjmij</Button>
        </div>
      </div>

      <div className="bg-surface border border-surface-4 rounded-xl">
        <div className="px-4 py-2.5 border-b border-surface-4 flex items-center justify-between">
          <span className="text-[13px] font-semibold text-ink">{filtered.length} pozycji</span>
          <span className="text-[12px] text-ink-3">Łącznie: {totalAvail.toFixed(0)} szt/kg dostępne</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-10"><Spinner size={20} /></div>
        ) : filtered.length === 0 ? (
          <EmptyState icon={<Archive size={32} />} title="Brak opakowań" message="Przyjmij opakowania przez przycisk Przyjmij" />
        ) : (
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-surface-4 bg-slate-50">
                {['Kod','Nazwa','Typ','Dostępne','Zużyte','Dostawca'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map(item => (
                <tr key={item.id} className="hover:bg-surface-3/60">
                  <td className="px-3 py-2.5 font-mono text-ink-3">{item.code}</td>
                  <td className="px-3 py-2.5 font-semibold text-ink">{item.name}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] bg-surface-3 text-ink-3 px-1.5 py-0.5 rounded font-semibold">
                      {TYPE_LABELS[item.type]}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`font-bold ${item.kgAvailable > 0 ? 'text-success' : 'text-ink-4'}`}>
                      {item.kgAvailable} {item.unit}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-3">{item.kgUsed} {item.unit}</td>
                  <td className="px-3 py-2.5 text-ink-3">{item.supplierName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {modal && (
        <Modal open title="Przyjmij opakowania / tuleje" onClose={() => setModal(false)} size="md">
          <ReceiveForm onSave={handleReceive} onClose={() => setModal(false)} />
        </Modal>
      )}
    </div>
  )
}
