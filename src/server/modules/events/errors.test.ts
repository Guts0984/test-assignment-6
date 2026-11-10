// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { dbErrorToApi } from './errors';

const pgError = (code: string, constraint?: string) =>
  Object.assign(new Error(`pg ${code}`), { code, constraint_name: constraint });

describe('dbErrorToApi', () => {
  it('unknown room (foreign key) -> 400 VALIDATION on roomId', () => {
    expect(dbErrorToApi(pgError('23503', 'events_room_id_rooms_id_fk'))).toMatchObject({
      status: 400,
      code: 'VALIDATION',
      details: [{ path: 'roomId' }],
    });
  });

  it('unknown attendee (foreign key) -> 400 VALIDATION on attendeeIds', () => {
    expect(dbErrorToApi(pgError('23503', 'event_attendees_user_id_users_id_fk'))).toMatchObject({
      details: [{ path: 'attendeeIds' }],
    });
  });

  it('looks through the Drizzle error wrapper', () => {
    const wrapped = Object.assign(new Error('Failed query'), {
      cause: pgError('23503', 'events_room_id_rooms_id_fk'),
    });
    expect(dbErrorToApi(wrapped)).toMatchObject({ code: 'VALIDATION' });
  });

  it.each([pgError('23505'), pgError('23P01'), new Error('boom'), null, 'text'])(
    'leaves every other error alone (%#)',
    (e) => expect(dbErrorToApi(e)).toBeNull(),
  );
});
