import type { EventDto, MutationResult } from '@/shared/contracts';
import type { Command, QueueStorage, SendResult, Transport } from './types';

/** In-memory queue storage; `reload()` models a page reload (a new engine reading the same storage). */
export function memoryStorage(
  initial: Command[] = [],
): QueueStorage & { snapshot: () => Command[]; failNextSaves: (n: number) => void } {
  let data = [...initial];
  let failures = 0;
  return {
    load: async () => structuredClone(data),
    save: async (queue) => {
      if (failures > 0) {
        failures -= 1;
        throw new Error('quota exceeded');
      }
      data = structuredClone([...queue]);
    },
    snapshot: () => structuredClone(data),
    failNextSaves: (n) => void (failures = n),
  };
}

/** Controllable time: `advance` runs scheduled callbacks that are due. */
export function fakeScheduler() {
  let time = 0;
  let nextId = 1;
  const tasks = new Map<number, { at: number; run: () => void }>();
  return {
    schedule: (run: () => void, delay: number) => {
      const id = nextId++;
      tasks.set(id, { at: time + delay, run });
      return () => void tasks.delete(id);
    },
    advance: async (ms: number) => {
      time += ms;
      for (const [id, t] of [...tasks].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= time) {
          tasks.delete(id);
          t.run();
          await Promise.resolve();
        }
      }
    },
    pending: () => [...tasks.values()].map((t) => t.at - time).sort((a, b) => a - b),
  };
}

const dto = (id: string, version: number, over: Partial<EventDto> = {}): EventDto => ({
  id,
  roomId: 'room-1',
  title: 'T',
  description: '',
  startAt: '2026-12-01T10:00:00Z',
  endAt: '2026-12-01T11:00:00Z',
  allDay: false,
  tzid: 'UTC',
  rrule: null,
  exdates: [],
  seriesId: null,
  originalStart: null,
  version,
  creatorId: 'u1',
  attendeeIds: [],
  ...over,
});

export type Applied = {
  commandId: string;
  kind: Command['kind'];
  eventId: string;
  version: number;
};

/**
 * A server model with the real rules: optimistic versions, idempotent creates by client id, 404 for
 * missing events. Failures are injected by the test: `network` (request lost) and `dropResponse`
 * (the server APPLIES the change but the answer never arrives, the nastiest case for a retrying client).
 */
export function fakeServer() {
  const events = new Map<string, EventDto>();
  const applied: Applied[] = [];
  const log: { commandId: string; version: number }[] = [];
  let script: Array<'network' | 'drop-response' | 'ok' | 'unauthenticated'> = [];
  let sends = 0;

  const apply = (c: Command, version: number): SendResult => {
    if (c.kind === 'create') {
      const existing = events.get(c.eventId);
      if (existing)
        return { type: 'ok', result: { events: [existing], deletedEventIds: [], replayed: true } };
      const b = c.body;
      const created = dto(c.eventId, 1, {
        title: b.title,
        roomId: b.roomId,
        description: b.description ?? '',
        startAt: b.startAt,
        endAt: b.endAt,
        allDay: b.allDay ?? false,
        tzid: b.tzid ?? 'UTC',
        rrule: b.rrule ?? null,
        attendeeIds: b.attendeeIds ?? [],
      });
      events.set(c.eventId, created);
      applied.push({ commandId: c.id, kind: 'create', eventId: c.eventId, version: 1 });
      return { type: 'ok', result: { events: [created], deletedEventIds: [] } };
    }
    const current = events.get(c.eventId);
    if (!current) return { type: 'not-found' };
    if (current.version !== version) return { type: 'version-conflict', current };
    if (c.kind === 'delete') {
      events.delete(c.eventId);
      applied.push({ commandId: c.id, kind: 'delete', eventId: c.eventId, version });
      return { type: 'ok', result: { events: [], deletedEventIds: [c.eventId] } };
    }
    const fields = Object.fromEntries(
      Object.entries(c.body).filter(([k]) => k !== 'scope' && k !== 'occurrenceStart'),
    );
    const updated = { ...current, ...fields, version: current.version + 1 } as EventDto;
    events.set(c.eventId, updated);
    applied.push({ commandId: c.id, kind: 'update', eventId: c.eventId, version: updated.version });
    return { type: 'ok', result: { events: [updated], deletedEventIds: [] } };
  };

  const transport: Transport = {
    send: async (command, version) => {
      sends += 1;
      log.push({ commandId: command.id, version });
      const step = script.shift() ?? 'ok';
      if (step === 'network') return { type: 'network' };
      if (step === 'unauthenticated') return { type: 'unauthenticated' };
      const result = apply(command, version);
      return step === 'drop-response' ? { type: 'network' } : result;
    },
  };
  return {
    transport,
    events,
    applied,
    log,
    /** The next sends behave like this, in order; after that everything works. */
    script: (...steps: typeof script) => void (script = steps),
    sends: () => sends,
    /** Somebody else edits the event directly on the server. */
    editBySomeoneElse: (id: string, patch: Partial<EventDto>) => {
      const e = events.get(id) as EventDto;
      events.set(id, { ...e, ...patch, version: e.version + 1 });
    },
    seed: (id: string, version = 1, over: Partial<EventDto> = {}) =>
      void events.set(id, dto(id, version, over)),
  };
}

let counter = 0;
export const cmdId = () => `c${++counter}`;
export const update = (
  eventId: string,
  baseVersion: number,
  body: Record<string, unknown> = { title: 'x' },
): Command =>
  ({
    id: cmdId(),
    kind: 'update',
    eventId,
    baseVersion,
    body,
    queuedAt: 0,
    offline: false,
  }) as Command;
export const remove = (eventId: string, baseVersion: number): Command => ({
  id: cmdId(),
  kind: 'delete',
  eventId,
  baseVersion,
  queuedAt: 0,
  offline: false,
});
export const create = (eventId: string, title = 'new'): Command =>
  ({
    id: cmdId(),
    kind: 'create',
    eventId,
    body: {
      id: eventId,
      roomId: 'room-1',
      title,
      startAt: '2026-12-01T10:00:00Z',
      endAt: '2026-12-01T11:00:00Z',
    },
    queuedAt: 0,
    offline: false,
  }) as Command;

export type { MutationResult };
