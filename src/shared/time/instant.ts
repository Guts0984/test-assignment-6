import { Temporal } from '@js-temporal/polyfill';

/**
 * Parses an instant from either ISO 8601 (`2026-03-30T07:00:00Z`) or the way Postgres prints
 * timestamptz (`2026-03-30 07:00:00+00`, `2026-03-30 07:00:00.5+05:30`).
 */
export function parseInstant(value: string): Temporal.Instant {
  return Temporal.Instant.from(value.trim().replace(' ', 'T'));
}

/** Half-open Postgres range literal `[start,end)` for a tstzrange column. */
export function toRange(start: Temporal.Instant, end: Temporal.Instant): string {
  return `[${start.toString()},${end.toString()})`;
}

/** Wall-clock `PlainDateTime` of an instant in an IANA zone. */
export function wallClock(instant: Temporal.Instant, tzid: string): Temporal.PlainDateTime {
  return instant.toZonedDateTimeISO(tzid).toPlainDateTime();
}

/**
 * Wall-clock -> instant. DST edge cases use Temporal's `compatible` rule (same as RFC 5545):
 *  - nonexistent time (spring forward gap): shifted forward by the gap (03:30 -> 04:30);
 *  - ambiguous time (fall back overlap): the earlier of the two instants.
 */
export function fromWallClock(local: Temporal.PlainDateTime, tzid: string): Temporal.Instant {
  return local.toZonedDateTime(tzid, { disambiguation: 'compatible' }).toInstant();
}
