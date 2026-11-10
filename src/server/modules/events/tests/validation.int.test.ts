import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { count, ids, tokens, setupApiWorld } from '@/server/tools/testing/harness';
import { h, post, meeting } from './api';

setupApiWorld();

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
});
