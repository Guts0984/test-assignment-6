import { Temporal } from '@js-temporal/polyfill';
import { and, eq, gte, sql } from 'drizzle-orm';
import { abort, type Tx } from '@/server/core/db';
import {
  expandAll,
  expandOccurrences,
  parseInstant,
  ruleWithUntil,
  wallClock,
  type Occurrence,
} from '@/shared/time';
import { iso, type EventRow } from '../dto';
import { isOpenEnded } from '../materialize';
import { sourceOf } from '../repository';
import { eventOccurrences, events } from '../schema';
import type { Scope } from '../validation';

/** The occurrence of a series that starts exactly at `start`, or a 400. */
export function requireOccurrence(row: EventRow, start: string | undefined): Occurrence {
  if (!start)
    return abort(400, 'VALIDATION', [
      { path: 'occurrenceStart', message: 'required for this scope' },
    ]);
  const at = parseInstant(start);
  const found = expandOccurrences(sourceOf(row), at, at.add({ milliseconds: 1 })).find((o) =>
    o.start.equals(at),
  );
  return (
    found ??
    abort(400, 'VALIDATION', [
      { path: 'occurrenceStart', message: 'is not an occurrence of this series' },
    ])
  );
}

export function resolveScope(row: EventRow, scope: Scope | undefined): Scope {
  if (row.rrule === null) {
    if (scope !== undefined && scope !== 'all') {
      return abort(400, 'VALIDATION', [
        { path: 'scope', message: 'only recurring events have a scope' },
      ]);
    }
    return 'all';
  }
  return scope ?? 'all';
}

/** Ends the series right before `occ` (keeps everything earlier untouched). Returns how many came before. */
export async function cutSeries(
  tx: Tx,
  row: EventRow,
  occ: Occurrence,
): Promise<{ countBefore: number }> {
  const src = { ...sourceOf(row), exdates: [] as string[] };
  const before = isOpenEnded(src)
    ? expandOccurrences(src, parseInstant(row.startAt), occ.start).filter(
        (o) => o.start.epochMilliseconds < occ.start.epochMilliseconds,
      )
    : expandAll(src).filter((o) => o.start.epochMilliseconds < occ.start.epochMilliseconds);
  const cut = wallClock(occ.start, row.tzid).subtract({ seconds: 1 });

  await tx
    .delete(eventOccurrences)
    .where(
      and(
        eq(eventOccurrences.eventId, row.id),
        gte(sql`lower(${eventOccurrences.during})`, sql`${occ.start.toString()}::timestamptz`),
      ),
    );
  await tx
    .update(events)
    .set({
      rrule: ruleWithUntil(row.rrule as string, cut),
      materializedUntil: null,
      exdates: row.exdates
        .map(iso)
        .filter((e) => Temporal.Instant.compare(parseInstant(e), occ.start) < 0),
      version: sql`${events.version} + 1`,
      updatedAt: sql`now()`,
    })
    .where(eq(events.id, row.id));
  return { countBefore: before.length };
}
