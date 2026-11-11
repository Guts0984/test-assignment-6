import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { count, ids, tokens, setupApiWorld } from '@/server/tools/testing/harness';
import { h, post, patch, meeting } from './api';

setupApiWorld();

const hours = Array.from({ length: 24 }, (_, i) => i).join(',');
const minutes = Array.from({ length: 60 }, (_, i) => i).join(',');

describe('validation: bad input is a 400 and leaves no trace', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['end equals start', meeting({ endAt: '2026-12-01T10:00:00Z' })],
    ['end before start', meeting({ endAt: '2026-12-01T09:00:00Z' })],
    ['time without offset', meeting({ startAt: '2026-12-01T10:00:00' })],
    ['unknown time zone', meeting({ tzid: 'Mars/Phobos' })],
    ['offset as time zone', meeting({ tzid: '+02:00' })],
    ['unknown room', meeting({ roomId: '00000000-0000-4000-8000-000000000000' })],
    ['room is not a uuid', meeting({ roomId: 'A' })],
    ['unknown attendee', meeting({ attendeeIds: ['00000000-0000-4000-8000-000000000000'] })],
    ['empty title', meeting({ title: '  ' })],
    ['title too long', meeting({ title: 'x'.repeat(201) })],
    ['unknown field', meeting({ creatorId: '00000000-0000-4000-8000-000000000000' })],
    ['garbage rule', meeting({ rrule: 'garbage' })],
    ['yearly rule', meeting({ rrule: 'FREQ=YEARLY' })],
    ['rule with DTSTART', meeting({ rrule: 'DTSTART:20261201T100000Z\nRRULE:FREQ=DAILY' })],
    [
      'start is not on the rule (Tuesday start, BYDAY=MO)',
      meeting({ rrule: 'FREQ=WEEKLY;BYDAY=MO' }),
    ],
    ['too many occurrences', meeting({ rrule: 'FREQ=DAILY;COUNT=5000' })],
    // The rrule library loops forever on a negative INTERVAL: it must never get to see one.
    ['negative interval (froze the server)', meeting({ rrule: 'FREQ=DAILY;INTERVAL=-1' })],
    ['zero interval', meeting({ rrule: 'FREQ=DAILY;INTERVAL=0' })],
    ['interval beyond what the form offers', meeting({ rrule: 'FREQ=DAILY;INTERVAL=100' })],
    ['fractional interval', meeting({ rrule: 'FREQ=DAILY;INTERVAL=1.5' })],
    ['negative count', meeting({ rrule: 'FREQ=DAILY;COUNT=-1' })],
    ['zero count', meeting({ rrule: 'FREQ=DAILY;COUNT=0' })],
    ['interval given twice', meeting({ rrule: 'FREQ=DAILY;INTERVAL=2;INTERVAL=-1' })],
    ['part we do not support', meeting({ rrule: 'FREQ=DAILY;BYHOUR=1' })],
    // Rules that would make the server expand for ages or write huge numbers of rows.
    ['huge count', meeting({ rrule: 'FREQ=DAILY;COUNT=99999999' })],
    ['until in the year 9999', meeting({ rrule: 'FREQ=DAILY;UNTIL=99991231T235959Z' })],
    [
      'every-minute rule (BYMINUTE list)',
      meeting({ rrule: `FREQ=DAILY;BYHOUR=${hours};BYMINUTE=${minutes}` }),
    ],
    [
      'the same weekday repeated to inflate the work',
      meeting({ rrule: `FREQ=WEEKLY;BYDAY=${'MO,'.repeat(60)}MO` }),
    ],
    ['all-day not at local midnight', meeting({ allDay: true, tzid: 'Europe/Kyiv' })],
  ];
  it.each(bad)('%s', async (_n, body) => {
    const r = await post('ana', body);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
    expect(await count('events')).toBe(0);
    expect(await count('event_occurrences')).toBe(0);
    expect(await count('event_attendees')).toBe(0);
  });

  it('duplicate attendees are a 400', async () => {
    const r = await post('ana', meeting({ attendeeIds: [ids.bob, ids.bob] }));
    expect(r.status).toBe(400);
    expect(await count('events')).toBe(0);
  });

  it('malformed JSON is a 400, not a crash', async () => {
    const r = new NextRequest('http://localhost:3000/api/events', {
      method: 'POST',
      headers: { host: 'localhost:3000', cookie: `session=${tokens.ana}` },
      body: '{oops',
    });
    expect((await h.create(r)).status).toBe(400);
  });

  it('the same bad rule is refused when an existing event is edited, and nothing changes', async () => {
    const created = await post('ana', meeting());
    expect(created.status).toBe(201);
    const id = created.body.events[0].id as string;
    const r = await patch('ana', id, { version: 1, rrule: 'FREQ=DAILY;INTERVAL=-1' });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
    expect(await count('event_occurrences')).toBe(1);
  });

  it.each([
    ['COUNT=99999999', 'FREQ=DAILY;COUNT=99999999'],
    ['UNTIL in the year 9999', 'FREQ=DAILY;UNTIL=99991231T235959Z'],
    [
      'UNTIL 9 years ahead with a daily rule (too many occurrences)',
      'FREQ=DAILY;UNTIL=20351231T235959Z',
    ],
  ])('%s is answered at once, not after expanding the rule', async (_n, rrule) => {
    const started = performance.now();
    const r = await post('ana', meeting({ rrule }));
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect(performance.now() - started, 'took far too long').toBeLessThan(2000);
  });
});
