/**
 * ProductTypesPage — TYLKO definicja rodzajów produktów (skład mięsny %)
 * Bez zakładek — jeden widok, czysta lista + dodawanie
 */
import { useState } from 'react'
import { Modal, Toast, Spinner, EmptyState , PageHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useProductTypes, useProductTypeForm } from '../hooks'
import { validateComponents } from '../types'
import type { ProductType } from '../types'
import { Plus, Pencil, X, ChevronDown, ChevronUp, Trash2, AlertTriangle, CheckCircle } from 'lucide-react'

interface ToastState { msg: string; type: 'success'|'error'; visible: boolean }
const HIDDEN: ToastState = { msg: '', type: 'success', visible: false }

export function ProductTypesPage() {
  const { productTypes, loading, create, update, deactivate, createLoading } = useProductTypes()
  const [modalOpen, setModalOpen] = useState(false)
  const [editItem,  setEditItem]  = useState<ProductType | null>(null)
  const [expanded,  setExpanded]  = useState<string | null>(null)
  const [toast,     setToast]     = useState<ToastState>(HIDDEN)

  const form = useProductTypeForm(editItem ?? undefined)

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(HIDDEN), 3000)
  }

  function openCreate() { form.reset(); setEditItem(null); setModalOpen(true) }
  function openEdit(p: ProductType) { setEditItem(p); setModalOpen(true) }

  async function handleSubmit() {
    const dto = form.toDto()
    const err = editItem ? await update(editItem.id, dto) : await create(dto)
    if (err) { showToast(err, 'error'); return }
    showToast(editItem ? 'Produkt zaktualizowany' : `Produkt "${dto.name}" dodany`)
    setModalOpen(false)
  }

  async function handleDeactivate(id: string, name: string) {
    const err = await deactivate(id)
    if (err) showToast(err, 'error')
    else showToast(`"${name}" usunięty`)
  }

  const SOURCE_LABELS: Record<string, string> = {
    meat_stock: 'Mięso z/s (rozbiór)',
    purchase:   'Zakup (FV/WZ)',
  }

  return (
    <div className="space-y-5 animate-fade-in">

      <PageHeader title="Rodzaje produktów" subtitle="Typy wyrobów gotowych" />
      <div className="flex items-center justify-between">
        <p className="text-[12px] text-slate-900-3">
          Definicja składu mięsnego kebabu (% udział surowców). Suma udziałów = 100%.
        </p>
        <Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Nowy rodzaj produktu</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Spinner size={24} /></div>
      ) : productTypes.length === 0 ? (
        <EmptyState
          title="Brak rodzajów produktów"
          message="Dodaj pierwszy rodzaj kebabu klikając przycisk powyżej"
          action={<Button size="sm" icon={<Plus size={13} />} onClick={openCreate}>Dodaj produkt</Button>}
        />
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {productTypes.map(p => (
            <div key={p.id}>
              <div className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/60 cursor-pointer"
                onClick={() => setExpanded(expanded === p.id ? null : p.id)}>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-slate-900">{p.name}</div>
                  {p.description && <div className="text-[11px] text-slate-900-3 mt-0.5">{p.description}</div>}
                </div>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {p.components.map(c => (
                    <span key={c.id} className="text-[10px] font-semibold px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">
                      {c.pct}% {c.name}
                    </span>
                  ))}
                  <button onClick={e => { e.stopPropagation(); openEdit(p) }}
                    className="p-1.5 text-slate-900-4 hover:text-blue-600 rounded ml-1"><Pencil size={13} /></button>
                  <button onClick={e => { e.stopPropagation(); handleDeactivate(p.id, p.name) }}
                    className="p-1.5 text-slate-900-4 hover:text-danger rounded"><Trash2 size={13} /></button>
                  {expanded === p.id ? <ChevronUp size={14} className="text-slate-900-4" /> : <ChevronDown size={14} className="text-slate-900-4" />}
                </div>
              </div>

              {expanded === p.id && (
                <div className="px-4 pb-3 bg-slate-50 border-t border-slate-200">
                  <table className="w-full text-[12px] mt-2">
                    <thead>
                      <tr className="text-[10px] font-semibold uppercase tracking-wider text-slate-900-4">
                        <th className="text-left py-1">Składnik</th>
                        <th className="text-center py-1 w-20">Udział %</th>
                        <th className="text-left py-1">Źródło</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {p.components.map(c => (
                        <tr key={c.id}>
                          <td className="py-1.5 font-medium">{c.name}</td>
                          <td className="py-1.5 text-center font-bold text-blue-600">{c.pct}%</td>
                          <td className="py-1.5 text-slate-900-3">{SOURCE_LABELS[c.sourceType]}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-slate-300 font-bold">
                        <td className="py-1">SUMA</td>
                        <td className={`py-1 text-center font-black ${p.components.reduce((s,c)=>s+c.pct,0)===100?'text-success':'text-danger'}`}>
                          {p.components.reduce((s,c)=>s+c.pct,0)}%
                        </td>
                        <td />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title={editItem ? 'Edytuj rodzaj produktu' : 'Nowy rodzaj produktu'}
        subtitle="Zdefiniuj skład mięsny (% udziały, suma = 100%)" size="lg" preventClose>
        <div className="space-y-4">
          <div>
            <label className="block text-[11px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Nazwa produktu *</label>
            <input type="text" placeholder="np. Kebab MIX 70/30, Kebab 100% udo"
              value={form.name} onChange={e => form.setName(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand" />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-slate-900-3 uppercase tracking-wide mb-1">Opis (opcjonalnie)</label>
            <input type="text" placeholder="np. Udo z kurczaka + filet z indyka"
              value={form.description} onChange={e => form.setDescription(e.target.value)}
              className="w-full h-9 px-3 text-sm border border-slate-200 focus:outline-none focus:border-brand" />
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-slate-900-3 uppercase tracking-wide">Skład mięsny *</label>
              <button onClick={form.addComponent}
                className="text-[11px] font-semibold text-blue-600 hover:underline flex items-center gap-1">
                <Plus size={11} /> Dodaj składnik
              </button>
            </div>
            <div className="grid grid-cols-[1fr_90px_140px_32px] gap-2 mb-1">
              {['Nazwa składnika','Udział %','Źródło',''].map(h => (
                <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-slate-900-4">{h}</div>
              ))}
            </div>
            <div className="space-y-1.5">
              {form.components.map((c, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_90px_140px_32px] gap-2 items-center">
                  <input type="text" placeholder="np. Mięso z/s, Filet z kurczaka"
                    value={c.name} onChange={e => form.updateComponent(idx, 'name', e.target.value)}
                    className="h-8 px-2.5 text-[13px] border border-slate-200 focus:outline-none focus:border-brand" />
                  <div className="flex items-center gap-1">
                    <input type="number" min="0" max="100" step="0.1" placeholder="0"
                      value={c.pct || ''}
                      onChange={e => form.updateComponent(idx, 'pct', parseFloat(e.target.value) || 0)}
                      className="w-full h-8 px-2 text-[13px] font-bold text-right border border-slate-200 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                    <span className="text-[11px] text-slate-900-3 flex-shrink-0">%</span>
                  </div>
                  <select value={c.sourceType} onChange={e => form.updateComponent(idx, 'sourceType', e.target.value as any)}
                    className="h-8 px-2 text-[12px] border border-slate-200 focus:outline-none focus:border-brand">
                    <option value="meat_stock">Mięso z/s (rozbiór)</option>
                    <option value="purchase">Zakup (FV/WZ)</option>
                  </select>
                  <button onClick={() => form.removeComponent(idx)} disabled={form.components.length <= 1}
                    className="h-8 w-8 flex items-center justify-center text-slate-900-4 hover:text-danger disabled:opacity-30">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200">
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-slate-900-3">Suma:</span>
                <span className={`text-[13px] font-bold ${form.validation.sumPct === 100 ? 'text-success' : 'text-danger'}`}>
                  {Math.round(form.validation.sumPct * 100) / 100}%
                </span>
                {form.validation.sumPct === 100 && <CheckCircle size={14} className="text-success" />}
              </div>
              {form.components.length >= 2 && form.validation.sumPct !== 100 && (
                <button onClick={form.autoFillLastPct}
                  className="text-[11px] font-semibold text-blue-600 hover:underline">Auto-uzupełnij ostatni</button>
              )}
            </div>
            {!form.validation.ok && form.validation.message && (
              <div className="flex items-center gap-2 mt-1.5 text-[11px] text-danger">
                <AlertTriangle size={12} /> {form.validation.message}
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setModalOpen(false)}>Anuluj</Button>
            <Button fullWidth loading={createLoading} onClick={handleSubmit}
              disabled={!form.validation.ok || !form.name.trim()}>
              {editItem ? 'Zapisz zmiany' : 'Dodaj produkt'}
            </Button>
          </div>
        </div>
      </Modal>

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
