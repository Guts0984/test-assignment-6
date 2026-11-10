import type { OccurrenceDto } from '@/shared/contracts';
import { parseInstant } from '@/shared/zoned';

/** An occurrence as the calendar works with it: instants are epoch milliseconds. */
export type CalEvent = {
  /** Unique per occurrence (a series has many): `${eventId}@${start ISO}`. */
  key: string;
  eventId: string;
  roomId: string;
  title: string;
  description: string;
  start: number;
  end: number;
  allDay: boolean;
  /** The zone the event was created in; all-day events are dates in THIS zone. */
  tzid: string;
  recurring: boolean;
  seriesId: string | null;
  version: number;
  creatorId: string;
  creatorName: string;
  attendeeIds: string[];
  /** UI-only state of an optimistic change. */
  sync?: 'syncing' | 'error';
};

export const eventKey = (eventId: string, startIso: string): string => `${eventId}@${startIso}`;

export function fromOccurrence(o: OccurrenceDto): CalEvent {
  const start = parseInstant(o.start);
  const end = parseInstant(o.end);
  if (start === null || end === null)
    throw new Error(`bad occurrence times: ${o.start} .. ${o.end}`);
  return {
    key: eventKey(o.eventId, o.start),
    eventId: o.eventId,
    roomId: o.roomId,
    title: o.title,
    description: o.description,
    start,
    end,
    allDay: o.allDay,
    tzid: o.tzid,
    recurring: o.recurring,
    seriesId: o.seriesId,
    version: o.version,
    creatorId: o.creator.id,
    creatorName: o.creator.name,
    attendeeIds: o.attendeeIds,
  };
}
