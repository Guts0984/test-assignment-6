import type { Blocker, EventDto, OccurrenceDto } from '@/shared/contracts';
import { parseInstant } from '@/shared/time';
import type { events } from './schema';

export type { Blocker, EventDto, OccurrenceDto };
export type EventRow = typeof events.$inferSelect;

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
