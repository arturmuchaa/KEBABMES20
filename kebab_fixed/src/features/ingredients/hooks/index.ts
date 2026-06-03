/**
 * features/ingredients/hooks/index.ts
 * Logika magazynu przypraw i receptur. Zero logiki w komponentach.
 */
import { useState, useCallback } from 'react'
import { useApi, useMutation } from '@/hooks/useApi'
import {
  ingredientsApi, ingredientReceiptsApi, recipesApi,
} from '@/lib/apiClient'
import type {
  Ingredient, CreateIngredientDto, IngredientCategory,
  CreateIngredientReceiptDto,
  Recipe, CreateRecipeDto, UpdateRecipeDto,
  RecipeIngredient, RecipeCalculation,
} from '../types'

// ─── useIngredients — lista składników + przyjęcia ────────────

export function useIngredients() {
  const { data: ingredientList, loading, error, refetch } = useApi(() => ingredientsApi.list())
  const { data: stock, refetch: refetchStock } = useApi(() => ingredientsApi.stock())

  const createMut  = useMutation((dto: CreateIngredientDto) => ingredientsApi.create(dto))
  const receiptMut = useMutation((dto: CreateIngredientReceiptDto) => ingredientReceiptsApi.create(dto))
  const deactMut   = useMutation((id: string) => ingredientsApi.deactivate(id))

  const createIngredient = useCallback(async (dto: CreateIngredientDto): Promise<string | null> => {
    if (!dto.name.trim()) return 'Podaj nazwę składnika'
    try {
      await createMut.mutate(dto)
      refetch()
      return null
    } catch (e) { return e instanceof Error ? e.message : 'Błąd zapisu' }
  }, [createMut, refetch])

  const addReceipt = useCallback(async (dto: CreateIngredientReceiptDto): Promise<string | null> => {
    if (dto.qty <= 0) return 'Ilość musi być > 0'
    if (!dto.receivedDate) return 'Podaj datę przyjęcia'
    try {
      await receiptMut.mutate(dto)
      refetch()
      refetchStock()
      return null
    } catch (e) { return e instanceof Error ? e.message : 'Błąd zapisu' }
  }, [receiptMut, refetch, refetchStock])

  const deactivate = useCallback(async (id: string): Promise<string | null> => {
    try { await deactMut.mutate(id); refetch(); return null }
    catch (e) { return e instanceof Error ? e.message : 'Błąd' }
  }, [deactMut, refetch])

  return {
    ingredients: ingredientList ?? [],
    stock:       stock ?? [],
    loading, error, refetch,
    createIngredient,
    addReceipt,
    deactivate,
    createLoading:  createMut.loading,
    receiptLoading: receiptMut.loading,
  }
}

// ─── useRecipes — lista receptur + operacje ───────────────────

export function useRecipes() {
  const { data, loading, error, refetch }   = useApi(() => recipesApi.list())
  const { data: ingredientList }             = useApi(() => ingredientsApi.list())
  const { data: stock }                      = useApi(() => ingredientsApi.stock())

  const createMut     = useMutation((dto: CreateRecipeDto) => recipesApi.create(dto))
  const updateMut     = useMutation(({ id, dto }: { id: string; dto: UpdateRecipeDto }) =>
    recipesApi.update(id, dto))
  const deactivateMut = useMutation((id: string) => recipesApi.deactivate(id))

  const create = useCallback(async (dto: CreateRecipeDto): Promise<string | null> => {
    if (!dto.name.trim()) return 'Podaj nazwę receptury'
    if (!dto.ingredients.length) return 'Dodaj co najmniej jeden składnik'
    try {
      await createMut.mutate(dto)
      refetch()
      return null
    } catch (e) { return e instanceof Error ? e.message : 'Błąd zapisu' }
  }, [createMut, refetch])

  const update = useCallback(async (id: string, dto: UpdateRecipeDto): Promise<string | null> => {
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

  const calculate = useCallback(async (
    recipeId: string, meatKg: number,
  ): Promise<RecipeCalculation | null> => {
    try { return await recipesApi.calculate(recipeId, meatKg) }
    catch { return null }
  }, [])

  return {
    recipes:     data ?? [],
    ingredients: ingredientList ?? [],
    stock:       stock ?? [],
    loading, error, refetch,
    create, update, deactivate, calculate,
    createLoading: createMut.loading,
    updateLoading: updateMut.loading,
  }
}

// ─── useRecipeForm — stan formularza receptury ────────────────

export function useRecipeForm(initial?: Recipe) {
  const [name,          setName]          = useState(initial?.name ?? '')
  const [productTypeId, setProductTypeId] = useState(initial?.productTypeId ?? '')
  const [notes,         setNotes]         = useState(initial?.notes ?? '')
  const [shelfLifeDays, setShelfLifeDays] = useState(initial?.shelfLifeDays ?? 5)
  const [rows, setRows] = useState<{ ingredientId: string; qtyPer100kg: string }[]>(
    initial?.ingredients.map(r => ({
      ingredientId: r.ingredientId,
      qtyPer100kg:  String(r.qtyPer100kg),
    })) ?? [{ ingredientId: '', qtyPer100kg: '' }]
  )

  const addRow    = useCallback(() => setRows(p => [...p, { ingredientId: '', qtyPer100kg: '' }]), [])
  const removeRow = useCallback((idx: number) => setRows(p => p.filter((_, i) => i !== idx)), [])
  const updateRow = useCallback((idx: number, field: 'ingredientId' | 'qtyPer100kg', val: string) => {
    setRows(p => p.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }, [])

  // Wylicz podgląd sumy na 100 kg mięsa
  const sumPer100kg = rows.reduce((s, r) => s + (parseFloat(r.qtyPer100kg) || 0), 0)
  const totalOutputPer100kg = 100 + sumPer100kg

  const toDto = useCallback((): CreateRecipeDto => ({
    name,
    productTypeId: productTypeId || undefined,
    notes:         notes || undefined,
    shelfLifeDays,
    ingredients:   rows
      .filter(r => r.ingredientId && parseFloat(r.qtyPer100kg) > 0)
      .map(r => ({ ingredientId: r.ingredientId, qtyPer100kg: parseFloat(r.qtyPer100kg) })),
  }), [name, productTypeId, notes, shelfLifeDays, rows])

  const reset = useCallback(() => {
    setName(''); setProductTypeId(''); setNotes(''); setShelfLifeDays(5)
    setRows([{ ingredientId: '', qtyPer100kg: '' }])
  }, [])

  return {
    name, setName, productTypeId, setProductTypeId, notes, setNotes,
    shelfLifeDays, setShelfLifeDays,
    rows, setRows, addRow, removeRow, updateRow,
    sumPer100kg: Math.round(sumPer100kg * 1000) / 1000,
    totalOutputPer100kg: Math.round(totalOutputPer100kg * 1000) / 1000,
    toDto, reset,
  }
}
