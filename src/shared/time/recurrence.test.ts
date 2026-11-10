// @vitest-environment node
import { Temporal } from '@js-temporal/polyfill';
import { describe, expect, it } from 'vitest';
import { parseInstant } from './instant';
import { expandOccurrences, type RecurringSource } from './recurrence';

const I = (s: string) => Temporal.Instant.from(s);
const starts = (occ: { start: Temporal.Instant }[]) => occ.map((o) => o.start.toString());

const src = (over: Partial<RecurringSource>): RecurringSource => ({
  startAt: '2026-03-02T07:00:00Z', // Monday 09:00 Kyiv (UTC+2)
  endAt: '2026-03-02T08:00:00Z',
  tzid: 'Europe/Kyiv',
  allDay: false,
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
  exdates: [],
  ...over,
});

describe('parseInstant', () => {
  it.each([
    ['2026-03-30T07:00:00Z', '2026-03-30T07:00:00Z'],
    ['2026-03-30 07:00:00+00', '2026-03-30T07:00:00Z'],
    ['2026-03-30 09:00:00+02', '2026-03-30T07:00:00Z'],
    ['2026-03-30 12:30:00.5+05:30', '2026-03-30T07:00:00.5Z'],
  ])('%s', (input, expected) => {
    expect(parseInstant(input).toString()).toBe(expected);
  });
});

describe('weekly "Monday 09:00 Kyiv" across DST (acceptance #3)', () => {
  const out = expandOccurrences(src({}), I('2026-03-01T00:00:00Z'), I('2026-04-20T00:00:00Z'));

  it('is 09:00 Kyiv both before and after the spring-forward on 2026-03-29', () => {
    expect(starts(out)).toEqual([
      '2026-03-02T07:00:00Z',
      '2026-03-09T07:00:00Z',
      '2026-03-16T07:00:00Z',
      '2026-03-23T07:00:00Z', // last week of UTC+2
      '2026-03-30T06:00:00Z', // first week of UTC+3: same wall clock, earlier instant
      '2026-04-06T06:00:00Z',
      '2026-04-13T06:00:00Z',
    ]);
    for (const o of out) {
      expect(o.start.toZonedDateTimeISO('Europe/Kyiv').hour).toBe(9);
      expect(o.end.since(o.start).total('minutes')).toBe(60);
    }
  });

  it('is 09:00 Kyiv across the autumn fall-back on 2026-10-25', () => {
    const o = expandOccurrences(src({}), I('2026-10-15T00:00:00Z'), I('2026-11-05T00:00:00Z'));
    expect(starts(o)).toEqual([
      '2026-10-19T06:00:00Z',
      '2026-10-26T07:00:00Z',
      '2026-11-02T07:00:00Z',
    ]);
  });

  it('gives the same answer regardless of how the window is cut', () => {
    const left = expandOccurrences(src({}), I('2026-03-01T00:00:00Z'), I('2026-03-30T06:00:00Z'));
    const right = expandOccurrences(src({}), I('2026-03-30T06:00:00Z'), I('2026-04-20T00:00:00Z'));
    expect([...starts(left), ...starts(right)]).toEqual(starts(out));
  });
});

describe('New York and Tokyo', () => {
  it('weekday 08:30 New York across both US transitions', () => {
    const ny = src({
      startAt: '2026-03-02T13:30:00Z', // 08:30 EST
      endAt: '2026-03-02T14:00:00Z',
      tzid: 'America/New_York',
      rrule: 'FREQ=DAILY;BYDAY=MO,TU,WE,TH,FR',
    });
    const mar = expandOccurrences(ny, I('2026-03-06T00:00:00Z'), I('2026-03-11T00:00:00Z'));
    expect(starts(mar)).toEqual([
      '2026-03-06T13:30:00Z', // Fri EST
      '2026-03-09T12:30:00Z', // Mon EDT (DST began Sun 2026-03-08)
      '2026-03-10T12:30:00Z',
    ]);
    const nov = expandOccurrences(ny, I('2026-10-29T00:00:00Z'), I('2026-11-04T00:00:00Z'));
    expect(starts(nov)).toEqual([
      '2026-10-29T12:30:00Z',
      '2026-10-30T12:30:00Z',
      '2026-11-02T13:30:00Z', // Mon EST (DST ended Sun 2026-11-01)
      '2026-11-03T13:30:00Z',
    ]);
  });

  it('Tokyo has no DST: the UTC instant never moves', () => {
    const tk = src({
      startAt: '2026-03-02T01:00:00Z',
      endAt: '2026-03-02T02:00:00Z',
      tzid: 'Asia/Tokyo',
    });
    const o = expandOccurrences(tk, I('2026-03-01T00:00:00Z'), I('2026-12-01T00:00:00Z'));
    expect(new Set(o.map((x) => x.start.toString().slice(10))).size).toBe(1);
  });
});

describe('DST edge wall-clock times', () => {
  const daily = (startAt: string, endAt: string, extra = '') =>
    src({ startAt, endAt, rrule: `FREQ=DAILY;COUNT=5${extra}` });

  it('nonexistent time (03:30 on spring-forward day in Kyiv) is shifted forward, series continues', () => {
    // 2026-03-27 03:30 Kyiv = 01:30Z. On 2026-03-29 03:30 does not exist (03:00 -> 04:00).
    const o = expandOccurrences(
      daily('2026-03-27T01:30:00Z', '2026-03-27T02:30:00Z'),
      I('2026-03-26T00:00:00Z'),
      I('2026-04-05T00:00:00Z'),
    );
    expect(starts(o)).toEqual([
      '2026-03-27T01:30:00Z',
      '2026-03-28T01:30:00Z',
      '2026-03-29T01:30:00Z', // 04:30 UTC+3 — shifted by the 1h gap, still the same instant 01:30Z
      '2026-03-30T00:30:00Z', // back to 03:30 local (UTC+3)
      '2026-03-31T00:30:00Z',
    ]);
  });

  it('ambiguous time (03:30 on fall-back day in Kyiv) takes the first (summer-time) instant', () => {
    // 2026-10-23 03:30 Kyiv (UTC+3) = 00:30Z. On 2026-10-25 03:30 happens twice.
    const o = expandOccurrences(
      daily('2026-10-23T00:30:00Z', '2026-10-23T01:30:00Z'),
      I('2026-10-22T00:00:00Z'),
      I('2026-11-05T00:00:00Z'),
    );
    expect(starts(o)).toEqual([
      '2026-10-23T00:30:00Z',
      '2026-10-24T00:30:00Z',
      '2026-10-25T00:30:00Z', // first 03:30 (UTC+3)
      '2026-10-26T01:30:00Z', // 03:30 (UTC+2)
      '2026-10-27T01:30:00Z',
    ]);
  });

  it('a timed event keeps its real duration across the DST jump', () => {
    // Timed events keep exactly 3 real hours even though the wall clock jumps on 2026-03-29.
    const o = expandOccurrences(
      src({
        startAt: '2026-03-28T23:30:00Z', // 01:30 Kyiv (UTC+2)
        endAt: '2026-03-29T02:30:00Z', // 3 real hours
        rrule: 'FREQ=DAILY;COUNT=3',
      }),
      I('2026-03-28T00:00:00Z'),
      I('2026-04-05T00:00:00Z'),
    );
    for (const x of o) expect(x.end.since(x.start).total('hours')).toBe(3);
  });
});

describe('rule semantics', () => {
  it('COUNT limits the total even when the window starts after the first occurrences', () => {
    const o = expandOccurrences(
      src({ rrule: 'FREQ=WEEKLY;BYDAY=MO;COUNT=4' }),
      I('2026-03-14T00:00:00Z'), // skips occurrences 1 and 2
      I('2027-01-01T00:00:00Z'),
    );
    expect(starts(o)).toEqual(['2026-03-16T07:00:00Z', '2026-03-23T07:00:00Z']);
  });

  it('UNTIL is a wall-clock bound in the event zone and is inclusive', () => {
    // Last Monday 2026-03-30 09:00 Kyiv; UNTIL equal to that wall time keeps it.
    const o = expandOccurrences(
      src({ rrule: 'FREQ=WEEKLY;BYDAY=MO;UNTIL=20260330T090000Z' }),
      I('2026-03-20T00:00:00Z'),
      I('2026-06-01T00:00:00Z'),
    );
    expect(starts(o)).toEqual(['2026-03-23T07:00:00Z', '2026-03-30T06:00:00Z']);
  });

  it('INTERVAL=2 and multiple BYDAY', () => {
    const o = expandOccurrences(
      src({ rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE' }),
      I('2026-03-01T00:00:00Z'),
      I('2026-03-31T00:00:00Z'),
    );
    expect(starts(o)).toEqual([
      '2026-03-02T07:00:00Z',
      '2026-03-04T07:00:00Z',
      '2026-03-16T07:00:00Z',
      '2026-03-18T07:00:00Z',
      '2026-03-30T06:00:00Z',
    ]);
  });

  it('monthly on the 31st skips months without a 31st', () => {
    const o = expandOccurrences(
      src({
        startAt: '2026-01-31T07:00:00Z',
        endAt: '2026-01-31T08:00:00Z',
        rrule: 'FREQ=MONTHLY;BYMONTHDAY=31',
      }),
      I('2026-01-01T00:00:00Z'),
      I('2026-06-01T00:00:00Z'),
    );
    expect(starts(o).map((s) => s.slice(0, 10))).toEqual([
      '2026-01-31',
      '2026-03-31',
      '2026-05-31',
    ]);
  });

  it('monthly second Tuesday keeps wall-clock time across DST', () => {
    const o = expandOccurrences(
      src({
        startAt: '2026-02-10T08:00:00Z',
        endAt: '2026-02-10T09:00:00Z',
        rrule: 'FREQ=MONTHLY;BYDAY=2TU',
      }), // 10:00 Kyiv
      I('2026-02-01T00:00:00Z'),
      I('2026-05-01T00:00:00Z'),
    );
    expect(starts(o)).toEqual([
      '2026-02-10T08:00:00Z',
      '2026-03-10T08:00:00Z',
      '2026-04-14T07:00:00Z',
    ]);
  });

  it('exdates remove exactly the named occurrence', () => {
    const o = expandOccurrences(
      src({ exdates: ['2026-03-09T07:00:00Z', '2026-03-30T06:00:00Z'] }),
      I('2026-03-01T00:00:00Z'),
      I('2026-04-07T00:00:00Z'),
    );
    expect(starts(o)).toEqual([
      '2026-03-02T07:00:00Z',
      '2026-03-16T07:00:00Z',
      '2026-03-23T07:00:00Z',
      '2026-04-06T06:00:00Z',
    ]);
  });

  it('exdates also work with Postgres-formatted timestamps', () => {
    const o = expandOccurrences(
      src({ exdates: ['2026-03-09 07:00:00+00'] }),
      I('2026-03-01T00:00:00Z'),
      I('2026-03-12T00:00:00Z'),
    );
    expect(starts(o)).toEqual(['2026-03-02T07:00:00Z']);
  });
});

describe('window boundaries', () => {
  it('includes an occurrence that started before the window but is still running', () => {
    const o = expandOccurrences(src({}), I('2026-03-02T07:30:00Z'), I('2026-03-02T12:00:00Z'));
    expect(starts(o)).toEqual(['2026-03-02T07:00:00Z']);
  });
  it('excludes an occurrence that ends exactly at window start or starts exactly at window end', () => {
    expect(
      expandOccurrences(src({}), I('2026-03-02T08:00:00Z'), I('2026-03-03T00:00:00Z')),
    ).toEqual([]);
    expect(
      expandOccurrences(src({}), I('2026-03-01T00:00:00Z'), I('2026-03-02T07:00:00Z')),
    ).toEqual([]);
  });
  it('non-recurring event: returned only if it overlaps', () => {
    const one = src({ rrule: null });
    expect(
      expandOccurrences(one, I('2026-03-01T00:00:00Z'), I('2026-03-03T00:00:00Z')),
    ).toHaveLength(1);
    expect(
      expandOccurrences(one, I('2026-03-03T00:00:00Z'), I('2026-03-04T00:00:00Z')),
    ).toHaveLength(0);
  });
  it('a long series far from its start is still found', () => {
    const o = expandOccurrences(
      src({ rrule: 'FREQ=DAILY' }),
      I('2028-06-01T00:00:00Z'),
      I('2028-06-03T00:00:00Z'),
    );
    expect(o).toHaveLength(2);
  });
});

describe('all-day events', () => {
  it('multi-day all-day spans whole local days, also over a DST change (23h/25h days)', () => {
    // 2026-03-28..03-31 local (3 days), crossing Kyiv spring-forward.
    const o = expandOccurrences(
      src({
        startAt: '2026-03-27T22:00:00Z', // 2026-03-28 00:00 Kyiv (UTC+2)
        endAt: '2026-03-30T21:00:00Z', // 2026-03-31 00:00 Kyiv (UTC+3)
        allDay: true,
        rrule: 'FREQ=WEEKLY;COUNT=2',
      }),
      I('2026-03-01T00:00:00Z'),
      I('2026-06-01T00:00:00Z'),
    );
    expect(o).toHaveLength(2);
    expect(starts(o)).toEqual(['2026-03-27T22:00:00Z', '2026-04-03T21:00:00Z']);
    expect(o[1]?.end.toString()).toBe('2026-04-06T21:00:00Z');
  });
});
