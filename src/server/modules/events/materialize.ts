import type { Temporal } from '@js-temporal/polyfill';
import {
  expandAll,
  expandOccurrences,
  isFiniteRule,
  parseInstant,
  toRange,
  type Occurrence,
  type RecurringSource,
} from '@/shared/time';

/** How far ahead an open-ended series is materialized (and extended on read). */
export const OPEN_SERIES_HORIZON_MONTHS = 12;

/** `event_occurrences` for an event is fully known unless its rule never ends. */
export const isOpenEnded = (src: Pick<RecurringSource, 'rrule'>): boolean =>
  src.rrule !== null && !isFiniteRule(src.rrule);

/**
 * Every concrete occurrence of an event (what goes into `event_occurrences`).
 *  - non-recurring or finite rule: all of them (`horizon` is ignored);
 *  - open-ended rule: from the series start up to `horizon` (exclusive).
 */
export function occurrencesOf(src: RecurringSource, horizon: Temporal.Instant): Occurrence[] {
  if (!isOpenEnded(src)) return expandAll(src);
  return expandOccurrences(src, parseInstant(src.startAt), horizon);
}

export const occurrenceRanges = (src: RecurringSource, horizon: Temporal.Instant): string[] =>
  occurrencesOf(src, horizon).map((o) => toRange(o.start, o.end));

/** Range strings of occurrences STARTING in [from, to) for an open-ended series. */
export function occurrenceRangesBetween(
  src: RecurringSource,
  from: Temporal.Instant,
  to: Temporal.Instant,
): string[] {
  return expandOccurrences(src, from, to)
    .filter((o) => o.start.epochMilliseconds >= from.epochMilliseconds)
    .map((o) => toRange(o.start, o.end));
}
