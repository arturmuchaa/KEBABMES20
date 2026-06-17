/**
 * features/products/hooks/index.ts
 * Logika modułu rodzajów produktów. Zero logiki w komponentach.
 */
import { useState, useCallback } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import { productTypesApi } from '@/lib/apiClient'
import { validateComponents } from '../types'
import type {
  ProductType, CreateProductTypeDto, UpdateProductTypeDto,
  ProductMeatComponent, MeatSourceType,
} from '../types'

// ─── Pusty komponent ──────────────────────────────────────────
function emptyComponent(): Omit<ProductMeatComponent, 'id'> {
  return { name: '', materialTypeId: '', sourceType: 'meat_stock', pct: 0 }
}

// ─── useProductTypes — lista i operacje ───────────────────────

export function useProductTypes() {
  const { data, loading, error, refetch } = useApi(() => productTypesApi.list())
  const createMut = useMutation((dto: CreateProductTypeDto) => productTypesApi.create(dto))
  const updateMut = useMutation(({ id, dto }: { id: string; dto: UpdateProductTypeDto }) =>
    productTypesApi.update(id, dto))
  const deactivateMut = useMutation((id: string) => productTypesApi.deactivate(id))

  const create = useCallback(async (dto: CreateProductTypeDto): Promise<string | null> => {
    const v = validateComponents(dto.components)
    if (!v.ok) return v.message ?? 'Błąd walidacji'
    if (!dto.name.trim()) return 'Podaj nazwę produktu'
    try {
      await createMut.mutate(dto)
      refetch()
      return null
    } catch (e) { return e instanceof Error ? e.message : 'Błąd zapisu' }
  }, [createMut, refetch])

  const update = useCallback(async (id: string, dto: UpdateProductTypeDto): Promise<string | null> => {
    if (dto.components) {
      const v = validateComponents(dto.components)
      if (!v.ok) return v.message ?? 'Błąd walidacji'
    }
    try {
      await updateMut.mutate({ id, dto })
      refetch()
      return null
    } catch (e) { return e instanceof Error ? e.message : 'Błąd zapisu' }
  }, [updateMut, refetch])

  const deactivate = useCallback(async (id: string): Promise<string | null> => {
    try { await deactivateMut.mutate(id); refetch(); return null }
    catch (e) { return e instanceof Error ? e.message : 'Błąd' }
  }, [deactivateMut, refetch])

  return {
    productTypes:    data ?? [],
    loading, error, refetch,
    create, update, deactivate,
    createLoading:   createMut.loading,
    updateLoading:   updateMut.loading,
  }
}

// ─── useProductTypeForm — stan formularza ─────────────────────

export function useProductTypeForm(initial?: ProductType) {
  const [name,       setName]       = useState(initial?.name ?? '')
  const [description,setDescription]= useState(initial?.description ?? '')
  const [components, setComponents] = useState<Omit<ProductMeatComponent, 'id'>[]>(
    initial?.components.map(({ id: _id, ...rest }) => rest) ?? [emptyComponent()]
  )

  const addComponent = useCallback(() => {
    setComponents(prev => [...prev, emptyComponent()])
  }, [])

  const removeComponent = useCallback((idx: number) => {
    setComponents(prev => prev.filter((_, i) => i !== idx))
  }, [])

  const updateComponent = useCallback((
    idx: number,
    field: keyof Omit<ProductMeatComponent, 'id'>,
    value: string | number | MeatSourceType
  ) => {
    setComponents(prev => prev.map((c, i) =>
      i === idx ? { ...c, [field]: value } : c
    ))
  }, [])

  // Wybór rodzaju surowca z katalogu — ustawia materialTypeId, nazwę (do
  // wyświetlania) i źródło (rozbiór vs zakup wg requiresDeboning) naraz.
  const setComponentMaterial = useCallback((
    idx: number,
    mat: { id: string; name: string; requiresDeboning?: boolean },
  ) => {
    setComponents(prev => prev.map((c, i) =>
      i === idx
        ? {
            ...c,
            materialTypeId: mat.id,
            name: mat.name,
            sourceType: mat.requiresDeboning ? 'meat_stock' : 'purchase',
          }
        : c
    ))
  }, [])

  // Automatyczne uzupełnienie ostatniego % do 100
  const autoFillLastPct = useCallback(() => {
    if (components.length < 2) return
    const sumExceptLast = components.slice(0, -1).reduce((s, c) => s + c.pct, 0)
    const remaining = Math.max(0, Math.round((100 - sumExceptLast) * 100) / 100)
    setComponents(prev => prev.map((c, i) =>
      i === prev.length - 1 ? { ...c, pct: remaining } : c
    ))
  }, [components])

  const validation = validateComponents(components)

  const toDto = useCallback((): CreateProductTypeDto => ({
    name, description: description || undefined, components,
  }), [name, description, components])

  const reset = useCallback(() => {
    setName('')
    setDescription('')
    setComponents([emptyComponent()])
  }, [])

  return {
    name, setName,
    description, setDescription,
    components,
    addComponent, removeComponent, updateComponent, setComponentMaterial, autoFillLastPct,
    validation,
    toDto,
    reset,
  }
}
