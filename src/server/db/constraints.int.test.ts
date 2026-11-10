import { eq, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from './client';
import * as s from './schema';
import { testUrl, truncateAll } from './test-utils';

let db: Db;
let close: () => Promise<void>;
let raw: postgres.Sql;

let userId: string;
let roomA: string;
let roomB: string;

beforeAll(() => {
  ({ db, close } = createDb(testUrl(), 15));
  raw = postgres(testUrl(), { max: 1, onnotice: () => {} });
});
afterAll(async () => {
  await raw.end();
  await close();
});

beforeEach(async () => {
  await truncateAll(raw);
  const [u] = await db
    .insert(s.users)
    .values({ email: 'a@x.test', passwordHash: 'h', name: 'A', timezone: 'Europe/Kyiv' })
    .returning();
  const rooms = await db
    .insert(s.rooms)
    .values([
      { name: 'Room A', floor: 1, capacity: 4 },
      { name: 'Room B', floor: 1, capacity: 4 },
    ])
    .returning();
  userId = u!.id;
  roomA = rooms[0]!.id;
  roomB = rooms[1]!.id;
});

/** Postgres error code, looking through Drizzle's DrizzleQueryError wrapper. */
function pgError(e: unknown): { code?: string; constraint?: string } {
  const err = e as { code?: string; constraint_name?: string; cause?: unknown };
  if (err.code) return { code: err.code, constraint: err.constraint_name };
  if (err.cause) return pgError(err.cause);
  return {};
}

async function expectPgError(p: Promise<unknown>, code: string, constraint?: string) {
  try {
    await p;
  } catch (e) {
    const got = pgError(e);
    expect(got.code, `unexpected error: ${String(e)}`).toBe(code);
    if (constraint) expect(got.constraint).toBe(constraint);
    return;
  }
  expect.unreachable(`expected Postgres error ${code}, but the statement succeeded`);
}

async function makeEvent(roomId: string, over: Partial<typeof s.events.$inferInsert> = {}) {
  const [e] = await db
    .insert(s.events)
    .values({
      roomId,
      creatorId: userId,
      title: 'Standup',
      startAt: '2026-03-30T07:00:00Z',
      endAt: '2026-03-30T08:00:00Z',
      tzid: 'Europe/Kyiv',
      ...over,
    })
    .returning();
  return e!;
}

const range = (a: string, b: string) => `[${a},${b})`;
async function occupy(eventId: string, roomId: string, during: string) {
  await db.insert(s.eventOccurrences).values({ eventId, roomId, during });
}

describe('room exclusion constraint', () => {
  it('exists and is an exclusion constraint', async () => {
    const rows =
      await raw`select contype from pg_constraint where conname = 'occurrences_no_room_overlap'`;
    expect(rows[0]?.contype).toBe('x');
  });

  it.each([
    ['identical', '2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'],
    ['starts inside', '2026-03-30T07:30:00Z', '2026-03-30T08:30:00Z'],
    ['ends inside', '2026-03-30T06:30:00Z', '2026-03-30T07:30:00Z'],
    ['contained', '2026-03-30T07:10:00Z', '2026-03-30T07:20:00Z'],
    ['contains', '2026-03-30T06:00:00Z', '2026-03-30T09:00:00Z'],
    ['1 minute overlap at the end', '2026-03-30T07:59:00Z', '2026-03-30T09:00:00Z'],
  ])('rejects an overlapping booking in the same room: %s', async (_name, a, b) => {
    const e1 = await makeEvent(roomA);
    await occupy(e1.id, roomA, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
    const e2 = await makeEvent(roomA, { title: 'Other' });
    await expectPgError(occupy(e2.id, roomA, range(a, b)), '23P01', 'occurrences_no_room_overlap');
  });

  it('allows back-to-back bookings (ranges are half-open)', async () => {
    const e1 = await makeEvent(roomA);
    await occupy(e1.id, roomA, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
    const e2 = await makeEvent(roomA, { title: 'Next' });
    await occupy(e2.id, roomA, range('2026-03-30T08:00:00Z', '2026-03-30T09:00:00Z'));
    const e3 = await makeEvent(roomA, { title: 'Prev' });
    await occupy(e3.id, roomA, range('2026-03-30T06:00:00Z', '2026-03-30T07:00:00Z'));
  });

  it('allows the same time in a different room', async () => {
    const e1 = await makeEvent(roomA);
    await occupy(e1.id, roomA, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
    const e2 = await makeEvent(roomB);
    await occupy(e2.id, roomB, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
  });

  it('compares instants, not offsets: 09:00+02 equals 07:00Z', async () => {
    const e1 = await makeEvent(roomA);
    await occupy(e1.id, roomA, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
    const e2 = await makeEvent(roomA, { title: 'Kyiv wall clock' });
    await expectPgError(
      occupy(e2.id, roomA, range('2026-03-30T09:00:00+02:00', '2026-03-30T10:00:00+02:00')),
      '23P01',
    );
  });

  it('exactly one of many concurrent bookings of the same slot wins (real race)', async () => {
    const events = await Promise.all(
      Array.from({ length: 10 }, (_, i) => makeEvent(roomA, { title: `Racer ${i}` })),
    );
    const during = range('2026-04-01T10:00:00Z', '2026-04-01T11:00:00Z');
    const results = await Promise.allSettled(
      events.map((e) =>
        // Each in its own transaction with a small hold, to force real interleaving.
        db.transaction(async (tx) => {
          await tx.insert(s.eventOccurrences).values({ eventId: e.id, roomId: roomA, during });
          await tx.execute(sql`select pg_sleep(0.05)`);
        }),
      ),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const failed = results.filter((r) => r.status === 'rejected');
    expect(ok).toHaveLength(1);
    expect(failed).toHaveLength(9);
    // Losers get 23P01 (exclusion violation), or 40P01 when Postgres breaks a deadlock between two
    // concurrent inserters that each wait on the other's uncommitted row. Both mean "not booked";
    // the API layer retries 40P01 once so the user sees the clean 409 (stage 4).
    for (const f of failed) {
      expect(['23P01', '40P01']).toContain(pgError((f as PromiseRejectedResult).reason).code);
    }
    const count = await raw`select count(*)::int as n from event_occurrences`;
    expect(count[0]?.n).toBe(1);
  });

  it('frees the slot when the event is deleted (cascade)', async () => {
    const e1 = await makeEvent(roomA);
    const during = range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z');
    await occupy(e1.id, roomA, during);
    await db.delete(s.events).where(eq(s.events.id, e1.id));
    const left = await raw`select count(*)::int as n from event_occurrences`;
    expect(left[0]?.n).toBe(0);
    const e2 = await makeEvent(roomA, { title: 'Reuse' });
    await occupy(e2.id, roomA, during);
  });
});

describe('occurrence integrity', () => {
  it('rejects an occurrence whose room differs from its event room', async () => {
    const e = await makeEvent(roomA);
    await expectPgError(
      occupy(e.id, roomB, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z')),
      '23503',
      'occurrences_event_room_fk',
    );
  });

  it('moving an event to another room carries its occurrences along', async () => {
    const e = await makeEvent(roomA);
    await occupy(e.id, roomA, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
    await db.update(s.events).set({ roomId: roomB }).where(eq(s.events.id, e.id));
    const rows = await raw`select room_id from event_occurrences where event_id = ${e.id}`;
    expect(rows.map((r) => r.room_id)).toEqual([roomB]);
  });

  it('moving an event into a busy room fails and leaves everything unchanged', async () => {
    const e1 = await makeEvent(roomA);
    await occupy(e1.id, roomA, range('2026-03-30T07:00:00Z', '2026-03-30T08:00:00Z'));
    const e2 = await makeEvent(roomB, { title: 'Blocker' });
    await occupy(e2.id, roomB, range('2026-03-30T07:30:00Z', '2026-03-30T08:30:00Z'));

    await expectPgError(
      db.update(s.events).set({ roomId: roomB }).where(eq(s.events.id, e1.id)),
      '23P01',
    );
    const [ev] = await db.select().from(s.events).where(eq(s.events.id, e1.id));
    expect(ev?.roomId).toBe(roomA);
    const occ = await raw`select room_id from event_occurrences where event_id = ${e1.id}`;
    expect(occ.map((r) => r.room_id)).toEqual([roomA]);
  });

  it.each([
    ['empty', 'empty'],
    ['unbounded end', '[2026-03-30T07:00:00Z,)'],
    ['unbounded start', '(,2026-03-30T07:00:00Z)'],
    ['zero length', '[2026-03-30T07:00:00Z,2026-03-30T07:00:00Z)'],
  ])('rejects a degenerate range: %s', async (_n, during) => {
    const e = await makeEvent(roomA);
    // `empty` and `[x,x)` are the same empty range; Postgres may also reject reversed bounds (22000).
    try {
      await occupy(e.id, roomA, during);
      expect.unreachable('degenerate range was accepted');
    } catch (err) {
      expect(['23514']).toContain(pgError(err).code);
    }
  });

  it('rejects a reversed range at the Postgres level', async () => {
    const e = await makeEvent(roomA);
    await expectPgError(
      occupy(e.id, roomA, range('2026-03-30T08:00:00Z', '2026-03-30T07:00:00Z')),
      '22000',
    );
  });
});

describe('events constraints', () => {
  it('rejects end <= start', async () => {
    await expectPgError(
      makeEvent(roomA, { startAt: '2026-03-30T08:00:00Z', endAt: '2026-03-30T08:00:00Z' }),
      '23514',
      'events_range_chk',
    );
    await expectPgError(
      makeEvent(roomA, { startAt: '2026-03-30T08:00:00Z', endAt: '2026-03-30T07:00:00Z' }),
      '23514',
      'events_range_chk',
    );
  });

  it('rejects empty and over-long titles, accepts the 200 boundary', async () => {
    await expectPgError(makeEvent(roomA, { title: '' }), '23514', 'events_title_chk');
    await expectPgError(makeEvent(roomA, { title: 'x'.repeat(201) }), '23514', 'events_title_chk');
    await makeEvent(roomA, { title: 'x'.repeat(200) });
  });

  it('starts at version 1 and refuses version 0', async () => {
    const e = await makeEvent(roomA);
    expect(e.version).toBe(1);
    await expectPgError(
      db.update(s.events).set({ version: 0 }).where(eq(s.events.id, e.id)),
      '23514',
      'events_version_chk',
    );
  });

  it('series_id and original_start must be set together', async () => {
    const master = await makeEvent(roomA, { rrule: 'FREQ=WEEKLY' });
    await expectPgError(makeEvent(roomB, { seriesId: master.id }), '23514', 'events_detached_chk');
    await expectPgError(
      makeEvent(roomB, { originalStart: '2026-04-06T07:00:00Z' }),
      '23514',
      'events_detached_chk',
    );
    await makeEvent(roomB, { seriesId: master.id, originalStart: '2026-04-06T07:00:00Z' });
  });

  it('deleting a series master deletes its detached exceptions and their occurrences', async () => {
    const master = await makeEvent(roomA, { rrule: 'FREQ=WEEKLY' });
    const ex = await makeEvent(roomB, {
      seriesId: master.id,
      originalStart: '2026-04-06T07:00:00Z',
    });
    await occupy(ex.id, roomB, range('2026-04-06T07:00:00Z', '2026-04-06T08:00:00Z'));
    // An unrelated event must survive.
    const other = await makeEvent(roomB, {
      title: 'Unrelated',
      startAt: '2026-05-01T07:00:00Z',
      endAt: '2026-05-01T08:00:00Z',
    });
    await db.delete(s.events).where(eq(s.events.id, master.id));
    const left = await raw`select id from events`;
    expect(left.map((r) => r.id)).toEqual([other.id]);
    const occ = await raw`select count(*)::int as n from event_occurrences`;
    expect(occ[0]?.n).toBe(0);
  });

  it('round-trips exdates and instants as strings without Date objects', async () => {
    const e = await makeEvent(roomA, {
      rrule: 'FREQ=DAILY',
      exdates: ['2026-04-01T07:00:00Z', '2026-04-02T07:00:00Z'],
    });
    const [row] = await db.select().from(s.events).where(eq(s.events.id, e.id));
    expect(row?.exdates).toHaveLength(2);
    expect(typeof row?.startAt).toBe('string');
    expect(Date.parse(row!.exdates[0]!)).toBe(Date.parse('2026-04-01T07:00:00Z'));
  });

  it('refuses to delete a room or a user that still has events', async () => {
    await makeEvent(roomA);
    await expectPgError(db.delete(s.rooms).where(eq(s.rooms.id, roomA)), '23503');
    await expectPgError(db.delete(s.users).where(eq(s.users.id, userId)), '23503');
  });
});

describe('users', () => {
  it('email is unique case-insensitively', async () => {
    await expectPgError(
      db.insert(s.users).values({ email: 'A@X.TEST', passwordHash: 'h', name: 'Dup' }),
      '23505',
      'users_email_lower_uq',
    );
  });

  it('rejects an unsupported locale', async () => {
    await expectPgError(
      db.insert(s.users).values({ email: 'b@x.test', passwordHash: 'h', name: 'B', locale: 'de' }),
      '23514',
      'users_locale_chk',
    );
  });
});
