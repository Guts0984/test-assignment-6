// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatCivil } from '@/shared/zoned';
import { segmentsOf, segmentsOfCached } from './segments';
import { makeEvent } from '@/shared/calendar/test-utils';

const summary = (segs: ReturnType<typeof segmentsOf>) =>
  segs.map(
    (s) =>
      [formatCivil(s.date), s.startMin, s.endMin, s.continuesBefore, s.continuesAfter] as const,
  );

describe('segmentsOf: timed events in the viewer zone', () => {
  it('23:30 New York is the NEXT day, 13:30, for a user in Tokyo; the same day for a New York user (#4)', () => {
    // 2026-11-12 23:30 EST = 2026-11-13T04:30:00Z, one hour long.
    const e = makeEvent('2026-11-13T04:30:00Z', '2026-11-13T05:30:00Z', {
      tzid: 'America/New_York',
    });
    expect(summary(segmentsOf(e, 'Asia/Tokyo'))).toEqual([
      ['2026-11-13', 13 * 60 + 30, 14 * 60 + 30, false, false],
    ]);
    expect(summary(segmentsOf(e, 'America/New_York'))).toEqual([
      ['2026-11-12', 23 * 60 + 30, 1440, false, true],
      ['2026-11-13', 0, 30, true, false],
    ]);
  });

  it('an event crossing local midnight splits into one segment per day with continuation flags', () => {
    const e = makeEvent('2026-11-10T21:30:00Z', '2026-11-11T00:30:00Z'); // Kyiv (+2): 23:30 -> 02:30
    expect(summary(segmentsOf(e, 'Europe/Kyiv'))).toEqual([
      ['2026-11-10', 23 * 60 + 30, 1440, false, true],
      ['2026-11-11', 0, 150, true, false],
    ]);
  });

  it('an event ending exactly at local midnight stays on its day (no empty segment on the next)', () => {
    const e = makeEvent('2026-11-10T20:00:00Z', '2026-11-10T22:00:00Z'); // Kyiv 22:00 -> 00:00
    expect(summary(segmentsOf(e, 'Europe/Kyiv'))).toEqual([
      ['2026-11-10', 22 * 60, 1440, false, false],
    ]);
  });

  it('an event starting exactly at local midnight starts on that day', () => {
    const e = makeEvent('2026-11-09T22:00:00Z', '2026-11-09T23:00:00Z'); // Kyiv 00:00 -> 01:00 on the 10th
    expect(summary(segmentsOf(e, 'Europe/Kyiv'))).toEqual([['2026-11-10', 0, 60, false, false]]);
  });

  it('spans many days: first and last partial, the middle ones whole', () => {
    const e = makeEvent('2026-11-10T10:00:00Z', '2026-11-13T08:00:00Z', { tzid: 'UTC' });
    expect(summary(segmentsOf(e, 'UTC'))).toEqual([
      ['2026-11-10', 600, 1440, false, true],
      ['2026-11-11', 0, 1440, true, true],
      ['2026-11-12', 0, 1440, true, true],
      ['2026-11-13', 0, 480, true, false],
    ]);
  });

  it('places by WALL CLOCK on a DST day: 01:30-04:30 Kyiv on 2026-03-29 is 2 real hours but rows 90..270', () => {
    const e = makeEvent('2026-03-28T23:30:00Z', '2026-03-29T01:30:00Z'); // 01:30 +02 -> 04:30 +03
    expect(summary(segmentsOf(e, 'Europe/Kyiv'))).toEqual([['2026-03-29', 90, 270, false, false]]);
  });

  it('clips to the visible day range but keeps the continuation flags', () => {
    const e = makeEvent('2026-11-10T10:00:00Z', '2026-11-13T08:00:00Z', { tzid: 'UTC' });
    const from = { y: 2026, m: 11, d: 11 };
    const to = { y: 2026, m: 11, d: 12 };
    expect(summary(segmentsOf(e, 'UTC', from, to))).toEqual([
      ['2026-11-11', 0, 1440, true, true],
      ['2026-11-12', 0, 1440, true, true],
    ]);
    expect(segmentsOf(e, 'UTC', { y: 2026, m: 12, d: 1 })).toEqual([]);
  });

  it('a runaway event (years long) is bounded, not an infinite loop', () => {
    const e = makeEvent('2026-01-01T00:00:00Z', '2036-01-01T00:00:00Z', { tzid: 'UTC' });
    expect(segmentsOf(e, 'UTC').length).toBeLessThanOrEqual(400);
  });
});

describe('segmentsOf: all-day events are DATES in the event zone', () => {
  // 3-day all-day event in Kyiv: Mar 28, 29, 30 (crossing the DST change). Ends at Mar 31 00:00 Kyiv.
  const offsite = makeEvent('2026-03-27T22:00:00Z', '2026-03-30T21:00:00Z', {
    allDay: true,
    tzid: 'Europe/Kyiv',
  });

  it('covers exactly the days of the event and flags continuation, even across DST', () => {
    expect(summary(segmentsOf(offsite, 'Europe/Kyiv'))).toEqual([
      ['2026-03-28', 0, 1440, false, true],
      ['2026-03-29', 0, 1440, true, true],
      ['2026-03-30', 0, 1440, true, false],
    ]);
    expect(segmentsOf(offsite, 'Europe/Kyiv').every((s) => s.allDay)).toBe(true);
  });

  it('shows on the SAME dates for a viewer in Tokyo or New York (a date does not slide)', () => {
    const dates = (tz: string) => segmentsOf(offsite, tz).map((s) => formatCivil(s.date));
    expect(dates('Asia/Tokyo')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
    expect(dates('America/New_York')).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('a single all-day event is one segment', () => {
    const one = makeEvent('2026-11-09T22:00:00Z', '2026-11-10T22:00:00Z', { allDay: true });
    expect(summary(segmentsOf(one, 'Asia/Tokyo'))).toEqual([['2026-11-10', 0, 1440, false, false]]);
  });
});

describe('segmentsOfCached (keeps untouched events from re-rendering)', () => {
  const day = { y: 2026, m: 12, d: 2 };
  const nextDay = { y: 2026, m: 12, d: 3 };
  const event = () => makeEvent('2026-12-02T08:00:00Z', '2026-12-02T09:00:00Z');

  it('returns the very same segments for the same event, zone and range', () => {
    const e = event();
    expect(segmentsOfCached(e, 'Europe/Kyiv', day, nextDay)).toBe(
      segmentsOfCached(e, 'Europe/Kyiv', day, nextDay),
    );
  });

  it('a changed copy of the event (a drag) gets fresh segments', () => {
    const e = event();
    const moved = { ...e, start: e.start + 3_600_000, end: e.end + 3_600_000 };
    const a = segmentsOfCached(e, 'Europe/Kyiv', day, nextDay);
    const b = segmentsOfCached(moved, 'Europe/Kyiv', day, nextDay);
    expect(b).not.toBe(a);
    expect(b[0]?.startMin).toBe(a[0]!.startMin + 60);
  });

  it('never serves a stale answer after the viewer changes zone or the visible range', () => {
    const e = event(); // 08:00Z
    const kyiv = segmentsOfCached(e, 'Europe/Kyiv', day, nextDay);
    const tokyo = segmentsOfCached(e, 'Asia/Tokyo', day, nextDay);
    expect(kyiv[0]?.startMin).toBe(10 * 60); // UTC+2 in December
    expect(tokyo[0]?.startMin).toBe(17 * 60); // UTC+9
    const narrow = segmentsOfCached(e, 'Europe/Kyiv', nextDay, nextDay);
    expect(narrow).toEqual([]); // the event is on the 2nd, outside [3rd, 3rd]
    expect(segmentsOfCached(e, 'Europe/Kyiv', day, nextDay)).toEqual(
      segmentsOf(e, 'Europe/Kyiv', day, nextDay),
    );
  });
});
