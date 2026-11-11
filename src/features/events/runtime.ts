import type { QueryClient } from '@tanstack/react-query';
import type { CalEvent } from '@/shared/calendar';
import { eventKey } from '@/shared/calendar';
import type { CreateEventBody, EventDto, MutationResult, Scope } from '@/shared/contracts';
import {
  createSyncEngine,
  type Command,
  type Handlers,
  type QueueStorage,
  type Rejection,
  type Scheduler,
  type SyncEngine,
  type Transport,
} from '@/features/sync';
import { parseInstant, formatInstant } from '@/shared/zoned';
import {
  addOccurrence,
  mergeChange,
  patchOccurrence,
  removeOccurrences,
  settle,
  type Period,
} from './cache';
import { allPeriods, findByKey, occurrencesOfEvent, updatePeriods, versionOf } from './cache-ops';
import {
  amend,
  createBodyOf,
  emptyHistory,
  fieldsOf,
  popRedo,
  popUndo,
  record,
  type Entry,
  type History,
  type Intent,
} from './history';
import { keys } from './queries';

/** Something to tell the user. `code` is an i18n key under `errors.*` / `announce.*`; the UI translates it. */
export type Notice = {
  kind: 'error' | 'info';
  code: string;
  params?: Record<string, string | number>;
};
export type Notifier = {
  notify: (notice: Notice) => void;
  /** Screen-reader announcement (aria-live). */
  announce: (code: string, params?: Record<string, string | number>) => void;
};

export type RuntimeDeps = {
  client: QueryClient;
  storage: QueueStorage;
  transport: Transport;
  me: { id: string; name: string };
  userName: (userId: string) => string;
  notifier: Notifier;
  schedule?: Scheduler;
  newId?: () => string;
};

type Pending = { rollback: (p: Period) => Period; entryId?: string; label: string };

export type NewEvent = {
  roomId: string;
  title: string;
  start: number;
  end: number;
  allDay?: boolean;
  tzid: string;
  rrule?: string | null;
  attendeeIds?: string[];
  description?: string;
};
export type EventChange = {
  start?: number;
  end?: number;
  roomId?: string;
  title?: string;
  description?: string;
  attendeeIds?: string[];
  allDay?: boolean;
  /** For scope "all": the series' first occurrence before and after (see shiftSeriesTimes). */
  series?: { from: { start: number; end: number }; to: { start: number; end: number } };
};

export function createEventsRuntime(deps: RuntimeDeps) {
  const { client, notifier } = deps;
  const newId = deps.newId ?? (() => crypto.randomUUID());
  let history: History = emptyHistory;
  const historyListeners = new Set<() => void>();
  const pending = new Map<string, Pending>(); // by command id
  let seq = 0;
  const setHistory = (next: History) => {
    history = next;
    historyListeners.forEach((l) => l());
  };

  // --- cache helpers ------------------------------------------------------------------------------
  const creatorName = (id: string) => (id === deps.me.id ? deps.me.name : deps.userName(id));

  /** A function that puts one event's occurrences back to how they are right now (for rollback). */
  const snapshotEvent = (eventId: string): ((p: Period) => Period) => {
    const before = occurrencesOfEvent(client, eventId);
    return (p) => {
      const others = p.events.filter((e) => e.eventId !== eventId);
      const mine = before.filter((e) => e.start < p.to && e.end > p.from);
      return { ...p, events: [...others, ...mine].sort((a, b) => a.start - b.start) };
    };
  };
  const applyRollback = (rollback: (p: Period) => Period) => updatePeriods(client, rollback);

  // --- the engine ---------------------------------------------------------------------------------
  const handlers: Handlers = {
    onApplied: (command, result, { lastForEvent }) => {
      const entry = pending.get(command.id);
      pending.delete(command.id);
      if (entry?.entryId) learnFromResult(entry.entryId, command, result);
      if (lastForEvent) applyServerResult(result, command.eventId);
    },
    onRejected: (command, rejection) => {
      const entry = pending.get(command.id);
      pending.delete(command.id);
      if (entry) applyRollback(entry.rollback);
      if (entry?.entryId) dropEntry(entry.entryId);
      tell(rejection, entry?.label ?? '');
      // Reconcile with the truth (someone else's version, the blocking event...).
      if (rejection.kind === 'version-conflict' && rejection.current)
        applyServerResult({ events: [rejection.current], deletedEventIds: [] }, command.eventId);
      else void client.invalidateQueries({ queryKey: keys.periods });
    },
    onDiscarded: (commands, current) => {
      for (const c of commands) {
        const entry = pending.get(c.id);
        pending.delete(c.id);
        if (entry?.entryId) dropEntry(entry.entryId);
      }
      const eventId = commands[0]?.eventId;
      if (current) applyServerResult({ events: [current], deletedEventIds: [] }, current.id);
      else if (eventId) updatePeriods(client, (p) => removeOccurrences(p, { eventId }));
    },
  };
  /** Somebody else changed an event while I had unsent changes for it: refetch once the queue is empty. */
  let reconcileWhenIdle = false;
  const engine: SyncEngine = createSyncEngine(
    { storage: deps.storage, transport: deps.transport, schedule: deps.schedule },
    handlers,
  );
  engine.subscribe(() => {
    if (!reconcileWhenIdle || engine.getState().pending > 0) return;
    reconcileWhenIdle = false;
    void client.invalidateQueries({ queryKey: keys.periods });
  });

  function applyServerResult(result: MutationResult, eventId: string): void {
    updatePeriods(client, (p) => {
      const merged = mergeChange(
        p,
        { changed: result.events, deletedEventIds: result.deletedEventIds },
        creatorName,
      );
      if (merged.needsRefetch)
        void client.invalidateQueries({ queryKey: keys.period(p.from, p.to) });
      return settle(merged.period, eventId);
    });
  }

  function tell(rejection: Rejection, label: string): void {
    switch (rejection.kind) {
      case 'room-conflict': {
        const b = rejection.blockers[0];
        notifier.notify(
          b
            ? {
                kind: 'error',
                code: 'ROOM_CONFLICT',
                params: {
                  title: b.title,
                  creator: b.creator.name,
                  start: b.start,
                  end: b.end,
                  label,
                },
              }
            : { kind: 'error', code: 'ROOM_CONFLICT_GENERIC', params: { label } },
        );
        break;
      }
      case 'version-conflict':
        notifier.notify({ kind: 'error', code: 'VERSION_CONFLICT', params: { label } });
        break;
      case 'not-found':
        notifier.notify({ kind: 'error', code: 'NOT_FOUND', params: { label } });
        break;
      case 'invalid':
        notifier.notify({ kind: 'error', code: 'VALIDATION', params: { label } });
        break;
      default:
        notifier.notify({ kind: 'error', code: 'UNKNOWN', params: { label } });
    }
  }

  function learnFromResult(entryId: string, command: Command, result: MutationResult): void {
    // "Only this" creates a detached event with a server-chosen id: undo has to target THAT event.
    if (command.kind !== 'update' || command.body.scope !== 'this') return;
    const detached = result.events.find(
      (e) => e.seriesId === command.eventId && e.originalStart === command.body.occurrenceStart,
    );
    const entry =
      history.past.find((e) => e.id === entryId) ?? history.future.find((e) => e.id === entryId);
    if (!entry) return;
    setHistory(
      amend(
        history,
        entryId,
        detached && entry.undo?.kind === 'update'
          ? { undo: { ...entry.undo, eventId: detached.id }, awaiting: false }
          : { awaiting: false },
      ),
    );
  }

  const dropEntry = (entryId: string) =>
    setHistory({
      past: history.past.filter((e) => e.id !== entryId),
      future: history.future.filter((e) => e.id !== entryId),
    });

  // --- perform an intent: optimistic change + command ----------------------------------------------
  function toCommand(intent: Intent): Command {
    const base = { id: newId(), eventId: intent.eventId, queuedAt: Date.now(), offline: false };
    switch (intent.kind) {
      case 'create':
        return { ...base, kind: 'create', body: intent.body };
      case 'update':
        return {
          ...base,
          kind: 'update',
          baseVersion: versionOf(client, intent.eventId),
          body: intent.body,
        };
      case 'delete':
        return {
          ...base,
          kind: 'delete',
          baseVersion: versionOf(client, intent.eventId),
          scope: intent.scope,
          occurrenceStart: intent.occurrenceStart,
        };
    }
  }

  /**
   * The optimistic effect of an intent as a pure function of one period. The same function serves a live
   * action and the "overlay" that re-applies queued changes on top of freshly fetched server data.
   */
  function optimisticFn(intent: Intent, key?: string): (p: Period) => Period {
    switch (intent.kind) {
      case 'create': {
        const b = intent.body;
        const event: CalEvent = {
          key: eventKey(intent.eventId, b.startAt),
          eventId: intent.eventId,
          roomId: b.roomId,
          title: b.title,
          description: b.description ?? '',
          start: parseInstant(b.startAt) as number,
          end: parseInstant(b.endAt) as number,
          allDay: b.allDay ?? false,
          tzid: b.tzid ?? 'UTC',
          recurring: !!b.rrule,
          seriesId: null,
          version: 1,
          creatorId: deps.me.id,
          creatorName: deps.me.name,
          attendeeIds: b.attendeeIds ?? [],
        };
        return (p) =>
          p.events.some((e) => e.eventId === intent.eventId) ? p : addOccurrence(p, event);
      }
      case 'update': {
        const b = intent.body;
        const patch: Parameters<typeof patchOccurrence>[2] = {};
        if (b.startAt) patch.start = parseInstant(b.startAt) as number;
        if (b.endAt) patch.end = parseInstant(b.endAt) as number;
        if (b.roomId) patch.roomId = b.roomId;
        if (b.title !== undefined) patch.title = b.title;
        if (b.allDay !== undefined) patch.allDay = b.allDay;
        return (p) => {
          const mine = p.events.filter((e) => e.eventId === intent.eventId);
          if (mine.length === 0) return p;
          // A series edit cannot be drawn exactly without expanding the rule: mark it syncing, then refetch.
          if (b.scope === 'following' || (b.scope === 'all' && mine.length > 1)) {
            return {
              ...p,
              events: p.events.map((e) =>
                e.eventId === intent.eventId ? { ...e, sync: 'syncing' as const } : e,
              ),
            };
          }
          const target = key && mine.some((e) => e.key === key) ? key : (mine[0] as CalEvent).key;
          return patchOccurrence(p, target, patch);
        };
      }
      case 'delete':
        return (p) =>
          intent.scope === 'this' && key
            ? removeOccurrences(p, { key })
            : intent.scope === 'following' && intent.occurrenceStart
              ? removeOccurrences(p, {
                  eventId: intent.eventId,
                  fromStart: parseInstant(intent.occurrenceStart) as number,
                })
              : removeOccurrences(p, { eventId: intent.eventId });
    }
  }

  /**
   * Which occurrence a queued command is about. "Only this" edits and deletes name one occurrence of a
   * series; replaying them without it would hit the whole series (a delete would hide all of it).
   */
  const occurrenceKeyOf = (c: Command): string | undefined => {
    const start =
      c.kind === 'update'
        ? c.body.occurrenceStart
        : c.kind === 'delete'
          ? c.occurrenceStart
          : undefined;
    return start ? eventKey(c.eventId, start) : undefined;
  };

  const intentOf = (c: Command): Intent =>
    c.kind === 'create'
      ? { kind: 'create', eventId: c.eventId, body: c.body }
      : c.kind === 'update'
        ? { kind: 'update', eventId: c.eventId, body: c.body }
        : {
            kind: 'delete',
            eventId: c.eventId,
            scope: c.scope,
            occurrenceStart: c.occurrenceStart,
          };

  function perform(
    intent: Intent,
    opts: { key?: string; label: string; entry?: Entry; skipHistory?: boolean },
  ): void {
    const rollback = snapshotEvent(intent.eventId);
    updatePeriods(client, optimisticFn(intent, opts.key));
    const command = toCommand(intent);
    pending.set(command.id, { rollback, entryId: opts.entry?.id, label: opts.label });
    void engine.enqueue(command);
  }

  const record_ = (entry: Entry) => setHistory(record(history, entry));
  const entryId = () => `h${++seq}`;

  // --- public actions -------------------------------------------------------------------------------
  const actions = {
    create(input: NewEvent): string {
      const id = newId();
      const body: CreateEventBody = {
        id,
        roomId: input.roomId,
        title: input.title,
        description: input.description ?? '',
        startAt: formatInstant(input.start),
        endAt: formatInstant(input.end),
        allDay: input.allDay ?? false,
        tzid: input.tzid,
        rrule: input.rrule ?? null,
        attendeeIds: input.attendeeIds ?? [],
      };
      const entry: Entry = {
        id: entryId(),
        label: input.title,
        undo: { kind: 'delete', eventId: id },
        redo: { kind: 'create', eventId: id, body },
      };
      record_(entry);
      perform({ kind: 'create', eventId: id, body }, { label: input.title, entry });
      notifier.announce('created', { title: input.title });
      return id;
    },

    /** Moves and/or resizes and/or renames one occurrence. `scope` is needed for a recurring one. */
    change(event: CalEvent, change: EventChange, scope?: Scope): void {
      const body: Extract<Intent, { kind: 'update' }>['body'] = {};
      const undoBody: typeof body = {};
      if (change.start !== undefined && change.end !== undefined) {
        // Editing a whole series ("all") speaks about the series' FIRST occurrence, not the one dragged.
        const wholeSeries = scope === 'all' && event.recurring && change.series;
        const to = wholeSeries ? change.series!.to : { start: change.start, end: change.end };
        const from = wholeSeries ? change.series!.from : { start: event.start, end: event.end };
        body.startAt = formatInstant(to.start);
        body.endAt = formatInstant(to.end);
        undoBody.startAt = formatInstant(from.start);
        undoBody.endAt = formatInstant(from.end);
      }
      if (change.roomId !== undefined) {
        body.roomId = change.roomId;
        undoBody.roomId = event.roomId;
      }
      if (change.title !== undefined) {
        body.title = change.title;
        undoBody.title = event.title;
      }
      if (change.description !== undefined) {
        body.description = change.description;
        undoBody.description = event.description;
      }
      if (change.attendeeIds !== undefined) {
        body.attendeeIds = change.attendeeIds;
        undoBody.attendeeIds = [...event.attendeeIds];
      }
      if (change.allDay !== undefined) {
        body.allDay = change.allDay;
        undoBody.allDay = event.allDay;
      }
      const recurring = event.recurring && scope !== undefined;
      if (recurring) {
        body.scope = scope;
        if (scope !== 'all') body.occurrenceStart = formatInstant(event.start);
        undoBody.scope = scope === 'all' ? 'all' : undefined;
      }
      const label = change.title ?? event.title;
      const undoable = !recurring || scope === 'this' || scope === 'all';
      const entry: Entry = {
        id: entryId(),
        label,
        undo: undoable ? { kind: 'update', eventId: event.eventId, body: undoBody } : null,
        redo: { kind: 'update', eventId: event.eventId, body },
        // The undo above would address the whole series until the server names the detached event.
        ...(recurring && scope === 'this' ? { awaiting: true } : {}),
      };
      record_(entry);
      perform({ kind: 'update', eventId: event.eventId, body }, { key: event.key, label, entry });
      notifier.announce(
        change.roomId !== undefined && change.roomId !== event.roomId
          ? 'movedRoom'
          : change.start !== undefined &&
              change.end !== undefined &&
              change.end - change.start !== event.end - event.start
            ? 'resized'
            : 'moved',
        { title: label },
      );
    },

    remove(event: CalEvent, scope?: Scope, snapshot?: EventDto): void {
      const recurring = event.recurring && scope !== undefined;
      const intent: Intent = {
        kind: 'delete',
        eventId: event.eventId,
        scope: recurring ? scope : undefined,
        occurrenceStart: recurring && scope !== 'all' ? formatInstant(event.start) : undefined,
      };
      // Undo re-creates the event with its own id; possible when we know the whole event (not for a single occurrence of a series).
      const undo: Intent | null =
        snapshot && (!recurring || scope === 'all')
          ? { kind: 'create', eventId: event.eventId, body: createBodyOf(snapshot) }
          : null;
      const entry: Entry = { id: entryId(), label: event.title, undo, redo: intent };
      record_(entry);
      perform(intent, { key: event.key, label: event.title, entry });
      notifier.announce('deleted', { title: event.title });
    },

    undo(): void {
      const top = history.past[history.past.length - 1];
      if (top?.awaiting) {
        // Not popped: the entry stays, and works as soon as the server has answered.
        notifier.notify({ kind: 'info', code: 'UNDO_WAIT', params: { label: top.label } });
        return;
      }
      const popped = popUndo(history);
      if (!popped) return;
      setHistory(popped.history);
      const { entry } = popped;
      if (!entry.undo) {
        notifier.notify({ kind: 'info', code: 'CANNOT_UNDO', params: { label: entry.label } });
        return;
      }
      perform(entry.undo, { label: entry.label });
      notifier.announce('undone', { title: entry.label });
    },

    redo(): void {
      const popped = popRedo(history);
      if (!popped) return;
      setHistory(popped.history);
      perform(popped.entry.redo, { label: popped.entry.label });
      notifier.announce('redone', { title: popped.entry.label });
    },
  };

  return {
    engine,
    actions,
    history: {
      get: () => history,
      subscribe: (l: () => void) => (
        historyListeners.add(l),
        () => void historyListeners.delete(l)
      ),
    },
    /** Called for changes made by OTHER people (SSE); skips events we still have unsent changes for. */
    applyRemote(message: { changed: EventDto[]; deletedEventIds: string[] }): void {
      const mine = (id: string) => engine.pendingFor(id);
      const changed = message.changed.filter((e) => !mine(e.id));
      const deleted = message.deletedEventIds.filter((id) => !mine(id));
      // What somebody else did to an event I still have unsent changes for is not drawn now (it would
      // overwrite my pending version), but it must not be lost either: reconcile with the server as
      // soon as my changes are through (see the engine subscription above).
      if (
        changed.length < message.changed.length ||
        deleted.length < message.deletedEventIds.length
      )
        reconcileWhenIdle = true;
      if (changed.length === 0 && deleted.length === 0) return;
      updatePeriods(client, (p) => {
        const merged = mergeChange(p, { changed, deletedEventIds: deleted }, creatorName);
        if (merged.needsRefetch)
          void client.invalidateQueries({ queryKey: keys.period(p.from, p.to) });
        return merged.period;
      });
    },
    /** Puts still-unsent changes on top of a freshly fetched period, so a refetch or reload never hides them. */
    overlay: (period: Period): Period =>
      engine
        .pendingCommands()
        .reduce((p, c) => optimisticFn(intentOf(c), occurrenceKeyOf(c))(p), period),
    /** Re-draws queued changes after the queue was loaded from storage (page reload). */
    restoreFromQueue(): void {
      for (const c of engine.pendingCommands())
        updatePeriods(client, optimisticFn(intentOf(c), occurrenceKeyOf(c)));
    },
    findByKey: (key: string) => findByKey(client, key),
    periods: () => allPeriods(client),
    fieldsOf,
  };
}

export type EventsRuntime = ReturnType<typeof createEventsRuntime>;
