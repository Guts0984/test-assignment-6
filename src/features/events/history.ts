import type { CreateEventBody, EventDto, Scope, UpdateEventBody } from '@/shared/contracts';

/**
 * What the user did, as something that can be done again. Undo and redo re-issue these through the same
 * pipeline as any other change (optimistic update, offline queue, server), so "undo" is synced too.
 */
export type Intent =
  | { kind: 'create'; eventId: string; body: CreateEventBody }
  | { kind: 'update'; eventId: string; body: Omit<UpdateEventBody, 'version'> }
  | { kind: 'delete'; eventId: string; scope?: Scope; occurrenceStart?: string };

export type Entry = {
  id: string;
  /** Short description for announcements: "Moved Standup". */
  label: string;
  /** How to reverse it; null when it cannot be reversed (e.g. a series split). */
  undo: Intent | null;
  redo: Intent;
};

export type History = { past: readonly Entry[]; future: readonly Entry[] };

export const HISTORY_LIMIT = 20;
export const emptyHistory: History = { past: [], future: [] };

/** Records a new action. It forgets what could be redone, and the oldest action beyond the limit. */
export const record = (h: History, entry: Entry): History => ({
  past: [...h.past, entry].slice(-HISTORY_LIMIT),
  future: [],
});

/** Takes the latest action to undo it. An action that cannot be undone is dropped from the history. */
export function popUndo(h: History): { entry: Entry; history: History } | null {
  const entry = h.past[h.past.length - 1];
  if (!entry) return null;
  const past = h.past.slice(0, -1);
  return { entry, history: { past, future: entry.undo ? [...h.future, entry] : h.future } };
}

export function popRedo(h: History): { entry: Entry; history: History } | null {
  const entry = h.future[h.future.length - 1];
  if (!entry) return null;
  return {
    entry,
    history: { past: [...h.past, entry].slice(-HISTORY_LIMIT), future: h.future.slice(0, -1) },
  };
}

/** Fills in what was unknown when the action was recorded (e.g. the id the server gave a detached event). */
export const amend = (h: History, id: string, patch: Partial<Omit<Entry, 'id'>>): History => {
  const apply = (list: readonly Entry[]) => list.map((e) => (e.id === id ? { ...e, ...patch } : e));
  return { past: apply(h.past), future: apply(h.future) };
};

/** The fields of an event that an update can change, read from the event itself. */
export const fieldsOf = (
  e: Pick<
    EventDto,
    'roomId' | 'title' | 'description' | 'startAt' | 'endAt' | 'allDay' | 'rrule' | 'attendeeIds'
  >,
) => ({
  roomId: e.roomId,
  title: e.title,
  description: e.description,
  startAt: e.startAt,
  endAt: e.endAt,
  allDay: e.allDay,
  rrule: e.rrule,
  attendeeIds: [...e.attendeeIds],
});

/** The body that re-creates an event exactly as it was (same id), for undoing a delete. */
export const createBodyOf = (e: EventDto): CreateEventBody => ({
  id: e.id,
  tzid: e.tzid,
  ...fieldsOf(e),
});

/** An event as the server would describe it, rebuilt from what the calendar shows (single events only). */
export const snapshotOf = (
  e: {
    eventId: string;
    roomId: string;
    title: string;
    description: string;
    start: number;
    end: number;
    allDay: boolean;
    tzid: string;
    seriesId: string | null;
    version: number;
    creatorId: string;
    attendeeIds: string[];
  },
  iso: (ms: number) => string,
): EventDto => ({
  id: e.eventId,
  roomId: e.roomId,
  title: e.title,
  description: e.description,
  startAt: iso(e.start),
  endAt: iso(e.end),
  allDay: e.allDay,
  tzid: e.tzid,
  rrule: null,
  exdates: [],
  seriesId: e.seriesId,
  originalStart: null,
  version: e.version,
  creatorId: e.creatorId,
  attendeeIds: [...e.attendeeIds],
});
