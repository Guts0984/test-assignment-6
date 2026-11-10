import type { Temporal } from '@js-temporal/polyfill';
import { sql } from 'drizzle-orm';
import { hashPassword } from '@/server/modules/auth';
import type { Db } from '@/server/core/db';
import { users } from '@/server/modules/auth';
import { rooms } from '@/server/modules/rooms';
import { eventAttendees, eventOccurrences, events } from '@/server/modules/events';
import { buildPlan } from './plan';

const SEED_LOCK_ID = 7_243_001;

const chunks = <T>(items: readonly T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size),
  );

export type SeedResult = {
  seeded: boolean;
  users: number;
  rooms: number;
  events: number;
  occurrences: number;
};

async function counts(db: Db): Promise<Omit<SeedResult, 'seeded'>> {
  const [r] = await db.execute<{ u: number; r: number; e: number; o: number }>(sql`
    select (select count(*)::int from users) as u, (select count(*)::int from rooms) as r,
           (select count(*)::int from events) as e, (select count(*)::int from event_occurrences) as o`);
  return { users: r?.u ?? 0, rooms: r?.r ?? 0, events: r?.e ?? 0, occurrences: r?.o ?? 0 };
}

/**
 * Seeds the database once. Safe to call on every start and concurrently: an advisory lock
 * serializes runs and a non-empty `users` table means "already seeded".
 */
export async function seedIfEmpty(
  db: Db,
  opts: { now: Temporal.Instant; password: string },
): Promise<SeedResult> {
  const seeded = await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_ID})`);
    const [existing] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from users`);
    if ((existing?.n ?? 0) > 0) return false;

    const plan = buildPlan(opts.now);
    const passwordHash = await hashPassword(opts.password);

    await tx.insert(users).values(plan.users.map((u) => ({ ...u, passwordHash })));
    await tx.insert(rooms).values(plan.rooms);

    // Masters come before their detached exceptions in plan order.
    for (const part of chunks(plan.events, 200)) {
      await tx.insert(events).values(
        part.map((e) => ({
          id: e.id,
          roomId: e.roomId,
          creatorId: e.creatorId,
          title: e.title,
          description: e.description,
          startAt: e.startAt,
          endAt: e.endAt,
          allDay: e.allDay,
          tzid: e.tzid,
          rrule: e.rrule,
          exdates: [...e.exdates],
          seriesId: e.seriesId,
          originalStart: e.originalStart,
          materializedUntil: e.materializedUntil,
        })),
      );
    }
    const attendees = plan.events.flatMap((e) =>
      e.attendeeIds.map((userId) => ({ eventId: e.id, userId })),
    );
    for (const part of chunks(attendees, 1000)) await tx.insert(eventAttendees).values(part);

    const occurrences = plan.events.flatMap((e) =>
      e.ranges.map((during) => ({ eventId: e.id, roomId: e.roomId, during })),
    );
    for (const part of chunks(occurrences, 1000)) await tx.insert(eventOccurrences).values(part);
    return true;
  });
  return { seeded, ...(await counts(db)) };
}
