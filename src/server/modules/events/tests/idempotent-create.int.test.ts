import { describe, expect, it } from 'vitest';
import { count, created, ids, setupApiWorld } from '@/server/tools/testing/harness';
import { del, getOne, meeting, occurrences, patch, post } from './api';

setupApiWorld();

const ID = '8f3c2a10-5b7e-4c1d-9a40-1b2c3d4e5f60';
const day = ['2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z'] as const;

describe('creating with a client-chosen id', () => {
  it('uses the id the client sent', async () => {
    const ev = created(await post('ana', meeting({ id: ID })));
    expect(ev.id).toBe(ID);
  });

  it('a repeated request (lost response, offline replay) answers 200 with the existing event and creates nothing', async () => {
    const first = await post('ana', meeting({ id: ID, attendeeIds: [ids.bob] }));
    expect(first.status).toBe(201);
    const again = await post('ana', meeting({ id: ID, attendeeIds: [ids.bob] }));
    expect(again.status).toBe(200);
    expect(again.body.events[0]).toMatchObject({ id: ID, version: 1 });
    expect(again.body.replayed).toBe(true);
    expect([
      await count('events'),
      await count('event_occurrences'),
      await count('event_attendees'),
    ]).toEqual([1, 1, 1]);
  });

  it('the repeat returns the CURRENT state of the event, not the stale request body', async () => {
    await post('ana', meeting({ id: ID }));
    await patch('bob', ID, { version: 1, title: 'Renamed meanwhile' });
    const again = await post('ana', meeting({ id: ID, title: 'Original title' }));
    expect(again.status).toBe(200);
    expect(again.body.events[0]).toMatchObject({ title: 'Renamed meanwhile', version: 2 });
  });

  it('works while the room is busy: a replay does not collide with the event it already created', async () => {
    await post('ana', meeting({ id: ID }));
    expect((await post('ana', meeting({ id: ID }))).status).toBe(200); // same slot, same room: still fine
    expect((await post('ana', meeting({ title: 'Other' }))).status).toBe(409); // a different event is refused
  });

  it("another user cannot take over somebody else's id", async () => {
    await post('ana', meeting({ id: ID }));
    const r = await post(
      'bob',
      meeting({ id: ID, startAt: '2026-12-05T10:00:00Z', endAt: '2026-12-05T11:00:00Z' }),
    );
    expect(r.status).toBe(400);
    expect(r.body.error.details[0].path).toBe('id');
    expect(await count('events')).toBe(1);
  });

  it('11 simultaneous identical requests: one event, every caller gets a success (no 500, no 409)', async () => {
    const rs = await Promise.all(
      Array.from({ length: 11 }, () => post('ana', meeting({ id: ID }))),
    );
    expect(rs.map((r) => r.status).sort()).toEqual([
      200, 200, 200, 200, 200, 200, 200, 200, 200, 200, 201,
    ]);
    expect([await count('events'), await count('event_occurrences')]).toEqual([1, 1]);
  });

  it('rejects a malformed id', async () => {
    for (const id of ['abc', '', 123, '8f3c2a10-5b7e-4c1d-9a40-1b2c3d4e5f6']) {
      expect((await post('ana', meeting({ id }))).status, String(id)).toBe(400);
    }
    expect(await count('events')).toBe(0);
  });

  it('delete then create with the same id works (undo of a delete restores the very same event)', async () => {
    await post('ana', meeting({ id: ID, title: 'Precious' }));
    expect((await del('ana', ID, 'version=1')).status).toBe(200);
    expect((await getOne('ana', ID)).status).toBe(404);
    const back = await post('ana', meeting({ id: ID, title: 'Precious' }));
    expect(back.status).toBe(201);
    expect((await occurrences(...day)).map((o) => [o.eventId, o.title])).toEqual([
      [ID, 'Precious'],
    ]);
  });

  it('a replay does not publish a second change message', async () => {
    const { getBus } = await import('@/server/modules/realtime');
    await post('ana', meeting({ id: ID }));
    const before = getBus().latestId();
    await post('ana', meeting({ id: ID }));
    expect(getBus().latestId()).toBe(before);
  });
});
