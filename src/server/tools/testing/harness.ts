import { Temporal } from '@js-temporal/polyfill';
import { NextRequest } from 'next/server';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, expect } from 'vitest';
import { createDb, type Db } from '@/server/core/db';
import { createSession, hashPassword, users, type AuthDeps } from '@/server/modules/auth';
import { rooms } from '@/server/modules/rooms';
import { testUrl, truncateAll } from './db';

/**
 * Shared setup of the API-level integration tests: a real database with two users (Ana in Kyiv,
 * Bob in New York), three rooms and a session for each user, rebuilt before every test.
 * Call `setupApiWorld()` once at the top of a test file.
 */

export const NOW = Temporal.Instant.from('2026-11-10T12:00:00Z');
export const sessionConfig = { secret: 'x'.repeat(40), ttlDays: 14, secureCookies: false };

export type Who = 'ana' | 'bob' | 'none';
export type Reply = { status: number; body: any }; // eslint-disable-line @typescript-eslint/no-explicit-any -- tests read untyped JSON

/** Filled in by `setupApiWorld()`; read it lazily (inside tests), never at import time. */
export const world = {
  db: undefined as unknown as Db,
  raw: undefined as unknown as postgres.Sql,
  roomA: '',
  roomB: '',
  roomC: '',
};
export const ids: Record<'ana' | 'bob', string> = { ana: '', bob: '' };
export const tokens: Record<'ana' | 'bob', string> = { ana: '', bob: '' };

export const deps = (): AuthDeps => ({
  db: () => world.db,
  now: () => NOW,
  config: () => sessionConfig,
});

/** Empties the database and creates the users, rooms and sessions again. */
export async function resetWorld(): Promise<void> {
  await truncateAll(world.raw);
  const hash = await hashPassword('demo-pass-123');
  const created = await world.db
    .insert(users)
    .values([
      {
        email: 'ana@example.com',
        passwordHash: hash,
        name: 'Ana',
        timezone: 'Europe/Kyiv',
        locale: 'uk',
      },
      {
        email: 'bob@example.com',
        passwordHash: hash,
        name: 'Bob',
        timezone: 'America/New_York',
        locale: 'en',
      },
    ])
    .returning();
  ids.ana = created[0]!.id;
  ids.bob = created[1]!.id;
  tokens.ana = (await createSession(world.db, ids.ana, sessionConfig, NOW)).token;
  tokens.bob = (await createSession(world.db, ids.bob, sessionConfig, NOW)).token;
  const r = await world.db
    .insert(rooms)
    .values([
      { name: 'A', floor: 1, capacity: 4 },
      { name: 'B', floor: 1, capacity: 4 },
      { name: 'C', floor: 2, capacity: 4 },
    ])
    .returning();
  [world.roomA, world.roomB, world.roomC] = [r[0]!.id, r[1]!.id, r[2]!.id];
}

export function setupApiWorld(): void {
  let close: () => Promise<void>;
  beforeAll(() => {
    ({ db: world.db, close } = createDb(testUrl(), 15));
    world.raw = postgres(testUrl(), { max: 1, onnotice: () => {} });
  });
  afterAll(async () => {
    await world.raw.end();
    await close();
  });
  beforeEach(resetWorld);
}

/** A request as the browser would send it, with the session cookie of `who`. */
export function req(method: string, path: string, who: Who, body?: unknown, origin?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    headers: {
      host: 'localhost:3000',
      'content-type': 'application/json',
      ...(who !== 'none' ? { cookie: `session=${tokens[who]}` } : {}),
      ...(origin ? { origin } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Next.js route context for `/api/events/[id]`. */
export const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });

export const reply = async (r: Response): Promise<Reply> => ({
  status: r.status,
  body: await r.json(),
});

export const count = async (table: string): Promise<number> =>
  (
    (await world.raw.unsafe(`select count(*)::int as n from ${table}`))[0] as unknown as {
      n: number;
    }
  ).n;

/** Asserts a 201 and returns the created event. */
export const created = (r: Reply) => {
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.events[0] as { id: string; version: number };
};
