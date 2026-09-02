// Crash-safe autosave.
//
// The project is written to IndexedDB a moment after every change, so closing
// the tab, a crash, or a power cut costs at most a few seconds of work. This is
// a safety net, not a filing system: the user's real save is still an explicit
// `.assayplot` file, and the recovery snapshot is cleared once they save.
//
// IndexedDB rather than localStorage because a project with a large imported
// table will exceed the ~5 MB localStorage quota, and exceeding it throws.

import { type Project } from './model.ts';
import { migrate } from './io.ts';

const DATABASE = 'assayplot';
const STORE = 'recovery';
const KEY = 'current';
const VERSION = 1;

export interface Snapshot {
  project: Project;
  savedAt: string;
  /** False once the user has saved to a real file, so we stop offering it. */
  dirty: boolean;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = run(transaction.objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed.'));
    });
  } finally {
    database.close();
  }
}

/**
 * Every storage call is wrapped: a private window, a full disk, or a browser
 * with site data blocked must degrade to "no autosave", never to a broken app.
 */
export async function writeSnapshot(project: Project, dirty: boolean): Promise<boolean> {
  try {
    const snapshot: Snapshot = { project, savedAt: new Date().toISOString(), dirty };
    await withStore('readwrite', (store) => store.put(snapshot, KEY) as IDBRequest<any>);
    return true;
  } catch {
    return false;
  }
}

export async function readSnapshot(): Promise<Snapshot | null> {
  try {
    const raw = await withStore<Snapshot | undefined>('readonly', (store) => store.get(KEY));
    if (!raw?.project) return null;
    // A snapshot written by an older version still has to open.
    return { ...raw, project: migrate(raw.project) };
  } catch {
    return null;
  }
}

export async function clearSnapshot(): Promise<void> {
  try {
    await withStore('readwrite', (store) => store.delete(KEY) as IDBRequest<any>);
  } catch {
    // Nothing to do: a snapshot we cannot clear is harmless, it is only ever
    // offered when it is newer than the session that is starting.
  }
}

/**
 * Calls `run` at most once per `delay`, and always once more after the last
 * change. Trailing-edge matters here: the final edit before a crash is exactly
 * the one worth keeping.
 */
export function debounce<T extends (...args: any[]) => void>(run: T, delay: number): T & { flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: any[] | null = null;

  const wrapped = ((...args: any[]) => {
    pending = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      const call = pending;
      pending = null;
      if (call) run(...call);
    }, delay);
  }) as T & { flush: () => void };

  wrapped.flush = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    const call = pending;
    pending = null;
    if (call) run(...call);
  };

  return wrapped;
}
