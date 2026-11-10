import { parseInstant } from '@/shared/time';
import type { events } from './schema';

export type EventRow = typeof events.$inferSelect;

/** An event or series master as the API exposes it. All instants are ISO 8601 UTC. */
export type EventDto = {
  id: string;
  roomId: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
  exdates: string[];
  /** Set for a single edited occurrence that was detached from a series. */
  seriesId: string | null;
  originalStart: string | null;
  version: number;
  creatorId: string;
  attendeeIds: string[];
};

/** One concrete occurrence in `GET /api/events`: recurring series are already expanded. */
export type OccurrenceDto = {
  eventId: string;
  roomId: string;
  title: string;
  description: string;
  start: string;
  end: string;
  allDay: boolean;
  tzid: string;
  recurring: boolean;
  seriesId: string | null;
  version: number;
  creator: { id: string; name: string };
  attendeeIds: string[];
};

export type Blocker = {
  eventId: string;
  title: string;
  creator: { id: string; name: string };
  start: string;
  end: string;
};

export const iso = (pgTimestamp: string): string => parseInstant(pgTimestamp).toString();

export const toEventDto = (row: EventRow, attendeeIds: string[]): EventDto => ({
  id: row.id,
  roomId: row.roomId,
  title: row.title,
  description: row.description,
  startAt: iso(row.startAt),
  endAt: iso(row.endAt),
  allDay: row.allDay,
  tzid: row.tzid,
  rrule: row.rrule,
  exdates: row.exdates.map(iso),
  seriesId: row.seriesId,
  originalStart: row.originalStart ? iso(row.originalStart) : null,
  version: row.version,
  creatorId: row.creatorId,
  attendeeIds: [...attendeeIds].sort(),
});
