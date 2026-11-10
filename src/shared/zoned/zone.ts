import { civilFromDays, daysFromCivil, type Civil } from './civil';

/** A civil date plus wall-clock time. No zone: it means different instants in different zones. */
export type Local = Civil & { h: number; mi: number; s: number };

export type Disambiguation = 'compatible' | 'earlier' | 'later' | 'reject';

const MS_PER_DAY = 86_400_000;

/** Wall-clock fields read as if they were UTC: epoch milliseconds. */
export const localAsUtc = (l: Local): number =>
  daysFromCivil(l) * MS_PER_DAY + l.h * 3_600_000 + l.mi * 60_000 + l.s * 1000;

export const localFromUtcMs = (ms: number): Local => {
  const days = Math.floor(ms / MS_PER_DAY);
  const rest = ms - days * MS_PER_DAY;
  const secs = Math.floor(rest / 1000);
  return {
    ...civilFromDays(days),
    h: Math.floor(secs / 3600),
    mi: Math.floor((secs % 3600) / 60),
    s: secs % 60,
  };
};

export function isValidZone(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
const formatterFor = (tz: string): Intl.DateTimeFormat => {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(tz, f);
  }
  return f;
};

// Offsets only change at transitions, which for every zone since 1970 are whole minutes, so the
// offset is constant within a UTC minute. The cache keeps rendering thousands of events cheap.
const offsetCache = new Map<string, number>();
const CACHE_LIMIT = 200_000;

/** UTC offset of `tz` at the instant `ms` (epoch ms), in milliseconds. Positive = east of UTC. */
export function offsetAt(ms: number, tz: string): number {
  const minute = Math.floor(ms / 60_000);
  const key = `${tz}|${minute}`;
  const hit = offsetCache.get(key);
  if (hit !== undefined) return hit;

  const seconds = Math.floor(ms / 1000);
  const parts = formatterFor(tz).formatToParts(seconds * 1000);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = localAsUtc({
    y: get('year'),
    m: get('month'),
    d: get('day'),
    h: get('hour'),
    mi: get('minute'),
    s: get('second'),
  });
  const offset = wall - seconds * 1000;
  if (offsetCache.size >= CACHE_LIMIT) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

/** Wall-clock time in `tz` at the instant `ms`. */
export const toLocal = (ms: number, tz: string): Local => {
  const local = localFromUtcMs(ms + offsetAt(ms, tz));
  return local;
};

/**
 * Wall-clock time -> instant, with the same rules as Temporal (RFC 5545 "compatible" by default):
 *  - a time that does not exist (spring-forward gap) is moved forward by the gap length;
 *  - a time that happens twice (fall-back overlap) resolves to the earlier instant;
 *  - 'earlier' / 'later' pick the other interpretation; 'reject' throws.
 */
export function fromLocal(
  local: Local,
  tz: string,
  disambiguation: Disambiguation = 'compatible',
): number {
  const asUtc = localAsUtc(local);
  const before = offsetAt(asUtc - MS_PER_DAY, tz);
  const after = offsetAt(asUtc + MS_PER_DAY, tz);

  // Candidate instants for each distinct offset; keep those that really show this wall time.
  const valid = [...new Set([before, after])]
    .map((o) => asUtc - o)
    .filter((candidate) => offsetAt(candidate, tz) === asUtc - candidate)
    .sort((a, b) => a - b);

  if (valid.length === 1) return valid[0] as number;
  if (valid.length > 1) {
    if (disambiguation === 'reject') throw new RangeError('ambiguous local time');
    return (disambiguation === 'later' ? valid[valid.length - 1] : valid[0]) as number;
  }
  // Gap: the wall time never happened.
  if (disambiguation === 'reject') throw new RangeError('nonexistent local time');
  // `before`-based reading lands after the gap (forward), `after`-based lands before it (backward).
  return disambiguation === 'earlier'
    ? asUtc - Math.max(before, after)
    : asUtc - Math.min(before, after);
}

/** The instant a civil date starts in `tz` (usually 00:00; later if midnight does not exist). */
export const startOfDay = (date: Civil, tz: string): number =>
  fromLocal({ ...date, h: 0, mi: 0, s: 0 }, tz);
