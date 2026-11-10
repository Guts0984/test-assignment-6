import { describe, expect, it } from 'vitest';
import { created, ids, req, reply, world, setupApiWorld } from '@/server/tools/testing/harness';
import { h, post, occurrences, meeting } from './api';

setupApiWorld();

describe('create + list', () => {
  it('creates an event that shows up with creator, attendees and UTC ISO times', async () => {
    const r = await post('ana', meeting({ attendeeIds: [ids.bob], description: 'Agenda' }));
    const ev = created(r);
    expect(r.body.events[0]).toMatchObject({
      roomId: world.roomA,
      tzid: 'Europe/Kyiv',
      rrule: null,
      version: 1,
      attendeeIds: [ids.bob],
      creatorId: ids.ana,
    });
    const occ = await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z');
    expect(occ).toHaveLength(1);
    expect(occ[0]).toMatchObject({
      eventId: ev.id,
      start: '2026-12-01T10:00:00Z',
      end: '2026-12-01T11:00:00Z',
      creator: { name: 'Ana' },
      recurring: false,
    });
  });

  it('normalizes offsets to UTC and defaults the time zone to the creator profile', async () => {
    const r = await post(
      'bob',
      meeting({ startAt: '2026-12-01T05:00:00-05:00', endAt: '2026-12-01T06:00:00-05:00' }),
    );
    expect(r.body.events[0]).toMatchObject({
      startAt: '2026-12-01T10:00:00Z',
      tzid: 'America/New_York',
    });
  });

  it('window edges are half-open: ending exactly at `from` or starting exactly at `to` is not returned', async () => {
    await post('ana', meeting());
    expect(await occurrences('2026-12-01T11:00:00Z', '2026-12-02T00:00:00Z')).toHaveLength(0);
    expect(await occurrences('2026-11-30T00:00:00Z', '2026-12-01T10:00:00Z')).toHaveLength(0);
    expect(await occurrences('2026-12-01T10:59:59Z', '2026-12-01T11:00:00Z')).toHaveLength(1);
  });

  it('filters by rooms and returns results ordered by start', async () => {
    await post(
      'ana',
      meeting({
        roomId: world.roomB,
        title: 'Late',
        startAt: '2026-12-01T15:00:00Z',
        endAt: '2026-12-01T16:00:00Z',
      }),
    );
    await post(
      'ana',
      meeting({
        roomId: world.roomA,
        title: 'Early',
        startAt: '2026-12-01T08:00:00Z',
        endAt: '2026-12-01T09:00:00Z',
      }),
    );
    await post(
      'ana',
      meeting({
        roomId: world.roomC,
        title: 'Mid',
        startAt: '2026-12-01T12:00:00Z',
        endAt: '2026-12-01T13:00:00Z',
      }),
    );
    const all = await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z');
    expect(all.map((o) => o.title)).toEqual(['Early', 'Mid', 'Late']);
    const some = await occurrences(
      '2026-12-01T00:00:00Z',
      '2026-12-02T00:00:00Z',
      `&rooms=${world.roomA},${world.roomB}`,
    );
    expect(some.map((o) => o.title)).toEqual(['Early', 'Late']);
  });

  it.each([
    ['missing from', 'to=2026-12-02T00:00:00Z'],
    ['from after to', 'from=2026-12-02T00:00:00Z&to=2026-12-01T00:00:00Z'],
    ['from equals to', 'from=2026-12-01T00:00:00Z&to=2026-12-01T00:00:00Z'],
    ['no offset', 'from=2026-12-01T00:00:00&to=2026-12-02T00:00:00Z'],
    ['range over 124 days', 'from=2026-12-01T00:00:00Z&to=2027-04-10T00:00:00Z'],
    ['bad room id', 'from=2026-12-01T00:00:00Z&to=2026-12-02T00:00:00Z&rooms=nope'],
    ['too far in the future', 'from=2033-01-01T00:00:00Z&to=2033-01-02T00:00:00Z'],
  ])('rejects a bad list query: %s', async (_n, qs) => {
    const r = await h
      .list(req('GET', `/api/events?${qs.replaceAll('+', '%2B')}`, 'ana'))
      .then(reply);
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('VALIDATION');
  });
});
