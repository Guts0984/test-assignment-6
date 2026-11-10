import { Temporal } from '@js-temporal/polyfill';
import { abort } from '@/server/core/db';
import { parseInstant, type RecurringSource } from '@/shared/time';
import { iso, type EventRow } from '../dto';
import { isOpenEnded, OPEN_SERIES_HORIZON_MONTHS } from '../materialize';
import { checkEventShape, type UpdateEventInput } from '../validation';

/** The editable fields of an event, i.e. what a create or a merged update carries. */
export type Fields = {
  roomId: string;
  title: string;
  description: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
};

export const horizonFrom = (now: Temporal.Instant): Temporal.Instant =>
  now.toZonedDateTimeISO('UTC').add({ months: OPEN_SERIES_HORIZON_MONTHS }).toInstant();

export const fieldsOf = (row: EventRow): Fields => ({
  roomId: row.roomId,
  title: row.title,
  description: row.description,
  startAt: iso(row.startAt),
  endAt: iso(row.endAt),
  allDay: row.allDay,
  tzid: row.tzid,
  rrule: row.rrule,
});

export const asSource = (f: Fields, exdates: string[] = []): RecurringSource => ({ ...f, exdates });

/** Applies only the keys the client actually sent. */
export const merge = (base: Fields, c: UpdateEventInput): Fields => ({
  roomId: c.roomId ?? base.roomId,
  title: c.title ?? base.title,
  description: c.description ?? base.description,
  startAt: c.startAt ?? base.startAt,
  endAt: c.endAt ?? base.endAt,
  allDay: c.allDay ?? base.allDay,
  tzid: c.tzid ?? base.tzid,
  rrule: c.rrule === undefined ? base.rrule : c.rrule,
});

export function assertShape(src: RecurringSource): void {
  const issue = checkEventShape(src);
  if (issue) abort(400, 'VALIDATION', [issue]);
}

export const horizonColumn = (
  src: RecurringSource,
  now: Temporal.Instant,
  previous: string | null,
): string | null => {
  if (!isOpenEnded(src)) return null;
  const fresh = horizonFrom(now);
  return previous && Temporal.Instant.compare(parseInstant(previous), fresh) > 0
    ? previous
    : fresh.toString();
};
