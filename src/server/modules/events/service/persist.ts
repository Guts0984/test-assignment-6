import type { Temporal } from '@js-temporal/polyfill';
import { eq } from 'drizzle-orm';
import {
  abort,
  abortWith,
  advisoryLocks,
  isRoomClash,
  runTx,
  type Db,
  type Tx,
} from '@/server/core/db';
import { parseInstant } from '@/shared/time';
import { loadEventDtos, sourceOf } from '../repository';
import type { EventRow } from '../dto';
import { dbErrorToApi, roomConflictError } from '../errors';
import { occurrenceRanges } from '../materialize';
import { eventAttendees, eventOccurrences, events } from '../schema';
import { horizonFrom } from './fields';
import type { MutationResult } from './types';

/** Every events mutation runs through this: one transaction, database errors mapped to API errors. */
export const inTransaction = <T>(db: Db, fn: (tx: Tx) => Promise<T>) =>
  runTx(db, fn, { mapError: dbErrorToApi });

/**
 * Serializes writers per room for the rest of the transaction.
 *
 * The exclusion constraint is the actual guarantee against double booking. Without this lock,
 * many simultaneous bookings of one slot wait on each other's uncommitted rows in cycles that
 * Postgres only resolves after its deadlock timeout (1s per round) by aborting a transaction.
 * Locks are taken in sorted order, so moving events between rooms in opposite directions
 * cannot deadlock either.
 */
export const lockRooms = (tx: Tx, roomIds: string[]) =>
  advisoryLocks(
    tx,
    roomIds.map((id) => `room:${id}`),
  );

/** The database refused a booking; the 409 (with who is in the way) is built after the rollback. */
export const abortRoomClash = (roomId: string, ranges: string[]): never =>
  abortWith((db) => roomConflictError(db, roomId, ranges));

export async function insertOccurrenceRows(
  tx: Tx,
  eventId: string,
  roomId: string,
  ranges: string[],
): Promise<void> {
  try {
    for (let i = 0; i < ranges.length; i += 500) {
      await tx
        .insert(eventOccurrences)
        .values(ranges.slice(i, i + 500).map((during) => ({ eventId, roomId, during })));
    }
  } catch (e) {
    if (isRoomClash(e)) abortRoomClash(roomId, ranges);
    throw e;
  }
}

/** Rebuilds the occurrences of an event from its row. Old rows must already be deleted. */
export const materialize = (tx: Tx, row: EventRow, now: Temporal.Instant) =>
  insertOccurrenceRows(
    tx,
    row.id,
    row.roomId,
    occurrenceRanges(
      sourceOf(row),
      row.materializedUntil ? parseInstant(row.materializedUntil) : horizonFrom(now),
    ),
  );

export const clearOccurrences = (tx: Tx, eventId: string) =>
  tx.delete(eventOccurrences).where(eq(eventOccurrences.eventId, eventId));

export const setAttendees = async (tx: Tx, eventId: string, userIds: string[]) => {
  await tx.delete(eventAttendees).where(eq(eventAttendees.eventId, eventId));
  if (userIds.length > 0) {
    await tx.insert(eventAttendees).values(userIds.map((userId) => ({ eventId, userId })));
  }
};

export const finish = async (
  tx: Tx,
  changedIds: string[],
  deleted: string[] = [],
): Promise<MutationResult> => ({
  events: await loadEventDtos(tx, changedIds),
  deletedEventIds: deleted,
});

/** Locks the row and enforces optimistic concurrency. Aborts with 404 / 409 VERSION_CONFLICT. */
export async function lockAndCheck(tx: Tx, id: string, version: number): Promise<EventRow> {
  const [row] = await tx.select().from(events).where(eq(events.id, id)).for('update');
  if (!row) return abort(404, 'NOT_FOUND');
  if (row.version !== version) {
    const [current] = await loadEventDtos(tx, [id]);
    return abort(409, 'VERSION_CONFLICT', { current });
  }
  return row;
}
