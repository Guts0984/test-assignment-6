import { Temporal } from '@js-temporal/polyfill';

/**
 * The time span the calendar may be asked about: five years either side of today. Reading far into
 * the future is not free, because a read extends open-ended series (it writes occurrence rows), so
 * every entry point (the API, the server-rendered page, the extension itself) uses this one rule.
 */
export const MAX_YEARS_AHEAD = 5;

export function supportedWindow(now: Temporal.Instant): {
  earliest: Temporal.Instant;
  latest: Temporal.Instant;
} {
  const today = now.toZonedDateTimeISO('UTC');
  return {
    earliest: today.subtract({ years: MAX_YEARS_AHEAD }).toInstant(),
    latest: today.add({ years: MAX_YEARS_AHEAD }).toInstant(),
  };
}

/** Is [from, to] inside the supported span around `now`? */
export function isSupportedWindow(
  from: Temporal.Instant,
  to: Temporal.Instant,
  now: Temporal.Instant,
): boolean {
  const { earliest, latest } = supportedWindow(now);
  return Temporal.Instant.compare(from, earliest) >= 0 && Temporal.Instant.compare(to, latest) <= 0;
}
