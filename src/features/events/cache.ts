import type { EventDto, EventsChangedMessage } from '@/shared/contracts';
import { parseInstant } from '@/shared/zoned';
import { eventKey, type CalEvent } from '@/shared/calendar/types';

/** One cached time period (a week, a month grid, a list window) and the occurrences inside it. */
export type Period = { from: number; to: number; events: CalEvent[] };

const overlaps = (e: Pick<CalEvent, 'start' | 'end'>, p: Pick<Period, 'from' | 'to'>): boolean =>
  e.start < p.to && e.end > p.from;

/** A single (non-recurring) event as an occurrence. Recurring events are expanded by the server. */
export function occurrenceOf(dto: EventDto, creatorName: string): CalEvent {
  const start = parseInstant(dto.startAt) as number;
  const end = parseInstant(dto.endAt) as number;
  return {
    key: eventKey(dto.id, dto.startAt),
    eventId: dto.id,
    roomId: dto.roomId,
    title: dto.title,
    description: dto.description,
    start,
    end,
    allDay: dto.allDay,
    tzid: dto.tzid,
    recurring: dto.rrule !== null,
    seriesId: dto.seriesId,
    version: dto.version,
    creatorId: dto.creatorId,
    creatorName,
    attendeeIds: dto.attendeeIds,
  };
}

export type MergeResult = {
  period: Period;
  /** A series changed in a way we cannot expand here: this period must be refetched from the server. */
  needsRefetch: boolean;
};

const sorted = (events: CalEvent[]): CalEvent[] =>
  [...events].sort((a, b) => a.start - b.start || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

/**
 * Merges a server-confirmed change into one cached period.
 *  - A single event replaces its old occurrence (or appears / disappears as its time says).
 *  - A recurring event cannot be expanded in the browser (that needs the RRULE engine we keep out of the
 *    first load), so the period is flagged for refetch, but only if the series can reach it.
 *  - A change whose version is not newer than what we already show is ignored: that is the echo of our
 *    own mutation arriving over SSE, and ignoring it is what keeps the UI from flickering.
 */
export function mergeChange(
  period: Period,
  change: EventsChangedMessage,
  creatorName: (userId: string) => string,
): MergeResult {
  let events = period.events;
  let needsRefetch = false;

  const deleted = new Set(change.deletedEventIds);
  if (deleted.size > 0) events = events.filter((e) => !deleted.has(e.eventId));

  for (const dto of change.changed) {
    const known = events.filter((e) => e.eventId === dto.id);
    if (known.length > 0 && known.every((e) => e.version >= dto.version)) continue; // stale or our own echo
    events = events.filter((e) => e.eventId !== dto.id);
    if (dto.rrule !== null) {
      const startsBeforeEnd = (parseInstant(dto.startAt) as number) < period.to;
      if (startsBeforeEnd) needsRefetch = true;
      continue;
    }
    const occurrence = occurrenceOf(dto, creatorName(dto.creatorId));
    if (overlaps(occurrence, period)) events = [...events, occurrence];
  }
  return {
    period: events === period.events ? period : { ...period, events: sorted(events) },
    needsRefetch,
  };
}

/** Optimistic: replace fields of one occurrence (move / resize / rename). Marks it as syncing. */
export function patchOccurrence(
  period: Period,
  key: string,
  patch: Partial<Pick<CalEvent, 'start' | 'end' | 'roomId' | 'title' | 'allDay' | 'sync'>>,
): Period {
  if (!period.events.some((e) => e.key === key)) return period;
  return {
    ...period,
    events: sorted(
      period.events.map((e) =>
        e.key === key ? { ...e, ...patch, sync: patch.sync ?? 'syncing' } : e,
      ),
    ),
  };
}

/** Optimistic: remove an occurrence (scope "this") or every occurrence of the event. */
export function removeOccurrences(
  period: Period,
  match: { key?: string; eventId?: string; fromStart?: number },
): Period {
  const events = period.events.filter((e) => {
    if (match.key !== undefined) return e.key !== match.key;
    if (match.eventId === undefined || e.eventId !== match.eventId) return true;
    return match.fromStart !== undefined ? e.start < match.fromStart : false;
  });
  return events.length === period.events.length ? period : { ...period, events };
}

/** Optimistic: show a new event right away, marked as syncing. */
export function addOccurrence(period: Period, event: CalEvent): Period {
  return overlaps(event, period)
    ? { ...period, events: sorted([...period.events, { ...event, sync: 'syncing' }]) }
    : period;
}

/** Clears the "syncing/error" mark of everything belonging to an event once the server confirmed it. */
export function settle(period: Period, eventId: string): Period {
  if (!period.events.some((e) => e.eventId === eventId && e.sync)) return period;
  return {
    ...period,
    events: period.events.map((e) => (e.eventId === eventId ? { ...e, sync: undefined } : e)),
  };
}

/** Marks an event's occurrences as failed (kept visible, in an error style, until resolved). */
export function markError(period: Period, eventId: string): Period {
  return {
    ...period,
    events: period.events.map((e) =>
      e.eventId === eventId ? { ...e, sync: 'error' as const } : e,
    ),
  };
}

/** Replaces an optimistic temporary id by the real one (create finished). */
export function renameEvent(period: Period, fromId: string, to: CalEvent): Period {
  if (!period.events.some((e) => e.eventId === fromId)) return period;
  return { ...period, events: sorted([...period.events.filter((e) => e.eventId !== fromId), to]) };
}
