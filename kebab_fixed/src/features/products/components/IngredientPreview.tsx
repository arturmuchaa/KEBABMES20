// src/features/products/components/IngredientPreview.tsx
import { useMemo } from 'react'
import { fmtKg } from '@/lib/utils'

interface Recipe {
  id: string
  ingredients: { ingredientName: string; unit?: string; qtyPer100kg: number; isUnlimited?: boolean }[]
}

/** Podgląd składników i półproduktu dla receptury + kg mięsa. */
export function IngredientPreview({ recipe, meatKg }: { recipe?: Recipe; meatKg: number }) {
  const steps = useMemo(() => {
    if (!recipe || meatKg <= 0) return []
    return recipe.ingredients.map(ri => ({
      name: ri.ingredientName,
      unit: ri.unit ?? 'kg',
      qty: Math.round((ri.qtyPer100kg * meatKg) / 100 * 1000) / 1000,
      isUnlimited: ri.isUnlimited,
    }))
  }, [recipe, meatKg])

  const output = useMemo(() => {
    if (!recipe || meatKg <= 0) return 0
    const ingKg = recipe.ingredients
      .filter(ri => ['kg', 'l', 'KG', 'L'].includes(ri.unit ?? '') || ri.isUnlimited)
      .reduce((s, ri) => s + (ri.qtyPer100kg * meatKg) / 100, 0)
    return Math.round((meatKg + ingKg) * 100) / 100
  }, [recipe, meatKg])

  if (!recipe || meatKg <= 0) return null

  return (
    <div className="border rounded text-[12px] overflow-hidden">
      <div className="px-3 py-2 bg-surface-3/50 border-b grid grid-cols-[1fr_100px_50px] gap-2">
        <span className="font-semibold text-ink">Mięso (baza)</span>
        <span className="font-bold text-ink text-right">{fmtKg(meatKg, 2)}</span>
        <span className="text-muted-foreground">kg</span>
      </div>
      {steps.map((s, i) => (
        <div key={i} className="px-3 py-1.5 border-b last:border-0 grid grid-cols-[1fr_100px_50px] gap-2">
          <span className="font-medium">
            {s.name}{s.isUnlimited && <span className="ml-1 text-[10px] text-ink-2">(woda)</span>}
          </span>
          <span className="font-bold text-right">{s.qty}</span>
          <span className="text-muted-foreground">{s.unit}</span>
        </div>
      ))}
      <div className="px-3 py-2 bg-green-50 border-t-2 border-green-200 grid grid-cols-[1fr_100px_50px] gap-2 font-bold text-green-700">
        <span>PÓŁPRODUKT ŁĄCZNIE</span>
        <span className="text-right">{fmtKg(output, 2)}</span>
        <span>kg</span>
      </div>
    </div>
  )
}
