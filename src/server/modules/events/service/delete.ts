import { and, eq, sql } from 'drizzle-orm';
import type { Db, Result, Tx } from '@/server/core/db';
import { parseInstant } from '@/shared/time';
import { iso, type EventRow } from '../dto';
import { eventOccurrences, events } from '../schema';
import type { DeleteEventQuery } from '../validation';
import { finish, inTransaction, lockAndCheck } from './persist';
import { cutSeries, requireOccurrence, resolveScope } from './series';
import type { MutationResult } from './types';

async function deleteWhole(tx: Tx, row: EventRow): Promise<MutationResult> {
  const exceptions = await tx
    .select({ id: events.id })
    .from(events)
    .where(eq(events.seriesId, row.id));
  await tx.delete(events).where(eq(events.id, row.id)); // cascades occurrences, attendees, exceptions
  return { events: [], deletedEventIds: [row.id, ...exceptions.map((e) => e.id)] };
}

export function deleteEvent(
  db: Db,
  id: string,
  q: DeleteEventQuery,
): Promise<Result<MutationResult>> {
  return inTransaction(db, async (tx) => {
    const row = await lockAndCheck(tx, id, q.version);
    const scope = resolveScope(row, q.scope);
    if (scope === 'all') return deleteWhole(tx, row);

    const occ = requireOccurrence(row, q.occurrenceStart);
    if (scope === 'following') {
      if (occ.start.equals(parseInstant(row.startAt))) return deleteWhole(tx, row);
      await cutSeries(tx, row, occ);
      return finish(tx, [row.id]);
    }
    await tx
      .delete(eventOccurrences)
      .where(
        and(
          eq(eventOccurrences.eventId, row.id),
          sql`lower(${eventOccurrences.during}) = ${occ.start.toString()}::timestamptz`,
        ),
      );
    await tx
      .update(events)
      .set({
        exdates: [...row.exdates.map(iso), occ.start.toString()],
        version: sql`${events.version} + 1`,
        updatedAt: sql`now()`,
      })
      .where(eq(events.id, row.id));
    return finish(tx, [row.id]);
  });
}
