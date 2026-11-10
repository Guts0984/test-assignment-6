import { pgErrorInfo, type Db, type ServiceError } from '@/server/core/db';
import { findBlockers } from './repository';

/** Foreign key violations (unknown room / attendee) are client mistakes: 400, not 500. */
export function dbErrorToApi(error: unknown): ServiceError | null {
  const info = pgErrorInfo(error);
  if (info.code !== '23503') return null;
  const path = info.constraint?.includes('room') ? 'roomId' : 'attendeeIds';
  return {
    status: 400,
    code: 'VALIDATION',
    details: [{ path, message: 'refers to something that does not exist' }],
  };
}

/** 409 for a booking that hit the exclusion constraint, naming who is in the way. */
export async function roomConflictError(
  db: Db,
  roomId: string,
  ranges: string[],
): Promise<ServiceError> {
  return {
    status: 409,
    code: 'ROOM_CONFLICT',
    details: { blockers: await findBlockers(db, roomId, ranges) },
  };
}
