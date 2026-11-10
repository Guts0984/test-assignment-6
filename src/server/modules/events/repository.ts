import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Exec } from '@/server/core/db';
import { users } from '@/server/modules/auth';
import { parseInstant, toRange, type RecurringSource } from '@/shared/time';
import {
  iso,
  toEventDto,
  type Blocker,
  type EventDto,
  type EventRow,
  type OccurrenceDto,
} from './dto';
import { eventAttendees, eventOccurrences, events } from './schema';

export const sourceOf = (row: EventRow): RecurringSource => ({
  startAt: row.startAt,
  endAt: row.endAt,
  tzid: row.tzid,
  allDay: row.allDay,
  rrule: row.rrule,
  exdates: row.exdates,
});

export async function attendeesOf(db: Exec, eventIds: string[]): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>(eventIds.map((id) => [id, []]));
  if (eventIds.length === 0) return map;
  const rows = await db
    .select()
    .from(eventAttendees)
    .where(inArray(eventAttendees.eventId, eventIds));
  for (const r of rows) map.get(r.eventId)?.push(r.userId);
  return map;
}

export async function loadEventDtos(db: Exec, ids: string[]): Promise<EventDto[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(events).where(inArray(events.id, ids));
  const attendees = await attendeesOf(db, ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [toEventDto(row, attendees.get(id) ?? [])] : [];
  });
}

type ListArgs = { from: string; to: string; rooms?: string[] | undefined };

/** Occurrences overlapping [from, to) with the owning event, creator and attendees. */
export async function listOccurrences(db: Exec, q: ListArgs): Promise<OccurrenceDto[]> {
  const window = toRange(parseInstant(q.from), parseInstant(q.to));
  const rows = await db
    .select({
      eventId: events.id,
      roomId: events.roomId,
      title: events.title,
      description: events.description,
      allDay: events.allDay,
      tzid: events.tzid,
      rrule: events.rrule,
      seriesId: events.seriesId,
      version: events.version,
      creatorId: users.id,
      creatorName: users.name,
      lo: sql<string>`lower(${eventOccurrences.during})::text`,
      up: sql<string>`upper(${eventOccurrences.during})::text`,
    })
    .from(eventOccurrences)
    .innerJoin(events, eq(events.id, eventOccurrences.eventId))
    .innerJoin(users, eq(users.id, events.creatorId))
    .where(
      and(
        sql`${eventOccurrences.during} && ${window}::tstzrange`,
        q.rooms && q.rooms.length > 0 ? inArray(eventOccurrences.roomId, q.rooms) : undefined,
      ),
    )
    .orderBy(sql`lower(${eventOccurrences.during})`, asc(events.id));

  const attendees = await attendeesOf(db, [...new Set(rows.map((r) => r.eventId))]);
  return rows.map((r) => ({
    eventId: r.eventId,
    roomId: r.roomId,
    title: r.title,
    description: r.description,
    start: iso(r.lo),
    end: iso(r.up),
    allDay: r.allDay,
    tzid: r.tzid,
    recurring: r.rrule !== null,
    seriesId: r.seriesId,
    version: r.version,
    creator: { id: r.creatorId, name: r.creatorName },
    attendeeIds: [...(attendees.get(r.eventId) ?? [])].sort(),
  }));
}

/** Bookings in `roomId` that overlap any of the given `[start,end)` ranges: who is in the way. */
export async function findBlockers(db: Exec, roomId: string, ranges: string[]): Promise<Blocker[]> {
  if (ranges.length === 0) return [];
  const overlapsAny = sql.join(
    ranges.map((r) => sql`${eventOccurrences.during} && ${r}::tstzrange`),
    sql` or `,
  );
  const rows = await db
    .select({
      eventId: events.id,
      title: events.title,
      creatorId: users.id,
      creatorName: users.name,
      lo: sql<string>`lower(${eventOccurrences.during})::text`,
      up: sql<string>`upper(${eventOccurrences.during})::text`,
    })
    .from(eventOccurrences)
    .innerJoin(events, eq(events.id, eventOccurrences.eventId))
    .innerJoin(users, eq(users.id, events.creatorId))
    .where(and(eq(eventOccurrences.roomId, roomId), sql`(${overlapsAny})`))
    .orderBy(sql`lower(${eventOccurrences.during})`)
    .limit(5);
  return rows.map((r) => ({
    eventId: r.eventId,
    title: r.title,
    creator: { id: r.creatorId, name: r.creatorName },
    start: iso(r.lo),
    end: iso(r.up),
  }));
}
