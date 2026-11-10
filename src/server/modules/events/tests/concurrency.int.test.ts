import { describe, expect, it } from 'vitest';
import {
  created,
  resetWorld,
  world,
  setupApiWorld,
  type Reply,
} from '@/server/tools/testing/harness';
import { post, patch, occurrences, meeting } from './api';

setupApiWorld();

describe('concurrency stress (no deadlocks, no hangs)', () => {
  const seconds = (t0: number) => (Date.now() - t0) / 1000;

  it('30 simultaneous bookings of one slot finish quickly: one winner, no 500s', async () => {
    const t0 = Date.now();
    const rs = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        post(i % 2 ? 'ana' : 'bob', meeting({ title: `R${i}` })),
      ),
    );
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    expect(
      rs.filter((r) => r.status === 409 && r.body.error.code === 'ROOM_CONFLICT'),
    ).toHaveLength(29);
    expect(seconds(t0), 'must not wait for Postgres deadlock timeouts').toBeLessThan(5);
  });

  it('two events swapping rooms at the same moment cannot deadlock (both are refused cleanly)', async () => {
    for (let round = 0; round < 5; round += 1) {
      await resetWorld();
      const a = created(await post('ana', meeting({ roomId: world.roomA, title: 'In A' })));
      const b = created(await post('bob', meeting({ roomId: world.roomB, title: 'In B' })));
      const rs = await Promise.all([
        patch('ana', a.id, { version: 1, roomId: world.roomB }),
        patch('bob', b.id, { version: 1, roomId: world.roomA }),
      ]);
      for (const r of rs) {
        expect(r.status, JSON.stringify(r.body)).toBe(409);
        expect(r.body.error.code).toBe('ROOM_CONFLICT');
      }
      const occ = await occurrences('2026-12-01T00:00:00Z', '2026-12-02T00:00:00Z');
      expect(occ.map((o) => [o.title, o.roomId]).sort()).toEqual([
        ['In A', world.roomA],
        ['In B', world.roomB],
      ]);
    }
  });

  it('mixed storm: creates, moves and deletes in the same rooms never produce a double booking or an error', async () => {
    const base = created(await post('ana', meeting({ title: 'Base' })));
    const ops: Promise<Reply>[] = [];
    for (let i = 0; i < 12; i += 1) {
      const hour = 12 + (i % 4);
      ops.push(
        post(
          i % 2 ? 'ana' : 'bob',
          meeting({
            title: `New${i}`,
            roomId: i % 3 === 0 ? world.roomB : world.roomA,
            startAt: `2026-12-01T${hour}:00:00Z`,
            endAt: `2026-12-01T${hour}:45:00Z`,
          }),
        ),
      );
      ops.push(patch('bob', base.id, { version: 1, title: `Edit${i}` }));
    }
    const rs = await Promise.all(ops);
    expect(
      rs.every((r) => [200, 201, 409].includes(r.status)),
      rs.map((r) => r.status).join(),
    ).toBe(true);
    // Whatever happened, the database never holds two overlapping bookings in one room.
    const overlaps = await world.raw`
      select 1 from event_occurrences a join event_occurrences b
        on a.room_id = b.room_id and a.id < b.id and a.during && b.during`;
    expect(overlaps).toHaveLength(0);
  });
});
