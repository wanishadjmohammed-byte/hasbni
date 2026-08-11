/**
 * Persistance offline (CDC 5.1) : IndexedDB heberge un instantane de l'etat
 * (lecture immediate au demarrage, meme sans reseau) et la file des operations
 * en attente de synchronisation.
 */
import type { QueuedOp } from './ops'
import type { AppState } from './types'

const DB_NAME = 'hasbni'
const DB_VERSION = 1
const STORE_QUEUE = 'queue'
const STORE_CACHE = 'cache'
const SNAPSHOT_KEY = 'snapshot'

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB indisponible'))
      return
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE_QUEUE)) {
        db.createObjectStore(STORE_QUEUE, { keyPath: 'opId' })
      }
      if (!db.objectStoreNames.contains(STORE_CACHE)) {
        db.createObjectStore(STORE_CACHE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDB().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(store, mode)
        const request = run(transaction.objectStore(store))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        transaction.oncomplete = () => db.close()
      })
  )
}

// ── Instantane de l'etat ───────────────────────────────────────────────────

export async function saveSnapshot(state: AppState): Promise<void> {
  try {
    await tx(STORE_CACHE, 'readwrite', (s) => s.put(state, SNAPSHOT_KEY))
  } catch {
    /* stockage indisponible : on continue en memoire */
  }
}

export async function loadSnapshot(): Promise<AppState | null> {
  try {
    const value = await tx<AppState | undefined>(STORE_CACHE, 'readonly', (s) =>
      s.get(SNAPSHOT_KEY)
    )
    return value ?? null
  } catch {
    return null
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await tx(STORE_CACHE, 'readwrite', (s) => s.delete(SNAPSHOT_KEY))
  } catch {
    /* ignore */
  }
}

// ── File de synchronisation ────────────────────────────────────────────────

export async function enqueueOp(item: QueuedOp): Promise<void> {
  try {
    await tx(STORE_QUEUE, 'readwrite', (s) => s.put(item))
  } catch {
    /* ignore */
  }
}

export async function readQueue(): Promise<QueuedOp[]> {
  try {
    const items = await tx<QueuedOp[]>(STORE_QUEUE, 'readonly', (s) => s.getAll())
    return [...items].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  } catch {
    return []
  }
}

export async function dequeueOp(opId: string): Promise<void> {
  try {
    await tx(STORE_QUEUE, 'readwrite', (s) => s.delete(opId))
  } catch {
    /* ignore */
  }
}

export async function bumpAttempts(item: QueuedOp): Promise<void> {
  await enqueueOp({ ...item, attempts: item.attempts + 1 })
}

export async function clearQueue(): Promise<void> {
  try {
    await tx(STORE_QUEUE, 'readwrite', (s) => s.clear())
  } catch {
    /* ignore */
  }
}
