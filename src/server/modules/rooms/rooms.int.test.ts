import { describe, expect, it } from 'vitest';
import { deps, reply, req, setupApiWorld } from '@/server/tools/testing/harness';
import { makeListRoomsHandler } from './http';

setupApiWorld();
const listRooms = makeListRoomsHandler(deps());

describe('GET /api/rooms', () => {
  it('lists rooms by floor and name', async () => {
    const r = await listRooms(req('GET', '/api/rooms', 'ana')).then(reply);
    expect(r.status).toBe(200);
    expect(r.body.rooms.map((x: { name: string }) => x.name)).toEqual(['A', 'B', 'C']);
  });

  it('requires a session', async () => {
    expect((await listRooms(req('GET', '/api/rooms', 'none'))).status).toBe(401);
  });
});
