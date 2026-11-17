/** Mirror of backend _line_components: product composition takes precedence. */
export interface MeatComponent {
  materialTypeId: string
  materialName: string
  pct: number
}

export interface CompositionCatalog {
  productTypes?: Array<{ id: string; components?: unknown }>
  recipes?: Array<{ id: string; components?: unknown }>
}

function normalize(value: unknown): MeatComponent[] {
  if (!Array.isArray(value)) return []
  return value.filter(c => c && Number(c.pct) > 0).map(c => ({
    materialTypeId: c.materialTypeId || c.material_type_id || '',
    materialName: c.name || c.materialName || '',
    pct: Number(c.pct),
  }))
}

export function lineComponents(
  line: { productTypeId?: string; recipeId?: string }, catalog: CompositionCatalog = {},
): MeatComponent[] {
  const product = normalize(catalog.productTypes?.find(p => p.id === line.productTypeId)?.components)
    .filter(c => c.materialTypeId)
  return product.length >= 2 ? product
    : normalize(catalog.recipes?.find(r => r.id === line.recipeId)?.components)
}
