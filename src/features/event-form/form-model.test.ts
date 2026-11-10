// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { formatClock, parseInstant } from '@/shared/zoned';
import {
  buildBody,
  buildRrule,
  noRepeat,
  parseRrule,
  valuesFor,
  type FormValues,
  type Repeat,
} from './form-model';

const EN = { am: 'AM', pm: 'PM' };
const base: FormValues = {
  title: 'Standup',
  roomId: 'r1',
  startDate: '2026-11-10',
  startTime: '9:30',
  endDate: '2026-11-10',
  endTime: '10:15',
  allDay: false,
  repeat: noRepeat,
  attendeeIds: [],
  description: '',
};
const build = (over: Partial<FormValues> = {}, tz = 'Europe/Kyiv') =>
  buildBody({ ...base, ...over }, { tz, labels: EN });
const ok = (over: Partial<FormValues> = {}, tz?: string) => {
  const r = build(over, tz);
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r.errors)}`);
  return r.body;
};
const errors = (over: Partial<FormValues> = {}, tz?: string) => {
  const r = build(over, tz);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
};

describe('buildBody: times in the viewer zone', () => {
  it('converts local date + typed times to UTC instants (Kyiv winter = +02:00)', () => {
    const b = ok();
    expect(b).toMatchObject({
      startAt: '2026-11-10T07:30:00Z',
      endAt: '2026-11-10T08:15:00Z',
      tzid: 'Europe/Kyiv',
      allDay: false,
      rrule: null,
    });
  });

  it('understands 12-hour input and locale typing habits', () => {
    expect(ok({ startTime: '2:30 PM', endTime: '3pm' }).startAt).toBe('2026-11-10T12:30:00Z');
    expect(ok({ startTime: '1430', endTime: '15.00' }).endAt).toBe('2026-11-10T13:00:00Z');
  });

  it('the same wall-clock time is a different instant in another zone (profile zone, not the browser)', () => {
    expect(ok({}, 'America/New_York').startAt).toBe('2026-11-10T14:30:00Z');
    expect(ok({}, 'Asia/Tokyo').startAt).toBe('2026-11-10T00:30:00Z');
  });

  it('an event past midnight uses the end date (multi-day)', () => {
    const b = ok({ startTime: '22:00', endDate: '2026-11-11', endTime: '02:00' });
    expect(parseInstant(b.endAt)! - parseInstant(b.startAt)!).toBe(4 * 3_600_000);
  });

  it('end at or before start is refused, judged in REAL time', () => {
    expect(errors({ endTime: '9:30' }).endTime).toBe('endBeforeStart');
    expect(errors({ endTime: '8:00' }).endTime).toBe('endBeforeStart');
    // 2026-03-29 in Kyiv: 03:00 -> 04:00 does not exist, so 03:30 is 04:30 and "03:30 - 04:30" has zero length.
    expect(
      errors({
        startDate: '2026-03-29',
        endDate: '2026-03-29',
        startTime: '03:30',
        endTime: '04:30',
      }).endTime,
    ).toBe('endBeforeStart');
    expect(
      ok({ startDate: '2026-03-29', endDate: '2026-03-29', startTime: '03:30', endTime: '05:30' })
        .endAt,
    ).toBe('2026-03-29T02:30:00Z');
  });

  it('reports every problem at once, field by field', () => {
    const e = errors({
      title: '  ',
      roomId: '',
      startDate: '2026-02-30',
      startTime: 'soon',
      endTime: '25:00',
    });
    expect(e).toMatchObject({
      title: 'titleRequired',
      roomId: 'roomRequired',
      startDate: 'invalidDate',
      startTime: 'invalidTime',
      endTime: 'invalidTime',
    });
  });

  it('title rules: trimmed, at most 200 characters', () => {
    expect(ok({ title: '  Hello  ' }).title).toBe('Hello');
    expect(errors({ title: 'x'.repeat(201) }).title).toBe('titleTooLong');
    expect(ok({ title: 'x'.repeat(200) })).toBeTruthy();
  });

  it('removes duplicate attendees', () => {
    expect(ok({ attendeeIds: ['a', 'b', 'a'] }).attendeeIds).toEqual(['a', 'b']);
  });
});

describe('buildBody: all-day', () => {
  it('a one-day all-day event ends at the next midnight (exclusive), in the profile zone', () => {
    const b = ok({
      allDay: true,
      startDate: '2026-11-10',
      endDate: '2026-11-10',
      startTime: '',
      endTime: '',
    });
    expect(b).toMatchObject({
      startAt: '2026-11-09T22:00:00Z',
      endAt: '2026-11-10T22:00:00Z',
      allDay: true,
    });
  });

  it('the end date is the LAST day: Nov 10-12 is three days', () => {
    const b = ok({ allDay: true, endDate: '2026-11-12' });
    expect(parseInstant(b.endAt)! - parseInstant(b.startAt)!).toBe(72 * 3_600_000);
  });

  it('across the DST change the days are 23h long but still whole days', () => {
    const b = ok({ allDay: true, startDate: '2026-03-28', endDate: '2026-03-30' });
    expect(b).toMatchObject({ startAt: '2026-03-27T22:00:00Z', endAt: '2026-03-30T21:00:00Z' });
  });

  it('end date before start date is refused', () => {
    expect(errors({ allDay: true, endDate: '2026-11-09' }).endDate).toBe('endBeforeStart');
  });
});

describe('recurrence rules', () => {
  const start = { y: 2026, m: 11, d: 9 }; // a Monday
  const r = (over: Partial<Repeat>): Repeat => ({ ...noRepeat, kind: 'weekly', ...over });

  it.each([
    [r({ kind: 'daily' }), 'FREQ=DAILY'],
    [r({ kind: 'daily', interval: 3 }), 'FREQ=DAILY;INTERVAL=3'],
    [r({ weekdays: ['WE', 'FR'] }), 'FREQ=WEEKLY;BYDAY=MO,WE,FR'], // the start weekday (Monday) is always included
    [r({ weekdays: [] }), 'FREQ=WEEKLY;BYDAY=MO'],
    [
      r({ weekdays: ['MO'], interval: 2, end: { kind: 'count', count: 10 } }),
      'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO;COUNT=10',
    ],
    [
      r({ kind: 'monthly', end: { kind: 'until', until: '2027-06-30' } }),
      'FREQ=MONTHLY;BYMONTHDAY=9;UNTIL=20270630T235959Z',
    ],
  ])('builds %j as %s', (repeat, expected) => {
    expect(buildRrule(repeat, start)).toBe(expected);
  });

  it('the weekday list is always in calendar order whatever order was ticked', () => {
    expect(buildRrule(r({ weekdays: ['SU', 'TH', 'TU'] }), start)).toBe(
      'FREQ=WEEKLY;BYDAY=MO,TU,TH,SU',
    );
  });

  it('"does not repeat" has no rule', () => {
    expect(buildRrule(noRepeat, start)).toBeNull();
  });

  it('parseRrule reads back what buildRrule wrote (round trip)', () => {
    for (const repeat of [
      r({ kind: 'daily' }),
      r({ weekdays: ['MO', 'WE'], interval: 2, end: { kind: 'count', count: 7 } }),
      r({ kind: 'monthly', end: { kind: 'until', until: '2027-01-31' } }),
    ]) {
      const rule = buildRrule(repeat, start);
      const back = parseRrule(rule);
      expect(buildRrule(back!, start)).toBe(rule);
    }
  });

  it('rules we cannot express return null instead of being silently rewritten', () => {
    expect(parseRrule('FREQ=YEARLY')).toBeNull();
    expect(parseRrule('FREQ=WEEKLY;BYSETPOS=1')).toBeNull();
    expect(parseRrule(null)).toEqual(noRepeat);
  });

  it('validates the repeat settings', () => {
    expect(errors({ repeat: r({ interval: 0 }) }).repeat).toBe('intervalRange');
    expect(errors({ repeat: r({ end: { kind: 'count', count: 0 } }) }).repeat).toBe('countRange');
    expect(errors({ repeat: r({ end: { kind: 'count', count: 1001 } }) }).repeat).toBe(
      'countRange',
    );
    expect(errors({ repeat: r({ end: { kind: 'until', until: 'nope' } }) }).repeat).toBe(
      'untilInvalid',
    );
    expect(
      errors({
        repeat: r({ end: { kind: 'until', until: '2026-11-09' } }),
        startDate: '2026-11-10',
        endDate: '2026-11-10',
      }).repeat,
    ).toBe('untilBeforeStart');
    expect(
      ok({
        repeat: r({ end: { kind: 'count', count: 1000 } }),
        startDate: '2026-11-09',
        endDate: '2026-11-09',
      }).rrule,
    ).toBe('FREQ=WEEKLY;BYDAY=MO;COUNT=1000');
  });

  it('puts the rule into the body, anchored to the START date', () => {
    expect(
      ok({ startDate: '2026-11-09', endDate: '2026-11-09', repeat: r({ weekdays: ['WE'] }) }).rrule,
    ).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
  });
});

describe('valuesFor (editing an existing event)', () => {
  const fmt = (m: number) => formatClock(m, '24h', EN);
  const event = {
    title: 'Review',
    roomId: 'r2',
    start: parseInstant('2026-11-10T07:30:00Z')!,
    end: parseInstant('2026-11-10T08:15:00Z')!,
    allDay: false,
    description: 'd',
    attendeeIds: ['u2'],
    rrule: null,
  };

  it('shows times in the profile zone and round-trips through buildBody', () => {
    const v = valuesFor(event, 'Europe/Kyiv', 'Europe/Kyiv', fmt);
    expect(v).toMatchObject({
      startDate: '2026-11-10',
      startTime: '09:30',
      endDate: '2026-11-10',
      endTime: '10:15',
    });
    const body = buildBody(v, { tz: 'Europe/Kyiv', labels: EN });
    expect(body.ok && [body.body.startAt, body.body.endAt]).toEqual([
      '2026-11-10T07:30:00Z',
      '2026-11-10T08:15:00Z',
    ]);
  });

  it('a Tokyo viewer sees the New York 23:30 event on the next day', () => {
    const ny = {
      ...event,
      start: parseInstant('2026-11-13T04:30:00Z')!,
      end: parseInstant('2026-11-13T05:30:00Z')!,
    };
    expect(valuesFor(ny, 'Asia/Tokyo', 'America/New_York', fmt)).toMatchObject({
      startDate: '2026-11-13',
      startTime: '13:30',
    });
  });

  it('all-day events are read in the event zone and show the LAST day', () => {
    const allDay = {
      ...event,
      allDay: true,
      start: parseInstant('2026-03-27T22:00:00Z')!,
      end: parseInstant('2026-03-30T21:00:00Z')!,
    };
    expect(valuesFor(allDay, 'Asia/Tokyo', 'Europe/Kyiv', fmt)).toMatchObject({
      startDate: '2026-03-28',
      endDate: '2026-03-30',
    });
    const again = buildBody(valuesFor(allDay, 'Asia/Tokyo', 'Europe/Kyiv', fmt), {
      tz: 'Europe/Kyiv',
      labels: EN,
    });
    expect(again.ok && [again.body.startAt, again.body.endAt]).toEqual([
      '2026-03-27T22:00:00Z',
      '2026-03-30T21:00:00Z',
    ]);
  });

  it('parses the stored rule for the repeat controls', () => {
    expect(
      valuesFor({ ...event, rrule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=5' }, 'UTC', 'UTC', fmt).repeat,
    ).toMatchObject({ kind: 'weekly', weekdays: ['MO', 'WE'], end: { kind: 'count', count: 5 } });
  });
});

describe('slotOf (what the free-room lookup asks about)', () => {
  const ctx = { tz: 'Europe/Kyiv', labels: EN };
  it('is the described time range, ignoring title/room/repeat that do not matter for availability', async () => {
    const { slotOf } = await import('./form-model');
    expect(slotOf({ ...base, title: '', roomId: '' }, ctx)).toEqual({
      start: parseInstant('2026-11-10T07:30:00Z'),
      end: parseInstant('2026-11-10T08:15:00Z'),
    });
  });

  it('is null while the times are incomplete or invalid, so no request is made', async () => {
    const { slotOf } = await import('./form-model');
    expect(slotOf({ ...base, startTime: '' }, ctx)).toBeNull();
    expect(slotOf({ ...base, endTime: '9:00' }, ctx)).toBeNull();
    expect(slotOf({ ...base, startDate: 'x' }, ctx)).toBeNull();
  });
});
