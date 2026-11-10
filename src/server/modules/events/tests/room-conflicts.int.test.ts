import { describe, expect, it } from 'vitest';
import { count, created, ids, world, setupApiWorld } from '@/server/tools/testing/harness';
import { post, occurrences, meeting } from './api';

setupApiWorld();

describe('room conflicts (acceptance #7)', () => {
  it('rejects an overlapping booking with 409 and tells who is in the way', async () => {
    await post('ana', meeting({ title: 'Ana is here' }));
    const r = await post(
      'bob',
      meeting({
        title: 'Bob wants it',
        startAt: '2026-12-01T10:30:00Z',
        endAt: '2026-12-01T11:30:00Z',
      }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ROOM_CONFLICT');
    expect(r.body.error.details.blockers).toEqual([
      expect.objectContaining({
        title: 'Ana is here',
        creator: { id: ids.ana, name: 'Ana' },
        start: '2026-12-01T10:00:00Z',
        end: '2026-12-01T11:00:00Z',
      }),
    ]);
  });

  it('a failed booking leaves no half-created event, attendee or occurrence behind', async () => {
    await post('ana', meeting());
    const before = [
      await count('events'),
      await count('event_occurrences'),
      await count('event_attendees'),
    ];
    const r = await post('bob', meeting({ attendeeIds: [ids.ana] }));
    expect(r.status).toBe(409);
    expect([
      await count('events'),
      await count('event_occurrences'),
      await count('event_attendees'),
    ]).toEqual(before);
  });

  it('back-to-back and other-room bookings are fine', async () => {
    created(await post('ana', meeting()));
    created(
      await post(
        'ana',
        meeting({ startAt: '2026-12-01T11:00:00Z', endAt: '2026-12-01T12:00:00Z' }),
      ),
    );
    created(
      await post(
        'ana',
        meeting({ startAt: '2026-12-01T09:00:00Z', endAt: '2026-12-01T10:00:00Z' }),
      ),
    );
    created(await post('ana', meeting({ roomId: world.roomB })));
  });

  it('reports every blocker of a series (up to 5), not just one', async () => {
    created(
      await post(
        'ana',
        meeting({ title: 'Mon', startAt: '2026-12-07T10:00:00Z', endAt: '2026-12-07T11:00:00Z' }),
      ),
    );
    created(
      await post(
        'ana',
        meeting({ title: 'Tue', startAt: '2026-12-08T10:00:00Z', endAt: '2026-12-08T11:00:00Z' }),
      ),
    );
    const r = await post(
      'bob',
      meeting({
        title: 'Daily',
        startAt: '2026-12-07T10:00:00Z',
        endAt: '2026-12-07T11:00:00Z',
        rrule: 'FREQ=DAILY;COUNT=3',
      }),
    );
    expect(r.status).toBe(409);
    expect(r.body.error.details.blockers.map((b: { title: string }) => b.title)).toEqual([
      'Mon',
      'Tue',
    ]);
    expect(await count('events')).toBe(2);
  });

  it('10 simultaneous bookings of one slot: exactly one wins, the rest get a clean ROOM_CONFLICT (no 500)', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        post(i % 2 ? 'ana' : 'bob', meeting({ title: `Racer ${i}` })),
      ),
    );
    const wins = results.filter((r) => r.status === 201);
    const losses = results.filter((r) => r.status === 409);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(9);
    for (const l of losses) {
      expect(l.body.error.code).toBe('ROOM_CONFLICT');
      expect(l.body.error.details.blockers.length).toBeGreaterThanOrEqual(1);
    }
    expect([await count('events'), await count('event_occurrences')]).toEqual([1, 1]);
  });

  it('an all-day event blocks the whole room for those local days', async () => {
    created(
      await post(
        'ana',
        meeting({
          title: 'Offsite',
          allDay: true,
          tzid: 'Europe/Kyiv',
          startAt: '2026-03-27T22:00:00Z',
          endAt: '2026-03-30T21:00:00Z',
        }),
      ),
    );
    const clash = await post(
      'bob',
      meeting({ startAt: '2026-03-29T13:00:00Z', endAt: '2026-03-29T14:00:00Z' }),
    );
    expect(clash.status).toBe(409);
    const occ = await occurrences('2026-03-29T00:00:00Z', '2026-03-29T12:00:00Z');
    expect(occ.map((o) => [o.title, o.start, o.end])).toEqual([
      ['Offsite', '2026-03-27T22:00:00Z', '2026-03-30T21:00:00Z'],
    ]);
    created(
      await post(
        'bob',
        meeting({ startAt: '2026-03-30T21:00:00Z', endAt: '2026-03-30T22:00:00Z' }),
      ),
    ); // right after
  });
});
