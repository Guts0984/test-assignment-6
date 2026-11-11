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

/** A tab's identity: kept in sessionStorage, so it survives a reload of the tab but is not shared with other tabs. */
function tabIdOf(): string {
  try {
    const known = sessionStorage.getItem('room-calendar-tab');
    if (known) return known;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem('room-calendar-tab', fresh);
    return fresh;
  } catch {
    return 'single-tab'; // no sessionStorage (tests, odd environments): one tab, stable across "reloads"
  }
}

const LOCK_PREFIX = 'room-calendar-tab:';

/** Tab ids that are open right now. While a tab lives it holds a Web Lock named after itself. */
async function liveTabs(): Promise<Set<string> | null> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return null; // unknown: do not touch other tabs' queues
  const { held } = await locks.query();
  return new Set(
    (held ?? [])
      .map((l) => l.name ?? '')
      .filter((n) => n.startsWith(LOCK_PREFIX))
      .map((n) => n.slice(LOCK_PREFIX.length)),
  );
}

/**
 * The offline queue in IndexedDB, written in one transaction per save, so a crash or a closed tab can
 * never leave a half-written queue. It is keyed by user id (someone else signing in on the same browser
 * must never replay these changes under their own session) AND by tab: every tab writes only its own
 * record. With one shared record, two open tabs overwrote each other's unsent changes. A tab that finds
 * records of tabs that are gone (closed with changes still waiting) adopts and sends them.
 */
export function createIdbStorage(
  userId: string,
  idb: IDBFactory = indexedDB,
  dbName = 'room-calendar-sync',
): QueueStorage {
  let db: Promise<IDBDatabase> | undefined;
  const connection = () => (db ??= open(idb, dbName));
  const tabId = tabIdOf();
  const prefix = `queue:${userId}:`;
  const mine = `${prefix}${tabId}`;
  const legacy = `queue:${userId}`; // the single record of earlier versions
  // For as long as this tab lives, hold a lock that says so (never released by us; the browser frees it).
  if (typeof navigator !== 'undefined' && navigator.locks) {
    void navigator.locks.request(`${LOCK_PREFIX}${tabId}`, () => new Promise<never>(() => {}));
  }

  const done = (tx: IDBTransaction) =>
    new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  const commandsOf = (value: unknown): Command[] =>
    Array.isArray(value) ? (value as Command[]) : [];

  return {
    async load() {
      const database = await connection();
      const alive = await liveTabs();
      const tx = database.transaction(STORE, 'readwrite');
      const store = tx.objectStore(STORE);
      const keys = (await wrap(
        store.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)),
      )) as string[];
      const own = commandsOf(await wrap(store.get(mine)));
      const adopted: Command[] = [];
      // Records of tabs that are no longer open (and the old single record): take their changes over.
      const orphans = keys.filter(
        (k) => k !== mine && alive !== null && !alive.has(k.slice(prefix.length)),
      );
      if (alive !== null) orphans.push(legacy);
      for (const k of orphans) {
        adopted.push(...commandsOf(await wrap(store.get(k))));
        store.delete(k);
      }
      const merged = [...own, ...adopted].sort((a, b) => a.queuedAt - b.queuedAt);
      if (adopted.length > 0) store.put(JSON.parse(JSON.stringify(merged)), mine);
      await done(tx);
      return merged;
    },
    async save(queue) {
      const database = await connection();
      const tx = database.transaction(STORE, 'readwrite');
      if (queue.length === 0) tx.objectStore(STORE).delete(mine);
      else tx.objectStore(STORE).put(JSON.parse(JSON.stringify(queue)), mine);
      await done(tx);
    },
  };
}
