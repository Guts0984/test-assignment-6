import { Temporal } from '@js-temporal/polyfill';
import { and, eq, sql } from 'drizzle-orm';
import { abort, type Db, type Result, type Tx } from '@/server/core/db';
import { parseInstant, ruleCount, ruleWithCount, type Occurrence } from '@/shared/time';
import { iso, type EventRow } from '../dto';
import { attendeesOf } from '../repository';
import { eventOccurrences, events } from '../schema';
import type { UpdateEventInput } from '../validation';
import { asSource, assertShape, fieldsOf, horizonColumn, merge, type Fields } from './fields';
import {
  clearOccurrences,
  finish,
  inTransaction,
  lockAndCheck,
  lockRooms,
  materialize,
  setAttendees,
} from './persist';
import { cutSeries, requireOccurrence, resolveScope } from './series';
import type { Ctx, MutationResult } from './types';

/** scope "all" (and every non-recurring event): change the event / the whole series in place. */
async function updateWhole(
  tx: Tx,
  ctx: Ctx,
  row: EventRow,
  c: UpdateEventInput,
): Promise<MutationResult> {
  const next = merge(fieldsOf(row), c);
  const timeChanged = next.startAt !== iso(row.startAt) || next.endAt !== iso(row.endAt);
  // Moving the whole series invalidates "only this" edits made against the old times.
  const dropExceptions = timeChanged && row.rrule !== null;
  const exdates = dropExceptions ? [] : row.exdates.map(iso);
  assertShape(asSource(next, exdates));
  await lockRooms(tx, [row.roomId, next.roomId]);

  let deleted: string[] = [];
  if (dropExceptions) {
    const rows = await tx
      .delete(events)
      .where(eq(events.seriesId, row.id))
      .returning({ id: events.id });
    deleted = rows.map((r) => r.id);
  }
  await clearOccurrences(tx, row.id);
  const [updated] = await tx
    .update(events)
    .set({
      ...next,
      exdates,
      materializedUntil: horizonColumn(asSource(next), ctx.now, row.materializedUntil),
      version: sql`${events.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(events.id, row.id))
    .returning();
  if (c.attendeeIds) await setAttendees(tx, row.id, c.attendeeIds);
  await materialize(tx, updated as EventRow, ctx.now);
  return finish(tx, [row.id], deleted);
}

/** scope "this": remove one occurrence from the series (exdate) and create a detached event for it. */
async function updateThis(
  tx: Tx,
  ctx: Ctx,
  row: EventRow,
  c: UpdateEventInput,
  occ: Occurrence,
): Promise<MutationResult> {
  if (c.rrule !== undefined)
    abort(400, 'VALIDATION', [
      { path: 'rrule', message: 'cannot change the rule of a single occurrence' },
    ]);
  const base: Fields = {
    ...fieldsOf(row),
    startAt: occ.start.toString(),
    endAt: occ.end.toString(),
    rrule: null,
  };
  const next = merge(base, c);
  assertShape(asSource(next));
  await lockRooms(tx, [row.roomId, next.roomId]);

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

  const [detached] = await tx
    .insert(events)
    .values({
      ...next,
      creatorId: row.creatorId,
      seriesId: row.id,
      originalStart: occ.start.toString(),
    })
    .returning();
  const masterAttendees = (await attendeesOf(tx, [row.id])).get(row.id) ?? [];
  await setAttendees(tx, (detached as EventRow).id, c.attendeeIds ?? masterAttendees);
  await materialize(tx, detached as EventRow, ctx.now);
  return finish(tx, [row.id, (detached as EventRow).id]);
}

/** scope "following": end the old series before `occ` and start a new one from it. */
async function updateFollowing(
  tx: Tx,
  ctx: Ctx,
  row: EventRow,
  c: UpdateEventInput,
  occ: Occurrence,
): Promise<MutationResult> {
  const oldRule = row.rrule as string;
  const originalCount = ruleCount(oldRule);
  const oldExdatesAfter = row.exdates
    .map(iso)
    .filter((e) => Temporal.Instant.compare(parseInstant(e), occ.start) >= 0);
  const oldAttendees = (await attendeesOf(tx, [row.id])).get(row.id) ?? [];
  await lockRooms(tx, [row.roomId, c.roomId ?? row.roomId]);

  const { countBefore } = await cutSeries(tx, row, occ);

  const base: Fields = {
    ...fieldsOf(row),
    startAt: occ.start.toString(),
    endAt: occ.end.toString(),
    rrule: originalCount === null ? oldRule : ruleWithCount(oldRule, originalCount - countBefore),
  };
  const next = merge(base, c);
  const timeChanged = next.startAt !== base.startAt || next.endAt !== base.endAt;
  const exdates = timeChanged ? [] : oldExdatesAfter;
  assertShape(asSource(next, exdates));

  const [created] = await tx
    .insert(events)
    .values({
      ...next,
      exdates,
      creatorId: row.creatorId,
      materializedUntil: horizonColumn(asSource(next), ctx.now, null),
    })
    .returning();
  const newRow = created as EventRow;
  await setAttendees(tx, newRow.id, c.attendeeIds ?? oldAttendees);
  await materialize(tx, newRow, ctx.now);
  return finish(tx, [row.id, newRow.id]);
}

export function updateEvent(
  db: Db,
  ctx: Ctx,
  id: string,
  input: UpdateEventInput,
): Promise<Result<MutationResult>> {
  return inTransaction(db, async (tx) => {
    const row = await lockAndCheck(tx, id, input.version);
    const scope = resolveScope(row, input.scope);
    if (scope === 'all') return updateWhole(tx, ctx, row, input);

    const occ = requireOccurrence(row, input.occurrenceStart);
    if (scope === 'this') return updateThis(tx, ctx, row, input, occ);
    // "this and following" from the very first occurrence is the same as editing the whole series.
    if (occ.start.equals(parseInstant(row.startAt))) return updateWhole(tx, ctx, row, input);
    return updateFollowing(tx, ctx, row, input, occ);
  });
}
