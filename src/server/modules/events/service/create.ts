import type { Db } from '@/server/core/db';
import type { Result } from '@/server/core/db';
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

    const [row] = await tx
      .insert(events)
      .values({
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
