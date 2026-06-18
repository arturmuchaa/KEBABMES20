/**
 * Kolejka skanów offline (IndexedDB). Gdy nie ma sieci, skan sztuki trafia tutaj;
 * po złapaniu sieci apka dosyła kolejkę do systemu (patrz MobilePakowaniePage).
 */
const DB_NAME = 'kebab-offline'
const STORE = 'scanQueue'
const ELIGIBLE = 'eligibleUnits'
const VERSION = 2

export interface QueuedScan {
  id?: number
  kind: 'order' | 'stock'
  containerId: string
  code: string
  ts: number
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true })
      }
      if (!db.objectStoreNames.contains(ELIGIBLE)) {
        db.createObjectStore(ELIGIBLE, { keyPath: 'cartonId' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode)
    const req = fn(t.objectStore(store))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  })
}

export async function enqueueScan(item: Omit<QueuedScan, 'id'>): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.add(item))
}

export async function getQueuedScans(): Promise<QueuedScan[]> {
  const all = await tx<QueuedScan[]>(STORE, 'readonly', (s) => s.getAll() as IDBRequest<QueuedScan[]>)
  return (all ?? []).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

export async function removeQueuedScan(id: number): Promise<void> {
  await tx(STORE, 'readwrite', (s) => s.delete(id))
}

export async function queuedCount(): Promise<number> {
  try {
    return await tx<number>(STORE, 'readonly', (s) => s.count())
  } catch {
    return 0
  }
}

// ── Uprawnione sztuki kartonu (prefetch do walidacji lokalnej offline) ──
/** Pozycja kartonu do walidacji offline per pozycja (uprawnione kody + wolne miejsce). */
export interface OfflineCartonLine {
  lineId: string
  remaining: number
  codes: string[]
}

export async function saveEligibleUnits(
  cartonId: string, codes: string[], lines: OfflineCartonLine[] = [],
): Promise<void> {
  try {
    await tx(ELIGIBLE, 'readwrite', (s) => s.put({ cartonId, codes, lines, ts: Date.now() }))
  } catch { /* brak IndexedDB → fallback optymistyczny */ }
}

export async function getEligibleUnits(cartonId: string): Promise<string[]> {
  try {
    const row = await tx<{ cartonId: string; codes: string[] } | undefined>(
      ELIGIBLE, 'readonly', (s) => s.get(cartonId) as IDBRequest<any>,
    )
    return row?.codes ?? []
  } catch {
    return []
  }
}

export async function getCartonLines(cartonId: string): Promise<OfflineCartonLine[]> {
  try {
    const row = await tx<{ cartonId: string; lines?: OfflineCartonLine[] } | undefined>(
      ELIGIBLE, 'readonly', (s) => s.get(cartonId) as IDBRequest<any>,
    )
    return row?.lines ?? []
  } catch {
    return []
  }
}
