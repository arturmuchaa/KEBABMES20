/**
 * api.ts — Klient HTTP do backendu PostgreSQL
 * Włącz przez zmianę apiClient.ts na: export * from './api'
 * URL: VITE_API_URL w .env.local (np. http://localhost:8000)
 *
 * BUGFIX: mapowanie snake_case (Python backend) → camelCase (TypeScript frontend)
 */
import type {
  RawBatch, Supplier, User,
  CreateRawBatchDto, CreateSupplierDto, Paginated,
} from '@/types'
import type {
  PurchaseInvoice, CreatePurchaseInvoiceDto,
  MeatStock, DeboningSession,
  Recipe, CreateRecipeDto, UpdateRecipeDto,
  Ingredient, CreateIngredientDto,
  IngredientReceipt, CreateIngredientReceiptDto,
  MixingOrder, CreateMixingOrderDto,
  SeasonedMeatBatch,
  ProductType, CreateProductTypeDto,
  MachineLock, MachineId,
  Client, CreateClientDto,
  ClientOrder, CreateClientOrderDto,
  PackagingItem, CreatePackagingDto,
  ProductionPlan, CreateProductionPlanDto,
  FinishedGoodsItem,
  InvoiceCategory,
} from './mockApi'

// URL backendu:
//   TRYB DEV (Tauri/przeglądarka w sieci LAN): ustaw VITE_API_URL=http://192.168.1.190:8000
//   TRYB VPS (nginx proxy): zostaw VITE_API_URL="" — wtedy użyjemy ścieżki względnej /api
const BASE = import.meta.env.VITE_API_URL
  ? `${import.meta.env.VITE_API_URL}/api`
  : '/api'

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    const msg = err.detail || err.message || `HTTP ${res.status}`
    throw new Error(Array.isArray(msg) ? msg.map((e: any) => e.msg || e).join(', ') : String(msg))
  }
  return res.json()
}

const get   = <T>(p: string)             => req<T>('GET',    p)
const post  = <T>(p: string, b: unknown) => req<T>('POST',   p, b)
const put   = <T>(p: string, b: unknown) => req<T>('PUT',    p, b)
const patch = <T>(p: string, b: unknown) => req<T>('PATCH',  p, b)
const del   = <T>(p: string)             => req<T>('DELETE', p)

// ─── BUGFIX: Mapowanie snake_case → camelCase dla RawBatch ─────────────────
// Backend Python zwraca pola w snake_case (internal_batch_no, kg_received...).
// Frontend TypeScript oczekuje camelCase (internalBatchNo, kgReceived...).
// Bez tego mapowania: b.kgReceived = undefined → undefined.toFixed() → CRASH (NaNd)
function mapRawBatch(raw: any): RawBatch {
  return {
    id:               raw.id,
    internalBatchNo:  raw.internal_batch_no  ?? raw.internalBatchNo  ?? '',
    internalBatchSeq: Number(raw.internal_batch_seq ?? raw.internalBatchSeq ?? 0),
    supplierId:       raw.supplier_id        ?? raw.supplierId        ?? '',
    supplierName:     raw.supplier_name      ?? raw.supplierName,
    supplierBatchNo:  raw.supplier_batch_no  ?? raw.supplierBatchNo  ?? '',
    supplierBatches:  raw.supplier_batches   ?? raw.supplierBatches,
    slaughterDate:    raw.slaughter_date     ?? raw.slaughterDate     ?? '',
    receivedDate:     raw.received_date      ?? raw.receivedDate      ?? '',
    expiryDate:       raw.expiry_date        ?? raw.expiryDate        ?? '',
    kgReceived:       Number(raw.kg_received  ?? raw.kgReceived  ?? 0),
    // kgAvailable — liczymy jako kg_received - kg_used gdy backend nie zwraca osobno
    kgAvailable:      Number(
      raw.kg_available ?? raw.kgAvailable
      ?? Math.max(0, (raw.kg_received ?? raw.kgReceived ?? 0) - (raw.kg_used ?? raw.kgUsed ?? 0))
    ),
    kgUsed:           Number(raw.kg_used     ?? raw.kgUsed     ?? 0),
    utilizationPct:   Number(raw.utilization_pct ?? raw.utilizationPct ?? 0),
    pricePerKg:       Number(raw.price_per_kg ?? raw.pricePerKg ?? 0),
    invoiceNo:        raw.invoice_no         ?? raw.invoiceNo,
    status:           raw.status,
    isInUse:          raw.is_in_use          ?? raw.isInUse,
    editReason:       raw.edit_reason        ?? raw.editReason,
    editedAt:         raw.edited_at          ?? raw.editedAt,
    editedBy:         raw.edited_by          ?? raw.editedBy,
    createdAt:        raw.created_at         ?? raw.createdAt ?? '',
    updatedAt:        raw.updated_at         ?? raw.updatedAt,
  }
}

function mapRawBatchPage(raw: any): Paginated<RawBatch> {
  // Backend może zwrócić: { data: [...], total: null }  lub tablicę []
  if (Array.isArray(raw)) {
    const mapped = raw.map(mapRawBatch)
    return { data: mapped, total: mapped.length, page: 1, limit: 25 }
  }
  const items = Array.isArray(raw.data) ? raw.data : []
  return {
    data:  items.map(mapRawBatch),
    total: raw.total  ?? items.length,
    page:  raw.page   ?? 1,
    limit: raw.limit  ?? 25,
  }
}

// ─── Partie ćwiartek ──────────────────────────────────────────
export const rawBatchesApi = {
  list: (opts?: { limit?: number; active_only?: boolean }) =>
    get<any>(`/raw-batches?limit=${opts?.limit ?? 25}&active_only=${opts?.active_only ?? true}`)
      .then(mapRawBatchPage),

  all: () =>
    get<any>('/raw-batches/all').then(mapRawBatchPage),

  byId: (id: string) =>
    get<any>(`/raw-batches/${id}`).then(mapRawBatch),

  nextNumber: () =>
    get<any>('/raw-batches/next-number').then((raw: any) => ({
      nextNo:           raw.nextNo           ?? raw.next_no           ?? '',
      seq:              raw.seq              ?? 0,
      suggestedBatchNo: raw.suggestedBatchNo ?? raw.suggested_batch_no ?? raw.nextNo ?? raw.next_no ?? '',
      suggestedSeq:     raw.suggestedSeq     ?? raw.suggested_seq     ?? raw.seq ?? 0,
      note:             raw.note             ?? 'Numer zostanie nadany przez system',
    })),

  checkDuplicate: (_supplierId: string, _supplierBatchNo: string, _slaughterDate: string) =>
    Promise.resolve(false),

  create: (dto: CreateRawBatchDto) =>
    post<any>('/raw-batches', dto).then(mapRawBatch),

  edit: (id: string, dto: Partial<CreateRawBatchDto>) =>
    put<any>(`/raw-batches/${id}`, dto).then(mapRawBatch),

  cancel: (id: string) =>
    patch<any>(`/raw-batches/${id}/cancel`, {}).then(mapRawBatch),
}

// ─── Dostawcy ─────────────────────────────────────────────────
function mapSupplier(raw: any): Supplier {
  return {
    id:          raw.id,
    code:        raw.code          ?? '',
    name:        raw.name          ?? '',
    nip:         raw.nip,
    vetNumber:   raw.vet_number    ?? raw.vetNumber,
    contactName: raw.contact_name  ?? raw.contactName,
    phone:       raw.phone,
    email:       raw.email,
    active:      raw.active ?? true,
  }
}

export const suppliersApi = {
  list:     () => get<any[]>('/suppliers').then(r => (Array.isArray(r) ? r : []).map(mapSupplier)),
  nextCode: async () => '',
  create:   (dto: CreateSupplierDto) => post<any>('/suppliers', dto).then(mapSupplier),
  update:   (id: string, dto: Partial<CreateSupplierDto>) => put<any>(`/suppliers/${id}`, dto).then(mapSupplier),
}

// ─── Sesje produkcyjne — PRAWDZIWY backend ────────────────────
// BUGFIX: Backend (Python) zwraca snake_case → mapujemy na camelCase
function mapProductionSession(raw: any) {
  return {
    id:          raw.id,
    sessionDate: raw.session_date  ?? raw.sessionDate  ?? '',
    processType: raw.process_type  ?? raw.processType  ?? 'deboning',
    status:      raw.status        ?? 'open',
    startedAt:   raw.started_at    ?? raw.startedAt    ?? '',
    endedAt:     raw.ended_at      ?? raw.endedAt,
    approvedBy:  raw.approved_by   ?? raw.approvedBy,
    approvedAt:  raw.approved_at   ?? raw.approvedAt,
    notes:       raw.notes,
    createdAt:   raw.created_at    ?? raw.createdAt    ?? '',
  }
}

export const productionSessionsApi = {
  list:  (processType?: string) =>
    get<any[]>(`/production-sessions${processType ? `?type=${processType}` : ''}`)
      .then(r => (Array.isArray(r) ? r : []).map(mapProductionSession)),
  active: (processType = 'deboning') =>
    get<any>(`/production-sessions/active?type=${processType}`)
      .then(r => r ? mapProductionSession(r) : null),
  byId:  (id: string) =>
    get<any>(`/production-sessions/${id}`).then(mapProductionSession),
  start: (dto: any) =>
    post<any>('/production-sessions', dto).then(mapProductionSession),
  close: (id: string, dto: any) =>
    patch<any>(`/production-sessions/${id}/close`, dto).then(mapProductionSession),
  approve: (id: string, dto: any) =>
    patch<any>(`/production-sessions/${id}/approve`, dto).then(mapProductionSession),
}

// ─── Rozbiór — wpisy i sesje ──────────────────────────────────
export const deboningApi = {
  list:   () => get<{ data: DeboningSession[] }>('/deboning'),
  byId:   (id: string) => get<DeboningSession>(`/deboning/${id}`),
  create: (dto: any) => post<DeboningSession>('/deboning', dto),
  update: (id: string, dto: any) => patch<DeboningSession>(`/deboning/${id}`, dto),
}

// BUGFIX: Backend zwraca snake_case dla wpisów rozbioru
// Bez mappera: e.rawBatchId=undefined, e.kgTaken=undefined → NaN w kalkulacjach
function mapDeboningEntry(raw: any) {
  return {
    id:          raw.id,
    sessionId:   raw.session_id    ?? raw.sessionId    ?? '',
    sessionDate: raw.session_date  ?? raw.sessionDate  ?? '',
    rawBatchId:  raw.raw_batch_id  ?? raw.rawBatchId   ?? '',
    rawBatchNo:  raw.raw_batch_no  ?? raw.rawBatchNo   ?? '',
    workerId:    raw.worker_id     ?? raw.workerId     ?? '',
    workerName:  raw.worker_name   ?? raw.workerName   ?? '',
    kgTaken:     Number(raw.kg_taken     ?? raw.kgTaken     ?? 0),
    kgMeat:      Number(raw.kg_meat      ?? raw.kgMeat      ?? 0),
    kgBones:     Number(raw.kg_bones     ?? raw.kgBones     ?? 0),
    kgBacks:     Number(raw.kg_backs     ?? raw.kgBacks     ?? 0),
    kgRemainder: Number(raw.kg_remainder ?? raw.kgRemainder ?? 0),
    yieldPct:    Number(raw.yield_pct    ?? raw.yieldPct    ?? 0),
    sessionNo:   raw.session_no    ?? raw.sessionNo    ?? '',
    tempInput:   raw.temp_input    != null ? Number(raw.temp_input  ?? raw.tempInput)  : undefined,
    tempRoom:    raw.temp_room     != null ? Number(raw.temp_room   ?? raw.tempRoom)   : undefined,
    notes:       raw.notes,
    meatLotNo:   raw.meat_lot_no   ?? raw.meatLotNo,
    createdAt:   raw.created_at    ?? raw.createdAt    ?? '',
  }
}

export const deboningEntriesApi = {
  list: (sessionId?: string) =>
    get<any>(`/deboning/entries${sessionId ? `?session_id=${sessionId}` : ''}`)
      .then(r => (Array.isArray(r) ? r : (r?.data ?? [])).map(mapDeboningEntry)),
  create: (dto: any) =>
    post<any>('/deboning/entries', dto).then(mapDeboningEntry),
  update: (id: string, dto: any) =>
    patch<any>(`/deboning/entries/${id}`, dto).then(mapDeboningEntry),
  traceability: (batchId: string) => get<any>(`/deboning/entries/trace/${batchId}`),
}

// ─── Magazyn surowca ──────────────────────────────────────────
// BUGFIX: Backend zwraca snake_case + mapper nie zawierał pól kgReserved/kgInProcess/kgUsed/expiryStatus
function mapMeatStock(raw: any): MeatStock {
  return {
    id:                 raw.id,
    lotNo:              raw.lot_no              ?? raw.lotNo              ?? '',
    deboningSessionId:  raw.deboning_session_id ?? raw.deboningSessionId ?? '',
    sessionNo:          raw.session_no          ?? raw.sessionNo,
    rawBatchId:         raw.raw_batch_id        ?? raw.rawBatchId        ?? '',
    rawBatchNo:         raw.raw_batch_no        ?? raw.rawBatchNo,
    kgInitial:          Number(raw.kg_initial   ?? raw.kgInitial         ?? 0),
    kgAvailable:        Number(raw.kg_available ?? raw.kgAvailable       ?? 0),
    kgReserved:         Number(raw.kg_reserved  ?? raw.kgReserved        ?? 0),
    kgInProcess:        Number(raw.kg_in_process ?? raw.kgInProcess      ?? 0),
    kgUsed:             Number(raw.kg_used      ?? raw.kgUsed            ?? 0),
    productionDate:     raw.production_date     ?? raw.productionDate    ?? '',
    expiryDate:         raw.expiry_date         ?? raw.expiryDate        ?? '',
    expiryStatus:       raw.expiry_status       ?? raw.expiryStatus      ?? 'OK',
    storageLocation:    raw.storage_location    ?? raw.storageLocation,
    status:             raw.status              ?? 'AVAILABLE',
    createdAt:          raw.created_at          ?? raw.createdAt         ?? '',
    productType:        raw.product_type        ?? raw.productType,
    machineAllocations: raw.machine_allocations ?? raw.machineAllocations,
  }
}

export const meatStockApi = {
  list: () =>
    get<any>('/meat-stock').then(r => {
      const items = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
      return { data: items.map(mapMeatStock) } as { data: MeatStock[] }
    }),
  byId: (id: string) => get<any>(`/meat-stock/${id}`).then(mapMeatStock),
}

// ─── Kontrahenci ──────────────────────────────────────────────
export const clientsApi = {
  list:       () => get<Client[]>('/clients'),
  create:     (dto: CreateClientDto) => post<Client>('/clients', dto),
  update:     (id: string, dto: Partial<CreateClientDto>) => put<Client>(`/clients/${id}`, dto),
  deactivate: (id: string) => patch<void>(`/clients/${id}/deactivate`, {}),
}

// ─── Pracownicy ───────────────────────────────────────────────
export const usersApi = {
  list:   () => get<User[]>('/workers'),
  create: (dto: { name: string; role: string; pin?: string }) => post<User>('/workers', dto),
}

// ─── Składniki ────────────────────────────────────────────────
// BUGFIX: Backend zwraca snake_case, frontend oczekuje camelCase
function mapIngredient(raw: any): Ingredient {
  return {
    id:          raw.id,
    name:        raw.name         ?? '',
    category:    raw.category     ?? 'other',
    unit:        raw.unit         ?? 'kg',
    isUnlimited: raw.is_unlimited ?? raw.isUnlimited ?? false,
    supplierId:  raw.supplier_id  ?? raw.supplierId,
    active:      raw.active       ?? true,
    createdAt:   raw.created_at   ?? raw.createdAt   ?? '',
  } as Ingredient
}

function mapIngredientStock(raw: any) {
  return {
    ingredientId:   raw.ingredient_id   ?? raw.ingredientId   ?? raw.id ?? '',
    ingredientName: raw.ingredient_name ?? raw.ingredientName ?? raw.name ?? '',
    unit:           raw.unit            ?? 'kg',
    isUnlimited:    raw.is_unlimited    ?? raw.isUnlimited    ?? false,
    qtyAvailable:   Number(raw.qty_available_total ?? raw.qty_available ?? raw.qtyAvailable ?? 0),
    qtyReserved:    Number(raw.qty_reserved ?? raw.qtyReserved ?? 0),
    lastReceiptAt:  raw.last_receipt_at ?? raw.lastReceiptAt,
  }
}

function mapIngredientReceipt(raw: any): IngredientReceipt {
  return {
    id:           raw.id,
    ingredientId: raw.ingredient_id  ?? raw.ingredientId  ?? '',
    qty:          Number(raw.qty_available ?? raw.qty ?? 0),
    unit:         raw.unit           ?? 'kg',
    pricePerUnit: Number(raw.price_per_unit ?? raw.pricePerUnit ?? 0),
    invoiceNo:    raw.invoice_no     ?? raw.invoiceNo,
    receivedDate: raw.created_at     ?? raw.receivedDate   ?? '',
    expiryDate:   raw.expiry_date    ?? raw.expiryDate,
    batchNo:      raw.batch_no       ?? raw.batchNo,
    supplierId:   raw.supplier_id    ?? raw.supplierId,
    notes:        raw.notes,
    createdAt:    raw.created_at     ?? raw.createdAt      ?? '',
  } as IngredientReceipt
}

export const ingredientsApi = {
  list:       () => get<any[]>('/ingredients').then(r => (Array.isArray(r) ? r : []).map(mapIngredient)),
  byId:       (id: string) => get<any>(`/ingredients/${id}`).then(mapIngredient),
  stock:      () => get<any[]>('/ingredients/stock').then(r => (Array.isArray(r) ? r : []).map(mapIngredientStock)),
  create:     (dto: CreateIngredientDto) => post<any>('/ingredients', dto).then(mapIngredient),
  deactivate: (id: string) => patch<void>(`/ingredients/${id}/deactivate`, {}),
}

export const ingredientReceiptsApi = {
  list:   () => get<any[]>('/ingredient-receipts').then(r => (Array.isArray(r) ? r : []).map(mapIngredientReceipt)),
  create: (dto: CreateIngredientReceiptDto) => post<any>('/ingredient-receipts', dto).then(mapIngredientReceipt),
}

// ─── Receptury ────────────────────────────────────────────────
// BUGFIX #3: Backend zwraca snake_case w składnikach receptury
function mapRecipeIngredient(raw: any) {
  return {
    id:             raw.id,
    ingredientId:   raw.ingredient_id   ?? raw.ingredientId   ?? '',
    ingredientName: raw.ingredient_name ?? raw.ingredientName ?? '',
    unit:           raw.unit            ?? 'kg',
    qtyPer100kg:    Number(raw.qty_per_100kg ?? raw.qtyPer100kg ?? 0),
    isUnlimited:    raw.is_unlimited    ?? raw.isUnlimited    ?? false,
  }
}

function mapRecipe(raw: any): Recipe {
  return {
    id:                   raw.id,
    name:                 raw.name                  ?? '',
    productTypeId:        raw.product_type_id       ?? raw.productTypeId,
    productTypeName:      raw.product_type_name     ?? raw.productTypeName,
    totalOutputPer100kg:  Number(raw.total_output_per_100kg ?? raw.totalOutputPer100kg ?? 100),
    notes:                raw.notes,
    active:               raw.active               ?? true,
    createdAt:            raw.created_at            ?? raw.createdAt ?? '',
    updatedAt:            raw.updated_at            ?? raw.updatedAt,
    ingredients: (raw.ingredients ?? []).map(mapRecipeIngredient),
  }
}

export const recipesApi = {
  list:       () => get<any[]>('/recipes').then(r => (Array.isArray(r) ? r : []).map(mapRecipe)),
  byId:       (id: string) => get<any>(`/recipes/${id}`).then(mapRecipe),
  create:     (dto: CreateRecipeDto) => post<any>('/recipes', dto).then(mapRecipe),
  update:     (id: string, dto: UpdateRecipeDto) => put<any>(`/recipes/${id}`, dto).then(mapRecipe),
  deactivate: (id: string) => patch<void>(`/recipes/${id}/deactivate`, {}),
  calculate:  (id: string, kg: number) => get<any>(`/recipes/${id}/calculate?kg=${kg}`),
}

// ─── Rodzaje produktów ────────────────────────────────────────
// BUGFIX: Backend zwraca snake_case, frontend oczekuje camelCase + zawsze tablicę components
function mapProductType(raw: any): ProductType {
  const comps = Array.isArray(raw.components) ? raw.components : []
  return {
    id:          raw.id,
    name:        raw.name        ?? '',
    description: raw.description ?? '',
    components:  comps.map((c: any) => ({
      id:         c.id         ?? '',
      name:       c.name       ?? '',
      pct:        Number(c.pct ?? 0),
      sourceType: c.sourceType ?? c.source_type ?? 'meat_stock',
    })),
    active:    raw.active    ?? true,
    createdAt: raw.createdAt ?? raw.created_at ?? '',
  } as ProductType
}

export const productTypesApi = {
  list:       () => get<any[]>('/product-types').then(r => (Array.isArray(r) ? r : []).map(mapProductType)),
  byId:       (id: string) => get<any>(`/product-types/${id}`).then(mapProductType),
  create:     (dto: CreateProductTypeDto) => post<any>('/product-types', dto).then(mapProductType),
  update:     (id: string, dto: Partial<CreateProductTypeDto>) => put<any>(`/product-types/${id}`, dto).then(mapProductType),
  deactivate: (id: string) => patch<void>(`/product-types/${id}/deactivate`, {}),
}

// ─── Faktury ──────────────────────────────────────────────────
// BUGFIX #1: Backend zwraca snake_case, frontend oczekuje camelCase
function mapInvoice(raw: any): PurchaseInvoice {
  return {
    id:            raw.id,
    invoiceNo:     raw.invoice_no     ?? raw.invoiceNo     ?? '',
    supplierId:    raw.supplier_id    ?? raw.supplierId    ?? '',
    supplierName:  raw.supplier_name  ?? raw.supplierName  ?? '',
    category:      raw.category       ?? 'INNE',
    invoiceDate:   raw.invoice_date   ?? raw.invoiceDate   ?? '',
    dueDate:       raw.due_date       ?? raw.dueDate,
    qty:           Number(raw.qty     ?? 0),
    unitPrice:     Number(raw.unit_price ?? raw.unitPrice ?? 0),
    vatRate:       Number(raw.vat_rate   ?? raw.vatRate   ?? 0.05),
    netTotal:      Number(raw.total_net  ?? raw.netTotal  ?? 0),
    vatTotal:      Number(raw.total_vat  ?? raw.vatTotal  ?? 0),
    grossTotal:    Number(raw.total_gross ?? raw.grossTotal ?? 0),
    // alias dla kompatybilności ze stroną (używa inv.totalGross)
    totalGross:    Number(raw.total_gross ?? raw.grossTotal ?? raw.totalGross ?? 0),
    rawBatchId:    raw.raw_batch_id  ?? raw.rawBatchId,
    rawBatchNo:    raw.raw_batch_no  ?? raw.rawBatchNo,
    notes:         raw.notes,
    lines:         raw.lines ?? [],
    createdAt:     raw.created_at    ?? raw.createdAt ?? '',
    currency:      raw.currency      ?? 'PLN',
    exchangeRate:  raw.exchange_rate ? Number(raw.exchange_rate) : null,
    amountEur:     raw.amount_eur    ? Number(raw.amount_eur)    : null,
  } as PurchaseInvoice
}

export const invoicesApi = {
  list:   (cat?: InvoiceCategory) =>
    get<any[]>(`/invoices${cat ? `?category=${cat}` : ''}`).then(r => (Array.isArray(r) ? r : []).map(mapInvoice)),
  byId:   (id: string) => get<any>(`/invoices/${id}`).then(mapInvoice),
  create: (dto: CreatePurchaseInvoiceDto) => post<any>('/invoices', dto).then(mapInvoice),
  update: (id: string, dto: Partial<CreatePurchaseInvoiceDto>) => patch<any>(`/invoices/${id}`, dto).then(mapInvoice),
  delete: (id: string) => del<void>(`/invoices/${id}`),
}

// ─── Opakowania / Tuleje ──────────────────────────────────────
export const packagingApi = {
  list:    () => get<PackagingItem[]>('/packaging'),
  all:     () => get<PackagingItem[]>('/packaging/all'),
  receive: (dto: CreatePackagingDto) => post<PackagingItem>('/packaging', dto),
  use:     (id: string, qty: number) => patch<void>(`/packaging/${id}/use`, { qty }),
}

// ─── Zamówienia klientów ──────────────────────────────────────
export const clientOrdersApi = {
  list:         (status?: string) => get<ClientOrder[]>(`/client-orders${status ? `?status=${status}` : ''}`),
  byId:         (id: string) => get<ClientOrder>(`/client-orders/${id}`),
  create:       (dto: CreateClientOrderDto) => post<ClientOrder>('/client-orders', dto),
  updateStatus: (id: string, status: string) => patch<ClientOrder>(`/client-orders/${id}/status`, { status }),
  delete:       (id: string) => del<void>(`/client-orders/${id}`),
}

// ─── Plany produkcji ──────────────────────────────────────────
// BUGFIX: Backend zwraca snake_case, frontend oczekuje camelCase
// Bez tego mapowania: totalKg=NaN, planNo=undefined, kgPerUnit=NaN
function mapPlanLine(raw: any) {
  return {
    id:             raw.id ?? '',
    planId:         raw.plan_id         ?? raw.planId         ?? '',
    qty:            Number(raw.qty      ?? 0),
    kgPerUnit:      Number(raw.kg_per_unit   ?? raw.kgPerUnit   ?? 0),
    totalKg:        Number(raw.total_kg      ?? raw.totalKg     ?? 0),
    productTypeId:  raw.product_type_id  ?? raw.productTypeId  ?? '',
    productTypeName:raw.product_type_name ?? raw.productTypeName ?? '',
    recipeId:       raw.recipe_id        ?? raw.recipeId        ?? '',
    recipeName:     raw.recipe_name      ?? raw.recipeName      ?? '',
    packagingId:    raw.packaging_id     ?? raw.packagingId,
    packagingName:  raw.packaging_name   ?? raw.packagingName,
    seasonedBatchId:  raw.seasoned_batch_id  ?? raw.seasonedBatchId,
    seasonedBatchNo:  raw.seasoned_batch_no  ?? raw.seasonedBatchNo,
    seasonedBatchIds: raw.seasoned_batch_ids ?? raw.seasonedBatchIds ?? [],
    seasonedBatchNos: raw.seasoned_batch_nos ?? raw.seasonedBatchNos ?? [],
    kgAssigned:     Number(raw.kg_assigned   ?? raw.kgAssigned  ?? 0),
    clientOrderId:  raw.client_order_id  ?? raw.clientOrderId,
    clientOrderNo:  raw.client_order_no  ?? raw.clientOrderNo,
    clientName:     raw.client_name      ?? raw.clientName,
    status:         raw.status           ?? 'pending',
  }
}

function mapPlan(raw: any): any {
  return {
    id:         raw.id          ?? '',
    planNo:     raw.plan_no     ?? raw.planNo     ?? '',
    planDate:   raw.plan_date   ?? raw.planDate   ?? '',
    totalKg:    Number(raw.total_kg    ?? raw.totalKg    ?? 0),
    totalUnits: Number(raw.total_units ?? raw.totalUnits ?? 0),
    status:     raw.status      ?? 'draft',
    notes:      raw.notes,
    createdAt:  raw.created_at  ?? raw.createdAt  ?? '',
    lines:      (raw.lines ?? []).map(mapPlanLine),
  }
}

export const productionPlansApi = {
  list:         () => get<any[]>('/production-plans').then(r => r.map(mapPlan)),
  byId:         (id: string) => get<any>(`/production-plans/${id}`).then(mapPlan),
  create:       (dto: CreateProductionPlanDto) => post<any>('/production-plans', dto).then(mapPlan),
  updateStatus: (id: string, status: string) => patch<void>(`/production-plans/${id}/status`, { status }),
}

// ─── Mięso przyprawione ───────────────────────────────────────
// ─── Mięso przyprawione ───────────────────────────────────────
// BUGFIX: Backend nie zwracał rawBatchNos, meatLots, slaughterDates itp.
// → biały ekran na stronie magazynu + NaN w planowaniu produkcji
function mapSeasonedMeat(raw: any): SeasonedMeatBatch {
  const meatLots = (raw.meat_lots ?? raw.meatLots ?? []).map((l: any) => ({
    meatLotId:  l.meat_lot_id  ?? l.meatLotId  ?? l.id ?? '',
    meatLotNo:  l.meat_lot_no  ?? l.meatLotNo  ?? l.lot_no ?? '',
    rawBatchId: l.raw_batch_id ?? l.rawBatchId ?? '',
    rawBatchNo: l.raw_batch_no ?? l.rawBatchNo ?? '',
    kgPlanned:  Number(l.kg_planned ?? l.kgPlanned ?? 0),
    kgActual:   Number(l.kg_actual  ?? l.kgActual  ?? 0),
    expiryDate: String(l.expiry_date ?? l.expiryDate ?? ''),
  }))

  return {
    id:             raw.id,
    batchNo:        raw.batch_no        ?? raw.batchNo        ?? '',
    recipeName:     raw.recipe_name     ?? raw.recipeName     ?? '',
    recipeId:       raw.recipe_id       ?? raw.recipeId       ?? '',
    mixingOrderNo:  raw.mixing_order_no ?? raw.mixingOrderNo  ?? '',
    mixingOrderId:  raw.mixing_order_id ?? raw.mixingOrderId  ?? '',
    kgProduced:     Number(raw.kg_produced  ?? raw.kgProduced  ?? 0),
    kgAvailable:    Number(raw.kg_available ?? raw.kgAvailable ?? 0),
    kgUsed:         Number(raw.kg_used      ?? raw.kgUsed      ?? 0),
    machineId:      raw.machine_id      ?? raw.machineId,
    meatLots,
    rawBatchIds:    raw.raw_batch_ids   ?? raw.rawBatchIds    ?? [],
    rawBatchNos:    raw.raw_batch_nos   ?? raw.rawBatchNos    ??
                    [...new Set(meatLots.map((l: any) => l.rawBatchNo).filter(Boolean))],
    deboningEntryIds:  raw.deboning_entry_ids  ?? raw.deboningEntryIds  ?? [],
    supplierIds:       raw.supplier_ids        ?? raw.supplierIds        ?? [],
    slaughterDates:    raw.slaughter_dates     ?? raw.slaughterDates     ?? [],
    productTypeId:     raw.product_type_id     ?? raw.productTypeId,
    productTypeName:   raw.product_type_name   ?? raw.productTypeName,
    status:            raw.status              ?? 'available',
    completedAt:       String(raw.completed_at ?? raw.completedAt ?? raw.created_at ?? ''),
    expiryDate:        String(raw.expiry_date  ?? raw.expiryDate  ?? ''),
    notes:             raw.notes,
  } as SeasonedMeatBatch
}

export const seasonedMeatApi = {
  list: () =>
    get<any>('/seasoned-meat').then(r => {
      const items = Array.isArray(r) ? r : (Array.isArray(r?.data) ? r.data : [])
      return items.map(mapSeasonedMeat)
    }),
  all: () =>
    get<any[]>('/seasoned-meat/all').then(r =>
      (Array.isArray(r) ? r : []).map(mapSeasonedMeat)
    ),
  byId:            (id: string) =>
    get<any>(`/seasoned-meat/${id}`).then(mapSeasonedMeat),
  createFromOrder: (id: string, kg: number) =>
    post<any>(`/seasoned-meat/from-order/${id}`, { kg_produced: kg })
      .then((r: any) => ({ id: r.id, batchNo: r.batch_no ?? r.batchNo, kgProduced: kg })),
  getFullTrace: (id: string) => get<any>(`/seasoned-meat/${id}/trace`),
}

// ─── Zlecenia masowania ───────────────────────────────────────
// BUGFIX: Backend zwraca snake_case, frontend oczekuje camelCase
// Brak tego mapowania powodował NaN kg w liście zleceń i crash tabletu masowania
function mapMixingOrderMeatLot(raw: any) {
  return {
    meatLotId:   raw.meat_lot_id   ?? raw.meatLotId   ?? '',
    meatLotNo:   raw.meat_lot_no   ?? raw.meatLotNo   ?? '',
    rawBatchId:  raw.raw_batch_id  ?? raw.rawBatchId  ?? '',
    rawBatchNo:  raw.raw_batch_no  ?? raw.rawBatchNo  ?? '',
    kgPlanned:   Number(raw.kg_planned  ?? raw.kgPlanned  ?? 0),
    kgActual:    Number(raw.kg_actual   ?? raw.kgActual   ?? 0),
    expiryDate:  raw.expiry_date   ?? raw.expiryDate  ?? '',
  }
}

function mapMixingOrderStep(raw: any) {
  return {
    stepNo:         Number(raw.step_no          ?? raw.stepNo          ?? 0),
    ingredientId:   raw.ingredient_id           ?? raw.ingredientId    ?? '',
    ingredientName: raw.ingredient_name         ?? raw.ingredientName  ?? '',
    unit:           raw.unit                    ?? 'kg',
    qtyRequired:    Number(raw.qty_required     ?? raw.qtyRequired     ?? 0),
    qtyConfirmed:   raw.qty_confirmed !== undefined
                      ? Number(raw.qty_confirmed ?? raw.qtyConfirmed)
                      : undefined,
    confirmed:      raw.confirmed               ?? false,
    isUnlimited:    raw.is_unlimited            ?? raw.isUnlimited     ?? false,
  }
}

function mapMixingSession(raw: any) {
  return {
    sessionId:   raw.session_id  ?? raw.sessionId  ?? '',
    machineId:   raw.machine_id  ?? raw.machineId,
    kgMeat:      Number(raw.kg_meat   ?? raw.kgMeat   ?? 0),
    kgOutput:    Number(raw.kg_output ?? raw.kgOutput ?? 0),
    startedAt:   raw.started_at  ?? raw.startedAt  ?? '',
    completedAt: raw.completed_at ?? raw.completedAt ?? '',
    batchNo:     raw.batch_no    ?? raw.batchNo,
  }
}

function mapMixingOrder(raw: any): MixingOrder {
  return {
    id:             raw.id,
    orderNo:        raw.order_no         ?? raw.orderNo         ?? '',
    productTypeId:  raw.product_type_id  ?? raw.productTypeId,
    productTypeName:raw.product_type_name ?? raw.productTypeName,
    recipeId:       raw.recipe_id        ?? raw.recipeId        ?? '',
    recipeName:     raw.recipe_name      ?? raw.recipeName      ?? '',
    meatKg:         Number(raw.meat_kg          ?? raw.meatKg          ?? 0),
    kgDone:         Number(raw.kg_done          ?? raw.kgDone          ?? 0),
    kgRemaining:    Number(raw.kg_remaining     ?? raw.kgRemaining     ?? raw.meat_kg ?? raw.meatKg ?? 0),
    plannedOutputKg:Number(raw.planned_output_kg ?? raw.plannedOutputKg ?? 0),
    meatLots:       (raw.meat_lots ?? raw.meatLots ?? []).map(mapMixingOrderMeatLot),
    machineId:      raw.machine_id       ?? raw.machineId,
    steps:          (raw.steps ?? []).map(mapMixingOrderStep),
    status:         raw.status           ?? 'planned',
    notes:          raw.notes,
    createdAt:      raw.created_at       ?? raw.createdAt       ?? '',
    startedAt:      raw.started_at       ?? raw.startedAt,
    completedAt:    raw.completed_at     ?? raw.completedAt,
    sessions:       (raw.sessions ?? []).map(mapMixingSession),
  } as MixingOrder
}

export const mixingOrdersApi = {
  list:              (status?: string) =>
    get<any[]>(`/mixing-orders${status ? `?status=${status}` : ''}`)
      .then(r => (Array.isArray(r) ? r : (r as any).data ?? []).map(mapMixingOrder)),
  byId:              (id: string) =>
    get<any>(`/mixing-orders/${id}`).then(mapMixingOrder),
  create:            (dto: CreateMixingOrderDto) =>
    post<any>('/mixing-orders', dto).then(mapMixingOrder),
  start:             (id: string, dto: any) =>
    patch<any>(`/mixing-orders/${id}/start`, dto).then(mapMixingOrder),
  allocateToMachine: (id: string, m: MachineId, kg: number) =>
    patch<any>(`/mixing-orders/${id}/allocate`, { machine_id: m, kg }).then(mapMixingOrder),
  confirmStep:   (id: string, dto: any) =>
    patch<any>(`/mixing-orders/${id}/confirm-step`, dto).then(mapMixingOrder),
  finishSession: (id: string, kg: number, batchNo: string, lotAllocations?: any[]) =>
    patch<any>(`/mixing-orders/${id}/finish-session`, {
      kg_actual: kg,
      batch_no: batchNo || '',
      lotAllocations: lotAllocations ?? [],
    }).then(mapMixingOrder),
  autoApprove: (id: string) =>
    patch<any>(`/mixing-orders/${id}/auto-approve`, {}).then(mapMixingOrder),
  cancel:      (id: string) =>
    patch<any>(`/mixing-orders/${id}/cancel`, {}).then(mapMixingOrder),
}

// ─── Blokady maszyn ───────────────────────────────────────────
function mapMachineLock(raw: any): MachineLock {
  return {
    machineId: raw.machine_id ?? raw.machineId,
    orderId:   raw.order_id   ?? raw.orderId   ?? '',
    orderNo:   raw.order_no   ?? raw.orderNo   ?? '',
    lockedAt:  raw.locked_at  ?? raw.lockedAt  ?? '',
    // Backend używa expires_at, frontend oczekuje unlocksAt
    unlocksAt: raw.unlocks_at ?? raw.unlocksAt ?? raw.expires_at ?? '',
  } as MachineLock
}

export const machineLockApi = {
  list:     () =>
    get<any[]>('/machine-locks')
      .then(r => (Array.isArray(r) ? r : []).map(mapMachineLock)),
  lock:     (m: MachineId, orderId: string, orderNo: string, mins: number) =>
    post<any>('/machine-locks', { machine_id: m, order_id: orderId, order_no: orderNo, minutes: mins })
      .then(mapMachineLock),
  unlock:   (m: MachineId) => del<void>(`/machine-locks/${m}`),
  isLocked: (m: MachineId) => get<{ locked: boolean }>(`/machine-locks/${m}`),
}

// ─── Logi systemowe ───────────────────────────────────────────
export const systemLogsApi = {
  list: () => get<any[]>('/system-logs'),
}

export const rawBatchHistoryApi = {
  forBatch: (id: string) => get<any[]>(`/raw-batches/${id}/history`),
  all:      () => get<any[]>('/batch-history'),
}

// ─── Wyroby gotowe ────────────────────────────────────────────
export const finishedGoodsApi = {
  list:   () => get<FinishedGoodsItem[]>('/finished-goods'),
  create: (dto: any) => post<FinishedGoodsItem>('/finished-goods', dto),
  finishProductionDay: (planId: string, entries: any[]) =>
    post<any>('/finished-goods/finish-day', { plan_id: planId, entries }),
}

// ─── Health ───────────────────────────────────────────────────
export const healthApi = {
  check: () => get<any>('/health'),
}

// Re-eksportuj typy z mockApi (niezmienione)
export type {
  PurchaseInvoice, CreatePurchaseInvoiceDto,
  InvoiceCategory, INVOICE_CATEGORY_LABELS,
  Client, CreateClientDto,
  ClientOrder, CreateClientOrderDto,
  OrderLine,
  PackagingItem, CreatePackagingDto, PackagingType,
  ProductionPlan, ProductionPlanLine, CreateProductionPlanDto, CreatePlanLineDto,
  FinishedGoodsItem,
  MixingOrder, MixingOrderMeatLot,
  SeasonedMeatBatch,
  MachineLock, MachineId,
} from './mockApi'

export { INVOICE_CATEGORY_LABELS } from './mockApi'
