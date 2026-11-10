import type { Command, QueueStorage } from './types';

const STORE = 'queue';
const DB_VERSION = 1;

const wrap = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const open = (idb: IDBFactory, name: string): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = idb.open(name, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

/**
 * The offline queue in IndexedDB. The whole queue is one record, written in one transaction, so a crash
 * or a closed tab can never leave a half-written queue. It is keyed by user id: someone else signing in
 * on the same browser must never replay these changes under their own session.
 */
export function createIdbStorage(
  userId: string,
  idb: IDBFactory = indexedDB,
  dbName = 'room-calendar-sync',
): QueueStorage {
  let db: Promise<IDBDatabase> | undefined;
  const connection = () => (db ??= open(idb, dbName));
  const key = `queue:${userId}`;

  return {
    async load() {
      const database = await connection();
      const value = await wrap(database.transaction(STORE, 'readonly').objectStore(STORE).get(key));
      return Array.isArray(value) ? (value as Command[]) : [];
    },
    async save(queue) {
      const database = await connection();
      const tx = database.transaction(STORE, 'readwrite');
      if (queue.length === 0) tx.objectStore(STORE).delete(key);
      else tx.objectStore(STORE).put(JSON.parse(JSON.stringify(queue)), key);
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    },
  };
}
