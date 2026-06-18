/**
 * Kolejka skanów offline (IndexedDB). Gdy nie ma sieci, skan sztuki trafia tutaj;
 * po złapaniu sieci apka dosyła kolejkę do systemu (patrz MobilePakowaniePage).
 */
const DB_NAME = 'kebab-offline'
const STORE = 'scanQueue'
const VERSION = 1

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
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const req = fn(t.objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
    t.oncomplete = () => db.close()
  })
}

export async function enqueueScan(item: Omit<QueuedScan, 'id'>): Promise<void> {
  await tx('readwrite', (s) => s.add(item))
}

export async function getQueuedScans(): Promise<QueuedScan[]> {
  const all = await tx<QueuedScan[]>('readonly', (s) => s.getAll() as IDBRequest<QueuedScan[]>)
  return (all ?? []).sort((a, b) => (a.id ?? 0) - (b.id ?? 0))
}

export async function removeQueuedScan(id: number): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}

export async function queuedCount(): Promise<number> {
  try {
    return await tx<number>('readonly', (s) => s.count())
  } catch {
    return 0
  }
}
