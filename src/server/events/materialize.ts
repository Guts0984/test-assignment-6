import type { Temporal } from '@js-temporal/polyfill';
import {
  expandOccurrences,
  parseInstant,
  toRange,
  type Occurrence,
  type RecurringSource,
} from '@/shared/time';

/**
 * Every concrete occurrence of an event (what goes into `event_occurrences`).
 * Non-recurring: its single occurrence. Recurring: from the series start up to `horizon`
 * (exclusive), minus exdates.
 */
export function occurrencesOf(src: RecurringSource, horizon: Temporal.Instant): Occurrence[] {
  const start = parseInstant(src.startAt);
  if (!src.rrule) return [{ start, end: parseInstant(src.endAt) }];
  return expandOccurrences(src, start, horizon);
}

export const occurrenceRanges = (src: RecurringSource, horizon: Temporal.Instant): string[] =>
  occurrencesOf(src, horizon).map((o) => toRange(o.start, o.end));
