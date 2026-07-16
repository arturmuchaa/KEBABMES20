/**
 * api.ts — Klient HTTP do backendu PostgreSQL
 * Włącz przez zmianę apiClient.ts na: export * from './api'
 * URL: VITE_API_URL w .env.local (np. http://localhost:8000)
 *
 * BUGFIX: mapowanie snake_case (Python backend) → camelCase (TypeScript frontend)
 */
import { tokenStore } from '@/features/auth/storage'
import { formatCartonNo } from '@/lib/unitLocation'
import type {
  RawBatch, Supplier, User,
  CreateRawBatchDto, CreateSupplierDto, Paginated,
  MeatStock, DeboningSession,
} from '@/types'
import type {
  Recipe, CreateRecipeDto, UpdateRecipeDto,
  Ingredient, CreateIngredientDto,
  IngredientReceipt, CreateIngredientReceiptDto,
} from '@/features/ingredients/types'
import type {
  ProductType, CreateProductTypeDto,
} from '@/features/products/types'
import type {
  PurchaseInvoice, CreatePurchaseInvoiceDto,
  MixingOrder, CreateMixingOrderDto,
  SeasonedMeatBatch,
  MachineLock, MachineId,
  Client, CreateClientDto,
  ClientOrder, CreateClientOrderDto,
  PackagingItem, CreatePackagingDto,
  ProductionPlan, CreateProductionPlanDto,
  FinishedGoodsItem,
  InvoiceCategory,
} from './mockApi'

// URL backendu:
//   Przeglądarka (VPS):  VITE_API_URL=""  → fetch('/api') → nginx proxy
//   Tauri (desktop):     VITE_API_URL="http://204.168.166.34:8080" → fetch absolutny do serwera
//
// Tauri nie może używać ścieżek względnych (/api) bo nie ma serwera HTTP lokalnie.
// Wykrywamy środowisko Tauri przez window.__TAURI_INTERNALS__ ustawiane przez runtime.
const _isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

export const BASE = (() => {
  if (import.meta.env.VITE_API_URL) return `${import.meta.env.VITE_API_URL}/api`
  if (_isTauri) return 'http://204.168.166.34:8080/api'  // fallback dla Tauri bez zmiennej (nginx MES = port 8080)
  return '/api'  // przeglądarka — nginx proxy
})()

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = tokenStore.get()
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (res.status === 401) {
    tokenStore.clear()
    // Samodzielne kioski (rozbior-v10.html itd.) mają WŁASNY ekran PIN —
    // twardy skok do /login załadowałby index.html, czyli PEŁNY MES na
    // kiosku operatora (prod 2026-07-09 po auto-update). Reload wraca do
    // entry kiosku, a AuthProvider bez tokenu pokaże logowanie PIN.
    const standaloneKiosk = location.pathname.includes('rozbior-v') || location.pathname.includes('kiosk')
    if (standaloneKiosk) {
      location.reload()
    } else if (!location.pathname.startsWith('/login') && !location.pathname.startsWith('/panel')) {
      location.href = '/login'
    }
    throw new Error('Sesja wygasła')
  }
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

// ─── camelCase → snake_case dla wszystkich DTO wysyłanych do backendu ─────────
// Backend Python oczekuje snake_case. Bez konwersji pola są ignorowane → "Field required".
function toSnake(obj: any): any {
  if (obj === null || obj === undefined) return obj
  if (Array.isArray(obj)) return obj.map(toSnake)
  if (typeof obj !== 'object') return obj
  return Object.fromEntries(
    Object.entries(obj).map(([k, v]) => [
      k.replace(/([A-Z])/g, '_$1').toLowerCase(),
      toSnake(v),
    ])
  )
}

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
    supplierDisplayName: raw.supplier_display_name ?? raw.supplierDisplayName ?? '',
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
    materialTypeId:   raw.material_type_id   ?? raw.materialTypeId ?? '',
    materialName:     raw.material_name      ?? raw.materialName   ?? '',
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
  // Backend czyta alias `activeOnly` (samo `active_only` było ignorowane —
  // bug do 2026-07-10); wysyłamy oba dla kompatybilności.
  list: (opts?: { limit?: number; active_only?: boolean }) =>
    get<any>(`/raw-batches?limit=${opts?.limit ?? 25}&active_only=${opts?.active_only ?? true}&activeOnly=${opts?.active_only ?? true}`)
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
    post<any>('/raw-batches', toSnake(dto)).then(mapRawBatch),

  // Słownik rodzajów surowca (ćwiartka/filet/indyk; kategorie drob/czerwone)
  materialTypes: () =>
    get<any[]>('/raw-batches/material-types').then(rows =>
      (Array.isArray(rows) ? rows : []).map((r: any) => ({
        id: r.id,
        name: r.name,
        requiresDeboning: !!(r.requires_deboning ?? r.requiresDeboning),
        // receivable=true → przyjmowalny surowiec (w tym mięso z/s z dostaw zewnętrznych).
        // Domyślnie true gdy backend nie zwrócił pola (stare API).
        receivable: r.receivable === undefined ? true : !!r.receivable,
        category: r.category ?? 'drob',
      }))
    ),

  edit: (id: string, dto: Partial<CreateRawBatchDto>) =>
    put<any>(`/raw-batches/${id}`, toSnake(dto)).then(mapRawBatch),

  cancel: (id: string) =>
    patch<any>(`/raw-batches/${id}/cancel`, {}).then(mapRawBatch),
}

// ─── Dostawcy ─────────────────────────────────────────────────
function mapSupplier(raw: any): Supplier {
  return {
    id:          raw.id,
    code:        raw.code           ?? '',
    name:        raw.name           ?? '',
    displayName: raw.display_name   ?? raw.displayName ?? '',
    nip:         raw.nip,
    regon:       raw.regon,
    vetNumber:   raw.vet_number     ?? raw.vetNumber,
    address:     raw.address,
    postalCode:  raw.postal_code    ?? raw.postalCode ?? '',
    city:        raw.city,
    contactName: raw.contact_name   ?? raw.contactName,
    phone:       raw.phone,
    email:       raw.email,
    active:      raw.active ?? true,
  }
}

export const auditApi = {
  list: (limit = 200) => get<any[]>(`/audit-log?limit=${limit}`),
}

export const analyticsApi = {
  mixingYield: (from: string, to: string, g: string) =>
    get<any[]>(`/analytics/mixing-yield?from=${from}&to=${to}&granularity=${g}`),
  volume: (from: string, to: string, g: string) =>
    get<any[]>(`/analytics/volume?from=${from}&to=${to}&granularity=${g}`),
  costTrend: (from: string, to: string, g: string) =>
    get<any[]>(`/analytics/cost-trend?from=${from}&to=${to}&granularity=${g}`),
}

export const suppliersApi = {
  list:     () => get<any[]>('/suppliers').then(r => (Array.isArray(r) ? r : []).map(mapSupplier)),
  nextCode: async () => '',
  create:   (dto: CreateSupplierDto) => post<any>('/suppliers', toSnake(dto)).then(mapSupplier),
  update:   (id: string, dto: Partial<CreateSupplierDto>) => put<any>(`/suppliers/${id}`, toSnake(dto)).then(mapSupplier),
  delete:   (id: string) => del<{ ok: boolean; id: string }>(`/suppliers/${id}`),
}

// ─── Sesje produkcyjne — PRAWDZIWY backend ────────────────────
// Poprzednio: zaślepka zwracająca Promise.resolve([]) → przycisk "Rozpocznij dzień" nic nie robił
export const productionSessionsApi = {
  list:  (processType?: string) =>
    get<any[]>(`/production-sessions${processType ? `?processType=${processType}` : ''}`),
  active: (processType = 'deboning') =>
    get<any>(`/production-sessions/active?processType=${processType}`),
  pending: () =>
    get<any[]>('/production-sessions/pending'),
  byId:  (id: string) =>
    get<any>(`/production-sessions/${id}`),
  start: (dto: any) =>
    post<any>('/production-sessions', toSnake(dto)),
  close: (id: string, dto: any = {}) =>
    patch<any>(`/production-sessions/${id}/close`, toSnake(dto)),
  approve: (id: string, dto: any = {}) =>
    patch<any>(`/production-sessions/${id}/approve`, toSnake(dto)),
}

// ─── Rozbiór — wpisy i sesje ──────────────────────────────────
export const deboningApi = {
  list:   () => get<{ data: DeboningSession[] }>('/deboning'),
  byId:   (id: string) => get<DeboningSession>(`/deboning/${id}`),
  create: (dto: any) => post<DeboningSession>('/deboning', toSnake(dto)),
  update: (id: string, dto: any) => patch<DeboningSession>(`/deboning/${id}`, toSnake(dto)),
  // Agregaty biura (monitoring rozbioru) — zakres dat po created_at.
  stats: (from: string, to: string) =>
    get<DeboningStats>(`/deboning/stats?date_from=${from}&date_to=${to}`),
}

export interface DeboningStatsWorker {
  workerId: string; workerName: string; quarters: number
  kgQuarter: number; kgMeat: number; avgYield: number; kgPerHour: number
}
export interface DeboningStats {
  summary: {
    quarters: number; kgQuarter: number; kgMeat: number; kgBacks: number
    kgBones: number; avgYield: number; workers: number; kgPerHour: number
    backsPct: number; bonesPct: number
    /** Bilans masy: ćwiartka − (mięso+kości+grzbiety) — duży = coś niezważone. */
    missingKg: number; missingPct: number
    /** Rachunek rozbioru (partie ze znaną ceną zakupu); koszt mięsa Z robocizną. */
    quarterCost: number | null; byproductRevenue: number | null
    laborCost: number | null; meatCostPerKg: number | null
  }
  workers: DeboningStatsWorker[]
  byHour: { hour: string; quarters: number; kgMeat: number }[]
  byDay: { date: string; quarters: number; kgMeat: number; avgYield: number }[]
  /** Uzysk per partia surowca — najważniejsza tabela raportu (jakość partii/dostawcy). */
  byBatch: {
    batchNo: string; supplierName: string; kgQuarter: number; kgMeat: number
    yieldPct: number | null; kgBacks: number; kgBones: number
    backsPct: number | null; bonesPct: number | null
    missingKg: number | null; missingPct: number | null
    pricePerKg: number | null; quarterCost: number | null
    byproductRevenue: number | null; laborCost: number | null; meatCostPerKg: number | null
  }[]
  recent: { id: string; workerName: string; rawBatchNo: string; kgQuarter: number; kgMeat: number; yield: number; at: string }[]
  workerDaily: Record<string, { date: string; quarters: number; kgQuarter: number; kgMeat: number; avgYield: number }[]>
}

/** Wpis historii korekt z biura: co na co i dlaczego (audyt zmiany akordu). */
export interface EntryCorrection {
  id: string
  at: string | null
  bySubject: string
  reason: string
  changes: Record<string, { from: unknown; to: unknown }>
}

export const deboningEntriesApi = {
  // list — filtrowanie po session_id gdy podane; withOpenTakes dołącza
  // otwarte pobrania (status=pending) także z INNYCH sesji — HMI musi je
  // widzieć następnego dnia (kafelek „⏳ czeka"), inaczej znikają na zawsze
  list: (sessionId?: string, opts?: { withOpenTakes?: boolean }) => {
    const qs = [
      sessionId ? `session_id=${sessionId}` : '',
      opts?.withOpenTakes ? 'with_open_takes=true' : '',
    ].filter(Boolean).join('&')
    return get<any[]>(`/deboning/entries${qs ? `?${qs}` : ''}`)
      .then(r => Array.isArray(r) ? r : (r as any).data ?? [])
  },
  // create — wysyła oba formaty (camelCase + snake_case) dla kompatybilności z backend
  create: (dto: any) => post<any>('/deboning/entries', {
    ...toSnake(dto),
    rawBatchId: dto.rawBatchId,
    sessionId:  dto.sessionId,
    workerId:   dto.workerId,
    kgTaken:    dto.kgTaken,
    kgMeat:     dto.kgMeat,
  }),
  // createTake — pobranie ćwiartki (mięso później); wysyła oba formaty
  createTake: (dto: any) => post<any>('/deboning/takes', {
    ...toSnake(dto),
    rawBatchId: dto.rawBatchId,
    sessionId:  dto.sessionId,
    workerId:   dto.workerId,
    kgTaken:    dto.kgTaken,
  }),
  // updateTake — edycja otwartego pobrania (kg ćwiartki); backend koryguje stan partii
  updateTake: (id: string, dto: any) => patch<any>(`/deboning/takes/${id}`, {
    ...toSnake(dto),
    kgTaken: dto.kgTaken,
  }),
  // completeTake — domknięcie pobrania mięsem
  completeTake: (id: string, dto: any) => post<any>(`/deboning/takes/${id}/complete`, {
    ...toSnake(dto),
    kgMeat: dto.kgMeat,
  }),
  // update — obsługuje kgBacks i kgBones
  update: (id: string, dto: any) => patch<any>(`/deboning/entries/${id}`, {
    ...toSnake(dto),
    kgBacks: dto.kgBacks,
    kgBones: dto.kgBones,
  }),
  // remove — storno wpisu (przycisk „Cofnij" na HMI); backend odwraca stany
  remove: (id: string) => del<{ ok: boolean; id: string }>(`/deboning/entries/${id}`),
  // changeBatch — korekta z biura: przenieś wpis na inną partię surowca
  // (operator wybrał złą). Backend przenosi surowiec/mięso/ABP/ruchy atomowo.
  changeBatch: (id: string, rawBatchId: string) =>
    post<any>(`/deboning/entries/${id}/change-batch`, { rawBatchId }),
  // correct — korekta z biura: pracownik i/lub kg. Osobny endpoint od PATCH
  // (tego używa HMI), bo ŚWIADOMIE działa też na ZATWIERDZONEJ zmianie —
  // wpisy starsze niż dziś są zawsze w sesji 'approved'. Powód wymagany:
  // korekta zmienia wstecz akord i statystyki.
  correct: (id: string, body: { workerId?: string; kgQuarter?: number; kgMeat?: number; reason: string }) =>
    post<any>(`/deboning/entries/${id}/correct`, body),
  corrections: (id: string) =>
    get<{ corrections: EntryCorrection[] }>(`/deboning/entries/${id}/corrections`)
      .then(r => r?.corrections ?? []),
  traceability: (batchId: string) => get<any>(`/deboning/entries/trace/${batchId}`),
}

// Ważenie zbiorcze produktów ubocznych (grzbiety + kości) — po zakończeniu
// partii ALBO w trakcie rozbioru (przytrzymanie kafelka partii na HMI).
export interface ByproductPallet {
  tareLabel: string; tareKg: number; containers: number; gross: number; net: number
  /** Czas ważenia TEJ palety — stempluje backend przy zapisie. Kreator odsyła
   *  paletę razem ze stemplem, dzięki czemu partia ważona przez kilka dni
   *  rozlicza każdą paletę w JEJ dniu (raport per dzień). */
  weighedAt?: string
}
export interface BatchByproducts {
  rawBatchId: string; rawBatchNo: string; quarterKg: number
  backsKg: number | null; bonesKg: number | null
  backsPct: number | null; bonesPct: number | null
  backsDone: boolean; bonesDone: boolean; finishedAt: string | null
  backsAt?: string | null; bonesAt?: string | null
  /** Ile kg ubocznych brakuje do bilansu masy partii (kafel pending). */
  missingKg?: number
  /** Bilans domknięty — kafel tylko „do przywrócenia/poprawy" (dzisiejsza partia). */
  balanced?: boolean
  /** Palety poprzednich ważeń — kreator doładowuje do sumy (ważenie w trakcie). */
  backsPallets?: ByproductPallet[]; bonesPallets?: ByproductPallet[]
}
export const byproductsApi = {
  // Wszystkie rekordy zbiorczego ważenia — magazyn surowca (Grzbiety/Kości).
  list: () => get<{ records: BatchByproducts[] }>('/deboning/byproducts').then(r => r?.records ?? []),
  pending: () => get<{ pending: BatchByproducts[] }>('/deboning/byproducts/pending').then(r => r?.pending ?? []),
  today: () => get<{ backsKg: number; bonesKg: number }>('/deboning/byproducts/today'),
  get: (batchId: string) => get<BatchByproducts>(`/deboning/byproducts/${batchId}`),
  // Ważenie w trakcie rozbioru — rekord BEZ oznaczania partii jako zakończonej.
  ensure: (batchId: string, operator?: string) =>
    post<BatchByproducts>(`/deboning/byproducts/${batchId}/ensure`, { operator: operator ?? '' }),
  finish: (batchId: string, operator?: string) =>
    post<BatchByproducts>(`/deboning/byproducts/${batchId}/finish`, { operator: operator ?? '' }),
  weigh: (batchId: string, kind: 'backs' | 'bones', kg: number, pallets: any[]) =>
    post<BatchByproducts>(`/deboning/byproducts/${batchId}/weigh`, { kind, kg, pallets }),
}

// ─── Magazyn surowca ──────────────────────────────────────────
// BUGFIX #2: Backend zwraca snake_case (kg_available, lot_no itp.)
// ale MeatStock typ oczekuje camelCase → mapujemy pola
function mapMeatStock(raw: any): MeatStock {
  return {
    id:                 raw.id,
    lotNo:              raw.lot_no              ?? raw.lotNo              ?? '',
    deboningSessionId:  raw.deboning_session_id ?? raw.deboningSessionId ?? '',
    sessionNo:          raw.session_no          ?? raw.sessionNo,
    rawBatchId:         raw.raw_batch_id        ?? raw.rawBatchId        ?? '',
    rawBatchNo:         raw.raw_batch_no        ?? raw.rawBatchNo,
    kgInitial:          Number(raw.kg_initial   ?? raw.kgInitial         ?? 0),
    kgAvailable:        Number(raw.kg_free      ?? raw.kg_available ?? raw.kgAvailable ?? 0),
    kgReserved:         Number(raw.kg_reserved  ?? raw.kgReserved        ?? 0),
    kgInProcess:        Number(raw.kg_in_process ?? raw.kgInProcess      ?? 0),
    kgUsed:             Number(raw.kg_used      ?? raw.kgUsed            ?? 0),
    productionDate:     raw.production_date     ?? raw.productionDate    ?? '',
    expiryDate:         raw.expiry_date         ?? raw.expiryDate        ?? '',
    expiryStatus:       raw.expiry_status       ?? raw.expiryStatus      ?? 'OK',
    status:             raw.status              ?? 'AVAILABLE',
    materialTypeId:     raw.material_type_id    ?? raw.materialTypeId    ?? '',
    materialName:       raw.material_name       ?? raw.materialName      ?? '',
    // Dostawca partii źródłowej — krótka nazwa (display_name) ma pierwszeństwo
    supplierName:       raw.supplier_display_name || raw.supplier_name || '',
    createdAt:          raw.created_at          ?? raw.createdAt         ?? '',
  } as MeatStock
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
// Backend zwraca snake_case (display_name, contact_name) — mapujemy do camelCase
function mapClient(raw: any): Client {
  return {
    id:          raw.id,
    code:        raw.code        ?? '',
    name:        raw.name        ?? '',
    displayName: raw.display_name ?? raw.displayName ?? '',
    nip:         raw.nip,
    regon:       raw.regon,
    address:     raw.address,
    postalCode:  raw.postal_code ?? raw.postalCode ?? '',
    city:        raw.city,
    contactName: raw.contact_name ?? raw.contactName,
    phone:       raw.phone,
    email:       raw.email,
    language:    raw.language ?? '',
    destName:    raw.dest_name ?? raw.destName ?? '',
    destAddress: raw.dest_address ?? raw.destAddress ?? '',
    destCity:    raw.dest_city ?? raw.destCity ?? '',
    halalSupervision: !!(raw.halal_supervision ?? raw.halalSupervision ?? false),
    active:      raw.active ?? true,
    createdAt:   raw.created_at ?? raw.createdAt ?? '',
  }
}

export const clientsApi = {
  list:       () => get<any[]>('/clients').then(r => (Array.isArray(r) ? r : []).map(mapClient)),
  create:     (dto: CreateClientDto) => post<any>('/clients', toSnake(dto)).then(mapClient),
  update:     (id: string, dto: Partial<CreateClientDto>) => put<any>(`/clients/${id}`, toSnake(dto)).then(mapClient),
  deactivate: (id: string) => patch<void>(`/clients/${id}/deactivate`, {}),
  delete:     (id: string) => del<{ ok: boolean }>(`/clients/${id}`),
}

// ─── Pracownicy ───────────────────────────────────────────────
export const usersApi = {
  list:   () => get<User[]>('/workers'),
  create: (dto: { name: string; role: string; pin?: string; departments?: string[]; ratePerKg?: number; contractType?: string; employerCostAmount?: number }) =>
    post<User>('/workers', toSnake(dto)),
  update: (id: string, dto: { name?: string; role?: string; pin?: string; departments?: string[]; ratePerKg?: number; contractType?: string; employerCostAmount?: number; active?: boolean }) =>
    put<User>(`/workers/${id}`, toSnake(dto)),
}

// ─── Płace ────────────────────────────────────────────────────
// Backend używa Query(alias='workerId'/'dateFrom'/'dateTo') — wymagany camelCase w query stringu.
export const payrollApi = {
  getWorkerDays: (workerId: string, dateFrom: string, dateTo: string) =>
    get<any[]>(`/payroll/worker-days?workerId=${encodeURIComponent(workerId)}&dateFrom=${encodeURIComponent(dateFrom)}&dateTo=${encodeURIComponent(dateTo)}`),
  createSettlement: (dto: {
    workerId: string; dateFrom: string; dateTo: string;
    workDates: string[]; kgPerDate: Record<string, number>;
    ratePerKg: number; deductions: { description: string; amount: number }[];
    notes?: string;
  }) => post<any>('/payroll/settlements', toSnake(dto)),
  listSettlements: (workerId?: string) =>
    get<any[]>(`/payroll/settlements${workerId ? `?workerId=${encodeURIComponent(workerId)}` : ''}`),
  getSettlement: (id: string) => get<any>(`/payroll/settlements/${id}`),
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
  const legacyExpiry = typeof raw.notes === 'string'
    ? raw.notes.match(/Ważność:\s*(\d{4}-\d{2}-\d{2})/)?.[1]
    : undefined

  return {
    id:           raw.id,
    ingredientId: raw.ingredient_id  ?? raw.ingredientId  ?? '',
    qty:          Number(raw.qty_initial ?? raw.qty_available ?? raw.qty ?? 0),
    unit:         raw.unit           ?? 'kg',
    pricePerUnit: Number(raw.price_per_unit ?? raw.pricePerUnit ?? 0),
    invoiceNo:    raw.invoice_no     ?? raw.invoiceNo,
    receivedDate: raw.received_date  ?? raw.receivedDate ?? raw.created_at ?? raw.createdAt ?? '',
    expiryDate:   raw.expiry_date    ?? raw.expiryDate ?? legacyExpiry,
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
  create:     (dto: CreateIngredientDto) => post<any>('/ingredients', toSnake(dto)).then(mapIngredient),
  deactivate: (id: string) => patch<void>(`/ingredients/${id}/deactivate`, {}),
}

export const ingredientReceiptsApi = {
  list:   () => get<any[]>('/ingredient-receipts').then(r => (Array.isArray(r) ? r : []).map(mapIngredientReceipt)),
  create: (dto: CreateIngredientReceiptDto) => post<any>('/ingredient-receipts', toSnake(dto)).then(mapIngredientReceipt),
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
  // Skład produkcyjny (kebab komponentowy, np. 70/30) — jsonb z backendu
  let comps: any = raw.components ?? []
  if (typeof comps === 'string') { try { comps = JSON.parse(comps) } catch { comps = [] } }
  return {
    id:                   raw.id,
    name:                 raw.name                  ?? '',
    productTypeId:        raw.product_type_id       ?? raw.productTypeId,
    productTypeName:      raw.product_type_name     ?? raw.productTypeName,
    totalOutputPer100kg:  Number(raw.total_output_per_100kg ?? raw.totalOutputPer100kg ?? 100),
    shelfLifeDays:        Number(raw.shelf_life_days ?? raw.shelfLifeDays ?? 5),
    notes:                raw.notes,
    active:               raw.active               ?? true,
    createdAt:            raw.created_at            ?? raw.createdAt ?? '',
    updatedAt:            raw.updated_at            ?? raw.updatedAt,
    ingredients: (raw.ingredients ?? []).map(mapRecipeIngredient),
    components: (Array.isArray(comps) ? comps : []).map((c: any) => ({
      materialTypeId: c.materialTypeId ?? c.material_type_id ?? '',
      materialName:   c.materialName   ?? c.material_name   ?? '',
      pct:            Number(c.pct) || 0,
    })),
  } as Recipe
}

// BUGFIX: toSnake('qtyPer100kg') → 'qty_per100kg' (missing _ before kg).
// Backend expects 'qty_per_100kg'. Serialize ingredients manually.
function toSnakeRecipeDto(dto: CreateRecipeDto | UpdateRecipeDto) {
  return {
    ...toSnake(dto),
    shelf_life_days: dto.shelfLifeDays ?? 5,
    ingredients: (dto.ingredients ?? []).map((ri: any) => ({
      ingredient_id:  ri.ingredientId  ?? ri.ingredient_id  ?? '',
      qty_per_100kg:  ri.qtyPer100kg   ?? ri.qty_per_100kg  ?? 0,
    })),
    // Skład produkcyjny (komponenty 70/30) — aliasy camelCase akceptowane
    components: ((dto as any).components ?? []).map((c: any) => ({
      materialTypeId: c.materialTypeId ?? '',
      materialName:   c.materialName   ?? '',
      pct:            Number(c.pct) || 0,
    })),
  }
}

export const recipesApi = {
  list:       () => get<any[]>('/recipes').then(r => (Array.isArray(r) ? r : []).map(mapRecipe)),
  byId:       (id: string) => get<any>(`/recipes/${id}`).then(mapRecipe),
  create:     (dto: CreateRecipeDto) => post<any>('/recipes', toSnakeRecipeDto(dto)).then(mapRecipe),
  update:     (id: string, dto: UpdateRecipeDto) => put<any>(`/recipes/${id}`, toSnakeRecipeDto(dto)).then(mapRecipe),
  deactivate: (id: string) => patch<void>(`/recipes/${id}/deactivate`, {}),
  calculate:  (id: string, kg: number) => get<any>(`/recipes/${id}/calculate?kg=${kg}`),
}

// ─── Kalkulacja kosztu wyrobu ─────────────────────────────────
export type CostWindow = 'all' | 'today' | '7d' | '30d'
export interface CostParams { backsPrice: number; bonesPrice: number; plantPerKg: number }
export interface RecipePriceSummary {
  recipeId: string
  recipeName: string
  productTypeName?: string
  totalOutputPer100kg: number
  prices: Record<'today' | '7d' | '30d', { costPerKg: number; hasMissingPrice: boolean }>
}
export const costApi = {
  params:         () => get<CostParams>('/cost/params'),
  saveParams:     (p: CostParams) => put<CostParams>('/cost/params', p),
  averages:       (window?: CostWindow) => get<Record<string, number>>(`/cost/averages${window ? `?window=${window}` : ''}`),
  recipesSummary: () => get<RecipePriceSummary[]>('/cost/recipes-summary'),
  recipeCost: (recipeId: string, q: Record<string, unknown> = {}) => {
    const qs = Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`)
      .join('&')
    return get<any>(`/cost/recipe/${recipeId}${qs ? '?' + qs : ''}`)
  },
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
  create:     (dto: CreateProductTypeDto) => post<any>('/product-types', toSnake(dto)).then(mapProductType),
  update:     (id: string, dto: Partial<CreateProductTypeDto>) => put<any>(`/product-types/${id}`, toSnake(dto)).then(mapProductType),
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
  create: (dto: CreatePurchaseInvoiceDto) => post<any>('/invoices', toSnake(dto)).then(mapInvoice),
  update: (id: string, dto: Partial<CreatePurchaseInvoiceDto>) => patch<any>(`/invoices/${id}`, toSnake(dto)).then(mapInvoice),
  delete: (id: string) => del<void>(`/invoices/${id}`),
}

// ─── Opakowania / Tuleje ──────────────────────────────────────
function mapPackaging(raw: any): PackagingItem {
  return {
    id:           raw.id          ?? '',
    code:         raw.code        ?? '',
    name:         raw.name        ?? '',
    type:         raw.type        ?? 'opakowanie',
    unit:         raw.unit        ?? 'szt',
    kgInitial:    Number(raw.kg_initial   ?? raw.kgInitial   ?? 0),
    kgAvailable:  Number(raw.kg_available ?? raw.kgAvailable ?? 0),
    kgUsed:       Number(raw.kg_used      ?? raw.kgUsed      ?? 0),
    supplierId:   raw.supplier_id  ?? raw.supplierId,
    supplierName: raw.supplier_name ?? raw.supplierName,
    expiryDate:   raw.expiry_date  ?? raw.expiryDate,
    notes:        raw.notes,
    createdAt:    raw.created_at   ?? raw.createdAt ?? '',
  }
}
export const packagingApi = {
  list:    () => get<any[]>('/packaging').then(r => (Array.isArray(r) ? r : []).map(mapPackaging)),
  all:     () => get<any[]>('/packaging/all').then(r => (Array.isArray(r) ? r : []).map(mapPackaging)),
  receive: (dto: CreatePackagingDto) => post<any>('/packaging', toSnake(dto)).then(mapPackaging),
  use:     (id: string, qty: number) => patch<void>(`/packaging/${id}/use`, { qty }),
}

// ─── Zamówienia klientów ──────────────────────────────────────
function mapOrderLine(raw: any) {
  return {
    id:              raw.id              ?? '',
    qty:             Number(raw.qty      ?? 0),
    kgPerUnit:       Number(raw.kg_per_unit   ?? raw.kgPerUnit   ?? 0),
    totalKg:         Number(raw.total_kg      ?? raw.totalKg     ?? 0),
    productTypeId:   raw.product_type_id  ?? raw.productTypeId  ?? '',
    productTypeName: raw.product_type_name ?? raw.productTypeName ?? '',
    recipeId:        raw.recipe_id        ?? raw.recipeId        ?? '',
    recipeName:      raw.recipe_name      ?? raw.recipeName      ?? '',
    packagingId:     raw.packaging_id     ?? raw.packagingId,
    packagingName:   raw.packaging_name   ?? raw.packagingName,
    qtyDone:         Number(raw.qty_done  ?? raw.qtyDone  ?? 0),
    notes:           raw.notes,
  }
}

function mapClientOrder(raw: any): ClientOrder {
  return {
    id:           raw.id           ?? '',
    orderNo:      raw.order_no     ?? raw.orderNo     ?? '',
    clientId:     raw.client_id    ?? raw.clientId    ?? '',
    clientName:   raw.client_name  ?? raw.clientName  ?? '',
    orderDate:    raw.order_date   ?? raw.orderDate   ?? '',
    deliveryDate: raw.delivery_date ?? raw.deliveryDate,
    lines:        (raw.lines ?? []).map(mapOrderLine),
    totalKg:      Number(raw.total_kg    ?? raw.totalKg    ?? 0),
    totalUnits:   Number(raw.total_units ?? raw.totalUnits ?? 0),
    status:       raw.status       ?? 'draft',
    notes:        raw.notes,
    createdAt:    raw.created_at   ?? raw.createdAt   ?? '',
  } as ClientOrder
}

// camelCase → snake_case dla backendu Python
function toSnakeOrderDto(dto: CreateClientOrderDto) {
  return {
    client_id:     dto.clientId,
    order_date:    dto.orderDate,
    delivery_date: dto.deliveryDate,
    notes:         dto.notes,
    lines: dto.lines.map(l => ({
      qty:               l.qty,
      kg_per_unit:       l.kgPerUnit,
      product_type_id:   l.productTypeId,
      product_type_name: (l as any).productTypeName || '',
      recipe_id:         l.recipeId,
      recipe_name:       (l as any).recipeName      || '',
      packaging_id:      l.packagingId,
      packaging_name:    (l as any).packagingName   || '',
      notes:             l.notes,
    })),
  }
}

export interface OrderProductionProgressLine {
  lineId: string
  qtyTotal: number
  qtyDone: number
  qtyPending: number
  qtyReported: number   // wpisane na tablecie (bez planów anulowanych) — tyle wejdzie na WZ/HDI
  qtyRemaining: number
}
export interface OrderProductionProgress {
  orderId: string
  orderNo: string
  lines: OrderProductionProgressLine[]
}

export const clientOrdersApi = {
  list:         (status?: string) => get<any[]>(`/client-orders${status ? `?status=${status}` : ''}`).then(r => r.map(mapClientOrder)),
  byId:         (id: string) => get<any>(`/client-orders/${id}`).then(mapClientOrder),
  create:       (dto: CreateClientOrderDto) => post<any>('/client-orders', toSnakeOrderDto(dto)).then(mapClientOrder),
  productionProgress: (orderId: string) => get<any>(`/client-orders/${orderId}/production-progress`).then((raw: any): OrderProductionProgress => ({
    orderId: raw.order_id ?? raw.orderId ?? '',
    orderNo: raw.order_no ?? raw.orderNo ?? '',
    lines:   (raw.lines ?? []).map((l: any): OrderProductionProgressLine => ({
      lineId:       l.line_id      ?? l.lineId      ?? '',
      qtyTotal:     Number(l.qty_total      ?? l.qtyTotal      ?? 0),
      qtyDone:      Number(l.qty_done       ?? l.qtyDone       ?? 0),
      qtyPending:   Number(l.qty_pending    ?? l.qtyPending    ?? 0),
      qtyReported:  Number(l.qty_reported   ?? l.qtyReported   ?? 0),
      qtyRemaining: Number(l.qty_remaining  ?? l.qtyRemaining  ?? 0),
    })),
  })),
  update:       (id: string, dto: CreateClientOrderDto) => put<any>(`/client-orders/${id}`, toSnakeOrderDto(dto)).then(mapClientOrder),
  updateStatus: (id: string, status: string) => patch<any>(`/client-orders/${id}/status`, { status }).then(mapClientOrder),
  delete:       (id: string) => del<void>(`/client-orders/${id}`),
  // Kartony magazynowe „z ręki" pasujące do zamówienia + przypisanie
  stockCartonSuggestions: (orderId: string) =>
    get<any[]>(`/client-orders/${orderId}/stock-carton-suggestions`)
      .then(rows => (rows ?? []).map(mapStockCartonSuggestion)),
  assignStockCarton: (orderId: string, cartonId: string) =>
    post<any>(`/client-orders/${orderId}/assign-stock-carton`, { carton_id: cartonId }),
}

export interface StockCartonSuggestionLine {
  recipeName: string
  productTypeName: string
  packagingName: string
  kgPerUnit: number
  packedQty: number
}

export interface StockCartonSuggestion {
  cartonId: string
  cartonNo: number | null
  orderLineId: string
  qty: number
  /** Skład kartonu (pozycje). Karton jednorodny = jedna pozycja. */
  lines: StockCartonSuggestionLine[]
}

function mapStockCartonSuggestion(r: any): StockCartonSuggestion {
  return {
    cartonId: r.cartonId ?? r.carton_id ?? '',
    cartonNo: r.cartonNo ?? r.carton_no ?? null,
    orderLineId: r.orderLineId ?? r.order_line_id ?? '',
    qty: Number(r.qty ?? 0),
    lines: (r.lines ?? []).map((l: any): StockCartonSuggestionLine => ({
      recipeName: l.recipe_name ?? l.recipeName ?? '',
      productTypeName: l.product_type_name ?? l.productTypeName ?? '',
      packagingName: l.packaging_name ?? l.packagingName ?? '',
      kgPerUnit: Number(l.kg_per_unit ?? l.kgPerUnit ?? 0),
      packedQty: Number(l.packed_qty ?? l.packedQty ?? 0),
    })),
  }
}

export interface StockCartonLineDto {
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  kgPerUnit: number
  qty: number
}

export interface StockCartonCreateDto {
  clientId: string
  clientName: string
  lines: StockCartonLineDto[]
}

// ─── Palety wydania ─────────────────────────────────────────────
export interface OrderPalletItem {
  id?:           string
  orderLineId:   string
  qty:           number
  // wzbogacone z linii zamówienia (do wyświetlania)
  kgPerUnit?:    number
  productTypeName?: string
  recipeName?:   string
  packagingName?: string
}

export interface OrderPallet {
  id?:        string
  palletNo:   number
  /** Globalny numer kartonu (= paleta), np. "000042". */
  cartonNo?:  string
  notes:      string
  items:      OrderPalletItem[]
  status?:        'created' | 'packing' | 'packed' | 'cold_storage' | 'loaded'
  coldStorageAt?: string | null
  loadedAt?:      string | null
  totalQty?:      number
  totalKg?:       number
}

function mapPalletItem(raw: any): OrderPalletItem {
  return {
    id:              raw.id,
    orderLineId:     raw.order_line_id   ?? raw.orderLineId   ?? '',
    qty:             Number(raw.qty      ?? 0),
    kgPerUnit:       Number(raw.kg_per_unit ?? raw.kgPerUnit ?? 0),
    productTypeName: raw.product_type_name ?? raw.productTypeName ?? '',
    recipeName:      raw.recipe_name     ?? raw.recipeName     ?? '',
    packagingName:   raw.packaging_name  ?? raw.packagingName  ?? '',
  }
}

export type PalletStatus = 'created' | 'packing' | 'packed' | 'cold_storage' | 'loaded'

function mapPallet(raw: any): OrderPallet {
  return {
    id:              raw.id,
    palletNo:        Number(raw.pallet_no ?? raw.palletNo ?? 0),
    cartonNo:        formatCartonNo(raw.carton_no ?? raw.cartonNo),
    notes:           raw.notes ?? '',
    items:           (raw.items ?? []).map(mapPalletItem),
    status:          (raw.status ?? 'created') as PalletStatus,
    coldStorageAt:   raw.cold_storage_at ?? raw.coldStorageAt ?? null,
    loadedAt:        raw.loaded_at       ?? raw.loadedAt       ?? null,
    totalQty:        raw.total_qty != null ? Number(raw.total_qty) : undefined,
    totalKg:         raw.total_kg  != null ? Number(raw.total_kg)  : undefined,
  }
}

export const orderPalletsApi = {
  list: (orderId: string) =>
    get<any[]>(`/client-orders/${orderId}/pallets`)
      .then(r => (Array.isArray(r) ? r : []).map(mapPallet)),
  save: (orderId: string, pallets: OrderPallet[]) =>
    put<any[]>(`/client-orders/${orderId}/pallets`, {
      pallets: pallets.map(p => ({
        pallet_no: p.palletNo,
        notes:     p.notes,
        items:     p.items.map(it => ({ order_line_id: it.orderLineId, qty: it.qty })),
      })),
    }).then(r => (Array.isArray(r) ? r : []).map(mapPallet)),
  reset: (orderId: string, palletNo: number) =>
    post<any>(`/client-orders/${orderId}/pallets/${palletNo}/reset`, {}).then(mapPallet),
}

// ─── Pakowanie sztuk do palety ──────────────────────────────────
export interface PalletPackResult {
  ok:           boolean
  reason:       string
  packedQty:    number
  targetQty:    number
  palletStatus: string
}

export interface PalletBatchRow { batchNo: string; qty: number; weightKg: number }

export interface PalletToPack {
  id: string; orderId: string; palletNo: number; cartonNo: string; status: string
  orderNo: string; clientName: string; packedQty: number; targetQty: number
}

export const palletsApi = {
  toPack: () =>
    get<any[]>('/pallets/to-pack').then(rows => (rows ?? []).map((r: any): PalletToPack => ({
      id: r.id, orderId: r.order_id, palletNo: Number(r.pallet_no ?? 0),
      cartonNo: formatCartonNo(r.carton_no ?? r.cartonNo),
      status: r.status ?? 'created', orderNo: r.order_no ?? '',
      clientName: r.client_name ?? '', packedQty: Number(r.packed_qty ?? 0),
      targetQty: Number(r.target_qty ?? 0),
    }))),
  detail: (palletId: string) => get<any>(`/pallets/by-id/${palletId}`),
  lookup: (code: string) => get<any>(`/pallets/lookup?code=${encodeURIComponent(code)}`),
  packUnit: (palletId: string, code: string) =>
    post<PalletPackResult>(`/pallets/${palletId}/pack`, { code }),
  batchBreakdown: (palletId: string) =>
    get<PalletBatchRow[]>(`/pallets/${palletId}/batch-breakdown`),
}

// ─── Wydania luzem (dispatches) ─────────────────────────────────
export interface DispatchBatchRow { batchNo: string; qty: number; weightKg: number }

export interface DispatchScanResult {
  ok: boolean
  reason: string
  qty: number
  batchBreakdown: DispatchBatchRow[]
}

export interface DispatchOpen {
  id: string; clientName: string; vehicleId: string | null
  cmrRequested: boolean; qty: number; createdAt: string
}

export const dispatchesApi = {
  create: (dto: { clientId?: string; clientName: string; vehicleId?: string; cmrRequested?: boolean }) =>
    post<{ id: string; status: string }>('/dispatches', {
      client_id: dto.clientId ?? null,
      client_name: dto.clientName,
      vehicle_id: dto.vehicleId ?? null,
      cmr_requested: !!dto.cmrRequested,
    }),
  listOpen: () =>
    get<any[]>('/dispatches/open').then(rows => (rows ?? []).map((r: any): DispatchOpen => ({
      id: r.id, clientName: r.client_name ?? '', vehicleId: r.vehicle_id ?? null,
      cmrRequested: !!r.cmr_requested, qty: Number(r.qty ?? 0), createdAt: r.created_at ?? '',
    }))),
  detail: (id: string) => get<any>(`/dispatches/${id}`),
  scan: (id: string, code: string) => post<DispatchScanResult>(`/dispatches/${id}/scan`, { code }),
  // Skan całego kartonu magazynowego (SCARTON|id) na wyjazd — wszystkie sztuki kartonu.
  scanCarton: (id: string, code: string) =>
    post<{ ok: boolean; cartonNo: string; added: number; qty: number; batchBreakdown: DispatchBatchRow[] }>(
      `/dispatches/${id}/scan-carton`, { code }),
  remove: (id: string, code: string) => post<DispatchScanResult>(`/dispatches/${id}/remove`, { code }),
  close: (id: string) => post<{ id: string; status: string; units: number }>(`/dispatches/${id}/close`, {}),
  batchBreakdown: (id: string) => get<DispatchBatchRow[]>(`/dispatches/${id}/batch-breakdown`),
}

// ─── Skanowanie palet (QR) ──────────────────────────────────────
export interface PalletScanResult {
  id:           string
  palletNo:     number
  status:       PalletStatus
  coldStorageAt:string | null
  loadedAt:     string | null
  notes:        string
  items:        OrderPalletItem[]
  totalQty:     number
  totalKg:      number
  order: {
    id:           string
    orderNo:      string
    clientName:   string
    deliveryDate: string | null
    status:       string
  }
}

function mapScanResult(raw: any): PalletScanResult {
  return {
    id:            raw.id,
    palletNo:      Number(raw.pallet_no ?? 0),
    status:        (raw.status ?? 'created') as PalletStatus,
    coldStorageAt: raw.cold_storage_at ?? null,
    loadedAt:      raw.loaded_at ?? null,
    notes:         raw.notes ?? '',
    items:         (raw.items ?? []).map(mapPalletItem),
    totalQty:      Number(raw.total_qty ?? 0),
    totalKg:       Number(raw.total_kg ?? 0),
    order: {
      id:           raw.order?.id ?? '',
      orderNo:      raw.order?.order_no ?? '',
      clientName:   raw.order?.client_name ?? '',
      deliveryDate: raw.order?.delivery_date ?? null,
      status:       raw.order?.status ?? '',
    },
  }
}

export interface LoadingStatusTotals {
  totalPallets:   number
  loadedPallets:  number
  coldPallets:    number
  createdPallets: number
  totalKg:        number
  loadedKg:       number
}

export interface LoadingStatus {
  order: {
    id: string; orderNo: string; clientName: string; deliveryDate: string | null; status: string
  }
  pallets: OrderPallet[]
  totals:  LoadingStatusTotals
}

function mapLoadingStatus(raw: any): LoadingStatus {
  return {
    order: {
      id:           raw.order?.id ?? '',
      orderNo:      raw.order?.order_no ?? '',
      clientName:   raw.order?.client_name ?? '',
      deliveryDate: raw.order?.delivery_date ?? null,
      status:       raw.order?.status ?? '',
    },
    pallets: (raw.pallets ?? []).map(mapPallet),
    totals: {
      totalPallets:   Number(raw.totals?.total_pallets   ?? 0),
      loadedPallets:  Number(raw.totals?.loaded_pallets  ?? 0),
      coldPallets:    Number(raw.totals?.cold_pallets    ?? 0),
      createdPallets: Number(raw.totals?.created_pallets ?? 0),
      totalKg:        Number(raw.totals?.total_kg        ?? 0),
      loadedKg:       Number(raw.totals?.loaded_kg       ?? 0),
    },
  }
}

export interface ActiveLoadingOrder {
  id: string
  orderNo: string
  clientName: string
  deliveryDate: string | null
  orderStatus: string
  totalPallets: number
  loadedPallets: number
  coldPallets: number
  createdPallets: number
}

export interface ColdStoragePart {
  qty:        number
  kgPerUnit:  number
}

export interface ColdStoragePallet {
  orderId:       string
  orderNo:       string
  clientName:    string
  deliveryDate:  string | null
  palletId:      string
  palletNo:      number
  coldStorageAt: string | null
  notes:         string
  totalKg:       number
  totalQty:      number
  parts:         ColdStoragePart[]
}

function mapColdStoragePallet(r: any): ColdStoragePallet {
  const parts = Array.isArray(r.parts)
    ? r.parts.map((p: any) => ({
        qty:       Number(p.qty ?? 0),
        kgPerUnit: Number(p.kg_per_unit ?? p.kgPerUnit ?? 0),
      })).filter((p: ColdStoragePart) => p.qty > 0)
    : []
  return {
    orderId:       r.order_id ?? '',
    orderNo:       r.order_no ?? '',
    clientName:    r.client_name ?? '',
    deliveryDate:  r.delivery_date ?? null,
    palletId:      r.pallet_id ?? '',
    palletNo:      Number(r.pallet_no ?? 0),
    coldStorageAt: r.cold_storage_at ?? null,
    notes:         r.notes ?? '',
    totalKg:       Number(r.total_kg ?? 0),
    totalQty:      Number(r.total_qty ?? 0),
    parts,
  }
}

export const palletScanApi = {
  scan: (
    code: string,
    action: 'cold_storage' | 'loaded',
    operator = '',
    vehicleId = '',
  ) =>
    post<any>('/pallets/scan', { code, action, operator, vehicle_id: vehicleId })
      .then(mapScanResult),
  inColdStorage: () =>
    get<any[]>('/pallets/in-cold-storage')
      .then(arr => (Array.isArray(arr) ? arr : []).map(mapColdStoragePallet)),
  lookup: (code: string) =>
    get<any>(`/pallets/lookup?code=${encodeURIComponent(code)}`).then(mapScanResult),
  loadingStatus: (orderId: string) =>
    get<any>(`/client-orders/${orderId}/loading-status`).then(mapLoadingStatus),
  activeLoading: () =>
    get<any[]>('/pallets/active-loading').then((arr): ActiveLoadingOrder[] =>
      (Array.isArray(arr) ? arr : []).map(r => ({
        id:             r.id,
        orderNo:        r.order_no ?? '',
        clientName:     r.client_name ?? '',
        deliveryDate:   r.delivery_date ?? null,
        orderStatus:    r.order_status ?? '',
        totalPallets:   Number(r.total_pallets ?? 0),
        loadedPallets:  Number(r.loaded_pallets ?? 0),
        coldPallets:    Number(r.cold_pallets ?? 0),
        createdPallets: Number(r.created_pallets ?? 0),
      })),
    ),
  finalizeLoading: (vehicleId: string, orderIds: string[], plate?: string) =>
    post<{
      ok: boolean; vehicle_id: string; plate?: string
      orders: Array<{
        order_id: string; order_no: string; client_name: string; pallets: number
        units?: number; skipped?: string
        wz_id?: string; wz_number?: string
        wz_status?: 'potwierdzony' | 'rozjazd'
        diff?: WzLoadingDiff[]
        hdi_number?: string | null; hdi_error?: string | null
      }>
    }>(
      '/pallets/finalize-loading',
      { vehicle_id: vehicleId, order_ids: orderIds, plate: plate || '' },
    ),
  loadingDocument: (vehicleId: string, orderIds: string[]) =>
    post<any>('/pallets/loading-document', { vehicle_id: vehicleId, order_ids: orderIds }),
}

// ─── QR per sztuka — finished units ────────────────────────────
export interface FinishedUnitCard {
  id: string
  qrCode: string
  status: string
  clientName: string
  productTypeId: string
  productTypeName?: string
  recipeId: string
  recipeName?: string
  tuleja: string
  weightKg: number
  batchNo: string
  trolleyId: string | null
  cartonId: string | null
  /** Globalny numer kartonu (= paleta), np. "000042"; pusty gdy niespakowana. */
  cartonNo: string
  producedAt: string
}

export interface LocationSummary {
  planned: number
  produced: number
  packed: number
  shipped: number
  cartons: string[]
}

export interface ScanProducedResult {
  ok: boolean
  unitId: string
  status: string
  clientName: string
  batchNo: string
  weightKg: number
  done: number
  total: number
}

export const finishedUnitsApi = {
  generateFromPlanLine: (planLineId: string) =>
    post<{ planLineId: string; created: number; existing: number }>(
      '/finished-units/from-plan-line', { plan_line_id: planLineId }),
  scanProduced: (code: string, trolleyId?: string) =>
    post<ScanProducedResult>('/finished-units/scan-produced',
      { code, trolley_id: trolleyId ?? null }),
  lookup: (code: string) =>
    get<FinishedUnitCard>(`/finished-units/lookup?code=${encodeURIComponent(code)}`),
  listByPlanLine: (planLineId: string) =>
    get<FinishedUnitCard[]>(`/finished-units?plan_line_id=${encodeURIComponent(planLineId)}`),
  locationSummary: (batchNo: string) =>
    get<LocationSummary>(`/finished-units/location-summary?batch_no=${encodeURIComponent(batchNo)}`),
}

// ─── Szablony etykiet ─────────────────────────────────────────
export interface LabelFieldPos { x: number; y: number; size: number; fontFamily?: string; bold?: boolean }
export interface LabelSlotOffset { dx: number; dy: number }
/** Kalibracja druku: kompensacja ucinanego paska — przesunięcie X/Y w mm + skala (%).
 *  fit = dopasuj/przytnij tło do treści A4; fitStretch = rozciągnij treść na CAŁĄ wysokość
 *  (usuwa biały pasek u dołu, dopuszcza lekkie pionowe rozciągnięcie). */
export interface LabelPrintCalib { dxMm?: number; dyMm?: number; scale?: number; fit?: boolean; fitStretch?: boolean }
export interface LabelTemplate {
  id: string; clientId: string; recipeId: string; kind: string
  backgroundData: string; backgroundPdf?: string; fieldPositions: Record<string, LabelFieldPos>
  pageSize: string; labelsPerSheet: number; zpl: string
  slotOffsets?: LabelSlotOffset[]
  printCalib?: LabelPrintCalib
  /** Ręczne pozycje pól per slot (etykieta 2+): { "1": { qr: {x,y,size}, batch_no: {...} } }.
   *  Pole z nadpisaniem ignoruje globalny slotOffset — pozycja jest bezwzględna na arkuszu. */
  slotFieldPositions?: Record<string, Record<string, LabelFieldPos>>
}
export const labelTemplatesApi = {
  get: (clientId: string, recipeId: string) =>
    get<{ exists: boolean; template: LabelTemplate | null }>(
      `/label-templates?client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}`),
  exists: (clientId: string, recipeId: string) =>
    get<{ exists: boolean }>(`/label-templates/exists?client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}`),
  resolve: (clientId: string, recipeId: string) =>
    get<{ kind: 'zebra' | 'pdf' | 'none' }>(`/label-templates/resolve?client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}`),
  save: (tpl: { clientId?: string; recipeId?: string; kind?: string; backgroundData?: string; backgroundPdf?: string; fieldPositions?: Record<string, LabelFieldPos>; pageSize?: string; labelsPerSheet?: number; zpl?: string; slotOffsets?: LabelSlotOffset[]; printCalib?: LabelPrintCalib; slotFieldPositions?: Record<string, Record<string, LabelFieldPos>> }) =>
    put<LabelTemplate>('/label-templates', {
      client_id: tpl.clientId ?? '', recipe_id: tpl.recipeId ?? '', kind: tpl.kind ?? 'overlay',
      background_data: tpl.backgroundData ?? '', background_pdf: tpl.backgroundPdf ?? '',
      field_positions: tpl.fieldPositions ?? {},
      page_size: tpl.pageSize ?? 'a4', labels_per_sheet: tpl.labelsPerSheet ?? 2, zpl: tpl.zpl ?? '',
      slot_offsets: tpl.slotOffsets ?? [],
      print_calib: tpl.printCalib ?? {},
      slot_field_positions: tpl.slotFieldPositions ?? {},
    }),
  list: () =>
    get<Array<{ id: string; clientId: string; recipeId: string; kind: string; pageSize: string; labelsPerSheet: number; hasBackground: boolean; updatedAt: string }>>('/label-templates/all'),
  remove: (id: string) => del<{ deleted: boolean }>(`/label-templates/${encodeURIComponent(id)}`),
}

// ─── Etykiety Zebra (ZPL) ───────────────────────────────────────
export interface ZebraRenderResult {
  ok: boolean
  reason?: string
  zpl?: string
  count?: number
}

export const labelsZebraApi = {
  render: (planLineId: string, clientId: string, recipeId: string) =>
    get<ZebraRenderResult>(
      `/labels/zebra/render?plan_line_id=${encodeURIComponent(planLineId)}` +
      `&client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}`),
}

// ─── Wizualny projektant etykiet Zebra (Z-Design-1) ──────────────
export interface ZebraElement {
  id: string
  type: 'text' | 'qr' | 'box' | 'image'
  x: number; y: number
  w?: number; h?: number
  fontMm?: number; align?: 'L' | 'C' | 'R'
  mag?: number; thickMm?: number
  value?: string
  // Tekst-grafika / obraz: render do ^GFA (Arial + polskie znaki, logo HALAL/WE).
  graphic?: boolean          // tekst renderowany jako grafika (font systemowy)
  font?: string              // np. 'Arial' (gdy graphic=true)
  bold?: boolean
  src?: string               // dataURL podglądu obrazu (type='image')
  gf?: string                // gotowa komenda ^GFA (liczona przy zapisie/wgraniu)
}

export interface ZebraDesign {
  clientId: string; recipeId: string; sizeKey: string
  widthMm: number; heightMm: number; dpi: number
  /** Tło ZPL wklejone z Zebra Designer (statyka 1:1); pola dynamiczne nakładane na wierzch. */
  backgroundZpl?: string
  elements: ZebraElement[]
}

export const zebraDesignsApi = {
  get: (clientId: string, recipeId: string) =>
    get<{ exists: boolean; design: ZebraDesign | null }>(
      `/zebra-designs?client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}`),
  save: (d: ZebraDesign) =>
    put<{ ok: boolean }>('/zebra-designs', {
      client_id: d.clientId, recipe_id: d.recipeId, size_key: d.sizeKey,
      width_mm: d.widthMm, height_mm: d.heightMm, dpi: d.dpi,
      background_zpl: d.backgroundZpl ?? '', elements: d.elements,
    }),
  render: (clientId: string, recipeId: string, planLineId: string) =>
    get<{ ok: boolean; reason?: string; zpl?: string; count?: number }>(
      `/zebra-designs/render?client_id=${encodeURIComponent(clientId)}&recipe_id=${encodeURIComponent(recipeId)}&plan_line_id=${encodeURIComponent(planLineId)}`),
  renderSample: (d: ZebraDesign) =>
    post<{ ok: boolean; zpl?: string; count?: number }>('/zebra-designs/render-sample', {
      width_mm: d.widthMm, height_mm: d.heightMm, dpi: d.dpi,
      background_zpl: d.backgroundZpl ?? '', elements: d.elements,
    }),
}

/** Rodzaj etykiety dla pary klient+receptura: 'zebra' (drukarka etykiet) / 'pdf' / 'none'. */
export type LabelKind = 'zebra' | 'pdf' | 'none'

// ─── Wyszukiwanie firmy po NIP/VAT (przez autoryzowany wrapper — z tokenem!) ──
// WAŻNE: te wywołania MUSZĄ iść przez req() (Bearer token), bo /api/gus i /api/vies
// są chronione RBAC. Surowy fetch bez tokenu = 401 „Brak dostępu" (był stały bug).
export interface NipCompany {
  nip: string; regon?: string; nazwa: string
  ulica?: string; numer_budynku?: string; numer_lokalu?: string
  kod_pocztowy?: string; miasto?: string; adres?: string
}
export interface ViesCompany {
  vatNumber: string; countryCode: string; traderName: string; traderAddress: string; valid: boolean
}
export const companyApi = {
  gus: (nip: string) => get<NipCompany>(`/gus/${encodeURIComponent(nip)}`),
  vies: (vat: string) => get<ViesCompany>(`/vies/lookup?vat=${encodeURIComponent(vat)}`),
}

// ─── HDI ────────────────────────────────────────────────────────
export interface HdiBatch { partia: string; termin: string; qty: number }
export interface HdiItem { name: string; qty: number; kg: number; batches: HdiBatch[] }
export interface HdiDoc {
  id: string; number: string; clientName: string; language: string; status: string
  incomplete: boolean; issueDate: string
  header: Record<string, any>; items: HdiItem[]; totals: { qty: number; kg: number }
}

export interface HdiListRow {
  id: string; number: string; clientName: string; status: string
  incomplete: boolean; issueDate: string; createdAt: string
}

// ─── Loty ABP (produkty uboczne — ŻYWY stan; utylizacja/sprzedaż) ───
export const abpApi = {
  lots: (status?: 'open' | 'disposed') =>
    get<any[]>(`/byproducts${status ? `?status=${status}` : ''}`),
}

export const hdiApi = {
  generate: (orderId: string) =>
    post<{ id: string; number: string; status: string; incomplete: boolean; totals: { qty: number; kg: number } }>(`/hdi/generate?order_id=${encodeURIComponent(orderId)}`, {}),
  get: (id: string) => get<any>(`/hdi/${id}`).then((r: any): HdiDoc => ({
    id: r.id, number: r.number, clientName: r.client_name ?? '', language: r.language ?? 'pl',
    status: r.status ?? 'wstepny', incomplete: !!r.incomplete, issueDate: r.issue_date ?? '',
    header: r.header ?? {}, items: r.items ?? [], totals: r.totals ?? { qty: 0, kg: 0 },
  })),
  list: () => get<any[]>('/hdi'),
  listDocs: () => get<any[]>('/hdi').then(rows => (rows ?? []).map((r): HdiListRow => ({
    id: r.id, number: r.number ?? '', clientName: r.client_name ?? '', status: r.status ?? '',
    incomplete: !!r.incomplete, issueDate: r.issue_date ?? '', createdAt: r.created_at ?? '',
  }))),
  pdfUrl: (id: string) => `${BASE}/hdi/${encodeURIComponent(id)}/pdf`,
}

// ─── WZ (Wydanie Zewnętrzne) ────────────────────────────────────
export interface WzLine {
  name: string; qty: number; unit: string; price: number | null; value: number | null
  batch_no?: string | null
  kg_per_unit?: number | null   // waga 1 szt — pozycje FG wyceniane za kg
  total_kg?: number | null      // qty * kg_per_unit
  containers?: number | null    // pojemniki E2 (surowiec) — informacyjnie + HDI
  stock_type?: string | null    // 'raw'|'meat'|'byproduct'|'fg' — surowcowe wchodzą do tabeli HDI
  slaughter_date?: string | null // data uboju partii (stempel przy wystawieniu)
  expiry_date?: string | null    // data ważności partii (stempel przy wystawieniu)
  production_date?: string | null // data produkcji (rozbiór/ważenie/przyjęcie)
}
export interface WzLoadingDiff {
  name: string; batch_no: string | null
  doc_qty: number; loaded_qty: number; diff: number
}
export interface WzDoc {
  id: string; number: string; sourceType?: string; sourceId?: string
  source_type?: string; source_id?: string
  seller?: { name?: string; address?: string; nip?: string; email?: string }
  buyer_name?: string; buyer_address?: string; buyer_nip?: string
  valued: boolean; lines: WzLine[]; total_value: number
  place?: string; issued_date?: string; release_date?: string; status: string
  currency?: string             // 'PLN' | 'EUR'
  eur_rate?: number | null      // kurs średni NBP użyty przy EUR
  loading_status?: 'potwierdzony' | 'rozjazd' | null  // weryfikacja przy załadunku
  loading_diff?: WzLoadingDiff[] | null
  vehicle_plate?: string | null
  loaded_at?: string | null
}
export interface QuantityChainLine {
  recipe_id: string; kg_per_unit: number; name: string
  ordered: number; planned: number; reported: number
  scanned: number; packed: number; shipped: number; documented: number
}
export interface QuantityChain {
  order_id: string; order_no: string; client_name?: string
  wz_number?: string | null; loading_status?: string | null; vehicle_plate?: string | null
  lines: QuantityChainLine[]
}

export const wzApi = {
  generate: (body: {
    sourceType?: string; sourceId?: string;
    buyer: { name: string; address?: string; nip?: string };
    items: { name: string; qty: number; unit?: string; price?: number; batch_no?: string }[];
    valued?: boolean; place?: string; issuedDate?: string; releaseDate?: string; notes?: string;
  }) => post<WzDoc>('/wz', body),
  list: () => get<WzDoc[]>('/wz'),
  byId: (id: string) => get<WzDoc>(`/wz/${id}`),
  stockFg: () => get<any[]>('/wz/stock/finished-goods'),
  stockRaw: () => get<any[]>('/wz/stock/raw'),
  stockRawCard: (stockType: string, stockId: string) =>
    get<any>(`/wz/stock/raw/card?stock_type=${encodeURIComponent(stockType)}&stock_id=${encodeURIComponent(stockId)}`),
  createManual: (body: {
    buyer: { name: string; address?: string; nip?: string };
    items: { stockType: 'fg' | 'raw' | 'meat' | 'byproduct'; stockId: string; name: string; unit: string; qty: number; price?: number; batchNo?: string; kgPerUnit?: number; containers?: number; productionDate?: string | null }[];
    valued?: boolean; place?: string; issuedDate?: string; releaseDate?: string; notes?: string;
    currency?: string; eurRate?: number | null;
  }) => post<WzDoc>('/wz/manual', body),
  updatePrices: (id: string, prices: { index: number; price: number }[]) =>
    patch<WzDoc>(`/wz/${encodeURIComponent(id)}/prices`, { prices }),
  // Edycja pozycji ręcznego WZ: cena/pojemniki swobodnie; ilość koryguje
  // stany magazynowe (różnica) — UI ostrzega o wpływie na traceability.
  updateLines: (id: string, edits: { index: number; qty?: number; price?: number; containers?: number | null }[]) =>
    patch<WzDoc>(`/wz/${encodeURIComponent(id)}/lines`, { edits }),
  // Anuluj WZ: pełny zwrot pozycji na magazyn (kg/szt + pojemniki), dokument
  // zostaje w bazie ze statusem 'anulowany' (nie jest usuwany).
  cancel: (id: string) =>
    patch<WzDoc>(`/wz/${encodeURIComponent(id)}/cancel`, {}),
  quantityChain: (orderId: string) =>
    get<QuantityChain>(`/client-orders/${encodeURIComponent(orderId)}/quantity-chain`),
  fromOrderPreview: (orderId: string) =>
    get<{
      order_id: string; order_no: string; buyer_name: string; buyer_nip: string
      produced: number; ordered: number; incomplete: boolean
      lines: WzLine[]
      existing: { id: string; number: string; valued: boolean } | null
    }>(`/wz/from-order/${encodeURIComponent(orderId)}/preview`),
  fromOrder: (orderId: string, opts?: {
    valued?: boolean; currency?: string; eurRate?: number | null
    prices?: { index: number; price: number }[]
  }) =>
    post<WzDoc & { incomplete?: boolean }>('/wz/from-order', { orderId, ...(opts || {}) }),
  pdfUrl: (id: string) => `${BASE}/wz/${encodeURIComponent(id)}/pdf`,
}

// ─── Przewoźnicy + CMR ──────────────────────────────────────────
export interface Carrier {
  id: string; name: string; address: string; postalCode: string; city: string
  country: string; nip: string; vatEu: string; defaultPlate: string; phone: string; notes: string
}
function mapCarrier(r: any): Carrier {
  return { id: r.id, name: r.name ?? '', address: r.address ?? '', postalCode: r.postal_code ?? '',
    city: r.city ?? '', country: r.country ?? '', nip: r.nip ?? '', vatEu: r.vat_eu ?? '',
    defaultPlate: r.default_plate ?? '', phone: r.phone ?? '', notes: r.notes ?? '' }
}
export interface CarrierInput {
  name: string; address?: string; postal_code?: string; city?: string; country?: string
  nip?: string; vat_eu?: string; default_plate?: string; phone?: string; notes?: string
}
export const carriersApi = {
  list: () => get<any[]>('/carriers').then(rs => (rs ?? []).map(mapCarrier)),
  create: (dto: CarrierInput) => post<any>('/carriers', dto).then(mapCarrier),
  update: (id: string, dto: CarrierInput) => put<any>(`/carriers/${id}`, dto).then(mapCarrier),
  deactivate: (id: string) => patch<any>(`/carriers/${id}/deactivate`, {}),
}

export interface CmrGoodsLine { name: string; qty: number; kg: number }
export interface CmrFormInput {
  carrier_id: string; plate: string; invoice_no: string; instructions: string
  franco?: string; goods_manual: CmrGoodsLine[]
}
export interface CmrListRow {
  id: string; number: string; clientName: string; status: string; issueDate: string; createdAt: string
}
export const cmrApi = {
  generate: (orderId: string, form: CmrFormInput) =>
    post<{ id: string; number: string; status: string }>(`/cmr/generate?order_id=${encodeURIComponent(orderId)}`, form),
  get: (id: string) => get<any>(`/cmr/${id}`),
  listDocs: () => get<any[]>('/cmr').then(rs => (rs ?? []).map((r): CmrListRow => ({
    id: r.id, number: r.number ?? '', clientName: r.client_name ?? '', status: r.status ?? '',
    issueDate: r.issue_date ?? '', createdAt: r.created_at ?? '',
  }))),
  update: (id: string, form: CmrFormInput) =>
    req<{ id: string; status: string }>('PATCH', `/cmr/${encodeURIComponent(id)}`, form),
  pdfUrl: (id: string) => `${BASE}/cmr/${encodeURIComponent(id)}/pdf`,
  getLayout: () => get<Record<string, any>>('/cmr/layout'),
  saveLayout: (positions: Record<string, any>) => put<Record<string, any>>('/cmr/layout', positions),
}

// ─── Ustawienia firmy (do wydruków) ─────────────────────────────
export interface CompanySettings {
  name:       string
  nip:        string
  regon:      string
  address:    string
  city:       string
  postalCode: string
  phone:      string
  email:      string
  vetNumber:      string
  marketDomestic: boolean
  marketEu:       boolean
  loadPlace:      string
}

function mapCompany(raw: any): CompanySettings {
  return {
    name:       raw.name        ?? '',
    nip:        raw.nip         ?? '',
    regon:      raw.regon       ?? '',
    address:    raw.address     ?? '',
    city:       raw.city        ?? '',
    postalCode: raw.postal_code ?? raw.postalCode ?? '',
    phone:      raw.phone       ?? '',
    email:      raw.email       ?? '',
    vetNumber:      raw.vet_number      ?? raw.vetNumber      ?? '',
    marketDomestic: raw.market_domestic ?? raw.marketDomestic ?? true,
    marketEu:       raw.market_eu       ?? raw.marketEu       ?? true,
    loadPlace:      raw.load_place      ?? raw.loadPlace      ?? '',
  }
}

export const settingsApi = {
  getCompany: () =>
    get<any>('/settings/company').then(mapCompany),
  saveCompany: (dto: CompanySettings) =>
    put<any>('/settings/company', {
      name:        dto.name,
      nip:         dto.nip,
      regon:       dto.regon,
      address:     dto.address,
      city:        dto.city,
      postal_code: dto.postalCode,
      phone:       dto.phone,
      email:       dto.email,
      vet_number:      dto.vetNumber,
      market_domestic: dto.marketDomestic,
      market_eu:       dto.marketEu,
      load_place:      dto.loadPlace,
    }).then(mapCompany),
  getDeboningYield: () =>
    get<any>('/settings/deboning-yield').then(r => Number(r.deboningYieldPct ?? 70)),
  saveDeboningYield: (pct: number) =>
    put<any>('/settings/deboning-yield', { pct }).then(r => Number(r.deboningYieldPct ?? pct)),
  // Tary wózków rozbioru (ważenie RS232): GET dostępny dla panelu hali,
  // PUT tylko biuro — ścieżka pod /deboning, nie /settings (RBAC).
  getCartTares: () =>
    get<any>('/deboning/cart-tares').then(r => (r?.cartTares ?? []) as number[]),
  saveCartTares: (tares: number[]) =>
    put<any>('/deboning/cart-tares', { cartTares: tares }).then(r => (r?.cartTares ?? []) as number[]),
}

// ─── Zapotrzebowanie na surowiec ──────────────────────────────
export interface RequirementLineRow {
  meatTypeId: string; meatName: string; kgMeat: number
  rawTypeId: string; rawName: string; requiresDeboning: boolean; kgRaw: number
  lineIndex?: number
}
export interface RawRequirementTotal { rawTypeId: string; rawName: string; kgRaw: number; kgMeat: number }
export interface MaterialRequirements {
  lines: RequirementLineRow[]
  totalsByRaw: RawRequirementTotal[]
  yieldPct: number
}
export interface NetShortageRow {
  rawTypeId: string; rawName: string
  kgNeededRaw: number; kgMeat: number; kgAvailable: number; kgNetShortage: number
}
export interface RequirementsSummary {
  total: RawRequirementTotal[]
  remaining: RawRequirementTotal[]
  netShortage: NetShortageRow[]
  yieldPct: number
}
export interface PreviewItem {
  qty: number; kgPerUnit: number; recipeId: string; productTypeId: string
}

function mapReqLine(r: any): RequirementLineRow {
  return {
    meatTypeId: r.meat_type_id, meatName: r.meat_name, kgMeat: Number(r.kg_meat ?? 0),
    rawTypeId: r.raw_type_id, rawName: r.raw_name,
    requiresDeboning: !!r.requires_deboning, kgRaw: Number(r.kg_raw ?? 0),
    lineIndex: r.line_index,
  }
}
const mapRawTotal = (r: any): RawRequirementTotal =>
  ({ rawTypeId: r.raw_type_id, rawName: r.raw_name, kgRaw: Number(r.kg_raw ?? 0), kgMeat: Number(r.kg_meat ?? 0) })
function mapRequirements(raw: any): MaterialRequirements {
  return {
    lines: (raw.lines ?? []).map(mapReqLine),
    totalsByRaw: (raw.totals_by_raw ?? []).map(mapRawTotal),
    yieldPct: Number(raw.yield_pct ?? 70),
  }
}
const mapNetShortage = (r: any): NetShortageRow => ({
  rawTypeId: r.raw_type_id, rawName: r.raw_name,
  kgNeededRaw: Number(r.kg_needed_raw ?? 0), kgMeat: Number(r.kg_meat ?? 0),
  kgAvailable: Number(r.kg_available ?? 0), kgNetShortage: Number(r.kg_net_shortage ?? 0),
})

export const materialRequirementsApi = {
  preview: (items: PreviewItem[]) =>
    post<any>('/client-orders/preview-requirements', {
      items: items.map(i => ({
        qty: i.qty, kg_per_unit: i.kgPerUnit,
        recipe_id: i.recipeId, product_type_id: i.productTypeId,
      })),
    }).then(mapRequirements),
  forOrder: (id: string, basis: 'total' | 'remaining' = 'total') =>
    get<any>(`/client-orders/${id}/material-requirements?basis=${basis}`).then(mapRequirements),
  summary: (): Promise<RequirementsSummary> =>
    get<any>('/client-orders/material-requirements/summary').then(raw => ({
      total: (raw.total ?? []).map(mapRawTotal),
      remaining: (raw.remaining ?? []).map(mapRawTotal),
      netShortage: (raw.net_shortage ?? []).map(mapNetShortage),
      yieldPct: Number(raw.yield_pct ?? 70),
    })),
}

// ─── Plany produkcji ──────────────────────────────────────────
// BUGFIX: Backend zwraca snake_case, frontend oczekuje camelCase
// Bez tego mapowania: totalKg=NaN, planNo=undefined, kgPerUnit=NaN
function mapPlanLine(raw: any) {
  // batch_allocation peut être un objet JSON ou une chaîne
  let batchAllocation: Record<string, any> = {}
  const ba = raw.batch_allocation ?? raw.batchAllocation
  if (ba && typeof ba === 'object') batchAllocation = ba
  else if (ba && typeof ba === 'string') { try { batchAllocation = JSON.parse(ba) } catch {} }

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
    batchAllocation,
    kgAssigned:     Number(raw.kg_assigned   ?? raw.kgAssigned  ?? 0),
    clientOrderId:     raw.client_order_id      ?? raw.clientOrderId,
    clientOrderNo:     raw.client_order_no      ?? raw.clientOrderNo,
    clientOrderLineId: raw.client_order_line_id ?? raw.clientOrderLineId,
    clientName:        raw.client_name          ?? raw.clientName,
    status:            raw.status               ?? 'pending',
    qtyDone:           Number(raw.qty_done   ?? raw.qtyDone   ?? 0),
    lineStatus:        (raw.line_status      ?? raw.lineStatus ?? 'PLANNED') as 'PLANNED'|'IN_PROGRESS'|'DONE',
    workerEntries:     Array.isArray(raw.worker_entries ?? raw.workerEntries)
                        ? (raw.worker_entries ?? raw.workerEntries) : [],
    progressUpdatedAt: raw.progress_updated_at ?? raw.progressUpdatedAt ?? null,
  }
}

function mapPlan(raw: any): any {
  return {
    id:                 raw.id          ?? '',
    planNo:             raw.plan_no     ?? raw.planNo     ?? '',
    planDate:           raw.plan_date   ?? raw.planDate   ?? '',
    totalKg:            Number(raw.total_kg    ?? raw.totalKg    ?? 0),
    totalUnits:         Number(raw.total_units ?? raw.totalUnits ?? 0),
    status:             raw.status      ?? 'draft',
    notes:              raw.notes,
    createdAt:          raw.created_at  ?? raw.createdAt  ?? '',
    tabletFinishedAt:   raw.tablet_finished_at  ?? raw.tabletFinishedAt  ?? null,
    officeConfirmedAt:  raw.office_confirmed_at ?? raw.officeConfirmedAt ?? null,
    lines:              (raw.lines ?? []).map(mapPlanLine),
  }
}

export const productionPlansApi = {
  list:         () => get<any[]>('/production-plans').then(r => r.map(mapPlan)),
  byId:         (id: string) => get<any>(`/production-plans/${id}`).then(mapPlan),
  create:       (dto: CreateProductionPlanDto) => post<any>('/production-plans', toSnake(dto)).then(mapPlan),
  update:       (id: string, dto: CreateProductionPlanDto) => put<any>(`/production-plans/${id}`, toSnake(dto)).then(mapPlan),
  updateStatus: (id: string, status: string) => patch<void>(`/production-plans/${id}/status`, { status }),
  updateLineProgress: (
    planId: string,
    lineId: string,
    body: { qtyDone: number; lineStatus: 'PLANNED'|'IN_PROGRESS'|'DONE';
            workerEntries: { workerId: string; workerName: string; pieces: number; addedAt: string }[] },
  ) => patch<any>(`/production-plans/${planId}/lines/${lineId}/progress`, {
    qty_done: body.qtyDone,
    line_status: body.lineStatus,
    worker_entries: body.workerEntries,
  }),
  tabletFinish:  (planId: string, entries: any[]) =>
    post<any>(`/production-plans/${planId}/tablet-finish`, { entries }),
  tabletReopen:  (planId: string) =>
    post<any>(`/production-plans/${planId}/tablet-reopen`, {}),
  officeConfirm: (planId: string) =>
    post<any>(`/production-plans/${planId}/office-confirm`, {}),
}

// ─── Day closures ────────────────────────────────────────────
export interface DayClosure {
  id: string
  closureDate: string
  section: 'rozbior' | 'masownia' | 'produkcja'
  closedAt: string
  closedBy: string
  notes: string
}

function mapDayClosure(r: any): DayClosure {
  return {
    id:          r.id ?? '',
    closureDate: r.closure_date ?? r.closureDate ?? '',
    section:     (r.section ?? '') as DayClosure['section'],
    closedAt:    r.closed_at ?? r.closedAt ?? '',
    closedBy:    r.closed_by ?? r.closedBy ?? '',
    notes:       r.notes ?? '',
  }
}

export const dayClosuresApi = {
  listToday: () =>
    get<any[]>('/day-closures').then(r => (Array.isArray(r) ? r : []).map(mapDayClosure)),
  close: (section: DayClosure['section'], notes = '', closedBy = '') =>
    post<any>('/day-closures', { section, notes, closed_by: closedBy }).then(mapDayClosure),
  reopen: (section: DayClosure['section']) =>
    del<{ ok: boolean }>(`/day-closures/${section}`),
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
    kgReserved:     Number(raw.kg_reserved  ?? raw.kgReserved  ?? 0),
    materialTypeId: raw.material_type_id ?? raw.materialTypeId ?? '',
    materialName:   raw.material_name    ?? raw.materialName   ?? '',
    kgFree:         Number(
      raw.kg_free ?? raw.kgFree
      ?? (Number(raw.kg_available ?? raw.kgAvailable ?? 0)
          - Number(raw.kg_reserved  ?? raw.kgReserved  ?? 0))
    ),
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
  // createFromOrder usunięty — backend zwraca 410, właściwy flow to
  // mixingOrdersApi.finishSession (PATCH /api/mixing-orders/{id}/finish-session).
  getFullTrace: (id: string) => get<any>(`/seasoned-meat/${id}/trace`),
  // Ręczna korekta/zamknięcie partii (uzgodnienie teoria↔fizyka). close=true
  // zamyka do 0 (spisanie resztki); inaczej ustawia realną wagę (np. 119→120).
  reconcile: (id: string, opts: { targetKg?: number; reason?: string; close?: boolean }) =>
    post<any>(`/seasoned-meat/${id}/reconcile`, opts).then(mapSeasonedMeat),
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
    materialTypeId: raw.material_type_id ?? raw.materialTypeId ?? '',
    materialName:   raw.material_name   ?? raw.materialName   ?? '',
    supplierName:   raw.supplier_name   ?? raw.supplierName   ?? '',
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
    daySeq:         Number(raw.day_seq   ?? raw.daySeq          ?? 0),
    notes:          raw.notes,
    createdAt:      raw.created_at       ?? raw.createdAt       ?? '',
    startedAt:      raw.started_at       ?? raw.startedAt,
    completedAt:    raw.completed_at     ?? raw.completedAt,
    kgInMachine:    Number(raw.kgInMachine ?? raw.kg_in_machine ?? 0),
    sessions:       (raw.sessions ?? []).map(mapMixingSession),
  } as MixingOrder
}

export const mixingOrdersApi = {
  list:              (status?: string) =>
    get<any[]>(`/mixing-orders${status ? `?status=${status}` : ''}`)
      .then(r => (Array.isArray(r) ? r : (r as any).data ?? []).map(mapMixingOrder)),
  byId:              (id: string) =>
    get<any>(`/mixing-orders/${id}`).then(mapMixingOrder),
  // Plan masowania dla danego dnia (domyślnie dziś): kolejka 1→n + rev
  // (wykrywanie zmian planu na panelu)
  dayPlan:           (date?: string) =>
    get<any>(`/mixing-orders/day-plan${date ? `?date=${date}` : ''}`).then(r => ({
      items: (r?.items ?? []).map(mapMixingOrder),
      rev:   r?.rev ?? '',
      planDate: r?.plan_date ?? r?.planDate ?? date ?? '',
    })),
  saveDayPlan:       (items: {
    id?: string
    recipeId: string
    meatKg: number
    seq: number
    meatLots: { meatLotId: string; kgPlanned: number }[]
  }[], date?: string) =>
    put<any>('/mixing-orders/day-plan', {
      date,
      items: items.map(i => ({
        id: i.id,
        recipeId: i.recipeId,
        meatKg: i.meatKg,
        seq: i.seq,
        meatLots: i.meatLots.map(l => ({
          meatLotId: l.meatLotId,
          kgPlanned: l.kgPlanned,
        })),
      })),
    }).then(r => ({
      items: (r?.items ?? []).map(mapMixingOrder),
      rev:   r?.rev ?? '',
      planDate: r?.plan_date ?? r?.planDate ?? date ?? '',
    })),
  create:            (dto: CreateMixingOrderDto) =>
    post<any>('/mixing-orders', {
      product_type_id: dto.productTypeId,
      recipe_id:       dto.recipeId,
      meat_kg:         dto.meatKg,
      notes:           dto.notes,
      meat_lots:       dto.meatLots.map(l => ({
        meat_lot_id: l.meatLotId,
        kg_planned:  l.kgPlanned,
      })),
    }).then(mapMixingOrder),
  start:             (id: string, dto: any) =>
    patch<any>(`/mixing-orders/${id}/start`, toSnake(dto)).then(mapMixingOrder),
  replaceMeatLots: (id: string, lots: { meatLotId: string; kgPlanned: number }[]) =>
    patch<any>(`/mixing-orders/${id}/meat-lots`, {
      meat_lots: lots.map(l => ({ meat_lot_id: l.meatLotId, kg_planned: l.kgPlanned })),
    }).then(mapMixingOrder),
  allocateToMachine: (id: string, m: MachineId, kg: number) =>
    patch<any>(`/mixing-orders/${id}/allocate`, { machine_id: m, kg }).then(mapMixingOrder),
  confirmStep:   (id: string, dto: any) =>
    patch<any>(`/mixing-orders/${id}/confirm-step`, toSnake(dto)).then(mapMixingOrder),
  finishSession: (id: string, kg: number, batchNo: string, lotAllocations?: any[]) =>
    patch<any>(`/mixing-orders/${id}/finish-session`, {
      kg_actual: kg,
      batch_no: batchNo || '',
      lot_allocations: lotAllocations ?? [],
    }).then(mapMixingOrder),
  undoConfirm: (id: string) =>
    patch<any>(`/mixing-orders/${id}/undo-confirm`, {}).then(mapMixingOrder),
  confirm:     (id: string) =>
    patch<any>(`/mixing-orders/${id}/confirm`, {}).then(mapMixingOrder),
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
// BUGFIX: Backend zwraca snake_case, frontend oczekuje camelCase
function mapFinishedGoodsSession(raw: any) {
  return {
    qty:             Number(raw.qty             ?? 0),
    kgPerUnit:       Number(raw.kg_per_unit     ?? raw.kgPerUnit     ?? 0),
    totalKg:         Number(raw.total_kg        ?? raw.totalKg       ?? 0),
    seasonedBatchNos: raw.seasoned_batch_nos    ?? raw.seasonedBatchNos ?? [],
    workerNames:     raw.worker_names           ?? raw.workerNames    ?? [],
    addedAt:         raw.added_at               ?? raw.addedAt        ?? '',
  }
}

function mapFinishedGoodsItem(raw: any): FinishedGoodsItem {
  return {
    id:              raw.id,
    batchNo:         raw.batch_no           ?? raw.batchNo           ?? '',
    planNo:          raw.plan_no            ?? raw.planNo            ?? '',
    productTypeId:   raw.product_type_id    ?? raw.productTypeId     ?? '',
    productTypeName: raw.product_type_name  ?? raw.productTypeName   ?? '',
    recipeId:        raw.recipe_id          ?? raw.recipeId          ?? '',
    recipeName:      raw.recipe_name        ?? raw.recipeName        ?? '',
    packagingId:     raw.packaging_id       ?? raw.packagingId,
    packagingName:   raw.packaging_name     ?? raw.packagingName,
    clientName:      raw.client_name        ?? raw.clientName,
    clientOrderNo:   raw.client_order_no    ?? raw.clientOrderNo,
    qty:             Number(raw.qty         ?? 0),
    kgPerUnit:       Number(raw.kg_per_unit ?? raw.kgPerUnit         ?? 0),
    totalKg:         Number(raw.total_kg    ?? raw.totalKg           ?? 0),
    qtyAvailable:    Number(raw.qty_available ?? raw.qtyAvailable    ?? 0),
    qtyShipped:      Number(raw.qty_shipped   ?? raw.qtyShipped      ?? 0),
    producedDate:    raw.produced_date      ?? raw.producedDate      ?? '',
    producedBy:      raw.produced_by        ?? raw.producedBy        ?? [],
    seasonedBatchNos: raw.seasoned_batch_nos ?? raw.seasonedBatchNos ?? [],
    createdAt:       raw.created_at         ?? raw.createdAt         ?? '',
    subEntries:      (raw.sub_entries ?? raw.subEntries ?? []).map(mapFinishedGoodsSession),
  } as any
}

export const finishedGoodsApi = {
  list: async () => {
    const items = await get<any[]>('/finished-goods')
    return items.map(mapFinishedGoodsItem)
  },
  create: (dto: any) => post<FinishedGoodsItem>('/finished-goods', toSnake(dto)),
  finishProductionDay: (planId: string, entries: any[]) =>
    post<any>('/finished-goods/finish-day', { plan_id: planId, entries: entries.map(toSnake) }),
}

// ─── Karton magazynowy (jednostka pakowa bez zamówienia) ──────────
export interface StockCartonLine {
  id: string
  recipeId: string
  recipeName: string
  productTypeId: string
  productTypeName: string
  packagingId: string
  packagingName: string
  kgPerUnit: number
  targetQty: number
  packedQty: number
}

export interface StockCarton {
  id: string
  cartonNo: number | null
  clientName: string
  /** Skład kartonu (pozycje). Karton jednorodny = jedna pozycja. */
  lines: StockCartonLine[]
  /** Nazwa pierwszej pozycji — skrótowy podpis kartonu w listach. */
  recipeName: string
  productTypeName: string
  packagingName: string
  kgPerUnit: number
  targetQty: number
  packedQty: number
  status: string
}

function mapStockCartonLine(l: any): StockCartonLine {
  return {
    id: l.id ?? '',
    recipeId: l.recipe_id ?? l.recipeId ?? '',
    recipeName: l.recipe_name ?? l.recipeName ?? '',
    productTypeId: l.product_type_id ?? l.productTypeId ?? '',
    productTypeName: l.product_type_name ?? l.productTypeName ?? '',
    packagingId: l.packaging_id ?? l.packagingId ?? '',
    packagingName: l.packaging_name ?? l.packagingName ?? '',
    kgPerUnit: Number(l.kg_per_unit ?? l.kgPerUnit ?? 0),
    targetQty: Number(l.target_qty ?? l.targetQty ?? 0),
    packedQty: Number(l.packed_qty ?? l.packedQty ?? 0),
  }
}

function mapStockCarton(r: any): StockCarton {
  const lines: StockCartonLine[] = (r.lines ?? []).map(mapStockCartonLine)
  const first = lines[0]
  return {
    id: r.id,
    cartonNo: r.carton_no ?? r.cartonNo ?? null,
    clientName: r.client_name ?? '',
    lines,
    recipeName: first?.recipeName ?? r.recipe_name ?? '',
    productTypeName: first?.productTypeName ?? r.product_type_name ?? '',
    packagingName: first?.packagingName ?? r.packaging_name ?? '',
    kgPerUnit: first?.kgPerUnit ?? Number(r.kg_per_unit ?? 0),
    targetQty: Number(r.target_qty ?? 0),
    packedQty: Number(r.packed_qty ?? 0),
    status: r.status ?? 'open',
  }
}

export interface StockCartonScanResult {
  ok: boolean; cartonNo: string; packedQty: number; targetQty: number
  full: boolean; batchNo: string
}

export const stockCartonsApi = {
  create:   (dto: StockCartonCreateDto) => post<any>('/stock-cartons', toSnake(dto)).then(mapStockCarton),
  list:     () => get<any[]>('/stock-cartons').then(rows => (rows ?? []).map(mapStockCarton)),
  listOpen: () => get<any[]>('/stock-cartons/open').then(rows => (rows ?? []).map(mapStockCarton)),
  get:      (id: string) => get<any>(`/stock-cartons/${id}`).then(mapStockCarton),
  scan:     (id: string, code: string) => post<StockCartonScanResult>(`/stock-cartons/${id}/scan`, { code }),
  // Uprawnione sztuki (prefetch do walidacji lokalnej offline) → kody QR
  eligibleUnits: (id: string) =>
    get<any[]>(`/stock-cartons/${id}/eligible-units`).then(rows => (rows ?? []).map((r: any) => r.code as string)),
  // Snapshot uprawnionych sztuk per pozycja (+ wolne miejsce) — walidacja offline per pozycja
  eligibleByLine: (id: string) =>
    get<any[]>(`/stock-cartons/${id}/eligible-by-line`).then(rows => (rows ?? []).map((r: any) => ({
      lineId: (r.lineId ?? r.line_id ?? '') as string,
      remaining: Number(r.remaining ?? 0),
      codes: ((r.codes ?? []) as string[]),
    }))),
  // Sztuki uprawnione do konkretnej pozycji (podgląd w biurze)
  lineEligible: (lineId: string) =>
    get<any[]>(`/stock-cartons/lines/${lineId}/eligible-units`)
      .then(rows => (rows ?? []).map((r: any) => ({ code: r.code as string, batchNo: (r.batchNo ?? r.batch_no ?? '') as string }))),
  // Biuro: dorzuć N uprawnionych sztuk z magazynu do pozycji (FIFO)
  addToLine: (cartonId: string, lineId: string, qty: number) =>
    post<{ ok: boolean; added: number }>(`/stock-cartons/${cartonId}/lines/${lineId}/add`, { qty }),
}

// ─── Health ───────────────────────────────────────────────────
export const healthApi = {
  check: () => get<any>('/health'),
}

// ─── Samochody do załadunku ───────────────────────────────────
export type VehicleKind = 'own' | 'external'
export type VehicleType = 'dostawczy' | 'tir' | 'solo' | 'inny'

export interface Vehicle {
  id:          string
  name:        string
  plate:       string
  kind:        VehicleKind
  vehicleType: VehicleType
  sortOrder:   number
  notes:       string
  active:      boolean
}

export interface VehicleInput {
  name:        string
  plate:       string
  kind:        VehicleKind
  vehicleType: VehicleType
  sortOrder:   number
  notes:       string
  active?:     boolean
}

function mapVehicle(raw: any): Vehicle {
  return {
    id:          raw.id,
    name:        raw.name ?? '',
    plate:       raw.plate ?? '',
    kind:        (raw.kind ?? 'own') as VehicleKind,
    vehicleType: (raw.vehicle_type ?? raw.vehicleType ?? 'dostawczy') as VehicleType,
    sortOrder:   Number(raw.sort_order ?? raw.sortOrder ?? 0),
    notes:       raw.notes ?? '',
    active:      raw.active !== false,
  }
}

function vehiclePayload(dto: VehicleInput): any {
  return {
    name:         dto.name,
    plate:        dto.plate,
    kind:         dto.kind,
    vehicle_type: dto.vehicleType,
    sort_order:   dto.sortOrder,
    notes:        dto.notes,
    active:       dto.active ?? true,
  }
}

export const vehiclesApi = {
  list: (includeInactive = false) =>
    get<any[]>(`/vehicles${includeInactive ? '?include_inactive=true' : ''}`)
      .then(r => (Array.isArray(r) ? r : []).map(mapVehicle)),
  create: (dto: VehicleInput) =>
    post<any>('/vehicles', vehiclePayload(dto)).then(mapVehicle),
  update: (id: string, dto: VehicleInput) =>
    put<any>(`/vehicles/${id}`, vehiclePayload(dto)).then(mapVehicle),
  remove: (id: string) =>
    del<{ ok: boolean; id: string }>(`/vehicles/${id}`),
}

// ─── Traceability ─────────────────────────────────────────────
export const traceabilityApi = {
  // backend Query alias = "batchId" (camelCase) — bez tego zwraca pustą strukturę
  backward: (batchId: string) =>
    get<any>(`/traceability?batchId=${encodeURIComponent(batchId)}&direction=backward`),
  forward:  (batchId: string) =>
    get<any>(`/traceability?batchId=${encodeURIComponent(batchId)}&direction=forward`),
  batchReport: (batchNo: string) =>
    get<any>(`/traceability/batch-report/${encodeURIComponent(batchNo)}`),
}

// ─── Recall (Wycofanie partii) ────────────────────────────────
export const recallApi = {
  get: (batchId: string) => get<any>(`/recall/${encodeURIComponent(batchId)}`),
}

// ─── Śledzenie surowca (drzewo trace) ─────────────────────────
export const traceApi = {
  tree: (q: string) => get<any>(`/trace/tree?q=${encodeURIComponent(q)}`),
}

// Re-eksportuj typy z mockApi (niezmienione)
export type {
  PurchaseInvoice, CreatePurchaseInvoiceDto,
  InvoiceCategory,
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

export { BASE as API_BASE }
