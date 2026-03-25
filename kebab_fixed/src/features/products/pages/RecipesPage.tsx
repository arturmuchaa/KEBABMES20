/**
 * RecipesPage — Receptury masowania
 * TYLKO: lista receptur + dodawanie nowej
 * Składniki pobierane z istniejącego magazynu przypraw (ingredientsApi)
 * BEZ zakładki magazyn — jest osobna strona SpiceStockPage
 */
import { useState } from 'react'
import { Modal, Spinner, EmptyState, Toast } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { useIngredients, useRecipes, useRecipeForm } from '@/features/ingredients/hooks'
import { useProductTypes } from '../hooks'
import type { Recipe } from '@/features/ingredients/types'
import { Plus, X, ChevronDown, ChevronUp, BookOpen, AlertTriangle } from 'lucide-react'

interface ToastState { msg: string; type: 'success'|'error'; visible: boolean }
const HIDDEN: ToastState = { msg: '', type: 'success', visible: false }

export function RecipesPage() {
  const { recipes, ingredients, loading, create, createLoading } = useRecipes()
  const { ingredients: ingList } = useIngredients()
  const { productTypes }         = useProductTypes()
  const form = useRecipeForm()

  const [modalOpen,  setModalOpen]  = useState(false)
  const [expanded,   setExpanded]   = useState<string | null>(null)
  const [viewRecipe, setViewRecipe] = useState<Recipe | null>(null)
  const [toast,      setToast]      = useState<ToastState>(HIDDEN)

  const showToast = (msg: string, type: 'success'|'error' = 'success') => {
    setToast({ msg, type, visible: true })
    setTimeout(() => setToast(HIDDEN), 3000)
  }

  async function handleCreate() {
    const dto = form.toDto()
    const err = await create(dto)
    if (err) { showToast(err, 'error'); return }
    showToast(`Receptura "${dto.name}" zapisana`)
    setModalOpen(false); form.reset()
  }

  // Składniki do wyboru — pobrane z magazynu (bez wody — woda osobna pozycja)
  const ingOptions = ingList.filter(i => i.active)

  return (
    <div className="space-y-4 animate-fade-in">

      {/* Nagłówek */}
      <div className="flex items-center justify-between">
        <p className="text-[11px] text-ink-3">
          Receptury masowania — dawkowanie składników na 100 kg mięsa.
          Składniki pobierane z <strong>magazynu przypraw i dodatków</strong>.
        </p>
        <Button size="sm" icon={<Plus size={13} />} onClick={() => { form.reset(); setModalOpen(true) }}>
          Nowa receptura
        </Button>
      </div>

      {/* Lista receptur */}
      {loading ? (
        <div className="flex justify-center py-10"><Spinner size={24} /></div>
      ) : recipes.length === 0 ? (
        <EmptyState
          icon={<BookOpen size={32} />}
          title="Brak receptur"
          message="Dodaj pierwszą recepturę masowania"
          action={<Button size="sm" icon={<Plus size={13} />} onClick={() => { form.reset(); setModalOpen(true) }}>Dodaj recepturę</Button>}
        />
      ) : (
        <div className="bg-white border border-surface-4 shadow-card divide-y divide-surface-4">
          {recipes.map(r => (
            <div key={r.id}>
              {/* Wiersz */}
              <div
                className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2 cursor-pointer"
                onClick={() => setExpanded(expanded === r.id ? null : r.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink">{r.name}</div>
                  <div className="text-[11px] text-ink-3 mt-0.5">
                    {r.ingredients.length} składników ·{' '}
                    <span className="font-semibold text-green-700">{r.totalOutputPer100kg} kg</span>
                    {' '}/ 100 kg mięsa
                    {r.productTypeId && (
                      <span className="ml-2 text-blue-600">
                        · {productTypes.find(p => p.id === r.productTypeId)?.name}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); setViewRecipe(r) }}
                  className="text-[11px] font-medium text-brand border border-brand/30 px-2 py-1 rounded hover:bg-blue-50"
                >
                  Podgląd
                </button>
                {expanded === r.id
                  ? <ChevronUp size={14} className="text-ink-4" />
                  : <ChevronDown size={14} className="text-ink-4" />}
              </div>

              {/* Rozwinięte szczegóły */}
              {expanded === r.id && (
                <div className="px-4 pb-4 bg-surface-2 border-t border-surface-4">
                  <table className="w-full text-[12px] mt-2">
                    <thead>
                      <tr className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                        <th className="text-left py-1">Składnik</th>
                        <th className="text-right py-1 w-28">Na 100 kg mięsa</th>
                        <th className="text-right py-1 w-16">Jedn.</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-4">
                      {r.ingredients.map(ri => (
                        <tr key={ri.id}>
                          <td className="py-1.5 font-medium text-ink">
                            {ri.ingredientName}
                            {ri.isUnlimited && <span className="ml-1 text-[10px] text-blue-500">(woda)</span>}
                          </td>
                          <td className="py-1.5 text-right font-bold">{ri.qtyPer100kg}</td>
                          <td className="py-1.5 text-right text-ink-3">{ri.unit}</td>
                        </tr>
                      ))}
                      <tr className="border-t border-surface-5">
                        <td className="py-1.5 font-semibold text-ink-3">Mięso (baza)</td>
                        <td className="py-1.5 text-right font-bold">100</td>
                        <td className="py-1.5 text-right text-ink-3">kg</td>
                      </tr>
                      <tr className="bg-green-50 font-bold text-green-700">
                        <td className="py-1.5">Półprodukt łącznie</td>
                        <td className="py-1.5 text-right">{r.totalOutputPer100kg}</td>
                        <td className="py-1.5 text-right">kg</td>
                      </tr>
                    </tbody>
                  </table>
                  {r.notes && <div className="mt-2 text-[11px] text-ink-3 bg-white px-3 py-2 border border-surface-4">{r.notes}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal: nowa receptura */}
      <Modal open={modalOpen} onClose={() => setModalOpen(false)}
        title="Nowa receptura" subtitle="Dawkowanie na 100 kg mięsa" size="lg" preventClose>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Nazwa receptury *</label>
              <input type="text" placeholder="np. Receptura Standard Van Hess"
                value={form.name} onChange={e => form.setName(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand" />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Rodzaj produktu</label>
              <select value={form.productTypeId} onChange={e => form.setProductTypeId(e.target.value)}
                className="w-full h-9 px-3 text-sm border border-surface-4 focus:outline-none focus:border-brand">
                <option value="">— bez przypisania —</option>
                {productTypes.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-bold text-ink-3 uppercase tracking-wide">Składniki (na 100 kg mięsa) *</label>
              <button onClick={form.addRow}
                className="text-[11px] font-semibold text-brand hover:underline flex items-center gap-1">
                <Plus size={11} /> Dodaj składnik
              </button>
            </div>

            {ingOptions.length === 0 && (
              <div className="flex items-center gap-2 text-[11px] text-amber-600 mb-2">
                <AlertTriangle size={12} />
                Brak składników w magazynie. Dodaj składniki w sekcji Magazyny → Przyprawy i dodatki.
              </div>
            )}

            <div className="grid grid-cols-[1fr_120px_32px] gap-2 mb-1">
              {['Składnik z magazynu','Dawka / 100 kg',''].map(h => (
                <div key={h} className="text-[10px] font-semibold uppercase tracking-wider text-ink-4">{h}</div>
              ))}
            </div>

            <div className="space-y-1.5">
              {form.rows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-[1fr_120px_32px] gap-2 items-center">
                  <select value={row.ingredientId}
                    onChange={e => form.updateRow(idx, 'ingredientId', e.target.value)}
                    className="h-8 px-2 text-[12px] border border-surface-4 focus:outline-none focus:border-brand">
                    <option value="">Wybierz składnik...</option>
                    {ingOptions.map(i => (
                      <option key={i.id} value={i.id}>
                        {i.name} {i.isUnlimited ? '(woda ∞)' : `[${i.unit}]`}
                      </option>
                    ))}
                  </select>
                  <div className="flex items-center gap-1">
                    <input type="number" min="0" step="0.001" placeholder="0.000"
                      value={row.qtyPer100kg}
                      onChange={e => form.updateRow(idx, 'qtyPer100kg', e.target.value)}
                      className="flex-1 h-8 px-2 text-[13px] font-bold text-right border border-surface-4 focus:outline-none focus:border-brand [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                    <span className="text-[10px] text-ink-3 flex-shrink-0 w-6">
                      {ingOptions.find(i => i.id === row.ingredientId)?.unit || 'kg'}
                    </span>
                  </div>
                  <button onClick={() => form.removeRow(idx)} disabled={form.rows.length <= 1}
                    className="h-8 w-8 flex items-center justify-center text-ink-4 hover:text-danger disabled:opacity-30">
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>

            {/* Suma */}
            <div className="mt-3 border border-surface-4 bg-surface-2 divide-y divide-surface-4 text-[12px]">
              <div className="flex justify-between px-3 py-1.5 text-ink-3">
                <span>Mięso (baza)</span><span className="font-bold">100 kg</span>
              </div>
              <div className="flex justify-between px-3 py-1.5 text-ink-3">
                <span>Suma składników</span><span className="font-bold">{form.sumPer100kg} kg</span>
              </div>
              <div className="flex justify-between px-3 py-1.5 font-bold text-green-700 bg-green-50">
                <span>Półprodukt / 100 kg mięsa</span>
                <span>{form.totalOutputPer100kg} kg</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-ink-3 uppercase tracking-wide mb-1">Uwagi</label>
            <textarea rows={2} placeholder="Opcjonalne uwagi..."
              value={form.notes} onChange={e => form.setNotes(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-surface-4 focus:outline-none focus:border-brand resize-none" />
          </div>

          <div className="flex gap-2 pt-1">
            <Button variant="secondary" fullWidth onClick={() => setModalOpen(false)}>Anuluj</Button>
            <Button fullWidth loading={createLoading} onClick={handleCreate}
              disabled={!form.name.trim() || !form.toDto().ingredients.length}>
              Zapisz recepturę
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal podglądu receptury */}
      {viewRecipe && (
        <Modal open={true} onClose={() => setViewRecipe(null)}
          title={viewRecipe.name} subtitle="Podgląd receptury" size="md">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-surface-4 text-[10px] font-semibold uppercase tracking-wider text-ink-4">
                <th className="text-left py-2">Składnik</th>
                <th className="text-right py-2 pr-3">Na 100 kg</th>
                <th className="text-right py-2">Jedn.</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {viewRecipe.ingredients.map(ri => (
                <tr key={ri.id}>
                  <td className="py-2 font-medium">{ri.ingredientName}
                    {ri.isUnlimited && <span className="ml-1 text-[10px] text-blue-500">∞</span>}
                  </td>
                  <td className="py-2 text-right font-bold pr-3">{ri.qtyPer100kg}</td>
                  <td className="py-2 text-right text-ink-3">{ri.unit}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-surface-5 bg-green-50 font-bold text-green-700">
                <td className="py-2">Półprodukt łącznie (+ mięso)</td>
                <td className="py-2 text-right pr-3">{viewRecipe.totalOutputPer100kg}</td>
                <td className="py-2 text-right">kg</td>
              </tr>
            </tbody>
          </table>
          {viewRecipe.notes && (
            <div className="mt-3 text-[12px] text-ink-3 bg-surface-2 px-3 py-2 border border-surface-4">{viewRecipe.notes}</div>
          )}
          <div className="flex justify-end mt-4">
            <Button variant="secondary" onClick={() => setViewRecipe(null)}>Zamknij</Button>
          </div>
        </Modal>
      )}

      <Toast message={toast.msg} type={toast.type} visible={toast.visible} />
    </div>
  )
}
