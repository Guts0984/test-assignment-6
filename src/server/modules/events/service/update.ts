import { Temporal } from '@js-temporal/polyfill';
import { and, eq, gte, sql } from 'drizzle-orm';
import { abort, type Db, type Result, type Tx } from '@/server/core/db';
import {
  fromWallClock,
  parseInstant,
  ruleCount,
  ruleWithCount,
  wallClock,
  type Occurrence,
} from '@/shared/time';
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

/**
 * The wall-clock distance from `from` to `to` in `tzid`: the amount a series moves by. Exceptions of the
 * series (removed occurrences, "only this" edits) are carried along by the same amount, so they keep
 * pointing at the occurrence they meant.
 */
const wallDistance = (tzid: string, from: string, to: string): Temporal.Duration =>
  wallClock(parseInstant(from), tzid).until(wallClock(parseInstant(to), tzid));

const shiftedBy = (tzid: string, instant: string, by: Temporal.Duration): string =>
  fromWallClock(wallClock(parseInstant(instant), tzid).add(by), tzid).toString();

/** scope "all" (and every non-recurring event): change the event / the whole series in place. */
async function updateWhole(
  tx: Tx,
  ctx: Ctx,
  row: EventRow,
  c: UpdateEventInput,
): Promise<MutationResult> {
  const old = fieldsOf(row);
  const next = merge(old, c);
  const timeChanged = next.startAt !== old.startAt || next.endAt !== old.endAt;
  // Nothing that decides WHEN or WHERE the occurrences are changed (a rename, other people, a
  // description): leave the materialized occurrences alone. Rebuilding them would also try to re-insert
  // an occurrence that was skipped earlier because somebody booked the room in the meantime, and fail.
  const sameSchedule =
    !timeChanged &&
    next.roomId === old.roomId &&
    next.allDay === old.allDay &&
    next.tzid === old.tzid &&
    next.rrule === old.rrule;
  const sameRule = next.rrule === old.rrule && next.tzid === old.tzid;

  // Moving a series: keep its exceptions by moving them along. Only a changed rule or zone makes them
  // meaningless (they were occurrences of the old rule), and then they are dropped.
  const moveExceptions = timeChanged && row.rrule !== null && sameRule;
  const dropExceptions = timeChanged && row.rrule !== null && !sameRule;
  const by = moveExceptions ? wallDistance(row.tzid, old.startAt, next.startAt) : null;
  const exdates = dropExceptions
    ? []
    : row.exdates.map(iso).map((e) => (by ? shiftedBy(row.tzid, e, by) : e));
  assertShape(asSource(next, exdates));
  await lockRooms(tx, [row.roomId, next.roomId]);

  let deleted: string[] = [];
  if (dropExceptions) {
    const rows = await tx
      .delete(events)
      .where(eq(events.seriesId, row.id))
      .returning({ id: events.id });
    deleted = rows.map((r) => r.id);
  } else if (by) {
    const detached = await tx
      .select({ id: events.id, originalStart: events.originalStart })
      .from(events)
      .where(eq(events.seriesId, row.id));
    for (const d of detached) {
      if (!d.originalStart) continue;
      await tx
        .update(events)
        .set({ originalStart: shiftedBy(row.tzid, iso(d.originalStart), by) })
        .where(eq(events.id, d.id));
    }
  }
  if (!sameSchedule) await clearOccurrences(tx, row.id);
  const [updated] = await tx
    .update(events)
    .set({
      ...next,
      exdates,
      materializedUntil: sameSchedule
        ? row.materializedUntil
        : horizonColumn(asSource(next), ctx.now, row.materializedUntil),
      version: sql`${events.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(events.id, row.id))
    .returning();
  if (c.attendeeIds) await setAttendees(tx, row.id, c.attendeeIds);
  if (!sameSchedule) await materialize(tx, updated as EventRow, ctx.now);
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
  await materialize(tx, detached as EventRow, ctx.now, [row.id]);
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
  // An occurrence that a clock change pushed to another wall-clock time (03:30 on a night when 03:30 does
  // not exist) cannot start the new series: the series would keep the pushed time (04:30) for good.
  if (
    !row.allDay &&
    !wallClock(occ.start, row.tzid)
      .toPlainTime()
      .equals(wallClock(parseInstant(iso(row.startAt)), row.tzid).toPlainTime())
  ) {
    abort(400, 'VALIDATION', [
      {
        path: 'occurrenceStart',
        message: 'this occurrence was moved by a clock change; split the series at its neighbour',
      },
    ]);
  }
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
  // The new series keeps the exceptions from the split point on (moved along if it moves), unless its
  // rule or zone changed: then they referred to a different rule and are dropped.
  const keepExceptions = c.rrule === undefined && c.tzid === undefined;
  const by =
    keepExceptions && timeChanged ? wallDistance(row.tzid, base.startAt, next.startAt) : null;
  const exdates = keepExceptions
    ? oldExdatesAfter.map((e) => (by ? shiftedBy(row.tzid, e, by) : e))
    : [];
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

  // "Only this" edits from the split point on belong to the part of the series that continues: they
  // follow it to the new series. (Left behind, their occurrence would come back as a duplicate, or as
  // a room clash, in the new series.) With a different rule they are meaningless and are removed.
  const detached = await tx
    .select({ id: events.id, originalStart: events.originalStart })
    .from(events)
    .where(and(eq(events.seriesId, row.id), gte(events.originalStart, occ.start.toString())));
  let deleted: string[] = [];
  if (keepExceptions) {
    for (const d of detached) {
      await tx
        .update(events)
        .set({
          seriesId: newRow.id,
          originalStart: by
            ? shiftedBy(row.tzid, iso(d.originalStart as string), by)
            : (d.originalStart as string),
        })
        .where(eq(events.id, d.id));
    }
  } else if (detached.length > 0) {
    await tx
      .delete(events)
      .where(and(eq(events.seriesId, row.id), gte(events.originalStart, occ.start.toString())));
    deleted = detached.map((d) => d.id);
  }
  await setAttendees(tx, newRow.id, c.attendeeIds ?? oldAttendees);
  await materialize(tx, newRow, ctx.now, [row.id]);
  return finish(
    tx,
    [row.id, newRow.id, ...(keepExceptions ? detached.map((d) => d.id) : [])],
    deleted,
  );
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
