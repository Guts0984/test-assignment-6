import { Temporal } from '@js-temporal/polyfill';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { parseInstant } from '@/shared/time';
import { verifyPassword } from '../auth/password';
import { createDb, type Db } from '../db/client';
import { testUrl, truncateAll } from '../db/test-utils';
import { occurrencesOf } from '../events/materialize';
import { TARGET_OCCURRENCES } from './data';
import { seedIfEmpty } from './seed';

const NOW = Temporal.Instant.from('2026-11-10T14:30:00Z');
const opts = { now: NOW, password: 'demo-pass-123' };

let db: Db;
let close: () => Promise<void>;
let raw: postgres.Sql;

beforeAll(() => {
  ({ db, close } = createDb(testUrl(), 6));
  raw = postgres(testUrl(), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await raw.end();
  await close();
});
beforeEach(async () => {
  await truncateAll(raw);
});

describe('seedIfEmpty (real Postgres)', () => {
  it('inserts users, 50 rooms and 2000 occurrences in the next two months', async () => {
    const r = await seedIfEmpty(db, opts);
    expect(r).toMatchObject({ seeded: true, users: 3, rooms: 50 });
    const [inWin] = await raw`
      select count(*)::int as n from event_occurrences
      where lower(during) >= ${'2026-11-10T14:00:00Z'}::timestamptz
        and lower(during) <  ${'2027-01-10T14:00:00Z'}::timestamptz`;
    expect(inWin?.n).toBe(TARGET_OCCURRENCES);
  });

  it('is idempotent: second run does nothing and changes nothing', async () => {
    const first = await seedIfEmpty(db, opts);
    const second = await seedIfEmpty(db, { ...opts, now: NOW.add({ hours: 72 }) });
    expect(second.seeded).toBe(false);
    expect(second).toMatchObject({
      users: first.users,
      rooms: first.rooms,
      events: first.events,
      occurrences: first.occurrences,
    });
  });

  it('concurrent starts (two containers) seed exactly once', async () => {
    const results = await Promise.all([
      seedIfEmpty(db, opts),
      seedIfEmpty(db, opts),
      seedIfEmpty(db, opts),
    ]);
    expect(results.filter((r) => r.seeded)).toHaveLength(1);
    const [u] = await raw`select count(*)::int as n from users`;
    expect(u?.n).toBe(3);
  });

  it('creates users who can log in with the seed password, in the required time zones', async () => {
    await seedIfEmpty(db, opts);
    const users = await raw`select email, timezone, password_hash from users order by email`;
    expect(users.map((u) => [u.email, u.timezone])).toEqual([
      ['ana@example.com', 'Europe/Kyiv'],
      ['bob@example.com', 'America/New_York'],
      ['kenji@example.com', 'Asia/Tokyo'],
    ]);
    for (const u of users) {
      expect(await verifyPassword('demo-pass-123', u.password_hash as string)).toBe(true);
      expect(await verifyPassword('wrong', u.password_hash as string)).toBe(false);
    }
  });

  it('stored occurrences equal a fresh expansion of each event (materialization is consistent)', async () => {
    await seedIfEmpty(db, opts);
    const events =
      await raw`select id, start_at::text, end_at::text, tzid, all_day, rrule, exdates::text[] as exdates, materialized_until::text as mu from events`;
    const occ =
      await raw`select event_id, lower(during)::text as lo, upper(during)::text as up from event_occurrences`;
    const stored = new Map<string, string[]>();
    for (const o of occ) {
      const k = `${parseInstant(o.lo as string)}..${parseInstant(o.up as string)}`;
      stored.set(o.event_id as string, [...(stored.get(o.event_id as string) ?? []), k]);
    }
    expect(events.length).toBeGreaterThan(100);
    for (const e of events) {
      const expected = occurrencesOf(
        {
          startAt: e.start_at,
          endAt: e.end_at,
          tzid: e.tzid,
          allDay: e.all_day,
          rrule: e.rrule,
          exdates: e.exdates,
        },
        e.mu ? parseInstant(e.mu) : parseInstant(e.end_at),
      ).map((o) => `${o.start}..${o.end}`);
      expect((stored.get(e.id) ?? []).sort(), String(e.id)).toEqual(expected.sort());
    }
  });

  it('every recurring series keeps 09:00 Kyiv wall-clock in the database too (acceptance #3)', async () => {
    await seedIfEmpty(db, opts);
    const rows = await raw`
      select (lower(o.during) at time zone 'Europe/Kyiv')::text as local
      from event_occurrences o join events e on e.id = o.event_id
      where e.title = 'Weekly planning'`;
    expect(rows.length).toBeGreaterThan(50);
    for (const r of rows) expect(String(r.local)).toContain('09:00:00');
  });

  it('fails atomically: a failing seed leaves the database empty', async () => {
    // A password that violates nothing, but pre-existing room name collides with the plan.
    await raw`insert into rooms (name, floor, capacity) values ('Room 101', 1, 4)`;
    await expect(seedIfEmpty(db, opts)).rejects.toThrow();
    const [u] = await raw`select count(*)::int as n from users`;
    const [e] = await raw`select count(*)::int as n from events`;
    expect([u?.n, e?.n]).toEqual([0, 0]);
  });
});
