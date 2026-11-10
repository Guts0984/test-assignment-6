// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { addDays, dayOfWeek, diffDays, formatCivil, formatInstant } from '@/shared/zoned';
import {
  daysOf,
  LIST_WINDOW_DAYS,
  neighborRanges,
  rangeOf,
  shiftAnchor,
  weekStartOf,
} from './range';

const d = (y: number, m: number, day: number) => ({ y, m, d: day });
const fmt = (days: { y: number; m: number; d: number }[]) => days.map(formatCivil);

describe('week start by locale (#17)', () => {
  it('uk weeks start on Monday, en weeks on Sunday; unknown locales fall back to Monday', () => {
    expect(weekStartOf('uk')).toBe(1);
    expect(weekStartOf('en')).toBe(7);
    expect(weekStartOf('xx')).toBe(1);
  });

  it('the same date gives a different week in uk and en', () => {
    const wednesday = d(2026, 11, 11);
    expect(fmt(daysOf('week', wednesday, weekStartOf('uk')))).toEqual([
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15',
    ]);
    expect(fmt(daysOf('week', wednesday, weekStartOf('en')))).toEqual([
      '2026-11-08',
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
    ]);
  });

  it('a Sunday belongs to the week that ENDS on it in uk, and STARTS on it in en', () => {
    const sunday = d(2026, 11, 15);
    expect(formatCivil(daysOf('week', sunday, 1)[0]!)).toBe('2026-11-09');
    expect(formatCivil(daysOf('week', sunday, 7)[0]!)).toBe('2026-11-15');
  });
});

describe('daysOf', () => {
  it('day = 1 day, week = 7, list = the list window', () => {
    expect(daysOf('day', d(2026, 11, 10), 1)).toHaveLength(1);
    expect(daysOf('week', d(2026, 11, 10), 1)).toHaveLength(7);
    const list = daysOf('list', d(2026, 11, 10), 1);
    expect(list).toHaveLength(LIST_WINDOW_DAYS);
    expect(formatCivil(list[0]!)).toBe('2026-11-10');
  });

  it.each([
    // [anchor, weekStart, expected weeks, first shown day]
    [d(2027, 2, 15), 1, 4, '2027-02-01'], // Feb 2027 starts on Monday and has 28 days: exactly 4 weeks
    [d(2026, 2, 15), 1, 5, '2026-01-26'],
    [d(2026, 2, 15), 7, 4, '2026-02-01'], // Feb 2026 starts on Sunday: exactly 4 weeks with a Sunday start
    [d(2026, 8, 1), 1, 6, '2026-07-27'], // a 31-day month starting on Saturday needs 6 rows
    [d(2026, 11, 10), 1, 6, '2026-10-26'], // Nov 1 is a Sunday and Nov 30 a Monday: six Monday-start weeks
    [d(2026, 11, 10), 7, 5, '2026-11-01'],
  ])(
    'month grid for %o (week start %i) has %i whole weeks starting %s',
    (anchor, ws, weeks, first) => {
      const days = daysOf('month', anchor, ws as 1 | 7);
      expect(days).toHaveLength(weeks * 7);
      expect(formatCivil(days[0]!)).toBe(first);
      expect(dayOfWeek(days[0]!)).toBe(ws);
      // every day of the month is inside the grid, and the grid is consecutive days
      const monthDays = days.filter((x) => x.m === anchor.m && x.y === anchor.y);
      expect(monthDays).toHaveLength(new Set(monthDays.map(formatCivil)).size);
      days.forEach((day, i) => expect(diffDays(days[0]!, day)).toBe(i));
      expect(days.some((x) => x.y === anchor.y && x.m === anchor.m && x.d === 1)).toBe(true);
    },
  );
});

describe('rangeOf: instants in the viewer zone', () => {
  it('the week with the DST change is 167 hours long in Kyiv (a 23-hour day), 168 in Tokyo', () => {
    const anchor = d(2026, 3, 25); // week Mon Mar 23 .. Sun Mar 29 (DST starts on the 29th)
    const kyiv = rangeOf('week', anchor, 1, 'Europe/Kyiv');
    expect((kyiv.to - kyiv.from) / 3_600_000).toBe(167);
    expect(formatInstant(kyiv.from)).toBe('2026-03-22T22:00:00Z'); // Mon 00:00 at +02:00
    expect(formatInstant(kyiv.to)).toBe('2026-03-29T21:00:00Z'); // next Mon 00:00 at +03:00 ... wait Mon Mar 30
    const tokyo = rangeOf('week', anchor, 1, 'Asia/Tokyo');
    expect((tokyo.to - tokyo.from) / 3_600_000).toBe(168);
  });

  it('the same calendar day is a different instant range per zone', () => {
    const a = rangeOf('day', d(2026, 11, 10), 1, 'Asia/Tokyo');
    const b = rangeOf('day', d(2026, 11, 10), 1, 'America/New_York');
    expect(a.from).toBeLessThan(b.from);
    expect((b.to - b.from) / 3_600_000).toBe(24);
  });

  it('ranges are contiguous: the end of one is exactly the start of the next (no gap, no overlap)', () => {
    for (const view of ['day', 'week', 'list'] as const) {
      const r = rangeOf(view, d(2026, 3, 25), 1, 'Europe/Kyiv');
      const [prev, next] = neighborRanges(r, 1, 'Europe/Kyiv');
      expect(prev.to, view).toBe(r.from);
      expect(next.from, view).toBe(r.to);
    }
  });

  it('shiftAnchor moves by the right unit in both directions and round-trips', () => {
    expect(formatCivil(shiftAnchor('day', d(2026, 12, 31), 1))).toBe('2027-01-01');
    expect(formatCivil(shiftAnchor('week', d(2026, 11, 10), -1))).toBe('2026-11-03');
    expect(formatCivil(shiftAnchor('month', d(2026, 1, 31), 1))).toBe('2026-02-01');
    expect(formatCivil(shiftAnchor('month', d(2026, 1, 15), -1))).toBe('2025-12-01');
    expect(formatCivil(shiftAnchor('list', d(2026, 11, 10), 1))).toBe(
      formatCivil(addDays(d(2026, 11, 10), LIST_WINDOW_DAYS)),
    );
    for (const view of ['day', 'week', 'list'] as const) {
      const a = d(2026, 11, 10);
      expect(shiftAnchor(view, shiftAnchor(view, a, 1), -1)).toEqual(a);
    }
  });

  it('month neighbours cover the next/previous month (not the same grid)', () => {
    const r = rangeOf('month', d(2026, 11, 10), 1, 'Europe/Kyiv');
    const [prev, next] = neighborRanges(r, 1, 'Europe/Kyiv');
    expect(prev.anchor).toEqual(d(2026, 10, 1));
    expect(next.anchor).toEqual(d(2026, 12, 1));
  });
});
