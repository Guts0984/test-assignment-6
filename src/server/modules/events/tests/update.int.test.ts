import { describe, expect, it } from 'vitest';
import { created, ids, world, setupApiWorld } from '@/server/tools/testing/harness';
import { post, patch, getOne, occurrences, starts, meeting } from './api';

setupApiWorld();

describe('PATCH: versions and conflicts (acceptance #7, #11 foundations)', () => {
  it('updates and bumps the version; the new time replaces the old one in the grid', async () => {
    const ev = created(await post('ana', meeting()));
    const r = await patch('ana', ev.id, {
      version: 1,
      title: 'Moved',
      startAt: '2026-12-01T14:00:00Z',
      endAt: '2026-12-01T15:30:00Z',
    });
    expect(r.status).toBe(200);
    expect(r.body.events[0]).toMatchObject({ version: 2, title: 'Moved' });
    const occ = await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z');
    expect(occ.map((o) => [o.start, o.end])).toEqual([
      ['2026-12-01T14:00:00Z', '2026-12-01T15:30:00Z'],
    ]);
  });

  it('a stale version gets 409 VERSION_CONFLICT with the current server state, and changes nothing', async () => {
    const ev = created(await post('ana', meeting()));
    await patch('bob', ev.id, { version: 1, title: 'Bob was first' });
    const r = await patch('ana', ev.id, { version: 1, title: 'Ana is late' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('VERSION_CONFLICT');
    expect(r.body.error.details.current).toMatchObject({ version: 2, title: 'Bob was first' });
    expect((await getOne('ana', ev.id)).body.event.title).toBe('Bob was first');
  });

  it('two concurrent PATCHes with the same version: exactly one wins', async () => {
    const ev = created(await post('ana', meeting()));
    const rs = await Promise.all([
      patch('ana', ev.id, { version: 1, title: 'From Ana' }),
      patch('bob', ev.id, { version: 1, title: 'From Bob' }),
      patch('ana', ev.id, { version: 1, description: 'third' }),
    ]);
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(
      rs.filter((r) => r.status === 409 && r.body.error.code === 'VERSION_CONFLICT'),
    ).toHaveLength(2);
    expect((await getOne('ana', ev.id)).body.event.version).toBe(2);
  });

  it('moving into a busy slot fails with the blocker and rolls back everything (version, room, time)', async () => {
    created(
      await post(
        'bob',
        meeting({
          roomId: world.roomB,
          title: 'Bob has B',
          startAt: '2026-12-01T12:00:00Z',
          endAt: '2026-12-01T13:00:00Z',
        }),
      ),
    );
    const ev = created(await post('ana', meeting()));
    const r = await patch('ana', ev.id, {
      version: 1,
      roomId: world.roomB,
      title: 'Renamed too',
      startAt: '2026-12-01T12:30:00Z',
      endAt: '2026-12-01T13:30:00Z',
    });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ROOM_CONFLICT');
    expect(r.body.error.details.blockers[0]).toMatchObject({
      title: 'Bob has B',
      creator: { name: 'Bob' },
    });
    const after = (await getOne('ana', ev.id)).body.event;
    expect([after.version, after.roomId, after.title, after.startAt]).toEqual([
      1,
      world.roomA,
      'Meeting',
      '2026-12-01T10:00:00Z',
    ]);
    expect(
      starts(
        await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z', `&rooms=${world.roomA}`),
      ),
    ).toEqual(['2026-12-01T10:00:00Z']);
  });

  it('an event can be moved to overlap ITS OWN old time (extend / nudge by 15 min)', async () => {
    const ev = created(await post('ana', meeting()));
    const r = await patch('ana', ev.id, {
      version: 1,
      startAt: '2026-12-01T10:15:00Z',
      endAt: '2026-12-01T11:15:00Z',
    });
    expect(r.status).toBe(200);
  });

  it('changes attendees and room', async () => {
    const ev = created(await post('ana', meeting({ attendeeIds: [ids.bob] })));
    const r = await patch('ana', ev.id, {
      version: 1,
      roomId: world.roomC,
      attendeeIds: [ids.ana],
    });
    expect(r.body.events[0]).toMatchObject({
      roomId: world.roomC,
      attendeeIds: [ids.ana],
      version: 2,
    });
    expect((await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z'))[0]?.roomId).toBe(
      world.roomC,
    );
  });

  it.each([
    ['no version', { title: 'x' }],
    ['version 0', { version: 0, title: 'x' }],
    ['nothing to change', { version: 1 }],
    ['startAt without endAt', { version: 1, startAt: '2026-12-01T10:00:00Z' }],
    [
      'end before start',
      { version: 1, startAt: '2026-12-01T10:00:00Z', endAt: '2026-12-01T09:00:00Z' },
    ],
    ['unknown field', { version: 1, creatorId: '00000000-0000-4000-8000-000000000000' }],
    [
      'scope on a non-recurring event',
      { version: 1, title: 'x', scope: 'this', occurrenceStart: '2026-12-01T10:00:00Z' },
    ],
    ['unknown room', { version: 1, roomId: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects %s with 400 and changes nothing', async (_n, body) => {
    const ev = created(await post('ana', meeting()));
    const r = await patch('ana', ev.id, body);
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    expect((await getOne('ana', ev.id)).body.event).toMatchObject({
      version: 1,
      title: 'Meeting',
      roomId: world.roomA,
    });
  });

  it('404 for unknown and malformed ids', async () => {
    expect(
      (await patch('ana', '00000000-0000-4000-8000-000000000000', { version: 1, title: 'x' }))
        .status,
    ).toBe(404);
    expect((await patch('ana', 'not-a-uuid', { version: 1, title: 'x' })).status).toBe(404);
    expect((await getOne('ana', 'not-a-uuid')).status).toBe(404);
  });
});
