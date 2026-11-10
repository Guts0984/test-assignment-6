import type { EventDto } from '@/shared/contracts';
import type {
  Command,
  Conflict,
  Handlers,
  QueueStorage,
  SendResult,
  SyncState,
  Transport,
  UpdateCommand,
} from './types';

export type Scheduler = (run: () => void, delayMs: number) => () => void;

export type EngineDeps = {
  storage: QueueStorage;
  transport: Transport;
  /** setTimeout-like; returns a cancel function. Injected so tests can control time. */
  schedule?: Scheduler;
  now?: () => number;
};

const defaultSchedule: Scheduler = (run, ms) => {
  const id = setTimeout(run, ms);
  return () => clearTimeout(id);
};

export const RETRY_BASE_MS = 2_000;
export const RETRY_MAX_MS = 30_000;
export const retryDelay = (failures: number): number =>
  Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, failures - 1));

const sameSet = (a: readonly string[] = [], b: readonly string[] = []) =>
  a.length === b.length && [...a].sort().every((v, i) => v === [...b].sort()[i]);

/**
 * Did the server already apply this change? After a lost response we retry, and the retry looks like a
 * version conflict whose "current" state already equals what we wanted. Only whole-event updates can be
 * judged this way; scoped series edits cannot.
 */
export function isAlreadyApplied(command: UpdateCommand, current: EventDto | null): boolean {
  if (!current || (command.body.scope && command.body.scope !== 'all')) return false;
  const entries = Object.entries(command.body).filter(
    ([k, v]) => v !== undefined && k !== 'scope' && k !== 'occurrenceStart',
  );
  if (entries.length === 0) return false;
  return entries.every(([key, wanted]) => {
    const have = (current as Record<string, unknown>)[key];
    return key === 'attendeeIds' ? sameSet(wanted as string[], have as string[]) : have === wanted;
  });
}

/**
 * The offline-capable command queue.
 *
 *  - Commands are sent strictly one at a time, in the order they were made.
 *  - Every change to the queue is persisted before anything else happens, so it survives a reload.
 *  - Version chaining: the first command for an event is sent with the version the user saw (so somebody
 *    else's change is DETECTED); later commands for the same event use the version returned by the
 *    previous one (so quick successive edits of ONE event do not conflict with each other).
 *  - A network failure parks the queue and retries with exponential backoff, or at once when the
 *    browser reports the network is back.
 */
export function createSyncEngine(deps: EngineDeps, handlers: Handlers = {}) {
  const schedule = deps.schedule ?? defaultSchedule;
  const now = deps.now ?? Date.now;

  let queue: Command[] = [];
  let online = true;
  let signedOut = false;
  let flushing = false;
  let rerun = false;
  let rerunProbe = false;
  let conflict: Conflict | null = null;
  let storageFailed = false;
  let failures = 0;
  let cancelRetry: (() => void) | null = null;
  const chain = new Map<string, number>();
  const listeners = new Set<() => void>();
  const idleWaiters: Array<() => void> = [];
  let snapshot: SyncState = { status: 'saved', pending: 0, conflict: null, storageFailed: false };

  const statusNow = (): SyncState['status'] =>
    signedOut
      ? 'signed-out'
      : conflict
        ? 'conflict'
        : !online
          ? 'offline'
          : queue.length > 0
            ? 'syncing'
            : 'saved';

  const notify = () => {
    const next: SyncState = { status: statusNow(), pending: queue.length, conflict, storageFailed };
    if (
      next.status !== snapshot.status ||
      next.pending !== snapshot.pending ||
      next.conflict !== snapshot.conflict ||
      next.storageFailed !== snapshot.storageFailed
    ) {
      snapshot = next;
      listeners.forEach((l) => l());
    }
    if (!flushing && (queue.length === 0 || conflict || !online || signedOut))
      idleWaiters.splice(0).forEach((resolve) => resolve());
  };

  const persist = async () => {
    try {
      await deps.storage.save(queue);
      storageFailed = false;
    } catch {
      storageFailed = true; // keep working in memory; the UI warns that a reload would lose changes
    }
  };

  const versionFor = (c: Command): number =>
    c.kind === 'create' ? 1 : (chain.get(c.eventId) ?? c.baseVersion);

  const removeHead = async (command: Command) => {
    queue = queue.filter((c) => c.id !== command.id);
    await persist();
  };

  const dropDependents = async (command: Command): Promise<Command[]> => {
    const dropped = queue.filter((c) => c.eventId === command.eventId && c.id !== command.id);
    if (dropped.length > 0) {
      queue = queue.filter((c) => c.eventId !== command.eventId || c.id === command.id);
      await persist();
    }
    return dropped;
  };

  const pendingFor = (eventId: string) => queue.some((c) => c.eventId === eventId);

  const rememberVersion = (
    command: Command,
    result: Extract<SendResult, { type: 'ok' }>['result'],
  ) => {
    const dto = result.events.find((e) => e.id === command.eventId);
    if (dto) chain.set(command.eventId, dto.version);
    else if (result.deletedEventIds.includes(command.eventId)) chain.delete(command.eventId);
  };

  const scheduleRetry = () => {
    cancelRetry?.();
    failures += 1;
    cancelRetry = schedule(() => {
      cancelRetry = null;
      void flush(true);
    }, retryDelay(failures));
  };

  /**
   * Sends queued commands until the queue is empty or something stops it. If `flush` is requested while
   * one is already running (e.g. "back online" arrives while the previous attempt is still finishing),
   * the running one loops again instead of ignoring the request: a lost wake-up would leave the queue
   * stuck with nothing scheduled.
   */
  async function flush(probe = false): Promise<void> {
    if (flushing) {
      rerun = true;
      rerunProbe ||= probe;
      return;
    }
    flushing = true;
    let probing = probe;
    try {
      do {
        rerun = false;
        if (rerunProbe) probing = true;
        rerunProbe = false;
        if (conflict || signedOut || (!online && !probing)) break;
        if (probing) {
          online = true; // optimistic: a failing attempt flips it back
          probing = false;
        }
        notify();
        while (queue.length > 0 && online && !conflict && !signedOut) {
          const command = queue[0] as Command;
          let result: SendResult;
          try {
            result = await deps.transport.send(command, versionFor(command));
          } catch {
            result = { type: 'error', status: 0, code: 'TRANSPORT_FAILED' };
          }
          if (await handle(command, result)) break;
        }
      } while (rerun);
    } finally {
      flushing = false;
      if (queue.length === 0) chain.clear();
      notify();
    }
  }

  /** Decides what a send outcome means. Returns true when the loop must stop. */
  async function handle(command: Command, r: SendResult): Promise<boolean> {
    switch (r.type) {
      case 'ok': {
        failures = 0;
        rememberVersion(command, r.result);
        await removeHead(command);
        handlers.onApplied?.(command, r.result, { lastForEvent: !pendingFor(command.eventId) });
        return false;
      }
      case 'network': {
        online = false;
        queue = queue.map((c) => (c.id === command.id ? ({ ...c, offline: true } as Command) : c));
        await persist();
        // The network may have come back while we were persisting: then just try again right away.
        if (online) return false;
        scheduleRetry();
        return true;
      }
      case 'unauthenticated': {
        signedOut = true;
        return true;
      }
      case 'version-conflict': {
        if (command.kind === 'update' && isAlreadyApplied(command, r.current)) {
          await removeHead(command);
          const current = r.current as EventDto;
          chain.set(command.eventId, current.version);
          handlers.onApplied?.(
            command,
            { events: [current], deletedEventIds: [] },
            { lastForEvent: !pendingFor(command.eventId) },
          );
          return false;
        }
        if (command.offline && command.kind !== 'create') {
          conflict = { command, current: r.current };
          return true; // wait for the user
        }
        await removeHead(command);
        handlers.onRejected?.(command, { kind: 'version-conflict', current: r.current });
        return false;
      }
      case 'room-conflict': {
        await removeHead(command);
        if (command.kind === 'create') await dropDependents(command);
        handlers.onRejected?.(command, { kind: 'room-conflict', blockers: r.blockers });
        return false;
      }
      case 'not-found': {
        await removeHead(command);
        if (command.kind === 'delete') {
          // Already gone (maybe by an earlier delete of ours): the goal is reached.
          handlers.onApplied?.(
            command,
            { events: [], deletedEventIds: [command.eventId] },
            { lastForEvent: !pendingFor(command.eventId) },
          );
        } else {
          await dropDependents(command);
          handlers.onRejected?.(command, { kind: 'not-found' });
        }
        return false;
      }
      case 'invalid':
      case 'error': {
        await removeHead(command);
        if (command.kind === 'create') await dropDependents(command);
        handlers.onRejected?.(
          command,
          r.type === 'invalid'
            ? { kind: 'invalid', details: r.details }
            : { kind: 'error', status: r.status, code: r.code },
        );
        return false;
      }
    }
  }

  return {
    /** Loads what a previous page lifetime left in storage. Those changes count as "made offline". */
    async start(): Promise<void> {
      const stored = await deps.storage.load();
      const known = new Set(queue.map((c) => c.id));
      queue = [
        ...stored.filter((c) => !known.has(c.id)).map((c) => ({ ...c, offline: true }) as Command),
        ...queue,
      ];
      notify();
      void flush();
    },

    /** Queues a change. It is persisted first, then sent as soon as the network allows. */
    async enqueue(
      command: Omit<Command, 'queuedAt' | 'offline'> &
        Partial<Pick<Command, 'queuedAt' | 'offline'>>,
    ): Promise<void> {
      queue = [
        ...queue,
        {
          ...command,
          queuedAt: command.queuedAt ?? now(),
          offline: command.offline === true || !online,
        } as Command,
      ];
      notify(); // the indicator reacts at once...
      await persist(); // ...the queue is on disk before anything is sent...
      notify(); // ...and the state reflects whether saving worked
      void flush();
    },

    /** The browser says the network went away or came back. */
    setOnline(next: boolean): void {
      if (online === next) return;
      online = next;
      if (!next) cancelRetry?.();
      notify();
      if (next) {
        cancelRetry?.();
        failures = 0;
        void flush();
      }
    },

    /** The session is valid again. */
    resumeAfterSignIn(): void {
      signedOut = false;
      notify();
      void flush();
    },

    /** The user's answer for a conflicting offline change. */
    async resolveConflict(choice: 'mine' | 'server'): Promise<void> {
      if (!conflict) return;
      const { command, current } = conflict;
      conflict = null;
      if (choice === 'mine') {
        // Re-apply on top of the server's current version; the user has seen both sides now.
        const version = current?.version ?? command.baseVersion;
        queue = queue.map((c) =>
          c.id === command.id ? ({ ...c, baseVersion: version, offline: false } as Command) : c,
        );
        chain.delete(command.eventId);
        await persist();
      } else {
        const dropped = [command, ...(await dropDependents(command))];
        await removeHead(command);
        chain.delete(command.eventId);
        handlers.onDiscarded?.(dropped, current);
      }
      notify();
      void flush();
    },

    getState: (): SyncState => snapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    pendingFor,
    pendingCommands: (): readonly Command[] => queue,
    /** Resolves when nothing more can happen right now: queue empty, offline, blocked or signed out. */
    whenIdle: (): Promise<void> =>
      !flushing && (queue.length === 0 || conflict || !online || signedOut)
        ? Promise.resolve()
        : new Promise((resolve) => idleWaiters.push(resolve)),
  };
}

export type SyncEngine = ReturnType<typeof createSyncEngine>;
