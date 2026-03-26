/**
 * API barrel — domain-specific endpoint modules.
 */

// ─── Types ────────────────────────────────────────────────────

export interface RawBatch {
  id: string
  internal_batch_no: string
  internal_batch_seq: number
  supplier_id: string
  supplier_name: string
  supplier_batch_no: string
  slaughter_date: string
  received_date: string
  expiry_date: string
  kg_received: number
  kg_available: number
  price_per_kg: number
  invoice_no?: string
  status: string
  created_at: string
}

export interface MeatStock {
  id: string
  lot_no: string
  raw_batch_id: string
  raw_batch_no: string
  kg_initial: number
  kg_available: number
  kg_reserved: number
  kg_in_process: number
  kg_used: number
  production_date: string
  expiry_date: string
  status: string
  created_at: string
}

export interface Worker {
  id: string
  name: string
  role: string
  pin?: string
  active: boolean
}

export interface Ingredient {
  id: string
  code: string
  name: string
  unit: string
  is_unlimited: boolean
  active: boolean
}

export interface Recipe {
  id: string
  name: string
  product_type_id: string
  product_type_name: string
  total_output_per_100kg: number
  notes?: string
  active: boolean
  ingredients: RecipeIngredient[]
}

export interface RecipeIngredient {
  id: string
  recipe_id: string
  ingredient_id: string
  ingredient_name: string
  unit: string
  qty_per_100kg: number
  is_unlimited: boolean
}

export interface MixingOrder {
  id: string
  orderNo: string
  recipeId: string
  recipeName: string
  productTypeId?: string
  productTypeName?: string
  meatKg: number
  kgDone: number
  kgRemaining: number
  plannedOutputKg: number
  machineId?: number
  status: string
  notes?: string
  createdAt: string
  startedAt?: string
  completedAt?: string
  meatLots: MeatLotAlloc[]
  steps: MixingStep[]
}

export interface MeatLotAlloc {
  meatLotId: string
  meatLotNo: string
  rawBatchNo: string
  rawBatchId: string
  kgPlanned: number
  kgActual: number
  expiryDate: string
}

export interface MixingStep {
  stepNo: number
  ingredientId: string
  ingredientName: string
  unit: string
  qtyRequired: number
  qtyConfirmed?: number
  confirmed: boolean
  isUnlimited: boolean
}

export interface SeasonedMeat {
  id: string
  batch_no: string
  recipe_id: string
  recipe_name: string
  mixing_order_no: string
  kg_produced: number
  kg_available: number
  kg_used: number
  machine_id?: number
  expiry_date: string
  status: string
  created_at: string
}

export interface DashboardStats {
  rawBatchesCount: number
  rawBatchesKg: number
  meatStockKg: number
  deboningsToday: number
  criticalFefoCount: number
  activeMixingOrders: number
}

// ─── Endpoint functions ───────────────────────────────────────
import { apiGet, apiPost, apiPatch, apiPut } from './client'

// Raw Batches
export const fetchRawBatches = () =>
  apiGet<{ data: RawBatch[] }>('/api/raw-batches').then(r => r.data)

export const fetchAllRawBatches = () =>
  apiGet<RawBatch[]>('/api/raw-batches/all')

// Meat Stock
export const fetchMeatStock = () =>
  apiGet<{ data: MeatStock[] }>('/api/meat-stock').then(r => r.data)

// Workers
export const fetchWorkers = () =>
  apiGet<Worker[]>('/api/workers')

// Recipes
export const fetchRecipes = () =>
  apiGet<Recipe[]>('/api/recipes')

// Ingredients
export const fetchIngredients = () =>
  apiGet<Ingredient[]>('/api/ingredients')

// Mixing Orders
export const fetchMixingOrders = (status = '') =>
  apiGet<MixingOrder[]>('/api/mixing-orders', status ? { status } : undefined)

export const fetchMixingOrder = (id: string) =>
  apiGet<MixingOrder>(`/api/mixing-orders/${id}`)

export const createMixingOrder = (body: {
  recipeId: string
  meatKg: number
  productTypeId?: string
  meatLots: { meatLotId: string; kgPlanned: number }[]
}) => apiPost<MixingOrder>('/api/mixing-orders', body)

export const startMixingOrder = (id: string, machineId: number) =>
  apiPatch<MixingOrder>(`/api/mixing-orders/${id}/start`, { machineId })

export const confirmMixingStep = (id: string, stepNo: number, qtyConfirmed: number) =>
  apiPatch<MixingOrder>(`/api/mixing-orders/${id}/confirm-step`, { stepNo, qtyConfirmed })

export const finishMixingSession = (id: string, kgActual: number, batchNo?: string) =>
  apiPatch<MixingOrder>(`/api/mixing-orders/${id}/finish-session`, { kg_actual: kgActual, batch_no: batchNo })

export const cancelMixingOrder = (id: string) =>
  apiPatch<MixingOrder>(`/api/mixing-orders/${id}/cancel`)

// Machine locks
export const fetchMachineLocks = () =>
  apiGet<{ machine_id: number; order_id: string; order_no: string }[]>('/api/machine-locks')

// Seasoned Meat
export const fetchSeasonedMeat = () =>
  apiGet<{ data: SeasonedMeat[] }>('/api/seasoned-meat').then(r => r.data)

// Traceability
export const fetchTraceability = (batchId: string) =>
  apiGet<Record<string, unknown>>(`/api/traceability/${encodeURIComponent(batchId)}`)

export const fetchRecall = (batchId: string) =>
  apiGet<Record<string, unknown>>(`/api/traceability/${encodeURIComponent(batchId)}/recall`)

// Suppliers
export const fetchSuppliers = () =>
  apiGet<any[]>('/api/suppliers')

export const createSupplier = (body: any) =>
  apiPost<any>('/api/suppliers', body)

export const updateSupplier = (id: string, body: any) =>
  apiPut<any>(`/api/suppliers/${id}`, body)

// Clients
export const fetchClients = () =>
  apiGet<any[]>('/api/clients')

export const createClient = (body: any) =>
  apiPost<any>('/api/clients', body)

// Client Orders
export const fetchClientOrders = () =>
  apiGet<any[]>('/api/client-orders')

export const createClientOrder = (body: any) =>
  apiPost<any>('/api/client-orders', body)

export const updateClientOrderStatus = (id: string, status: string) =>
  apiPatch<any>(`/api/client-orders/${id}/status`, { status })

// Invoices
export const fetchInvoices = () =>
  apiGet<any[]>('/api/invoices')

export const createInvoice = (body: any) =>
  apiPost<any>('/api/invoices', body)

// Raw Batches (full CRUD)
export const fetchRawBatchesAll = () =>
  apiGet<{ data: any[] }>('/api/raw-batches?active_only=false&limit=200').then(r => (r as any).data || r)

export const createRawBatch = (body: any) =>
  apiPost<any>('/api/raw-batches', body)

// Spice stock (ingredients)
export const fetchIngredientStock = () =>
  apiGet<any[]>('/api/ingredients/stock')

export const fetchIngredientReceipts = () =>
  apiGet<any[]>('/api/ingredient-receipts')

export const createIngredientReceipt = (body: any) =>
  apiPost<any>('/api/ingredient-receipts', body)

// Packaging
export const fetchPackagingAll = () =>
  apiGet<any[]>('/api/packaging/all')

export const createPackaging = (body: any) =>
  apiPost<any>('/api/packaging', body)

export const usePackaging = (id: string, qty: number) =>
  apiPatch<any>(`/api/packaging/${id}/use`, { qty })

// Finished goods
export const fetchFinishedGoods = () =>
  apiGet<any[]>('/api/finished-goods')

// Byproducts
export const fetchByproducts = () =>
  apiGet<any[]>('/api/byproducts')

export const fetchByproductsSummary = () =>
  apiGet<any[]>('/api/byproducts/summary')

// Deboning
export const fetchDeboningEntries = () =>
  apiGet<any[]>('/api/deboning/entries')

export const fetchDeboning = () =>
  apiGet<any[]>('/api/deboning')

// Product types
export const fetchProductTypes = () =>
  apiGet<any[]>('/api/product-types')

export const createProductType = (body: any) =>
  apiPost<any>('/api/product-types', body)

// Production sessions (masowanie planning)
export const fetchProductionSessions = () =>
  apiGet<any[]>('/api/production-sessions')

// Production plans
export const fetchProductionPlans = () =>
  apiGet<any[]>('/api/production-plans')

export const createProductionPlan = (body: any) =>
  apiPost<any>('/api/production-plans', body)

// Workers (full)
export const createWorker = (body: any) =>
  apiPost<any>('/api/workers', body)

// Dashboard — aggregated from multiple endpoints
export async function fetchDashboard(): Promise<DashboardStats> {
  const [rawRes, meatRes, mixing] = await Promise.all([
    apiGet<{ data: RawBatch[] }>('/api/raw-batches').catch(() => ({ data: [] as RawBatch[] })),
    apiGet<{ data: MeatStock[] }>('/api/meat-stock').catch(() => ({ data: [] as MeatStock[] })),
    apiGet<MixingOrder[]>('/api/mixing-orders', { status: 'in_progress' }).catch(() => [] as MixingOrder[]),
  ])
  const raw  = rawRes.data
  const meat = meatRes.data
  const today = new Date().toISOString().substring(0, 10)
  const criticalFefoCount = raw.filter(b => {
    const days = Math.floor((new Date(b.expiry_date).getTime() - Date.now()) / 86_400_000)
    return days <= 1
  }).length

  return {
    rawBatchesCount:    raw.length,
    rawBatchesKg:       raw.reduce((s, b) => s + Number(b.kg_available), 0),
    meatStockKg:        meat.reduce((s, m) => s + Number(m.kg_available), 0),
    deboningsToday:     0, // requires deboning entries
    criticalFefoCount,
    activeMixingOrders: mixing.length,
  }
}
