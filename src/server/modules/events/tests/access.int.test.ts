import { describe, expect, it } from 'vitest';
import { created, ctxOf, ids, req, reply, setupApiWorld } from '@/server/tools/testing/harness';
import { h, post, patch, del, getOne, list, meeting } from './api';

setupApiWorld();

describe('access control', () => {
  it('every endpoint answers 401 without a session', async () => {
    const id = created(await post('ana', meeting())).id;
    const replies = await Promise.all([
      list('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z', '', 'none'),
      h.rooms(req('GET', '/api/rooms', 'none')).then(reply),
      post('none', meeting()),
      getOne('none', id),
      patch('none', id, { version: 1, title: 'x' }),
      del('none', id, 'version=1'),
    ]);
    expect(replies.map((r) => r.status)).toEqual([401, 401, 401, 401, 401, 401]);
    expect(replies.every((r) => r.body.error.code === 'UNAUTHENTICATED')).toBe(true);
  });

  it('mutations from another origin are refused (403) and change nothing', async () => {
    const evil = 'https://evil.example';
    expect((await h.create(req('POST', '/api/events', 'ana', meeting(), evil))).status).toBe(403);
    const id = created(await post('ana', meeting())).id;
    expect(
      (
        await h.update(
          req('PATCH', `/api/events/${id}`, 'ana', { version: 1, title: 'x' }, evil),
          ctxOf(id),
        )
      ).status,
    ).toBe(403);
    expect(
      (await h.del(req('DELETE', `/api/events/${id}?version=1`, 'ana', undefined, evil), ctxOf(id)))
        .status,
    ).toBe(403);
    const after = await getOne('ana', id);
    expect([after.body.event.title, after.body.event.version]).toEqual(['Meeting', 1]);
  });

  it('any signed-in user may edit any event (documented decision: shared office calendar)', async () => {
    const id = created(await post('ana', meeting())).id;
    const r = await patch('bob', id, { version: 1, title: 'Renamed by Bob' });
    expect(r.status).toBe(200);
    expect(r.body.events[0].creatorId).toBe(ids.ana);
  });
});
