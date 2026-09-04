import { type Project } from './model.ts';
import { migrate } from './io.ts';

const DATABASE = 'assayplot';
const STORE = 'recovery';
const KEY = 'current';

export interface Snapshot {
  project: Project;
  savedAt: string;
  dirty: boolean;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * The single point where storage failure is handled. A private window, a full
 * disk, or a browser set to block site data all make IndexedDB throw, and none
 * of them should stop the app working — they only cost the safety net.
 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>
): Promise<{ ok: true; value: T } | { ok: false }> {
  let database: IDBDatabase;
  try {
    database = await openDatabase();
    const value = await new Promise<T>((resolve, reject) => {
      const request = run(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

export async function writeSnapshot(project: Project, dirty: boolean): Promise<boolean> {
  const snapshot: Snapshot = { project, savedAt: new Date().toISOString(), dirty };
  const result = await withStore('readwrite', (store) => store.put(snapshot, KEY) as IDBRequest<unknown>);
  return result.ok;
}

export async function readSnapshot(): Promise<Snapshot | null> {
  const result = await withStore<Snapshot | undefined>('readonly', (store) => store.get(KEY));
  if (!result.ok || !result.value?.project) return null;
  return { ...result.value, project: migrate(result.value.project) };
}

export async function clearSnapshot(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(KEY) as IDBRequest<unknown>);
}
