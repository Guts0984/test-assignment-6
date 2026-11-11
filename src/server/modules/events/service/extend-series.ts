import { Temporal } from '@js-temporal/polyfill';
import { and, eq, isNotNull, lt } from 'drizzle-orm';
import type { Db } from '@/server/core/db';
import { parseInstant } from '@/shared/time';
import { occurrenceRangesBetween } from '../materialize';
import { sourceOf } from '../repository';
import { eventOccurrences, events } from '../schema';
import { supportedWindow } from '../window';
import { lockRooms } from './persist';

/**
 * Open-ended series are materialized only up to `materialized_until`. When someone looks further
 * ahead, extend them (idempotent, safe under concurrent reads). Occurrences that would collide
 * with bookings made in the meantime are skipped by the database (ON CONFLICT DO NOTHING).
 */
export async function extendOpenSeries(
  db: Db,
  requested: Temporal.Instant,
  now: Temporal.Instant = Temporal.Now.instant(),
): Promise<void> {
  // Whatever the caller asks for, never materialize beyond the supported span (this is what turned a
  // request for the year 9000 into hundreds of thousands of rows).
  const { latest } = supportedWindow(now);
  const to = Temporal.Instant.compare(requested, latest) > 0 ? latest : requested;
  const due = await db
    .select({ id: events.id })
    .from(events)
    .where(and(isNotNull(events.materializedUntil), lt(events.materializedUntil, to.toString())));
  const newHorizon = to.toZonedDateTimeISO('UTC').add({ months: 6 }).toInstant();

  for (const { id } of due) {
    await db.transaction(async (tx) => {
      const [row] = await tx.select().from(events).where(eq(events.id, id)).for('update');
      if (!row?.materializedUntil) return;
      await lockRooms(tx, [row.roomId]);
      const oldHorizon = parseInstant(row.materializedUntil);
      if (Temporal.Instant.compare(oldHorizon, to) >= 0) return; // another request got here first
      const fresh = occurrenceRangesBetween(sourceOf(row), oldHorizon, newHorizon);
      for (let i = 0; i < fresh.length; i += 500) {
        await tx
          .insert(eventOccurrences)
          .values(
            fresh
              .slice(i, i + 500)
              .map((during) => ({ eventId: row.id, roomId: row.roomId, during })),
          )
          .onConflictDoNothing();
      }
      await tx
        .update(events)
        .set({ materializedUntil: newHorizon.toString() })
        .where(eq(events.id, id));
    });
  }
}
