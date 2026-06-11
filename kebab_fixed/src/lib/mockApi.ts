/**
 * mockApi.ts — localStorage persistence
 *
 * v2: dodane edit(), cancel(), historia, logi, checkDuplicate, FEFO limit 25
 */
import {
  MOCK_SUPPLIERS, MOCK_USERS, MOCK_BATCHES, MOCK_DEBONINGS, MOCK_MEAT,
} from './mockData'
import type {
  RawBatch, DeboningSession, MeatStock, Supplier, User,
  CreateRawBatchDto, CreateDeboningDto, CreateSupplierDto,
  Paginated,
} from '@/types'
import type {
  EditRawBatchDto, CancelRawBatchDto,
  RawBatchHistoryEntry, RawBatchSnapshot, SystemLog,
  SystemLogAction,
} from '@/features/raw-batches/types'
import { calcDeboning } from './utils'
import { isExpired, isActiveForProduction } from './utils/fefo'

// ─── Storage keys ─────────────────────────────────────────────────────────────
const KEYS = {
  batches:   'kebab_mes_batches',
  debonings: 'kebab_mes_debonings',
  meat:      'kebab_mes_meat',
  suppliers: 'kebab_mes_suppliers',
  users:     'kebab_mes_users',
  counters:  'kebab_mes_counters',
  byproducts:'kebab_mes_byproducts',
  invoices:  'kebab_mes_invoices',
  history:   'kebab_mes_batch_history',
  logs:      'kebab_mes_system_logs',
}

// ─── Load/save helpers ────────────────────────────────────────────────────────
function load<T>(key: string, def: T[]): T[] {
  try {
    const s = localStorage.getItem(key)
    if (s) { const p = JSON.parse(s); if (Array.isArray(p)) return p }
  } catch { /* ignore */ }
  return [...def]
}
function save<T>(key: string, data: T[]) {
  try { localStorage.setItem(key, JSON.stringify(data)) } catch { /* ignore */ }
}

function loadCounters() {
  try {
    const s = localStorage.getItem(KEYS.counters)
    if (s) return JSON.parse(s)
  } catch { /* ignore */ }
  return { batchSeq: 170, debSeq: 0, meatSeq: 0, logSeq: 0 }
}
function saveCounters(c: object) {
  try { localStorage.setItem(KEYS.counters, JSON.stringify(c)) } catch { /* ignore */ }
}

// ─── State ────────────────────────────────────────────────────────────────────
let batches   = load<RawBatch>(KEYS.batches, MOCK_BATCHES)
let debonings = load<DeboningSession>(KEYS.debonings, MOCK_DEBONINGS)
let meat      = load<MeatStock>(KEYS.meat, MOCK_MEAT)
let suppliers = load<Supplier>(KEYS.suppliers, MOCK_SUPPLIERS)
let users     = load<User>(KEYS.users, MOCK_USERS)
let invoices  = load<PurchaseInvoice>(KEYS.invoices, [])
let history   = load<RawBatchHistoryEntry>(KEYS.history, [])
let logs      = load<SystemLog>(KEYS.logs, [])

const ctr = loadCounters()
let batchSeq = ctr.batchSeq
let debSeq   = ctr.debSeq
let meatSeq  = ctr.meatSeq
let logSeq   = ctr.logSeq ?? 0

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Numer zlecenia datowany PREFIKS/dd/mm/rr (mirror backend next_dated_no, mock-only).
const datedNo = (prefix: string, n: number): string => {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  const base = `${prefix}/${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(-2)}`
  return n <= 1 ? base : `${base}/${n}`
}
const delay = (ms = 300) => new Promise(r => setTimeout(r, ms))
const cuid  = () => Math.random().toString(36).slice(2, 12)
const nowIso = () => new Date().toISOString()

function paginate<T>(arr: T[]): Paginated<T> {
  return { data: arr, total: arr.length, page: 1, limit: arr.length }
}

// Snapshot — immutable, używany w historii i przyszłym traceability
function buildSnapshot(b: RawBatch): RawBatchSnapshot {
  return {
    internalBatchNo:  b.internalBatchNo,
    supplierId:       b.supplierId,
    supplierName:     b.supplierName,
    supplierBatchNo:  b.supplierBatchNo,
    slaughterDate:    b.slaughterDate,
    receivedDate:     b.receivedDate,
    expiryDate:       b.expiryDate,
    kgReceived:       Number(b.kgReceived),
    kgAvailable:      Number(b.kgAvailable),
    pricePerKg:       Number(b.pricePerKg),
  }
}

// Zapis historii (zawsze przez tę funkcję, nigdy bezpośrednio)
function addHistory(entry: Omit<RawBatchHistoryEntry, 'id' | 'changedAt'>) {
  const h: RawBatchHistoryEntry = {
    ...entry,
    id:        cuid(),
    changedAt: nowIso(),
  }
  history = [h, ...history]
  save(KEYS.history, history)
}

// Zapis logu operacyjnego (zawsze przez tę funkcję)
function addLog(
  action: SystemLogAction,
  entityId: string,
  metadata: Record<string, unknown>,
) {
  logSeq++
  const log: SystemLog = {
    id:        cuid(),
    action,
    entity:    'raw_batch',
    entityId,
    metadata,
    createdAt: nowIso(),
  }
  logs = [log, ...logs]
  save(KEYS.logs, logs)
  saveCounters({ batchSeq, debSeq, meatSeq, logSeq })
}

// checkEditLock — zwraca blokadę lub brak
function checkEditLock(b: RawBatch): { locked: boolean; reason?: string } {
  if (b.status === 'cancelled') return { locked: true, reason: 'Partia anulowana' }
  if (b.kgAvailable < b.kgReceived && Number(b.kgUsed) > 0)
    return { locked: true, reason: 'Partia jest lub była używana w rozbiorze' }
  if (b.isInUse) return { locked: true, reason: 'Trwa sesja rozbioru tej partii' }
  return { locked: false }
}

// ─── RAW BATCHES API ──────────────────────────────────────────────────────────
export const rawBatchesApi = {

  // Lista operacyjna: tylko aktywne, FEFO, limit 25
  list: async (): Promise<Paginated<RawBatch>> => {
    await delay()
    const active = batches
      .filter(b =>
        b.status !== 'cancelled' &&
        isActiveForProduction(b.expiryDate, Number(b.kgAvailable))
      )
      // FEFO: expiry_date ASC, internal_batch_seq ASC, created_at ASC
      .sort((a, b) => {
        if (a.expiryDate !== b.expiryDate) return a.expiryDate < b.expiryDate ? -1 : 1
        if (a.internalBatchSeq !== b.internalBatchSeq)
          return a.internalBatchSeq - b.internalBatchSeq
        return a.createdAt < b.createdAt ? -1 : 1
      })
      .slice(0, 25)
    return paginate(active)
  },

  byId: async (id: string): Promise<RawBatch> => {
    await delay(100)
    const b = batches.find(x => x.id === id)
    if (!b) throw new Error('Partia nie znaleziona')
    return b
  },

  // Wszystkie partie — do traceability, HACCP, raportów (bez filtrowania aktywnych)
  all: async (): Promise<Paginated<RawBatch>> => {
    await delay()
    const all = [...batches]
      .filter(b => b.status !== 'cancelled')
      .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
    return paginate(all)
  },

  nextNumber: async () => {
    await delay(100)
    const next = batchSeq + 1
    return {
      suggestedBatchNo: `R${next}`,
      suggestedSeq:     next,
      note:             'Numer zostanie potwierdzony przy zapisie',
      // legacy fields
      nextSeq: next, nextBatchNo: `R${next}`, suggestion: '',
    }
  },

  // Sprawdź duplikat przed create
  checkDuplicate: async (
    supplierId: string, supplierBatchNo: string, slaughterDate: string,
  ): Promise<boolean> => {
    await delay(100)
    return batches.some(b =>
      b.supplierId === supplierId &&
      b.supplierBatchNo === supplierBatchNo &&
      b.slaughterDate === slaughterDate &&
      b.status !== 'cancelled'
    )
  },

  create: async (dto: CreateRawBatchDto): Promise<RawBatch> => {
    await delay(500)

    // HACCP — twarda blokada przeterminowanego surowca
    if (isExpired(dto.expiryDate)) {
      throw new Error('Partia przeterminowana — użycie zabronione (HACCP)')
    }

    batchSeq++
    const sup = suppliers.find(s => s.id === dto.supplierId)

    let supplierBatchNo = dto.supplierBatchNo
    if (dto.supplierBatches && dto.supplierBatches.length > 1) {
      supplierBatchNo = dto.supplierBatches.map(b => b.supplierBatchNo).join(', ')
    }

    const nb: RawBatch = {
      id:               cuid(),
      internalBatchNo:  `R${batchSeq}`,
      internalBatchSeq: batchSeq,
      supplierBatchNo,
      supplierId:       dto.supplierId,
      supplierName:     sup?.name,
      supplierBatches:  dto.supplierBatches,
      slaughterDate:    dto.slaughterDate,
      receivedDate:     dto.receivedDate,
      expiryDate:       dto.expiryDate,
      kgReceived:       dto.kgReceived,
      kgAvailable:      dto.kgReceived,
      kgUsed:           0,
      utilizationPct:   0,
      pricePerKg:       dto.pricePerKg,
      invoiceNo:        dto.invoiceNo,
      status:           'active',
      isInUse:          false,
      createdAt:        nowIso(),
    }

    batches = [nb, ...batches]
    save(KEYS.batches, batches)
    saveCounters({ batchSeq, debSeq, meatSeq, logSeq })

    // Historia + log
    addHistory({
      rawBatchId:     nb.id,
      changedBy:      undefined,
      changeType:     'create',
      beforeSnapshot: null,
      afterSnapshot:  buildSnapshot(nb),
      reason:         'Przyjęcie partii',
    })
    addLog('CREATE_BATCH', nb.id, {
      internalBatchNo: nb.internalBatchNo,
      supplierId: nb.supplierId,
      kgReceived: nb.kgReceived,
    })

    return nb
  },

  // Edycja — blokada jeśli used/cancelled/in_use, zapis historii + log
  edit: async (id: string, dto: EditRawBatchDto): Promise<RawBatch> => {
    await delay(400)
    const idx = batches.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Partia nie znaleziona')
    const old = batches[idx]

    // Blokada
    const lock = checkEditLock(old)
    if (lock.locked) throw new Error(lock.reason)

    // HACCP — blokada przeterminowanej daty jeśli zmieniana
    if (dto.expiryDate && isExpired(dto.expiryDate)) {
      throw new Error('Nowa data ważności jest przeterminowana — użycie zabronione (HACCP)')
    }

    const beforeSnap = buildSnapshot(old)
    const updated: RawBatch = {
      ...old,
      kgReceived:  dto.kgReceived  ?? old.kgReceived,
      pricePerKg:  dto.pricePerKg  ?? old.pricePerKg,
      invoiceNo:   dto.invoiceNo   ?? old.invoiceNo,
      expiryDate:  dto.expiryDate  ?? old.expiryDate,
      editReason:  dto.editReason,
      editedAt:    nowIso(),
      editedBy:    dto.editedBy,
      updatedAt:   nowIso(),
    }

    batches = batches.map(b => b.id === id ? updated : b)
    save(KEYS.batches, batches)

    addHistory({
      rawBatchId:     id,
      changedBy:      dto.editedBy,
      changeType:     'edit',
      beforeSnapshot: beforeSnap,
      afterSnapshot:  buildSnapshot(updated),
      reason:         dto.editReason,
    })
    addLog('EDIT_BATCH', id, {
      internalBatchNo: old.internalBatchNo,
      reason: dto.editReason,
    })

    return updated
  },

  // Anulowanie — soft-delete, bez fizycznego usuwania
  cancel: async (id: string, dto: CancelRawBatchDto): Promise<RawBatch> => {
    await delay(400)
    const idx = batches.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Partia nie znaleziona')
    const old = batches[idx]

    const lock = checkEditLock(old)
    if (lock.locked) throw new Error(lock.reason)

    const beforeSnap = buildSnapshot(old)
    const cancelled: RawBatch = {
      ...old,
      status:    'cancelled',
      updatedAt: nowIso(),
    }

    batches = batches.map(b => b.id === id ? cancelled : b)
    save(KEYS.batches, batches)

    addHistory({
      rawBatchId:     id,
      changedBy:      dto.cancelledBy,
      changeType:     'cancel',
      beforeSnapshot: beforeSnap,
      afterSnapshot:  null,
      reason:         dto.reason,
    })
    addLog('CANCEL_BATCH', id, {
      internalBatchNo: old.internalBatchNo,
      reason: dto.reason,
    })

    return cancelled
  },
}

// ─── BATCH HISTORY API ────────────────────────────────────────────────────────
export const rawBatchHistoryApi = {
  forBatch: async (batchId: string): Promise<RawBatchHistoryEntry[]> => {
    await delay(100)
    return history.filter(h => h.rawBatchId === batchId)
      .sort((a, b) => b.changedAt > a.changedAt ? 1 : -1)
  },
  all: async (): Promise<RawBatchHistoryEntry[]> => {
    await delay(100)
    return [...history].sort((a, b) => b.changedAt > a.changedAt ? 1 : -1)
  },
}

// ─── SYSTEM LOGS API ──────────────────────────────────────────────────────────
export const systemLogsApi = {
  list: async (): Promise<SystemLog[]> => {
    await delay(100)
    return [...logs].sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
  },
}

// ─── DEBONING API ─────────────────────────────────────────────────────────────
export const deboningApi = {
  // Zwraca dane z OBU źródeł: stare DeboningSession + nowe DeboningEntry (zmapowane)
  // Dzięki temu HaccpReport i DeboningReports widzą wszystkie wpisy z tabletu
  list: async (): Promise<Paginated<DeboningSession>> => {
    await delay()
    // Mapuj DeboningEntry na DeboningSession — PEŁNE dane z batches (traceability)
    const entriesAsSessions: DeboningSession[] = deboningEntries.map(e => {
      const batch = batches.find(b => b.id === e.rawBatchId)
      return {
        id:             e.id,
        sessionNo:      e.sessionNo,
        rawBatchId:     e.rawBatchId,
        rawBatchNo:     e.rawBatchNo,
        // Traceability — dane z partii
        supplierId:     batch?.supplierId,
        supplierName:   batch?.supplierName,
        supplierBatchNo:batch?.supplierBatchNo,
        slaughterDate:  batch?.slaughterDate,
        expiryDate:     batch?.expiryDate,
        workerId:       e.workerId,
        workerName:     e.workerName,
        kgTaken:        e.kgTaken,
        kgMeat:         e.kgMeat,
        kgBones:        e.kgBones,
        kgBacks:        e.kgBacks,
        kgRemainder:    e.kgRemainder,
        yieldPct:       e.yieldPct,
        tempInput:      e.tempInput,
        tempRoom:       e.tempRoom,
        notes:          e.notes,
        meatLotNo:      e.meatLotNo,
        createdAt:      e.createdAt,
      }
    })
    const all = [...debonings, ...entriesAsSessions]
      .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
    return paginate(all)
  },

  byId: async (id: string): Promise<DeboningSession> => {
    await delay(100)
    const d = debonings.find(x => x.id === id)
    if (!d) throw new Error('Sesja nie znaleziona')
    return d
  },

  update: async (id: string, dto: Partial<CreateDeboningDto> & { kgBacks?: number; kgBones?: number }): Promise<DeboningSession> => {
    await delay(400)
    const idx = debonings.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Sesja nie znaleziona')
    const old = debonings[idx]

    if (dto.kgTaken !== undefined) {
      const diff = Number(old.kgTaken) - dto.kgTaken
      batches = batches.map(b => b.id === old.rawBatchId ? {
        ...b,
        kgAvailable:   Number(b.kgAvailable) + diff,
        kgUsed:        Number(b.kgUsed) - diff,
        utilizationPct:(Number(b.kgUsed) - diff) / Number(b.kgReceived) * 100,
        status:        (Number(b.kgAvailable) + diff) > 0 ? 'active' : 'used',
      } : b)
    }

    const newKgTaken = dto.kgTaken ?? old.kgTaken
    const newKgMeat  = dto.kgMeat  ?? old.kgMeat
    const calc = calcDeboning(newKgTaken, newKgMeat)

    const updated: DeboningSession = {
      ...old,
      kgTaken:     newKgTaken,
      kgMeat:      newKgMeat,
      kgBones:     dto.kgBones ?? calc.kgBones,
      kgBacks:     dto.kgBacks ?? calc.kgBacks,
      kgRemainder: calc.kgRemainder,
      yieldPct:    calc.yieldPct,
    }

    debonings = debonings.map(d => d.id === id ? updated : d)
    if (dto.kgMeat !== undefined) {
      meat = meat.map(m => m.deboningSessionId === id
        ? { ...m, kgInitial: dto.kgMeat!, kgAvailable: dto.kgMeat! }
        : m)
    }
    save(KEYS.batches, batches)
    save(KEYS.debonings, debonings)
    save(KEYS.meat, meat)
    return updated
  },

  create: async (dto: CreateDeboningDto): Promise<DeboningSession> => {
    await delay(600)
    const batch  = batches.find(b => b.id === dto.rawBatchId)
    const worker = users.find(u => u.id === dto.workerId)
    if (!batch)  throw new Error('Partia nie znaleziona')
    if (!worker) throw new Error('Pracownik nie znaleziony')
    if (dto.kgTaken > Number(batch.kgAvailable))
      throw new Error(`Nie można pobrać ${dto.kgTaken} kg — dostępne ${batch.kgAvailable} kg`)
    if (dto.kgMeat > dto.kgTaken)
      throw new Error('Mięso nie może być większe niż pobrana ilość')
    // HACCP guard
    if (isExpired(batch.expiryDate))
      throw new Error('Partia przeterminowana — użycie zabronione (HACCP)')

    const calc = calcDeboning(dto.kgTaken, dto.kgMeat)
    debSeq++; meatSeq++

    const session: DeboningSession = {
      id:          cuid(),
      sessionNo:   datedNo('ROZ', debSeq),
      rawBatchId:  dto.rawBatchId,
      rawBatchNo:  batch.internalBatchNo,
      workerId:    dto.workerId,
      workerName:  worker.name,
      kgTaken:     dto.kgTaken,
      kgMeat:      dto.kgMeat,
      kgBones:     calc.kgBones,
      kgBacks:     calc.kgBacks,
      kgRemainder: calc.kgRemainder,
      yieldPct:    calc.yieldPct,
      tempInput:   dto.tempInput,
      tempRoom:    dto.tempRoom,
      notes:       dto.notes,
      meatLotNo:   `M${batch.internalBatchSeq}`,  // M174 — dziedziczy numer ćwiartki
      createdAt:   nowIso(),
    }

    const newAvail = Number(batch.kgAvailable) - dto.kgTaken
    batches = batches.map(b => b.id === dto.rawBatchId ? {
      ...b,
      kgAvailable:   newAvail,
      kgUsed:        Number(b.kgUsed) + dto.kgTaken,
      utilizationPct:(Number(b.kgUsed) + dto.kgTaken) / Number(b.kgReceived) * 100,
      status:        newAvail <= 0 ? 'used' : 'active',
    } : b)

    const ms: MeatStock = {
      id: cuid(), lotNo: session.meatLotNo!,
      deboningSessionId: session.id, sessionNo: session.sessionNo,
      rawBatchId: dto.rawBatchId, rawBatchNo: batch.internalBatchNo,
      kgInitial: dto.kgMeat, kgAvailable: dto.kgMeat,
      kgReserved: 0, kgInProcess: 0, kgUsed: 0,
      productionDate: nowIso().slice(0, 10),
      expiryDate: batch.expiryDate, expiryStatus: 'OK',
      status: 'AVAILABLE', machineAllocations: [], createdAt: nowIso(),
    }

    meat = [ms, ...meat]
    debonings = [session, ...debonings]
    save(KEYS.batches, batches)
    save(KEYS.debonings, debonings)
    save(KEYS.meat, meat)
    saveCounters({ batchSeq, debSeq, meatSeq, logSeq })
    return session
  },
}

// ─── MEAT STOCK API ───────────────────────────────────────────────────────────
export const meatStockApi = {
  list: async (): Promise<Paginated<MeatStock>> => {
    await delay()
    return paginate([...meat].sort((a, b) => a.expiryDate > b.expiryDate ? 1 : -1))
  },
  byId: async (id: string): Promise<MeatStock> => {
    await delay(100)
    const m = meat.find(x => x.id === id)
    if (!m) throw new Error('Nie znaleziono')
    return m
  },
}

// ─── SUPPLIERS API ────────────────────────────────────────────────────────────
export const suppliersApi = {
  list:     async (): Promise<Supplier[]>   => { await delay(); return suppliers },
  nextCode: async (): Promise<string>       => { await delay(50); return `DOW-${String(suppliers.length + 1).padStart(3, '0')}` },
  create:   async (dto: CreateSupplierDto): Promise<Supplier> => {
    await delay(400)
    const s: Supplier = { id: cuid(), ...dto, active: true }
    suppliers = [...suppliers, s]
    save(KEYS.suppliers, suppliers)
    return s
  },
}

// ─── USERS API ────────────────────────────────────────────────────────────────
export const usersApi = {
  list: async (): Promise<User[]> => { await delay(); return users },
  create: async (dto: { login: string; name: string; role: string }): Promise<User> => {
    await delay(400)
    const u: User = { id: cuid(), ...dto, role: dto.role as User['role'], active: true }
    users = [...users, u]
    save(KEYS.users, users)
    return u
  },
}

// ─── INVOICE TYPES + KATEGORIE ──────────────────────────────────────────────

export type InvoiceCategory = 'SUROWIEC' | 'PRZYPRAWY_I_DODATKI' | 'OPAKOWANIA_TULEJE' | 'MEDIA' | 'INNE'

export const INVOICE_CATEGORY_LABELS: Record<InvoiceCategory, string> = {
  SUROWIEC:            'Surowiec (mięso)',
  PRZYPRAWY_I_DODATKI: 'Przyprawy i dodatki',
  OPAKOWANIA_TULEJE:   'Opakowania / Tuleje',
  MEDIA:               'Media',
  INNE:                'Inne',
}

export interface PurchaseInvoiceLine {
  name: string; qty: number; unitPrice: number; vatRate: number
  netAmount: number; vatAmount: number; grossAmount: number
  lineName?: string
}

export interface PurchaseInvoice {
  id: string; invoiceNo: string; supplierId: string; supplierName: string
  category: InvoiceCategory
  rawBatchId?: string; rawBatchNo?: string; rawBatchIds?: string[]
  ingredientId?: string; ingredientName?: string
  packagingId?: string; packagingName?: string
  expiryDate?: string; batchNo?: string
  invoiceDate: string; dueDate?: string
  // Realny backend zwraca fakturę płasko (kolumny tabeli `invoices`):
  qty?: number; unitPrice?: number
  totalNet?: number; totalVat?: number; totalGross?: number
  currency?: string; amountEur?: number
  // Legacy (kształt mocka) — opcjonalne, nieobecne w odpowiedzi backendu:
  lines?: PurchaseInvoiceLine[]
  netTotal?: number; vatTotal?: number; grossTotal?: number
  vatRate?: number; notes?: string; createdAt: string
}

export interface CreatePurchaseInvoiceDto {
  invoiceNo: string; supplierId: string; category: InvoiceCategory
  invoiceDate: string; dueDate?: string
  qty: number; unitPrice: number; vatRate: number; notes?: string
  rawBatchId?: string; lineName?: string
  ingredientId?: string; expiryDate?: string; batchNo?: string
}

export const invoicesApi = {
  list: async (category?: InvoiceCategory): Promise<PurchaseInvoice[]> => {
    await delay()
    const all = [...invoices].sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
    return category ? all.filter(x => x.category === category) : all
  },
  byId: async (id: string): Promise<PurchaseInvoice> => {
    await delay(100)
    const inv = invoices.find(x => x.id === id)
    if (!inv) throw new Error('Faktura nie znaleziona')
    return inv
  },
  create: async (dto: CreatePurchaseInvoiceDto): Promise<PurchaseInvoice> => {
    await delay(400)
    const sup   = suppliers.find(s => s.id === dto.supplierId)
    const batch = dto.rawBatchId ? batches.find(b => b.id === dto.rawBatchId) : undefined
    const ing   = dto.ingredientId ? ingredients.find(i => i.id === dto.ingredientId) : undefined
    const pkgId = (dto as any).packagingId
    const pkgItem = pkgId ? packagingItems.find(p => p.id === pkgId) : undefined
    const vat   = dto.vatRate ?? 0.05
    const net   = dto.qty * dto.unitPrice
    const lineName = dto.lineName
      ?? (dto.category === 'SUROWIEC' ? 'ĆWIARTKA Z KURCZAKA KL. A SCHŁODZONA'
        : dto.category === 'PRZYPRAWY_I_DODATKI' ? (ing?.name ?? 'PRZYPRAWA/DODATEK')
        : 'POZYCJA FAKTURY')
    const line: PurchaseInvoiceLine = {
      name: lineName, qty: dto.qty, unitPrice: dto.unitPrice, vatRate: vat,
      netAmount: net, vatAmount: net * vat, grossAmount: net * (1 + vat),
    }
    const inv: PurchaseInvoice = {
      id: cuid(), invoiceNo: dto.invoiceNo,
      supplierId: dto.supplierId, supplierName: sup?.name ?? '—',
      category: dto.category,
      rawBatchId: batch?.id, rawBatchNo: batch?.internalBatchNo,
      rawBatchIds: (dto as any).rawBatchIds ?? (batch ? [batch.id] : undefined),
      packagingId:   pkgItem?.id,
      packagingName: pkgItem?.name,
      ingredientId:  ing?.id ?? (dto as any).ingredientId,
      ingredientName: ing?.name,
      expiryDate: dto.expiryDate, batchNo: dto.batchNo,
      invoiceDate: dto.invoiceDate, dueDate: dto.dueDate,
      lines: [line], netTotal: net, vatTotal: net * vat, grossTotal: net * (1 + vat),
      vatRate: vat, notes: dto.notes, createdAt: nowIso(),
    }
    invoices = [inv, ...invoices]
    save(KEYS.invoices, invoices)
    // PRZYPRAWY_I_DODATKI → zasilenie istniejącego magazynu ingredientReceipts
    if (dto.category === 'PRZYPRAWY_I_DODATKI' && dto.ingredientId) {
      const receipt: IngredientReceipt = {
        id: cuid(), ingredientId: dto.ingredientId,
        qty: dto.qty, unit: ing?.unit ?? 'kg', pricePerUnit: dto.unitPrice,
        invoiceNo: dto.invoiceNo, receivedDate: dto.invoiceDate,
        supplierId: dto.supplierId,
        notes: `FV: ${dto.invoiceNo}${dto.batchNo ? ' · Partia: ' + dto.batchNo : ''}`,
        createdAt: nowIso(),
      }
      ingredientReceipts = [receipt, ...ingredientReceipts]
      save('kebab_mes_ingredient_receipts', ingredientReceipts)
    }
    return inv
  },
  update: async (id: string, dto: Partial<CreatePurchaseInvoiceDto>): Promise<PurchaseInvoice> => {
    await delay(400)
    const idx = invoices.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Faktura nie znaleziona')
    const old  = invoices[idx]
    const cat  = dto.category ?? old.category
    const qty  = dto.qty       ?? old.lines[0].qty
    const unit = dto.unitPrice ?? old.lines[0].unitPrice
    const vat  = dto.vatRate   ?? old.vatRate
    const net  = qty * unit
    const sup  = dto.supplierId   ? suppliers.find(s => s.id === dto.supplierId)   : undefined
    const b    = dto.rawBatchId   ? batches.find(x => x.id === dto.rawBatchId)     : undefined
    const ing  = dto.ingredientId ? ingredients.find(i => i.id === dto.ingredientId) : undefined
    const updated: PurchaseInvoice = {
      ...old, category: cat,
      invoiceNo:      dto.invoiceNo    ?? old.invoiceNo,
      supplierId:     dto.supplierId   ?? old.supplierId,
      supplierName:   sup?.name        ?? old.supplierName,
      rawBatchId:     cat === 'SUROWIEC' ? (b?.id ?? old.rawBatchId) : undefined,
      rawBatchNo:     cat === 'SUROWIEC' ? (b?.internalBatchNo ?? old.rawBatchNo) : undefined,
      ingredientId:   cat === 'PRZYPRAWY_I_DODATKI' ? (ing?.id ?? old.ingredientId) : undefined,
      ingredientName: cat === 'PRZYPRAWY_I_DODATKI' ? (ing?.name ?? old.ingredientName) : undefined,
      expiryDate:     dto.expiryDate ?? old.expiryDate,
      batchNo:        dto.batchNo    ?? old.batchNo,
      invoiceDate:    dto.invoiceDate ?? old.invoiceDate,
      dueDate:        dto.dueDate    ?? old.dueDate,
      vatRate: vat, netTotal: net, vatTotal: net * vat, grossTotal: net * (1 + vat),
      notes: dto.notes ?? old.notes,
      lines: [{ name: dto.lineName ?? old.lines[0]?.name ?? 'POZYCJA',
        qty, unitPrice: unit, vatRate: vat,
        netAmount: net, vatAmount: net * vat, grossAmount: net * (1 + vat) }],
    }
    invoices = invoices.map(x => x.id === id ? updated : x)
    save(KEYS.invoices, invoices)
    return updated
  },
  delete: async (id: string): Promise<void> => {
    await delay(300)
    invoices = invoices.filter(x => x.id !== id)
    save(KEYS.invoices, invoices)
  },
}
// ─── HEALTH ───────────────────────────────────────────────────────────────────
export const healthApi = {
  check: async () => ({
    status: 'ok', system: 'KEBAB MES v2',
    database: { status: 'localStorage', rawBatches: batches.length, debonings: debonings.length },
  }),
}

export const resetAllData = () => {
  Object.values(KEYS).forEach(k => localStorage.removeItem(k))
  batches = [...MOCK_BATCHES]; debonings = [...MOCK_DEBONINGS]; meat = [...MOCK_MEAT]
  suppliers = [...MOCK_SUPPLIERS]; users = [...MOCK_USERS]
  invoices = []; history = []; logs = []
  batchSeq = 170; debSeq = 0; meatSeq = 0; logSeq = 0
}

// ─── PRODUCTION SESSIONS API ──────────────────────────────────────────────────
// Zarządza sesjami produkcyjnymi (dzień rozbioru, mieszania, produkcji).
// Blokady: okno 04-18, status sesji, HACCP.

import type {
  ProductionSession, DeboningEntry, DeboningTraceability,
  StartSessionDto, CloseSessionDto, ApproveSessionDto,
  CreateDeboningEntryDto, UpdateDeboningEntryDto,
} from '@/features/deboning/types'
import {
  getProductionDate, checkWriteAccess, calcSessionSummary,
  WORK_START_HOUR, WORK_END_HOUR,
} from '@/features/deboning/utils'

let sessions       = load<ProductionSession>('kebab_mes_sessions', [])
let deboningEntries= load<DeboningEntry>('kebab_mes_deboning_entries', [])
let sessionSeq     = loadCounters().sessionSeq ?? 0
let entrySeq       = loadCounters().entrySeq   ?? 0

function saveSessionCounters() {
  const c = loadCounters()
  saveCounters({ ...c, sessionSeq, entrySeq })
}

export const productionSessionsApi = {
  list: async (processType: string): Promise<ProductionSession[]> => {
    await delay(100)
    return [...sessions]
      .filter(s => s.processType === processType)
      .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
  },

  byId: async (id: string): Promise<ProductionSession> => {
    await delay(100)
    const s = sessions.find(x => x.id === id)
    if (!s) throw new Error('Sesja nie znaleziona')
    return s
  },

  start: async (dto: StartSessionDto): Promise<ProductionSession> => {
    await delay(300)
    const now = new Date()

    // Sprawdź czy nie ma już otwartej sesji
    const existing = sessions.find(s =>
      s.processType === dto.processType && s.status === 'open'
    )
    if (existing) throw new Error('Sesja tego dnia jest już otwarta')

    sessionSeq++
    const sess: ProductionSession = {
      id:           cuid(),
      sessionDate:  getProductionDate(now),
      processType:  dto.processType,
      status:       'open',
      startedAt:    nowIso(),
      notes:        dto.notes,
      createdAt:    nowIso(),
    }
    sessions = [sess, ...sessions]
    save('kebab_mes_sessions', sessions)
    saveSessionCounters()
    return sess
  },

  close: async (id: string, dto: CloseSessionDto): Promise<ProductionSession> => {
    await delay(300)
    const idx = sessions.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Sesja nie znaleziona')
    if (sessions[idx].status !== 'open') throw new Error('Sesja nie jest otwarta')

    const updated: ProductionSession = {
      ...sessions[idx],
      status:  'closed',
      endedAt: nowIso(),
      notes:   dto.notes ?? sessions[idx].notes,
    }
    sessions = sessions.map(s => s.id === id ? updated : s)
    save('kebab_mes_sessions', sessions)
    return updated
  },

  approve: async (id: string, dto: ApproveSessionDto): Promise<ProductionSession> => {
    await delay(300)
    const idx = sessions.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Sesja nie znaleziona')
    if (sessions[idx].status === 'approved') throw new Error('Sesja już zatwierdzona')

    const updated: ProductionSession = {
      ...sessions[idx],
      status:     'approved',
      endedAt:    sessions[idx].endedAt ?? nowIso(),
      approvedBy: dto.approvedBy,
      approvedAt: nowIso(),
      notes:      dto.notes ?? sessions[idx].notes,
    }
    sessions = sessions.map(s => s.id === id ? updated : s)
    save('kebab_mes_sessions', sessions)
    return updated
  },

  // CRON 18:00 — auto-approve wszystkich otwartych/zamkniętych sesji
  autoApprove: async (): Promise<number> => {
    await delay(200)
    let count = 0
    sessions = sessions.map(s => {
      if (s.status === 'open' || s.status === 'closed') {
        count++
        return { ...s, status: 'approved' as const, approvedBy: 'SYSTEM', approvedAt: nowIso() }
      }
      return s
    })
    save('kebab_mes_sessions', sessions)
    return count
  },
}

// ─── DEBONING ENTRIES API ─────────────────────────────────────────────────────

export const deboningEntriesApi = {
  list: async (sessionId: string): Promise<DeboningEntry[]> => {
    await delay(200)
    return deboningEntries
      .filter(e => e.sessionId === sessionId)
      .sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
  },

  create: async (dto: CreateDeboningEntryDto): Promise<DeboningEntry> => {
    await delay(500)

    // Pobierz sesję — wymagana, ale bez blokady czasowej (dla testów)
    const session = sessions.find(s => s.id === dto.sessionId) ?? null
    if (!session) throw new Error('Sesja nie znaleziona. Najpierw rozpocznij dzień.')
    if (session.status === 'closed') throw new Error('Sesja zamknięta — nie można dodawać wpisów.')
    if (session.status === 'approved') throw new Error('Sesja zatwierdzona — dane zablokowane.')

    // Pobierz partię i pracownika
    const batch  = batches.find(b => b.id === dto.rawBatchId)
    const worker = users.find(u => u.id === dto.workerId)
    if (!batch)  throw new Error('Partia nie znaleziona')
    if (!worker) throw new Error('Pracownik nie znaleziony')

    // HACCP
    if (isExpired(batch.expiryDate))
      throw new Error('Partia przeterminowana — użycie zabronione (HACCP)')

    if (dto.kgTaken > Number(batch.kgAvailable))
      throw new Error(`Nie można pobrać ${dto.kgTaken} kg — dostępne ${batch.kgAvailable} kg`)
    if (dto.kgMeat > dto.kgTaken)
      throw new Error('Mięso nie może być większe niż pobrana ilość')

    const kgRemainder = dto.kgTaken - dto.kgMeat
    entrySeq++
    const year = new Date().getFullYear()
    const meatSeqLocal = entrySeq
    meatSeq++

    const entry: DeboningEntry = {
      id:          cuid(),
      sessionId:   dto.sessionId,
      sessionDate: session!.sessionDate,
      rawBatchId:  dto.rawBatchId,
      rawBatchNo:  batch.internalBatchNo,
      workerId:    dto.workerId,
      workerName:  worker.name,
      kgTaken:     dto.kgTaken,
      kgMeat:      dto.kgMeat,
      kgBones:     kgRemainder * 0.6,
      kgBacks:     kgRemainder * 0.4,
      kgRemainder,
      yieldPct:    dto.kgTaken > 0 ? (dto.kgMeat / dto.kgTaken) * 100 : 0,
      sessionNo:   datedNo('ROZ', entrySeq),
      tempInput:   dto.tempInput,
      tempRoom:    dto.tempRoom,
      notes:       dto.notes,
      meatLotNo:   `M${batch.internalBatchSeq}`,  // M174 — dziedziczy numer ćwiartki
      createdAt:   nowIso(),
    }

    // Zaktualizuj partię
    const newAvail = Number(batch.kgAvailable) - dto.kgTaken
    batches = batches.map(b => b.id === dto.rawBatchId ? {
      ...b,
      kgAvailable:   newAvail,
      kgUsed:        Number(b.kgUsed) + dto.kgTaken,
      utilizationPct:(Number(b.kgUsed) + dto.kgTaken) / Number(b.kgReceived) * 100,
      status:        newAvail <= 0 ? 'used' : 'active',
    } : b)

    deboningEntries = [entry, ...deboningEntries]

    // ── KLUCZOWE: utwórz wpis w magazynie surowca (MeatStock) ──────────────
    const ms: MeatStock = {
      id:                cuid(),
      lotNo:             entry.meatLotNo!,
      deboningSessionId: entry.id,
      sessionNo:         entry.sessionNo,
      rawBatchId:        dto.rawBatchId,
      rawBatchNo:        batch.internalBatchNo,
      kgInitial:         dto.kgMeat,
      kgAvailable:       dto.kgMeat,
      kgReserved:        0,
      kgInProcess:       0,
      kgUsed:            0,
      productionDate:    nowIso().slice(0, 10),
      expiryDate:        batch.expiryDate,
      expiryStatus:      'OK' as const,
      status:            'AVAILABLE' as const,
      machineAllocations:[],
      createdAt:         nowIso(),
    }
    meat = [ms, ...meat]

    save(KEYS.batches, batches)
    save(KEYS.meat, meat)
    save('kebab_mes_deboning_entries', deboningEntries)
    saveCounters({ batchSeq, debSeq, meatSeq, logSeq })
    return entry
  },

  update: async (entryId: string, dto: UpdateDeboningEntryDto): Promise<DeboningEntry> => {
    await delay(400)
    const idx = deboningEntries.findIndex(e => e.id === entryId)
    if (idx === -1) throw new Error('Wpis nie znaleziony')

    const old     = deboningEntries[idx]
    const session = sessions.find(s => s.id === old.sessionId) ?? null
    if (session?.status !== 'open') throw new Error('Edycja możliwa tylko przy otwartej sesji')

    const newTaken = dto.kgTaken ?? old.kgTaken
    const newMeat  = dto.kgMeat  ?? old.kgMeat
    const kgRemainder = newTaken - newMeat

    const updated: DeboningEntry = {
      ...old,
      kgTaken:     newTaken,
      kgMeat:      newMeat,
      kgBones:     dto.kgBones ?? kgRemainder * 0.6,
      kgBacks:     dto.kgBacks ?? kgRemainder * 0.4,
      kgRemainder,
      yieldPct:    newTaken > 0 ? (newMeat / newTaken) * 100 : 0,
      tempInput:   dto.tempInput ?? old.tempInput,
      tempRoom:    dto.tempRoom  ?? old.tempRoom,
      notes:       dto.notes     ?? old.notes,
    }

    // Korekta kgAvailable w partii
    const diff = old.kgTaken - newTaken
    if (diff !== 0) {
      batches = batches.map(b => b.id === old.rawBatchId ? {
        ...b,
        kgAvailable: Number(b.kgAvailable) + diff,
        kgUsed:      Number(b.kgUsed) - diff,
      } : b)
      save(KEYS.batches, batches)
    }

    deboningEntries = deboningEntries.map(e => e.id === entryId ? updated : e)

    // Korekta meat stock jeśli zmieniono kgMeat
    if (dto.kgMeat !== undefined && dto.kgMeat !== old.kgMeat) {
      meat = meat.map(m => m.deboningSessionId === entryId
        ? { ...m, kgInitial: dto.kgMeat!, kgAvailable: dto.kgMeat! }
        : m)
      save(KEYS.meat, meat)
    }

    save('kebab_mes_deboning_entries', deboningEntries)
    return updated
  },

  traceability: async (entryId: string): Promise<DeboningTraceability> => {
    await delay(100)
    const entry = deboningEntries.find(e => e.id === entryId)
    if (!entry) throw new Error('Wpis nie znaleziony')
    const batch = batches.find(b => b.id === entry.rawBatchId)
    return {
      entryId:         entry.id,
      sessionId:       entry.sessionId,
      sessionDate:     entry.sessionDate,
      rawBatchId:      entry.rawBatchId,
      rawBatchNo:      entry.rawBatchNo,
      supplierId:      batch?.supplierId ?? '',
      supplierName:    batch?.supplierName,
      supplierBatchNo: batch?.supplierBatchNo ?? '',
      slaughterDate:   batch?.slaughterDate ?? '',
      expiryDate:      batch?.expiryDate ?? '',
      meatLotNo:       entry.meatLotNo,
      workerId:        entry.workerId,
      workerName:      entry.workerName,
      kgTaken:         entry.kgTaken,
      kgMeat:          entry.kgMeat,
      yieldPct:        entry.yieldPct,
      processedAt:     entry.createdAt,
    }
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRODUCTS & INGREDIENTS — Rodzaje produktów, magazyn przypraw, receptury
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  ProductType, CreateProductTypeDto, UpdateProductTypeDto,
} from '@/features/products/types'
import type {
  Ingredient, CreateIngredientDto,
  IngredientStock, IngredientReceipt, CreateIngredientReceiptDto,
  Recipe, CreateRecipeDto, UpdateRecipeDto,
  RecipeIngredient, RecipeCalculation,
} from '@/features/ingredients/types'

// ─── STATE ─────────────────────────────────────────────────────────────────────
let productTypes       = load<ProductType>('kebab_mes_product_types', [])
let ingredients        = load<Ingredient>('kebab_mes_ingredients', _defaultIngredients())
let ingredientReceipts = load<IngredientReceipt>('kebab_mes_ingredient_receipts', [])
let recipes            = load<Recipe>('kebab_mes_recipes', [])

function _defaultIngredients(): Ingredient[] {
  return [
    {
      id: 'ing-water', name: 'Woda', category: 'water', unit: 'kg',
      isUnlimited: true, active: true, createdAt: new Date().toISOString(),
    },
  ]
}

function _calcStock(ingredientId: string): number {
  // Suma przyjęć − zużycia (brak zużycia w tej wersji)
  return ingredientReceipts
    .filter(r => r.ingredientId === ingredientId)
    .reduce((s, r) => s + r.qty, 0)
}

// ─── PRODUCT TYPES API ─────────────────────────────────────────────────────────
export const productTypesApi = {

  list: async (): Promise<ProductType[]> => {
    await delay(200)
    return [...productTypes].sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  },

  byId: async (id: string): Promise<ProductType> => {
    await delay(100)
    const p = productTypes.find(x => x.id === id)
    if (!p) throw new Error('Produkt nie znaleziony')
    return p
  },

  create: async (dto: CreateProductTypeDto): Promise<ProductType> => {
    await delay(400)
    const pt: ProductType = {
      id:          cuid(),
      name:        dto.name.trim(),
      description: dto.description,
      components:  dto.components.map(c => ({ ...c, id: cuid() })),
      active:      true,
      createdAt:   nowIso(),
    }
    productTypes = [pt, ...productTypes]
    save('kebab_mes_product_types', productTypes)
    return pt
  },

  update: async (id: string, dto: UpdateProductTypeDto): Promise<ProductType> => {
    await delay(400)
    const idx = productTypes.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Produkt nie znaleziony')
    const updated: ProductType = {
      ...productTypes[idx],
      ...(dto.name        !== undefined && { name:        dto.name.trim() }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.components  !== undefined && { components:  dto.components.map(c => ({ ...c, id: cuid() })) }),
      ...(dto.active      !== undefined && { active:      dto.active }),
      updatedAt: nowIso(),
    }
    productTypes = productTypes.map(p => p.id === id ? updated : p)
    save('kebab_mes_product_types', productTypes)
    return updated
  },

  deactivate: async (id: string): Promise<ProductType> => {
    await delay(300)
    return productTypesApi.update(id, { active: false })
  },
}

// ─── INGREDIENTS API ───────────────────────────────────────────────────────────
export const ingredientsApi = {

  list: async (): Promise<Ingredient[]> => {
    await delay(200)
    return [...ingredients]
      .filter(i => i.active)
      .sort((a, b) => {
        // Woda zawsze na końcu
        if (a.category === 'water') return 1
        if (b.category === 'water') return -1
        return a.name.localeCompare(b.name, 'pl')
      })
  },

  byId: async (id: string): Promise<Ingredient> => {
    await delay(100)
    const i = ingredients.find(x => x.id === id)
    if (!i) throw new Error('Składnik nie znaleziony')
    return i
  },

  create: async (dto: CreateIngredientDto): Promise<Ingredient> => {
    await delay(400)
    const ing: Ingredient = {
      id:           cuid(),
      name:         dto.name.trim(),
      category:     dto.category,
      unit:         dto.unit,
      isUnlimited:  dto.category === 'water' ? true : dto.isUnlimited,
      supplierId:   dto.supplierId,
      active:       true,
      createdAt:    nowIso(),
    }
    ingredients = [ing, ...ingredients]
    save('kebab_mes_ingredients', ingredients)
    return ing
  },

  deactivate: async (id: string): Promise<void> => {
    await delay(300)
    if (id === 'ing-water') throw new Error('Wody nie można usunąć')
    ingredients = ingredients.map(i => i.id === id ? { ...i, active: false } : i)
    save('kebab_mes_ingredients', ingredients)
  },

  // Stan magazynowy wszystkich składników
  stock: async (): Promise<IngredientStock[]> => {
    await delay(200)
    return ingredients.filter(i => i.active).map(i => ({
      ingredientId:   i.id,
      ingredientName: i.name,
      unit:           i.unit,
      isUnlimited:    i.isUnlimited,
      qtyAvailable:   i.isUnlimited ? Infinity : _calcStock(i.id),
      qtyReserved:    0,
      lastReceiptAt:  ingredientReceipts.filter(r => r.ingredientId === i.id).sort((a, b) => b.receivedDate > a.receivedDate ? 1 : -1)[0]?.receivedDate,
    }))
  },
}

// ─── INGREDIENT RECEIPTS API ───────────────────────────────────────────────────
export const ingredientReceiptsApi = {

  list: async (ingredientId?: string): Promise<IngredientReceipt[]> => {
    await delay(200)
    const all = [...ingredientReceipts].sort((a, b) => b.receivedDate > a.receivedDate ? 1 : -1)
    return ingredientId ? all.filter(r => r.ingredientId === ingredientId) : all
  },

  create: async (dto: CreateIngredientReceiptDto): Promise<IngredientReceipt> => {
    await delay(400)
    const ing = ingredients.find(i => i.id === dto.ingredientId)
    if (!ing) throw new Error('Składnik nie znaleziony')
    if (ing.isUnlimited) throw new Error('Woda jest zawsze dostępna — nie wymaga przyjęcia')
    if (dto.qty <= 0) throw new Error('Ilość musi być > 0')
    if (dto.pricePerUnit < 0) throw new Error('Cena nie może być ujemna')

    const receipt: IngredientReceipt = {
      id:           cuid(),
      ingredientId: dto.ingredientId,
      qty:          dto.qty,
      unit:         ing.unit,
      pricePerUnit: dto.pricePerUnit,
      invoiceNo:    dto.invoiceNo,
      receivedDate: dto.receivedDate,
      supplierId:   dto.supplierId,
      notes:        dto.notes,
      createdAt:    nowIso(),
    }
    ingredientReceipts = [receipt, ...ingredientReceipts]
    save('kebab_mes_ingredient_receipts', ingredientReceipts)
    return receipt
  },
}

// ─── RECIPES API ───────────────────────────────────────────────────────────────
export const recipesApi = {

  list: async (): Promise<Recipe[]> => {
    await delay(200)
    return [...recipes].filter(r => r.active).sort((a, b) => a.name.localeCompare(b.name, 'pl'))
  },

  byId: async (id: string): Promise<Recipe> => {
    await delay(100)
    const r = recipes.find(x => x.id === id)
    if (!r) throw new Error('Receptura nie znaleziona')
    return r
  },

  create: async (dto: CreateRecipeDto): Promise<Recipe> => {
    await delay(400)
    if (!dto.name.trim()) throw new Error('Podaj nazwę receptury')
    if (!dto.ingredients.length) throw new Error('Dodaj co najmniej jeden składnik')

    // Wzbogać składniki danymi ze składników
    const enriched: RecipeIngredient[] = dto.ingredients.map(ri => {
      const ing = ingredients.find(i => i.id === ri.ingredientId)
      if (!ing) throw new Error(`Składnik ${ri.ingredientId} nie znaleziony`)
      if (ri.qtyPer100kg <= 0) throw new Error(`Dawka składnika "${ing.name}" musi być > 0`)
      return {
        id:             cuid(),
        ingredientId:   ri.ingredientId,
        ingredientName: ing.name,
        unit:           ing.unit,
        qtyPer100kg:    ri.qtyPer100kg,
        isUnlimited:    ing.isUnlimited,
      }
    })

    // Łączna masa gotowego = 100 kg mięsa + suma wszystkich składników
    const totalOutputPer100kg = 100 + enriched.reduce((s, r) => s + r.qtyPer100kg, 0)

    const recipe: Recipe = {
      id:                  cuid(),
      name:                dto.name.trim(),
      productTypeId:       dto.productTypeId,
      ingredients:         enriched,
      totalOutputPer100kg,
      shelfLifeDays:       dto.shelfLifeDays ?? 5,
      notes:               dto.notes,
      active:              true,
      createdAt:           nowIso(),
    }
    recipes = [recipe, ...recipes]
    save('kebab_mes_recipes', recipes)
    return recipe
  },

  update: async (id: string, dto: UpdateRecipeDto): Promise<Recipe> => {
    await delay(400)
    const idx = recipes.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Receptura nie znaleziona')
    const old = recipes[idx]

    let enriched = old.ingredients
    if (dto.ingredients) {
      enriched = dto.ingredients.map(ri => {
        const ing = ingredients.find(i => i.id === ri.ingredientId)
        if (!ing) throw new Error(`Składnik ${ri.ingredientId} nie znaleziony`)
        return {
          id:             cuid(),
          ingredientId:   ri.ingredientId,
          ingredientName: ing.name,
          unit:           ing.unit,
          qtyPer100kg:    ri.qtyPer100kg,
          isUnlimited:    ing.isUnlimited,
        }
      })
    }

    const totalOutputPer100kg = 100 + enriched.reduce((s, r) => s + r.qtyPer100kg, 0)

    const updated: Recipe = {
      ...old,
      ...(dto.name          !== undefined && { name:          dto.name.trim() }),
      ...(dto.productTypeId !== undefined && { productTypeId: dto.productTypeId }),
      ...(dto.notes         !== undefined && { notes:         dto.notes }),
      ...(dto.active        !== undefined && { active:        dto.active }),
      ingredients:         enriched,
      totalOutputPer100kg,
      updatedAt:           nowIso(),
    }
    recipes = recipes.map(r => r.id === id ? updated : r)
    save('kebab_mes_recipes', recipes)
    return updated
  },

  deactivate: async (id: string): Promise<void> => {
    await delay(300)
    recipes = recipes.map(r => r.id === id ? { ...r, active: false, updatedAt: nowIso() } : r)
    save('kebab_mes_recipes', recipes)
  },

  // Kalkulator: co potrzeba do produkcji X kg mięsa
  calculate: async (recipeId: string, meatKg: number): Promise<RecipeCalculation> => {
    await delay(100)
    const recipe = recipes.find(r => r.id === recipeId)
    if (!recipe) throw new Error('Receptura nie znaleziona')
    if (meatKg <= 0) throw new Error('Ilość mięsa musi być > 0')

    const stockMap = new Map<string, number>()
    for (const r of ingredientReceipts) stockMap.set(r.ingredientId, (stockMap.get(r.ingredientId) ?? 0) + r.qty)

    const required = recipe.ingredients.map(ri => {
      const qty       = (ri.qtyPer100kg * meatKg) / 100
      const available = ri.isUnlimited ? Infinity : (stockMap.get(ri.ingredientId) ?? 0)
      return {
        ingredientId:   ri.ingredientId,
        ingredientName: ri.ingredientName,
        unit:           ri.unit,
        qty:            Math.round(qty * 1000) / 1000,
        isUnlimited:    ri.isUnlimited,
        available:      ri.isUnlimited ? Infinity : available,
        sufficient:     ri.isUnlimited ? true : available >= qty,
      }
    })

    const totalOutputKg = meatKg + required.reduce((s, r) => s + r.qty, 0)
    const feasible      = required.every(r => r.sufficient)

    return { meatKg, required, totalOutputKg: Math.round(totalOutputKg * 100) / 100, feasible }
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIXING ORDERS — Zlecenia masowania (półprodukty)
// ═══════════════════════════════════════════════════════════════════════════════

export type MixingOrderStatus = 'planned' | 'in_progress' | 'done' | 'cancelled'
export type MachineId = 1 | 2 | 3

export interface MixingOrderMeatLot {
  meatLotId:   string
  meatLotNo:   string
  rawBatchNo:  string
  kgPlanned:   number
  expiryDate:  string
}

export interface MixingOrderStep {
  stepNo:        number
  ingredientId:  string
  ingredientName:string
  unit:          string
  qtyRequired:   number      // ile potrzeba
  qtyConfirmed?: number      // ile faktycznie dodano (operator potwierdza)
  confirmed:     boolean
  // Przyszłość: qtyWeighed — z wagi
}

export interface MixingOrder {
  readonly id:             string
  readonly orderNo:        string      // "MAS/dd/mm/rr" (np. MAS/06/06/26)
  readonly productTypeId?: string
  readonly productTypeName?:string
  readonly recipeId:       string
  readonly recipeName:     string
  readonly meatKg:         number      // planowane kg mięsa ŁĄCZNIE
  readonly kgDone:         number      // ile kg mięsa już zmielono (suma sesji)
  readonly kgRemaining:    number      // ile kg mięsa zostało (meatKg - kgDone)
  readonly plannedOutputKg:number
  readonly meatLots:       MixingOrderMeatLot[]
  readonly machineId?:     MachineId
  readonly steps:          MixingOrderStep[]
  readonly status:         MixingOrderStatus
  readonly notes?:         string
  readonly createdAt:      string
  readonly startedAt?:     string
  readonly completedAt?:   string
  // Historia sesji masowania (każde 600kg osobno)
  readonly sessions:       MixingSession[]
}

// Pojedyncza sesja masowania (np. 600kg z 2000kg zlecenia)
export interface MixingSession {
  readonly sessionId:   string
  readonly machineId:   MachineId
  readonly kgMeat:      number   // ile mięsa w tej sesji
  readonly kgOutput:    number   // uzysk tej sesji
  readonly startedAt:   string
  readonly completedAt: string
  readonly batchNo:     string   // nr w magazynie przyprawionego
}

export interface CreateMixingOrderDto {
  productTypeId?: string
  recipeId:       string
  meatKg:         number
  meatLots:       Omit<MixingOrderMeatLot, 'meatLotNo' | 'rawBatchNo' | 'expiryDate'>[]
  notes?:         string
}

export interface StartMixingDto {
  machineId:   MachineId
  meatLots?:   MixingOrderMeatLot[]  // operator może zmodyfikować przy starcie
}

export interface ConfirmStepDto {
  stepNo:       number
  qtyConfirmed: number
}

let mixingOrders = load<MixingOrder>('kebab_mes_mixing_orders', [])
let mixingSeq    = loadCounters().mixingSeq ?? 0

export const mixingOrdersApi = {

  list: async (status?: MixingOrderStatus): Promise<MixingOrder[]> => {
    await delay(200)
    const all = [...mixingOrders].sort((a, b) => b.createdAt > a.createdAt ? 1 : -1)
    return status ? all.filter(o => o.status === status) : all
  },

  byId: async (id: string): Promise<MixingOrder> => {
    await delay(100)
    const o = mixingOrders.find(x => x.id === id)
    if (!o) throw new Error('Zlecenie nie znalezione')
    return o
  },

  // Biuro tworzy zlecenie
  create: async (dto: CreateMixingOrderDto): Promise<MixingOrder> => {
    await delay(400)
    const recipe = recipes.find(r => r.id === dto.recipeId)
    if (!recipe) throw new Error('Receptura nie znaleziona')

    const productType = dto.productTypeId ? productTypes.find(p => p.id === dto.productTypeId) : undefined

    // Wzbogać loty mięsa + walidacja dostępności (traceability + blokada nadmiaru)
    const enrichedLots: MixingOrderMeatLot[] = dto.meatLots.map(lot => {
      const m = meat.find(x => x.id === lot.meatLotId)
      if (!m) throw new Error(`Lot mięsa ${lot.meatLotId} nie znaleziony`)
      if (lot.kgPlanned > Number(m.kgAvailable))
        throw new Error(`Lot ${m.lotNo}: zaplanowano ${lot.kgPlanned} kg, dostępne tylko ${Number(m.kgAvailable).toFixed(2)} kg`)
      if (lot.kgPlanned <= 0)
        throw new Error(`Lot ${m.lotNo}: ilość musi być > 0`)
      return {
        meatLotId:   lot.meatLotId,
        meatLotNo:   m.lotNo,
        rawBatchNo:  m.rawBatchNo ?? '',
        kgPlanned:   lot.kgPlanned,
        expiryDate:  m.expiryDate,
      }
    })
    // Sprawdź sumę zaplanowanego mięsa
    const totalPlanned = dto.meatLots.reduce((s, l) => s + l.kgPlanned, 0)
    if (Math.abs(totalPlanned - dto.meatKg) > 0.1)
      throw new Error(`Suma lotów (${totalPlanned.toFixed(2)} kg) ≠ planowane mięso (${dto.meatKg} kg)`)

    // Zbuduj kroki ze składników receptury (bez mięsa — mięso osobno)
    const steps: MixingOrderStep[] = recipe.ingredients.map((ri, i) => ({
      stepNo:         i + 1,
      ingredientId:   ri.ingredientId,
      ingredientName: ri.ingredientName,
      unit:           ri.unit,
      qtyRequired:    Math.round((ri.qtyPer100kg * dto.meatKg / 100) * 1000) / 1000,
      confirmed:      false,
    }))

    mixingSeq++
    const year = new Date().getFullYear()
    // Numer zlecenia masowania = MAS/dd/mm/rr (mirror backend next_dated_no).
    const masOrderNo = datedNo('MAS', mixingSeq)

    const order: MixingOrder = {
      id:               cuid(),
      orderNo:          masOrderNo,
      productTypeId:    dto.productTypeId,
      productTypeName:  productType?.name,
      recipeId:         dto.recipeId,
      recipeName:       recipe.name,
      meatKg:           dto.meatKg,
      kgDone:           0,
      kgRemaining:      dto.meatKg,
      plannedOutputKg:  Math.round(recipe.totalOutputPer100kg * dto.meatKg / 100 * 100) / 100,
      meatLots:         enrichedLots,
      steps,
      sessions:         [],
      status:           'planned',
      notes:            dto.notes,
      createdAt:        nowIso(),
    }

    // ATOMOWA REZERWACJA — kgAvailable → kgReserved
    // Zasada: AVAILABLE = fizycznie w magazynie do dyspozycji
    //         RESERVED  = zarezerwowane pod zlecenie (wciąż w magazynie fizycznie)
    dto.meatLots.forEach(lot => {
      const m = meat.find(x => x.id === lot.meatLotId)
      if (!m) return
      const newAvail    = Number(m.kgAvailable) - lot.kgPlanned
      const newReserved = Number(m.kgReserved ?? 0) + lot.kgPlanned
      meat = meat.map(x => x.id === lot.meatLotId ? {
        ...x,
        kgAvailable: newAvail,
        kgReserved:  newReserved,
        status:      newAvail <= 0.01 ? 'RESERVED' : 'AVAILABLE',
      } : x)
    })
    save(KEYS.meat, meat)

    mixingOrders = [order, ...mixingOrders]
    save('kebab_mes_mixing_orders', mixingOrders)
    saveCounters({ batchSeq, debSeq, meatSeq, logSeq, mixingSeq })
    return order
  },

  // Operator startuje sesję masowania (częściową) na tablecie
  start: async (id: string, dto: StartMixingDto): Promise<MixingOrder> => {
    await delay(300)
    const idx = mixingOrders.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Zlecenie nie znalezione')
    const order = mixingOrders[idx]
    if (order.status !== 'planned' && order.status !== 'in_progress')
      throw new Error('Zlecenie nie może być uruchomione')
    if (order.kgRemaining <= 0)
      throw new Error('Zlecenie w pełni wykonane')
    const resetSteps = order.steps.map(s => ({ ...s, confirmed: false, qtyConfirmed: undefined }))
    const updated: MixingOrder = {
      ...order, steps: resetSteps, status: 'in_progress', machineId: dto.machineId, startedAt: nowIso(),
    }
    mixingOrders = mixingOrders.map(o => o.id === id ? updated : o)
    save('kebab_mes_mixing_orders', mixingOrders)
    return updated
  },

  // ATOMOWE przeniesienie RESERVED → IN_PROCESS dla konkretnej ilości kg na maszynie
  allocateToMachine: async (
    orderId: string, machineId: MachineId, kgActual: number,
  ): Promise<void> => {
    await delay(100)
    const order = mixingOrders.find(o => o.id === orderId)
    if (!order) throw new Error('Zlecenie nie znalezione')
    const now = nowIso()
    const allocationId = cuid()
    let kgToMove = kgActual

    meat = meat.map(m => {
      if (kgToMove <= 0) return m
      // Sprawdź czy ten lot należy do zlecenia
      const isInOrder = order.meatLots.some(l => l.meatLotId === m.id)
      if (!isInOrder) return m
      const reserved = Number(m.kgReserved ?? 0)
      if (reserved <= 0) return m
      const toMove     = Math.min(kgToMove, reserved)
      kgToMove        -= toMove
      const newReserved  = reserved - toMove
      const newInProcess = Number(m.kgInProcess ?? 0) + toMove
      const allocation: any = {
        allocationId, machineId, mixingOrderId: orderId,
        mixingOrderNo: order.orderNo, kgAllocated: toMove,
        allocatedAt: now, status: 'in_process',
      }
      return {
        ...m,
        kgReserved:  newReserved,
        kgInProcess: newInProcess,
        machineAllocations: [...(m.machineAllocations ?? []), allocation],
        status: 'IN_PRODUCTION',
      }
    })
    save(KEYS.meat, meat)
  },

  // Operator potwierdza dodanie składnika
  confirmStep: async (id: string, dto: ConfirmStepDto): Promise<MixingOrder> => {
    await delay(200)
    const idx = mixingOrders.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Zlecenie nie znalezione')
    const order = mixingOrders[idx]
    if (order.status !== 'in_progress') throw new Error('Zlecenie nie jest aktywne')

    const updatedSteps = order.steps.map(s =>
      s.stepNo === dto.stepNo
        ? { ...s, confirmed: true, qtyConfirmed: dto.qtyConfirmed }
        : s
    )

    // Jeśli wszystkie składniki potwierdzone → zakończ tę sesję
    // (tablet osobno wywołuje finishSession z kgActual)
    const allDone = updatedSteps.every(s => s.confirmed)
    const updated: MixingOrder = {
      ...order,
      steps: updatedSteps,
      // Status pozostaje in_progress - finishSession ustawi planned/done
      status: allDone ? order.status : 'in_progress',
    }
    mixingOrders = mixingOrders.map(o => o.id === id ? updated : o)
    save('kebab_mes_mixing_orders', mixingOrders)
    return updated
  },

  // Zakończ sesję masowania — przesuń kgInProcess → kgUsed, aktualizuj ledger
  finishSession: async (id: string, kgActual: number, sessionBatchNo: string): Promise<MixingOrder> => {
    await delay(300)
    const idx = mixingOrders.findIndex(x => x.id === id)
    if (idx === -1) throw new Error('Zlecenie nie znalezione')
    const order = mixingOrders[idx]

    const newKgDone      = Number(order.kgDone) + kgActual
    const newKgRemaining = Math.max(0, order.meatKg - newKgDone)
    const isFullyDone    = newKgRemaining < 0.1
    const now            = nowIso()

    // ATOMOWE przeniesienie: kgInProcess → kgUsed (lub kgReserved → kgUsed jako fallback)
    let kgToConsume = kgActual
    meat = meat.map(m => {
      if (kgToConsume <= 0) return m
      const isInOrder = order.meatLots.some(l => l.meatLotId === m.id)
      if (!isInOrder) return m
      // Priorytet: kgInProcess (po allocateToMachine) → fallback kgReserved (jeśli allocate nie zadziałało)
      const inProc   = Number(m.kgInProcess ?? 0)
      const reserved = Number(m.kgReserved  ?? 0)
      const source   = inProc > 0 ? inProc : reserved
      if (source <= 0) return m
      const toConsume    = Math.min(kgToConsume, source)
      kgToConsume       -= toConsume
      const newInProcess = inProc   > 0 ? inProc   - toConsume : 0
      const newReserved  = reserved > 0 && inProc <= 0 ? reserved - toConsume : reserved
      const newUsed      = Number(m.kgUsed) + toConsume
      // Zamknij alokacje tej maszyny
      const updatedAllocs = (m.machineAllocations ?? []).map((a: any) =>
        a.mixingOrderId === id && a.status === 'in_process'
          ? { ...a, status: 'done', completedAt: now }
          : a
      )
      const availNow  = Number(m.kgAvailable)
      return {
        ...m,
        kgInProcess:        newInProcess,
        kgReserved:         newReserved,
        kgUsed:             newUsed,
        machineAllocations: updatedAllocs,
        status: (availNow + newReserved + newInProcess) <= 0.01 ? 'DEPLETED' :
                newInProcess > 0 ? 'IN_PRODUCTION' :
                newReserved  > 0 ? 'RESERVED'      : 'AVAILABLE',
      }
    })
    save(KEYS.meat, meat)

    const newSession: MixingSession = {
      sessionId:   cuid(),
      machineId:   order.machineId ?? 1,
      kgMeat:      kgActual,
      kgOutput:    Math.round(order.plannedOutputKg * (kgActual / order.meatKg) * 100) / 100,
      startedAt:   order.startedAt ?? now,
      completedAt: now,
      batchNo:     sessionBatchNo,
    }

    const resetSteps = order.steps.map(s => ({ ...s, confirmed: false, qtyConfirmed: undefined }))
    const updated: MixingOrder = {
      ...order,
      kgDone:      newKgDone,
      kgRemaining: newKgRemaining,
      steps:       resetSteps,
      sessions:    [...(order.sessions ?? []), newSession],
      status:      isFullyDone ? 'done' : 'planned',
      machineId:   isFullyDone ? order.machineId : undefined,
      completedAt: isFullyDone ? now : undefined,
    }
    mixingOrders = mixingOrders.map(o => o.id === id ? updated : o)
    save('kebab_mes_mixing_orders', mixingOrders)
    return updated
  },

  cancel: async (id: string): Promise<void> => {
    await delay(300)
    const order = mixingOrders.find(o => o.id === id)
    if (!order) return
    if (order.status !== 'planned') throw new Error('Można anulować tylko zaplanowane zlecenie')

    // Zwróć kgReserved → kgAvailable (atomowo)
    order.meatLots.forEach(lot => {
      meat = meat.map(m => {
        if (m.id !== lot.meatLotId) return m
        const wasReserved = Number(m.kgReserved ?? 0)
        if (wasReserved <= 0) return m
        // Proporcjonalnie: przywróć tyle ile zostało zarezerwowane dla tego zlecenia
        const toReturn = Math.min(wasReserved, lot.kgPlanned)
        return {
          ...m,
          kgAvailable: Number(m.kgAvailable) + toReturn,
          kgReserved:  wasReserved - toReturn,
          status:      (Number(m.kgAvailable) + toReturn) > 0 ? 'AVAILABLE' : m.status,
        }
      })
    })
    save(KEYS.meat, meat)

    mixingOrders = mixingOrders.map(o =>
      o.id === id ? { ...o, status: 'cancelled' as const } : o
    )
    save('kebab_mes_mixing_orders', mixingOrders)
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// SEASONED MEAT STOCK — Magazyn mięsa przyprawionego (półprodukt z masowania)
// ═══════════════════════════════════════════════════════════════════════════════

export interface SeasonedMeatBatch {
  readonly id:            string
  readonly batchNo:       string        // np. "MP-2025-001"
  readonly recipeName:    string
  readonly recipeId:      string
  readonly mixingOrderNo: string
  readonly mixingOrderId: string
  readonly kgProduced:    number
  readonly kgAvailable:   number
  readonly kgUsed:        number
  // Nowe (po dodaniu rezerwacji): kg_reserved + wolne = kg_available − kg_reserved.
  // Field optional bo mockApi nie inicjalizuje, backend zawsze wysyła.
  readonly kgReserved?:   number
  readonly kgFree?:       number
  readonly machineId:     MachineId
  // Traceability pełna — WSZYSTKIE linki do góry łańcucha
  readonly meatLots:           MixingOrderMeatLot[]
  // Denormalizowane dla szybkiego traceback bez join
  readonly rawBatchIds:        string[]   // id[] ćwiartek (RawBatch)
  readonly rawBatchNos:        string[]   // numery ćwiartek np. ["R171","R172"]
  readonly deboningEntryIds:   string[]   // id[] wpisów rozbioru (DeboningEntry)
  readonly supplierIds:        string[]   // id[] dostawców
  readonly slaughterDates:     string[]   // daty uboju
  readonly productTypeId?:     string
  readonly productTypeName?:   string
  readonly status:             'available' | 'reserved' | 'depleted'
  readonly completedAt:        string
  readonly expiryDate:         string
  readonly notes?:             string
}

let seasonedMeat = load<SeasonedMeatBatch>('kebab_mes_seasoned_meat', [])
let seasonedSeq  = loadCounters().seasonedSeq ?? 0

export const seasonedMeatApi = {

  list: async (): Promise<SeasonedMeatBatch[]> => {
    await delay(200)
    return [...seasonedMeat]
      .filter(m => m.status !== 'depleted')
      .sort((a, b) => a.expiryDate > b.expiryDate ? 1 : -1)  // FEFO
  },

  all: async (): Promise<SeasonedMeatBatch[]> => {
    await delay(200)
    return [...seasonedMeat].sort((a, b) => b.completedAt > a.completedAt ? 1 : -1)
  },

  // Pełny łańcuch traceability dla partii mięsa przyprawionego
  // Zwraca kompletny widok: SeasonedBatch → MeatStock → DeboningEntry → RawBatch → Dostawca
  getFullTrace: async (seasonedBatchId: string): Promise<{
    seasoned:  SeasonedMeatBatch
    meatLots:  Array<{
      meatStock:      any
      deboningEntry:  any   // DeboningEntry (wpis rozbioru)
      rawBatch:       any   // RawBatch (ćwiartka)
      supplier:       any   // Dostawca
    }>
    summary: {
      totalRawKg:     number
      totalMeatKg:    number
      totalOutputKg:  number
      suppliers:      string[]
      rawBatchNos:    string[]
      slaughterDates: string[]
    }
  }> => {
    await delay(200)
    const seasoned = seasonedMeat.find(s => s.id === seasonedBatchId)
    if (!seasoned) throw new Error('Partia nie znaleziona')

    const meatLotsTrace = seasoned.meatLots.map(lot => {
      const meatStock     = meat.find(m => m.id === lot.meatLotId) ?? null
      const deboningEntry = deboningEntries.find(e => e.id === meatStock?.deboningSessionId) ?? null
      const rawBatch      = batches.find(b => b.id === meatStock?.rawBatchId) ?? null
      const supplier      = rawBatch ? suppliers.find(s => s.id === rawBatch.supplierId) ?? null : null
      return { meatStock, deboningEntry, rawBatch, supplier }
    })

    const totalRawKg    = meatLotsTrace.reduce((s, t) => s + (t.deboningEntry?.kgTaken ?? 0), 0)
    const totalMeatKg   = seasoned.meatLots.reduce((s, l) => s + l.kgPlanned, 0)
    const supplierNames = [...new Set(meatLotsTrace.map(t => t.supplier?.name).filter(Boolean))] as string[]
    const rawNos        = [...new Set(meatLotsTrace.map(t => t.rawBatch?.internalBatchNo).filter(Boolean))] as string[]
    const sldates       = [...new Set(meatLotsTrace.map(t => t.rawBatch?.slaughterDate).filter(Boolean))] as string[]

    return {
      seasoned,
      meatLots: meatLotsTrace,
      summary: {
        totalRawKg,
        totalMeatKg,
        totalOutputKg: seasoned.kgProduced,
        suppliers:      supplierNames,
        rawBatchNos:    rawNos,
        slaughterDates: sldates,
      },
    }
  },

  // Tworzony automatycznie po zakończeniu masowania
  createFromOrder: async (orderId: string, kgProduced: number, notes?: string): Promise<SeasonedMeatBatch> => {
    await delay(400)
    const order = mixingOrders.find(o => o.id === orderId)
    if (!order) throw new Error('Zlecenie nie znalezione')
    // Działa zarówno przy częściowym (in_progress) jak i pełnym (done) wykonaniu

    seasonedSeq++
    const c = loadCounters()
    saveCounters({ ...c, seasonedSeq })

    const year = new Date().getFullYear()
    const completedAt = nowIso()
    // Świeże mięso przyprawione — ważność 3 dni
    const expiry = new Date()
    expiry.setDate(expiry.getDate() + 3)

    // Zbierz pełny łańcuch traceability przez meatLots
    const rawBatchIds:      string[] = []
    const rawBatchNos:      string[] = []
    const deboningEntryIds: string[] = []
    const supplierIds:      string[] = []
    const slaughterDates:   string[] = []

    for (const lot of order.meatLots) {
      // MeatStock → DeboningEntry — szukaj też po lotNo (fallback)
      const meatItem = meat.find(m => m.id === lot.meatLotId || m.lotNo === lot.meatLotNo)
      // Użyj rawBatchNo z lotu jako fallback (jest tam zawsze)
      const rawBatchNoFromLot = lot.rawBatchNo
      if (meatItem) {
        // MeatStock → RawBatch (bezpośredni link)
        if (meatItem.rawBatchId && !rawBatchIds.includes(meatItem.rawBatchId)) {
          rawBatchIds.push(meatItem.rawBatchId)
          const rbn = meatItem.rawBatchNo || rawBatchNoFromLot
          if (rbn && !rawBatchNos.includes(rbn)) rawBatchNos.push(rbn)
          // RawBatch → dane dostawcy
          const rawBatch = batches.find(b => b.id === meatItem.rawBatchId)
          if (rawBatch) {
            if (rawBatch.supplierId && !supplierIds.includes(rawBatch.supplierId))
              supplierIds.push(rawBatch.supplierId)
            if (rawBatch.slaughterDate && !slaughterDates.includes(rawBatch.slaughterDate))
              slaughterDates.push(rawBatch.slaughterDate)
          }
        }
        // MeatStock → DeboningEntry (przez deboningSessionId)
        if (meatItem.deboningSessionId && !deboningEntryIds.includes(meatItem.deboningSessionId)) {
          deboningEntryIds.push(meatItem.deboningSessionId)
        }
      } else if (rawBatchNoFromLot && !rawBatchNos.includes(rawBatchNoFromLot)) {
        // Fallback: użyj danych z lotu jeśli MeatStock nie znaleziony
        rawBatchNos.push(rawBatchNoFromLot)
        const fb = batches.find(b => b.internalBatchNo === rawBatchNoFromLot)
        if (fb) {
          if (!rawBatchIds.includes(fb.id)) rawBatchIds.push(fb.id)
          if (fb.supplierId && !supplierIds.includes(fb.supplierId)) supplierIds.push(fb.supplierId)
          if (fb.slaughterDate && !slaughterDates.includes(fb.slaughterDate)) slaughterDates.push(fb.slaughterDate)
        }
      }
    }

    const batch: SeasonedMeatBatch = {
      id:              cuid(),
      // Numer partii: P{numer_ćwiartki} np. P174, dziedziczony z R174
      // Jeśli wiele ćwiartek (np. R174+R175) — bierzemy pierwszą FEFO
      batchNo: rawBatchNos.length > 0
        ? `P${rawBatchNos[0].replace(/^R/,'')}`
        : `P${seasonedSeq}`,
      recipeName:      order.recipeName,
      recipeId:        order.recipeId,
      mixingOrderNo:   order.orderNo,
      mixingOrderId:   orderId,
      kgProduced,
      kgAvailable:     kgProduced,
      kgUsed:          0,
      machineId:       order.machineId ?? 1,
      meatLots:        order.meatLots,
      // Pełny łańcuch traceability — zbieramy przy tworzeniu, nie przy odczycie
      rawBatchIds,
      rawBatchNos,
      deboningEntryIds,
      supplierIds,
      slaughterDates,
      productTypeId:   order.productTypeId,
      productTypeName: order.productTypeName,
      status:          'available',
      completedAt,
      expiryDate:      expiry.toISOString().slice(0, 10),
      notes,
    }

    seasonedMeat = [batch, ...seasonedMeat]
    save('kebab_mes_seasoned_meat', seasonedMeat)
    return batch
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// MIXING MACHINE LOCKS — blokada masownicy podczas i po masowaniu
// ═══════════════════════════════════════════════════════════════════════════════

export interface MachineLock {
  machineId:   MachineId
  orderId:     string
  orderNo:     string
  lockedAt:    string
  unlocksAt:   string    // lockedAt + 50 minut
  status:      'mixing' | 'cooling'  // mixing = w trakcie, cooling = odlicza 50 min
}

let machineLocks = load<MachineLock>('kebab_mes_machine_locks', [])

export const machineLockApi = {

  list: async (): Promise<MachineLock[]> => {
    await delay(100)
    const now = new Date()
    // Automatycznie usuń wygasłe blokady
    machineLocks = machineLocks.filter(l => new Date(l.unlocksAt) > now)
    save('kebab_mes_machine_locks', machineLocks)
    return machineLocks
  },

  lock: async (machineId: MachineId, orderId: string, orderNo: string, durationMinutes = 50): Promise<MachineLock> => {
    await delay(100)
    const lockedAt  = new Date()
    const unlocksAt = new Date(lockedAt.getTime() + durationMinutes * 60_000)
    const lock: MachineLock = {
      machineId, orderId, orderNo,
      lockedAt:  lockedAt.toISOString(),
      unlocksAt: unlocksAt.toISOString(),
      status:    'cooling',
    }
    machineLocks = machineLocks.filter(l => l.machineId !== machineId)
    machineLocks = [lock, ...machineLocks]
    save('kebab_mes_machine_locks', machineLocks)
    return lock
  },

  unlock: async (machineId: MachineId): Promise<void> => {
    await delay(100)
    machineLocks = machineLocks.filter(l => l.machineId !== machineId)
    save('kebab_mes_machine_locks', machineLocks)
  },

  isLocked: async (machineId: MachineId): Promise<MachineLock | null> => {
    await delay(50)
    const now = new Date()
    const lock = machineLocks.find(l => l.machineId === machineId && new Date(l.unlocksAt) > now)
    return lock ?? null
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// KONTRAHENCI (Clients) — zamówienia klientów
// ═══════════════════════════════════════════════════════════════════════════════

export interface Client {
  id:           string
  code:         string       // KLI-001
  name:         string       // oficjalna nazwa z rejestru (zgodnie z NIP)
  displayName?: string       // skrócona / zakładowa nazwa (np. "Zagros" zamiast "Okay Tekin Sp. z o.o.")
  nip?:         string
  regon?:       string
  address?:     string
  postalCode?:  string
  city?:        string
  contactName?: string
  phone?:       string
  email?:       string
  language?:    string       // pl/de/sk/cs/en — język HDI
  destName?:    string       // miejsce przeznaczenia (puste = adres klienta)
  destAddress?: string
  destCity?:    string
  active:       boolean
  createdAt:    string
}

export interface CreateClientDto {
  name: string; displayName?: string; nip?: string; regon?: string; address?: string
  postalCode?: string; city?: string; contactName?: string; phone?: string; email?: string
  language?: string; destName?: string; destAddress?: string; destCity?: string
}

let clients    = load<Client>('kebab_mes_clients', [])
let clientSeq  = loadCounters().clientSeq ?? 0

function saveClientCounters() { const c = loadCounters(); saveCounters({ ...c, clientSeq }) }

export const clientsApi = {
  list: async (): Promise<Client[]> => { await delay(); return [...clients].sort((a,b)=>a.name.localeCompare(b.name,'pl')) },
  create: async (dto: CreateClientDto): Promise<Client> => {
    await delay(300)
    clientSeq++
    const c: Client = {
      id: cuid(), code: `KLI-${String(clientSeq).padStart(3,'0')}`,
      name: dto.name, nip: dto.nip, regon: dto.regon,
      address: dto.address, city: dto.city,
      contactName: dto.contactName, phone: dto.phone, email: dto.email,
      active: true, createdAt: nowIso(),
    }
    clients = [...clients, c]
    save('kebab_mes_clients', clients)
    saveClientCounters()
    return c
  },
  update: async (id: string, dto: Partial<CreateClientDto>): Promise<Client> => {
    await delay(200)
    clients = clients.map(c => c.id === id ? { ...c, ...dto } : c)
    save('kebab_mes_clients', clients)
    return clients.find(c => c.id === id)!
  },
  deactivate: async (id: string): Promise<void> => {
    await delay(200)
    clients = clients.map(c => c.id === id ? { ...c, active: false } : c)
    save('kebab_mes_clients', clients)
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAGAZYN TULEI I OPAKOWAŃ
// ═══════════════════════════════════════════════════════════════════════════════

export type PackagingType = 'tuleja' | 'opakowanie' | 'inne'

export interface PackagingItem {
  id:          string
  code:        string       // PAK-001
  name:        string       // np. "Tuleja metal 65cm"
  type:        PackagingType
  unit:        string       // szt, kg, rolka
  kgInitial:   number
  kgAvailable: number
  kgUsed:      number
  supplierId?: string
  supplierName?: string
  expiryDate?: string
  notes?:      string
  createdAt:   string
}

export interface CreatePackagingDto {
  name: string; type: PackagingType; unit: string; qty: number
  supplierId?: string; expiryDate?: string; notes?: string
}

let packagingItems = load<PackagingItem>('kebab_mes_packaging', [])
let packagingSeq   = loadCounters().packagingSeq ?? 0

export const packagingApi = {
  list: async (): Promise<PackagingItem[]> => {
    await delay()
    return [...packagingItems].filter(p => p.kgAvailable > 0).sort((a,b)=>a.name.localeCompare(b.name,'pl'))
  },
  all: async (): Promise<PackagingItem[]> => {
    await delay()
    return [...packagingItems].sort((a,b)=>b.createdAt>a.createdAt?1:-1)
  },
  receive: async (dto: CreatePackagingDto): Promise<PackagingItem> => {
    await delay(300)
    packagingSeq++
    const sup = suppliers.find(s => s.id === dto.supplierId)
    // Sprawdź czy jest już taki artykuł z tym samym name — dołóż stock
    const existing = packagingItems.find(p => p.name.toLowerCase() === dto.name.toLowerCase())
    if (existing) {
      packagingItems = packagingItems.map(p => p.id === existing.id
        ? { ...p, kgInitial: p.kgInitial + dto.qty, kgAvailable: p.kgAvailable + dto.qty }
        : p)
      save('kebab_mes_packaging', packagingItems)
      const c = loadCounters(); saveCounters({ ...c, packagingSeq })
      return packagingItems.find(p => p.id === existing.id)!
    }
    const item: PackagingItem = {
      id: cuid(), code: `PAK-${String(packagingSeq).padStart(3,'0')}`,
      name: dto.name, type: dto.type, unit: dto.unit,
      kgInitial: dto.qty, kgAvailable: dto.qty, kgUsed: 0,
      supplierId: dto.supplierId, supplierName: sup?.name,
      expiryDate: dto.expiryDate, notes: dto.notes,
      createdAt: nowIso(),
    }
    packagingItems = [...packagingItems, item]
    save('kebab_mes_packaging', packagingItems)
    const c = loadCounters(); saveCounters({ ...c, packagingSeq })
    return item
  },
  use: async (id: string, qty: number): Promise<void> => {
    await delay(100)
    packagingItems = packagingItems.map(p => p.id === id
      ? { ...p, kgAvailable: Math.max(0, p.kgAvailable - qty), kgUsed: p.kgUsed + qty }
      : p)
    save('kebab_mes_packaging', packagingItems)
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZAMÓWIENIA OD KONTRAHENTÓW
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrderLine {
  id:            string
  qty:           number       // szt
  kgPerUnit:     number       // kg/szt
  totalKg:       number       // qty * kgPerUnit
  productTypeId: string
  productTypeName: string
  recipeId:      string
  recipeName:    string
  packagingId?:  string
  packagingName?: string
  notes?:        string
}

export interface ClientOrder {
  id:          string
  orderNo:     string        // ZAM-2026-001
  clientId:    string
  clientName:  string
  orderDate:   string
  deliveryDate?: string
  lines:       OrderLine[]
  totalKg:     number
  totalUnits:  number
  status:      'draft' | 'confirmed' | 'in_production' | 'done' | 'cancelled'
  notes?:      string
  createdAt:   string
}

export interface CreateOrderLineDto {
  qty: number; kgPerUnit: number
  productTypeId: string; recipeId: string
  packagingId?: string; notes?: string
}

export interface CreateClientOrderDto {
  clientId:     string
  orderDate:    string
  deliveryDate?: string
  lines:        CreateOrderLineDto[]
  notes?:       string
}

let clientOrders  = load<ClientOrder>('kebab_mes_client_orders', [])
let clientOrderSeq = loadCounters().clientOrderSeq ?? 0

export const clientOrdersApi = {
  list: async (status?: string): Promise<ClientOrder[]> => {
    await delay(200)
    const all = [...clientOrders].sort((a,b)=>b.createdAt>a.createdAt?1:-1)
    return status ? all.filter(o=>o.status===status) : all
  },
  byId: async (id: string): Promise<ClientOrder> => {
    await delay(100)
    const o = clientOrders.find(x=>x.id===id)
    if (!o) throw new Error('Zamówienie nie znalezione')
    return o
  },
  create: async (dto: CreateClientOrderDto): Promise<ClientOrder> => {
    await delay(400)
    const client = clients.find(c=>c.id===dto.clientId)
    if (!client) throw new Error('Klient nie znaleziony')
    clientOrderSeq++
    const year = new Date().getFullYear()
    const lines: OrderLine[] = dto.lines.map((l,i) => {
      const pt  = productTypes.find(p=>p.id===l.productTypeId)
      const rec = recipes.find(r=>r.id===l.recipeId)
      const pkg = packagingItems.find(p=>p.id===l.packagingId)
      return {
        id: cuid(), qty: l.qty, kgPerUnit: l.kgPerUnit, totalKg: Math.round(l.qty*l.kgPerUnit*100)/100,
        productTypeId: l.productTypeId, productTypeName: pt?.name ?? '—',
        recipeId: l.recipeId, recipeName: rec?.name ?? '—',
        packagingId: l.packagingId, packagingName: pkg?.name,
        notes: l.notes,
      }
    })
    const order: ClientOrder = {
      id: cuid(), orderNo: `ZAM-${year}-${String(clientOrderSeq).padStart(3,'0')}`,
      clientId: dto.clientId, clientName: client.name,
      orderDate: dto.orderDate, deliveryDate: dto.deliveryDate,
      lines, totalKg: lines.reduce((s,l)=>s+l.totalKg,0),
      totalUnits: lines.reduce((s,l)=>s+l.qty,0),
      status: 'draft', notes: dto.notes, createdAt: nowIso(),
    }
    clientOrders = [order, ...clientOrders]
    save('kebab_mes_client_orders', clientOrders)
    const c = loadCounters(); saveCounters({ ...c, clientOrderSeq })
    return order
  },
  updateStatus: async (id: string, status: ClientOrder['status']): Promise<ClientOrder> => {
    await delay(200)
    clientOrders = clientOrders.map(o => o.id===id ? { ...o, status } : o)
    save('kebab_mes_client_orders', clientOrders)
    return clientOrders.find(o=>o.id===id)!
  },
  delete: async (id: string): Promise<void> => {
    await delay(200)
    clientOrders = clientOrders.filter(o=>o.id!==id)
    save('kebab_mes_client_orders', clientOrders)
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN PRODUKCJI — wiersz planu
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProductionPlanLine {
  id:            string
  planId:        string
  qty:           number
  kgPerUnit:     number
  totalKg:       number
  productTypeId: string
  productTypeName: string
  recipeId:      string
  recipeName:    string
  packagingId?:  string
  packagingName?: string
  seasonedBatchId?:  string
  seasonedBatchNo?:  string
  seasonedBatchIds?: string[]   // wiele partii
  seasonedBatchNos?: string[]
  kgAssigned:    number     // ile kg przypisano z magazynu
  clientOrderId?:     string
  clientOrderNo?:     string
  clientOrderLineId?: string
  clientName?:        string
  status:        'pending' | 'assigned' | 'done'
}

export interface ProductionPlan {
  id:          string
  planNo:      string       // PROD/dd/mm/rr (starsze: PP/dd/mm/rr)
  planDate:    string
  lines:       ProductionPlanLine[]
  totalKg:     number
  totalUnits:  number
  status:      'draft' | 'active' | 'done' | 'cancelled'
  notes?:      string
  createdAt:   string
  tabletFinishedAt?:  string | null  // operator zakończył, czeka na biuro
  officeConfirmedAt?: string | null  // biuro potwierdziło, finish_day wykonany
}

export interface CreatePlanLineDto {
  qty: number; kgPerUnit: number
  productTypeId: string; recipeId: string
  packagingId?: string
  seasonedBatchId?:  string          // główna/pierwsza partia
  seasonedBatchIds?: string[]        // wszystkie partie (multi)
  clientOrderId?: string; clientOrderNo?: string; clientOrderLineId?: string; clientName?: string
}

export interface CreateProductionPlanDto {
  planDate: string; lines: CreatePlanLineDto[]; notes?: string
}

let productionPlans   = load<ProductionPlan>('kebab_mes_production_plans', [])
let productionPlanSeq = loadCounters().productionPlanSeq ?? 0

export const productionPlansApi = {
  list: async (): Promise<ProductionPlan[]> => {
    await delay(200)
    return [...productionPlans].sort((a,b)=>b.createdAt>a.createdAt?1:-1)
  },
  byId: async (id: string): Promise<ProductionPlan> => {
    await delay(100)
    const p = productionPlans.find(x=>x.id===id)
    if (!p) throw new Error('Plan nie znaleziony')
    return p
  },
  create: async (dto: CreateProductionPlanDto): Promise<ProductionPlan> => {
    await delay(400)
    productionPlanSeq++
    const year = new Date().getFullYear()
    const lines: ProductionPlanLine[] = dto.lines.map(l => {
      const pt  = productTypes.find(p=>p.id===l.productTypeId)
      const rec = recipes.find(r=>r.id===l.recipeId)
      const pkg = packagingItems.find(p=>p.id===l.packagingId)
      const smIds = l.seasonedBatchIds?.length>0 ? l.seasonedBatchIds : (l.seasonedBatchId?[l.seasonedBatchId]:[])
      const smList = smIds.map(id=>seasonedMeat.find(s=>s.id===id)).filter(Boolean)
      const sm = smList[0] ?? seasonedMeat.find(s=>s.id===l.seasonedBatchId)
      const totalKg = Math.round(l.qty*l.kgPerUnit*100)/100
      return {
        id: cuid(), planId: '', qty: l.qty, kgPerUnit: l.kgPerUnit, totalKg,
        productTypeId: l.productTypeId, productTypeName: pt?.name ?? '—',
        recipeId: l.recipeId, recipeName: rec?.name ?? '—',
        packagingId: l.packagingId, packagingName: pkg?.name,
        seasonedBatchId: smIds[0], seasonedBatchNo: sm?.batchNo,
        seasonedBatchIds: smIds.length>0 ? smIds : undefined,
        seasonedBatchNos: smList.map((s:any)=>s.batchNo),
        kgAssigned: smIds.length>0 ? totalKg : 0,
        clientOrderId: l.clientOrderId, clientOrderNo: l.clientOrderNo, clientName: l.clientName,
        status: l.seasonedBatchId ? 'assigned' : 'pending',
      }
    })
    const plan: ProductionPlan = {
      id: cuid(), planNo: `PP-${year}-${String(productionPlanSeq).padStart(3,'0')}`,
      planDate: dto.planDate, lines, 
      totalKg: lines.reduce((s,l)=>s+l.totalKg,0),
      totalUnits: lines.reduce((s,l)=>s+l.qty,0),
      status: 'draft', notes: dto.notes, createdAt: nowIso(),
    }
    // Ustaw planId
    plan.lines.forEach(l => (l as any).planId = plan.id)
    // Odejmij z magazynu mięsa przyprawionego
    dto.lines.forEach(l => {
      const smIds = l.seasonedBatchIds?.length>0 ? l.seasonedBatchIds : (l.seasonedBatchId?[l.seasonedBatchId]:[])
      if (smIds.length > 0) {
        const totalKg = Math.round(l.qty*l.kgPerUnit*100)/100
        // Proporcjonalne odejmowanie z każdej partii
        let remaining = totalKg
        for (const id of smIds) {
          const sm = seasonedMeat.find(s=>s.id===id)
          if (!sm||remaining<=0) continue
          const take = Math.min(remaining, sm.kgAvailable)
          remaining -= take
          seasonedMeat = seasonedMeat.map(s => s.id===id
            ? { ...s, kgAvailable: Math.max(0, s.kgAvailable - take), kgUsed: s.kgUsed + take }
            : s)
        }
        // placeholder removed
        // Opakowanie
        if (l.packagingId) {
          packagingItems = packagingItems.map(p => p.id===l.packagingId
            ? { ...p, kgAvailable: Math.max(0, p.kgAvailable - l.qty), kgUsed: p.kgUsed + l.qty }
            : p)
        }
      }
    })
    save('kebab_mes_seasoned_meat', seasonedMeat)
    save('kebab_mes_packaging', packagingItems)
    productionPlans = [plan, ...productionPlans]
    save('kebab_mes_production_plans', productionPlans)
    const c = loadCounters(); saveCounters({ ...c, productionPlanSeq })
    return plan
  },
  updateStatus: async (id: string, status: ProductionPlan['status']): Promise<void> => {
    await delay(200)
    productionPlans = productionPlans.map(p => p.id===id ? { ...p, status } : p)
    save('kebab_mes_production_plans', productionPlans)
  },
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAGAZYN WYROBÓW GOTOWYCH
// ═══════════════════════════════════════════════════════════════════════════════

export interface FinishedGoodsItem {
  id:              string
  batchNo:         string        // WG-2026-001
  planId:          string
  planNo:          string
  planLineId:      string
  productTypeId:   string
  productTypeName: string
  recipeId:        string
  recipeName:      string
  packagingId?:    string
  packagingName?:  string
  clientOrderId?:  string
  clientOrderNo?:  string
  clientName?:     string
  qty:             number        // szt wyprodukowane
  kgPerUnit:       number
  totalKg:         number
  // Traceability
  seasonedBatchNos: string[]
  rawBatchNos:      string[]
  // Stan
  qtyAvailable:    number
  qtyShipped:      number
  producedDate:    string
  producedBy:      string[]     // pracownicy którzy produkowali
  createdAt:       string
}

export interface CreateFinishedGoodsDto {
  planId:       string
  planNo:       string
  planLineId:   string
  qty:          number
  workerNames:  string[]
  // dane z linii planu
  productTypeId:   string; productTypeName: string
  recipeId:        string; recipeName: string
  packagingId?:    string; packagingName?: string
  clientOrderId?:  string; clientOrderNo?: string; clientName?: string
  kgPerUnit:       number
  seasonedBatchNos?: string[]
}

let finishedGoods    = load<FinishedGoodsItem>('kebab_mes_finished_goods', [])
let finishedGoodsSeq = loadCounters().finishedGoodsSeq ?? 0

export const finishedGoodsApi = {
  list: async (): Promise<FinishedGoodsItem[]> => {
    await delay(200)
    return [...finishedGoods].sort((a,b) => b.createdAt>a.createdAt?1:-1)
  },

  // Dodaj pozycję z tabletu produkcji
  create: async (dto: CreateFinishedGoodsDto): Promise<FinishedGoodsItem> => {
    await delay(300)
    finishedGoodsSeq++
    const year = new Date().getFullYear()
    const totalKg = Math.round(dto.qty * dto.kgPerUnit * 100)/100
    const item: FinishedGoodsItem = {
      id:              cuid(),
      batchNo:         `WG-${year}-${String(finishedGoodsSeq).padStart(3,'0')}`,
      planId:          dto.planId,
      planNo:          dto.planNo,
      planLineId:      dto.planLineId,
      productTypeId:   dto.productTypeId,
      productTypeName: dto.productTypeName,
      recipeId:        dto.recipeId,
      recipeName:      dto.recipeName,
      packagingId:     dto.packagingId,
      packagingName:   dto.packagingName,
      clientOrderId:   dto.clientOrderId,
      clientOrderNo:   dto.clientOrderNo,
      clientName:      dto.clientName,
      qty:             dto.qty,
      kgPerUnit:       dto.kgPerUnit,
      totalKg,
      seasonedBatchNos: dto.seasonedBatchNos ?? [],
      rawBatchNos:     [],
      qtyAvailable:    dto.qty,
      qtyShipped:      0,
      producedDate:    nowIso().slice(0,10),
      producedBy:      dto.workerNames,
      createdAt:       nowIso(),
    }
    finishedGoods = [item, ...finishedGoods]
    save('kebab_mes_finished_goods', finishedGoods)
    const c = loadCounters(); saveCounters({ ...c, finishedGoodsSeq })
    return item
  },

  // Zbiorczy zapis po zakończeniu dnia — SCALANIE identycznych produktów
  finishProductionDay: async (
    planId: string,
    progressEntries: Array<{
      planLineId: string; qty: number; workerNames: string[]
      kgPerUnit: number; productTypeId: string; productTypeName: string
      recipeId: string; recipeName: string
      packagingId?: string; packagingName?: string
      clientOrderId?: string; clientOrderNo?: string; clientName?: string
      seasonedBatchNos?: string[]
    }>
  ): Promise<FinishedGoodsItem[]> => {
    await delay(500)
    const plan = productionPlans.find(p=>p.id===planId)
    if (!plan) throw new Error('Plan nie znaleziony')

    const created: FinishedGoodsItem[] = []
    for (const entry of progressEntries) {
      if (entry.qty <= 0) continue
      const totalKg = Math.round(entry.qty * entry.kgPerUnit * 100)/100

      // Klucz scalania: receptura + tuleja + klient + kg/szt
      const mergeKey = [
        entry.recipeId,
        entry.packagingId ?? '',
        entry.clientName  ?? '',
        String(entry.kgPerUnit),
      ].join('|')

      // Szukaj istniejącej pozycji z tym samym kluczem na dziś
      const today = nowIso().slice(0,10)
      const existing = finishedGoods.find(g =>
        g.producedDate === today &&
        g.recipeId     === entry.recipeId &&
        (g.packagingId??'')  === (entry.packagingId??'') &&
        (g.clientName??'')   === (entry.clientName??'') &&
        g.kgPerUnit    === entry.kgPerUnit
      )

      if (existing) {
        // SCAL — dodaj szt do istniejącej partii
        // Zapisz szczegóły z tej sesji jako sub-wpis
        const subEntry = {
          planLineId:       entry.planLineId,
          qty:              entry.qty,
          totalKg,
          seasonedBatchNos: entry.seasonedBatchNos ?? [],
          workerNames:      entry.workerNames,
          addedAt:          nowIso(),
        }
        const updatedBatchNos = [...new Set([...existing.seasonedBatchNos, ...(entry.seasonedBatchNos??[])])]
        finishedGoods = finishedGoods.map(g => g.id === existing.id ? {
          ...g,
          qty:              g.qty + entry.qty,
          totalKg:          g.totalKg + totalKg,
          qtyAvailable:     g.qtyAvailable + entry.qty,
          seasonedBatchNos: updatedBatchNos,
          producedBy:       [...new Set([...g.producedBy, ...entry.workerNames])],
          // subEntries — dla podglądu szczegółów per partia
          subEntries: [...((g as any).subEntries ?? []), subEntry],
        } : g)
        created.push(finishedGoods.find(g=>g.id===existing.id)!)
      } else {
        // NOWY wpis — numer partii dziedziczymy z mięsa przyprawionego (Pxxx)
        finishedGoodsSeq++
        const seasonedBatchNo = entry.seasonedBatchNos?.[0] ?? ''
        // Numer wyrobu gotowego = ten sam co P-partia mięsa przyprawionego
        const batchNo = seasonedBatchNo && seasonedBatchNo.startsWith('P')
          ? seasonedBatchNo  // P174 → produkt gotowy też P174
          : `P${finishedGoodsSeq}`

        const item: FinishedGoodsItem = {
          id:              cuid(),
          batchNo,
          planId, planNo:  plan.planNo, planLineId: entry.planLineId,
          productTypeId:   entry.productTypeId, productTypeName: entry.productTypeName,
          recipeId:        entry.recipeId, recipeName: entry.recipeName,
          packagingId:     entry.packagingId, packagingName: entry.packagingName,
          clientOrderId:   entry.clientOrderId, clientOrderNo: entry.clientOrderNo, clientName: entry.clientName,
          qty: entry.qty, kgPerUnit: entry.kgPerUnit, totalKg,
          seasonedBatchNos: entry.seasonedBatchNos ?? [],
          rawBatchNos: [],
          qtyAvailable: entry.qty, qtyShipped: 0,
          producedDate: today,
          producedBy:   entry.workerNames,
          // subEntries — historia per sesja (dla podglądu)
          subEntries: [{
            planLineId:       entry.planLineId,
            qty:              entry.qty,
            totalKg,
            seasonedBatchNos: entry.seasonedBatchNos ?? [],
            workerNames:      entry.workerNames,
            addedAt:          nowIso(),
          }],
          createdAt: nowIso(),
        } as any
        finishedGoods = [item, ...finishedGoods]
        created.push(item)
      }
    }
    productionPlans = productionPlans.map(p => p.id===planId ? { ...p, status:'done' as const } : p)
    save('kebab_mes_finished_goods', finishedGoods)
    save('kebab_mes_production_plans', productionPlans)
    const c = loadCounters(); saveCounters({ ...c, finishedGoodsSeq })
    return created
  },
}
