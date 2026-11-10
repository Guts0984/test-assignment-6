import type { Db } from '@/server/core/db';
import type { Result } from '@/server/core/db';
import { eq } from 'drizzle-orm';
import { abort } from '@/server/core/db';
import { events } from '../schema';
import type { EventRow } from '../dto';
import type { CreateEventInput } from '../validation';
import { asSource, assertShape, horizonColumn, type Fields } from './fields';
import { finish, inTransaction, lockRooms, materialize, setAttendees } from './persist';
import type { Ctx, MutationResult } from './types';

export function createEvent(
  db: Db,
  ctx: Ctx,
  input: CreateEventInput,
): Promise<Result<MutationResult>> {
  return inTransaction(db, async (tx) => {
    const fields: Fields = {
      roomId: input.roomId,
      title: input.title,
      description: input.description,
      startAt: input.startAt,
      endAt: input.endAt,
      allDay: input.allDay,
      tzid: input.tzid ?? ctx.user.timezone,
      rrule: input.rrule,
    };
    assertShape(asSource(fields));
    await lockRooms(tx, [fields.roomId]);

    // A client-chosen id makes the request idempotent: if that event already exists (a retry after a
    // lost response, or an offline replay) answer with it instead of creating a second one.
    if (input.id) {
      const [existing] = await tx.select().from(events).where(eq(events.id, input.id));
      if (existing) {
        if (existing.creatorId !== ctx.user.id) {
          return abort(400, 'VALIDATION', [{ path: 'id', message: 'is already used' }]);
        }
        return { ...(await finish(tx, [existing.id])), replayed: true };
      }
    }

    const [row] = await tx
      .insert(events)
      .values({
        ...(input.id ? { id: input.id } : {}),
        ...fields,
        creatorId: ctx.user.id,
        materializedUntil: horizonColumn(asSource(fields), ctx.now, null),
      })
      .returning();
    const created = row as EventRow;
    await setAttendees(tx, created.id, input.attendeeIds);
    await materialize(tx, created, ctx.now);
    return finish(tx, [created.id]);
  });
}
