import { Temporal } from '@js-temporal/polyfill';
import { RRule, rrulestr } from 'rrule';
import { fromWallClock, parseInstant, wallClock } from './instant';

/**
 * RRULE expansion that stays correct across DST.
 *
 * The `rrule` library has no notion of time zones, so we use its "floating" mode: the series
 * start is converted to WALL-CLOCK time in the event's own zone, that wall-clock time is carried
 * as if it were UTC, rrule generates wall-clock occurrences, and each is converted back to a real
 * instant with Temporal in the event's zone. "Every Monday 9:00 Kyiv" is therefore 9:00 Kyiv
 * both before and after a DST change.
 *
 * Consequences (documented in README):
 *  - UNTIL in the RRULE string is a wall-clock time in the event's zone (the `Z` is ignored).
 *  - Timed events keep their exact duration; all-day events span whole local days.
 */

export type RecurringSource = {
  /** First occurrence, ISO or Postgres timestamptz text. */
  startAt: string;
  endAt: string;
  tzid: string;
  allDay: boolean;
  rrule: string | null;
  /** Start instants of occurrences removed from the series. */
  exdates: readonly string[];
};

export type Occurrence = { start: Temporal.Instant; end: Temporal.Instant };

// rrule's API only speaks `Date`. We use it purely as a carrier of floating wall-clock fields
// (always UTC getters/setters), never for any time zone calculation.
/* eslint-disable no-restricted-syntax -- floating wall-clock carrier required by the rrule API */
const floating = (p: Temporal.PlainDateTime): Date =>
  new Date(Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second));
/* eslint-enable no-restricted-syntax */

const fromFloating = (d: Date): Temporal.PlainDateTime =>
  new Temporal.PlainDateTime(
    d.getUTCFullYear(),
    d.getUTCMonth() + 1,
    d.getUTCDate(),
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
  );

function occurrenceEnd(
  src: RecurringSource,
  start: Temporal.Instant,
  spanDays: number,
  firstDuration: Temporal.Duration,
): Temporal.Instant {
  if (!src.allDay) return start.add(firstDuration);
  const day = wallClock(start, src.tzid).toPlainDate().add({ days: spanDays });
  return fromWallClock(day.toPlainDateTime(), src.tzid);
}

/**
 * Occurrences of an event that overlap the half-open window [from, to), sorted by start.
 * Works for non-recurring events too (returns the single occurrence if it overlaps).
 */
type Prepared = {
  firstStart: Temporal.Instant;
  firstDuration: Temporal.Duration;
  localStart: Temporal.PlainDateTime;
  spanDays: number;
  excluded: Set<number>;
};

function prepare(src: RecurringSource): Prepared {
  const firstStart = parseInstant(src.startAt);
  const firstEnd = parseInstant(src.endAt);
  const localStart = wallClock(firstStart, src.tzid);
  const localEnd = wallClock(firstEnd, src.tzid);
  return {
    firstStart,
    firstDuration: firstEnd.since(firstStart),
    localStart,
    // All-day: number of local calendar days spanned (end is exclusive midnight).
    spanDays: src.allDay ? localStart.toPlainDate().until(localEnd.toPlainDate()).days : 0,
    excluded: new Set(src.exdates.map((e) => parseInstant(e).epochMilliseconds)),
  };
}

function toOccurrences(src: RecurringSource, p: Prepared, floatingStarts: Date[]): Occurrence[] {
  const result: Occurrence[] = [];
  for (const f of floatingStarts) {
    const start = fromWallClock(fromFloating(f), src.tzid);
    if (p.excluded.has(start.epochMilliseconds)) continue;
    result.push({ start, end: occurrenceEnd(src, start, p.spanDays, p.firstDuration) });
  }
  return result.sort((a, b) => Temporal.Instant.compare(a.start, b.start));
}

/**
 * Occurrences of an event that overlap the half-open window [from, to), sorted by start.
 * Works for non-recurring events too (returns the single occurrence if it overlaps).
 */
export function expandOccurrences(
  src: RecurringSource,
  from: Temporal.Instant,
  to: Temporal.Instant,
): Occurrence[] {
  const p = prepare(src);
  const overlaps = (o: Occurrence) =>
    Temporal.Instant.compare(o.start, to) < 0 && Temporal.Instant.compare(o.end, from) > 0;

  if (!src.rrule) {
    const single = { start: p.firstStart, end: parseInstant(src.endAt) };
    return overlaps(single) ? [single] : [];
  }

  const rule = rrulestr(src.rrule, { dtstart: floating(p.localStart) });
  // Query a generous wall-clock window (duration + 2 days of slack each side), then filter by
  // real instants. Slack covers zone offsets, DST shifts and occurrences that started before `from`.
  const slack = { days: 2 };
  const slackedFrom = wallClock(from, src.tzid)
    .subtract(p.firstDuration.round({ largestUnit: 'hours' }))
    .subtract(src.allDay ? { days: p.spanDays + 2 } : slack);
  const slackedTo = wallClock(to, src.tzid).add(slack);

  const floatingStarts = rule.between(floating(slackedFrom), floating(slackedTo), true);
  return toOccurrences(src, p, floatingStarts).filter(overlaps);
}

/** True if the rule ends by itself (COUNT or UNTIL); open-ended rules are materialized lazily. */
export function isFiniteRule(rrule: string): boolean {
  const o = RRule.parseString(rrule);
  return o.count != null || o.until != null;
}

/** Every occurrence of a non-recurring or FINITE recurring event. Throws for open-ended rules. */
export function expandAll(src: RecurringSource): Occurrence[] {
  const p = prepare(src);
  if (!src.rrule) return [{ start: p.firstStart, end: parseInstant(src.endAt) }];
  if (!isFiniteRule(src.rrule)) throw new Error('expandAll needs a rule with COUNT or UNTIL');
  const rule = rrulestr(src.rrule, { dtstart: floating(p.localStart) });
  return toOccurrences(src, p, rule.all());
}

/** Does the event's first occurrence start exactly at `startAt` (i.e. the rule matches its own start)? */
export function startMatchesRule(src: RecurringSource): boolean {
  if (!src.rrule) return true;
  const start = parseInstant(src.startAt);
  const first = expandOccurrences(
    { ...src, exdates: [] },
    start,
    start.add({ milliseconds: 1 }),
  )[0];
  return first !== undefined && first.start.equals(start);
}

const ruleParts = (rrule: string) => rrule.split(';').filter(Boolean);
const withoutKeys = (rrule: string, keys: string[]) =>
  ruleParts(rrule).filter((p) => !keys.includes(p.split('=')[0] ?? ''));

/** Same rule, but ending at (and including) the given wall-clock time. Replaces COUNT/UNTIL. */
export function ruleWithUntil(rrule: string, until: Temporal.PlainDateTime): string {
  const f = (n: number, w = 2) => String(n).padStart(w, '0');
  const stamp = `${f(until.year, 4)}${f(until.month)}${f(until.day)}T${f(until.hour)}${f(until.minute)}${f(until.second)}Z`;
  return [...withoutKeys(rrule, ['COUNT', 'UNTIL']), `UNTIL=${stamp}`].join(';');
}

/** Same rule limited to `count` occurrences. Replaces COUNT/UNTIL. */
export function ruleWithCount(rrule: string, count: number): string {
  return [...withoutKeys(rrule, ['COUNT', 'UNTIL']), `COUNT=${count}`].join(';');
}

export function ruleCount(rrule: string): number | null {
  return RRule.parseString(rrule).count ?? null;
}
